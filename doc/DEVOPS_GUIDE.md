# DevOps Guide

This guide provides detailed information for DevOps engineers and infrastructure management. It assumes you've already read the main README and understand the basic deployment process.

## Advanced Deployment

### Environment-Specific Configurations

- **Development**: Uses `RemovalPolicy.DESTROY` for easy cleanup
- **Production**: Uses `RemovalPolicy.RETAIN` for data protection
- **All Environments**: Enable X-Ray tracing and CloudWatch logging

### Deployment Strategies

```bash
# Standard deployment
npm run deploy <environment>

# Hotswap for faster iterations
npm run deploy:hotswap <environment>

# Get stack outputs
npm run outputs <environment>

# Destroy stack
npm run destroy <environment>
```

### Resource Naming Convention

All resources follow: `${appName}-${environment}-resourceName`

Examples:
- `payerSyncOnboarder-dev-stack` (CloudFormation stack)
- `payerSyncOnboarder-dev-adyen-webhook-handler` (Lambda function)
- `payerSyncOnboarder-dev-adyen-lem-api-key` (Secrets Manager secret)
- `payerSyncOnboarder-dev-adyen-webhook-access-logs` (S3 bucket)
- `payerSyncOnboarder-dev-adyen-webhook-bus` (EventBridge bus)

### Infrastructure as Code Best Practices

- **Constructs**: Reusable components for common patterns
- **Environment Separation**: Clear environment-specific configurations
- **Tagging**: Comprehensive resource tagging for cost and security
- **Security**: CDK Nag for compliance and security checks

## API Gateway CloudWatch Logs Setup

**One-time setup per AWS account/region:**

```sh
bash scripts/setup-apigw-logs-role.sh
```

This creates the required IAM role for API Gateway logging.

## Monitoring and Observability

### X-Ray Tracing

Enabled for all Lambda functions:
- Distributed tracing across services
- Performance monitoring and bottleneck identification
- Request flow visualization
- Error tracking and debugging

### CloudWatch Monitoring

#### Lambda Functions
- **Invocation Counts**: Monitor function call volumes
- **Duration**: Track performance and identify bottlenecks
- **Error Rates**: Alert on function failures
- **Throttles**: Monitor concurrency limits

#### API Gateway
- **Request Counts**: Track API usage patterns
- **Latency**: Monitor response times
- **4XX/5XX Errors**: Alert on client and server errors
- **Cache Hit Rates**: Optimize caching strategies

#### EventBridge
- **Event Delivery**: Monitor success/failure rates
- **Rule Evaluation**: Track rule matching and routing
- **Target Invocation**: Monitor Lambda processor success rates
- **Performance**: Track event processing latency

#### RDS Database
- **CPU Utilization**: Monitor database performance
- **Connections**: Track connection pool usage
- **Storage**: Monitor disk space and I/O
- **Replication Lag**: Monitor Multi-AZ replication

#### SQS Dead Letter Queues
- **Message Counts**: Monitor failed event processing
- **Age of Oldest Message**: Track processing delays
- **Visibility Timeout**: Monitor message processing times

### Webhook Monitoring

#### Endpoint Health
```bash
# Check webhook endpoint status
curl -I https://your-api-id.execute-api.region.amazonaws.com/prod/adyen/webhook

# Monitor webhook logs
aws logs tail /aws/lambda/payerSyncOnboarder-{env}-adyen-webhook-handler --follow
```

#### HMAC Validation
- Monitor HMAC validation failures
- Track signature verification success rates
- Alert on suspicious webhook patterns

#### EventBridge Processing
```bash
# Monitor EventBridge logs
aws logs tail /aws/events/adyen-webhook-bus-{env} --follow

# Check processor logs
aws logs tail /aws/lambda/payerSyncOnboarder-{env}-standard-notification-handler --follow
```

### Database Monitoring

#### RDS Performance
```bash
# Check database metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name CPUUtilization \
  --dimensions Name=DBInstanceIdentifier,Value=payerSyncOnboarder-{env}-onboarding-reporting \
  --start-time $(date -d '1 hour ago' --iso-8601) \
  --end-time $(date --iso-8601) \
  --period 300 \
  --statistics Average
```

#### Database Initialization
```bash
# Monitor database initialization
aws logs tail /aws/lambda/payerSyncOnboarder-{env}-db-init-custom-resource --follow

# Check initialization status
aws cloudformation describe-stack-events \
  --stack-name payerSyncOnboarder-{env}-stack \
  --query 'StackEvents[?ResourceType==`AWS::CloudFormation::CustomResource`]'
```

### Reporting API Monitoring

#### Endpoint Health
```bash
# Test reporting endpoints
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://your-api-id.execute-api.region.amazonaws.com/reporting/schema

# Monitor reporting logs
aws logs tail /aws/lambda/payerSyncOnboarder-{env}-reporting-handler --follow
```

#### Performance Metrics
- Monitor response times for reporting queries
- Track database query performance
- Alert on slow reporting operations

## Recovery Procedures

1. **Infrastructure Recovery**: Use CDK to redeploy
2. **Data Recovery**: Restore from DynamoDB point-in-time recovery
3. **Database Recovery**: Use RDS automated backups and snapshots
4. **Configuration Recovery**: Secrets automatically restored from AWS Secrets Manager
5. **Webhook Recovery**: Replay events from S3 storage if needed

## Environment Management

### Creating New Environment
1. Update environment configuration
2. Deploy with new environment name: `npm run deploy <new-env>`
3. Configure monitoring and alerts
4. Set up webhook endpoints in Adyen dashboard
5. Update documentation

### Environment Cleanup
1. Export any needed data from DynamoDB and RDS
2. Destroy stack: `npm run destroy <environment>`
3. Clean up any manual resources (S3 buckets, etc.)
4. Remove webhook endpoints from Adyen dashboard
5. Update documentation

## Troubleshooting

### Common Deployment Issues

#### Internet Gateway Limit Exceeded
```bash
# Check current Internet Gateway count
aws ec2 describe-internet-gateways --region us-east-2 --query 'length(InternetGateways)'

# Delete unused stacks to free up resources
aws cloudformation delete-stack --stack-name unused-stack-name --region us-east-2
```

#### S3 Bucket Already Exists
```bash
# Delete conflicting bucket
aws s3 rb s3://bucket-name --force --region us-east-2

# Or use different bucket name in CDK stack
```

#### Database Initialization Failures
```bash
# Check database initialization logs
aws logs get-log-events \
  --log-group-name "/aws/lambda/payerSyncOnboarder-{env}-db-init-custom-resource" \
  --region us-east-2 \
  --start-from-head \
  --output text
```

### Webhook Issues

#### HMAC Validation Failures
```bash
# Check HMAC secret in Secrets Manager
aws secretsmanager get-secret-value \
  --secret-id payerSyncOnboarder-{env}-adyen-hmac-secret \
  --region us-east-2
```

#### EventBridge Event Routing
```bash
# Check EventBridge logs
aws logs get-log-events \
  --log-group-name "/aws/events/adyen-webhook-bus-{env}" \
  --region us-east-2 \
  --start-from-head \
  --output text
```

#### Dead Letter Queue Monitoring
```bash
# Check DLQ message counts
aws sqs get-queue-attributes \
  --queue-url "https://sqs.region.amazonaws.com/account/payerSyncOnboarder-{env}-standard-notification-dlq" \
  --attribute-names ApproximateNumberOfMessages \
  --region us-east-2
```

### Performance Issues

#### Lambda Timeouts
- Increase timeout in CDK stack
- Optimize function code
- Check external API response times

#### Database Performance
- Monitor RDS metrics
- Check connection pool usage
- Optimize database queries

#### API Gateway Latency
- Monitor API Gateway metrics
- Check Lambda cold starts
- Optimize function memory allocation

## Security Monitoring

### Secrets Management
```bash
# Rotate secrets
aws secretsmanager rotate-secret \
  --secret-id payerSyncOnboarder-{env}-adyen-lem-api-key \
  --region us-east-2
```

### IAM Access Monitoring
```bash
# Check IAM access logs
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=GetSecretValue \
  --region us-east-2
```

### SSL/TLS Compliance
- Monitor SSL certificate expiration
- Check TLS version compliance
- Alert on SSL configuration changes

## Cost Optimization

### Resource Monitoring
- Monitor Lambda execution costs
- Track RDS instance usage
- Monitor S3 storage costs
- Check EventBridge event volumes

### Optimization Strategies
- Use Lambda provisioned concurrency for critical functions
- Implement RDS read replicas for reporting queries
- Optimize S3 lifecycle policies
- Monitor and adjust resource allocations

## Alerting

### CloudWatch Alarms
Set up alarms for:
- Lambda error rates > 5%
- API Gateway 5XX errors > 1%
- RDS CPU utilization > 80%
- SQS DLQ message count > 0
- EventBridge delivery failures
- Database connection count > 80%

### SNS Notifications
Configure SNS topics for:
- Critical infrastructure failures
- Security incidents
- Performance degradation
- Cost threshold alerts
