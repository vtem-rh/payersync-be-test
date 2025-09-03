# Reporting API Documentation

This document provides comprehensive information about the reporting API endpoints in the PayerSync Onboarder Backend.

## Overview

The reporting API provides access to analytics, statistics, and data insights from the onboarding database. All endpoints require Cognito JWT authentication and are designed for secure, performant data access.

## Authentication

All reporting endpoints require a valid Cognito JWT token in the Authorization header:

```bash
Authorization: Bearer <jwt-token>
```

## Base URL

```
https://{api-id}.execute-api.{region}.amazonaws.com
```

## Endpoints

### 1. Get Database Schema

#### `GET /reporting/schema`

Returns the complete database schema information including tables, columns, data types, and constraints.

**Request:**
```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://your-api-id.execute-api.region.amazonaws.com/reporting/schema
```

**Response:**
```json
{
  "tables": [
    {
      "tableName": "onboarding_sessions",
      "columns": [
        {
          "columnName": "id",
          "dataType": "uuid",
          "isNullable": false,
          "isPrimaryKey": true
        },
        {
          "columnName": "user_id",
          "dataType": "character varying",
          "isNullable": false
        },
        {
          "columnName": "status",
          "dataType": "character varying",
          "isNullable": true
        },
        {
          "columnName": "created_at",
          "dataType": "timestamp with time zone",
          "isNullable": false
        },
        {
          "columnName": "updated_at",
          "dataType": "timestamp with time zone",
          "isNullable": false
        }
      ],
      "indexes": [
        {
          "indexName": "idx_onboarding_sessions_user_id",
          "columns": ["user_id"]
        }
      ]
    },
    {
      "tableName": "onboarding_events",
      "columns": [
        {
          "columnName": "id",
          "dataType": "uuid",
          "isNullable": false,
          "isPrimaryKey": true
        },
        {
          "columnName": "session_id",
          "dataType": "uuid",
          "isNullable": false
        },
        {
          "columnName": "event_type",
          "dataType": "character varying",
          "isNullable": false
        },
        {
          "columnName": "event_data",
          "dataType": "jsonb",
          "isNullable": true
        },
        {
          "columnName": "created_at",
          "dataType": "timestamp with time zone",
          "isNullable": false
        }
      ]
    }
  ]
}
```

### 2. Get Specific Table Schema

#### `GET /reporting/schema/{tableName}`

Returns detailed schema information for a specific table.

**Request:**
```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://your-api-id.execute-api.region.amazonaws.com/reporting/schema/onboarding_sessions
```

**Response:**
```json
{
  "tableName": "onboarding_sessions",
  "columns": [
    {
      "columnName": "id",
      "dataType": "uuid",
      "isNullable": false,
      "isPrimaryKey": true,
      "defaultValue": "gen_random_uuid()"
    },
    {
      "columnName": "user_id",
      "dataType": "character varying",
      "isNullable": false,
      "maxLength": 255
    },
    {
      "columnName": "status",
      "dataType": "character varying",
      "isNullable": true,
      "maxLength": 50
    },
    {
      "columnName": "created_at",
      "dataType": "timestamp with time zone",
      "isNullable": false,
      "defaultValue": "CURRENT_TIMESTAMP"
    },
    {
      "columnName": "updated_at",
      "dataType": "timestamp with time zone",
      "isNullable": false,
      "defaultValue": "CURRENT_TIMESTAMP"
    }
  ],
  "indexes": [
    {
      "indexName": "idx_onboarding_sessions_user_id",
      "columns": ["user_id"],
      "isUnique": false
    },
    {
      "indexName": "idx_onboarding_sessions_status",
      "columns": ["status"],
      "isUnique": false
    }
  ],
  "constraints": [
    {
      "constraintName": "pk_onboarding_sessions",
      "constraintType": "PRIMARY KEY",
      "columns": ["id"]
    }
  ]
}
```

### 3. Get Reporting Data

#### `GET /reporting/data`

Returns onboarding data with optional filtering and pagination.

**Query Parameters:**
- `table` (required): Table name to query
- `limit` (optional): Number of records to return (default: 100, max: 1000)
- `offset` (optional): Number of records to skip (default: 0)
- `status` (optional): Filter by status
- `start_date` (optional): Filter by start date (ISO 8601 format)
- `end_date` (optional): Filter by end date (ISO 8601 format)

**Request:**
```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "https://your-api-id.execute-api.region.amazonaws.com/reporting/data?table=onboarding_sessions&limit=50&status=completed"
```

**Response:**
```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "user_id": "user123",
      "status": "completed",
      "created_at": "2024-01-15T10:30:00.000Z",
      "updated_at": "2024-01-15T11:45:00.000Z"
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

### 4. Get Statistics

#### `GET /reporting/stats`

Returns aggregated statistics and metrics.

**Query Parameters:**
- `period` (optional): Time period for stats (day, week, month, year, default: month)
- `start_date` (optional): Start date for stats (ISO 8601 format)
- `end_date` (optional): End date for stats (ISO 8601 format)

**Request:**
```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "https://your-api-id.execute-api.region.amazonaws.com/reporting/stats?period=month"
```

**Response:**
```json
{
  "period": "month",
  "startDate": "2024-01-01T00:00:00.000Z",
  "endDate": "2024-01-31T23:59:59.999Z",
  "stats": {
    "totalSessions": 1250,
    "completedSessions": 980,
    "pendingSessions": 270,
    "completionRate": 78.4,
    "averageCompletionTime": "2.5 days",
    "topStatuses": [
      {
        "status": "completed",
        "count": 980,
        "percentage": 78.4
      },
      {
        "status": "pending",
        "count": 270,
        "percentage": 21.6
      }
    ],
    "dailyStats": [
      {
        "date": "2024-01-01",
        "newSessions": 45,
        "completedSessions": 32,
        "completionRate": 71.1
      }
    ]
  }
}
```

### 5. Get Advanced Analytics

#### `GET /reporting/stats/analytics`

Returns advanced analytics and insights.

**Query Parameters:**
- `metric` (optional): Specific metric to analyze (conversion, retention, performance)
- `groupBy` (optional): Grouping dimension (day, week, month, status)
- `start_date` (optional): Start date for analysis (ISO 8601 format)
- `end_date` (optional): End date for analysis (ISO 8601 format)

**Request:**
```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "https://your-api-id.execute-api.region.amazonaws.com/reporting/stats/analytics?metric=conversion&groupBy=week"
```

**Response:**
```json
{
  "metric": "conversion",
  "groupBy": "week",
  "startDate": "2024-01-01T00:00:00.000Z",
  "endDate": "2024-01-31T23:59:59.999Z",
  "analytics": {
    "conversionFunnel": {
      "totalStarted": 1250,
      "step1Completed": 1100,
      "step2Completed": 950,
      "step3Completed": 980,
      "conversionRates": {
        "step1": 88.0,
        "step2": 86.4,
        "step3": 103.2
      }
    },
    "trends": [
      {
        "period": "2024-01-01",
        "value": 78.4,
        "change": 2.1
      }
    ],
    "segments": [
      {
        "segment": "new_users",
        "conversionRate": 75.2,
        "count": 450
      },
      {
        "segment": "returning_users",
        "conversionRate": 82.1,
        "count": 800
      }
    ]
  }
}
```

## Error Handling

### Common Error Responses

| Status Code | Description | Cause |
|-------------|-------------|-------|
| 400 | Bad Request | Invalid query parameters or malformed request |
| 401 | Unauthorized | Missing or invalid JWT token |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Table or resource not found |
| 500 | Internal Server Error | Database connection or processing error |

### Error Response Format

```json
{
  "error": "Bad Request",
  "message": "Invalid query parameter: limit must be between 1 and 1000",
  "details": {
    "parameter": "limit",
    "value": "1500",
    "constraint": "max 1000"
  }
}
```

## Rate Limiting

- **Default Limit**: 1000 requests per hour per user
- **Burst Limit**: 100 requests per minute per user
- **Response Headers**: Include rate limit information

```json
{
  "X-RateLimit-Limit": "1000",
  "X-RateLimit-Remaining": "950",
  "X-RateLimit-Reset": "1642233600"
}
```

## Performance Considerations

### Query Optimization
- Use appropriate indexes for filtering
- Implement pagination for large datasets
- Cache frequently accessed data
- Monitor query performance

### Caching Strategy
- Cache schema information for 1 hour
- Cache statistics for 15 minutes
- Cache analytics for 1 hour
- Implement ETags for conditional requests

### Database Connection
- Use connection pooling
- Monitor connection usage
- Implement query timeouts
- Handle connection failures gracefully

## Security

### Data Protection
- All data encrypted at rest
- All data encrypted in transit
- JWT token validation
- Role-based access control

### Access Control
- Cognito JWT authentication required
- User-specific data filtering
- Audit logging for all requests
- Rate limiting to prevent abuse

### Compliance
- GDPR compliance for data access
- Data retention policies
- Audit trail maintenance
- Secure data transmission

## Monitoring

### Key Metrics
- Request count and response times
- Error rates and types
- Database query performance
- Cache hit rates
- Authentication success/failure rates

### Logging
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "INFO",
  "message": "Reporting API request",
  "userId": "user123",
  "endpoint": "/reporting/stats",
  "responseTime": 245,
  "statusCode": 200
}
```

## Testing

### Unit Tests
```bash
npm test test/reporting-api.test.ts
```

### Integration Tests
```bash
npm run test:integration
```

### Manual Testing
```bash
# Test with valid JWT token
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://your-api-id.execute-api.region.amazonaws.com/reporting/schema

# Test error handling
curl -H "Authorization: Bearer INVALID_TOKEN" \
  https://your-api-id.execute-api.region.amazonaws.com/reporting/schema
```

## Examples

### Complete Workflow Example

```bash
# 1. Get database schema
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://your-api-id.execute-api.region.amazonaws.com/reporting/schema

# 2. Get monthly statistics
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "https://your-api-id.execute-api.region.amazonaws.com/reporting/stats?period=month"

# 3. Get conversion analytics
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "https://your-api-id.execute-api.region.amazonaws.com/reporting/stats/analytics?metric=conversion"

# 4. Get specific table data
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "https://your-api-id.execute-api.region.amazonaws.com/reporting/data?table=onboarding_sessions&limit=10"
```

## Troubleshooting

### Common Issues

1. **Authentication Failures**
   - Verify JWT token is valid and not expired
   - Check Cognito user pool configuration
   - Ensure proper authorization scopes

2. **Database Connection Issues**
   - Check RDS instance status
   - Verify VPC and security group configuration
   - Monitor connection pool usage

3. **Performance Issues**
   - Check database query performance
   - Monitor Lambda function duration
   - Review caching strategy

4. **Data Access Issues**
   - Verify table exists in database
   - Check user permissions
   - Review data filtering logic

### Debugging Commands

```bash
# Check Lambda logs
aws logs tail /aws/lambda/payerSyncOnboarder-{env}-reporting-handler --follow

# Check database metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name CPUUtilization \
  --dimensions Name=DBInstanceIdentifier,Value=payerSyncOnboarder-{env}-onboarding-reporting \
  --start-time $(date -d '1 hour ago' --iso-8601) \
  --end-time $(date --iso-8601) \
  --period 300 \
  --statistics Average

# Test database connection
aws rds describe-db-instances \
  --db-instance-identifier payerSyncOnboarder-{env}-onboarding-reporting
``` 