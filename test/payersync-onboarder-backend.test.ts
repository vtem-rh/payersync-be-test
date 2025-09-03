import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { PayersyncOnboarderBackendStack } from '../lib/payersync-onboarder-backend-stack';
import { App } from 'aws-cdk-lib';

// Helper function to normalize S3Keys in the template
function normalizeS3Keys(template: any): any {
  const normalizedTemplate = JSON.parse(JSON.stringify(template));

  // Function to recursively search and replace S3Keys
  function replaceS3Keys(obj: any) {
    if (!obj || typeof obj !== 'object') return;

    if (obj.S3Key && typeof obj.S3Key === 'string' && obj.S3Key.endsWith('.zip')) {
      obj.S3Key = 'normalized-s3-key.zip';
    }

    // Process all properties recursively
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        replaceS3Keys(obj[key]);
      }
    }
  }

  replaceS3Keys(normalizedTemplate);
  return normalizedTemplate;
}

describe('PayersyncOnboarderBackendStack', () => {
  let app: cdk.App;
  let stack: PayersyncOnboarderBackendStack;
  let template: any;

  // Set up environment for tests
  beforeAll(() => {
    // Set NODE_ENV to test to ensure we use test defaults
    process.env.NODE_ENV = 'test';
  });

  beforeEach(() => {
    // Create a new app context for each test
    app = new cdk.App({
      context: {
        environment: 'dev',
      },
    });

    // Create the stack with test configuration
    stack = new PayersyncOnboarderBackendStack(app, 'TestStack', {
      appName: 'myApp',
    });

    // Get the template from the mocked Template.fromStack method
    template = Template.fromStack(stack);
  });

  test('Stack contains expected resources and properties', () => {
    // Normalize S3Keys before assertions
    const normalizedTemplate = normalizeS3Keys(template.toJSON());
    // Print the output for debugging CI vs local differences
    // eslint-disable-next-line no-console
    console.log('Normalized Template Output:', JSON.stringify(normalizedTemplate, null, 2));

    // Use CDK assertions for key resources
    template.hasResourceProperties('AWS::KMS::Key', {
      EnableKeyRotation: true,
      Description: 'KMS key for encrypting Adyen API key for myApp',
    });

    template.hasResourceProperties('AWS::SSM::Parameter', {
      Description: expect.any(String),
      Type: 'String',
    });

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'myApp-dev-onboarding',
      BillingMode: 'PAY_PER_REQUEST',
    });

    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.handler',
      Runtime: 'nodejs20.x',
    });

    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
      Name: 'myApp-dev-api',
    });

    template.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolName: 'myApp-dev-user-pool',
    });
  });
});
