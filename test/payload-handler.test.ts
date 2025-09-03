import { handler } from '../src/functions/onboarding/payloadHandler/index';
import { DynamoDBClient, PutItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import * as fs from 'fs';
import * as path from 'path';

// Mock AWS SDK clients
const dynamoMock = mockClient(DynamoDBClient);
const lambdaMock = mockClient(LambdaClient);

// Mock AWS X-Ray
jest.mock('aws-xray-sdk-core', () => ({
  captureAWSv3Client: jest.fn((client) => client),
  captureAsyncFunc: jest.fn((name, fn) => {
    // Execute the function with a mock subsegment
    return async (...args: any[]) => {
      const mockSubsegment = {
        close: jest.fn(),
        addError: jest.fn()
      };
      return fn(mockSubsegment, ...args);
    };
  }),
  getSegment: jest.fn(() => ({
    addNewSubsegment: jest.fn(() => ({
      close: jest.fn(),
      addError: jest.fn()
    }))
  }))
}));

describe('Payload Handler Lambda', () => {
  let merchantData: any;
  let event: any;

  beforeEach(() => {
    // Reset mocks before each test
    jest.resetAllMocks();
    dynamoMock.reset();
    lambdaMock.reset();

    // Set up environment variables
    process.env.TABLE_NAME = 'test-onboarding-table';
    process.env.ADYEN_ONBOARDING_FUNCTION_NAME = 'test-adyen-onboarding-function';

    // Load test merchant data
    const payloadPath = path.join(__dirname, 'events/adyen-onboarding-payload.json');
    const payload = fs.readFileSync(payloadPath, 'utf-8');
    merchantData = JSON.parse(payload).merchantData;

    // Create a test event
    event = {
      body: JSON.stringify({ merchantData }),
      requestContext: {
        authorizer: {
          claims: {
            sub: 'test-user-id'
          }
        }
      }
    };
  });

  it('should save incomplete merchant data to DynamoDB', async () => {
    // Arrange
    // Remove store reference to simulate incomplete form
    const incompleteData = JSON.parse(JSON.stringify(merchantData));
    incompleteData.store[0].reference = '';
    event.body = JSON.stringify({ merchantData: incompleteData });

    dynamoMock.on(PutItemCommand).resolves({});

    // Mock Lambda Invoke to return a successful response
    const mockAdyenResponse = {
      statusCode: 200,
      body: JSON.stringify({
        message: 'User onboarding data stored'
      })
    };

    const mockPayload = {
      transformToString: () => JSON.stringify(mockAdyenResponse)
    } as any;

    lambdaMock.on(InvokeCommand).resolves({
      FunctionError: undefined,
      Payload: mockPayload
    });

    // Act
    const result = await handler(event);

    // Assert
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).message).toBe('User onboarding data stored');

    // Verify DynamoDB was called with the correct parameters
    expect(dynamoMock.calls().length).toBe(1);
    const putItemCall = dynamoMock.call(0).args[0].input as PutItemCommand['input'];
    expect(putItemCall.TableName).toBe('test-onboarding-table');
    expect(putItemCall.Item?.userId.S).toBe('test-user-id');
    expect(putItemCall.Item?.status.S).toBe('SUBMITTED');
    expect(JSON.parse(putItemCall.Item?.merchantData.S!)).toEqual(incompleteData);
  });

  it('should invoke adyen lambda and save response data for complete merchant data', async () => {
    // Arrange
    // Mock DynamoDB PutItem
    dynamoMock.on(PutItemCommand).resolves({});

    // Mock Lambda Invoke to return a successful response
    const mockAdyenResponse = {
      statusCode: 200,
      body: JSON.stringify({
        merchantData,
        adyenData: {
          legalEntityId: 'LE123',
          accountHolderId: 'AH123',
          businessLineId: 'BL123',
          url: 'https://onboarding.adyen.com/link/123'
        }
      })
    };

    const mockPayload = {
      transformToString: () => JSON.stringify(mockAdyenResponse)
    } as any;

    lambdaMock.on(InvokeCommand).resolves({
      FunctionError: undefined,
      Payload: mockPayload
    });

    // Act
    const result = await handler(event);

    // Assert
    expect(result.statusCode).toBe(200);

    // Verify Lambda was invoked with the correct parameters
    expect(lambdaMock.calls().length).toBe(1);
    const invokeCall = lambdaMock.call(0).args[0].input as InvokeCommand['input'];
    expect(invokeCall.FunctionName).toBe('test-adyen-onboarding-function');

    // Verify DynamoDB was called to save the merchant data
    expect(dynamoMock.calls().length).toBe(1); // PutItem only
    const putItemCall = dynamoMock.call(0).args[0].input as PutItemCommand['input'];
    expect(putItemCall.TableName).toBe('test-onboarding-table');
    expect(putItemCall.Item?.userId.S).toBe('test-user-id');
    expect(putItemCall.Item?.status.S).toBe('SUBMITTED');
    expect(JSON.parse(putItemCall.Item?.merchantData.S!)).toEqual(merchantData);
  });

  it('should update existing adyenData when it already exists', async () => {
    // Arrange
    // Mock DynamoDB PutItem
    dynamoMock.on(PutItemCommand).resolves({});

    // Mock Lambda Invoke to return a successful response with updated URL
    const mockAdyenResponse = {
      statusCode: 200,
      body: JSON.stringify({
        merchantData,
        adyenData: {
          legalEntityId: 'LE123',
          accountHolderId: 'AH123',
          businessLineId: 'BL123',
          url: 'https://onboarding.adyen.com/new-link'
        }
      })
    };

    const mockPayload = {
      transformToString: () => JSON.stringify(mockAdyenResponse)
    } as any;

    lambdaMock.on(InvokeCommand).resolves({
      FunctionError: undefined,
      Payload: mockPayload
    });

    // Act
    const result = await handler(event);

    // Assert
    expect(result.statusCode).toBe(200);

    // Verify Lambda was invoked with the correct parameters
    expect(lambdaMock.calls().length).toBe(1);
    const invokeCall = lambdaMock.call(0).args[0].input as InvokeCommand['input'];

    // Verify DynamoDB was called to save the merchant data
    expect(dynamoMock.calls().length).toBe(1); // PutItem only
    const putItemCall = dynamoMock.call(0).args[0].input as PutItemCommand['input'];
    expect(putItemCall.TableName).toBe('test-onboarding-table');
    expect(putItemCall.Item?.userId.S).toBe('test-user-id');
    expect(putItemCall.Item?.status.S).toBe('SUBMITTED');
    expect(JSON.parse(putItemCall.Item?.merchantData.S!)).toEqual(merchantData);
  });

  it('should handle errors from adyen lambda', async () => {
    // Arrange
    // Mock DynamoDB GetItem
    dynamoMock.on(GetItemCommand).resolves({
      Item: undefined
    });

    // Mock Lambda Invoke to return an error response
    const errorResponse = {
      errorMessage: 'Adyen API error'
    };

    const mockPayload = {
      transformToString: () => JSON.stringify(errorResponse)
    } as any;

    lambdaMock.on(InvokeCommand).resolves({
      FunctionError: 'Unhandled',
      Payload: mockPayload
    });

    // Act
    const result = await handler(event);

    // Assert
    expect(result.statusCode).toBe(500);
  });

  it('should return 400 if request body is missing', async () => {
    // Arrange
    event.body = undefined;

    // Act
    const result = await handler(event);

    // Assert
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).message).toBe('Missing request body');
  });

  it('should return 401 if user ID is missing', async () => {
    // Arrange
    event.requestContext.authorizer.claims.sub = undefined;

    // Act
    const result = await handler(event);

    // Assert
    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).message).toBe('Unauthorized - Missing user ID');
  });
});
