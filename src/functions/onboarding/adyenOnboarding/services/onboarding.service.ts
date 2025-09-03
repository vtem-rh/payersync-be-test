import * as AdyenApi from '../adyen-api';
import * as AWSXRay from 'aws-xray-sdk-core';

export async function traceSubsegment<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const segment = AWSXRay.getSegment();
  const subsegment = segment?.addNewSubsegment(name);
  try {
    const result = await fn();
    subsegment?.close();
    return result;
  } catch (err) {
    if (subsegment) {
      if (err instanceof Error) {
        subsegment.addError(err);
      } else {
        subsegment.addError(new Error(String(err)));
      }
      subsegment.close();
    }
    throw err;
  }
}

function buildLegalEntityPayload(merchantData: any) {
  if (!merchantData.legalEntity) {
    throw new Error("Validation failed: Missing required field 'legalEntity' in merchantData");
  }
  return merchantData.legalEntity;
}

export async function onboardMerchant(merchantData: any, config: {
  lemApiKey: string;
  bpApiKey: string;
  pspApiKey: string;
  bpApiUrl: string;
  managementApiUrl: string;
  lemApiUrl: string;
  adyenMerchantAccount: string;
}) {
  const apiClients = AdyenApi.createAdyenApiClients(
    config.lemApiKey,
    config.bpApiKey,
    config.pspApiKey,
    config.bpApiUrl,
    config.managementApiUrl,
    config.lemApiUrl
  );

  // Build the legal entity payload from merchantData
  const legalEntityPayload = buildLegalEntityPayload(merchantData);
  const { id: legalEntityId } = await traceSubsegment('Adyen.createLegalEntity', () =>
    AdyenApi.createLegalEntity(apiClients.lem, legalEntityPayload)
  );

  const { id: accountHolderId } = await traceSubsegment('Adyen.createAccountHolder', () =>
    AdyenApi.createAccountHolder(apiClients.bp, merchantData.accountHolder, legalEntityId)
  );
  await traceSubsegment('Adyen.createBalanceAccount', () =>
    AdyenApi.createBalanceAccount(apiClients.bp, merchantData.balanceAccount, accountHolderId)
  );

  // Ensure businessLine.webData is always an array
  if (merchantData.businessLine) {
    if (merchantData.businessLine.webData !== undefined) {
      if (!Array.isArray(merchantData.businessLine.webData)) {
        merchantData.businessLine.webData = [merchantData.businessLine.webData];
      }
    } else {
      merchantData.businessLine.webData = [];
    }
  }

  const { id: businessLineId } = await traceSubsegment('Adyen.createBusinessLine', () =>
    AdyenApi.createBusinessLine(apiClients.lem, merchantData.businessLine, legalEntityId)
  );
  // Process each store in the array
  for (const store of merchantData.store) {
    await traceSubsegment('Adyen.createStore', () =>
      AdyenApi.createStore(apiClients.psp, store, businessLineId, config.adyenMerchantAccount)
    );
  }

  const { url } = await traceSubsegment('Adyen.createOnboardingLink', () =>
    AdyenApi.createOnboardingLink(apiClients.lem, merchantData, legalEntityId)
  );

  return {
    legalEntityId,
    accountHolderId,
    businessLineId,
    url,
  };
}

export async function getOnboardingUrl(config: {
  lemApiKey: string;
  lemApiUrl: string;
}, legalEntityId: string, hostedOnboarding: any): Promise<string> {
  const apiClients = AdyenApi.createAdyenApiClients(
    config.lemApiKey,
    '', // bpApiKey not needed
    '', // pspApiKey not needed
    '', // bpApiUrl not needed
    '', // managementApiUrl not needed
    config.lemApiUrl
  );
  const { url } = await traceSubsegment('Adyen.createOnboardingLink', () =>
    AdyenApi.createOnboardingLink(apiClients.lem, hostedOnboarding, legalEntityId)
  );
  return url;
} 
