import { EventBridgeEvent } from 'aws-lambda';
import * as AWSXRay from 'aws-xray-sdk-core';
import { DatabaseHelper } from '../../shared/database-helpers';

interface TransferNotificationEvent {
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
  // Transfer-specific fields
  balancePlatform?: {
    transfer?: {
      id?: string;
      direction?: string;
      status?: string;
      transactionId?: string;
      counterparty?: {
        transferInstrumentId?: string;
      };
    };
  };
  businessName?: string;
  countryCode?: string;
  status?: string;
  data?: any;
  s3Key: string; // Make this required since we need it for S3 linking
}

const dbHelper = new DatabaseHelper();

function determineTransferEntityStatus(eventCode: string, success: string, transferData?: any): string {
  // Transfer-specific status mapping
  const transferStatusMapping: { [key: string]: string } = {
    'TRANSFER_FUNDS': 'transfer_pending',
    'TRANSFER_FUNDS_FAILED': 'transfer_failed',
    'TRANSFER_FUNDS_COMPLETED': 'transfer_completed',
    'TRANSFER_FUNDS_DECLINED': 'transfer_failed',
    'TRANSFER_FUNDS_EXPIRED': 'transfer_failed',
    'TRANSFER_FUNDS_CANCELLED': 'transfer_cancelled',
    'TRANSFER_FUNDS_SUSPENDED': 'transfer_pending',
    'TRANSFER_FUNDS_TERMINATED': 'transfer_failed',
    'TRANSFER_FUNDS_TRANSFERRED': 'transfer_completed',
    'TRANSFER_FUNDS_UPDATED': 'transfer_pending',
    'TRANSFER_FUNDS_VALIDATED': 'transfer_pending',
    'TRANSFER_FUNDS_VERIFIED': 'transfer_completed',
    'TRANSFER_FUNDS_WITHDRAWN': 'transfer_completed',
  };

  // If success is false, mark as failed regardless of event code
  if (success === 'false') {
    return 'transfer_failed';
  }

  // Check transfer status from balancePlatform data if available
  if (transferData?.balancePlatform?.transfer?.status) {
    const transferStatus = transferData.balancePlatform.transfer.status.toLowerCase();
    if (transferStatus === 'completed' || transferStatus === 'transferred') {
      return 'transfer_completed';
    } else if (transferStatus === 'failed' || transferStatus === 'declined' || transferStatus === 'terminated') {
      return 'transfer_failed';
    } else if (transferStatus === 'cancelled') {
      return 'transfer_cancelled';
    }
  }

  return transferStatusMapping[eventCode] || 'transfer_pending';
}

function extractEntityId(event: TransferNotificationEvent): string {
  // Try to extract entity ID from various possible sources
  if (event.merchantReference) {
    return event.merchantReference;
  }

  // For transfers, try to extract from balancePlatform transfer ID
  if (event.balancePlatform?.transfer?.id) {
    return event.balancePlatform.transfer.id;
  }

  // Fallback to pspReference if no merchant reference
  return event.pspReference;
}

function isTransferEvent(eventCode: string): boolean {
  const transferEventCodes = [
    'TRANSFER_FUNDS',
    'TRANSFER_FUNDS_FAILED',
    'TRANSFER_FUNDS_COMPLETED',
    'TRANSFER_FUNDS_DECLINED',
    'TRANSFER_FUNDS_EXPIRED',
    'TRANSFER_FUNDS_CANCELLED',
    'TRANSFER_FUNDS_SUSPENDED',
    'TRANSFER_FUNDS_TERMINATED',
    'TRANSFER_FUNDS_TRANSFERRED',
    'TRANSFER_FUNDS_UPDATED',
    'TRANSFER_FUNDS_VALIDATED',
    'TRANSFER_FUNDS_VERIFIED',
    'TRANSFER_FUNDS_WITHDRAWN',
  ];

  return transferEventCodes.includes(eventCode);
}

function extractTransferMetadata(event: TransferNotificationEvent): any {
  const metadata: any = {
    transferId: null,
    direction: null,
    transactionId: null,
    amount: null,
    counterpartyInstrumentId: null,
  };

  if (event.balancePlatform?.transfer) {
    const transfer = event.balancePlatform.transfer;
    metadata.transferId = transfer.id;
    metadata.direction = transfer.direction;
    metadata.transactionId = transfer.transactionId;
    
    if (event.amount) {
      metadata.amount = {
        value: event.amount.value,
        currency: event.amount.currency,
      };
    }
    
    if (transfer.counterparty?.transferInstrumentId) {
      metadata.counterpartyInstrumentId = transfer.counterparty.transferInstrumentId;
    }
  }

  return metadata;
}

export const handler = async (event: EventBridgeEvent<any, any>): Promise<void> => {
  return AWSXRay.captureAsyncFunc('TransferNotificationHandler', async (subsegment) => {
    try {
      // Parse the event detail
      let webhookEvent: TransferNotificationEvent;
      try {
        // Handle both string and object formats for event detail
        if (typeof event.detail === 'string') {
          webhookEvent = JSON.parse(event.detail);
        } else if (typeof event.detail === 'object') {
          webhookEvent = event.detail as TransferNotificationEvent;
        } else {
          throw new Error('Invalid event detail format - expected string or object');
        }
      } catch (error) {
        console.error('Failed to parse event detail:', error);
        throw new Error('Invalid event detail format');
      }

      // Validate that this is actually a transfer event
      if (!isTransferEvent(webhookEvent.eventCode)) {
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

      // Extract transfer-specific metadata
      const transferMetadata = extractTransferMetadata(webhookEvent);

      // Extract relevant fields from webhook payload
      const businessName = webhookEvent.businessName || webhookEvent.data?.businessName;
      const countryCode = webhookEvent.countryCode || webhookEvent.data?.countryCode;
      const status = webhookEvent.status || webhookEvent.data?.status;

      // Insert the transfer event into the new optimized adyen_events table
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

      // Log successful processing with transfer-specific information
      console.log('Transfer notification processed successfully:', {
        eventId: adyenEvent.id,
        pspReference: webhookEvent.pspReference,
        eventCode: webhookEvent.eventCode,
        entityId,
        s3Key: webhookEvent.s3Key,
        success: webhookEvent.success,
        reason: webhookEvent.reason,
        transferId: transferMetadata.transferId,
        direction: transferMetadata.direction,
        transactionId: transferMetadata.transactionId,
        amount: transferMetadata.amount,
      });

      // Add subsegment annotations for transfer-specific observability
      subsegment?.addAnnotation('eventCode', webhookEvent.eventCode);
      subsegment?.addAnnotation('pspReference', webhookEvent.pspReference);
      subsegment?.addAnnotation('processor', 'TransferNotificationHandler');
      
      if (transferMetadata.transferId) {
        subsegment?.addAnnotation('transferId', transferMetadata.transferId);
      }

    } catch (error) {
      console.error('Error processing transfer notification:', error);
      
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