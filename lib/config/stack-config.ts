import { EnvironmentConfig } from './environment';
import { RemovalPolicy } from 'aws-cdk-lib';

export interface AdyenConfig {
  bpApiUrl: string;
  managementApiUrl: string;
  lemApiUrl: string;
  merchantAccount: string;
  lemApiKey: string;
  bpApiKey: string;
  pspApiKey: string;
  hmacSecret?: string;
  webhookUsername?: string;
  webhookPassword?: string;
}

export interface EventBridgeConfig {
  webhookBusName: string;
  standardNotificationRuleName: string;
  kycNotificationRuleName: string;
  transferNotificationRuleName: string;
  balancePlatformNotificationRuleName: string;
}

export interface CorsConfig {
  allowedOrigins: string[];
}

export interface PmbConfig {
  awsAccountId: string;
}

export interface StackConfig {
  readonly environment: EnvironmentConfig;
  readonly removalPolicy: RemovalPolicy;
  readonly tags: { [key: string]: string };
  readonly adyen: AdyenConfig;
  readonly eventBridge: EventBridgeConfig;
  readonly cors: CorsConfig;
  readonly pmb: PmbConfig;
}

export const getStackConfig = (environment: EnvironmentConfig): StackConfig => {
  // Determine if this is a production-like environment based on the environment name
  const isProd = environment.environment === 'prod' || environment.environment === 'production';
  const envConfig = {
    ...environment,
    isProd,
    isDev: !isProd,
    tags: {
      Environment: environment.environment,
      Project: 'PayerSync',
      ManagedBy: 'CDK',
    },
  };

  // Validate required Adyen API keys from environment variables
  const adyenLemApiKey = process.env.ADYEN_LEM_API_KEY;
  const adyenBpApiKey = process.env.ADYEN_BP_API_KEY;
  const adyenPspApiKey = process.env.ADYEN_PSP_API_KEY;

  // Webhook configuration (optional for development)
  const adyenHmacSecret = process.env.ADYEN_HMAC_SECRET;
  const adyenWebhookUsername = process.env.ADYEN_WEBHOOK_USERNAME;
  const adyenWebhookPassword = process.env.ADYEN_WEBHOOK_PASSWORD;

  // Only validate API keys if we're not in a test environment and not just synthesizing
  const isTestEnvironment = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
  const isSynthesizing = process.argv.includes('synth') || process.argv.includes('diff') || process.argv.includes('bootstrap');
  
  if (!isTestEnvironment && !isSynthesizing && (!adyenLemApiKey || !adyenBpApiKey || !adyenPspApiKey)) {
    throw new Error(
      'Missing required Adyen API keys in environment variables. Please set ADYEN_LEM_API_KEY, ADYEN_BP_API_KEY, and ADYEN_PSP_API_KEY.'
    );
  }

  // Use environment variables for Adyen configuration
  const adyenBpApiUrl = process.env.ADYEN_BP_API_URL || 'https://test-bp.adyen.com';
  const adyenManagementApiUrl = process.env.ADYEN_MANAGEMENT_API_URL || 'https://management-test.adyen.com';
  const adyenLemApiUrl = process.env.ADYEN_LEM_API_URL || 'https://test-lem.adyen.com';
  const adyenMerchantAccount = process.env.ADYEN_MERCHANT_ACCOUNT || 'TestMerchantAccount';

  // Default CORS origins if not provided in environment
  const defaultCorsOrigins = 'http://localhost:3000,https://test.d4tu0pbfxi4ui.amplifyapp.com';
  const corsAllowedOrigins = process.env.CORS_ALLOWED_ORIGINS || defaultCorsOrigins;

  // Log a warning if we're using default values for non-critical configuration
  if (!process.env.ADYEN_BP_API_URL || !process.env.ADYEN_MANAGEMENT_API_URL || 
      !process.env.ADYEN_LEM_API_URL || !process.env.ADYEN_MERCHANT_ACCOUNT) {
    console.warn('Warning: Using default values for some Adyen configuration. Consider setting ADYEN_BP_API_URL, ADYEN_MANAGEMENT_API_URL, ADYEN_LEM_API_URL, and ADYEN_MERCHANT_ACCOUNT for production environments.');
  }
  
  if (!process.env.CORS_ALLOWED_ORIGINS) {
    console.warn('Warning: Using default CORS allowed origins. Consider setting CORS_ALLOWED_ORIGINS for production environments.');
  }

  return {
    removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    environment: envConfig,
    tags: envConfig.tags,
    adyen: {
      bpApiUrl: adyenBpApiUrl,
      managementApiUrl: adyenManagementApiUrl,
      lemApiUrl: adyenLemApiUrl,
      merchantAccount: adyenMerchantAccount,
      lemApiKey: adyenLemApiKey || 'placeholder-lem-api-key',
      bpApiKey: adyenBpApiKey || 'placeholder-bp-api-key',
      pspApiKey: adyenPspApiKey || 'placeholder-psp-api-key',
      hmacSecret: adyenHmacSecret,
      webhookUsername: adyenWebhookUsername,
      webhookPassword: adyenWebhookPassword,
    },
    eventBridge: {
      webhookBusName: `adyen-webhook-bus-${environment.environment}`,
      standardNotificationRuleName: `standard-notification-rule-${environment.environment}`,
      kycNotificationRuleName: `kyc-notification-rule-${environment.environment}`,
      transferNotificationRuleName: `transfer-notification-rule-${environment.environment}`,
      balancePlatformNotificationRuleName: `balance-platform-notification-rule-${environment.environment}`,
    },
    cors: {
      allowedOrigins: corsAllowedOrigins.split(',')
    },
    pmb: {
      awsAccountId: process.env.PMB_AWS_ACCOUNT_ID || '969105443985', // rh-prod-account
    }
  };
};
