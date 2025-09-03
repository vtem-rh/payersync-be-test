import { EventBridgeEvent } from 'aws-lambda';
import { DynamoDBClient, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { captureAWSv3Client } from 'aws-xray-sdk-core';
import * as AWSXRay from 'aws-xray-sdk-core';
import { createSweep, getLegalEntity } from '../adyenOnboarding/adyen-api';
import { getAdyenApiKeys } from '../adyenOnboarding/secrets-service';
import { OnboardingStatus, AdyenData, VerificationStatuses } from "../../shared/types";
import * as AdyenApi from "../adyenOnboarding/adyen-api";
import { getTableName } from '../../shared/config-helpers';

const dynamoClient = captureAWSv3Client(new DynamoDBClient({}));

interface OnboardingCompletionEvent {
  eventCode: string;
  pspReference: string;
  merchantReference?: string;
  notificationType: string;
  merchantAccountCode: string;
  live?: string;
  success?: string;
  amount?: {
    currency: string;
    value: number;
  };
  eventDate: string;
  reason?: string;
  paymentMethod?: string;
  operations?: any[];
  accountHolderCode?: string;
  accountHolderId?: string;
  accountHolderStatus?: string;
  verificationStatus?: string;
  verificationType?: string;
  originalPayload: any;
  webhookId: string;
  timestamp: string;
  s3Key: string;
}

async function findUserByAccountHolderId(
    tableName: string,
    accountHolderId: string
): Promise<any> {
  try {
    const queryCommand = new QueryCommand({
      TableName: tableName,
      IndexName: 'AccountHolderIdIndex',
      KeyConditionExpression: 'accountHolderId = :accountHolderId',
      ExpressionAttributeValues: {
        ':accountHolderId': { S: accountHolderId }
      },
      Limit: 1
    });

    const result = await dynamoClient.send(queryCommand);

    if (result.Items && result.Items.length > 0) {
      const user = result.Items[0];

      // Convert DynamoDB format to JavaScript object
      const userObj: any = {};
      for (const [key, value] of Object.entries(user)) {
        if (value.S) {
          userObj[key] = value.S;
        } else if (value.N) {
          userObj[key] = value.N;
        } else if (value.BOOL !== undefined) {
          userObj[key] = value.BOOL;
        }
      }

      // Parse adyenData if it's a JSON string
      if (userObj.adyenData) {
        try {
          userObj.adyenData = JSON.parse(userObj.adyenData);
        } catch (e) {
          console.warn('Failed to parse adyenData as JSON:', e);
        }
      }

      // Parse pmbData if it's a JSON string
      if (userObj.pmbData) {
        try {
          userObj.pmbData = JSON.parse(userObj.pmbData);
        } catch (e) {
          console.warn('Failed to parse pmbData as JSON:', e);
        }
      }

      return userObj;
    }

    return null;
  } catch (error) {
    console.error('Error finding user by account holder ID via GSI:', error);
    throw error;
  }
}

async function fetchAndExtractTIN(
    lemClientConfig: AdyenApi.AdyenApiClientConfig,
    legalEntityId: string
): Promise<string | null> {
  try {
    console.log(`Fetching legal entity ${legalEntityId} to extract TIN`);
    const legalEntity = await getLegalEntity(lemClientConfig, legalEntityId);

    // TIN extraction with correct field paths and working fallbacks
    const tin = 
      // Primary paths (from your analysis)
      legalEntity.organization?.taxId ||
      legalEntity.individual?.identificationData?.number ||
      
      // Working fallbacks for company flow (these were actually working)
      legalEntity.organization?.taxInformation?.[0]?.number ||
      legalEntity.organization?.businessInformation?.taxInformation?.number ||
      
      // Additional fallbacks for individual flow
      legalEntity.individual?.taxInformation?.number ||
      legalEntity.individual?.businessInformation?.taxInformation?.number;

    return tin;
  } catch (error) {
    console.error('Error fetching legal entity or extracting TIN:', error);
    return null;
  }
}

export const handler = async (event: EventBridgeEvent<any, any>): Promise<void> => {
  return AWSXRay.captureAsyncFunc('OnboardingCompletionHandler', async () => {
    try {
      // Parse the event detail
      let webhookEvent: OnboardingCompletionEvent;
      try {
        if (typeof event.detail === 'string') {
          webhookEvent = JSON.parse(event.detail);
        } else if (typeof event.detail === 'object') {
          webhookEvent = event.detail as OnboardingCompletionEvent;
        } else {
          throw new Error('Invalid event detail format - expected string or object');
        }
      } catch (error) {
        console.error('Failed to parse event detail:', error);
        throw new Error('Invalid event detail format');
      }

      // Handle both account holder creation and updates
      if (webhookEvent.eventCode !== 'balancePlatform.accountHolder.updated' && webhookEvent.eventCode !== 'balancePlatform.accountHolder.created') {
        console.log(`Skipping non-account-holder event: ${webhookEvent.eventCode}`);
        return;
      }

      const tableName = getTableName();

      // Extract account holder data from the original payload
      const originalPayload = webhookEvent.originalPayload;
      let accountHolderId: string | undefined;
      let accountHolder: any;

      // Try to extract from different possible payload structures
      if (originalPayload.data?.accountHolder?.id) {
        accountHolderId = originalPayload.data.accountHolder.id;
        accountHolder = originalPayload.data.accountHolder;
      } else if (originalPayload.accountHolder?.id) {
        accountHolderId = originalPayload.accountHolder.id;
        accountHolder = originalPayload.accountHolder;
      } else if (webhookEvent.accountHolderId) {
        accountHolderId = webhookEvent.accountHolderId;
        // We'll need to fetch the account holder data separately
      }

      if (!accountHolderId) {
        console.error('Could not extract account holder ID from webhook event');
        return;
      }

      const user = await findUserByAccountHolderId(tableName, accountHolderId);

      if (!user) {
        console.log('User not found with Account Holder ID:', accountHolderId);
        return;
      }

      console.log(`Processing onboarding completion for user ${user.userId}, current status: ${user.status}, event type: ${webhookEvent.eventCode}`);

      // Parse existing adyenData and pmbData
      let existingAdyenData: AdyenData = {};
      if (user.adyenData) {
        try {
          existingAdyenData = typeof user.adyenData === 'string'
              ? JSON.parse(user.adyenData)
              : user.adyenData;
        } catch (e) {
          console.error('Failed to parse existing adyenData:', e);
        }
      }

      let existingPmbData: any = {};
      if (user.pmbData) {
        try {
          existingPmbData = typeof user.pmbData === 'string'
              ? JSON.parse(user.pmbData)
              : user.pmbData;
        } catch (e) {
          console.error('Failed to parse existing pmbData:', e);
        }
      }

      if (webhookEvent.eventCode === 'balancePlatform.accountHolder.created') {
        const hasRequiredData = existingAdyenData.balanceAccountId && 
                               existingAdyenData.transferInstrumentId && 
                               existingAdyenData.legalEntityId;
        
        if (!hasRequiredData) {
          console.log(`Skipping onboarding completion for created event - missing required data. User needs to complete Adyen onboarding first.`);
          return;
        }
      }

      // Initialize verification statuses if they don't exist
      if (!existingAdyenData.verificationStatuses) {
        existingAdyenData.verificationStatuses = {
          receivePayments: false,
          sendToTransferInstrument: false,
          sendToBalanceAccount: false,
          receiveFromBalanceAccount: false,
          receiveFromTransferInstrument: false,
          receiveFromPlatformPayments: false
        };
      }

      // Process capabilities to extract transfer instruments and update verification statuses
      let transferInstrumentId: string | undefined;
      let verificationUpdated = false;

      if (accountHolder && accountHolder.capabilities) {
        const capabilities = accountHolder.capabilities;
        const verificationStatuses = existingAdyenData.verificationStatuses!;

        // Check each capability based on the actual structure from the API response
        const capabilityChecks = [
          { key: 'receivePayments', statusKey: 'receivePayments' },
          { key: 'sendToTransferInstrument', statusKey: 'sendToTransferInstrument' },
          { key: 'sendToBalanceAccount', statusKey: 'sendToBalanceAccount' },
          { key: 'receiveFromBalanceAccount', statusKey: 'receiveFromBalanceAccount' },
          { key: 'receiveFromTransferInstrument', statusKey: 'receiveFromTransferInstrument' },
          { key: 'receiveFromPlatformPayments', statusKey: 'receiveFromPlatformPayments' }
        ];

        for (const check of capabilityChecks) {
          const capability = capabilities[check.key];
          if (capability) {
            // Check verification status
            if (capability.verificationStatus === 'valid' && !verificationStatuses[check.statusKey as keyof VerificationStatuses]) {
              verificationStatuses[check.statusKey as keyof VerificationStatuses] = true;
              verificationUpdated = true;
            }

            // Check for transfer instruments (only in specific capabilities)
            if (!transferInstrumentId && capability.transferInstruments && capability.transferInstruments.length > 0) {
              transferInstrumentId = capability.transferInstruments[0].id;
            }
          }
        }

        existingAdyenData.verificationStatuses = verificationStatuses;
      } else {
        console.log('No account holder capabilities found or account holder data missing');
      }

      // Check if all verifications are complete
      const allVerificationsComplete = existingAdyenData.verificationStatuses &&
          Object.values(existingAdyenData.verificationStatuses).every(status => status === true);

      // Get the final transfer instrument ID (new or existing)
      const finalTransferInstrumentId = transferInstrumentId || existingAdyenData.transferInstrumentId;

      // Update adyenData with new transfer instrument if provided
      if (transferInstrumentId && transferInstrumentId !== existingAdyenData.transferInstrumentId) {
        existingAdyenData.transferInstrumentId = transferInstrumentId;
      }

      // Fetch TIN from legal entity if we have a legalEntityId and don't have TIN yet
      let tin: string | null = existingPmbData.tin || null;
      let tinFetched = false;
      
      // Use the legal entity ID from the account holder data if available, otherwise fall back to stored data
      let legalEntityIdToFetch = existingAdyenData.legalEntityId;
      
      // Check if the account holder has a legalEntityId that might be different from the stored one
      if (accountHolder && accountHolder.legalEntityId) {
        legalEntityIdToFetch = accountHolder.legalEntityId;
      }

      if (!tin && legalEntityIdToFetch) {
        try {
          // Get Adyen API keys and create client
          const keys = await getAdyenApiKeys();
          let lemApiUrl = process.env.ADYEN_LEM_API_URL;

          if (!lemApiUrl) {
            if (process.env.NODE_ENV === 'test') {
              lemApiUrl = 'https://127.0.0.1';
            } else {
              throw new Error('ADYEN_LEM_API_URL is missing.');
            }
          }

          const lemClientConfig: AdyenApi.AdyenApiClientConfig = {
            apiKey: keys.lemApiKey.trim(),
            apiUrl: lemApiUrl
          };

          tin = await fetchAndExtractTIN(lemClientConfig, legalEntityIdToFetch);
          if (tin) {
            existingPmbData.tin = tin;
            tinFetched = true;
          } else {
            console.warn(`Could not fetch TIN for user ${user.userId}`);
          }
        } catch (error) {
          console.error(`Error fetching TIN for user ${user.userId}:`, error);
        }
      }

      // Check if user is already fully onboarded
      if (user.status === OnboardingStatus.ONBOARDED) {
        console.log(`User ${user.userId} is already onboarded`);

        // Update the data if there were changes (including TIN)
        if (transferInstrumentId || verificationUpdated || tinFetched) {
          const updateCommand = new UpdateItemCommand({
            TableName: tableName,
            Key: {
              userId: { S: user.userId },
            },
            UpdateExpression: 'SET adyenData = :adyenData, pmbData = :pmbData, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
              ':adyenData': { S: JSON.stringify(existingAdyenData) },
              ':pmbData': { S: JSON.stringify(existingPmbData) },
              ':updatedAt': { S: new Date().toISOString() }
            }
          });

          await dynamoClient.send(updateCommand);
        }

        return;
      }

      // Determine if we should attempt to create a sweep
      const canAttemptSweepCreation =
          allVerificationsComplete &&
          finalTransferInstrumentId &&
          existingAdyenData.balanceAccountId &&
          !existingAdyenData.sweepId &&
          existingPmbData.tin;

      let sweepCreated = false;

      // Attempt to create sweep if conditions are met
      if (canAttemptSweepCreation) {
        try {
          console.log(`Creating sweep for user ${user.userId}`);

          let lemApiKey: string, bpApiKey: string, pspApiKey: string;

          // Get Adyen API keys
          const keys = await getAdyenApiKeys();
          lemApiKey = keys.lemApiKey.trim();
          bpApiKey = keys.bpApiKey.trim();
          pspApiKey = keys.pspApiKey.trim();

          let bpApiUrl = process.env.ADYEN_BP_API_URL;
          let managementApiUrl = process.env.ADYEN_MANAGEMENT_API_URL;
          let lemApiUrl = process.env.ADYEN_LEM_API_URL;

          if (!bpApiUrl || !managementApiUrl || !lemApiUrl) {
            if (process.env.NODE_ENV === 'test') {
              bpApiUrl = 'https://127.0.0.1';
              managementApiUrl = 'https://127.0.0.1';
              lemApiUrl = 'https://127.0.0.1';
            } else {
              throw new Error('One or more Adyen API URLs are missing.');
            }
          }

          const apiClients = AdyenApi.createAdyenApiClients(
              lemApiKey,
              bpApiKey,
              pspApiKey,
              bpApiUrl,
              managementApiUrl,
              lemApiUrl
          );

          // TypeScript assurance
          if (!existingAdyenData.balanceAccountId || !finalTransferInstrumentId) {
            throw new Error('Missing required data for sweep creation');
          }

          const sweepResponse = await createSweep(
              apiClients.bp,
              existingAdyenData.balanceAccountId,
              finalTransferInstrumentId
          );

          existingAdyenData.sweepId = sweepResponse.id;
          sweepCreated = true;
        } catch (error) {
          console.error(`Failed to create sweep for user ${user.userId}:`, error);
          sweepCreated = false;
        }
      } else if (allVerificationsComplete && finalTransferInstrumentId && existingAdyenData.balanceAccountId && existingAdyenData.sweepId && existingPmbData.tin) {
        // User already has a sweep and TIN
        sweepCreated = true;
      }

      // Only mark as onboarded if ALL verifications are complete, sweep exists, AND TIN is present
      const shouldMarkAsOnboarded = allVerificationsComplete && sweepCreated && existingPmbData.tin && user.status !== OnboardingStatus.ONBOARDED;

      // Prepare update expression
      let updateExpression = 'SET adyenData = :adyenData, pmbData = :pmbData, updatedAt = :updatedAt';
      const expressionAttributeValues: any = {
        ':adyenData': { S: JSON.stringify(existingAdyenData) },
        ':pmbData': { S: JSON.stringify(existingPmbData) },
        ':updatedAt': { S: new Date().toISOString() }
      };

      const expressionAttributeNames: any = {};

      // Only update status if all conditions are met (including TIN)
      if (shouldMarkAsOnboarded) {
        updateExpression += ', #status = :status, #onboardedAt = :onboardedAt';
        expressionAttributeValues[':status'] = { S: OnboardingStatus.ONBOARDED };
        expressionAttributeValues[':onboardedAt'] = { S: new Date().toISOString() };
        expressionAttributeNames['#status'] = 'status';
        expressionAttributeNames['#onboardedAt'] = 'onboardedAt';
      }

      // Update DynamoDB
      const updateCommand = new UpdateItemCommand({
        TableName: tableName,
        Key: {
          userId: { S: user.userId },
        },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
        ExpressionAttributeValues: expressionAttributeValues
      });

      await dynamoClient.send(updateCommand);

      // User status updated to ONBOARDED - DynamoDB stream will trigger SNS event
      if (shouldMarkAsOnboarded) {
        console.log(`User ${user.userId} marked as ONBOARDED - DynamoDB stream will trigger SNS event`);
      }

      // Onboarding completion processing finished

    } catch (error) {
      console.error('Error processing onboarding completion:', error);
      throw error;
    }
  });
};