# Test Data Management Guide

**Note**: The test data handler is defined in the CDK stack but doesn't have explicit route definitions. It uses query parameters to determine the action and is accessible through the main HTTP API Gateway.

This document provides comprehensive information about test data management in the PayerSync Onboarder Backend, including creation, cleanup, and testing utilities.

## Overview

The test data management system provides tools and procedures for:
- Creating realistic test data for development and testing
- Cleaning up test data to maintain database performance
- Seeding databases with known test scenarios
- Managing test data across different environments

## Test Data Handler

### Function Overview

The test data handler (`src/functions/test-data-handler/index.ts`) provides endpoints for:
- Creating test onboarding sessions
- Generating test webhook events
- Cleaning up test data
- Seeding databases with specific test scenarios

### API Endpoints

#### Create Test Data

**POST /test-data/create**

Creates test onboarding sessions and events.

**Request:**
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sessions": 10,
    "events": 50,
    "status": "completed"
  }' \
  https://your-api-id.execute-api.region.amazonaws.com/test-data/create
```

**Response:**
```json
{
  "message": "Test data created successfully",
  "created": {
    "sessions": 10,
    "events": 50
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### Clean Test Data

**POST /test-data/clean**

Removes test data from the database.

**Request:**
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "olderThan": "2024-01-01T00:00:00.000Z",
    "status": "test"
  }' \
  https://your-api-id.execute-api.region.amazonaws.com/test-data/clean
```

**Response:**
```json
{
  "message": "Test data cleaned successfully",
  "removed": {
    "sessions": 25,
    "events": 150
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### Seed Database

**POST /test-data/seed**

Seeds the database with predefined test scenarios.

**Request:**
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "scenario": "basic_onboarding",
    "options": {
      "userCount": 100,
      "completionRate": 0.75
    }
  }' \
  https://your-api-id.execute-api.region.amazonaws.com/test-data/seed
```

**Response:**
```json
{
  "message": "Database seeded successfully",
  "scenario": "basic_onboarding",
  "created": {
    "users": 100,
    "sessions": 100,
    "events": 500,
    "completionRate": 75
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Test Scenarios

### Basic Onboarding Scenario

Creates a realistic onboarding flow with:
- User registration and authentication
- Onboarding session creation
- Step-by-step progress tracking
- Completion events

```json
{
  "scenario": "basic_onboarding",
  "description": "Standard onboarding flow with 75% completion rate",
  "data": {
    "users": 100,
    "sessions": 100,
    "events": 500,
    "completionRate": 75,
    "averageSteps": 5,
    "averageDuration": "2.5 days"
  }
}
```

### High Volume Scenario

Creates high-volume test data for performance testing:
- Large number of concurrent users
- Rapid event generation
- Stress testing database performance

```json
{
  "scenario": "high_volume",
  "description": "High-volume testing with 1000+ concurrent users",
  "data": {
    "users": 1000,
    "sessions": 1000,
    "events": 5000,
    "completionRate": 60,
    "concurrentUsers": 100,
    "eventsPerSecond": 10
  }
}
```

### Edge Cases Scenario

Creates edge case scenarios for testing:
- Incomplete onboarding sessions
- Failed webhook events
- Invalid data scenarios
- Error conditions

```json
{
  "scenario": "edge_cases",
  "description": "Edge cases and error conditions",
  "data": {
    "users": 50,
    "sessions": 50,
    "events": 200,
    "errorRate": 20,
    "incompleteSessions": 30,
    "invalidData": 10
  }
}
```

## Database Schema for Test Data

### Onboarding Sessions Table

```sql
CREATE TABLE onboarding_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  status VARCHAR(50),
  pmb_data JSONB,
  merchant_data JSONB,
  adyen_data JSONB,
  submission_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_onboarding_sessions_user_id ON onboarding_sessions(user_id);
CREATE INDEX idx_onboarding_sessions_status ON onboarding_sessions(status);
CREATE INDEX idx_onboarding_sessions_created_at ON onboarding_sessions(created_at);
```

### Onboarding Events Table

```sql
CREATE TABLE onboarding_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES onboarding_sessions(id),
  event_type VARCHAR(100) NOT NULL,
  event_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_onboarding_events_session_id ON onboarding_events(session_id);
CREATE INDEX idx_onboarding_events_event_type ON onboarding_events(event_type);
CREATE INDEX idx_onboarding_events_created_at ON onboarding_events(created_at);
```

## Test Data Generation

### User Data

```typescript
interface TestUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  role: string;
  createdAt: Date;
}
```

### Session Data

```typescript
interface TestSession {
  id: string;
  userId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  pmbData: any;
  merchantData: any;
  adyenData: any;
  submissionCount: number;
  createdAt: Date;
  updatedAt: Date;
}
```

### Event Data

```typescript
interface TestEvent {
  id: string;
  sessionId: string;
  eventType: string;
  eventData: any;
  createdAt: Date;
}
```

## Test Data Utilities

### Data Generators

#### User Generator
```typescript
function generateTestUser(): TestUser {
  return {
    id: `user_${uuidv4()}`,
    email: `test.user.${Date.now()}@example.com`,
    firstName: faker.name.firstName(),
    lastName: faker.name.lastName(),
    company: faker.company.companyName(),
    role: faker.name.jobTitle(),
    createdAt: new Date()
  };
}
```

#### Session Generator
```typescript
function generateTestSession(userId: string): TestSession {
  return {
    id: uuidv4(),
    userId,
    status: getRandomStatus(),
    pmbData: generatePmbData(),
    merchantData: generateMerchantData(),
    adyenData: generateAdyenData(),
    submissionCount: Math.floor(Math.random() * 5) + 1,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}
```

#### Event Generator
```typescript
function generateTestEvent(sessionId: string): TestEvent {
  return {
    id: uuidv4(),
    sessionId,
    eventType: getRandomEventType(),
    eventData: generateEventData(),
    createdAt: new Date()
  };
}
```

### Status Distribution

```typescript
const STATUS_DISTRIBUTION = {
  completed: 0.75,
  in_progress: 0.15,
  pending: 0.08,
  failed: 0.02
};

function getRandomStatus(): string {
  const random = Math.random();
  let cumulative = 0;
  
  for (const [status, probability] of Object.entries(STATUS_DISTRIBUTION)) {
    cumulative += probability;
    if (random <= cumulative) {
      return status;
    }
  }
  
  return 'pending';
}
```

### Event Type Distribution

```typescript
const EVENT_TYPE_DISTRIBUTION = {
  'session_started': 0.20,
  'step_completed': 0.40,
  'data_submitted': 0.25,
  'adyen_webhook': 0.10,
  'session_completed': 0.05
};

function getRandomEventType(): string {
  const random = Math.random();
  let cumulative = 0;
  
  for (const [eventType, probability] of Object.entries(EVENT_TYPE_DISTRIBUTION)) {
    cumulative += probability;
    if (random <= cumulative) {
      return eventType;
    }
  }
  
  return 'step_completed';
}
```

## Environment-Specific Configuration

### Development Environment

```typescript
const DEV_CONFIG = {
  maxTestUsers: 100,
  maxTestSessions: 100,
  maxTestEvents: 500,
  cleanupOlderThan: '7 days',
  allowDataCleanup: true
};
```

### Staging Environment

```typescript
const STAGING_CONFIG = {
  maxTestUsers: 500,
  maxTestSessions: 500,
  maxTestEvents: 2500,
  cleanupOlderThan: '3 days',
  allowDataCleanup: true
};
```

### Production Environment

```typescript
const PROD_CONFIG = {
  maxTestUsers: 0,
  maxTestSessions: 0,
  maxTestEvents: 0,
  cleanupOlderThan: 'never',
  allowDataCleanup: false
};
```

## Cleanup Procedures

### Automatic Cleanup

The system automatically cleans up test data based on:
- Age of test data (configurable per environment)
- Status of test sessions
- Storage constraints
- Performance requirements

### Manual Cleanup

```bash
# Clean test data older than 7 days
curl -X POST \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "olderThan": "2024-01-08T00:00:00.000Z",
    "status": "test"
  }' \
  https://your-api-id.execute-api.region.amazonaws.com/test-data/clean
```

### Cleanup Verification

```bash
# Check remaining test data
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "https://your-api-id.execute-api.region.amazonaws.com/reporting/data?table=onboarding_sessions&status=test"
```

## Performance Considerations

### Database Performance

- Use batch inserts for large datasets
- Implement proper indexing for test data
- Monitor query performance during test data creation
- Use connection pooling for database operations

### Memory Management

- Process data in chunks to avoid memory issues
- Implement proper error handling for large operations
- Use streaming for large data exports
- Monitor Lambda memory usage

### Storage Optimization

- Compress test data when possible
- Implement data archiving for old test data
- Use appropriate data types for storage efficiency
- Monitor storage costs and usage

## Security Considerations

### Data Isolation

- Test data is clearly marked with test status
- Separate test data from production data
- Implement proper access controls for test data
- Use environment-specific test data

### Access Control

- Only authorized users can create test data
- Test data creation requires proper authentication
- Implement audit logging for test data operations
- Restrict test data access based on user roles

### Data Privacy

- Test data does not contain real personal information
- Use anonymized or synthetic data for testing
- Implement data retention policies for test data
- Ensure GDPR compliance for test data handling

## Monitoring and Logging

### Test Data Metrics

Monitor key metrics:
- Number of test sessions created
- Test data cleanup frequency
- Database performance during test data operations
- Storage usage for test data

### Logging

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "INFO",
  "message": "Test data created",
  "userId": "user123",
  "operation": "create_test_data",
  "details": {
    "sessions": 10,
    "events": 50,
    "duration": 1500
  }
}
```

### Alerts

Set up alerts for:
- Test data creation failures
- Cleanup operation failures
- Database performance degradation
- Storage usage thresholds

## Testing

### Unit Tests

```bash
npm test test/test-data-handler.test.ts
```

### Integration Tests

```bash
npm run test:integration
```

### Manual Testing

```bash
# Create test data
curl -X POST \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sessions": 5, "events": 25}' \
  https://your-api-id.execute-api.region.amazonaws.com/test-data/create

# Verify test data
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "https://your-api-id.execute-api.region.amazonaws.com/reporting/data?table=onboarding_sessions&limit=10"

# Clean test data
curl -X POST \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"olderThan": "2024-01-01T00:00:00.000Z"}' \
  https://your-api-id.execute-api.region.amazonaws.com/test-data/clean
```

## Troubleshooting

### Common Issues

1. **Test Data Creation Failures**
   - Check database connection
   - Verify Lambda permissions
   - Monitor database performance
   - Check for storage constraints

2. **Cleanup Operation Failures**
   - Verify cleanup criteria
   - Check database constraints
   - Monitor transaction logs
   - Verify user permissions

3. **Performance Issues**
   - Monitor database query performance
   - Check Lambda timeout settings
   - Review batch processing logic
   - Monitor memory usage

4. **Data Consistency Issues**
   - Verify foreign key constraints
   - Check data integrity rules
   - Monitor transaction rollbacks
   - Review data validation logic

### Debugging Commands

```bash
# Check test data handler logs
aws logs tail /aws/lambda/payerSyncOnboarder-{env}-test-data-handler --follow

# Check database performance
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name CPUUtilization \
  --dimensions Name=DBInstanceIdentifier,Value=payerSyncOnboarder-{env}-onboarding-reporting \
  --start-time $(date -d '1 hour ago' --iso-8601) \
  --end-time $(date --iso-8601) \
  --period 300 \
  --statistics Average

# Check test data in database
aws rds-data execute-statement \
  --resource-arn "arn:aws:rds:region:account:cluster:payerSyncOnboarder-{env}-onboarding-reporting" \
  --sql "SELECT COUNT(*) FROM onboarding_sessions WHERE status = 'test'"
```

## Best Practices

### Test Data Management

1. **Use Realistic Data**: Generate test data that resembles real usage patterns
2. **Maintain Data Consistency**: Ensure referential integrity across test data
3. **Clean Up Regularly**: Implement automated cleanup procedures
4. **Monitor Performance**: Track the impact of test data on system performance
5. **Version Control**: Keep test data schemas in version control

### Development Workflow

1. **Create Test Data**: Use the test data handler to create realistic test scenarios
2. **Run Tests**: Execute comprehensive tests with the test data
3. **Analyze Results**: Use reporting APIs to analyze test results
4. **Clean Up**: Remove test data after testing is complete
5. **Document Changes**: Update documentation for any test data changes

### Environment Management

1. **Development**: Allow full test data management capabilities
2. **Staging**: Limit test data to reasonable volumes
3. **Production**: Disable test data creation and cleanup
4. **Monitoring**: Track test data usage across all environments 