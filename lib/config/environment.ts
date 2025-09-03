import { Construct } from 'constructs';

export interface EnvironmentConfig {
  readonly environment: string;
  readonly region: string;
  readonly account: string;
  readonly isDev: boolean;
  readonly isProd: boolean;
  readonly uiDomain: string;
}

export const getEnvironmentConfig = (app: Construct): EnvironmentConfig => {
  const environment = app.node.tryGetContext('env') || 'dev';
  const region = process.env.CDK_DEFAULT_REGION || 'us-east-1';

  // Check if we're in a test environment
  const isTestEnvironment =
    process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

  // Use a default account for tests, otherwise use the environment variable
  const account = isTestEnvironment
    ? '123456789012' // Default test account ID
    : process.env.CDK_DEFAULT_ACCOUNT || '';

  if (!account && !isTestEnvironment) {
    throw new Error('CDK_DEFAULT_ACCOUNT environment variable must be set');
  }

  // Determine UI domain based on environment
  const uiDomain = process.env.CORS_ALLOWED_ORIGINS || '';

  return {
    environment,
    region,
    account,
    isDev: environment === 'dev',
    isProd: environment === 'prod',
    uiDomain,
  };
};
