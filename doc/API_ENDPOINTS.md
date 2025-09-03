# API Endpoints Documentation

This document provides a comprehensive overview of all API endpoints in the PayerSync Onboarder Backend, accurately reflecting the CDK stack implementation.

## Overview

The application uses **2 separate API Gateways** to handle different types of requests:

1. **HTTP API Gateway** - Main application endpoints with Cognito JWT authentication
2. **REST API Gateway** - Webhook endpoints with Basic Auth authentication

## HTTP API Gateway (Main Application)

**Base URL**: `https://{api-id}.execute-api.{region}.amazonaws.com`  
**Authentication**: Cognito JWT Token required  
**CORS**: Environment-specific allowed origins

### Core Onboarding Endpoints

#### `POST /payload`
**Purpose**: Stores and merges onboarding data (PMB data and merchant data)  
**Authentication**: Required (Cognito JWT)  
**Handler**: `PayloadHandler` Lambda  
**Storage**: DynamoDB with deep merging capabilities

**Request Body**:
```json
{
  "pmbData": { /* PMB-specific data */ },
  "merchantData": { /* Merchant-specific data */ }
}
```

#### `GET /payload`
**Purpose**: Retrieves user's onboarding data  
**Authentication**: Required (Cognito JWT)  
**Handler**: `GetPayloadHandler` Lambda  
**Source**: DynamoDB

**Response**:
```json
{
  "userId": "user-123",
  "pmbData": { /* PMB data */ },
  "merchantData": { /* Merchant data */ },
  "adyenData": { /* Adyen integration data */ },
  "status": "READY_FOR_ADYEN",
  "submissionCount": 1,
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:30:00Z"
}
```

#### `POST /generate-link`
**Purpose**: Generates Adyen hosted onboarding link  
**Authentication**: Required (Cognito JWT)  
**Handler**: `GenerateOnboardingLinkHandler` Lambda  
**Integration**: Adyen APIs (LEM, BP, PSP)

**Request Body**:
```json
{
  "userId": "user-123",
  "merchantData": { /* Merchant information */ }
}
```

**Response**:
```json
{
  "onboardingUrl": "https://adyen.com/onboarding/...",
  "adyenEntities": {
    "legalEntityId": "LE123456789",
    "accountHolderId": "AH123456789"
  }
}
```



### Reporting Endpoints

#### `GET /reporting/schema`
**Purpose**: Retrieves database schema information  
**Authentication**: Required (Cognito JWT)  
**Handler**: `ReportingHandler` Lambda  
**Response**: Complete database schema with tables, columns, and constraints

#### `GET /reporting/schema/{tableName}`
**Purpose**: Gets specific table schema  
**Authentication**: Required (Cognito JWT)  
**Handler**: `ReportingHandler` Lambda  
**Path Parameters**: `tableName` - Name of the table

**Available Tables**:
- `legal_entities` - Legal entity information
- `account_holders` - Account holder details
- `accounts` - Account information
- `adyen_events` - Webhook event data
- `webhook_receipts` - Webhook processing audit
- `dedupe_registry` - Event deduplication

#### `GET /reporting/data`
**Purpose**: Retrieves reporting data with filtering, sorting, and pagination  
**Authentication**: Required (Cognito JWT)  
**Handler**: `ReportingHandler` Lambda

**Query Parameters**:
- `table` - Table name (required)
- `filters` - JSON array of filter conditions
- `sort` - JSON array of sort criteria
- `page` - Page number for pagination
- `limit` - Number of records per page
- `fields` - Comma-separated list of fields to return

**Example Request**:
```bash
GET /reporting/data?table=adyen_events&filters=[{"field":"event_code","operator":"eq","value":"ACCOUNT_HOLDER_STATUS_CHANGE"}]&sort=[{"field":"webhook_received_at","direction":"desc"}]&page=1&limit=10
```

#### `GET /reporting/stats`
**Purpose**: Gets basic reporting statistics  
**Authentication**: Required (Cognito JWT)  
**Handler**: `ReportingHandler` Lambda  
**Response**: Counts and summaries for all tables

#### `GET /reporting/stats/analytics`
**Purpose**: Retrieves analytics data for charts  
**Authentication**: Required (Cognito JWT)  
**Handler**: `ReportingHandler` Lambda  
**Response**: Time-series data and aggregated metrics

## REST API Gateway (Webhook API)

**Base URL**: `https://{api-id}.execute-api.{region}.amazonaws.com/prod`  
**Authentication**: Basic Auth (username/password)  
**Purpose**: Secure webhook reception from Adyen

### Webhook Endpoints

#### `POST /adyen/webhook`
**Purpose**: Receives Adyen webhook notifications  
**Authentication**: Basic Auth required  
**Handler**: `AdyenWebhookHandler` Lambda  
**Validation**: HMAC signature validation  
**Storage**: S3 + EventBridge + PostgreSQL

**Headers Required**:
```
Authorization: Basic {base64(username:password)}
Content-Type: application/json
```

**Response**:
- `202 Accepted` - Webhook processed successfully
- `401 Unauthorized` - Authentication or validation failed
- `400 Bad Request` - Invalid payload structure

#### `GET /adyen/webhook`
**Purpose**: Health check endpoint for webhook service  
**Authentication**: None required  
**Handler**: `AdyenWebhookHealthCheck` Lambda  
**Use Case**: Monitoring and load balancer health checks

## Test Data Management Endpoints

**Note**: These endpoints are defined in the test data handler but don't have explicit route definitions in the CDK stack. They use query parameters to determine the action.

### `GET /test-data?action=add`
**Purpose**: Creates test onboarding sessions and events  
**Authentication**: Required (Cognito JWT)  
**Handler**: `TestDataHandler` Lambda  
**Use Case**: Development and testing data seeding

### `GET /test-data?action=query`
**Purpose**: Queries test data from database  
**Authentication**: Required (Cognito JWT)  
**Handler**: `TestDataHandler` Lambda  
**Response**: Summary of test data across all tables

### `GET /test-data?action=clear`
**Purpose**: Cleans up test data  
**Authentication**: Required (Cognito JWT)  
**Handler**: `TestDataHandler` Lambda  
**Use Case**: Cleanup after testing

## Authentication & Security

### Cognito JWT Authentication
- **Required for**: All main application endpoints
- **Token Format**: `Authorization: Bearer <jwt-token>`
- **User Pool**: Environment-specific Cognito User Pool
- **Attributes**: email, given_name, family_name

### Basic Auth Authentication
- **Required for**: Webhook endpoints
- **Format**: `Authorization: Basic {base64(username:password)}`
- **Storage**: AWS Secrets Manager with KMS encryption
- **Rotation**: Manual rotation for security

### HMAC Signature Validation
- **Purpose**: Validates webhook authenticity from Adyen
- **Algorithm**: SHA256 HMAC
- **Secret Storage**: AWS Secrets Manager
- **Validation**: Hex-to-binary conversion as per Adyen requirements

## CORS Configuration

**Environment-specific allowed origins** configured in CDK stack:
- Development: Local development URLs
- Staging: Staging environment URLs
- Production: Production domain URLs

**Headers Allowed**:
- `Content-Type`
- `Authorization`

**Methods Allowed**:
- `GET`
- `POST`
- `OPTIONS`

## Error Handling

### Standard Error Response Format
```json
{
  "error": "Error Type",
  "message": "Human-readable error description",
  "details": { /* Additional error context */ }
}
```

### Common HTTP Status Codes
- `200 OK` - Request successful
- `201 Created` - Resource created successfully
- `400 Bad Request` - Invalid request parameters
- `401 Unauthorized` - Authentication required or failed
- `403 Forbidden` - Insufficient permissions
- `404 Not Found` - Resource not found
- `500 Internal Server Error` - Server-side error

## Rate Limiting & Throttling

- **API Gateway**: Default AWS API Gateway limits
- **Lambda Functions**: Concurrent execution limits per function
- **Database**: Connection pool limits for RDS
- **EventBridge**: Event processing rate limits

## Monitoring & Observability

### CloudWatch Logs
- **Log Groups**: Separate for each Lambda function
- **Retention**: 7 days for Lambda logs, 1 year for webhook logs
- **Structured Logging**: JSON format with consistent fields

### X-Ray Tracing
- **Distributed Tracing**: Across all Lambda functions
- **Performance Monitoring**: Function execution times
- **Dependency Mapping**: Service interaction visualization

### Metrics
- **API Gateway**: Request counts, latency, error rates
- **Lambda**: Invocation counts, duration, errors
- **Database**: Connection counts, query performance
- **EventBridge**: Event processing rates, failures

## CDK Stack Implementation

### HTTP API Gateway Routes
```typescript
// Core onboarding routes
httpApi.addRoutes({
  path: '/payload',
  methods: [apigatewayv2.HttpMethod.POST],
  integration: new integrations.HttpLambdaIntegration('PayloadHandlerIntegration', payloadHandler),
  authorizer: httpApiAuthorizer,
});

// Reporting routes
httpApi.addRoutes({
  path: '/reporting/schema',
  methods: [apigatewayv2.HttpMethod.GET],
  integration: new integrations.HttpLambdaIntegration('ReportingSchemaIntegration', reportingHandler),
  authorizer: httpApiAuthorizer,
});
```

### REST API Gateway Resources
```typescript
// Webhook resource
const webhookResource = restApi.root.addResource('adyen').addResource('webhook');

// POST method with Basic Auth
const webhookMethod = webhookResource.addMethod('POST', new apigateway.LambdaIntegration(adyenWebhookHandler), {
  authorizer: basicAuthAuthorizer,
  authorizationType: apigateway.AuthorizationType.CUSTOM,
});

// GET method for health checks
const webhookHealthCheckMethod = webhookResource.addMethod('GET', new apigateway.LambdaIntegration(adyenWebhookHealthCheck));
```

## Testing Endpoints

### Postman Collection
A complete Postman collection is available in `scripts/Payersync Onboarding.postman_collection.json` with:
- All endpoint examples
- Authentication headers
- Sample request bodies
- Expected responses

### HTTP Test Files
HTTP test files are available in `test/api_cli/` for:
- Manual testing
- Integration testing
- Performance testing

## Deployment Notes

- **Environment Variables**: Configured via CDK stack
- **Secrets**: Automatically created and managed by CDK
- **CORS**: Environment-specific configuration
- **Monitoring**: Automatic CloudWatch and X-Ray setup
- **Security**: CDK Nag compliance checks during deployment 