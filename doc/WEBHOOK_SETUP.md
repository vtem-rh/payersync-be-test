# Adyen Webhook Setup Guide

This document provides comprehensive instructions for setting up and configuring the Adyen webhook endpoint in the PayerSync Onboarder Backend.

## Overview

The webhook endpoint provides a secure, authenticated endpoint for receiving Adyen webhook notifications. It includes:

- **Basic Auth Authentication**: Secure access using username/password stored in AWS Secrets Manager
- **HMAC Signature Validation**: Validates webhook authenticity using Adyen's HMAC signatures
- **S3 Storage**: Stores all webhook payloads for audit and compliance
- **EventBridge Integration**: Emits structured events for downstream processing
- **Enhanced Database Schema**: PostgreSQL storage for webhook events and reporting
- **Structured Logging**: Comprehensive CloudWatch logging with X-Ray tracing
- **TLS Enforcement**: Minimum TLS 1.2 required for all connections

## Architecture

```
Adyen Webhook → REST API Gateway → Lambda Authorizer → Webhook Handler → S3 Storage
                                    ↓
                              Secrets Manager (Basic Auth + HMAC)
                                    ↓
                              EventBridge Custom Bus
                                    ↓
                              Notification Handlers → PostgreSQL
```

### Event Processing Flow

1. **Webhook Reception**: Adyen sends webhook to REST API Gateway
2. **Authentication**: Basic Auth validation via Lambda Authorizer
3. **HMAC Validation**: Cryptographic signature validation
4. **S3 Storage**: Raw payload stored for audit trail
5. **Event Emission**: Structured event sent to EventBridge custom bus
6. **Event Routing**: EventBridge routes events based on notification type
7. **Event Processing**: Specialized handlers process and store data in PostgreSQL

### EventBridge Rules

The system automatically routes different notification types to appropriate handlers:

- **Standard Notifications** → Standard Notification Handler
- **KYC Notifications** → KYC Notification Handler  
- **Transfer Notifications** → Transfer Notification Handler
- **Balance Platform Notifications** → Standard Notification Handler

## Configuration

### Environment Variables

Add the following environment variables to your `.env.local` file:

```bash
# Adyen Webhook HMAC Secrets (required for production)
ADYEN_TEST_HMAC_SECRET=your_test_hmac_secret_here
ADYEN_LIVE_HMAC_SECRET=your_live_hmac_secret_here

# Basic Auth Credentials (required for production)
ADYEN_WEBHOOK_USERNAME=your_webhook_username
ADYEN_WEBHOOK_PASSWORD=your_webhook_password

# EventBridge Configuration
EVENT_BUS_NAME=adyen-webhook-bus-{environment}
```

### Secrets Manager Configuration

The following secrets are automatically created by the CDK stack:

1. **Test HMAC Secret**: `${appName}-${environment}-adyen-test-hmac-secret`
   - Contains: `{ "hmacSecret": "your_test_hmac_secret" }`

2. **Live HMAC Secret**: `${appName}-${environment}-adyen-live-hmac-secret`
   - Contains: `{ "hmacSecret": "your_live_hmac_secret" }`

3. **Basic Auth Secret**: `${appName}-${environment}-adyen-webhook-basic-auth`
   - Contains: `{ "username": "your_username", "password": "your_password" }`

## Enhanced Database Schema

The system uses PostgreSQL with an enhanced schema for webhook processing and reporting:

### Core Tables

#### Legal Entities (SCD Type 2)
```sql
CREATE TABLE legal_entities (
  id BIGSERIAL PRIMARY KEY,
  adyen_legal_entity_id VARCHAR(255) UNIQUE NOT NULL,
  business_name VARCHAR(500) NOT NULL,
  legal_entity_type VARCHAR(100),
  country_code VARCHAR(2),
  status VARCHAR(50) NOT NULL,
  is_current BOOLEAN DEFAULT true,
  valid_from TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  valid_to TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### Account Holders (SCD Type 2)
```sql
CREATE TABLE account_holders (
  id BIGSERIAL PRIMARY KEY,
  adyen_account_holder_id VARCHAR(255) UNIQUE NOT NULL,
  legal_entity_id BIGINT REFERENCES legal_entities(id),
  account_holder_type VARCHAR(100),
  status VARCHAR(50) NOT NULL,
  is_current BOOLEAN DEFAULT true,
  valid_from TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  valid_to TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### Accounts
```sql
CREATE TABLE accounts (
  id BIGSERIAL PRIMARY KEY,
  adyen_account_id VARCHAR(255) UNIQUE NOT NULL,
  account_holder_id BIGINT REFERENCES account_holders(id),
  account_type VARCHAR(100),
  currency VARCHAR(3),
  status VARCHAR(50) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### Adyen Events
```sql
CREATE TABLE adyen_events (
  id BIGSERIAL PRIMARY KEY,
  event_id VARCHAR(255) UNIQUE NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id VARCHAR(255),
  event_data JSONB NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  webhook_received_at TIMESTAMP WITH TIME ZONE NOT NULL
);
```

#### Webhook Receipts
```sql
CREATE TABLE webhook_receipts (
  id BIGSERIAL PRIMARY KEY,
  webhook_id VARCHAR(255) UNIQUE NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  hmac_valid BOOLEAN NOT NULL,
  processing_status VARCHAR(50) DEFAULT 'PENDING',
  received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT
);
```

#### Deduplication Registry
```sql
CREATE TABLE dedupe_registry (
  id BIGSERIAL PRIMARY KEY,
  psp_reference VARCHAR(255) UNIQUE NOT NULL,
  original_reference VARCHAR(255),
  event_code VARCHAR(100),
  processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Deployment

### 1. Set Environment Variables

```bash
# For development
export ADYEN_TEST_HMAC_SECRET="test-hmac-secret"
export ADYEN_LIVE_HMAC_SECRET="live-hmac-secret"
export ADYEN_WEBHOOK_USERNAME="webhook-user"
export ADYEN_WEBHOOK_PASSWORD="webhook-password"

# For production (use strong, unique values)
export ADYEN_TEST_HMAC_SECRET="your-actual-test-hmac-secret"
export ADYEN_LIVE_HMAC_SECRET="your-actual-live-hmac-secret"
export ADYEN_WEBHOOK_USERNAME="your-webhook-username"
export ADYEN_WEBHOOK_PASSWORD="your-webhook-password"
```

### 2. Deploy Infrastructure

```bash
# Deploy to development environment
npm run deploy dev

# Deploy to production environment
npm run deploy prod

# Deploy to specific environment (e.g., staging01)
npm run deploy staging01
```

### 3. Get Webhook URL

After deployment, the webhook URL will be available in the CDK outputs:

```bash
# Get deployment outputs
npm run outputs dev
```

The webhook endpoint will be: `https://{rest-api-id}.execute-api.{region}.amazonaws.com/prod/adyen/webhook`

## Testing

### Running Tests

```bash
# Run webhook handler tests
npm test test/adyen-webhook-handler.test.ts

# Run authorizer tests
npm test test/adyen-webhook-authorizer.test.ts

# Run EventBridge integration tests
npm test test/eventbridge-integration.test.ts

# Run all tests
npm test
```

### Manual Testing with Example Payload

Use the provided example payload to test HMAC validation:

```json
{
  "live": "false",
  "notificationItems": [
    {
      "NotificationRequestItem": {
        "additionalData": {
          "hmacSignature": "SIGNATURE_VALUE",
          "recurring.recurringDetailReference": "123",
          "recurring.shopperReference": "xyz"
        },
        "amount": { "currency": "EUR", "value": 1000 },
        "eventCode": "AUTHORISATION",
        "eventDate": "2022-12-01T01:00:00+01:00",
        "merchantAccountCode": "YOUR_MERCHANT_ACCOUNT",
        "merchantReference": "YOUR_MERCHANT_REFERENCE",
        "paymentMethod": "ach",
        "pspReference": "YOUR_PSP_REFERENCE",
        "operations": [],
        "success": "true"
      }
    }
  ]
}
```

### Testing with curl

```bash
# Generate Basic Auth header
echo -n "webhook-user:webhook-password" | base64

# Test webhook endpoint
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic d2ViaG9vay11c2VyOndlYmhvb2stcGFzc3dvcmQ=" \
  -d '{"live":"false","notificationItems":[{"NotificationRequestItem":{"additionalData":{"hmacSignature":"VALID_SIGNATURE"},"amount":{"currency":"EUR","value":1000},"eventCode":"AUTHORISATION","eventDate":"2022-12-01T01:00:00+01:00","merchantAccountCode":"TEST","merchantReference":"REF","paymentMethod":"ach","pspReference":"PSP123","operations":[],"success":"true"}}]}' \
  https://your-api-id.execute-api.region.amazonaws.com/prod/adyen/webhook
```

## HMAC Signature Generation

To generate valid HMAC signatures for testing:

```javascript
const crypto = require('crypto');

function generateHmacSignature(payload, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload), 'utf8')
    .digest('base64');
}

// Example usage
const payload = {
  live: "false",
  notificationItems: [/* your notification items */]
};

const signature = generateHmacSignature(payload, 'your-hmac-secret');
console.log('HMAC Signature:', signature);
```

## Monitoring and Logging

### CloudWatch Logs

All webhook processing is logged to CloudWatch with structured JSON format:

```json
{
  "level": "INFO",
  "message": "Webhook data processed",
  "eventCode": "AUTHORISATION",
  "pspReference": "YOUR_PSP_REFERENCE",
  "merchantAccountCode": "YOUR_MERCHANT_ACCOUNT",
  "notificationType": "adyen",
  "live": "false",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "webhookId": "uuid-12345"
}
```

### X-Ray Tracing

All webhook processing is traced with X-Ray for performance monitoring and debugging.

### S3 Storage

Webhook payloads are stored in S3 with the following structure:
```
s3://{bucket-name}/adyen-webhooks/{YYYY}/{MM}/{DD}/{UUID}.json
```

### EventBridge Monitoring

Monitor EventBridge event processing:

```bash
# Check EventBridge rules
aws events list-rules --event-bus-name adyen-webhook-bus-{environment}

# Check EventBridge targets
aws events list-targets-by-rule --rule standard-notification-rule-{environment}

# Monitor EventBridge metrics in CloudWatch
```

## Security Considerations

### TLS Requirements
- Minimum TLS 1.2 enforced
- HTTPS required for all connections

### Authentication
- Basic Auth credentials stored in AWS Secrets Manager
- Credentials encrypted with KMS
- Authorizer caches results for 5 minutes

### HMAC Validation
- Separate secrets for test and live environments
- SHA256 HMAC validation for all webhooks
- Invalid signatures result in 401 Unauthorized response

### Access Control
- S3 bucket blocks all public access
- IAM roles follow least privilege principle
- All secrets encrypted at rest
- EventBridge rules restrict event routing

## Error Handling

### Common Error Responses

| Status Code | Description | Cause |
|-------------|-------------|-------|
| 400 | Bad Request | Missing or invalid request body |
| 401 | Unauthorized | Invalid Basic Auth credentials |
| 401 | Unauthorized | Invalid HMAC signature |
| 403 | Forbidden | Authorization denied |
| 500 | Internal Server Error | Processing error |

### Error Response Format

```json
{
  "message": "Webhook validation failed",
  "errors": [
    "Invalid HMAC signature for PSP reference: YOUR_PSP_REFERENCE",
    "Missing HMAC signature"
  ]
}
```

## Troubleshooting

### Common Issues

1. **401 Unauthorized - Invalid Credentials**
   - Verify Basic Auth credentials in Secrets Manager
   - Check environment variables are set correctly

2. **401 Unauthorized - Invalid HMAC Signature**
   - Verify HMAC secret matches Adyen configuration
   - Ensure payload format matches Adyen specification
   - Check if using correct test/live secret

3. **500 Internal Server Error**
   - Check CloudWatch logs for detailed error messages
   - Verify S3 bucket permissions
   - Check Secrets Manager access

4. **Events Not Processing in Database**
   - Check EventBridge rules are properly configured
   - Verify notification handlers are receiving events
   - Check PostgreSQL connection and permissions

### Debugging Steps

1. **Check CloudWatch Logs**
   ```bash
   # Webhook handler logs
   aws logs tail /aws/lambda/{function-name}-adyen-webhook-handler --follow
   
   # Notification handler logs
   aws logs tail /aws/lambda/{function-name}-standard-notification-handler --follow
   aws logs tail /aws/lambda/{function-name}-kyc-notification-handler --follow
   aws logs tail /aws/lambda/{function-name}-transfer-notification-handler --follow
   ```

2. **Verify Secrets**
   ```bash
   aws secretsmanager get-secret-value --secret-id {secret-name}
   ```

3. **Check EventBridge Rules**
   ```bash
   aws events list-rules --event-bus-name adyen-webhook-bus-{environment}
   ```

4. **Test Database Connection**
   ```bash
   # Check if database initialization completed
   aws logs tail /aws/lambda/{function-name}-db-init --follow
   ```

## Integration with Adyen

### Adyen Dashboard Configuration

1. Log into your Adyen Customer Area
2. Navigate to Settings → Integrations → Webhooks
3. Add new webhook endpoint:
   - **URL**: `https://your-api-id.execute-api.region.amazonaws.com/prod/adyen/webhook`
   - **Username**: Your webhook username
   - **Password**: Your webhook password
   - **HMAC Key**: Your HMAC secret (test/live as appropriate)

### Webhook Events

The endpoint handles all Adyen webhook events including:
- `AUTHORISATION`
- `CAPTURE`
- `REFUND`
- `CANCELLATION`
- `CHARGEBACK`
- `balancePlatform.accountHolder.updated`
- `balancePlatform.accountHolder.created`
- `balancePlatform.account.updated`
- `balancePlatform.transfer.completed`
- And all other Adyen notification types

## Reporting and Analytics

### Available Endpoints

- `GET /reporting/schema` - Database schema information
- `GET /reporting/data` - Query data from specific tables
- `GET /reporting/stats` - Analytics and statistics

### Data Access

The enhanced database schema provides:
- **Legal Entity Analytics**: Status distribution, country analysis
- **Account Holder Metrics**: Type distribution, status tracking
- **Event Analysis**: Event type distribution, processing statistics
- **Webhook Performance**: Processing status, error rates
- **Deduplication Metrics**: Duplicate prevention statistics

## Compliance and Audit

### Data Retention
- Webhook payloads stored in S3 for 1 year
- Automatic transition to IA after 30 days
- Automatic transition to Glacier after 90 days
- Automatic deletion after 365 days
- PostgreSQL data retained according to business requirements

### Audit Trail
- All webhook processing logged to CloudWatch
- X-Ray traces available for performance analysis
- S3 access logs enabled for audit purposes
- Database changes tracked with timestamps
- Event deduplication prevents duplicate processing

## Next Steps

This webhook endpoint is now fully integrated with:
- ✅ EventBridge for event routing and processing
- ✅ Enhanced PostgreSQL schema for data storage
- ✅ Specialized notification handlers for different event types
- ✅ Comprehensive reporting and analytics capabilities
- ✅ Event deduplication and audit trails

The system is production-ready and can handle high-volume webhook processing with full observability and data integrity. 