#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { PayersyncOnboarderBackendStack } from '../lib/payersync-onboarder-backend-stack';
import { getEnvironmentConfig } from '../lib/config/environment';
import { addCdkNagToApp, addCdkNagSuppressions } from '../lib/cdk-nag-config';

// Get environment from CDK context before loading dotenv
const app = new cdk.App();
const environment = app.node.tryGetContext('env') || 'dev';

// Load environment-specific .env file
const envFile = `.env.${environment}`;
const envPath = path.resolve(process.cwd(), envFile);

console.log(`Loading environment configuration from: ${envFile}`);

// Load the environment-specific .env file
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.warn(`Warning: Could not load ${envFile}. Using default environment variables.`);
  // Fallback to default .env if environment-specific file doesn't exist
  dotenv.config();
} else {
  console.log(`Successfully loaded environment configuration from ${envFile}`);
}

const envConfig = getEnvironmentConfig(app);
const appName = process.env.APP_NAME || 'PayerSyncOnboarder';

// Create the stack
const stack = new PayersyncOnboarderBackendStack(app, `${appName}-${envConfig.environment}-stack`, {
  env: {
    account: envConfig.account,
    region: envConfig.region,
  },
  description: `${appName} Backend Stack (${envConfig.environment})`,
  appName,
});

// Add CDK Nag to check for security and compliance issues
if (process.env.NODE_ENV !== 'test') {
  addCdkNagToApp(app);
  addCdkNagSuppressions(stack, stack.stackName);
}
