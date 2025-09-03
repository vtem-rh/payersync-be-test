import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyResult } from 'aws-lambda';
import * as AWSXRay from 'aws-xray-sdk-core';
import { captureAWSv3Client } from 'aws-xray-sdk-core';
import { HTTPAPIGatewayProxyEvent, getUserId, dynamoToJs } from '../../shared/dynamodb-helpers'
import { returnError, returnSuccess, returnOptionsResponse } from '../../shared/response-helpers';
import { getTableName } from '../../shared/config-helpers';

const dynamoClient = captureAWSv3Client(new DynamoDBClient({}));

export const handler = async (event: HTTPAPIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    return AWSXRay.captureAsyncFunc('GetPayloadHandler', async (subsegment) => {
        try {
            const tableName = getTableName();

            // Handle OPTIONS for CORS
            const httpMethod = event.httpMethod || event.requestContext?.http?.method;
            if (httpMethod === 'OPTIONS') {
                return returnOptionsResponse()
            }

            const userId = getUserId(event);
            if (!userId) {
                return returnError(401, 'Unauthorized - Missing user ID');
            }

            const queryUserId = event.queryStringParameters?.userId;
            if (queryUserId && queryUserId !== userId) {
                return returnError(403, 'Forbidden - Can only access your own data');
            }

            const getItemCommand = new GetItemCommand({
                TableName: tableName,
                Key: {
                    userId: { S: userId },
                },
            });

            const result = await dynamoClient.send(getItemCommand);

            if (!result.Item) {
                return returnError(404, `Onboarding data not found for user`);
            }

            const jsItem = dynamoToJs(result.Item);

            // Parse pmbData if it's a JSON string
            if (jsItem.pmbData) {
                try {
                    jsItem.pmbData = JSON.parse(jsItem.pmbData);
                } catch (e) {
                    console.warn('Failed to parse pmbData as JSON:', e);
                }
            }

            // Parse merchantData if it's a JSON string
            if (jsItem.merchantData) {
                try {
                    jsItem.merchantData = JSON.parse(jsItem.merchantData);
                } catch (e) {
                    console.warn('Failed to parse merchantData as JSON:', e);
                    // If parsing fails, keep as string
                }
            }

            // Create a copy of pmbData without the TIN for the response
            let sanitizedPmbData = null;
            if (jsItem.pmbData) {
                sanitizedPmbData = { ...jsItem.pmbData };
                // Remove TIN from the response to avoid exposing sensitive data
                delete sanitizedPmbData.tin;
            }

            const responseData = {
                ...(sanitizedPmbData && { pmbData: sanitizedPmbData }),
                ...(jsItem.merchantData && { merchantData: jsItem.merchantData }),
                ...(jsItem.status && { status: jsItem.status }),
                ...(jsItem.agreementTimeStamp && { agreementTimeStamp: jsItem.agreementTimeStamp }),
                ...(jsItem.businessAssociateAgreementTimeStamp && { businessAssociateAgreementTimeStamp: jsItem.businessAssociateAgreementTimeStamp }),
                hasGeneratedLink: jsItem.hasGeneratedLink || false
            };

            return returnSuccess(200, responseData);
        } catch (error) {
            console.error('Error in GET handler:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            subsegment?.addError(error as Error);
            return returnError(500, process.env.NODE_ENV === 'dev' ? errorMessage : 'Internal server error');
        } finally {
            subsegment?.close();
        }
    });
};