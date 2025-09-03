import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { captureAWSv3Client } from 'aws-xray-sdk-core';
import { AdyenWebhookEvent } from './types';

const eventBridgeClient = captureAWSv3Client(new EventBridgeClient({}));

export class EventBridgeService {
  private readonly eventBusName: string;

  constructor(eventBusName: string) {
    this.eventBusName = eventBusName;
  }

  async emitWebhookEvent(webhookEvent: AdyenWebhookEvent): Promise<void> {
    const event = {
      Source: 'adyen.webhook',
      DetailType: 'adyen.webhook',
      Detail: JSON.stringify(webhookEvent),
      EventBusName: this.eventBusName,
    };

    const command = new PutEventsCommand({
      Entries: [event],
    });

    const result = await eventBridgeClient.send(command);

    if (result.FailedEntryCount && result.FailedEntryCount > 0) {
      console.error('Failed to emit EventBridge event:', result.Entries);
      throw new Error(`Failed to emit EventBridge event: ${JSON.stringify(result.Entries)}`);
    }
  }

  async emitMultipleWebhookEvents(webhookEvents: AdyenWebhookEvent[]): Promise<void> {
    if (webhookEvents.length === 0) {
      return;
    }

    const events = webhookEvents.map(webhookEvent => ({
      Source: 'adyen.webhook',
      DetailType: 'adyen.webhook',
      Detail: JSON.stringify(webhookEvent),
      EventBusName: this.eventBusName,
    }));

    const command = new PutEventsCommand({
      Entries: events,
    });

    const result = await eventBridgeClient.send(command);

    if (result.FailedEntryCount && result.FailedEntryCount > 0) {
      console.error('Failed to emit some EventBridge events:', result.Entries);
      throw new Error(`Failed to emit ${result.FailedEntryCount} EventBridge events: ${JSON.stringify(result.Entries)}`);
    }
  }
} 