import { EventBridgeEvent } from 'aws-lambda';
import * as AWSXRay from 'aws-xray-sdk-core';
import { DatabaseHelper } from '../../shared/database-helpers';

interface KycNotificationEvent {
  eventCode: string;
  pspReference: string;
  merchantReference: string;
  notificationType: string;
  merchantAccountCode: string;
  live: string;
  success: string;
  amount?: {
    currency: string;
    value: number;
  };
  eventDate: string;
  reason?: string;
  paymentMethod?: string;
  operations?: any[];
  originalPayload: any;
  webhookId: string;
  timestamp: string;
  businessName?: string;
  countryCode?: string;
  status?: string;
  data?: any;
  s3Key: string; // Make this required since we need it for S3 linking
}

const dbHelper = new DatabaseHelper();

function determineKycEntityStatus(eventCode: string, success: string): string {
  // KYC-specific status mapping
  const kycStatusMapping: { [key: string]: string } = {
    'ACCOUNT_HOLDER_STATUS_CHANGE': 'kyc_pending',
    'ACCOUNT_HOLDER_VERIFICATION': 'kyc_pending',
    'ACCOUNT_HOLDER_UPCOMING_DEADLINE': 'kyc_pending',
    'ACCOUNT_HOLDER_PAYOUT_METHOD_ADDED': 'kyc_pending',
    'ACCOUNT_HOLDER_PAYOUT_METHOD_REMOVED': 'kyc_pending',
    'ACCOUNT_HOLDER_PAYOUT_METHOD_REQUIRED': 'kyc_pending',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_REMINDER': 'kyc_pending',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_PASSED': 'kyc_failed',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENDED': 'kyc_pending',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_REQUESTED': 'kyc_pending',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_DENIED': 'kyc_failed',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_APPROVED': 'kyc_pending',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_CANCELLED': 'kyc_pending',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_EXPIRED': 'kyc_failed',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_REVOKED': 'kyc_failed',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_SUSPENDED': 'kyc_pending',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_TERMINATED': 'kyc_failed',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_TRANSFERRED': 'kyc_pending',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_UPDATED': 'kyc_pending',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_VALIDATED': 'kyc_pending',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_VERIFIED': 'kyc_completed',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_WITHDRAWN': 'kyc_failed',
  };

  // If success is false, mark as failed regardless of event code
  if (success === 'false') {
    return 'kyc_failed';
  }

  return kycStatusMapping[eventCode] || 'kyc_pending';
}

function extractEntityId(event: KycNotificationEvent): string {
  // Try to extract entity ID from various possible sources
  if (event.merchantReference) {
    return event.merchantReference;
  }

  // Fallback to pspReference if no merchant reference
  return event.pspReference;
}

function isKycEvent(eventCode: string): boolean {
  const kycEventCodes = [
    'ACCOUNT_HOLDER_STATUS_CHANGE',
    'ACCOUNT_HOLDER_VERIFICATION',
    'ACCOUNT_HOLDER_UPCOMING_DEADLINE',
    'ACCOUNT_HOLDER_PAYOUT_METHOD_ADDED',
    'ACCOUNT_HOLDER_PAYOUT_METHOD_REMOVED',
    'ACCOUNT_HOLDER_PAYOUT_METHOD_REQUIRED',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_REMINDER',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_PASSED',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENDED',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_REQUESTED',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_DENIED',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_APPROVED',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_CANCELLED',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_EXPIRED',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_REVOKED',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_SUSPENDED',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_TERMINATED',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_TRANSFERRED',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_UPDATED',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_VALIDATED',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_VERIFIED',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_WITHDRAWN',
  ];

  return kycEventCodes.includes(eventCode);
}

export const handler = async (event: EventBridgeEvent<any, any>): Promise<void> => {
  return AWSXRay.captureAsyncFunc('KycNotificationHandler', async (subsegment) => {
    try {
      // Parse the event detail
      let webhookEvent: KycNotificationEvent;
      try {
        // Handle both string and object formats for event detail
        if (typeof event.detail === 'string') {
          webhookEvent = JSON.parse(event.detail);
        } else if (typeof event.detail === 'object') {
          webhookEvent = event.detail as KycNotificationEvent;
        } else {
          throw new Error('Invalid event detail format - expected string or object');
        }
      } catch (error) {
        console.error('Failed to parse event detail:', error);
        throw new Error('Invalid event detail format');
      }

      // Validate that this is actually a KYC event
      if (!isKycEvent(webhookEvent.eventCode)) {
        return;
      }

      // Extract entity ID for identification
      const entityId = extractEntityId(webhookEvent);
      
      if (!entityId) {
        console.error('No entity ID found in event');
        throw new Error('Missing entity ID in webhook event');
      }

      // Check for event deduplication using unique constraint on psp_reference
      const isDuplicate = await dbHelper.checkDuplicateEvent(webhookEvent.pspReference);
      if (isDuplicate) {
        return;
      }

      // Extract relevant fields from webhook payload
      const businessName = webhookEvent.businessName || webhookEvent.data?.businessName;
      const countryCode = webhookEvent.countryCode || webhookEvent.data?.countryCode;
      const status = webhookEvent.status || webhookEvent.data?.status;

      // Insert the KYC event into the new optimized adyen_events table
      const adyenEvent = await dbHelper.insertAdyenEvent(
        webhookEvent.webhookId,        // event_id
        webhookEvent.eventCode,        // event_code
        'account_holder',              // entity_type
        entityId,                      // entity_id
        webhookEvent.s3Key,            // s3_key for linking
        webhookEvent.pspReference,     // psp_reference
        webhookEvent.merchantAccountCode, // merchant_account_code
        webhookEvent.merchantReference,   // merchant_reference
        webhookEvent.success === 'true', // success (convert string to boolean)
        webhookEvent.reason,           // reason
        businessName,                  // business_name
        countryCode,                   // country_code
        status                         // status
      );

      // Log successful processing with KYC-specific information
      console.log('KYC notification processed successfully:', {
        eventId: adyenEvent.id,
        pspReference: webhookEvent.pspReference,
        eventCode: webhookEvent.eventCode,
        entityId,
        s3Key: webhookEvent.s3Key,
        success: webhookEvent.success,
        reason: webhookEvent.reason,
      });

      // Add subsegment annotations for KYC-specific observability
      subsegment?.addAnnotation('eventCode', webhookEvent.eventCode);
      subsegment?.addAnnotation('pspReference', webhookEvent.pspReference);
      subsegment?.addAnnotation('processor', 'KycNotificationHandler');

    } catch (error) {
      console.error('Error processing KYC notification:', error);
      
      // Add error annotation for observability
      subsegment?.addAnnotation('error', 'true');
      subsegment?.addAnnotation('errorMessage', error instanceof Error ? error.message : 'Unknown error');
      
      throw error;
    } finally {
      // Clean up database connection
      await dbHelper.closeClient();
    }
  });
}; 