# Deployment Troubleshooting Guide

This document provides solutions for common deployment issues encountered with the PayerSync Onboarder Backend.

## Common Deployment Issues

### 1. Internet Gateway Limit Exceeded

**Error Message:**
```
The maximum number of internet gateways has been reached. (Service: Ec2, Status Code: 400)
```

**Cause:** AWS has a limit of 5 Internet Gateways per region. Each VPC in your CDK stack creates an Internet Gateway.

**Solution:**

#### Check Current Internet Gateway Count
```bash
aws ec2 describe-internet-gateways --region us-east-2 --query 'length(InternetGateways)'
```

#### List All Internet Gateways
```bash
aws ec2 describe-internet-gateways --region us-east-2 --query 'InternetGateways[*].[InternetGatewayId,Tags[?Key==`Name`].Value|[0]]' --output table
```

#### Delete Unused Stacks
```bash
# List all stacks
aws cloudformation list-stacks --region us-east-2 --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --query 'StackSummaries[?contains(StackName, `payerSyncOnboarder`)].{Name:StackName,Status:StackStatus}' --output table

# Delete unused stack
aws cloudformation delete-stack --stack-name payerSyncOnboarder-unused-stack --region us-east-2

# Wait for deletion to complete
aws cloudformation wait stack-delete-complete --stack-name payerSyncOnboarder-unused-stack --region us-east-2
```

#### Alternative: Use Existing VPC
Modify the CDK stack to import an existing VPC instead of creating a new one:

```typescript
// In lib/payersync-onboarder-backend-stack.ts
const existingVpc = ec2.Vpc.fromLookup(this, 'ExistingVPC', {
  vpcId: 'vpc-xxxxxxxxx' // Use existing VPC ID
});
```

### 2. S3 Bucket Already Exists

**Error Message:**
```
payersynconboarder-staging-adyen-webhook-access-logs already exists (Service: S3, Status Code: 0)
```

**Cause:** S3 bucket names are globally unique. The bucket already exists from a previous deployment.

**Solution:**

#### Delete Existing Bucket
```bash
# List all objects in bucket
aws s3 ls s3://payersynconboarder-staging-adyen-webhook-access-logs --recursive

# Delete all objects (if versioning is enabled)
aws s3api delete-objects --bucket payersynconboarder-staging-adyen-webhook-access-logs --delete "$(aws s3api list-object-versions --bucket payersynconboarder-staging-adyen-webhook-access-logs --output json --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}')"

# Delete delete markers
aws s3api delete-objects --bucket payersynconboarder-staging-adyen-webhook-access-logs --delete "$(aws s3api list-object-versions --bucket payersynconboarder-staging-adyen-webhook-access-logs --output json --query '{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}')"

# Delete bucket
aws s3 rb s3://payersynconboarder-staging-adyen-webhook-access-logs --force
```

#### Alternative: Use Different Bucket Name
Modify the CDK stack to use a different bucket name:

```typescript
// In lib/payersync-onboarder-backend-stack.ts
const accessLogsBucket = new s3.Bucket(this, 'AdyenWebhookAccessLogsBucket', {
  bucketName: `${this.appName.toLowerCase()}-${this.config.environment.environment}-adyen-webhook-access-logs-${Date.now()}`, // Add timestamp
  // ... other configuration
});
```

### 3. Database Initialization Failures

**Error Message:**
```
Database initialization failed: connection timeout
```

**Cause:** Lambda function cannot connect to RDS database due to VPC or security group issues.

**Solution:**

#### Check VPC Configuration
```bash
# Check VPC status
aws ec2 describe-vpcs --vpc-ids vpc-xxxxxxxxx --query 'Vpcs[0].State'

# Check security groups
aws ec2 describe-security-groups --group-ids sg-xxxxxxxxx --query 'SecurityGroups[0].IpPermissions'
```

#### Check Lambda VPC Configuration
```bash
# Check Lambda function VPC configuration
aws lambda get-function --function-name payerSyncOnboarder-staging-db-init-custom-resource --query 'Configuration.VpcConfig'
```

#### Check Database Status
```bash
# Check RDS instance status
aws rds describe-db-instances --db-instance-identifier payerSyncOnboarder-staging-onboarding-reporting --query 'DBInstances[0].DBInstanceStatus'
```

#### Check Database Initialization Logs
```bash
# Check initialization logs
aws logs get-log-events \
  --log-group-name "/aws/lambda/payerSyncOnboarder-staging-db-init-custom-resource" \
  --region us-east-2 \
  --start-from-head \
  --output text
```

### 4. Secrets Manager Permission Issues

**Error Message:**
```
AccessDenied: User: arn:aws:sts::account:assumed-role/... is not authorized to perform: secretsmanager:GetSecretValue
```

**Cause:** Lambda function doesn't have permission to access Secrets Manager.

**Solution:**

#### Check IAM Permissions
```bash
# Check Lambda execution role
aws lambda get-function --function-name payerSyncOnboarder-staging-adyen-webhook-handler --query 'Configuration.Role'

# Check role policies
aws iam list-attached-role-policies --role-name payerSyncOnboarder-staging-adyen-webhook-handler-role
```

#### Grant Secrets Manager Permissions
```bash
# Attach Secrets Manager policy
aws iam attach-role-policy \
  --role-name payerSyncOnboarder-staging-adyen-webhook-handler-role \
  --policy-arn arn:aws:iam::aws:policy/SecretsManagerReadWrite
```

### 5. EventBridge Permission Issues

**Error Message:**
```
AccessDenied: User: ... is not authorized to perform: events:PutEvents
```

**Cause:** Lambda function doesn't have permission to publish events to EventBridge.

**Solution:**

#### Check EventBridge Permissions
```bash
# Check Lambda role policies
aws iam list-role-policies --role-name payerSyncOnboarder-staging-adyen-webhook-handler-role

# Check inline policies
aws iam get-role-policy \
  --role-name payerSyncOnboarder-staging-adyen-webhook-handler-role \
  --policy-name EventBridgePolicy
```

#### Grant EventBridge Permissions
```bash
# Add EventBridge permissions to Lambda role
aws iam put-role-policy \
  --role-name payerSyncOnboarder-staging-adyen-webhook-handler-role \
  --policy-name EventBridgePolicy \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": "events:PutEvents",
        "Resource": "arn:aws:events:us-east-2:account:event-bus/adyen-webhook-bus-staging"
      }
    ]
  }'
```

### 6. Lambda Timeout Issues

**Error Message:**
```
Task timed out after 3.00 seconds
```

**Cause:** Lambda function is taking too long to complete.

**Solution:**

#### Increase Lambda Timeout
```typescript
// In lib/payersync-onboarder-backend-stack.ts
const webhookHandler = new lambdaNodejs.NodejsFunction(this, 'AdyenWebhookHandler', {
  // ... other configuration
  timeout: cdk.Duration.seconds(30), // Increase from 10 to 30 seconds
  memorySize: 1024, // Increase memory if needed
});
```

#### Optimize Function Code
- Use connection pooling for database operations
- Implement async/await properly
- Cache frequently accessed data
- Use batch operations where possible

### 7. Cognito Configuration Issues

**Error Message:**
```
Invalid JWT token: Token is not from a supported provider
```

**Cause:** Cognito user pool configuration doesn't match the JWT token.

**Solution:**

#### Check Cognito Configuration
```bash
# Check user pool configuration
aws cognito-idp describe-user-pool --user-pool-id us-east-2_xxxxxxxxx

# Check user pool client
aws cognito-idp describe-user-pool-client \
  --user-pool-id us-east-2_xxxxxxxxx \
  --client-id xxxxxxxxxxxxxxxxxxxxxxxxxx
```

#### Verify JWT Token
```bash
# Decode JWT token (without verification)
echo "YOUR_JWT_TOKEN" | cut -d. -f2 | base64 -d | jq .

# Check token issuer and audience
```

### 8. API Gateway Configuration Issues

**Error Message:**
```
{"message": "Internal server error"}
```

**Cause:** API Gateway integration is not properly configured.

**Solution:**

#### Check API Gateway Configuration
```bash
# Check HTTP API configuration
aws apigatewayv2 get-api --api-id xxxxxxxxxx

# Check routes
aws apigatewayv2 get-routes --api-id xxxxxxxxxx

# Check integrations
aws apigatewayv2 get-integrations --api-id xxxxxxxxxx
```

#### Check Lambda Integration
```bash
# Check Lambda function exists
aws lambda get-function --function-name payerSyncOnboarder-staging-payload-handler

# Check Lambda permissions for API Gateway
aws lambda get-policy --function-name payerSyncOnboarder-staging-payload-handler
```

## Pre-Deployment Checklist

### 1. Environment Variables
```bash
# Check required environment variables
echo "ADYEN_LEM_API_KEY: ${ADYEN_LEM_API_KEY:+SET}"
echo "ADYEN_BP_API_KEY: ${ADYEN_BP_API_KEY:+SET}"
echo "ADYEN_PSP_API_KEY: ${ADYEN_PSP_API_KEY:+SET}"
echo "ADYEN_HMAC_SECRET: ${ADYEN_HMAC_SECRET:+SET}"
echo "ADYEN_WEBHOOK_USERNAME: ${ADYEN_WEBHOOK_USERNAME:+SET}"
echo "ADYEN_WEBHOOK_PASSWORD: ${ADYEN_WEBHOOK_PASSWORD:+SET}"
```

### 2. AWS Resources
```bash
# Check Internet Gateway count
aws ec2 describe-internet-gateways --region us-east-2 --query 'length(InternetGateways)'

# Check existing stacks
aws cloudformation list-stacks --region us-east-2 --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --query 'StackSummaries[?contains(StackName, `payerSyncOnboarder`)].StackName'

# Check S3 buckets
aws s3 ls | grep payersynconboarder
```

### 3. CDK Context
```bash
# Clean CDK cache if needed
rm -rf cdk.context.json cdk.out

# Re-synthesize stack
npx cdk synth
```

## Deployment Commands

### Standard Deployment
```bash
# Deploy to specific environment
npm run deploy staging

# Deploy with hotswap (faster for development)
npm run deploy:hotswap staging
```

### Troubleshooting Deployment
```bash
# Check deployment status
aws cloudformation describe-stacks \
  --stack-name payerSyncOnboarder-staging-stack \
  --region us-east-2 \
  --query 'Stacks[0].StackStatus'

# Check stack events
aws cloudformation describe-stack-events \
  --stack-name payerSyncOnboarder-staging-stack \
  --region us-east-2 \
  --query 'StackEvents[?ResourceStatus==`CREATE_FAILED`]'
```

### Rollback Deployment
```bash
# Rollback to previous version
aws cloudformation rollback-stack \
  --stack-name payerSyncOnboarder-staging-stack \
  --region us-east-2

# Or delete and redeploy
aws cloudformation delete-stack \
  --stack-name payerSyncOnboarder-staging-stack \
  --region us-east-2
```

## Post-Deployment Verification

### 1. Check Stack Outputs
```bash
# Get stack outputs
npm run outputs staging

# Or use AWS CLI
aws cloudformation describe-stacks \
  --stack-name payerSyncOnboarder-staging-stack \
  --region us-east-2 \
  --query 'Stacks[0].Outputs'
```

### 2. Test API Endpoints
```bash
# Test webhook endpoint
curl -I https://your-api-id.execute-api.region.amazonaws.com/prod/adyen/webhook

# Test reporting endpoint
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://your-api-id.execute-api.region.amazonaws.com/reporting/schema
```

### 3. Check Lambda Functions
```bash
# List all Lambda functions
aws lambda list-functions \
  --region us-east-2 \
  --query 'Functions[?contains(FunctionName, `payerSyncOnboarder-staging`)].FunctionName'
```

### 4. Check Database
```bash
# Check RDS instance
aws rds describe-db-instances \
  --db-instance-identifier payerSyncOnboarder-staging-onboarding-reporting \
  --query 'DBInstances[0].DBInstanceStatus'
```

## Monitoring and Alerts

### CloudWatch Alarms
Set up alarms for:
- Lambda error rates > 5%
- API Gateway 5XX errors > 1%
- RDS CPU utilization > 80%
- EventBridge delivery failures

### Log Monitoring
```bash
# Monitor webhook logs
aws logs tail /aws/lambda/payerSyncOnboarder-staging-adyen-webhook-handler --follow

# Monitor EventBridge logs
aws logs tail /aws/events/adyen-webhook-bus-staging --follow

# Monitor database initialization
aws logs tail /aws/lambda/payerSyncOnboarder-staging-db-init-custom-resource --follow
```

## Emergency Procedures

### 1. Complete Rollback
```bash
# Delete entire stack
aws cloudformation delete-stack \
  --stack-name payerSyncOnboarder-staging-stack \
  --region us-east-2

# Wait for deletion
aws cloudformation wait stack-delete-complete \
  --stack-name payerSyncOnboarder-staging-stack \
  --region us-east-2

# Redeploy from scratch
npm run deploy staging
```

### 2. Data Recovery
```bash
# Export DynamoDB data
aws dynamodb scan \
  --table-name payerSyncOnboarder-staging-onboarding \
  --region us-east-2 > backup.json

# Create RDS snapshot
aws rds create-db-snapshot \
  --db-instance-identifier payerSyncOnboarder-staging-onboarding-reporting \
  --db-snapshot-identifier backup-$(date +%Y%m%d-%H%M%S)
```

### 3. Emergency Contact
- **DevOps Team**: For infrastructure issues
- **Development Team**: For application issues
- **AWS Support**: For AWS service issues

## Best Practices

### 1. Deployment Strategy
- Use blue-green deployment for production
- Test deployments in staging first
- Use hotswap for development iterations
- Monitor deployments closely

### 2. Resource Management
- Clean up unused resources regularly
- Monitor resource limits and usage
- Use appropriate resource sizing
- Implement cost optimization

### 3. Security
- Rotate secrets regularly
- Monitor access logs
- Use least privilege permissions
- Implement proper authentication

### 4. Monitoring
- Set up comprehensive logging
- Use X-Ray for tracing
- Monitor performance metrics
- Set up alerts for critical issues 