import { handler } from '../src/functions/onboarding/adyenOnboarding/handler';
import * as fs from 'fs';
import * as path from 'path';
import * as AdyenApi from '../src/functions/onboarding/adyenOnboarding/adyen-api';

// Mock X-Ray SDK to prevent patching errors during tests
jest.mock('aws-xray-sdk-core', () => ({
  captureAWSv3Client: jest.fn().mockImplementation(client => client),
  captureAsyncFunc: jest.fn().mockImplementation((name, fn) => fn()),
  captureHTTPsGlobal: jest.fn(),
  getSegment: jest.fn().mockReturnValue({
    addNewSubsegment: jest.fn().mockReturnValue({
      close: jest.fn(),
      addError: jest.fn(),
    }),
  }),
}));

// Mock the Adyen API module
jest.mock('../src/functions/onboarding/adyenOnboarding/adyen-api');

describe('Adyen Onboarding Handler - Integration Test', () => {
    let merchantData: any;

    beforeAll(() => {
        const payloadPath = path.join(__dirname, 'events/adyen-onboarding-payload.json');
        const payload = fs.readFileSync(payloadPath, 'utf-8');
        merchantData = JSON.parse(payload).merchantData;
        merchantData.store[0].reference = `test-store-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        process.env.ADYEN_MERCHANT_ACCOUNT = 'RectangleHealthCOM';
        process.env.NODE_ENV = 'test';

        // Set up mock implementations for Adyen API functions
        const mockedAdyenApi = AdyenApi as jest.Mocked<typeof AdyenApi>;

        mockedAdyenApi.createAdyenApiClients.mockReturnValue({
            lem: { apiKey: 'test_lem_api_key', apiUrl: 'https://test-lem-api.adyen.com' },
            bp: { apiKey: 'test_bp_api_key', apiUrl: 'https://test-bp-api.adyen.com' },
            psp: { apiKey: 'test_psp_api_key', apiUrl: 'https://test-management-api.adyen.com' },
        } as any);

        mockedAdyenApi.createLegalEntity.mockResolvedValue({ id: 'LE123' });
        mockedAdyenApi.createAccountHolder.mockResolvedValue({ id: 'AH123' });
        mockedAdyenApi.createBalanceAccount.mockResolvedValue({ id: 'BA123' });
        mockedAdyenApi.createBusinessLine.mockResolvedValue({ id: 'BL123' });
        mockedAdyenApi.createStore.mockResolvedValue({ id: 'ST123' });
        mockedAdyenApi.createOnboardingLink.mockResolvedValue({ url: 'https://onboarding.adyen.com/link/123' });

        // Validate required environment variables
        const requiredEnvVars = ['ADYEN_MERCHANT_ACCOUNT'];
        const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
        if (missingEnvVars.length > 0) {
            throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
        }
    });

    it('should process the full onboarding flow with Adyen and return an onboarding link', async () => {
        const event = {
            body: JSON.stringify({ 
                merchantData,
                userId: 'test-user-id'
            }),
        };

        const result = await handler(event);

        console.log('Integration Test Response:', result.body);

        expect(result.statusCode).toBe(200);
        const resultBody = JSON.parse(result.body);
        expect(resultBody.adyenData).toHaveProperty('url');
        expect(typeof resultBody.adyenData.url).toBe('string');
        expect(resultBody.adyenData.url).toContain('adyen.com');
    }, 60000); 
}); 
