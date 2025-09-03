# EventBridge Integration Architecture

## Overview

The Adyen webhook integration now includes an asynchronous event processing pipeline using AWS EventBridge. This architecture provides:

- **Reliable Event Processing**: Events are emitted to EventBridge after successful webhook validation
- **Event Routing**: Content-based routing to specialized processors
- **Idempotency**: Each processor handles duplicate events gracefully
- **Comprehensive Observability**: Full X-Ray tracing, structured logging, and EventBridge logging
- **Error Handling**: Dead Letter Queues for failed event processing with enhanced monitoring
- **Security**: SSL enforcement, IAM least privilege, and encrypted event transmission

## Architecture Components

### 1. EventBridge Bus
- **Name**: `adyen-webhook-bus-{environment}`
- **Purpose**: Custom event bus for Adyen webhook events
- **Events**: Structured JSON events with `detail-type: "adyen.webhook"`
- **Logging**: Full event logging to CloudWatch Log Group `/aws/events/adyen-webhook-bus-{environment}`
- **Retention**: 1 week log retention
- **Security**: SSL enforcement for all event transmission

### 2. Event Structure

```json
{
  "Source": "adyen.webhook",
  "DetailType": "adyen.webhook",
  "Detail": {
    "eventCode": "ACCOUNT_HOLDER_STATUS_CHANGE",
    "pspReference": "123456789",
    "merchantReference": "MERCHANT_REF_001",
    "notificationType": "kyc",
    "merchantAccountCode": "TestMerchantAccount",
    "live": "false",
    "success": "true",
    "amount": {
      "currency": "USD",
      "value": 1000
    },
    "eventDate": "2024-01-01T00:00:00Z",
    "originalPayload": { /* full webhook payload */ },
    "webhookId": "uuid-v4",
    "timestamp": "2024-01-01T00:00:00Z"
  },
  "EventBusName": "adyen-webhook-bus-dev"
}
```

### 3. Event Routing Rules

#### Standard Notification Rule
- **Rule Name**: `standard-notification-rule-{environment}`
- **Pattern**: `notificationType: "standard"`
- **Target**: StandardNotificationHandler Lambda
- **Description**: Routes general webhook events

#### KYC Notification Rule
- **Rule Name**: `kyc-notification-rule-{environment}`
- **Pattern**: `notificationType: "kyc"`
- **Target**: KycNotificationHandler Lambda
- **Description**: Routes KYC-related events (account holder status, verification, etc.)

#### Transfer Notification Rule
- **Rule Name**: `transfer-notification-rule-{environment}`
- **Pattern**: `notificationType: "transfer"`
- **Target**: TransferNotificationHandler Lambda
- **Description**: Routes transfer-related events (fund transfers, etc.)

#### Balance Platform Notification Rule
- **Rule Name**: `balance-platform-notification-rule-{environment}`
- **Pattern**: `notificationType: "balancePlatform"`
- **Target**: OnboardingCompletionHandler Lambda
- **Description**: Routes balance platform events (account holder updates) for onboarding completion

### 4. Processor Lambda Functions

All processors include:
- **X-Ray Tracing**: Full request tracing with annotations
- **Structured Logging**: JSON-formatted logs with event context
- **Dead Letter Queues**: Failed events sent to SQS DLQs with enhanced configuration
- **Idempotency**: Duplicate handling using `pspReference`
- **Retry Logic**: 2 retry attempts with 5-minute max age
- **Log Retention**: 1 week CloudWatch log retention
- **Error Annotations**: X-Ray annotations for error tracking

#### StandardNotificationHandler
- **Function Name**: `{appName}-{environment}-standard-notification-handler`
- **Timeout**: 30 seconds
- **DLQ**: StandardNotificationDLQ

#### KycNotificationHandler
- **Function Name**: `{appName}-{environment}-kyc-notification-handler`
- **Timeout**: 30 seconds
- **DLQ**: KycNotificationDLQ

#### TransferNotificationHandler
- **Function Name**: `{appName}-{environment}-transfer-notification-handler`
- **Timeout**: 30 seconds
- **DLQ**: TransferNotificationDLQ

#### OnboardingCompletionHandler
- **Function Name**: `{appName}-{environment}-onboarding-completion-handler`
- **Timeout**: 30 seconds
- **Purpose**: Processes balance platform account holder updates to complete user onboarding
- **Key Features**:
  - Verification status tracking and updates
  - Transfer instrument extraction and linking
  - Sweep creation for automatic fund transfers
  - User status progression to ONBOARDED
  - SNS event publishing for onboarding completion

### 5. Dead Letter Queues

Each processor has a dedicated SQS Dead Letter Queue with enhanced configuration:
- **Retention**: 14 days
- **Purpose**: Capture failed event processing for investigation
- **SSL Enforcement**: All requests require SSL/TLS
- **Visibility Timeout**: 5 minutes for message processing
- **Receive Wait Time**: 20 seconds for long polling
- **Monitoring**: CloudWatch metrics and logging enabled
- **Security**: IAM policies with least privilege access

## Event Classification

### KYC Events
Events with these `eventCode` values are classified as KYC:
- `ACCOUNT_HOLDER_STATUS_CHANGE`
- `ACCOUNT_HOLDER_VERIFICATION`
- `ACCOUNT_HOLDER_UPCOMING_DEADLINE`
- `ACCOUNT_HOLDER_PAYOUT_METHOD_ADDED`
- `ACCOUNT_HOLDER_PAYOUT_METHOD_REMOVED`
- `ACCOUNT_HOLDER_PAYOUT_METHOD_REQUIRED`
- `ACCOUNT_HOLDER_VERIFICATION_DEADLINE_REMINDER`
- `ACCOUNT_HOLDER_VERIFICATION_DEADLINE_PASSED`
- `ACCOUNT_HOLDER_VERIFICATION_DEADLINE_EXTENDED`
- And many more KYC-related event codes...

### Transfer Events
Events with these `eventCode` values are classified as Transfer:
- `TRANSFER_FUNDS`
- `TRANSFER_FUNDS_FAILED`
- `TRANSFER_FUNDS_COMPLETED`
- `TRANSFER_FUNDS_DECLINED`
- `TRANSFER_FUNDS_EXPIRED`
- `TRANSFER_FUNDS_CANCELLED`
- `TRANSFER_FUNDS_SUSPENDED`
- `TRANSFER_FUNDS_TERMINATED`
- And more transfer-related event codes...

### Standard Events
All other events are classified as Standard.

## Adding New Event Types

To add a new event type:

1. **Update Event Classification**: Modify the `determineNotificationType` function in `src/functions/onboarding/adyenWebhookHandler/index.ts`

2. **Create New Processor**: Add a new Lambda function in `src/functions/onboarding/{newType}NotificationHandler/`

3. **Add CDK Resources**: Update the CDK stack to include:
   - New processor Lambda
   - New DLQ
   - New EventBridge rule
   - New outputs

4. **Update Documentation**: Add the new event type to this documentation

## Monitoring and Observability

### EventBridge Logging
- **Log Group**: `/aws/events/adyen-webhook-bus-{environment}`
- **Retention**: 1 week
- **Logging Rule**: Captures all events with source `adyen.webhook`
- **Format**: Structured JSON with full event details
- **Access**: Use AWS CLI with `--output text` for full logs

### CloudWatch Logs
- **Lambda Functions**: Automatic log groups for each processor
- **Structured Logging**: JSON-formatted logs with event context
- **Error Tracking**: Detailed error messages with X-Ray annotations
- **Log Retention**: 1 week for all components

### X-Ray Tracing
- **Group Name**: `{appName}-{environment}-webhooks`
- **Annotations**: Event codes, PSP references, notification types
- **Subsegments**: Detailed tracing for EventBridge operations
- **Error Tracking**: Error annotations for failed operations

### Dead Letter Queue Monitoring
- **SQS Metrics**: Monitor message counts and processing times
- **CloudWatch Logs**: Automatic logging for all DLQ operations
- **SSL Monitoring**: Track SSL/TLS compliance
- **Access Patterns**: Monitor IAM access and permissions

### EventBridge Metrics
- **Event Delivery**: Monitor success/failure rates
- **Rule Evaluation**: Track rule matching and routing
- **Target Invocation**: Monitor Lambda processor success rates
- **Performance**: Track event processing latency

### Log Access Commands

```bash
# EventBridge logs (non-truncated)
aws logs get-log-events \
  --log-group-name "/aws/events/adyen-webhook-bus-staging-eb" \
  --region us-east-2 \
  --start-from-head \
  --output text

# Lambda processor logs
aws logs get-log-events \
  --log-group-name "/aws/lambda/payerSyncOnboarder-staging-eb-standard-notification-handler" \
  --region us-east-2 \
  --start-from-head \
  --output text

# SQS DLQ monitoring
aws sqs get-queue-attributes \
  --queue-url "https://sqs.us-east-2.amazonaws.com/794308924679/payerSyncOnboarder-staging-eb-standard-notification-dlq" \
  --attribute-names All \
  --region us-east-2
```

## Security

- **IAM**: Least privilege permissions for EventBridge operations
- **Encryption**: All events encrypted in transit and at rest
- **SSL Enforcement**: All SQS operations require SSL/TLS
- **Validation**: Events validated before processing with HMAC verification
- **Isolation**: Custom event bus isolates webhook events
- **Secrets Management**: HMAC secrets stored in AWS Secrets Manager
- **Access Control**: API Gateway with Basic Auth for webhook endpoints
- **Audit Logging**: Comprehensive logging for security monitoring

## Deployment

The EventBridge integration is deployed as part of the main CDK stack:

```bash
npm run deploy <environment>
```

### Outputs
After deployment, the following outputs are available:
- `AdyenWebhookEventBusName`: Event bus name
- `AdyenWebhookEventBusArn`: Event bus ARN
- `StandardNotificationDLQUrl`: Standard processor DLQ URL
- `KycNotificationDLQUrl`: KYC processor DLQ URL
- `TransferNotificationDLQUrl`: Transfer processor DLQ URL

## Testing

### Local Testing
```bash
npm test
```

### Integration Testing
```bash
npm run test:integration
```

### Manual Testing
1. Send a webhook to the `/adyen/webhook` endpoint
2. Check CloudWatch logs for event emission
3. Verify events are routed to correct processors
4. Check DLQs for any failed processing

## Troubleshooting

### Common Issues

1. **Events not emitted**: Check webhook handler logs for EventBridge errors
2. **Events not routed**: Verify EventBridge rule patterns match event structure
3. **Processor failures**: Check DLQs for failed events
4. **Permission errors**: Verify IAM roles have correct EventBridge permissions
5. **Log truncation**: Use `--output text` for full log access
6. **SSL errors**: Verify SQS SSL enforcement compliance

### Debugging Steps

1. **Check EventBridge Logs**: Use the EventBridge log group for full event visibility
2. **Verify Lambda Logs**: Check processor logs for structured event processing
3. **Monitor DLQs**: Check SQS DLQs for failed event processing
4. **Review X-Ray Traces**: Use X-Ray console for request flow analysis
5. **Test Event Emission**: Verify EventBridge service connectivity
6. **Check Security**: Verify SSL compliance and IAM permissions

### Enhanced Logging Commands

```bash
# Get full EventBridge logs (non-truncated)
aws logs get-log-events \
  --log-group-name "/aws/events/adyen-webhook-bus-staging-eb" \
  --region us-east-2 \
  --start-from-head \
  --output text

# Filter for specific errors
aws logs filter-log-events \
  --log-group-name "/aws/lambda/payerSyncOnboarder-staging-eb-standard-notification-handler" \
  --region us-east-2 \
  --start-time $(($(date +%s) - 3600))000 \
  --filter-pattern "ERROR" \
  --output text

# Check DLQ message count
aws sqs get-queue-attributes \
  --queue-url "https://sqs.us-east-2.amazonaws.com/794308924679/payerSyncOnboarder-staging-eb-standard-notification-dlq" \
  --attribute-names ApproximateNumberOfMessages \
  --region us-east-2
```

## Logging Architecture

### EventBridge Logging
The EventBridge bus has comprehensive logging enabled:

- **Log Group**: `/aws/events/adyen-webhook-bus-{environment}`
- **Logging Rule**: Captures all events with source `adyen.webhook`
- **Retention**: 1 week
- **Format**: Structured JSON with full event details
- **Access**: Use AWS CLI with `--output text` for non-truncated logs

### Lambda Processor Logging
Each processor Lambda has enhanced logging:

- **Structured JSON**: All logs in JSON format with event context
- **X-Ray Annotations**: Error tracking and performance metrics
- **Event Context**: PSP references, event codes, and notification types
- **Error Details**: Full error context with stack traces

### SQS Dead Letter Queue Logging
Enhanced SQS configuration with comprehensive logging:

- **SSL Enforcement**: All operations require SSL/TLS
- **Visibility Timeout**: 5 minutes for message processing
- **Receive Wait Time**: 20 seconds for long polling
- **CloudWatch Metrics**: Automatic metric collection
- **Access Logging**: All SQS operations logged

### X-Ray Tracing
Comprehensive tracing across all components:

- **Group Name**: `{appName}-{environment}-webhooks`
- **Annotations**: Event codes, PSP references, notification types
- **Subsegments**: Detailed tracing for EventBridge operations
- **Error Tracking**: Error annotations for failed operations
- **Performance**: Latency tracking for all operations

### Log Access Best Practices

1. **Use `--output text`**: Avoid log truncation in AWS CLI
2. **Filter by Time**: Use `--start-time` for recent logs
3. **Error Filtering**: Use `--filter-pattern "ERROR"` for errors
4. **Full Context**: Use `--start-from-head` for complete logs
5. **Structured Queries**: Use CloudWatch Insights for complex queries

### Monitoring Alerts

Consider setting up CloudWatch alarms for:
- DLQ message counts > 0
- Lambda error rates > 5%
- EventBridge delivery failures
- SSL compliance violations
- X-Ray error annotations 