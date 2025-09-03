import { handler as standardHandler } from '../src/functions/onboarding/standardNotificationHandler/index';
import { handler as kycHandler } from '../src/functions/onboarding/kycNotificationHandler/index';
import { handler as transferHandler } from '../src/functions/onboarding/transferNotificationHandler/index';

// Mock AWS X-Ray
jest.mock('aws-xray-sdk-core', () => ({
  captureAsyncFunc: jest.fn((name, fn) => fn()),
}));

// Mock the database helper
jest.mock('../src/functions/shared/database-helpers', () => ({
  DatabaseHelper: jest.fn().mockImplementation(() => ({
    checkDuplicateEvent: jest.fn().mockResolvedValue(false),
    insertAdyenEvent: jest.fn().mockResolvedValue({
      id: 1,
      event_id: 'test-webhook-id',
      event_type: 'ACCOUNT_HOLDER_STATUS_CHANGE',
      entity_type: 'account_holder',
      entity_id: 'test-merchant-reference',
      psp_reference: 'test-psp-reference',
      s3_key: 'test-s3-key',
      processed_at: new Date(),
      webhook_received_at: new Date(),
    }),
    closeClient: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe('Webhook Processors', () => {
  const mockEventBridgeEvent = {
    version: '0',
    id: 'test-event-id',
    'detail-type': 'adyen.webhook',
    source: 'adyen.webhook',
    account: '123456789012',
    time: '2024-01-01T00:00:00Z',
    region: 'us-east-1',
    resources: [],
    detail: JSON.stringify({
      eventCode: 'ACCOUNT_HOLDER_STATUS_CHANGE',
      pspReference: 'test-psp-reference',
      merchantReference: 'test-merchant-reference',
      notificationType: 'standard',
      merchantAccountCode: 'TestMerchantAccount',
      live: 'false',
      success: 'true',
      eventDate: '2024-01-01T00:00:00Z',
      webhookId: 'test-webhook-id',
      timestamp: '2024-01-01T00:00:00Z',
      s3Key: 'test-s3-key',
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('StandardNotificationHandler', () => {
    it('should process standard notification events', async () => {
      const result = await standardHandler(mockEventBridgeEvent);
      
      // Verify the handler completes without throwing
      expect(result).toBeUndefined();
    });

    it('should handle events with failed status', async () => {
      const failedEvent = {
        ...mockEventBridgeEvent,
        detail: JSON.stringify({
          ...JSON.parse(mockEventBridgeEvent.detail),
          success: 'false',
        }),
      };

      const result = await standardHandler(failedEvent);
      expect(result).toBeUndefined();
    });
  });

  describe('KycNotificationHandler', () => {
    it('should process KYC notification events', async () => {
      const kycEvent = {
        ...mockEventBridgeEvent,
        detail: JSON.stringify({
          ...JSON.parse(mockEventBridgeEvent.detail),
          eventCode: 'ACCOUNT_HOLDER_VERIFICATION',
          notificationType: 'kyc',
        }),
      };

      const result = await kycHandler(kycEvent);
      expect(result).toBeUndefined();
    });

    it('should skip non-KYC events', async () => {
      const nonKycEvent = {
        ...mockEventBridgeEvent,
        detail: JSON.stringify({
          ...JSON.parse(mockEventBridgeEvent.detail),
          eventCode: 'PAYMENT_RECEIVED',
          notificationType: 'standard',
        }),
      };

      const result = await kycHandler(nonKycEvent);
      expect(result).toBeUndefined();
    });
  });

  describe('TransferNotificationHandler', () => {
    it('should process transfer notification events', async () => {
      const transferEvent = {
        ...mockEventBridgeEvent,
        detail: JSON.stringify({
          ...JSON.parse(mockEventBridgeEvent.detail),
          eventCode: 'TRANSFER_FUNDS',
          notificationType: 'transfer',
          balancePlatform: {
            transfer: {
              id: 'transfer-id',
              direction: 'outbound',
              status: 'completed',
              transactionId: 'txn-id',
            },
          },
        }),
      };

      const result = await transferHandler(transferEvent);
      expect(result).toBeUndefined();
    });

    it('should skip non-transfer events', async () => {
      const nonTransferEvent = {
        ...mockEventBridgeEvent,
        detail: JSON.stringify({
          ...JSON.parse(mockEventBridgeEvent.detail),
          eventCode: 'PAYMENT_RECEIVED',
          notificationType: 'standard',
        }),
      };

      const result = await transferHandler(nonTransferEvent);
      expect(result).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors', async () => {
      // Reset modules to ensure fresh imports
      jest.resetModules();
      
      // Re-mock with error scenario
      jest.mock('../src/functions/shared/database-helpers', () => ({
        DatabaseHelper: jest.fn().mockImplementation(() => ({
          checkDuplicateEvent: jest.fn().mockRejectedValue(new Error('Database connection failed')),
          closeClient: jest.fn().mockResolvedValue(undefined),
        })),
      }));
      
      // Re-import the handler after setting up the error mock
      const { handler: errorStandardHandler } = require('../src/functions/onboarding/standardNotificationHandler/index');

      await expect(errorStandardHandler(mockEventBridgeEvent)).rejects.toThrow('Database connection failed');
    });

    it('should handle invalid event detail format', async () => {
      const invalidEvent = {
        ...mockEventBridgeEvent,
        detail: 'invalid-json',
      };

      await expect(standardHandler(invalidEvent)).rejects.toThrow('Invalid event detail format');
    });
  });
}); 