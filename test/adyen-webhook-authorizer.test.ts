import { handler } from '../src/functions/onboarding/adyenWebhookAuthorizer/index';

// Mock AWS SDK clients
jest.mock('@aws-sdk/client-secrets-manager');
jest.mock('aws-xray-sdk-core');

describe('Adyen Webhook Authorizer', () => {
  const mockSecretsManager = {
    send: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock environment variables
    process.env.ADYEN_WEBHOOK_BASIC_AUTH_SECRET_NAME = 'test-basic-auth-secret';
    process.env.NODE_ENV = 'test';

    // Mock AWS SDK
    const { SecretsManagerClient } = require('@aws-sdk/client-secrets-manager');
    SecretsManagerClient.mockImplementation(() => mockSecretsManager);
  });

  const createBasicAuthHeader = (username: string, password: string): string => {
    const credentials = Buffer.from(`${username}:${password}`).toString('base64');
    return `Basic ${credentials}`;
  };

  it('should authorize valid Basic Auth credentials', async () => {
    const username = 'webhook-user';
    const password = 'webhook-password';
    const authHeader = createBasicAuthHeader(username, password);

    // Mock Secrets Manager response
    mockSecretsManager.send.mockResolvedValue({
      SecretString: JSON.stringify({ username, password })
    });

    const event = {
      type: 'TOKEN' as const,
      authorizationToken: authHeader,
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:abc123/test/POST/adyen/webhook'
    };

    const result = await handler(event);

    expect(result.principalId).toBe(username);
    expect(result.policyDocument.Version).toBe('2012-10-17');
    expect(result.policyDocument.Statement).toHaveLength(1);
    expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
    expect((result.policyDocument.Statement[0] as any).Action).toBe('execute-api:Invoke');
    expect((result.policyDocument.Statement[0] as any).Resource).toBe(event.methodArn);
  });

  it('should deny invalid Basic Auth credentials', async () => {
    const username = 'webhook-user';
    const password = 'webhook-password';
    const authHeader = createBasicAuthHeader(username, 'wrong-password');

    // Mock Secrets Manager response with correct credentials
    mockSecretsManager.send.mockResolvedValue({
      SecretString: JSON.stringify({ username, password })
    });

    const event = {
      type: 'TOKEN' as const,
      authorizationToken: authHeader,
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:abc123/test/POST/adyen/webhook'
    };

    const result = await handler(event);

    expect(result.principalId).toBe('unauthorized');
    expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
  });

  it('should deny missing Authorization header', async () => {
    const event = {
      type: 'TOKEN' as const,
      authorizationToken: '',
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:abc123/test/POST/adyen/webhook'
    };

    const result = await handler(event);

    expect(result.principalId).toBe('unauthorized');
    expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
  });

  it('should deny invalid Basic Auth format', async () => {
    const event = {
      type: 'TOKEN' as const,
      authorizationToken: 'InvalidFormat',
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:abc123/test/POST/adyen/webhook'
    };

    const result = await handler(event);

    expect(result.principalId).toBe('unauthorized');
    expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
  });

  it('should deny malformed Basic Auth header', async () => {
    const event = {
      type: 'TOKEN' as const,
      authorizationToken: 'Basic invalid-base64',
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:abc123/test/POST/adyen/webhook'
    };

    const result = await handler(event);

    expect(result.principalId).toBe('unauthorized');
    expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
  });

  it('should deny Basic Auth without colon separator', async () => {
    const credentials = Buffer.from('usernameonly').toString('base64');
    const authHeader = `Basic ${credentials}`;

    const event = {
      type: 'TOKEN' as const,
      authorizationToken: authHeader,
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:abc123/test/POST/adyen/webhook'
    };

    const result = await handler(event);

    expect(result.principalId).toBe('unauthorized');
    expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
  });

  it('should handle Secrets Manager errors gracefully', async () => {
    const username = 'webhook-user';
    const password = 'webhook-password';
    const authHeader = createBasicAuthHeader(username, password);

    // Mock Secrets Manager error
    mockSecretsManager.send.mockRejectedValue(new Error('Secret not found'));

    const event = {
      type: 'TOKEN' as const,
      authorizationToken: authHeader,
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:abc123/test/POST/adyen/webhook'
    };

    const result = await handler(event);

    expect(result.principalId).toBe('unauthorized');
    expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
  });

  it('should handle malformed secret data', async () => {
    const username = 'webhook-user';
    const password = 'webhook-password';
    const authHeader = createBasicAuthHeader(username, password);

    // Mock Secrets Manager response with malformed data
    mockSecretsManager.send.mockResolvedValue({
      SecretString: 'invalid-json'
    });

    const event = {
      type: 'TOKEN' as const,
      authorizationToken: authHeader,
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:abc123/test/POST/adyen/webhook'
    };

    const result = await handler(event);

    expect(result.principalId).toBe('unauthorized');
    expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
  });

  it('should handle missing username or password in secret', async () => {
    const username = 'webhook-user';
    const password = 'webhook-password';
    const authHeader = createBasicAuthHeader(username, password);

    // Mock Secrets Manager response with missing fields
    mockSecretsManager.send.mockResolvedValue({
      SecretString: JSON.stringify({ username }) // Missing password
    });

    const event = {
      type: 'TOKEN' as const,
      authorizationToken: authHeader,
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:abc123/test/POST/adyen/webhook'
    };

    const result = await handler(event);

    expect(result.principalId).toBe('unauthorized');
    expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
  });
}); 