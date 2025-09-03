# Webhook Processors Implementation

## Overview

This document describes the implementation of downstream processors for the Adyen webhook ingestion system. The system processes webhook events from EventBridge and stores them in an enhanced PostgreSQL database schema designed for comprehensive webhook processing and reporting.

## Architecture

```
API Gateway → Lambda (Webhook Handler) → EventBridge → Lambda Processors → PostgreSQL (Enhanced Schema)
```

### Components

1. **Webhook Handler** (`adyenWebhookHandler`): Receives webhooks from Adyen, validates HMAC signatures, stores raw payloads to S3, and emits structured events to EventBridge
2. **EventBridge Custom Bus**: Routes events to appropriate processors based on notification type
3. **Notification Processors**: Three specialized Lambda functions that process different types of webhook events
4. **Enhanced Database**: PostgreSQL database with SCD Type 2 dimensions for comprehensive webhook data storage

## Processors

### 1. OnboardingCompletionHandler

**Purpose**: Processes balance platform account holder updates to complete user onboarding
**Event Types**: `balancePlatform.accountHolder.updated` events
**Processing Flow**:
- Extracts account holder data from webhook payload
- Updates verification statuses based on Adyen capabilities
- Tracks transfer instrument creation and linking
- Creates sweeps for automatic fund transfers when conditions are met
- Updates user status to ONBOARDED when all verifications complete
- Triggers DynamoDB stream for SNS event publishing

**Key Features**:
- **Verification Status Tracking**: Monitors 6 key capability verifications
- **Transfer Instrument Management**: Links transfer instruments to user accounts
- **Sweep Creation**: Automatically creates sweeps for fund transfers
- **Status Progression**: Manages user onboarding state transitions
- **DynamoDB Integration**: Updates user records in onboarding table
- **Adyen API Integration**: Creates financial infrastructure via Adyen APIs

**Verification Capabilities Tracked**:
- `receivePayments` - Can receive payments
- `sendToTransferInstrument` - Can send to transfer instruments
- `sendToBalanceAccount` - Can send to balance accounts
- `receiveFromBalanceAccount` - Can receive from balance accounts
- `receiveFromTransferInstrument` - Can receive from transfer instruments
- `receiveFromPlatformPayments` - Can receive platform payments

**Onboarding Completion Criteria**:
- All 6 verification statuses must be `true`
- Transfer instrument must exist and be linked
- Balance account must exist
- Sweep must be created successfully
- User status transitions from `READY_FOR_ADYEN` to `ONBOARDED`

**Sweep Creation Process**:
- **Trigger**: Only attempted when all verifications are complete
- **Requirements**: Balance account ID and transfer instrument ID must exist
- **Configuration**: Daily automatic fund transfers from balance account to bank
- **Priority**: Uses both regular and fast transfer priorities
- **Amount**: Triggers at $0 (transfers all available funds)
- **Purpose**: Enables automatic fund movement from Adyen to user's bank account

**Status Update Flow**:
1. **Verification Check**: All 6 capability verifications must be `valid`
2. **Sweep Creation**: Attempts to create sweep if conditions are met
3. **Status Update**: Marks user as `ONBOARDED` with `onboardedAt` timestamp
4. **Stream Trigger**: DynamoDB stream automatically processes the status change
5. **SNS Event**: Stream handler publishes `ORGANIZATION_ONBOARDED` event

### 2. StandardNotificationHandler

**Purpose**: Processes standard Adyen webhook notifications and balance platform events
**Event Types**: General account holder, payment events, and balance platform notifications
**Processing Flow**:
- Validates event structure and extracts entity information
- Checks for duplicate events using dedupe registry
- Stores event data in `adyen_events` table
- Creates webhook receipt records for audit trail
- Inserts dedupe records to prevent reprocessing

**Key Features**:
- Deduplication using `pspReference` via dedupe registry
- Full event payload storage in JSONB format
- Webhook receipt tracking for compliance
- X-Ray tracing for observability

### 3. KycNotificationHandler

**Purpose**: Processes KYC (Know Your Customer) related webhook notifications
**Event Types**: Account holder verification and status change events
**Processing Flow**:
- Validates that event codes are KYC-related
- Extracts entity ID from webhook payload
- Checks for duplicate events using dedupe registry
- Stores KYC event data with specialized annotations
- Creates comprehensive audit trail

**Key Features**:
- KYC event validation and filtering
- Enhanced logging for compliance tracking
- Entity relationship tracking
- Performance monitoring via X-Ray

### 4. TransferNotificationHandler

**Purpose**: Processes fund transfer related webhook notifications
**Event Types**: Balance platform transfer events
**Processing Flow**:
- Validates transfer-specific event codes
- Extracts transfer metadata (direction, status, transaction ID)
- Processes transfer amounts and counterparty information
- Stores transfer events with specialized annotations

**Key Features**:
- Transfer event validation and filtering
- Metadata extraction for transfer analysis
- Support for complex transfer scenarios
- Comprehensive transfer tracking

## Enhanced Database Schema

The system uses a modern, normalized database schema designed for webhook processing and analytics:

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

**Purpose**: Tracks legal entity information with SCD Type 2 support for historical changes
**Key Features**: Business name tracking, country analysis, status history

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

**Purpose**: Tracks account holder information with SCD Type 2 support
**Key Features**: Entity relationships, type classification, status tracking

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

**Purpose**: Stores account information and relationships
**Key Features**: Currency tracking, account type classification

#### Adyen Events (Fact Table)
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

**Purpose**: Central fact table for all webhook events
**Key Features**: Full JSONB payload storage, entity linking, timestamp tracking

#### Webhook Receipts (Audit Trail)
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

**Purpose**: Comprehensive audit trail for webhook processing
**Key Features**: HMAC validation tracking, processing status, error logging

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

**Purpose**: Prevents duplicate event processing
**Key Features**: PSP reference tracking, event code association

### Indexes and Performance

```sql
-- Legal entities indexes
CREATE INDEX idx_legal_entities_adyen_id ON legal_entities(adyen_legal_entity_id);
CREATE INDEX idx_legal_entities_status ON legal_entities(status);
CREATE INDEX idx_legal_entities_country ON legal_entities(country_code);
CREATE INDEX idx_legal_entities_current ON legal_entities(is_current);

-- Account holders indexes
CREATE INDEX idx_account_holders_adyen_id ON account_holders(adyen_account_holder_id);
CREATE INDEX idx_account_holders_legal_entity ON account_holders(legal_entity_id);
CREATE INDEX idx_account_holders_status ON account_holders(status);
CREATE INDEX idx_account_holders_current ON account_holders(is_current);

-- Accounts indexes
CREATE INDEX idx_accounts_adyen_id ON accounts(adyen_account_id);
CREATE INDEX idx_accounts_holder_id ON accounts(account_holder_id);
CREATE INDEX idx_accounts_currency ON accounts(currency);

-- Events indexes
CREATE INDEX idx_adyen_events_event_id ON adyen_events(event_id);
CREATE INDEX idx_adyen_events_type ON adyen_events(event_type);
CREATE INDEX idx_adyen_events_entity ON adyen_events(entity_type, entity_id);
CREATE INDEX idx_adyen_events_processed ON adyen_events(processed_at);

-- Webhook receipts indexes
CREATE INDEX idx_webhook_receipts_webhook_id ON webhook_receipts(webhook_id);
CREATE INDEX idx_webhook_receipts_status ON webhook_receipts(processing_status);
CREATE INDEX idx_webhook_receipts_received ON webhook_receipts(received_at);

-- Dedupe registry indexes
CREATE INDEX idx_dedupe_registry_psp ON dedupe_registry(psp_reference);
CREATE INDEX idx_dedupe_registry_event_code ON dedupe_registry(event_code);
```

## EventBridge Rules

### Standard Notification Rule
- **Pattern**: `source: adyen.webhook`, `detailType: adyen.webhook`, `detail.notificationType: standard`
- **Target**: `StandardNotificationHandler`
- **Retry**: 2 attempts, 5 minute max event age

### KYC Notification Rule
- **Pattern**: `source: adyen.webhook`, `detailType: adyen.webhook`, `detail.notificationType: kyc`
- **Target**: `KycNotificationHandler`
- **Retry**: 2 attempts, 5 minute max event age

### Transfer Notification Rule
- **Pattern**: `source: adyen.webhook`, `detailType: adyen.webhook`, `detail.notificationType: transfer`
- **Target**: `TransferNotificationHandler`
- **Retry**: 2 attempts, 5 minute max event age

### Balance Platform Notification Rule
- **Pattern**: `source: adyen.webhook`, `detailType: adyen.webhook`, `detail.notificationType: balancePlatform`
- **Target**: `StandardNotificationHandler`
- **Retry**: 2 attempts, 5 minute max event age

## Deduplication & Idempotency

### Strategy
1. **Event-Level Deduplication**: Check if event with same `pspReference` already exists in dedupe registry
2. **Database Constraints**: Unique constraints ensure data integrity
3. **Transaction Management**: Atomic operations for related data

### Implementation
```typescript
// Check for duplicate event
const isDuplicate = await dbHelper.checkDuplicateEvent(webhookEvent.pspReference);
if (isDuplicate) {
  return; // Event already processed
}

// Process event and insert dedupe record
await dbHelper.insertDedupeRecord(
  webhookEvent.pspReference,
  webhookEvent.merchantReference,
  webhookEvent.eventCode
);
```

## Error Handling

### Retry Configuration
- **Max Retries**: 2 attempts per EventBridge rule
- **Max Event Age**: 5 minutes
- **Lambda Timeout**: 30 seconds per processor

### Error Logging
- Structured logging with X-Ray annotations
- Error details captured in CloudWatch
- Failed events automatically retried by EventBridge

## Security

### Database Access
- Lambda functions run in private subnets
- Database credentials stored in Secrets Manager
- IAM roles with least privilege access
- RDS encryption at rest and in transit

### Webhook Validation
- HMAC signature validation for all webhooks
- Basic Auth for webhook endpoint
- Raw payloads stored in S3 for audit trail
- Event deduplication prevents replay attacks

## Monitoring & Observability

### X-Ray Tracing
- All processors instrumented with X-Ray
- Custom annotations for business metrics
- Distributed tracing across the entire flow

### CloudWatch Logging
- Structured JSON logging
- Log retention: 1 week
- Custom log groups for each processor

### Metrics
- Event processing success/failure rates
- Database operation latency
- Processor execution time
- Deduplication effectiveness

## Deployment

### CDK Resources
- Lambda functions with VPC configuration
- EventBridge custom bus, rules and targets
- RDS PostgreSQL instance with enhanced schema
- Database permissions and environment variables

### Environment Variables
```bash
DB_SECRET_ARN=arn:aws:secretsmanager:...
DB_HOST=onboarding-db.region.rds.amazonaws.com
DB_PORT=5432
DB_NAME=onboarding_reporting
NODE_ENV=production
AWS_XRAY_GROUP_NAME=webhooks
EVENT_BUS_NAME=adyen-webhook-bus-{environment}
```

## Testing

### Unit Tests
- Database helper functions
- Event parsing and validation
- Deduplication logic

### Integration Tests
- End-to-end webhook processing
- Database operations
- EventBridge event routing

### Test Data
- Sample webhook payloads for each event type
- Mock database responses
- EventBridge event fixtures

## Reporting and Analytics

### Available Endpoints
- `GET /reporting/schema` - Database schema information
- `GET /reporting/data` - Query data from specific tables
- `GET /reporting/stats` - Analytics and statistics

### Data Insights
- **Legal Entity Analytics**: Status distribution, country analysis, business type trends
- **Account Holder Metrics**: Type distribution, status tracking, verification rates
- **Event Analysis**: Event type distribution, processing statistics, performance metrics
- **Webhook Performance**: Processing status, error rates, throughput analysis
- **Deduplication Metrics**: Duplicate prevention statistics, efficiency tracking

## Future Enhancements

### Potential Improvements
1. **Batch Processing**: Process multiple events in a single database transaction
2. **Caching**: Redis cache for frequently accessed entity data
3. **Metrics**: Custom CloudWatch metrics for business KPIs
4. **Alerting**: SNS notifications for critical failures
5. **Analytics**: Data warehouse integration for advanced reporting

### Schema Enhancements
1. **Partitioning**: Partition tables by date for better query performance
2. **Materialized Views**: Pre-computed aggregations for common queries
3. **Full-Text Search**: Enhanced search capabilities for business names and references
4. **Data Archiving**: Automated archiving of historical data

## Troubleshooting

### Common Issues
1. **Database Connection**: Check VPC configuration and security groups
2. **Event Routing**: Verify EventBridge rule patterns match event structure
3. **Deduplication**: Check for duplicate `pspReference` values in dedupe registry
4. **Timeout**: Increase Lambda timeout for complex database operations

### Debugging Commands
```bash
# Check Lambda logs
aws logs tail /aws/lambda/{function-name}-standard-notification-handler --follow
aws logs tail /aws/lambda/{function-name}-kyc-notification-handler --follow
aws logs tail /aws/lambda/{function-name}-transfer-notification-handler --follow

# Query database directly
psql -h hostname -U username -d database_name

# Check EventBridge rules
aws events list-rules --event-bus-name adyen-webhook-bus-{environment}

# Check EventBridge targets
aws events list-targets-by-rule --rule standard-notification-rule-{environment}
```

## Summary

The enhanced webhook processing system provides:

✅ **Comprehensive Data Storage**: SCD Type 2 dimensions for historical tracking
✅ **Event Deduplication**: Prevents duplicate processing and data corruption
✅ **Audit Trail**: Complete webhook processing history and validation results
✅ **Scalable Architecture**: EventBridge-based routing for high-volume processing
✅ **Production Monitoring**: X-Ray tracing, CloudWatch logging, and performance metrics
✅ **Reporting Capabilities**: Rich analytics and data access endpoints
✅ **Security**: HMAC validation, deduplication, and encrypted storage

The system is production-ready and can handle high-volume webhook processing with full observability, data integrity, and comprehensive reporting capabilities. 