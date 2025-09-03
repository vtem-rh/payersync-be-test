/*
---
name: cdk-stack-rules.mdc
description: Best practices and rules for the main CDK stack file
globs: lib/payersync-onboarder-backend-stack.ts
---

- Keep resource names consistent with environment prefixing following the pattern: `${this.appName}-${this.config.environment.environment}-resourceName`
- Enable X-Ray tracing for all resources
- Enable CloudWatch logging for all resources
- Group related resources together (e.g., Lambda with its IAM roles)
- Use proper removal policies based on environment
- Implement comprehensive tagging for all resources
- Document complex configurations with inline comments
- Follow principle of least privilege for IAM roles
- Use environment variables for configuration
- Implement proper error handling and logging
*/

import * as dotenv from 'dotenv';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as eventbridge from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { getEnvironmentConfig } from './config/environment';
import { getStackConfig, StackConfig } from './config/stack-config';
import { cognitoEmailTemplates } from './config/email-templates';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ses from 'aws-cdk-lib/aws-ses';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigatewayv2_authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { NagSuppressions } from 'cdk-nag';
import * as customResources from 'aws-cdk-lib/custom-resources';


dotenv.config({ path: '.env.local' });

export interface PayersyncOnboarderBackendStackProps extends cdk.StackProps {
  appName: string;
}

export class PayersyncOnboarderBackendStack extends cdk.Stack {
  private readonly config: StackConfig;
  private readonly appName: string;

  constructor(scope: Construct, id: string, props: PayersyncOnboarderBackendStackProps) {
    super(scope, id, props);
    this.appName = props.appName;

    // Initialize configuration
    const envConfig = getEnvironmentConfig(this);
    this.config = getStackConfig(envConfig);

    // Apply tags to all resources in this stack
    cdk.Tags.of(this).add('Environment', this.config.environment.environment);
    cdk.Tags.of(this).add('Project', this.appName);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');

    // Create a KMS key for encrypting an API key
    const kmsKey = new kms.Key(this, 'AdyenApiKeyKmsKey', {
      enableKeyRotation: true,
      description: `KMS key for encrypting Adyen API key for ${this.appName}`,
      removalPolicy: this.config.removalPolicy,
    });

    // Create a CfnOutput for the KMS key ARN
    new cdk.CfnOutput(this, 'AdyenApiKeyKmsKeyArn', {
      value: kmsKey.keyArn,
      description: 'KMS Key ARN for encrypting Adyen API keys',
      exportName: `${this.stackName}-AdyenApiKeyKmsKeyArn`,
    });

    // Create Secrets Manager secrets for storing Adyen API keys
    const adyenLemSecret = new secretsmanager.Secret(this, 'AdyenLemApiKeySecret', {
      secretName: `${this.appName}-${this.config.environment.environment}-adyen-lem-api-key`,
      description: `Encrypted Adyen LEM API key for ${this.appName}`,
      encryptionKey: kmsKey,
      secretStringValue: cdk.SecretValue.unsafePlainText(JSON.stringify({ apiKey: this.config.adyen.lemApiKey })),
      removalPolicy: this.config.removalPolicy,
    });

    const adyenBpSecret = new secretsmanager.Secret(this, 'AdyenBpApiKeySecret', {
      secretName: `${this.appName}-${this.config.environment.environment}-adyen-bp-api-key`,
      description: `Encrypted Adyen BP API key for ${this.appName}`,
      encryptionKey: kmsKey,
      secretStringValue: cdk.SecretValue.unsafePlainText(JSON.stringify({ apiKey: this.config.adyen.bpApiKey })),
      removalPolicy: this.config.removalPolicy,
    });

    const adyenPspSecret = new secretsmanager.Secret(this, 'AdyenPspApiKeySecret', {
      secretName: `${this.appName}-${this.config.environment.environment}-adyen-psp-api-key`,
      description: `Encrypted Adyen PSP API key for ${this.appName}`,
      encryptionKey: kmsKey,
      secretStringValue: cdk.SecretValue.unsafePlainText(JSON.stringify({ apiKey: this.config.adyen.pspApiKey })),
      removalPolicy: this.config.removalPolicy,
    });

    // Note: API keys are typically rotated manually, so we're not adding automatic rotation
    // This avoids the CDK Nag warning while maintaining security best practices
    // Manual rotation can be done using the encrypt-api-key.sh script

    // Suppress CDK Nag warnings for secrets without automatic rotation (API keys are rotated manually)
    NagSuppressions.addResourceSuppressions(
      [adyenLemSecret, adyenBpSecret, adyenPspSecret],
      [
        {
          id: 'AwsSolutions-SMG4',
          reason: 'API keys are rotated manually using the encrypt-api-key.sh script for better control and security.',
        },
      ],
      true
    );

    // Create Secrets Manager secret for Adyen webhook HMAC key
    const adyenHmacSecret = new secretsmanager.Secret(this, 'AdyenHmacSecret', {
      secretName: `${this.appName}-${this.config.environment.environment}-adyen-hmac-secret`,
      description: `Adyen HMAC secret for webhook validation for ${this.appName}`,
      encryptionKey: kmsKey,
      secretStringValue: cdk.SecretValue.unsafePlainText(JSON.stringify({
        hmacSecret: this.config.adyen.hmacSecret || 'hmac-secret-placeholder'
      })),
      removalPolicy: this.config.removalPolicy,
    });

    // Create Secrets Manager secret for Basic Auth credentials
    const adyenWebhookBasicAuthSecret = new secretsmanager.Secret(this, 'AdyenWebhookBasicAuthSecret', {
      secretName: `${this.appName}-${this.config.environment.environment}-adyen-webhook-basic-auth`,
      description: `Basic Auth credentials for Adyen webhook endpoint for ${this.appName}`,
      encryptionKey: kmsKey,
      secretStringValue: cdk.SecretValue.unsafePlainText(JSON.stringify({
        username: this.config.adyen.webhookUsername || 'webhook-user',
        password: this.config.adyen.webhookPassword || 'webhook-password'
      })),
      removalPolicy: this.config.removalPolicy,
    });

    // Suppress CDK Nag warnings for webhook secrets without automatic rotation
    NagSuppressions.addResourceSuppressions(
      [adyenHmacSecret, adyenWebhookBasicAuthSecret],
      [
        {
          id: 'AwsSolutions-SMG4',
          reason: 'Webhook secrets are rotated manually for better control and security.',
        },
      ],
      true
    );

    // Create the Lambda function for onboarding (refactored to NodejsFunction)
    const onboardingFunction = new lambdaNodejs.NodejsFunction(this, 'OnboardingFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'src/functions/onboarding/adyenOnboarding/index.ts',
      handler: 'handler',
      functionName: `${this.appName}-${this.config.environment.environment}-adyen`,
      environment: {
        ADYEN_LEM_SECRET_NAME: adyenLemSecret.secretName,
        ADYEN_BP_SECRET_NAME: adyenBpSecret.secretName,
        ADYEN_PSP_SECRET_NAME: adyenPspSecret.secretName,
        ADYEN_BP_API_URL: this.config.adyen.bpApiUrl,
        ADYEN_MANAGEMENT_API_URL: this.config.adyen.managementApiUrl,
        ADYEN_LEM_API_URL: this.config.adyen.lemApiUrl,
        ADYEN_MERCHANT_ACCOUNT: this.config.adyen.merchantAccount,
        NODE_ENV: this.config.environment.isDev ? 'development' : 'production',
      },
      timeout: cdk.Duration.seconds(3),
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant the Lambda function permission to use the KMS key
    kmsKey.grantDecrypt(onboardingFunction);

    // Grant Secrets Manager permissions to the Lambda function
    adyenLemSecret.grantRead(onboardingFunction);
    adyenBpSecret.grantRead(onboardingFunction);
    adyenPspSecret.grantRead(onboardingFunction);


    // SNS Topics for lead_event and onboarded_event
    const leadEventTopic = new sns.Topic(this, 'LeadEventTopic', {
      topicName: `${this.appName}-${this.config.environment.environment}-lead-event`,
      displayName: 'Lead Event Topic',
    });
    leadEventTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['sns:Publish'],
        resources: [leadEventTopic.topicArn],
        conditions: {
          Bool: { 'aws:SecureTransport': 'false' },
        },
      })
    );

    const onboardedEventTopic = new sns.Topic(this, 'OnboardedEventTopic', {
      topicName: `${this.appName}-${this.config.environment.environment}-onboarded-event`,
      displayName: 'Onboarded Event Topic',
    });
    onboardedEventTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['sns:Publish'],
        resources: [onboardedEventTopic.topicArn],
        conditions: {
          Bool: { 'aws:SecureTransport': 'false' },
        },
      })
    );

    // Allow PMB to subscribe to onboarded event topic
    onboardedEventTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowCrossAccountSubscription',
        effect: iam.Effect.ALLOW,
        principals: [new iam.AccountPrincipal(this.config.pmb.awsAccountId)],
        actions: [
          'sns:Subscribe',
          'sns:GetTopicAttributes',
        ],
        resources: [onboardedEventTopic.topicArn],
      })
    );

    // Create SNS topic for group step completed events
    const groupStepCompletedTopic = new sns.Topic(this, 'GroupStepCompletedTopic', {
      topicName: `${this.appName}-${this.config.environment.environment}-group-step-completed`,
      displayName: 'Group Step Completed Event Topic',
    });
    groupStepCompletedTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['sns:Publish'],
        resources: [groupStepCompletedTopic.topicArn],
        conditions: {
          Bool: { 'aws:SecureTransport': 'false' },
        },
      })
    );

    // VPC, Security Group, and RDS PostgreSQL Database commented out
    /*
    // Create VPC for RDS (required for RDS in CDK)
    const vpc = new ec2.Vpc(this, 'OnboardingVPC', {
      maxAzs: 2, // Use 2 AZs for cost optimization
      natGateways: 1, // Use 1 NAT gateway to reduce costs
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // Add VPC Flow Logs for security monitoring
    vpc.addFlowLog('OnboardingVPCFlowLog', {
      trafficType: ec2.FlowLogTrafficType.ALL,
      destination: ec2.FlowLogDestination.toCloudWatchLogs(),
    });

    // Create Security Group for RDS
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'OnboardingDBSecurityGroup', {
      vpc,
      description: 'Security group for onboarding reporting database',
      allowAllOutbound: true,
    });

    // Allow Lambda to connect to RDS - more restrictive than 0.0.0.0/0
    dbSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
      'Allow Lambda to connect to PostgreSQL from VPC CIDR'
    );

    // Create RDS PostgreSQL Database
    const onboardingDB = new rds.DatabaseInstance(this, 'OnboardingReportingDB', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_13_21,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO), // Smallest instance for cost
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [dbSecurityGroup],
      databaseName: 'onboarding_reporting',
      credentials: rds.Credentials.fromGeneratedSecret('postgres', {
        secretName: `${this.appName}-${this.config.environment.environment}-db-credentials`,
      }),
      backupRetention: cdk.Duration.days(7),
      deletionProtection: this.config.environment.isProd,
      removalPolicy: this.config.removalPolicy,
      storageEncrypted: true,
      monitoringInterval: cdk.Duration.minutes(1),
      enablePerformanceInsights: false, // Disable for cost savings
      autoMinorVersionUpgrade: true,
      publiclyAccessible: false,
      allocatedStorage: 20, // Minimum storage for cost optimization
      maxAllocatedStorage: 100, // Allow auto-scaling up to 100GB
      // Enable Multi-AZ for production environments
      multiAz: this.config.environment.isProd,
    });
    */

    // Create DynamoDB table with consistent naming and X-Ray
    const onboardingTable = new dynamodb.Table(this, 'UserOnboardingTable', {
      tableName: `${this.appName}-${this.config.environment.environment}-onboarding`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: this.config.removalPolicy,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    onboardingTable.addGlobalSecondaryIndex({
      indexName: 'AccountHolderIdIndex',
      partitionKey: { name: 'accountHolderId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    // Create Lambda function for handling payload POST/GET requests
    const payloadHandler = new lambdaNodejs.NodejsFunction(this, 'PayloadHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'src/functions/onboarding/payloadHandler/index.ts',
      handler: 'handler',
      functionName: `${this.appName}-${this.config.environment.environment}-payload-handler`,
      // vpc commented out - no database access needed
      // vpcSubnets commented out - no database access needed
      environment: {
        APP_NAME: this.appName,
        ENVIRONMENT: this.config.environment.environment,
        NODE_ENV: this.config.environment.isDev ? 'dev' : 'prod',
        ADYEN_ONBOARDING_FUNCTION_NAME: onboardingFunction.functionName,
        // Database environment variables commented out
        // DB_SECRET_ARN: onboardingDB.secret?.secretArn || '',
        // DB_HOST: onboardingDB.instanceEndpoint.hostname,
        // DB_PORT: onboardingDB.instanceEndpoint.port.toString(),
        // DB_NAME: 'onboarding_reporting',
      },
      bundling: {
        externalModules: [],
        nodeModules: ['@smithy/service-error-classification'],
        minify: true,
        sourceMap: true,
      },
      timeout: cdk.Duration.seconds(3),
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant DynamoDB permissions to the Lambda function
    onboardingTable.grantReadWriteData(payloadHandler);
    // Grant payloadHandler permission to invoke onboardingFunction
    onboardingFunction.grantInvoke(payloadHandler);

    // Database permissions commented out
    // onboardingDB.grantConnect(payloadHandler);
    // onboardingDB.secret?.grantRead(payloadHandler);



    // Database initialization custom resource commented out
    /*
    // Create Custom Resource Lambda for database initialization
    const dbInitCustomResourceFunction = new lambdaNodejs.NodejsFunction(this, 'DatabaseInitCustomResourceFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'src/functions/onboarding/dbInit/custom-resource-handler.ts',
      handler: 'handler',
      functionName: `${this.appName}-${this.config.environment.environment}-db-init-custom-resource`,
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      environment: {
        DB_SECRET_ARN: onboardingDB.secret?.secretArn || '',
        DB_HOST: onboardingDB.instanceEndpoint.hostname,
        DB_PORT: onboardingDB.instanceEndpoint.port.toString(),
        DB_NAME: 'onboarding_reporting',
      },
      timeout: cdk.Duration.minutes(5), // Longer timeout for DB operations
      memorySize: 512, // More memory for database operations
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant database permissions to custom resource function
    onboardingDB.grantConnect(dbInitCustomResourceFunction);
    onboardingDB.secret?.grantRead(dbInitCustomResourceFunction);

    // Create Custom Resource to trigger database initialization
    const dbInitCustomResource = new customResources.Provider(this, 'DatabaseInitProvider', {
      onEventHandler: dbInitCustomResourceFunction,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Create the Custom Resource
    new cdk.CustomResource(this, 'DatabaseInitCustomResource', {
      serviceToken: dbInitCustomResource.serviceToken,
      properties: {
        // Add a timestamp to ensure the resource is updated on each deployment
        // This ensures the database initialization runs even if the database already exists
        Timestamp: new Date().toISOString(),
      },
    });

    // Make the Custom Resource depend on the database being available
    dbInitCustomResource.node.addDependency(onboardingDB);
    */

    // Create Lambda function for DynamoDB stream (on update)
    const onboardingTableStreamHandler = new lambdaNodejs.NodejsFunction(
      this,
      'OnboardingTableStreamHandler',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: 'src/functions/onboarding/onboardingTableStreamHandler/index.ts',
        handler: 'handler',
        functionName: `${this.appName}-${this.config.environment.environment}-dynamo-stream-handler`,
        environment: {
          APP_NAME: this.appName,
          ENVIRONMENT: this.config.environment.environment,
          ONBOARDED_EVENT_TOPIC_ARN: onboardedEventTopic.topicArn,
          GROUP_STEP_COMPLETED_TOPIC_ARN: groupStepCompletedTopic.topicArn,
        },
        timeout: cdk.Duration.seconds(3),
        tracing: lambda.Tracing.ACTIVE,
        logRetention: logs.RetentionDays.ONE_WEEK,
      }
    );

    // Grant Lambda permissions to read from the stream
    onboardingTable.grantStreamRead(onboardingTableStreamHandler);
    onboardedEventTopic.grantPublish(onboardingTableStreamHandler);
    groupStepCompletedTopic.grantPublish(onboardingTableStreamHandler);

    // Add event source mapping from DynamoDB stream to Lambda with enhanced configuration
    onboardingTableStreamHandler.addEventSource(
      new DynamoEventSource(onboardingTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 10,
        enabled: true,
        bisectBatchOnError: true,
        retryAttempts: 3,
        maxRecordAge: cdk.Duration.hours(24),
        reportBatchItemFailures: true,
      })
    );

    // Create Lambda function for handling GET requests separately
    const getPayloadHandler = new lambdaNodejs.NodejsFunction(this, 'GetPayloadHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'src/functions/onboarding/getPayloadHandler/index.ts',
      handler: 'handler',
      functionName: `${this.appName}-${this.config.environment.environment}-get-payload-handler`,
      environment: {
        APP_NAME: this.appName,
        ENVIRONMENT: this.config.environment.environment,
        NODE_ENV: this.config.environment.isDev ? 'dev' : 'prod',
      },
      bundling: {
        externalModules: [],
        nodeModules: ['@smithy/service-error-classification'],
        minify: true,
        sourceMap: true,
      },
      timeout: cdk.Duration.seconds(3),
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant DynamoDB read permissions to the GetPayloadHandler
    onboardingTable.grantReadData(getPayloadHandler);

    // Create Lambda function for generating Adyen onboarding links
    const generateOnboardingLinkHandler = new lambdaNodejs.NodejsFunction(this, 'GenerateOnboardingLinkHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'src/functions/onboarding/adyenOnboarding/generateOnboardingLink.ts',
      handler: 'handler',
      functionName: `${this.appName}-${this.config.environment.environment}-generate-onboarding-link`,
      environment: {
        APP_NAME: this.appName,
        ENVIRONMENT: this.config.environment.environment,
        ADYEN_LEM_SECRET_NAME: adyenLemSecret.secretName,
        ADYEN_BP_SECRET_NAME: adyenBpSecret.secretName,
        ADYEN_PSP_SECRET_NAME: adyenPspSecret.secretName,
        DEFAULT_REDIRECT_URL: this.config.environment.uiDomain,
        ADYEN_BP_API_URL: this.config.adyen.bpApiUrl,
        ADYEN_MANAGEMENT_API_URL: this.config.adyen.managementApiUrl,
        ADYEN_LEM_API_URL: this.config.adyen.lemApiUrl,
        NODE_ENV: 'production',
      },
      bundling: {
        externalModules: [],
        nodeModules: ['@smithy/service-error-classification'],
        minify: true,
        sourceMap: true,
      },
      timeout: cdk.Duration.seconds(15), // Longer timeout for Adyen API calls
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant DynamoDB read and write permissions to the GenerateOnboardingLinkHandler
    onboardingTable.grantReadWriteData(generateOnboardingLinkHandler);

    // Grant the generate link Lambda function permission to use the KMS key
    kmsKey.grantDecrypt(generateOnboardingLinkHandler);

    // Grant Secrets Manager permissions for the generate link Lambda function
    adyenLemSecret.grantRead(generateOnboardingLinkHandler);
    adyenBpSecret.grantRead(generateOnboardingLinkHandler);
    adyenPspSecret.grantRead(generateOnboardingLinkHandler);

    // Create S3 bucket for access logs
    const accessLogsBucket = new s3.Bucket(this, 'AdyenWebhookAccessLogsBucket', {
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: this.config.removalPolicy,
      enforceSSL: true,
      lifecycleRules: [
        {
          id: 'AccessLogsRetention',
          enabled: true,
          expiration: cdk.Duration.days(90), // Keep access logs for 90 days
        },
      ],
    });

    // Create S3 bucket for storing webhook payloads
    const webhookBucket = new s3.Bucket(this, 'AdyenWebhookBucket', {
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: this.config.removalPolicy,
      enforceSSL: true, // Require SSL for all requests
      serverAccessLogsBucket: accessLogsBucket, // Enable server access logs
      serverAccessLogsPrefix: 'webhook-bucket-logs/',
      lifecycleRules: [
        {
          id: 'WebhookRetention',
          enabled: true,
          expiration: cdk.Duration.days(365), // Keep webhooks for 1 year
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
    });

    // Create CfnOutputs for the S3 bucket names
    new cdk.CfnOutput(this, 'AdyenWebhookBucketName', {
      value: webhookBucket.bucketName,
      description: 'Name of the S3 bucket for storing Adyen webhook payloads',
      exportName: `${this.stackName}-AdyenWebhookBucketName`,
    });

    new cdk.CfnOutput(this, 'AdyenWebhookAccessLogsBucketName', {
      value: accessLogsBucket.bucketName,
      description: 'Name of the S3 bucket for storing Adyen webhook access logs',
      exportName: `${this.stackName}-AdyenWebhookAccessLogsBucketName`,
    });

    // Create Lambda function for Adyen webhook handler
    const adyenWebhookHandler = new lambdaNodejs.NodejsFunction(this, 'AdyenWebhookHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'src/functions/onboarding/adyenWebhookHandler/index.ts',
      handler: 'handler',
      functionName: `${this.appName}-${this.config.environment.environment}-adyen-webhook-handler`,
      environment: {
        ADYEN_HMAC_SECRET_NAME: adyenHmacSecret.secretName,
        WEBHOOK_S3_BUCKET_NAME: webhookBucket.bucketName,
        NODE_ENV: this.config.environment.isDev ? 'development' : 'production',
        AWS_XRAY_GROUP_NAME: `${this.appName}-${this.config.environment.environment}-webhooks`,
      },
      timeout: cdk.Duration.seconds(10),
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Create Lambda function for Basic Auth authorizer
    const adyenWebhookAuthorizer = new lambdaNodejs.NodejsFunction(this, 'AdyenWebhookAuthorizer', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'src/functions/onboarding/adyenWebhookAuthorizer/index.ts',
      handler: 'handler',
      functionName: `${this.appName}-${this.config.environment.environment}-adyen-webhook-authorizer`,
      environment: {
        ADYEN_WEBHOOK_BASIC_AUTH_SECRET_NAME: adyenWebhookBasicAuthSecret.secretName,
        NODE_ENV: this.config.environment.isDev ? 'development' : 'production',
        AWS_XRAY_GROUP_NAME: `${this.appName}-${this.config.environment.environment}-webhooks`,
      },
      timeout: cdk.Duration.seconds(3),
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Create Lambda function for webhook health check
    const adyenWebhookHealthCheck = new lambdaNodejs.NodejsFunction(this, 'AdyenWebhookHealthCheck', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'src/functions/onboarding/adyenWebhookHealthCheck/index.ts',
      handler: 'handler',
      functionName: `${this.appName}-${this.config.environment.environment}-adyen-webhook-health-check`,
      environment: {
        NODE_ENV: this.config.environment.isDev ? 'development' : 'production',
        AWS_XRAY_GROUP_NAME: `${this.appName}-${this.config.environment.environment}-webhooks`,
      },
      timeout: cdk.Duration.seconds(3),
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant permissions to webhook handler
    kmsKey.grantDecrypt(adyenWebhookHandler);
    adyenHmacSecret.grantRead(adyenWebhookHandler);
    webhookBucket.grantWrite(adyenWebhookHandler);

    // Grant permissions to webhook authorizer
    kmsKey.grantDecrypt(adyenWebhookAuthorizer);
    adyenWebhookBasicAuthSecret.grantRead(adyenWebhookAuthorizer);

    // ===== EventBridge Resources =====

    // Create CloudWatch Log Group for EventBridge
    const eventBridgeLogGroup = new logs.LogGroup(this, 'EventBridgeLogGroup', {
      logGroupName: `/aws/events/${this.config.eventBridge.webhookBusName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: this.config.removalPolicy,
    });

    // Create custom EventBridge bus for Adyen webhooks with logging enabled
    const adyenWebhookBus = new eventbridge.EventBus(this, 'AdyenWebhookBus', {
      eventBusName: this.config.eventBridge.webhookBusName,
    });

    // Enable EventBridge logging to CloudWatch
    const eventBridgeLoggingRule = new eventbridge.Rule(this, 'EventBridgeLoggingRule', {
      eventBus: adyenWebhookBus,
      ruleName: `${this.config.eventBridge.webhookBusName}-logging-rule`,
      description: 'Logs all events on the Adyen webhook bus for monitoring and debugging',
      eventPattern: {
        source: ['adyen.webhook'],
      },
      targets: [
        new targets.CloudWatchLogGroup(eventBridgeLogGroup),
      ],
    });

    // Create Dead Letter Queues for each processor with logging enabled
    const standardNotificationDLQ = new sqs.Queue(this, 'StandardNotificationDLQ', {
      queueName: `${this.appName}-${this.config.environment.environment}-standard-notification-dlq`,
      retentionPeriod: cdk.Duration.days(14),
      removalPolicy: this.config.removalPolicy,
      enforceSSL: true, // Require SSL for all requests
      visibilityTimeout: cdk.Duration.minutes(5),
      receiveMessageWaitTime: cdk.Duration.seconds(20),
    });

    const kycNotificationDLQ = new sqs.Queue(this, 'KycNotificationDLQ', {
      queueName: `${this.appName}-${this.config.environment.environment}-kyc-notification-dlq`,
      retentionPeriod: cdk.Duration.days(14),
      removalPolicy: this.config.removalPolicy,
      enforceSSL: true, // Require SSL for all requests
      visibilityTimeout: cdk.Duration.minutes(5),
      receiveMessageWaitTime: cdk.Duration.seconds(20),
    });

    const transferNotificationDLQ = new sqs.Queue(this, 'TransferNotificationDLQ', {
      queueName: `${this.appName}-${this.config.environment.environment}-transfer-notification-dlq`,
      retentionPeriod: cdk.Duration.days(14),
      removalPolicy: this.config.removalPolicy,
      enforceSSL: true, // Require SSL for all requests
      visibilityTimeout: cdk.Duration.minutes(5),
      receiveMessageWaitTime: cdk.Duration.seconds(20),
    });

    // Create processor Lambda functions
    const standardNotificationHandler = new lambdaNodejs.NodejsFunction(this, 'StandardNotificationHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'src/functions/onboarding/standardNotificationHandler/index.ts',
      handler: 'handler',
      functionName: `${this.appName}-${this.config.environment.environment}-standard-notification-handler`,
      // vpc commented out - no database access needed
      // vpcSubnets commented out - no database access needed
      environment: {
        NODE_ENV: this.config.environment.isDev ? 'development' : 'production',
        AWS_XRAY_GROUP_NAME: `${this.appName}-${this.config.environment.environment}-webhooks`,
        // Database environment variables commented out
        // DB_SECRET_ARN: onboardingDB.secret?.secretArn || '',
        // DB_HOST: onboardingDB.instanceEndpoint.hostname,
        // DB_PORT: onboardingDB.instanceEndpoint.port.toString(),
        // DB_NAME: 'onboarding_reporting',
      },
      bundling: {
        externalModules: ['pg'],
        nodeModules: ['@smithy/service-error-classification'],
        minify: true,
        sourceMap: true,
      },
      timeout: cdk.Duration.seconds(30),
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
      deadLetterQueue: standardNotificationDLQ,
      maxEventAge: cdk.Duration.minutes(5),
      retryAttempts: 2,
    });

    const kycNotificationHandler = new lambdaNodejs.NodejsFunction(this, 'KycNotificationHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'src/functions/onboarding/kycNotificationHandler/index.ts',
      handler: 'handler',
      functionName: `${this.appName}-${this.config.environment.environment}-kyc-notification-handler`,
      // vpc commented out - no database access needed
      // vpcSubnets commented out - no database access needed
      environment: {
        NODE_ENV: this.config.environment.isDev ? 'development' : 'production',
        AWS_XRAY_GROUP_NAME: `${this.appName}-${this.config.environment.environment}-webhooks`,
        // Database environment variables commented out
        // DB_SECRET_ARN: onboardingDB.secret?.secretArn || '',
        // DB_HOST: onboardingDB.instanceEndpoint.hostname,
        // DB_PORT: onboardingDB.instanceEndpoint.port.toString(),
        // DB_NAME: 'onboarding_reporting',
      },
      bundling: {
        externalModules: ['pg'],
        nodeModules: ['@smithy/service-error-classification'],
        minify: true,
        sourceMap: true,
      },
      timeout: cdk.Duration.seconds(30),
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
      deadLetterQueue: kycNotificationDLQ,
      maxEventAge: cdk.Duration.minutes(5),
      retryAttempts: 2,
    });

    const transferNotificationHandler = new lambdaNodejs.NodejsFunction(this, 'TransferNotificationHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'src/functions/onboarding/transferNotificationHandler/index.ts',
      handler: 'handler',
      functionName: `${this.appName}-${this.config.environment.environment}-transfer-notification-handler`,
      // vpc commented out - no database access needed
      // vpcSubnets commented out - no database access needed
      environment: {
        NODE_ENV: this.config.environment.isDev ? 'development' : 'production',
        AWS_XRAY_GROUP_NAME: `${this.appName}-${this.config.environment.environment}-webhooks`,
        // Database environment variables commented out
        // DB_SECRET_ARN: onboardingDB.secret?.secretArn || '',
        // DB_HOST: onboardingDB.instanceEndpoint.hostname,
        // DB_PORT: onboardingDB.instanceEndpoint.port.toString(),
        // DB_NAME: 'onboarding_reporting',
      },
      bundling: {
        externalModules: ['pg'],
        nodeModules: ['@smithy/service-error-classification'],
        minify: true,
        sourceMap: true,
      },
      timeout: cdk.Duration.seconds(30),
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
      deadLetterQueue: transferNotificationDLQ,
      maxEventAge: cdk.Duration.minutes(5),
      retryAttempts: 2,
    });

    // Create Lambda function for onboarding completion handler
    const onboardingCompletionHandler = new lambdaNodejs.NodejsFunction(this, 'OnboardingCompletionHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'src/functions/onboarding/onboardingCompletionHandler/index.ts',
      handler: 'handler',
      functionName: `${this.appName}-${this.config.environment.environment}-onboarding-completion-handler`,
      environment: {
        APP_NAME: this.appName,
        ENVIRONMENT: this.config.environment.environment,
        ADYEN_LEM_SECRET_NAME: adyenLemSecret.secretName,
        ADYEN_BP_SECRET_NAME: adyenBpSecret.secretName,
        ADYEN_PSP_SECRET_NAME: adyenPspSecret.secretName,
        ADYEN_BP_API_URL: this.config.adyen.bpApiUrl,
        ADYEN_MANAGEMENT_API_URL: this.config.adyen.managementApiUrl,
        ADYEN_LEM_API_URL: this.config.adyen.lemApiUrl,
        NODE_ENV: this.config.environment.isDev ? 'development' : 'production',
      },
      timeout: cdk.Duration.seconds(30),
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Create EventBridge rules for routing events
    const standardNotificationRule = new eventbridge.Rule(this, 'StandardNotificationRule', {
      eventBus: adyenWebhookBus,
      ruleName: this.config.eventBridge.standardNotificationRuleName,
      description: 'Routes standard Adyen webhook notifications to standard notification handler',
      eventPattern: {
        source: ['adyen.webhook'],
        detailType: ['adyen.webhook'],
        detail: {
          notificationType: ['standard'],
        },
      },
      targets: [
        new targets.LambdaFunction(standardNotificationHandler, {
          retryAttempts: 2,
          maxEventAge: cdk.Duration.minutes(5),
        }),
      ],
    });

    const kycNotificationRule = new eventbridge.Rule(this, 'KycNotificationRule', {
      eventBus: adyenWebhookBus,
      ruleName: this.config.eventBridge.kycNotificationRuleName,
      description: 'Routes KYC-related Adyen webhook notifications to KYC notification handler',
      eventPattern: {
        source: ['adyen.webhook'],
        detailType: ['adyen.webhook'],
        detail: {
          notificationType: ['kyc'],
        },
      },
      targets: [
        new targets.LambdaFunction(kycNotificationHandler, {
          retryAttempts: 2,
          maxEventAge: cdk.Duration.minutes(5),
        }),
      ],
    });

    const transferNotificationRule = new eventbridge.Rule(this, 'TransferNotificationRule', {
      eventBus: adyenWebhookBus,
      ruleName: this.config.eventBridge.transferNotificationRuleName,
      description: 'Routes transfer-related Adyen webhook notifications to transfer notification handler',
      eventPattern: {
        source: ['adyen.webhook'],
        detailType: ['adyen.webhook'],
        detail: {
          notificationType: ['transfer'],
        },
      },
      targets: [
        new targets.LambdaFunction(transferNotificationHandler, {
          retryAttempts: 2,
          maxEventAge: cdk.Duration.minutes(5),
        }),
      ],
    });

    const balancePlatformNotificationRule = new eventbridge.Rule(this, 'BalancePlatformNotificationRule', {
      eventBus: adyenWebhookBus,
      ruleName: this.config.eventBridge.balancePlatformNotificationRuleName,
      description: 'Routes all Adyen webhook notifications to onboarding completion handler for filtering',
      eventPattern: {
        source: ['adyen.webhook'],
        detailType: ['adyen.webhook'],
      },
      targets: [
        new targets.LambdaFunction(onboardingCompletionHandler, {
          retryAttempts: 2,
          maxEventAge: cdk.Duration.minutes(5),
        }),
      ],
    });

        // Database permissions commented out for notification handlers
    // onboardingDB.grantConnect(standardNotificationHandler);
    // onboardingDB.secret?.grantRead(standardNotificationHandler);

    // onboardingDB.grantConnect(kycNotificationHandler);
    // onboardingDB.secret?.grantRead(kycNotificationHandler);

    // onboardingDB.grantConnect(transferNotificationHandler);
    // onboardingDB.secret?.grantRead(transferNotificationHandler);

    // Grant permissions to onboarding completion handler
    onboardingTable.grantReadWriteData(onboardingCompletionHandler);
    kmsKey.grantDecrypt(onboardingCompletionHandler);
    adyenBpSecret.grantRead(onboardingCompletionHandler);
    adyenLemSecret.grantRead(onboardingCompletionHandler);
    adyenPspSecret.grantRead(onboardingCompletionHandler);

    // Grant EventBridge permissions to the webhook handler
    adyenWebhookHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'events:PutEvents',
        ],
        resources: [adyenWebhookBus.eventBusArn],
      })
    );

    // Add EventBridge bus name to webhook handler environment
    adyenWebhookHandler.addEnvironment('EVENT_BUS_NAME', adyenWebhookBus.eventBusName);

    // Create CloudWatch Log Group for API Gateway access logs
    const apiAccessLogGroup = new logs.LogGroup(this, 'ApiAccessLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: this.config.removalPolicy,
    });

    // Explicitly grant API Gateway permission to write to the log group
    apiAccessLogGroup.grantWrite(new iam.ServicePrincipal('apigateway.amazonaws.com'));


    // todo create verification code ses config
    // Create SES configuration
    const sesConfigurationSet = new ses.ConfigurationSet(this, 'CognitoSESConfig', {
      configurationSetName: `${this.appName}-${this.config.environment.environment}-cognito-ses`,
    });


    // Create Cognito User Pool
    const userPool = new cognito.UserPool(this, 'PayerSyncUserPool', {
      userPoolName: `${this.appName}-${this.config.environment.environment}-user-pool`,
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        givenName: {
          required: true,
          mutable: true,
        },
        familyName: {
          required: true,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: this.config.removalPolicy,
      autoVerify: this.config.environment.isDev ? { email: true } : undefined,
      // Use SES for email sending
      // TODO: Uncomment when payersync domain is verified with SES in the main AWS account
      // email: cognito.UserPoolEmail.withSES({
      //   fromEmail: 'noreply@payersync.com',
      //   fromName: 'PayerSync',
      //   replyTo: 'care@payersync.com',
      //   configurationSetName: sesConfigurationSet.configurationSetName,
      // }),
      userVerification: {
        emailSubject: cognitoEmailTemplates.userVerification.subject,
        emailBody: cognitoEmailTemplates.userVerification.body,
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      userInvitation: {
        emailSubject: cognitoEmailTemplates.userInvitation.subject,
        emailBody: cognitoEmailTemplates.userInvitation.body,
      },
    });

    // Force the user pool ID to match what Cognito uses in tokens
    const cfnUserPool = userPool.node.defaultChild as cognito.CfnUserPool;
    cfnUserPool.overrideLogicalId('PayerSyncUserPoolgehGg1hgM');

    const userPoolClient = userPool.addClient('PayerSyncClient', {
      userPoolClientName: `${this.appName}-${this.config.environment.environment}-client`,
      authFlows: {
        userPassword: true,
        userSrp: true,
        adminUserPassword: true,
      },
      oAuth: {
        flows: {
          implicitCodeGrant: true,
          authorizationCodeGrant: true,
        },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.COGNITO_ADMIN,
        ],
      },
      accessTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(30),
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
    });

    // Create Cognito Authorizer for HTTP API
    const httpApiAuthorizer = new apigatewayv2_authorizers.HttpUserPoolAuthorizer('PayloadAuthorizer', userPool, {
      userPoolClients: [userPoolClient],
      identitySource: ['$request.header.Authorization'],
    });

    // Create HTTP API with CORS
    const httpApi = new apigatewayv2.HttpApi(this, 'PayersyncHttpApi', {
      apiName: `${this.appName}-${this.config.environment.environment}-http-api`,
      corsPreflight: {
        allowOrigins: this.config.cors.allowedOrigins,
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['Content-Type', 'Authorization'],
        allowCredentials: true,
      },
      defaultIntegration: undefined
    });

    // Lambda integration for POST /payload
    httpApi.addRoutes({
      path: '/payload',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('PayloadHandlerIntegration', payloadHandler),
      authorizer: httpApiAuthorizer,
    });

    // Lambda integration for GET /payload
    httpApi.addRoutes({
      path: '/payload',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration('GetPayloadHandlerIntegration', getPayloadHandler),
      authorizer: httpApiAuthorizer,
    });

    // Lambda integration for generated Hosted Onboarding Link
    httpApi.addRoutes({
      path: '/generate-link',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('GenerateOnboardingLinkIntegration', generateOnboardingLinkHandler),
      authorizer: httpApiAuthorizer,
    });

    // Legacy webhook endpoint removed - now using protected REST API endpoint

    // Output the HTTP API URL
    new cdk.CfnOutput(this, 'HttpApiUrl', {
      value: httpApi.apiEndpoint,
      description: 'HTTP API Gateway URL',
    });

    // Update the generate link handler with the API endpoint
    generateOnboardingLinkHandler.addEnvironment('API_ENDPOINT', httpApi.apiEndpoint);

    // Create REST API Gateway for webhook endpoint (supports Basic Auth)
    const restApi = new apigateway.RestApi(this, 'AdyenWebhookRestApi', {
      restApiName: `${this.appName}-${this.config.environment.environment}-webhook-rest-api`,
      description: 'REST API Gateway for Adyen webhook endpoint with Basic Auth',
      defaultCorsPreflightOptions: {
        allowOrigins: this.config.cors.allowedOrigins,
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization'],
        allowCredentials: true,
      },
      deployOptions: {
        stageName: 'prod',
        tracingEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        accessLogDestination: new apigateway.LogGroupLogDestination(apiAccessLogGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
      },
    });

    // Create Lambda Authorizer for Basic Auth
    const basicAuthAuthorizer = new apigateway.TokenAuthorizer(this, 'BasicAuthAuthorizer', {
      handler: adyenWebhookAuthorizer,
      identitySource: 'method.request.header.Authorization',
      resultsCacheTtl: cdk.Duration.minutes(5),
    });

    // Create webhook resource and methods
    const webhookResource = restApi.root.addResource('adyen').addResource('webhook');
    
    // POST method for webhook notifications (requires Basic Auth)
    const webhookMethod = webhookResource.addMethod('POST', new apigateway.LambdaIntegration(adyenWebhookHandler), {
      authorizer: basicAuthAuthorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      requestParameters: {
        'method.request.header.Authorization': true,
      },
    });

    // GET method for health checks (no auth required)
    const webhookHealthCheckMethod = webhookResource.addMethod('GET', new apigateway.LambdaIntegration(adyenWebhookHealthCheck), {
      authorizationType: apigateway.AuthorizationType.NONE,
    });

    // Suppress cdk-nag false positive for COG4 (webhook endpoints don't use Cognito)
    NagSuppressions.addResourceSuppressions(
      webhookMethod,
      [
        {
          id: 'AwsSolutions-COG4',
          reason: 'Webhook endpoints use Basic Auth for external service authentication, not Cognito user pool authorizer.',
        },
      ],
      true
    );

    // Suppress cdk-nag false positive for COG4 on health check method (no auth required for health checks)
    NagSuppressions.addResourceSuppressions(
      webhookHealthCheckMethod,
      [
        {
          id: 'AwsSolutions-COG4',
          reason: 'Health check endpoints do not require authentication as they are used for service health monitoring.',
        },
      ],
      true
    );

    // Output the REST API URL
    new cdk.CfnOutput(this, 'WebhookRestApiUrl', {
      value: restApi.url,
      description: 'REST API Gateway URL for Adyen webhook',
    });

    // Enable access logging for HTTP API default stage (cdk-nag compliance)
    const defaultStage = httpApi.defaultStage!;
    const cfnStage = defaultStage.node.defaultChild as apigatewayv2.CfnStage;
    cfnStage.addPropertyOverride('AccessLogSettings', {
      DestinationArn: apiAccessLogGroup.logGroupArn,
      Format: JSON.stringify({
        requestId: "$context.requestId",
        httpMethod: "$context.httpMethod",
        path: "$context.path",
        status: "$context.status",
        protocol: "$context.protocol",
        responseLength: "$context.responseLength",
        ip: "$context.identity.sourceIp",
        userAgent: "$context.identity.userAgent",
        requestTime: "$context.requestTime",
      }),
    });

    // TODO: Enable X-Ray tracing for HTTP API default stage when proper property is identified
    // cfnStage.addPropertyOverride('DefaultRouteSettings.TracingEnabled', true);

    // Suppress cdk-nag false positive for APIG1 (access logging)
    NagSuppressions.addResourceSuppressions(
      cfnStage,
      [
        {
          id: 'AwsSolutions-APIG1',
          reason: 'Access logging is enabled via property override and log group permissions are correct.',
        },
      ],
      true
    );

    // Create Lambda for Cognito PostConfirmation trigger
    const postConfirmationFunction = new lambdaNodejs.NodejsFunction(
      this,
      'CognitoPostConfirmationFunction',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: 'src/functions/onboarding/cognitoPostConfirmation/index.ts',
        handler: 'handler',
        functionName: `${this.appName}-${this.config.environment.environment}-post-confirmation`,
        environment: {
          LEAD_EVENT_TOPIC_ARN: leadEventTopic.topicArn,
          NODE_ENV: this.config.environment.isDev ? 'development' : 'production',
        },
        timeout: cdk.Duration.seconds(3),
        memorySize: 256,
        tracing: lambda.Tracing.ACTIVE,
        logRetention: logs.RetentionDays.ONE_WEEK,
      }
    );

    // Grant SNS publish permissions
    leadEventTopic.grantPublish(postConfirmationFunction);

    // Add basic Lambda execution role permissions
    postConfirmationFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: ['*'],
      })
    );

    // Attach Lambda as PostConfirmation trigger to Cognito User Pool
    userPool.addTrigger(cognito.UserPoolOperation.POST_CONFIRMATION, postConfirmationFunction);

    // Create Lambda function for reporting
    const reportingHandler = new lambdaNodejs.NodejsFunction(this, 'ReportingHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'src/functions/reporting/index.ts',
      handler: 'handler',
      functionName: `${this.appName}-${this.config.environment.environment}-reporting-handler`,
      // vpc commented out - no database access needed
      // vpcSubnets commented out - no database access needed
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
        // Database environment variables commented out
        // DB_SECRET_ARN: onboardingDB.secret?.secretArn || '',
        // DB_HOST: onboardingDB.instanceEndpoint.hostname,
        // DB_PORT: onboardingDB.instanceEndpoint.port.toString(),
        // DB_NAME: 'onboarding_reporting',
        NODE_ENV: this.config.environment.isDev ? 'dev' : 'prod',
      },
      bundling: {
        externalModules: ['pg'],
        nodeModules: ['@smithy/service-error-classification'],
        minify: true,
        sourceMap: true,
      },
      timeout: cdk.Duration.seconds(30), // Longer timeout for database queries
      memorySize: 512, // More memory for complex queries
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Database permissions commented out for reporting handler
    // onboardingDB.grantConnect(reportingHandler);
    // onboardingDB.secret?.grantRead(reportingHandler);

    // Create Lambda function for test data management
    const testDataHandler = new lambdaNodejs.NodejsFunction(this, 'TestDataHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'src/functions/test-data-handler/index.ts',
      handler: 'handler',
      functionName: `${this.appName}-${this.config.environment.environment}-test-data-handler`,
      // vpc commented out - no database access needed
      // vpcSubnets commented out - no database access needed
      environment: {
        // Database environment variables commented out
        // DB_SECRET_ARN: onboardingDB.secret?.secretArn || '',
        // DB_HOST: onboardingDB.instanceEndpoint.hostname,
        // DB_PORT: onboardingDB.instanceEndpoint.port.toString(),
        // DB_NAME: 'onboarding_reporting',
        NODE_ENV: this.config.environment.isDev ? 'dev' : 'prod',
      },
      bundling: {
        externalModules: ['pg'],
        nodeModules: ['@smithy/service-error-classification'],
        minify: true,
        sourceMap: true,
      },
      timeout: cdk.Duration.seconds(30), // Longer timeout for database operations
      memorySize: 512, // More memory for database operations
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Database permissions commented out for test data handler
    // onboardingDB.grantConnect(testDataHandler);
    // onboardingDB.secret?.grantRead(testDataHandler);

    // Add reporting API routes
    httpApi.addRoutes({
      path: '/reporting/schema',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration('ReportingSchemaIntegration', reportingHandler),
      authorizer: httpApiAuthorizer,
    });

    httpApi.addRoutes({
      path: '/reporting/schema/{tableName}',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration('ReportingSchemaTableIntegration', reportingHandler),
      authorizer: httpApiAuthorizer,
    });

    httpApi.addRoutes({
      path: '/reporting/data',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration('ReportingDataIntegration', reportingHandler),
      authorizer: httpApiAuthorizer,
    });

    httpApi.addRoutes({
      path: '/reporting/stats',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration('ReportingStatsIntegration', reportingHandler),
      authorizer: httpApiAuthorizer,
    });

    httpApi.addRoutes({
      path: '/reporting/stats/analytics',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration('ReportingAnalyticsIntegration', reportingHandler),
      authorizer: httpApiAuthorizer,
    });

    // Create IAM user for Zapier
    const zapierUser = new iam.User(this, 'ZapierSnsUser', {
      userName: `${this.appName}-${this.config.environment.environment}-zapier-sns`,
    });

    // Create access key for Zapier user
    const zapierAccessKey = new iam.CfnAccessKey(this, 'ZapierAccessKey', {
      userName: zapierUser.userName,
    });

    // Create policy for Zapier to access SNS topic
    const zapierSnsPolicy = new iam.Policy(this, 'ZapierSnsPolicy', {
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'sns:GetTopicAttributes',
            'sns:Subscribe',
            'sns:Unsubscribe',
            'sns:ListTopics',
            'sns:ListSubscriptionsByTopic',
            'sns:ConfirmSubscription'
          ],
          resources: [leadEventTopic.topicArn, groupStepCompletedTopic.topicArn],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['sns:ListTopics'],
          resources: ['*'],
        }),
      ],
    });

    // Attach policy to Zapier user
    zapierUser.attachInlinePolicy(zapierSnsPolicy);

    // Outputs
    new cdk.CfnOutput(this, 'KmsKeyArn', {
      value: kmsKey.keyArn,
      description: 'KMS Key ARN for encrypting API key',
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    new cdk.CfnOutput(this, 'Region', {
      value: this.region,
      description: 'AWS Region',
    });

    new cdk.CfnOutput(this, 'LeadEventTopicArn', {
      value: leadEventTopic.topicArn,
      description: 'SNS Topic ARN for lead_event',
    });

    new cdk.CfnOutput(this, 'OnboardedEventTopicArn', {
      value: onboardedEventTopic.topicArn,
      description: 'SNS Topic ARN for onboarded_event',
    });

    new cdk.CfnOutput(this, 'GroupStepCompletedTopicArn', {
      value: groupStepCompletedTopic.topicArn,
      description: 'SNS Topic ARN for group_step_completed',
    });

    // Add new outputs for Zapier credentials
    new cdk.CfnOutput(this, 'ZapierAccessKeyId', {
      value: zapierAccessKey.ref,
      description: 'AWS Access Key ID for Zapier integration',
    });

    new cdk.CfnOutput(this, 'ZapierSecretAccessKey', {
      value: zapierAccessKey.attrSecretAccessKey,
      description: 'AWS Secret Access Key for Zapier integration',
    });
    // EventBridge outputs
    new cdk.CfnOutput(this, 'AdyenWebhookEventBusName', {
      value: adyenWebhookBus.eventBusName,
      description: 'EventBridge bus name for Adyen webhook events',
    });

    new cdk.CfnOutput(this, 'AdyenWebhookEventBusArn', {
      value: adyenWebhookBus.eventBusArn,
      description: 'EventBridge bus ARN for Adyen webhook events',
    });

    new cdk.CfnOutput(this, 'StandardNotificationDLQUrl', {
      value: standardNotificationDLQ.queueUrl,
      description: 'Dead Letter Queue URL for standard notification handler',
    });

    new cdk.CfnOutput(this, 'KycNotificationDLQUrl', {
      value: kycNotificationDLQ.queueUrl,
      description: 'Dead Letter Queue URL for KYC notification handler',
    });

    new cdk.CfnOutput(this, 'TransferNotificationDLQUrl', {
      value: transferNotificationDLQ.queueUrl,
      description: 'Dead Letter Queue URL for transfer notification handler',
    });

    // Database outputs commented out
    /*
    // Add database outputs
    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: onboardingDB.instanceEndpoint.hostname,
      description: 'RDS PostgreSQL endpoint',
    });

    new cdk.CfnOutput(this, 'DatabasePort', {
      value: onboardingDB.instanceEndpoint.port.toString(),
      description: 'RDS PostgreSQL port',
    });

    new cdk.CfnOutput(this, 'DatabaseName', {
      value: 'onboarding_reporting',
      description: 'RDS PostgreSQL database name',
    });
    */
  }
}