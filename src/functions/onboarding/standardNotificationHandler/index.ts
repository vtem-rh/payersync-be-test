import { EventBridgeEvent } from 'aws-lambda';
import * as AWSXRay from 'aws-xray-sdk-core';
import { DatabaseHelper } from '../../shared/database-helpers';

interface StandardNotificationEvent {
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
  data?: {
    businessName?: string;
    countryCode?: string;
    status?: string;
  };
  s3Key: string; // Make this required since we need it for S3 linking
}

const dbHelper = new DatabaseHelper();

function determineEntityStatus(eventCode: string, success: string): string {
  // Map Adyen event codes to entity statuses
  const statusMapping: { [key: string]: string } = {
    'ACCOUNT_HOLDER_STATUS_CHANGE': 'pending',
    'ACCOUNT_HOLDER_VERIFICATION': 'pending',
    'ACCOUNT_HOLDER_UPCOMING_DEADLINE': 'pending',
    'ACCOUNT_HOLDER_PAYOUT_METHOD_ADDED': 'pending',
    'ACCOUNT_HOLDER_PAYOUT_METHOD_REMOVED': 'pending',
    'ACCOUNT_HOLDER_PAYOUT_METHOD_REQUIRED': 'pending',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_REMINDER': 'pending',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_PASSED': 'failed',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENDED': 'pending',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_REQUESTED': 'pending',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_DENIED': 'failed',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_APPROVED': 'pending',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_CANCELLED': 'pending',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_EXPIRED': 'failed',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_REVOKED': 'failed',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_SUSPENDED': 'pending',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_TERMINATED': 'failed',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_TRANSFERRED': 'pending',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_UPDATED': 'pending',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_VALIDATED': 'pending',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_VERIFIED': 'completed',
    'ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENSION_WITHDRAWN': 'failed',
  };

  // If success is false, mark as failed regardless of event code
  if (success === 'false') {
    return 'failed';
  }

  return statusMapping[eventCode] || 'pending';
}

function extractEntityId(event: StandardNotificationEvent): string {
  // Try to extract entity ID from various possible sources
  if (event.merchantReference) {
    return event.merchantReference;
  }

  // Fallback to pspReference if no merchant reference
  return event.pspReference;
}

export const handler = async (event: EventBridgeEvent<any, any>): Promise<void> => {
  return AWSXRay.captureAsyncFunc('StandardNotificationHandler', async (subsegment) => {
    try {
      // Parse the event detail
      let webhookEvent: StandardNotificationEvent;
      try {
        // Handle both string and object formats for event detail
        if (typeof event.detail === 'string') {
          webhookEvent = JSON.parse(event.detail);
        } else if (typeof event.detail === 'object') {
          webhookEvent = event.detail as StandardNotificationEvent;
        } else {
          throw new Error('Invalid event detail format - expected string or object');
        }
      } catch (error) {
        console.error('Failed to parse event detail:', error);
        throw new Error('Invalid event detail format');
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

      // Insert the event into the new optimized adyen_events table
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

      // Log successful processing
      console.log('Standard notification processed successfully:', {
        eventId: adyenEvent.id,
        pspReference: webhookEvent.pspReference,
        eventCode: webhookEvent.eventCode,
        entityId,
        s3Key: webhookEvent.s3Key,
      });

    } catch (error) {
      console.error('Error processing standard notification:', error);
      throw error;
    } finally {
      // Clean up database connection
      await dbHelper.closeClient();
    }
  });
}; 