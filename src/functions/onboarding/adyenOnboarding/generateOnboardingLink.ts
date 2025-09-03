import { APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { captureAWSv3Client } from 'aws-xray-sdk-core';
import { getAdyenApiKeys } from './secrets-service';
import * as AdyenApi from './adyen-api';
import { getUserId, getUserData, HTTPAPIGatewayProxyEvent } from '../../shared/dynamodb-helpers';
import { returnError, returnSuccess, returnOptionsResponse } from '../../shared/response-helpers';
import { AdyenData } from '../../shared/types';
import { getTableName } from '../../shared/config-helpers';

// Initialize DynamoDB client with X-Ray tracing
const dynamoClient = captureAWSv3Client(new DynamoDBClient({}));

export const handler = async (event: HTTPAPIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const tableName = getTableName();

        const userId = getUserId(event);
        if (!userId) {
            return returnError(401, 'Unauthorized - Missing user ID');
        }

        // Handle OPTIONS for CORS
        const httpMethod = event.httpMethod || event.requestContext?.http?.method;
        if (httpMethod === 'OPTIONS') {
            return returnOptionsResponse();
        }

        let userData;
        try {
            userData = await getUserData(userId, tableName);
        } catch (error) {
            return returnError(404, 'User onboarding data not found');
        }

        const merchantData = userData.merchantData;

        if (!merchantData?.legalEntity) {
            return returnError(400, 'Legal entity data not found. Please complete the business setup first.');
        }

        if (!merchantData?.store) {
            return returnError(400, 'Store data not found. Please complete the store setup first.');
        }

        let lemApiKey: string, bpApiKey: string, pspApiKey: string;

        // Get API keys and URLs
        try {
            const keys = await getAdyenApiKeys();
            lemApiKey = keys.lemApiKey.trim();
            bpApiKey = keys.bpApiKey.trim();
            pspApiKey = keys.pspApiKey.trim();
        } catch (error) {
            return returnError(500, 'Failed to retrieve Adyen API keys');
        }

        let bpApiUrl = process.env.ADYEN_BP_API_URL;
        let managementApiUrl = process.env.ADYEN_MANAGEMENT_API_URL;
        let lemApiUrl = process.env.ADYEN_LEM_API_URL;

        if (!bpApiUrl || !managementApiUrl || !lemApiUrl) {
            if (process.env.NODE_ENV === 'test') {
                bpApiUrl = 'https://127.0.0.1';
                managementApiUrl = 'https://127.0.0.1';
                lemApiUrl = 'https://127.0.0.1';
            } else {
                return returnError(500, 'One or more Adyen API URLs are missing.');
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

        // Get existing Adyen data from DynamoDB
        const existingAdyenDataRaw = userData.adyenData;
        const existingAdyenData: AdyenData = existingAdyenDataRaw
            ? (typeof existingAdyenDataRaw === 'string'
                ? JSON.parse(existingAdyenDataRaw)
                : existingAdyenDataRaw)
            : {};

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

        const adyenData: AdyenData = { ...existingAdyenData };

        const isIndividual = merchantData.legalEntity.type === 'individual';
        const merchantId = 'RectangleHealthCOM';

        // Step 1: Create or verify Legal Entity
        if (!adyenData.legalEntityId) {
            try {
                const { id: legalEntityId } = await AdyenApi.createLegalEntity(
                    apiClients.lem,
                    merchantData.legalEntity
                );
                adyenData.legalEntityId = legalEntityId;
            } catch (error) {
                return returnError(500, 'Failed to create Legal Entity in Adyen');
            }
        }

        // Step 1.5: For Individuals, create Sole Proprietorship and map them
        if (isIndividual) {
            if (!adyenData.soleProprietorshipLegalEntityId) {
                try {
                    // Create Sole Proprietorship Legal Entity
                    const { id: soleProprietorshipLegalEntityId } = await AdyenApi.createSoleProprietorshipLegalEntity(
                        apiClients.lem,
                        merchantData.legalEntity
                    );

                    adyenData.soleProprietorshipLegalEntityId = soleProprietorshipLegalEntityId;

                    // Map Individual to Sole Proprietorship
                    await AdyenApi.mapIndividualToSoleProprietorship(
                        apiClients.lem,
                        adyenData.legalEntityId!,
                        soleProprietorshipLegalEntityId
                    );
                } catch (error) {
                    return returnError(500, 'Failed to create or map sole proprietorship entity.');
                }
            }
        }

        // Determine which Legal Entity ID to use for business operations
        const businessLegalEntityId = isIndividual
            ? adyenData.soleProprietorshipLegalEntityId!
            : adyenData.legalEntityId!;

        // Step 2: Create or verify Account Holder
        if (!adyenData.accountHolderId) {
            const accountHolderData = {
                description: `Account holder for ${merchantData.legalEntity.providerGroupName}`,
            };

            try {
                const { id: accountHolderId } = await AdyenApi.createAccountHolder(
                    apiClients.bp,
                    accountHolderData,
                    adyenData.legalEntityId!
                );
                adyenData.accountHolderId = accountHolderId;
            } catch (error) {
                return returnError(500, 'Failed to create account holder.');
            }
        }

        // Step 3: Create or verify Business Line
        if (!adyenData.businessLineId) {
            const businessLineData = {
                service: "paymentProcessing",
                industryCode: "339E",
                salesChannels: ["eCommerce", "ecomMoto"],
                webData: [
                    {
                        webAddress: "https://rectanglehealth.com"
                    }
                ]
            };

            try {
                const { id: businessLineId } = await AdyenApi.createBusinessLine(
                    apiClients.lem,
                    businessLineData,
                    adyenData.legalEntityId!
                );
                adyenData.businessLineId = businessLineId;
            } catch (error) {
                return returnError(500, 'Failed to create business line.');
            }
        }

        // Step 4: Create or verify Split Configuration
        if (!adyenData.splitConfigurationId) {
            try {
                const { splitConfigurationId } = await AdyenApi.createSplitConfiguration(
                    apiClients.psp,
                    merchantId
                );
                adyenData.splitConfigurationId = splitConfigurationId;
            } catch (error) {
                return returnError(500, 'Failed to create split configuration.');
            }
        }

        // Step 5: Create or verify Balance Account
        if (!adyenData.balanceAccountId) {
            const balanceAccountData = {
                defaultCurrencyCode: "USD",
            };

            try {
                const { id: balanceAccountId } = await AdyenApi.createBalanceAccount(
                    apiClients.bp,
                    balanceAccountData,
                    adyenData.accountHolderId!
                );
                adyenData.balanceAccountId = balanceAccountId;
            } catch (error) {
                return returnError(500, 'Failed to create balance account.');
            }
        }

        // Step 6: Create or verify Store
        if (!adyenData.storeId) {
            const storeData = {
                ...merchantData.store,
                businessLineIds: [adyenData.businessLineId!],
                splitConfiguration: {
                    balanceAccountId: adyenData.balanceAccountId!,
                    splitConfigurationId: adyenData.splitConfigurationId!
                }
            };

            try {
                const {id: storeId} = await AdyenApi.createStore(
                    apiClients.psp,
                    storeData,
                    adyenData.businessLineId!,
                    merchantId
                );
                adyenData.storeId = storeId;
            } catch (error) {
                console.error('Failed to create store:', error);
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';

                // If store already exists, this is a critical failure - the reference should be unique
                if (errorMessage.includes('already exist')) {
                    return returnError(409, 'Store reference already exists in Adyen. Please use a different store reference or contact support if this store belongs to you.');
                } else {
                    // For any other store creation error, also fail the entire process
                    return returnError(500, `Failed to create store in Adyen.`);
                }
            }
        }

        // Step 7: Create or verify Payment Methods (Visa and Mastercard)
        if (!adyenData.visaPaymentMethodId) {
            try {
                const { id: visaPaymentMethodId } = await AdyenApi.createPaymentMethod(
                    apiClients.psp,
                    merchantId,
                    adyenData.businessLineId!,
                    'visa'
                );
                adyenData.visaPaymentMethodId = visaPaymentMethodId;
            } catch (error) {
                return returnError(500, 'Failed to create Visa payment method.');
            }
        }

        if (!adyenData.mastercardPaymentMethodId) {
            try {
                const { id: mastercardPaymentMethodId } = await AdyenApi.createPaymentMethod(
                    apiClients.psp,
                    merchantId,
                    adyenData.businessLineId!,
                    'mc'
                );
                adyenData.mastercardPaymentMethodId = mastercardPaymentMethodId;
            } catch (error) {
                return returnError(500, 'Failed to create Mastercard payment method.');
            }
        }

        // Step 8: Create onboarding link (BEFORE saving any data)
        const onboardingLegalEntityId = isIndividual
            ? adyenData.legalEntityId!
            : businessLegalEntityId;

        const redirectUrl = `${process.env.DEFAULT_REDIRECT_URL || ''}`;
        const hostedOnboarding = {
            redirectUrl: redirectUrl + '/confirmation',
            locale: "en-US",
            settings: {
                changeLegalEntityType: false,
                editPrefilledCountry: false,
                enforceLegalAge: true
            }
        };

        let onboardingUrl: string;
        try {
            const { url } = await AdyenApi.createOnboardingLink(
                apiClients.lem,
                hostedOnboarding,
                onboardingLegalEntityId
            );
            onboardingUrl = url;
        } catch (error) {
            console.error('Failed to create onboarding link:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return returnError(500, `Failed to create onboarding link: ${errorMessage}`);
        }

        // Step 9: ONLY save data to DynamoDB AFTER everything succeeds
        const shouldSaveAdyenData = JSON.stringify(adyenData) !== JSON.stringify(existingAdyenData);

        if (shouldSaveAdyenData) {
            try {
                await saveAdyenDataToDynamoDB(userId, tableName, adyenData);
            } catch (error) {
                console.error('Failed to save Adyen data to DynamoDB after successful link creation:', error);
                return returnError(500, 'Internal error: Link generated but failed to save data. Please contact support.');
            }
        }

        // Step 10: Set hasGeneratedLink flag ONLY after everything else succeeds
        try {
            await setHasGeneratedLink(userId, tableName);
        } catch (error) {
            console.error('Failed to set hasGeneratedLink flag:', error);
            return returnError(500, 'Internal error: Link generated but failed to update status. Please contact support.');
        }

        return returnSuccess(200, {
            url: onboardingUrl
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return returnError(500, `Failed to generate onboarding link: ${errorMessage}`);
    }
};

async function saveAdyenDataToDynamoDB(userId: string, tableName: string, adyenData: AdyenData): Promise<void> {
    const updateCommand = new UpdateItemCommand({
        TableName: tableName,
        Key: {
            userId: { S: userId },
        },
        UpdateExpression: 'SET adyenData = :adyenData, accountHolderId = :accountHolderId, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
            ':adyenData': {
                S: JSON.stringify(adyenData)
            },
            ':accountHolderId': {
                S: adyenData.accountHolderId!
            },
            ':updatedAt': {
                S: new Date().toISOString()
            }
        }
    });

    await dynamoClient.send(updateCommand);
}

async function setHasGeneratedLink(userId: string, tableName: string): Promise<void> {
    const updateCommand = new UpdateItemCommand({
        TableName: tableName,
        Key: {
            userId: { S: userId },
        },
        UpdateExpression: 'SET hasGeneratedLink = :hasGeneratedLink, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
            ':hasGeneratedLink': { BOOL: true },
            ':updatedAt': { S: new Date().toISOString() }
        }
    });

    await dynamoClient.send(updateCommand);
}