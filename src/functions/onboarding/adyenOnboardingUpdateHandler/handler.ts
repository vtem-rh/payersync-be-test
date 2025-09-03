import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { SNSEvent } from 'aws-lambda';
import { getTableName } from '../../shared/config-helpers';

const dynamo = new DynamoDBClient({});
const tableName = getTableName();

export const handler = async (event: SNSEvent) => {
  console.log('Handler started', JSON.stringify(event));
  for (const record of event.Records) {
    let userId: string | undefined;
    console.log('SNS Record:', JSON.stringify(record));
    console.log('SNS Message:', record.Sns.Message);
    try {
      const payload = JSON.parse(record.Sns.Message);
      console.log('Received SNS payload:', JSON.stringify(payload));
      userId = payload.userId;
      const adyenData = payload.adyenData;
      if (!userId) {
        console.error('Payload missing userId, cannot update DynamoDB', payload);
        throw new Error('500: Missing userId in payload');
      }
      if (adyenData === undefined) {
        console.error('Payload missing adyenData, nothing to update', payload);
        throw new Error('500: Missing adyenData in payload');
      }
      await dynamo.send(new UpdateItemCommand({
        TableName: tableName,
        Key: { userId: { S: userId } },
        UpdateExpression: 'SET adyenData = :adyenData, updatedAt = :updatedAt',
        ConditionExpression: 'attribute_exists(userId)',
        ExpressionAttributeValues: {
          ':adyenData': { S: JSON.stringify(adyenData) },
          ':updatedAt': { S: new Date().toISOString() },
        },
      }));
      console.log(`Updated adyenData for userId ${userId}`);
    } catch (err: any) {
      if (err.name === 'ConditionalCheckFailedException') {
        console.error(`DynamoDB update failed: userId ${userId} does not exist.`);
      } else {
        console.error('Failed to process SNS record', err, record);
        throw err;
      }
    }
  }
}; 