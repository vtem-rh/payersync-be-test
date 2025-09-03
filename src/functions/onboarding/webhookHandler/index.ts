import { APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { captureAWSv3Client } from 'aws-xray-sdk-core';
import {returnError, returnOptionsResponse, returnSuccess} from '../../shared/response-helpers';
import { dynamoToJs, HTTPAPIGatewayProxyEvent } from '../../shared/dynamodb-helpers';
import { createSweep } from '../adyenOnboarding/adyen-api';
import { getAdyenApiKeys } from '../adyenOnboarding/secrets-service';
import { OnboardingStatus, AdyenData, VerificationStatuses } from "../../shared/types";
import * as AdyenApi from "../adyenOnboarding/adyen-api";
import { getTableName } from '../../shared/config-helpers';

const dynamoClient = captureAWSv3Client(new DynamoDBClient({}));
const snsClient = new SNSClient({});

export const handler = async (event: HTTPAPIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const httpMethod = event.httpMethod || event.requestContext?.http?.method;
    if (httpMethod === 'OPTIONS') {
        return returnOptionsResponse();
    }

    const tableName = getTableName();
    const onboardedEventTopicArn = process.env.ONBOARDED_EVENT_TOPIC_ARN;

    if (!onboardedEventTopicArn) {
        console.error('ONBOARDED_EVENT_TOPIC_ARN environment variable is not set');
        return returnSuccess(200, { message: 'Configuration error' });
    }

    // Extract webhook data
    const webhookBody = event.body ? JSON.parse(event.body) : {};
    console.log('Webhook received:', JSON.stringify(webhookBody, null, 2));

    try {
        // Only handle account holder updates
        if (webhookBody.type === 'balancePlatform.accountHolder.updated') {
            const data = webhookBody.data;
            if (data && data.accountHolder) {
                const accountHolder = data.accountHolder;
                const accountHolderId = accountHolder.id;

                const user = await findUserByAccountHolderId(tableName, accountHolderId);

                if (!user) {
                    console.log('User not found with Account Holder ID:', accountHolderId);
                    return returnSuccess(200, {
                        message: 'User not found, webhook processed',
                        processed: true
                    });
                }

                console.log(`Processing webhook for user ${user.userId}, current status: ${user.status}`);

                // Parse existing adyenData
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

                if (accountHolder.capabilities) {
                    const capabilities = accountHolder.capabilities;
                    const verificationStatuses = existingAdyenData.verificationStatuses!;

                    // Check each capability
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
                                console.log(`${check.key} verification is now valid`);
                            }

                            // Check for transfer instruments (only in specific capabilities)
                            if (!transferInstrumentId && capability.transferInstruments && capability.transferInstruments.length > 0) {
                                transferInstrumentId = capability.transferInstruments[0].id;
                                console.log(`Found transfer instrument ${transferInstrumentId} in ${check.key}`);
                            }
                        }
                    }

                    existingAdyenData.verificationStatuses = verificationStatuses;
                }

                // Check if all verifications are complete
                const allVerificationsComplete = existingAdyenData.verificationStatuses &&
                    Object.values(existingAdyenData.verificationStatuses).every(status => status === true);

                console.log('Verification status summary:', {
                    statuses: existingAdyenData.verificationStatuses,
                    allComplete: allVerificationsComplete
                });

                // Get the final transfer instrument ID (new or existing)
                const finalTransferInstrumentId = transferInstrumentId || existingAdyenData.transferInstrumentId;

                // Update adyenData with new transfer instrument if provided
                if (transferInstrumentId && transferInstrumentId !== existingAdyenData.transferInstrumentId) {
                    console.log('Updating transfer instrument');
                    existingAdyenData.transferInstrumentId = transferInstrumentId;
                }

                // Check if user is already fully onboarded
                if (user.status === OnboardingStatus.ONBOARDED) {
                    console.log(`User ${user.userId} is already onboarded`);

                    // Update the data if there were changes
                    if (transferInstrumentId || verificationUpdated) {
                        const updateCommand = new UpdateItemCommand({
                            TableName: tableName,
                            Key: {
                                userId: { S: user.userId },
                            },
                            UpdateExpression: 'SET adyenData = :adyenData, updatedAt = :updatedAt',
                            ExpressionAttributeValues: {
                                ':adyenData': { S: JSON.stringify(existingAdyenData) },
                                ':updatedAt': { S: new Date().toISOString() }
                            }
                        });

                        await dynamoClient.send(updateCommand);
                        console.log(`Updated data for already onboarded user ${user.userId}`);
                    }

                    return returnSuccess(200, {
                        message: 'Webhook processed successfully',
                        processed: true,
                        userAlreadyOnboarded: true
                    });
                }

                // Determine if we should attempt to create a sweep
                const canAttemptSweepCreation =
                    allVerificationsComplete &&
                    finalTransferInstrumentId &&
                    existingAdyenData.balanceAccountId &&
                    !existingAdyenData.sweepId;

                console.log('Sweep creation conditions:', {
                    allVerificationsComplete,
                    hasTransferInstrument: !!finalTransferInstrumentId,
                    hasBalanceAccount: !!existingAdyenData.balanceAccountId,
                    hasSweepId: !!existingAdyenData.sweepId,
                    canAttemptSweepCreation,
                    userId: user.userId
                });

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
                                console.log('Using mock URLs for tests...');
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
                        console.log(`Sweep created successfully with ID: ${sweepResponse.id}`);
                    } catch (error) {
                        console.error(`Failed to create sweep for user ${user.userId}:`, error);
                        sweepCreated = false;
                    }
                } else if (allVerificationsComplete && finalTransferInstrumentId && existingAdyenData.balanceAccountId && existingAdyenData.sweepId) {
                    // User already has a sweep
                    sweepCreated = true;
                    console.log(`User ${user.userId} already has sweep ${existingAdyenData.sweepId}`);
                }

                // Only mark as onboarded if ALL verifications are complete AND sweep exists
                const shouldMarkAsOnboarded = allVerificationsComplete && sweepCreated && user.status !== OnboardingStatus.ONBOARDED;

                // Prepare update expression
                let updateExpression = 'SET adyenData = :adyenData, updatedAt = :updatedAt';
                const expressionAttributeValues: any = {
                    ':adyenData': { S: JSON.stringify(existingAdyenData) },
                    ':updatedAt': { S: new Date().toISOString() }
                };

                const expressionAttributeNames: any = {};

                // Only update status if both conditions are met
                if (shouldMarkAsOnboarded) {
                    updateExpression += ', #status = :status';
                    expressionAttributeValues[':status'] = { S: OnboardingStatus.ONBOARDED };
                    expressionAttributeNames['#status'] = 'status';

                    console.log(`Marking user ${user.userId} as ONBOARDED`);
                } else {
                    console.log(`User ${user.userId} not ready for onboarding - all verifications: ${allVerificationsComplete}, sweep: ${existingAdyenData.sweepId || 'none'}`);
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
                console.log(`User ${user.userId} updated successfully`);

                // Publish SNS event only if user was actually marked as onboarded
                if (shouldMarkAsOnboarded) {
                    await publishOnboardingEvent(
                        user.userId,
                        OnboardingStatus.ONBOARDED,
                        onboardedEventTopicArn
                    );
                    console.log(`Published onboarding event for user ${user.userId}`);
                }

                return returnSuccess(200, {
                    message: 'Webhook processed successfully',
                    processed: true,
                    userOnboarded: shouldMarkAsOnboarded,
                    verificationStatuses: existingAdyenData.verificationStatuses,
                    allVerificationsComplete,
                    hasSweep: !!existingAdyenData.sweepId,
                    hasTransferInstrument: !!finalTransferInstrumentId
                });
            }
        }

        // Handle other webhook types if needed
        console.log(`Unhandled webhook type: ${webhookBody.type}`);

        return returnSuccess(200, {
            message: 'Webhook processed successfully',
            processed: true
        });
    } catch (error) {
        console.error('Error processing webhook:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        return returnSuccess(200, {
            message: 'Webhook received but error occurred during processing',
            error: errorMessage,
            timestamp: new Date().toISOString()
        });
    }
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
            const user = dynamoToJs(result.Items[0]);

            // Parse adyenData if it's a JSON string
            if (user.adyenData) {
                try {
                    user.adyenData = JSON.parse(user.adyenData);
                } catch (e) {
                    console.warn('Failed to parse adyenData as JSON:', e);
                }
            }

            return user;
        }

        return null;
    } catch (error) {
        console.error('Error finding user by account holder ID via GSI:', error);
        throw error;
    }
}

async function publishOnboardingEvent(
    userId: string,
    status: OnboardingStatus,
    topicArn: string
): Promise<void> {
    try {
        const onboardedEvent = {
            userId: userId,
            status: status,
            timestamp: new Date().toISOString(),
            source: 'adyen-webhook'
        };

        const publishCommand = new PublishCommand({
            TopicArn: topicArn,
            Message: JSON.stringify(onboardedEvent),
            Subject: 'User onboarding completed via webhook',
        });

        await snsClient.send(publishCommand);
        console.log('SNS event published successfully:', onboardedEvent);
    } catch (error) {
        console.error('Error publishing SNS event:', error);
        // Don't throw - we still want to acknowledge the webhook
    }
}