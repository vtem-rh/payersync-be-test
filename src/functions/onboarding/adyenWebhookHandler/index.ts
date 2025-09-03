import { APIGatewayProxyResult } from 'aws-lambda';
import { captureAWSv3Client } from 'aws-xray-sdk-core';
import * as AWSXRay from 'aws-xray-sdk-core';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { createHmac } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { EventBridgeService } from './eventbridge-service';
import { 
  NotificationRequestItem, 
  AdyenWebhookPayload, 
  WebhookLogData, 
  AdyenWebhookEvent,
  NotificationType 
} from './types';

// Configure X-Ray group for webhook traces
const xrayGroupName = process.env.AWS_XRAY_GROUP_NAME || 'webhooks';

const s3Client = captureAWSv3Client(new S3Client({}));
const secretsManager = captureAWSv3Client(new SecretsManagerClient({}));

// Initialize EventBridge service
const eventBusName = process.env.EVENT_BUS_NAME || 'adyen-webhook-bus';
const eventBridgeService = new EventBridgeService(eventBusName);

async function getHmacSecret(): Promise<string> {
  const secretName = process.env.ADYEN_HMAC_SECRET_NAME;
  
  if (!secretName) {
    throw new Error('ADYEN_HMAC_SECRET_NAME environment variable is not set');
  }

  const command = new GetSecretValueCommand({ SecretId: secretName });
  const result = await secretsManager.send(command);
  
  if (!result.SecretString) {
    throw new Error(`HMAC secret not found: ${secretName}`);
  }
  
  const secretData = JSON.parse(result.SecretString);
  return secretData.hmacSecret;
}

function validateHmacSignature(notificationItem: NotificationRequestItem, signature: string, secret: string): boolean {
  // Construct the payload string according to Adyen documentation
  // Format: pspReference:originalReference:merchantAccountCode:merchantReference:value:currency:eventCode:success
  
  // Handle optional amount field
  const amountValue = notificationItem.amount?.value?.toString() || '0';
  const amountCurrency = notificationItem.amount?.currency || 'USD';
  
  const payloadString = [
    notificationItem.pspReference,
    '', // originalReference (empty for most webhooks)
    notificationItem.merchantAccountCode,
    notificationItem.merchantReference || '',
    amountValue,
    amountCurrency,
    notificationItem.eventCode,
    notificationItem.success || 'true'
  ].join(':');
  
  // Convert HMAC secret from hex to binary as required by Adyen
  const secretBinary = Buffer.from(secret, 'hex');
  
  // Calculate HMAC using SHA256
  const expectedSignature = createHmac('sha256', secretBinary)
    .update(payloadString, 'utf8')
    .digest('base64');
  
  return expectedSignature === signature;
}

async function storeWebhookToS3(payload: string, webhookId: string): Promise<string> {
  const bucketName = process.env.WEBHOOK_S3_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('WEBHOOK_S3_BUCKET_NAME environment variable is not set');
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  
  const key = `adyen-webhooks/${year}/${month}/${webhookId}.json`;
  
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: payload,
    ContentType: 'application/json',
  });
  
  await s3Client.send(command);
  return key;
}

function logWebhookData(webhookData: WebhookLogData): void {
  // Production logging - structured and minimal
  console.log(JSON.stringify({
    level: 'INFO',
    message: 'Webhook data processed',
    eventCode: webhookData.eventCode,
    pspReference: webhookData.pspReference,
    merchantAccountCode: webhookData.merchantAccountCode,
    notificationType: webhookData.notificationType,
    live: webhookData.live,
    timestamp: webhookData.timestamp,
    webhookId: webhookData.webhookId,
  }));
}

function determineNotificationType(eventCode: string): NotificationType {
  // KYC-related event codes
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

  // Transfer-related event codes
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

  // Balance platform event codes
  const balancePlatformEventCodes = [
    'balancePlatform.accountHolder.updated',
    'balancePlatform.accountHolder.created',
    'balancePlatform.accountHolder.verification',
    'balancePlatform.account.updated',
    'balancePlatform.account.created',
    'balancePlatform.legalEntity.updated',
    'balancePlatform.legalEntity.created',
    'balancePlatform.transfer.updated',
    'balancePlatform.transfer.created',
    'balancePlatform.transfer.failed',
    'balancePlatform.transfer.completed',
  ];

  if (kycEventCodes.includes(eventCode)) {
    return NotificationType.KYC;
  }

  if (transferEventCodes.includes(eventCode)) {
    return NotificationType.TRANSFER;
  }

  if (balancePlatformEventCodes.includes(eventCode)) {
    return NotificationType.BALANCE_PLATFORM;
  }

  return NotificationType.STANDARD;
}

function createWebhookEvent(
  notificationItem: NotificationRequestItem, 
  payload: AdyenWebhookPayload, 
  webhookId: string,
  s3Key: string
): AdyenWebhookEvent {
  const eventCode = notificationItem.eventCode || notificationItem.type || 'unknown';
  const notificationType = determineNotificationType(eventCode);
  
  // Extract fields from the actual Adyen payload structure
  const pspReference = notificationItem.pspReference || notificationItem.data?.id || notificationItem.id || 'unknown';
  const merchantAccountCode = notificationItem.merchantAccountCode || notificationItem.data?.balancePlatform || 'unknown';
  const merchantReference = notificationItem.merchantReference || notificationItem.data?.accountHolder?.id || 'unknown';
  const live = payload.live || payload.environment === 'live' ? 'true' : 'false';
  const success = notificationItem.success || 'true';
  const eventDate = notificationItem.eventDate || notificationItem.timestamp || new Date().toISOString();
  
  const event: AdyenWebhookEvent = {
    eventCode: eventCode,
    pspReference: pspReference,
    merchantReference: merchantReference,
    notificationType,
    merchantAccountCode: merchantAccountCode,
    live: live,
    success: success,
    amount: notificationItem.amount,
    eventDate: eventDate,
    reason: notificationItem.reason,
    paymentMethod: notificationItem.paymentMethod,
    operations: notificationItem.operations,
    // KYC specific fields
    accountHolderCode: notificationItem.accountHolderCode || notificationItem.data?.accountHolder?.id,
    accountHolderId: notificationItem.accountHolderId || notificationItem.data?.accountHolder?.id,
    accountHolderStatus: notificationItem.accountHolderStatus || notificationItem.data?.accountHolder?.status,
    verificationStatus: notificationItem.verificationStatus,
    verificationType: notificationItem.verificationType,
    originalPayload: payload,
    webhookId,
    timestamp: new Date().toISOString(),
    s3Key,
  };

  return event;
}

export const handler = async (event: any): Promise<APIGatewayProxyResult> => {
  return AWSXRay.captureAsyncFunc('AdyenWebhookHandler', async (subsegment) => {
    try {
      if (!event.body) {
        console.error('ERROR: Missing request body');
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message: 'Missing request body' }),
        };
      }

      let payload: any;
      try {
        payload = JSON.parse(event.body);
      } catch (error) {
        console.error('ERROR: Invalid JSON payload:', error);
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message: 'Invalid webhook payload structure' }),
        };
      }

      // Check for different possible Adyen payload structures
      let notificationItems: any[] = [];
      
      if (payload.notificationItems && Array.isArray(payload.notificationItems)) {
        notificationItems = payload.notificationItems;
      } else if (payload.notifications && Array.isArray(payload.notifications)) {
        notificationItems = payload.notifications;
      } else if (payload.items && Array.isArray(payload.items)) {
        notificationItems = payload.items;
      } else if (Array.isArray(payload)) {
        notificationItems = payload;
      } else if (payload.NotificationRequestItem) {
        notificationItems = [{ NotificationRequestItem: payload.NotificationRequestItem }];
      } else if (payload.notification) {
        notificationItems = [{ notification: payload.notification }];
      } else if (payload.item) {
        notificationItems = [{ item: payload.item }];
      } else {
        // If none of the above, try to treat the entire payload as a notification
        notificationItems = [payload];
      }

      if (notificationItems.length === 0) {
        console.error('ERROR: No valid notification items found in payload');
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message: 'No valid notification items found in payload' }),
        };
      }

      // Process each notification item with enhanced logging
      const errors: string[] = [];
      const webhookId = uuidv4();
      const webhookEvents: AdyenWebhookEvent[] = [];

      for (let i = 0; i < notificationItems.length; i++) {
        const item = notificationItems[i];
        
        // Try different possible structures for the notification item
        let notificationItem: NotificationRequestItem;

        if (item.NotificationRequestItem) {
          notificationItem = item.NotificationRequestItem;
        } else if (item.notification) {
          notificationItem = item.notification;
        } else if (item.item) {
          notificationItem = item.item;
        } else if (item.pspReference || item.eventCode) {
          // If the item itself has webhook fields, use it directly
          notificationItem = item;
        } else {
          notificationItem = item;
        }

        // Validate that we have the minimum required fields
        if (!notificationItem.pspReference && !notificationItem.data?.id && !notificationItem.id) {
          console.error('ERROR: Notification item missing required fields (pspReference, eventCode, type, or data.id)');
          errors.push(`Notification item ${i + 1} missing required fields`);
          continue;
        }

        // Extract the required fields from the actual Adyen payload structure
        const eventCode = notificationItem.eventCode || notificationItem.type || 'unknown';
        const pspReference = notificationItem.pspReference || notificationItem.data?.id || notificationItem.id || 'unknown';
        const merchantAccountCode = notificationItem.merchantAccountCode || notificationItem.data?.balancePlatform || 'unknown';
        const merchantReference = notificationItem.merchantReference || notificationItem.data?.accountHolder?.id || 'unknown';

        try {
          // Get HMAC secret
          const hmacSecret = await getHmacSecret();

          // Validate HMAC signature (skip for Balance Platform webhooks)
          const signature = notificationItem.additionalData?.hmacSignature;
          const isBalancePlatformWebhook = notificationItem.type?.startsWith('balancePlatform.') || 
                                         (notificationItem.data as any)?.type?.startsWith('balancePlatform.');
          

          
          if (!signature && !isBalancePlatformWebhook) {
            errors.push(`Missing HMAC signature for PSP reference: ${pspReference}`);
            continue;
          } else if (signature && !isBalancePlatformWebhook) {
            const isValid = validateHmacSignature(notificationItem, signature, hmacSecret);
            if (!isValid) {
              errors.push(`Invalid HMAC signature for PSP reference: ${pspReference}`);
              continue;
            }
          }

          // Log structured data
          const logData: WebhookLogData = {
            eventCode: eventCode,
            pspReference: pspReference,
            merchantAccountCode: merchantAccountCode,
            notificationType: 'adyen',
            live: payload.live,
            timestamp: new Date().toISOString(),
            webhookId,
          };
          logWebhookData(logData);

          // Store raw webhook to S3
          const s3Key = await storeWebhookToS3(event.body, webhookId);

          // Create webhook event for EventBridge with S3 key
          const webhookEvent = createWebhookEvent(notificationItem, payload, webhookId, s3Key);
          webhookEvents.push(webhookEvent);

        } catch (error) {
          console.error('Error processing notification item:', error);
          errors.push(`Error processing PSP reference ${pspReference}: ${error}`);
        }
      }

      if (errors.length > 0) {
        console.error('Webhook validation errors:', errors);
        return {
          statusCode: 401,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            message: 'Webhook validation failed',
            errors 
          }),
        };
      }

      // Emit events to EventBridge
      if (webhookEvents.length > 0) {
        try {
          await eventBridgeService.emitMultipleWebhookEvents(webhookEvents);
        } catch (error) {
          console.error('Error emitting events to EventBridge:', error);
          // Don't fail the webhook if EventBridge emission fails
          // The webhook was still processed and stored in S3
        }
      }

      return {
        statusCode: 202,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: 'Accepted' }),
      };

    } catch (error) {
      console.error('Unexpected error:', error);
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: 'Internal server error' }),
      };
    }
  });
}; 