import { handler } from '../src/functions/onboarding/adyenOnboarding/handler';
import * as AdyenApi from '../src/functions/onboarding/adyenOnboarding/adyen-api';
import * as fs from 'fs';
import * as path from 'path';

// Mock the Adyen API module
jest.mock('../src/functions/onboarding/adyenOnboarding/adyen-api');

const mockedAdyenApi = AdyenApi as jest.Mocked<typeof AdyenApi>;

describe('Adyen Onboarding Handler', () => {
  let merchantData: any;

  beforeEach(() => {
    // Reset mocks before each test
    jest.resetAllMocks();
    const payloadPath = path.join(__dirname, 'events/adyen-onboarding-payload.json');
    const payload = fs.readFileSync(payloadPath, 'utf-8');
    merchantData = JSON.parse(payload).merchantData;
    process.env.ADYEN_MERCHANT_ACCOUNT = 'RectangleHealthCOM';

    // Mock the return values of the Adyen API functions
    mockedAdyenApi.createLegalEntity.mockResolvedValue({ id: 'LE123' });
    mockedAdyenApi.createAccountHolder.mockResolvedValue({ id: 'AH123' });
    mockedAdyenApi.createBalanceAccount.mockResolvedValue({ id: 'BA123' });
    mockedAdyenApi.createBusinessLine.mockResolvedValue({ id: 'BL123' });
    mockedAdyenApi.createStore.mockResolvedValue({ id: 'ST123' });
    mockedAdyenApi.createOnboardingLink.mockResolvedValue({ url: 'https://onboarding.adyen.com/link/123' });

    mockedAdyenApi.createAdyenApiClients.mockReturnValue({
      lem: 'mockedLemClient',
      bp: 'mockedBpClient',
      psp: 'mockedPspClient',
    } as any);
  });

  it('should return 400 if payload is missing', async () => {
    // Arrange
    const event = {};

    // Act
    const result = await handler(event);

    // Assert
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).message).toBe('Missing request body');
  });

  it('should return 400 if payload is invalid', async () => {
    // Arrange
    const event = {
      body: JSON.stringify({ merchantData: {} }), // Invalid payload
    };

    // Act
    const result = await handler(event);

    // Assert
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).message).toContain("Validation failed: Missing required field 'legalEntity' in merchantData");
  });

  it('should only get a fresh onboarding URL when adyenData already exists', async () => {
    // Arrange
    const existingAdyenData = {
      legalEntityId: 'LE123',
      accountHolderId: 'AH123',
      businessLineId: 'BL123',
      url: 'https://onboarding.adyen.com/old-link'
    };

    const event = {
      body: JSON.stringify({ 
        merchantData,
        adyenData: existingAdyenData,
        userId: 'test-user-id'
      }),
    };

    // Mock the createOnboardingLink function to return a new URL
    mockedAdyenApi.createOnboardingLink.mockResolvedValue({ url: 'https://onboarding.adyen.com/new-link' });

    // Act
    const result = await handler(event);

    // Assert
    expect(result.statusCode).toBe(200);
    const responseBody = JSON.parse(result.body);
    expect(responseBody.adyenData).toEqual({
      ...existingAdyenData,
      url: 'https://onboarding.adyen.com/new-link'
    });

    // Verify that only createOnboardingLink was called, not the full onboarding flow
    expect(mockedAdyenApi.createLegalEntity).not.toHaveBeenCalled();
    expect(mockedAdyenApi.createAccountHolder).not.toHaveBeenCalled();
    expect(mockedAdyenApi.createBusinessLine).not.toHaveBeenCalled();
    expect(mockedAdyenApi.createBalanceAccount).not.toHaveBeenCalled();
    expect(mockedAdyenApi.createStore).not.toHaveBeenCalled();
    expect(mockedAdyenApi.createOnboardingLink).toHaveBeenCalledWith(
      'mockedLemClient',
      'LE123'
    );
  });
});
