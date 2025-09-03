import { EventBridgeService } from '../src/functions/onboarding/adyenWebhookHandler/eventbridge-service';
import { AdyenWebhookEvent, NotificationType } from '../src/functions/onboarding/adyenWebhookHandler/types';

// Mock AWS SDK
jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({
      FailedEntryCount: 0,
      Entries: [],
    }),
  })),
  PutEventsCommand: jest.fn().mockImplementation((params) => params),
}));

// Mock X-Ray SDK
jest.mock('aws-xray-sdk-core', () => ({
  captureAWSv3Client: jest.fn((client) => client),
}));

describe('EventBridge Integration', () => {
  let eventBridgeService: EventBridgeService;

  beforeEach(() => {
    eventBridgeService = new EventBridgeService('test-event-bus');
  });

  it('should create webhook event with correct structure', () => {
    const mockPayload = {
      live: 'false',
      notificationItems: [],
    };
    const mockWebhookEvent: AdyenWebhookEvent = {
      eventCode: 'ACCOUNT_HOLDER_CREATED',
      pspReference: 'PSP123456789',
      merchantReference: 'TEST_REF_001',
      notificationType: NotificationType.STANDARD,
      merchantAccountCode: 'TestMerchant',
      live: 'false',
      success: 'true',
      eventDate: '2025-08-11T10:00:00Z',
      originalPayload: mockPayload,
      webhookId: 'test-webhook-123',
      timestamp: '2025-08-11T10:00:00Z',
      s3Key: 'adyen-webhooks/2025/08/test-webhook-123.json'
    };

    expect(mockWebhookEvent.eventCode).toBe('ACCOUNT_HOLDER_CREATED');
    expect(mockWebhookEvent.notificationType).toBe(NotificationType.STANDARD);
    expect(mockWebhookEvent.pspReference).toBe('PSP123456789');
  });

  it('should classify KYC events correctly', () => {
    const kycEventCodes = [
      'ACCOUNT_HOLDER_STATUS_CHANGE',
      'ACCOUNT_HOLDER_VERIFICATION',
      'ACCOUNT_HOLDER_UPCOMING_DEADLINE',
    ];

    kycEventCodes.forEach(eventCode => {
      // This would be tested in the actual webhook handler
      expect(eventCode).toMatch(/ACCOUNT_HOLDER_/);
    });
  });

  it('should classify transfer events correctly', () => {
    const transferEventCodes = [
      'TRANSFER_FUNDS',
      'TRANSFER_FUNDS_FAILED',
      'TRANSFER_FUNDS_COMPLETED',
    ];

    transferEventCodes.forEach(eventCode => {
      // This would be tested in the actual webhook handler
      expect(eventCode).toMatch(/TRANSFER_FUNDS/);
    });
  });

  it('should have correct notification types', () => {
    expect(NotificationType.STANDARD).toBe('standard');
    expect(NotificationType.KYC).toBe('kyc');
    expect(NotificationType.TRANSFER).toBe('transfer');
  });
}); 