// This test file is for local-only tests that may call real Adyen endpoints.
// Do NOT run this file in CI/CD.
if (process.env.CI) {
  // eslint-disable-next-line no-undef
  describe.skip('Adyen Onboarding Handler (Local Only)', () => {
    it('skipped in CI', () => {});
  });
  // Exit early so no other tests run
  // @ts-ignore
  return;
}
import { handler } from '../src/functions/onboarding/adyenOnboarding/handler';
import * as AdyenApi from '../src/functions/onboarding/adyenOnboarding/adyen-api';
import * as fs from 'fs';
import * as path from 'path';

// Mock the Adyen API module
jest.mock('../src/functions/onboarding/adyenOnboarding/adyen-api');

const mockedAdyenApi = AdyenApi as jest.Mocked<typeof AdyenApi>;

describe('Adyen Onboarding Handler (Local Only)', () => {
  let merchantData: any;

  beforeEach(() => {
    jest.resetAllMocks();
    const payloadPath = path.join(__dirname, 'events/adyen-onboarding-payload.json');
    const payload = fs.readFileSync(payloadPath, 'utf-8');
    merchantData = JSON.parse(payload).merchantData;
    process.env.ADYEN_MERCHANT_ACCOUNT = 'RectangleHealthCOM';

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

  it('should process the onboarding flow successfully and return an onboarding link', async () => {
    // Arrange
    const event = {
      body: JSON.stringify({ merchantData, userId: 'test-user-id' }),
    };

    // Act
    const result = await handler(event);

    // Assert
    expect(merchantData).toMatchSnapshot('merchantData-payload');
    expect(result.statusCode).toBe(200);
    const responseBody = JSON.parse(result.body);
    expect(responseBody.adyenData).toHaveProperty('url');
    expect(responseBody.adyenData.url).toBe('https://onboarding.adyen.com/link/123');
    expect(responseBody).toMatchObject({
      adyenData: expect.any(Object),
    });
    expect(mockedAdyenApi.createLegalEntity).toHaveBeenCalledWith('mockedLemClient', expect.any(Object));
    expect(mockedAdyenApi.createAccountHolder).toHaveBeenCalledWith('mockedBpClient', merchantData.accountHolder, 'LE123');
    expect(mockedAdyenApi.createBusinessLine).toHaveBeenCalledWith('mockedLemClient', merchantData.businessLine, 'LE123');
    expect(mockedAdyenApi.createBalanceAccount).toHaveBeenCalledWith('mockedBpClient', merchantData.balanceAccount, 'AH123');
    expect(mockedAdyenApi.createStore).toHaveBeenCalledWith(
      'mockedPspClient',
      merchantData.store,
      'BL123',
      'RectangleHealthCOM'
    );
    expect(mockedAdyenApi.createOnboardingLink).toHaveBeenCalledWith('mockedLemClient', 'LE123');
  });
}); 