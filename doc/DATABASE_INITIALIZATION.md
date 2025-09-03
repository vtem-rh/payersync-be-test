# Database Initialization Guide

This document explains the automatic database initialization implementation for the RDS PostgreSQL database during deployment.

## Overview

The PayerSync Onboarder Backend uses an RDS PostgreSQL database for reporting and analytics. The database is automatically initialized with tables, indexes, functions, and triggers during deployment using a Custom Resource approach.

## Implementation

### Custom Resource Approach

The database initialization uses a Custom Resource that:
- Runs automatically during deployment
- Is idempotent - safe to run multiple times
- Provides detailed logging and error handling
- Can be triggered on stack updates
- Integrates well with CDK lifecycle

**Benefits:**
- ✅ Runs automatically during deployment
- ✅ Idempotent - safe to run multiple times
- ✅ Provides detailed logging and error handling
- ✅ Can be triggered on stack updates
- ✅ Integrates well with CDK lifecycle

## Implementation Details

### Custom Resource Handler

The database initialization is handled by `src/functions/onboarding/dbInit/custom-resource-handler.ts`:

```typescript
export const handler = async (event: CloudFormationCustomResourceEvent): Promise<CloudFormationCustomResourceResponse> => {
  // Handles Create, Update, and Delete events
  // Initializes database tables, indexes, functions, and triggers
}
```

### Database Schema

The initialization creates:

1. **Tables:**
   - `onboarding_sessions` - Stores user onboarding session data
   - `onboarding_events` - Stores webhook events and API messages

2. **Indexes:**
   - Performance indexes on frequently queried columns
   - Composite indexes for complex queries

3. **Functions:**
   - `update_updated_at_column()` - Automatically updates timestamps

4. **Triggers:**
   - `update_onboarding_sessions_updated_at` - Maintains updated_at column

### CDK Stack Integration

The Custom Resource is integrated into the CDK stack in `lib/payersync-onboarder-backend-stack.ts`:

```typescript
// Create Custom Resource Lambda for database initialization
const dbInitCustomResourceFunction = new lambdaNodejs.NodejsFunction(this, 'DatabaseInitCustomResourceFunction', {
  // ... configuration
});

// Create Custom Resource Provider
const dbInitCustomResource = new customResources.Provider(this, 'DatabaseInitProvider', {
  onEventHandler: dbInitCustomResourceFunction,
});

// Create the Custom Resource
new cdk.CustomResource(this, 'DatabaseInitCustomResource', {
  serviceToken: dbInitCustomResource.serviceToken,
  properties: {
    Timestamp: new Date().toISOString(), // Ensures execution on updates
  },
});
```

## Deployment Behavior

### First Deployment
- Custom Resource creates the database schema
- All tables, indexes, functions, and triggers are created
- Detailed logging is available in CloudWatch

### Subsequent Deployments
- Custom Resource runs but skips table creation (idempotent)
- Functions and triggers are updated if needed
- No data loss or disruption

### Stack Deletion
- Custom Resource handles cleanup gracefully
- Database tables remain (as expected for data persistence)

## Monitoring and Troubleshooting

### CloudWatch Logs
- Custom Resource logs: `/aws/lambda/{function-name}`
- Database initialization logs: Detailed step-by-step logging

### Common Issues

1. **Database Connection Timeout**
   - Increase Lambda timeout in CDK stack
   - Check VPC and security group configuration

2. **Permission Errors**
   - Verify Lambda has database connect permissions
   - Check Secrets Manager access

3. **Schema Already Exists**
   - Normal behavior - initialization is idempotent
   - Check logs for "tables already exist" message



## Best Practices

1. **Idempotency**: All database operations use `IF NOT EXISTS` or `CREATE OR REPLACE`
2. **Error Handling**: Comprehensive try-catch blocks with detailed logging
3. **Resource Cleanup**: Proper connection closing in finally blocks
4. **Security**: Database credentials stored in Secrets Manager
5. **Monitoring**: X-Ray tracing and CloudWatch logging enabled



## Testing

To test the database initialization:

1. Deploy to a test environment: `npm run deploy dev`
2. Check CloudWatch logs for initialization steps
3. Verify tables exist in the database
4. Test reporting endpoints

 