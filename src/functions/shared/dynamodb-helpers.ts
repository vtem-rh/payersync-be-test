import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { captureAWSv3Client } from 'aws-xray-sdk-core';
import {APIGatewayProxyEvent} from "aws-lambda";

// Initialize DynamoDB client with X-Ray tracing
const dynamoClient = captureAWSv3Client(new DynamoDBClient({}));

// Helper function to convert DynamoDB item to JavaScript object
export const dynamoToJs = (item: any) => {
    const result: any = {};
    for (const [key, value] of Object.entries(item)) {
        if (typeof value === 'object' && value !== null) {
            if ('S' in value) result[key] = (value as any).S;
            else if ('N' in value) result[key] = Number((value as any).N);
            else if ('BOOL' in value) result[key] = (value as any).BOOL;
            else if ('SS' in value) result[key] = (value as any).SS;
            else if ('NS' in value) result[key] = (value as any).NS.map(Number);
            // Add other types as needed
        }
    }
    return result;
};

// Helper function to get userId from request context
export const getUserId = (event: any): string | null => {
    return event.requestContext?.authorizer?.jwt?.claims?.sub ||
        event.requestContext?.authorizer?.jwt?.claims?.['cognito:username'] ||
        event.requestContext?.authorizer?.claims?.sub ||
        event.requestContext?.authorizer?.claims?.['cognito:username'] ||
        null;
};

// Helper function to get user email from JWT claims
export const getUserEmail = (event: any): string | null => {
    return event.requestContext?.authorizer?.jwt?.claims?.email ||
        event.requestContext?.authorizer?.claims?.email ||
        null;
};

// Get user data from DynamoDB - reusable function
export const getUserData = async (userId: string, tableName: string) => {
    const getItemCommand = new GetItemCommand({
        TableName: tableName,
        Key: {
            userId: { S: userId },
        },
    });

    const result = await dynamoClient.send(getItemCommand);
    console.log('result', result);

    if (!result.Item) {
        throw new Error('User data not found');
    }

    const jsItem = dynamoToJs(result.Item);

    // Parse merchantData if it's a JSON string
    if (jsItem.merchantData) {
        try {
            jsItem.merchantData = JSON.parse(jsItem.merchantData);
        } catch (e) {
            console.warn('Failed to parse merchantData as JSON:', e);
        }
    }

    if (jsItem.adyenData) {
        try {
            jsItem.adyenData = JSON.parse(jsItem.adyenData);
        } catch (e) {
            console.warn('Failed to parse adyenData as JSON:', e);
        }
    }

    return jsItem;
};

export interface HTTPAPIGatewayProxyEvent extends APIGatewayProxyEvent {
    requestContext: APIGatewayProxyEvent['requestContext'] & {
        http?: {
            method: string;
            path: string;
            protocol: string;
            sourceIp: string;
            userAgent: string;
        };
    };
}

export function deepMerge(target: any, source: any): any {
    const output = { ...target };

    if (isObject(target) && isObject(source)) {
        Object.keys(source).forEach(key => {
            if (key === 'legalEntity') {
                // Special handling for legalEntity type changes
                output[key] = handleLegalEntityMerge(target[key], source[key]);
            } else if (isObject(source[key])) {
                if (isObject(target[key])) {
                    // Both are objects, merge recursively
                    output[key] = deepMerge(target[key], source[key]);
                } else {
                    // Target doesn't have this property or it's not an object, use source
                    output[key] = source[key];
                }
            } else {
                // Source value is not an object, overwrite target value
                output[key] = source[key];
            }
        });
    }

    return output;
}

function handleLegalEntityMerge(existingLegalEntity: any, newLegalEntity: any): any {
    // If no existing legal entity, use new one
    if (!existingLegalEntity) {
        return newLegalEntity;
    }

    // If no new legal entity, keep existing
    if (!newLegalEntity) {
        return existingLegalEntity;
    }

    const existingType = existingLegalEntity.type;
    const newType = newLegalEntity.type;

    if (existingType !== newType) {
        return newLegalEntity;
    }

    return deepMerge(existingLegalEntity, newLegalEntity);
}

function isObject(item: any): boolean {
    return item && typeof item === 'object' && !Array.isArray(item);
}