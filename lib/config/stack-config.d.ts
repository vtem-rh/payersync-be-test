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
export interface StackConfig {
    readonly environment: EnvironmentConfig;
    readonly removalPolicy: RemovalPolicy;
    readonly tags: {
        [key: string]: string;
    };
    readonly adyen: AdyenConfig;
    readonly eventBridge: EventBridgeConfig;
    readonly cors: CorsConfig;
}
export declare const getStackConfig: (environment: EnvironmentConfig) => StackConfig;
