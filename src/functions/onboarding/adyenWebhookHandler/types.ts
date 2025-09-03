export interface NotificationRequestItem {
  additionalData?: {
    hmacSignature?: string;
    [key: string]: any;
  };
  amount?: {
    currency: string;
    value: number;
  };
  eventCode?: string;
  eventDate?: string;
  merchantAccountCode?: string;
  merchantReference?: string;
  pspReference?: string;
  reason?: string;
  success?: string;
  // Optional fields that may exist in some webhooks
  paymentMethod?: string;
  operations?: any[];
  // Additional fields that might be present in KYC events
  accountHolderCode?: string;
  accountHolderId?: string;
  accountHolderStatus?: string;
  verificationStatus?: string;
  verificationType?: string;
  // Adyen's actual payload structure
  type?: string;
  id?: string;
  timestamp?: string;
  environment?: string;
  data?: {
    balancePlatform?: string;
    id?: string;
    accountHolder?: {
      id?: string;
      status?: string;
      contactDetails?: any;
      description?: string;
      legalEntityId?: string;
      timeZone?: string;
      capabilities?: any;
    };
  };
  // Generic field for any additional data
  [key: string]: any;
}

export interface AdyenWebhookPayload {
  live?: string;
  notificationItems?: Array<{
    NotificationRequestItem: NotificationRequestItem;
  }>;
  notifications?: Array<{
    notification: NotificationRequestItem;
  }>;
  items?: Array<{
    item: NotificationRequestItem;
  }>;
  // Generic field for any additional data
  [key: string]: any;
}

export interface AdyenWebhookEvent {
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
  eventDate?: string;
  reason?: string;
  paymentMethod?: string;
  operations?: any[];
  // KYC specific fields
  accountHolderCode?: string;
  accountHolderId?: string;
  accountHolderStatus?: string;
  verificationStatus?: string;
  verificationType?: string;
  originalPayload: AdyenWebhookPayload;
  webhookId: string;
  timestamp: string;
  s3Key: string; // S3 key for linking to raw webhook payload
}

export interface WebhookLogData {
  eventCode: string;
  pspReference: string;
  merchantAccountCode: string;
  notificationType: string;
  live?: string;
  timestamp: string;
  webhookId: string;
}

export enum NotificationType {
  STANDARD = 'standard',
  KYC = 'kyc',
  TRANSFER = 'transfer',
  BALANCE_PLATFORM = 'balancePlatform'
}

 