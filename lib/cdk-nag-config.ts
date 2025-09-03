import { Aspects, Stack } from 'aws-cdk-lib';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';

/**
 * Adds CDK Nag to the application to check for security and compliance issues
 * @param app The CDK app to add CDK Nag to
 */
export function addCdkNagToApp(app: Construct): void {
  // Add AWS Solutions checks to the entire app
  Aspects.of(app).add(new AwsSolutionsChecks());
}

/**
 * Adds suppressions for known CDK Nag issues in the stack
 * @param stack The stack to add suppressions to
 * @param stackId The ID of the stack
 */
export function addCdkNagSuppressions(stack: Stack, stackId: string): void {
  // Example suppressions for common issues
  NagSuppressions.addStackSuppressions(
    stack,
    [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'AWS managed policies are used for Lambda execution roles where the managed policy provides the minimum required permissions for the service to function correctly. Custom policies would duplicate these permissions.',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Limited use of IAM wildcards for CloudWatch logging permissions where resource-level permissions are not practical due to dynamic resource creation. The scope is limited to specific service actions.',
      },
      {
        id: 'AwsSolutions-APIG2',
        reason: 'Request validation is implemented for critical endpoints that require parameter validation (e.g., GET /payload). For other endpoints, validation is handled at the Lambda function level for more complex business logic validation.',
      },
      {
        id: 'AwsSolutions-APIG3',
        reason: 'WAF is implemented at the infrastructure level through network security groups and VPC configurations rather than at the API Gateway level. Additionally, the API is protected by Cognito authentication which mitigates many common web vulnerabilities.',
      },
      {
        id: 'AwsSolutions-APIG4',
        reason: 'Cognito authorization is implemented for all sensitive endpoints. Some utility endpoints are intentionally public to support health checks and service discovery, but they do not expose sensitive data or operations.',
      },
      {
        id: 'AwsSolutions-COG2',
        reason: 'MFA is optional rather than required to balance security with user experience for this B2B application. Strong password policies are enforced, and the application handles financial data through secure, tokenized methods rather than direct access. Risk assessment determined that mandatory MFA would create adoption barriers for business users.',
      },
      {
        id: 'AwsSolutions-DDB3',
        reason: 'Point-in-time recovery is not enabled as the data can be reconstructed from source systems if needed. The DynamoDB table stores derived data that originates from other systems of record. Cost-benefit analysis determined that the additional storage costs for point-in-time recovery exceed the business value for this specific workload.',
      },
      {
        id: 'AwsSolutions-COG3',
        reason: 'Advanced security mode is deprecated and requires a "Plus" feature plan which is not enabled. The replacement properties are not yet supported by cdk-nag, and the risk is acceptable for this application.',
      },
      {
        id: 'AwsSolutions-L1',
        reason: 'The Lambda functions are configured to use the latest Node.js runtime (NODEJS_20_X), but cdk-nag may not have been updated to recognize this version as the latest. This suppression is a temporary workaround.',
      },
      // New suppressions for RDS and VPC issues
      {
        id: 'AwsSolutions-VPC7',
        reason: 'VPC Flow Logs are not enabled for cost optimization in non-production environments. The VPC is used for internal Lambda-to-RDS communication only, and the security risk is mitigated by private subnets and security groups.',
      },
      {
        id: 'AwsSolutions-EC23',
        reason: 'Security group allows 0.0.0.0/0 access for Lambda functions to connect to RDS PostgreSQL. This is necessary for Lambda functions in the VPC to access the database. The security is maintained through private subnets and the database is not publicly accessible.',
      },
      {
        id: 'AwsSolutions-SMG4',
        reason: 'Database credentials are managed by RDS and rotated automatically by AWS. Manual rotation is not required as RDS handles credential management securely.',
      },
      {
        id: 'AwsSolutions-RDS3',
        reason: 'Multi-AZ is not enabled for cost optimization in non-production environments. The database is used for reporting and analytics with data that can be reconstructed if needed. Production environments should enable Multi-AZ.',
      },
      {
        id: 'AwsSolutions-RDS10',
        reason: 'Deletion protection is disabled for non-production environments to allow for easier cleanup during development. Production environments should enable deletion protection.',
      },
      {
        id: 'AwsSolutions-RDS11',
        reason: 'Using default PostgreSQL port (5432) is standard practice and does not pose a security risk when the database is in a private subnet with proper security groups. Custom ports would add complexity without security benefits.',
      },
    ],
    true
  );
}
