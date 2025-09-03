import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { captureAWSv3Client } from 'aws-xray-sdk-core';

interface CognitoEvent {
  userName: string;
  request: { userAttributes: { email: string; given_name?: string; family_name?: string } };
  region: string;
  triggerSource: string;
}

const snsClient = captureAWSv3Client(
  new SNSClient({
    region: process.env.AWS_REGION,
  })
);
const topicArn = process.env.LEAD_EVENT_TOPIC_ARN;

export const handler = async (event: CognitoEvent) => {
  const sanitizedEvent = {
    region: event.region,
    triggerSource: event.triggerSource,
  };
  console.log('Received Cognito event:', JSON.stringify(sanitizedEvent, null, 2));

  if (!topicArn) {
    const error = new Error('LEAD_EVENT_TOPIC_ARN environment variable is not set');
    console.error(error);
    throw error;
  }

  const { email, given_name, family_name } = event.request.userAttributes;
  const message = {
    userName: event.userName,
    email,
    givenName: given_name,
    familyName: family_name,
    eventType: 'USER_REGISTERED',
    timestamp: new Date().toISOString(),
    triggerSource: event.triggerSource,
  };

  try {
    console.log('Publishing message to SNS:', JSON.stringify(message, null, 2));
    console.log('Topic ARN:', topicArn);

    const result = await snsClient.send(
      new PublishCommand({
        TopicArn: topicArn,
        Message: JSON.stringify(message),
        Subject: 'Lead Event: User Registered',
      })
    );

    console.log('Successfully published to SNS. MessageId:', result.MessageId);
  } catch (error) {
    console.error('Failed to publish lead event to SNS:', error);
    throw error; // Re-throw to mark the Lambda execution as failed
  }

  return event;
};
