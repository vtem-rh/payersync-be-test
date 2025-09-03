import { APIGatewayProxyResult } from 'aws-lambda';
import { getAdyenApiKeys } from './secrets-service';
import * as AdyenApi from './adyen-api';

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const returnError = (statusCode: number, message: string, error?: any) => {
  console.error(message, error);
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ message, error: error ? error.message : undefined }),
  };
};

export const handler = async (event: any): Promise<APIGatewayProxyResult> => {
  try {
    if (!event.body) {
      return returnError(400, 'Missing request body');
    }
    const { merchantData } = JSON.parse(event.body);

    let lemApiKey: string | undefined;
    let bpApiKey: string | undefined;
    let pspApiKey: string | undefined;

    if (process.env.NODE_ENV === 'test') {
      console.log('Running in local test environment, decoding Base64 API keys from .env file...');
      const lemApiKeyBase64 = process.env.ADYEN_LEM_API_KEY_PARAM;
      const bpApiKeyBase64 = process.env.ADYEN_BP_API_KEY_PARAM;
      const pspApiKeyBase64 = process.env.ADYEN_PSP_API_KEY_PARAM;

      if (!lemApiKeyBase64 || !bpApiKeyBase64 || !pspApiKeyBase64) {
        console.log('Base64 encoded Adyen API keys are missing. Using mock API keys for tests...');
        lemApiKey = 'test_lem_api_key';
        bpApiKey = 'test_bp_api_key';
        pspApiKey = 'test_psp_api_key';
      } else {
        lemApiKey = Buffer.from(lemApiKeyBase64, 'base64').toString('ascii');
        bpApiKey = Buffer.from(bpApiKeyBase64, 'base64').toString('ascii');
        pspApiKey = Buffer.from(pspApiKeyBase64, 'base64').toString('ascii');
      }

    } else {
      console.log('Running in deployed environment, fetching API keys from Secrets Manager...');
      const keys = await getAdyenApiKeys();
      lemApiKey = keys.lemApiKey;
      bpApiKey = keys.bpApiKey;
      pspApiKey = keys.pspApiKey;
    }

    // Use mock API URLs if the actual ones are not available
    let bpApiUrl = process.env.ADYEN_BP_API_URL;
    let managementApiUrl = process.env.ADYEN_MANAGEMENT_API_URL;
    let lemApiUrl = process.env.ADYEN_LEM_API_URL;

    if (!bpApiUrl || !managementApiUrl || !lemApiUrl) {
      if (process.env.NODE_ENV === 'test') {
        console.log('Adyen API URLs are missing. Using mock URLs for tests...');
        bpApiUrl = 'https://127.0.0.1';
        managementApiUrl = 'https://127.0.0.1';
        lemApiUrl = 'https://127.0.0.1';
      } else {
        return returnError(500, 'One or more Adyen API URLs are missing. Check environment variables ADYEN_BP_API_URL, ADYEN_MANAGEMENT_API_URL, and ADYEN_LEM_API_URL.');
      }
    }

    if (!lemApiKey || !bpApiKey || !pspApiKey) {
      return returnError(500, 'One or more Adyen API keys are missing. For local tests, check ADYEN_*_API_KEY in your .env file. For deployed environments, check Secrets Manager.');
    }

    const adyenMerchantAccount = process.env.ADYEN_MERCHANT_ACCOUNT;
    if (!adyenMerchantAccount) {
      return returnError(500, 'ADYEN_MERCHANT_ACCOUNT environment variable is not set.');
    }

    const apiClients = AdyenApi.createAdyenApiClients(lemApiKey, bpApiKey, pspApiKey, bpApiUrl, managementApiUrl, lemApiUrl);

    // Build the legal entity payload from merchantData
    const { id: legalEntityId } = await AdyenApi.createLegalEntity(apiClients.lem, merchantData.legalEntity);

    // COMMENTED OUT - Missing required data in current payload
    // const { id: accountHolderId } = await AdyenApi.createAccountHolder(apiClients.bp, merchantData.accountHolder, legalEntityId);
    // await AdyenApi.createBalanceAccount(apiClients.bp, merchantData.balanceAccount, accountHolderId);

    // COMMENTED OUT - Missing required data in current payload
    // // Ensure businessLine.webData is always an array
    // if (merchantData.businessLine) {
    //   if (merchantData.businessLine.webData !== undefined) {
    //     if (!Array.isArray(merchantData.businessLine.webData)) {
    //       merchantData.businessLine.webData = [merchantData.businessLine.webData];
    //     }
    //   } else {
    //     merchantData.businessLine.webData = [];
    //   }
    // }
    // const { id: businessLineId } = await AdyenApi.createBusinessLine(apiClients.lem, merchantData.businessLine, legalEntityId);

    // COMMENTED OUT - Missing businessLineId
    // await AdyenApi.createStore(apiClients.psp, merchantData.store, businessLineId, adyenMerchantAccount);

    // Create a minimal hostedOnboarding object since it's missing from payload
    const hostedOnboarding = merchantData.hostedOnboarding || {
      // Add minimal required fields - you may need to adjust based on Adyen requirements
      platformName: "PayerSync",
      // Add other required fields as needed
    };

    const { url } = await AdyenApi.createOnboardingLink(apiClients.lem, hostedOnboarding, legalEntityId);

    const successfulOnboardingData = {
      ...merchantData,
      adyenData: {
        legalEntityId,
        // accountHolderId,  // Commented out since we're not creating it
        // businessLineId,   // Commented out since we're not creating it
        url,
      }
    };

    console.log('Onboarding successful', successfulOnboardingData);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(successfulOnboardingData),
    };
  } catch (error: any) {
    // Explicitly log all errors for observability
    console.error('Error in Adyen onboarding Lambda:', error);
    if (error instanceof ValidationError) {
      return returnError(400, error.message);
    }
    return returnError(500, 'Failed to process Adyen onboarding', error);
  }
};
