import { Construct } from 'constructs';
export interface EnvironmentConfig {
    readonly environment: string;
    readonly region: string;
    readonly account: string;
    readonly isDev: boolean;
    readonly isProd: boolean;
    readonly uiDomain: string;
}
export declare const getEnvironmentConfig: (app: Construct) => EnvironmentConfig;
