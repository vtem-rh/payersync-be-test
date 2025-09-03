import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyResult } from 'aws-lambda';
import { captureAWSv3Client } from 'aws-xray-sdk-core';
import * as AWSXRay from 'aws-xray-sdk-core';
import { getUserId, getUserEmail, HTTPAPIGatewayProxyEvent, deepMerge } from '../../shared/dynamodb-helpers'
import { returnError, returnOptionsResponse } from '../../shared/response-helpers';
import { OnboardingStatus } from '../../shared/types';
import { getTableName } from '../../shared/config-helpers';

const dynamoClient = captureAWSv3Client(new DynamoDBClient({}));

export const handler = async (event: HTTPAPIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    return AWSXRay.captureAsyncFunc('PayloadHandler', async (subsegment) => {
        try {
            if (!event.body) {
                return returnError(400, 'Missing request body');
            }

            const tableName = getTableName();

            const userId = getUserId(event);
            if (!userId) {
                return returnError(401, 'Unauthorized - Missing user ID');
            }

            // Get user email from JWT token
            const userEmail = getUserEmail(event);
            if (!userEmail) {
                return returnError(401, 'Unauthorized - Missing user email');
            }

            let body;
            try {
                body = JSON.parse(event.body);
            } catch (error) {
                return returnError(400, 'Invalid JSON in request body');
            }

            // Handle OPTIONS for CORS
            const httpMethod = event.httpMethod || event.requestContext?.http?.method;
            if (httpMethod === 'OPTIONS') {
                return returnOptionsResponse();
            }

            const pmbData = body.pmbData;
            const merchantData = body.merchantData;

            const timestamp = new Date().toISOString();

            // Get existing data to merge and check if link has been generated
            let mergedPmbData = pmbData;
            let mergedMerchantData = merchantData;
            let isUpdate = false;
            let submissionCount = 1;
            let hasGeneratedLink = false;

            try {
                const getCommand = new GetItemCommand({
                    TableName: tableName,
                    Key: { userId: { S: userId } }
                });

                const existingItem = await dynamoClient.send(getCommand);

                if (existingItem.Item) {
                    isUpdate = true;

                    // Check if link has been generated
                    if (existingItem.Item.hasGeneratedLink?.BOOL === true) {
                        hasGeneratedLink = true;
                    }

                    // If link has been generated, silently ignore updates to critical data
                    if (hasGeneratedLink && (pmbData || merchantData)) {
                        console.log('User attempted to modify data after link generation. Ignoring changes but returning success.');
                        return returnError(200, 'Data submission processed successfully');
                    }

                    // Merge pmbData if it exists
                    if (existingItem.Item.pmbData?.S && pmbData) {
                        const existingPmbData = JSON.parse(existingItem.Item.pmbData.S);
                        mergedPmbData = deepMerge(existingPmbData, pmbData);
                    }

                    // Merge merchantData if it exists
                    if (existingItem.Item.merchantData?.S && merchantData) {
                        const existingMerchantData = JSON.parse(existingItem.Item.merchantData.S);
                        mergedMerchantData = deepMerge(existingMerchantData, merchantData);
                    }

                    // Get existing submission count
                    if (existingItem.Item.submissionCount?.N) {
                        submissionCount = parseInt(existingItem.Item.submissionCount.N) + 1;
                    }
                }
            } catch (error) {
                console.error('Could not fetch existing data from DynamoDB:', error);
            }

            const hasAgreementTimestamp = body.agreementTimeStamp;
            const hasBusinessAssociateAgreementTimestamp = body.businessAssociateAgreementTimeStamp;

            // Build update expression dynamically based on what we have
            let updateExpression = 'SET updatedAt = :updatedAt, submissionCount = :submissionCount, #status = :status, userEmail = :userEmail';
            const expressionAttributeValues: Record<string, any> = {
                ':updatedAt': { S: timestamp },
                ':submissionCount': { N: submissionCount.toString() },
                ':status': { S: OnboardingStatus.NOT_ONBOARDED }, // Default status
                ':userEmail': { S: userEmail },
                ...(isUpdate ? {} : {
                    ':createdAt': { S: timestamp }
                })
            }

            // Add pmbData to update if provided
            if (mergedPmbData) {
                updateExpression += ', pmbData = :pmbData';
                expressionAttributeValues[':pmbData'] = { S: JSON.stringify(mergedPmbData) };
            }

            // Add merchantData to update if provided
            if (mergedMerchantData) {
                updateExpression += ', merchantData = :merchantData';
                expressionAttributeValues[':merchantData'] = { S: JSON.stringify(mergedMerchantData) };

                // Update the status to ONBOARDING if we have merchant data with store reference
                if (mergedMerchantData.store?.reference && mergedMerchantData.store.reference.length > 0) {
                    expressionAttributeValues[':status'] = { S: OnboardingStatus.ONBOARDING };
                }
            }

            // Add createdAt for new items
            if (!isUpdate) {
                updateExpression += ', createdAt = :createdAt';
            }

            // Add agreementTimeStamp if provided
            if (hasAgreementTimestamp) {
                updateExpression += ', agreementTimeStamp = :agreementTimeStamp';
                expressionAttributeValues[':agreementTimeStamp'] = { S: hasAgreementTimestamp };
            }

            if (hasBusinessAssociateAgreementTimestamp) {
                updateExpression += ', businessAssociateAgreementTimeStamp = :businessAssociateAgreementTimeStamp';
                expressionAttributeValues[':businessAssociateAgreementTimeStamp'] = { S: hasBusinessAssociateAgreementTimestamp };
            }

            // Initialize hasGeneratedLink for new records
            if (!isUpdate) {
                updateExpression += ', hasGeneratedLink = :hasGeneratedLink';
                expressionAttributeValues[':hasGeneratedLink'] = { BOOL: false };
            }

            const updateCommand = new UpdateItemCommand({
                TableName: tableName,
                Key: { userId: { S: userId } },
                UpdateExpression: updateExpression,
                ExpressionAttributeNames: {
                    '#status': 'status'
                },
                ExpressionAttributeValues: expressionAttributeValues,
                ReturnValues: 'ALL_NEW'
            });

            await dynamoClient.send(updateCommand);

            return returnError(200, isUpdate ? 'User onboarding data updated' : 'User onboarding data stored');
        } catch (error) {
            console.error('Error processing payload:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            subsegment?.addError(error as Error);
            return returnError(500, process.env.NODE_ENV === 'dev' ? errorMessage : 'Internal server error');
        } finally {
            subsegment?.close();
        }
    });
};