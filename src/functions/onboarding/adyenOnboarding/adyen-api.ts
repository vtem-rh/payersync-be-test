import https from 'https';
import { URL } from 'url';

// --- API Client Creation ---
export interface AdyenApiClientConfig {
  apiKey: string;
  apiUrl: string;
}

export interface AdyenApiClients {
  lem: AdyenApiClientConfig;
  bp: AdyenApiClientConfig;
  psp: AdyenApiClientConfig;
}

export function createAdyenApiClients(
  lemApiKey: string,
  bpApiKey: string,
  pspApiKey: string,
  bpApiUrl: string,
  managementApiUrl: string,
  lemApiUrl: string
): AdyenApiClients {
  return {
    lem: { apiKey: lemApiKey, apiUrl: lemApiUrl },
    bp: { apiKey: bpApiKey, apiUrl: bpApiUrl },
    psp: { apiKey: pspApiKey, apiUrl: managementApiUrl },
  };
}

// --- API Call Functions ---

function handleAdyenRequest<T>(
  clientConfig: AdyenApiClientConfig,
  method: 'POST' | 'GET' | 'PATCH',
  path: string,
  payload: any,
  operation: string
): Promise<T> {
  const postData = JSON.stringify(payload);
  const url = new URL(clientConfig.apiUrl);

  // Ensure path is properly joined with the base URL
  // If the base URL already includes a path (like /lem/v4), we need to preserve it
  let finalPath;
  if (path.startsWith('/')) {
    // If path starts with /, ensure we don't lose the base path
    const basePathname = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
    finalPath = `${basePathname}${path}`;
  } else {
    // If path doesn't start with /, just append it to the base path
    finalPath = url.pathname.endsWith('/') ? `${url.pathname}${path}` : `${url.pathname}/${path}`;
  }

  const options = {
    hostname: url.hostname,
    port: 443,
    path: finalPath,
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-API-Key': clientConfig.apiKey.trim(),
      'Content-Length': Buffer.byteLength(postData),
    },
    agent: false,
    timeout: 30000, // 30 seconds timeout
  };

  console.log(`Adyen ${operation} request sent to: ${clientConfig.apiUrl}${path}`, {
    headers: options.headers,
  });

  return new Promise<T>((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          // Check if the response is likely HTML (common for error pages)
          const isHtmlResponse = data.trim().startsWith('<!DOCTYPE') || data.trim().startsWith('<html');

          if (isHtmlResponse) {
            console.error(`Adyen ${operation} returned HTML instead of JSON. Status: ${res.statusCode}`);
            // Include a snippet of the HTML in the error for debugging
            const htmlSnippet = data.length > 100 ? data.substring(0, 100) + '...' : data;
            reject(new Error(`Failed to ${operation}: Received HTML response instead of JSON. Status: ${res.statusCode}. Response starts with: ${htmlSnippet}`));
            return;
          }

          const responseData = data ? JSON.parse(data) : {};
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`Adyen ${operation} response - responseData:`, JSON.stringify(responseData, null, 2));
            resolve(responseData);
          } else {
            console.error(`Adyen ${operation} error response -n0 - responseData:`, data);
            reject(new Error(`Failed to ${operation}: ${responseData.detail || `Request failed with status code ${res.statusCode}`}`));
          }
        } catch (error) {
           console.error(`Adyen ${operation} parsing error:`, error);
           // Include the status code and full response for better debugging
           reject(new Error(`Failed to parse response for ${operation}. Status: ${res.statusCode}, Response: ${data}`));
        }
      });
    });

    req.on('error', error => {
      console.error(`Adyen ${operation} request error:`, error);
      reject(new Error(`Failed to ${operation}: ${error.message}`));
    });

    req.on('timeout', () => {
      console.error(`Adyen ${operation} request timeout after ${options.timeout}ms`);
      req.abort();
      reject(new Error(`Timeout: ${operation} request exceeded ${options.timeout}ms`));
    });

    req.write(postData);
    req.end();
  });
}

export async function createLegalEntity(lemClientConfig: AdyenApiClientConfig, legalEntityData: any): Promise<{ id: string }> {
  const path = '/legalEntities';
  return handleAdyenRequest(lemClientConfig, 'POST', path, legalEntityData, 'create legal entity');
}

export async function getLegalEntity(lemClientConfig: AdyenApiClientConfig, legalEntityId: string): Promise<any> {
  const path = `/legalEntities/${legalEntityId}`;
  return handleAdyenRequest(lemClientConfig, 'GET', path, null, 'get legal entity');
}

export async function createAccountHolder(bpClientConfig: AdyenApiClientConfig, accountHolderData: any, legalEntityId: string): Promise<{ id: string }> {
  const payload = { ...accountHolderData, legalEntityId };
  const path = '/accountHolders';
  return handleAdyenRequest(bpClientConfig, 'POST', path, payload, 'create account holder');
}

export async function createBalanceAccount(bpClientConfig: AdyenApiClientConfig, balanceAccountData: any, accountHolderId: string): Promise<{ id: string }> {
  const payload = { ...balanceAccountData, accountHolderId };
  const path = '/balanceAccounts';
  return handleAdyenRequest(bpClientConfig, 'POST', path, payload, 'create balance account');
}

export async function createBusinessLine(lemClientConfig: AdyenApiClientConfig, businessLineData: any, legalEntityId: string): Promise<{ id: string }> {
  const payload = { ...businessLineData, legalEntityId };
  const path = '/businessLines';
  return handleAdyenRequest(lemClientConfig, 'POST', path, payload, 'create business line');
}

export async function createStore(pspClientConfig: AdyenApiClientConfig, storeData: any, businessLineId: string, merchantId: string): Promise<{ id: string }> {
  const payload = { ...storeData, merchantId, businessLineIds: [businessLineId] };
  const path = '/stores';
  return handleAdyenRequest(pspClientConfig, 'POST', path, payload, 'create store');
}

export async function createOnboardingLink(lemClientConfig: AdyenApiClientConfig, hostedOnboardingData: any, legalEntityId: string): Promise<{ url: string }> {
  const { themeId, redirectUrl, locale, settings } = hostedOnboardingData;
  const payload = { themeId, redirectUrl, locale, settings };
  const path = `/legalEntities/${legalEntityId}/onboardingLinks`;
  return handleAdyenRequest(lemClientConfig, 'POST', path, payload, 'create onboarding link');
}

export async function createSplitConfiguration(pspClientConfig: AdyenApiClientConfig, merchantId: string): Promise<{ splitConfigurationId: string }> {
  const splitConfigurationData = {
    description: "Three percent variable",
    rules: [
      {
        paymentMethod: "ANY",
        shopperInteraction: "ANY",
        fundingSource: "ANY",
        currency: "ANY",
        splitLogic: {
          paymentFee: "deductFromLiableAccount",
          chargeback: "deductFromLiableAccount",
          chargebackCostAllocation: "deductFromLiableAccount",
          commission: {
            variablePercentage: 349
          },
          refund: "deductAccordingToSplitRatio",
          refundCostAllocation: "deductFromOneBalanceAccount"
        }
      }
    ]
  };

  const path = `/merchants/${merchantId}/splitConfigurations`;
  return handleAdyenRequest(pspClientConfig, 'POST', path, splitConfigurationData, 'create split configuration');
}

export async function createPaymentMethod(pspClientConfig: AdyenApiClientConfig, merchantId: string, businessLineId: string, paymentType: 'visa' | 'mc'): Promise<{ id: string }> {
  const paymentMethodData = {
    type: paymentType,
    currencies: ["USD"],
    countries: ["US"],
    businessLineId: businessLineId
  };

  const path = `/merchants/${merchantId}/paymentMethodSettings`;
  return handleAdyenRequest(pspClientConfig, 'POST', path, paymentMethodData, 'create payment method settings');
}

export async function createSweep(
    bpClientConfig: AdyenApiClientConfig,
    balanceAccountId: string,
    transferInstrumentId: string
): Promise<{ id: string }> {
  const sweep = {
    counterparty: {
      transferInstrumentId: transferInstrumentId
    },
    triggerAmount: {
      currency: 'USD',
      value: 0
    },
    currency: 'USD',
    priorities: ['regular', 'fast'],
    category: 'bank',
    schedule: {
      type: 'daily'
    },
    type: 'push',
    status: 'active'
  };

  const path = `/balanceAccounts/${balanceAccountId}/sweeps`;
  return handleAdyenRequest(bpClientConfig, 'POST', path, sweep, 'create sweep configuration')
}

export async function mapIndividualToSoleProprietorship(
    lemClientConfig: AdyenApiClientConfig,
    individualLegalEntityId: string,
    soleProprietorshipLegalEntityId: string
): Promise<void> {
  const path = `/legalEntities/${individualLegalEntityId}`;
  const payload = {
    entityAssociations: [
      {
        type: "soleProprietorship",
        "legalEntityId": soleProprietorshipLegalEntityId
      }
    ]
  };

  return handleAdyenRequest(lemClientConfig, 'PATCH', path, payload, 'map individual to sole proprietorship');
}

export async function createSoleProprietorshipLegalEntity(
    lemClientConfig: AdyenApiClientConfig,
    individualData: any
): Promise<{ id: string }> {
  const soleProprietorshipData = {
    type: "soleProprietorship",
    reference: `${individualData.reference}_sp`,
    soleProprietorship: {
      countryOfGoverningLaw: individualData?.individual?.residentialAddress?.country || "US",
      name: `${individualData?.individual?.name?.firstName} ${individualData?.individual?.name?.lastName}`.trim(),
      registeredAddress: {
        city: individualData?.individual?.residentialAddress?.city,
        country: individualData.individual?.residentialAddress?.country || "US",
        postalCode: individualData.individual?.residentialAddress?.postalCode || "",
        stateOrProvince: individualData.individual?.residentialAddress?.stateOrProvince || "",
        street: individualData.individual?.residentialAddress?.street || ""
      }
    }
  };

  const path = '/legalEntities';
  return handleAdyenRequest(lemClientConfig, 'POST', path, soleProprietorshipData, 'create sole proprietorship legal entity');
}