/**
 * Shared configuration helpers for Lambda functions
 * Provides centralized access to environment configuration
 */

export interface EnvironmentConfig {
  appName: string;
  environment: string;
  nodeEnv: string;
}

/**
 * Gets environment configuration from Lambda environment variables
 */
export function getEnvironmentConfig(): EnvironmentConfig {
  const appName = process.env.APP_NAME;
  const environment = process.env.ENVIRONMENT;
  const nodeEnv = process.env.NODE_ENV || 'production';

  if (!appName) {
    throw new Error('APP_NAME environment variable is not set');
  }
  
  if (!environment) {
    throw new Error('ENVIRONMENT environment variable is not set');
  }

  return {
    appName,
    environment,
    nodeEnv,
  };
}

/**
 * Constructs the DynamoDB table name using the standard naming convention
 */
export function getTableName(): string {
  const { appName, environment } = getEnvironmentConfig();
  return `${appName}-${environment}-onboarding`;
}
