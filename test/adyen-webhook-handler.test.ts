import { handler } from '../src/functions/onboarding/adyenWebhookHandler/index';
import { createHmac } from 'crypto';

// Mock AWS SDK clients
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({
    send: jest.fn(),
  })),
  PutObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => ({
    send: jest.fn(),
  })),
  GetSecretValueCommand: jest.fn(),
}));

jest.mock('aws-xray-sdk-core', () => ({
  captureAWSv3Client: jest.fn((client) => client),
}));

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-12345'),
}));

describe('Adyen Webhook Handler', () => {
  let mockS3Client: any;
  let mockSecretsManager: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock environment variables
    process.env.ADYEN_HMAC_SECRET_NAME = 'test-hmac-secret';
    process.env.WEBHOOK_S3_BUCKET_NAME = 'test-webhook-bucket';
    process.env.NODE_ENV = 'test';

    // Get mocked clients
    const { S3Client } = require('@aws-sdk/client-s3');
    const { SecretsManagerClient } = require('@aws-sdk/client-secrets-manager');
    
    mockS3Client = new S3Client();
    mockSecretsManager = new SecretsManagerClient();
  });

  const createTestWebhookPayload = (isLive: boolean = false, hmacSecret: string = 'test-secret') => {
    const payload = {
      live: isLive.toString(),
      notificationItems: [
        {
          NotificationRequestItem: {
            additionalData: {
              hmacSignature: '',
              'recurring.recurringDetailReference': '123',
              'recurring.shopperReference': 'xyz'
            },
            amount: { currency: 'EUR', value: 1000 },
            eventCode: 'AUTHORISATION',
            eventDate: '2022-12-01T01:00:00+01:00',
            merchantAccountCode: 'YOUR_MERCHANT_ACCOUNT',
            merchantReference: 'YOUR_MERCHANT_REFERENCE',
            paymentMethod: 'ach',
            pspReference: 'YOUR_PSP_REFERENCE',
            operations: [],
            success: 'true'
          }
        }
      ]
    };

    const payloadString = JSON.stringify(payload);
    const hmacSignature = createHmac('sha256', hmacSecret)
      .update(payloadString, 'utf8')
      .digest('base64');

    payload.notificationItems[0].NotificationRequestItem.additionalData.hmacSignature = hmacSignature;

    return {
      payload,
      payloadString: JSON.stringify(payload),
      hmacSignature
    };
  };

  it('should successfully process a valid webhook', async () => {
    const { payload, payloadString } = createTestWebhookPayload(false, 'test-secret');

    // Mock Secrets Manager response
    mockSecretsManager.send.mockResolvedValue({
      SecretString: JSON.stringify({ hmacSecret: 'test-secret' })
    });

    // Mock S3 response
    mockS3Client.send.mockResolvedValue({});

    const event = {
      body: payloadString
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(202);
    expect(JSON.parse(result.body)).toEqual({ message: 'Accepted' });
    expect(mockSecretsManager.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { SecretId: 'test-hmac-secret' }
      })
    );
    expect(mockS3Client.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          Bucket: 'test-webhook-bucket',
          Key: expect.stringMatching(/adyen-webhooks\/\d{4}\/\d{2}\/\d{2}\/test-uuid-12345\.json/),
          Body: payloadString,
          ContentType: 'application/json'
        }
      })
    );
  });

  it('should reject webhook with invalid HMAC signature', async () => {
    const { payload } = createTestWebhookPayload(false, 'test-secret');
    
    // Use wrong secret for validation
    payload.notificationItems[0].NotificationRequestItem.additionalData.hmacSignature = 'invalid-signature';

    // Mock Secrets Manager response with correct secret
    mockSecretsManager.send.mockResolvedValue({
      SecretString: JSON.stringify({ hmacSecret: 'test-secret' })
    });

    const event = {
      body: JSON.stringify(payload)
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body)).toEqual({
      message: 'Webhook validation failed',
      errors: expect.arrayContaining([
        expect.stringContaining('Invalid HMAC signature')
      ])
    });
  });

  it('should handle missing request body', async () => {
    const event = {};

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      message: 'Missing request body'
    });
  });

  it('should handle invalid JSON payload', async () => {
    const event = {
      body: 'invalid-json'
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      message: 'Invalid webhook payload structure'
    });
  });

  it('should handle missing HMAC signature', async () => {
    const payload = {
      live: 'false',
      notificationItems: [
        {
          NotificationRequestItem: {
            additionalData: {},
            amount: { currency: 'EUR', value: 1000 },
            eventCode: 'AUTHORISATION',
            eventDate: '2022-12-01T01:00:00+01:00',
            merchantAccountCode: 'YOUR_MERCHANT_ACCOUNT',
            merchantReference: 'YOUR_MERCHANT_REFERENCE',
            paymentMethod: 'ach',
            pspReference: 'YOUR_PSP_REFERENCE',
            operations: [],
            success: 'true'
          }
        }
      ]
    };

    const event = {
      body: JSON.stringify(payload)
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body)).toEqual({
      message: 'Webhook validation failed',
      errors: expect.arrayContaining([
        'Missing HMAC signature'
      ])
    });
  });

  it('should handle live webhook with live HMAC secret', async () => {
    const { payload, payloadString } = createTestWebhookPayload(true, 'live-secret');

    // Mock Secrets Manager response for live secret
    mockSecretsManager.send.mockResolvedValue({
      SecretString: JSON.stringify({ hmacSecret: 'live-secret' })
    });

    // Mock S3 response
    mockS3Client.send.mockResolvedValue({});

    const event = {
      body: payloadString
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(202);
    expect(mockSecretsManager.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { SecretId: 'test-hmac-secret' }
      })
    );
  });

  it('should continue processing even if S3 storage fails', async () => {
    const { payload, payloadString } = createTestWebhookPayload(false, 'test-secret');

    // Mock Secrets Manager response
    mockSecretsManager.send.mockResolvedValue({
      SecretString: JSON.stringify({ hmacSecret: 'test-secret' })
    });

    // Mock S3 failure
    mockS3Client.send.mockRejectedValue(new Error('S3 error'));

    const event = {
      body: payloadString
    };

    const result = await handler(event);

    // Should still return 202 even if S3 fails
    expect(result.statusCode).toBe(202);
  });

  it('should handle multiple notification items', async () => {
    const { payload, payloadString } = createTestWebhookPayload(false, 'test-secret');
    
    // Add a second notification item
    payload.notificationItems.push({
      NotificationRequestItem: {
        additionalData: {
          hmacSignature: createHmac('sha256', 'test-secret')
            .update(payloadString, 'utf8')
            .digest('base64'),
          'recurring.recurringDetailReference': '456',
          'recurring.shopperReference': 'abc'
        },
        amount: { currency: 'USD', value: 2000 },
        eventCode: 'CAPTURE',
        eventDate: '2022-12-01T02:00:00+01:00',
        merchantAccountCode: 'YOUR_MERCHANT_ACCOUNT',
        merchantReference: 'YOUR_MERCHANT_REFERENCE_2',
        paymentMethod: 'card',
        pspReference: 'YOUR_PSP_REFERENCE_2',
        operations: [],
        success: 'true'
      }
    });

    // Mock Secrets Manager response
    mockSecretsManager.send.mockResolvedValue({
      SecretString: JSON.stringify({ hmacSecret: 'test-secret' })
    });

    // Mock S3 response
    mockS3Client.send.mockResolvedValue({});

    const event = {
      body: JSON.stringify(payload)
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(202);
  });
}); 