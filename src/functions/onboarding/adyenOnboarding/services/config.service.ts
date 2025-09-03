import { getAdyenApiKeys } from '../secrets-service';

export interface AdyenConfig {
  lemApiKey: string;
  bpApiKey: string;
  pspApiKey: string;
  bpApiUrl: string;
  managementApiUrl: string;
  lemApiUrl: string;
  adyenMerchantAccount: string;
}

export async function resolveAdyenConfig(): Promise<AdyenConfig> {
  let lemApiKey: string | undefined;
  let bpApiKey: string | undefined;
  let pspApiKey: string | undefined;

  let bpApiUrl = process.env.ADYEN_BP_API_URL;
  let managementApiUrl = process.env.ADYEN_MANAGEMENT_API_URL;
  let lemApiUrl = process.env.ADYEN_LEM_API_URL;

  if (process.env.NODE_ENV === 'test') {
    const lemApiKeyBase64 = process.env.ADYEN_LEM_API_KEY_PARAM;
    const bpApiKeyBase64 = process.env.ADYEN_BP_API_KEY_PARAM;
    const pspApiKeyBase64 = process.env.ADYEN_PSP_API_KEY_PARAM;
    if (!lemApiKeyBase64 || !bpApiKeyBase64 || !pspApiKeyBase64) {
      lemApiKey = 'test_lem_api_key';
      bpApiKey = 'test_bp_api_key';
      pspApiKey = 'test_psp_api_key';
    } else {
      lemApiKey = Buffer.from(lemApiKeyBase64, 'base64').toString('ascii');
      bpApiKey = Buffer.from(bpApiKeyBase64, 'base64').toString('ascii');
      pspApiKey = Buffer.from(pspApiKeyBase64, 'base64').toString('ascii');
    }
    if (!bpApiUrl || !managementApiUrl || !lemApiUrl) {
      bpApiUrl = 'https://127.0.0.1';
      managementApiUrl = 'https://127.0.0.1';
      lemApiUrl = 'https://127.0.0.1';
    }
  } else {
    const keys = await getAdyenApiKeys();
    lemApiKey = keys.lemApiKey;
    bpApiKey = keys.bpApiKey;
    pspApiKey = keys.pspApiKey;
    if (!bpApiUrl || !managementApiUrl || !lemApiUrl) {
      throw new Error('One or more Adyen API URLs are missing. Check environment variables ADYEN_BP_API_URL, ADYEN_MANAGEMENT_API_URL, and ADYEN_LEM_API_URL.');
    }
  }

  if (!lemApiKey || !bpApiKey || !pspApiKey) {
    throw new Error('One or more Adyen API keys are missing. For local tests, check ADYEN_*_API_KEY in your .env file. For deployed environments, check Secrets Manager.');
  }

  const adyenMerchantAccount = process.env.ADYEN_MERCHANT_ACCOUNT;
  if (!adyenMerchantAccount) {
    throw new Error('ADYEN_MERCHANT_ACCOUNT environment variable is not set.');
  }

  return {
    lemApiKey,
    bpApiKey,
    pspApiKey,
    bpApiUrl,
    managementApiUrl,
    lemApiUrl,
    adyenMerchantAccount,
  };
} 