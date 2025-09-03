# Developer Guide

This guide provides detailed information for developers working on the PayerSync Onboarder Backend project. It assumes you've already read the main README and completed the basic setup.

## Development Workflow

### Lambda Functions

Each Lambda function has its own entry file in `src/functions/`:

#### Onboarding Functions
- `adyenOnboarding/` - Main onboarding logic and Adyen integration
- `payloadHandler/` - Payload processing and storage
- `getPayloadHandler/` - Payload retrieval
- `cognitoPostConfirmation/` - Post-confirmation triggers
- `onboardingTableStreamHandler/` - DynamoDB stream processing
- `generateOnboardingLinkHandler/` - Adyen hosted onboarding link generation

#### Webhook Functions
- `adyenWebhookHandler/` - Webhook processing with HMAC validation and EventBridge emission
- `adyenWebhookAuthorizer/` - Basic Auth for webhook endpoints
- `onboardingCompletionHandler/` - **NEW**: Processes balance platform events for onboarding completion
- `standardNotificationHandler/` - Standard webhook event processing
- `kycNotificationHandler/` - KYC-related webhook event processing
- `transferNotificationHandler/` - Transfer-related webhook event processing

### Onboarding Completion & Sweep Creation

The `onboardingCompletionHandler` is responsible for automatically completing user onboarding when all verification requirements are met:

#### Verification Requirements
- **6 Capability Verifications**: All must be marked as `valid` by Adyen
- **Transfer Instrument**: Must exist and be linked to user account
- **Balance Account**: Must exist for fund holding
- **Sweep Configuration**: Must be successfully created for automatic fund transfers

#### Sweep Configuration
A sweep enables automatic daily fund transfers from Adyen to the user's bank account:
```typescript
const sweep = {
  counterparty: { transferInstrumentId: transferInstrumentId },
  triggerAmount: { currency: 'USD', value: 0 }, // Transfers all available funds
  currency: 'USD',
  description: 'PayerSync',
  priorities: ['regular', 'fast'],
  category: 'bank',
  schedule: { type: 'daily' },
  type: 'push',
  status: 'active'
};
```

#### Processing Flow
1. **Webhook Reception** → `balancePlatform.accountHolder.updated` events
2. **Verification Check** → Parse Adyen capabilities and update verification statuses
3. **Sweep Creation** → Attempt to create sweep if all verifications complete
4. **Status Update** → Mark user as `ONBOARDED` with timestamp
5. **Stream Processing** → DynamoDB stream triggers SNS event publishing

#### Database and Reporting Functions
- `dbInit/custom-resource-handler.ts` - Database initialization
- `reporting/` - Reporting API endpoints and data access
- `test-data-handler/` - Test data management

Lambda functions are automatically bundled using esbuild via AWS CDK's `NodejsFunction` construct.

### API Endpoints

#### Authentication Required Endpoints
- `POST /payload` — Store and merge onboarding data (PMB data and merchant data)
- `GET /payload` — Retrieve user's onboarding data
- `POST /generate-link` — Generate Adyen hosted onboarding link


#### Reporting Endpoints (Authentication Required)
- `GET /reporting/schema` — Get database schema information
- `GET /reporting/schema/{tableName}` — Get specific table schema
- `GET /reporting/data` — Retrieve reporting data with filtering, sorting, and pagination
- `GET /reporting/stats` — Get basic reporting statistics
- `GET /reporting/stats/analytics` — Get advanced analytics

#### Webhook Endpoints
- `POST /adyen/webhook` — Receive Adyen webhook notifications (Basic Auth)
- `GET /adyen/webhook` — Health check endpoint for webhook service (no auth required)

#### Test Data Management Endpoints
- `GET /test-data?action=add` — Create test onboarding sessions and events
- `GET /test-data?action=query` — Query test data from database
- `GET /test-data?action=clear` — Clean up test data

## Testing Strategy

### Unit Testing

```bash
npm test
```

Tests verify:
- Resource creation with correct configurations
- Naming patterns following `${appName}-${environment}-resourceName`
- Environment variables passed to Lambda functions
- Proper tagging and IAM policies
- Webhook HMAC validation
- EventBridge event routing
- Database initialization procedures

### Snapshot Testing

```bash
npm test -- -u  # Update snapshots when changes are expected
```

### Lambda Function Testing

Functions are tested in isolation using mocks for:
- AWS Secrets Manager for configuration
- DynamoDB for data storage
- SNS for event publishing
- EventBridge for event routing
- RDS for database operations
- S3 for webhook storage

### Integration Testing

```bash
npm run test:integration
```

Validates component interactions:
- Lambda triggered by DynamoDB stream
- SNS publishing from Lambda
- API Gateway with Cognito authorization
- Webhook processing with EventBridge
- Database initialization and reporting
- EventBridge event routing to processors

### Webhook Testing

```bash
# Test webhook handler
npm test test/adyen-webhook-handler.test.ts

# Test webhook authorizer
npm test test/adyen-webhook-authorizer.test.ts

# Test EventBridge integration
npm test test/eventbridge-integration.test.ts
```

### Database Testing

```bash
# Test database initialization
npm test test/database-init.test.ts

# Test reporting functions
npm test test/reporting-api.test.ts
```

## Code Quality

### Static Analysis

```bash
npm run lint        # Check for issues
npm run lint:fix    # Fix issues automatically
npm run format      # Format code with Prettier
```

### Security Checks

CDK Nag runs automatically during deployment:
```bash
npm run deploy dev  # Includes security compliance checks
```

## Code Coverage

### Setting up Coverage Badge

1. Create a GitHub Gist and note the Gist ID
2. Create a Personal Access Token with `gist` scope
3. Add `GIST_SECRET` repository secret with the token
4. Add `GIST_ID` repository variable with your Gist ID
5. Update README badge with your username and Gist ID

### Available Test Scripts

```bash
npm test              # Run all tests with coverage
npm run test:update   # Update snapshots
npm run test:watch    # Run tests in watch mode
```

## Development Tips

### Hot Reloading

```bash
# For faster development iterations
npm run deploy:hotswap dev
```

### Local Testing with Real Data

```bash
# Test webhook endpoints locally
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n 'username:password' | base64)" \
  -d '{"test": "payload"}' \
  https://your-api-id.execute-api.region.amazonaws.com/prod/adyen/webhook
```

### Database Development

```bash
# Check database initialization logs
aws logs tail /aws/lambda/payerSyncOnboarder-dev-db-init-custom-resource --follow

# Test reporting endpoints
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://your-api-id.execute-api.region.amazonaws.com/reporting/schema
```

### EventBridge Testing

```bash
# Check EventBridge logs
aws logs tail /aws/events/adyen-webhook-bus-dev --follow

# Monitor processor logs
aws logs tail /aws/lambda/payerSyncOnboarder-dev-standard-notification-handler --follow
```

## Environment Variables

### Required for Development

```bash
# Adyen API Keys
ADYEN_LEM_API_KEY=your_lem_api_key
ADYEN_BP_API_KEY=your_bp_api_key
ADYEN_PSP_API_KEY=your_psp_api_key

# Webhook Configuration
ADYEN_HMAC_SECRET=your_hmac_secret
ADYEN_WEBHOOK_USERNAME=webhook_user
ADYEN_WEBHOOK_PASSWORD=webhook_password

# Database Configuration (auto-generated)
DB_SECRET_ARN=arn:aws:secretsmanager:region:account:secret:name
DB_HOST=your-rds-endpoint
DB_PORT=5432
DB_NAME=onboarding_reporting
```

### Optional for Development

```bash
# CORS Configuration
CORS_ALLOWED_ORIGINS=https://your-frontend-domain.com

# Environment Configuration
NODE_ENV=development
AWS_XRAY_GROUP_NAME=payerSyncOnboarder-dev-webhooks
```

## Debugging

### Common Issues

1. **Webhook HMAC Validation Failures**
   - Check HMAC secret in Secrets Manager
   - Verify payload format matches Adyen specification
   - Use test/live secrets appropriately

2. **EventBridge Event Routing Issues**
   - Check EventBridge rule patterns
   - Verify event structure matches expected format
   - Monitor Dead Letter Queues for failed events

3. **Database Connection Issues**
   - Verify VPC and security group configuration
   - Check Lambda timeout settings
   - Ensure database initialization completed successfully

4. **API Gateway Authorization Issues**
   - Verify Cognito JWT tokens
   - Check Basic Auth credentials for webhooks
   - Ensure CORS configuration is correct

### Debugging Commands

```bash
# Check Lambda logs
aws logs tail /aws/lambda/payerSyncOnboarder-dev-webhook-handler --follow

# Check EventBridge events
aws logs get-log-events \
  --log-group-name "/aws/events/adyen-webhook-bus-dev" \
  --region us-east-2 \
  --start-from-head \
  --output text

# Check database initialization
aws logs get-log-events \
  --log-group-name "/aws/lambda/payerSyncOnboarder-dev-db-init-custom-resource" \
  --region us-east-2 \
  --start-from-head \
  --output text

# Test API endpoints
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://your-api-id.execute-api.region.amazonaws.com/payload
```

## Performance Monitoring

### X-Ray Tracing

All Lambda functions have X-Ray tracing enabled:
- Distributed tracing across services
- Performance monitoring and bottleneck identification
- Request flow visualization
- Error tracking and debugging

### CloudWatch Metrics

Monitor key metrics:
- Lambda invocation counts and durations
- API Gateway request counts and latencies
- EventBridge event delivery rates
- SQS Dead Letter Queue message counts
- RDS database performance metrics

### Log Analysis

Use structured logging for analysis:
```bash
# Filter for errors
aws logs filter-log-events \
  --log-group-name "/aws/lambda/payerSyncOnboarder-dev-webhook-handler" \
  --filter-pattern "ERROR" \
  --region us-east-2

# Search for specific events
aws logs filter-log-events \
  --log-group-name "/aws/events/adyen-webhook-bus-dev" \
  --filter-pattern "AUTHORISATION" \
  --region us-east-2
``` 