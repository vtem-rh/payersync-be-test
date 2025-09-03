import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserId, getUserEmail } from '../../shared/dynamodb-helpers';
import { ReportingService } from '../data-access/reporting-service';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // Route to appropriate handler based on path
    const { tableName } = event.pathParameters || {};
    const path = (event as any).rawPath || event.path;

    // Check if this is a test endpoint (bypass auth for testing)
    if (path === '/reporting/schema/test') {
      // Return comprehensive database schema without authentication
      const databaseSchema = await ReportingService.getDatabaseSchema();
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,OPTIONS'
        },
        body: JSON.stringify({
          ...databaseSchema,
          message: 'Comprehensive database schema information (test endpoint)'
        })
      };
    }

    // Check authorization using the same pattern as other Lambda functions
    const userId = getUserId(event);
    if (!userId) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,OPTIONS'
        },
        body: JSON.stringify({
          error: 'Unauthorized',
          message: 'Missing user ID'
        })
      };
    }

    // Get user email from JWT token (optional check)
    const userEmail = getUserEmail(event);

    // Check if this is a request for comprehensive database schema
    // Use more robust path checking
    if ((path === '/reporting/schema' || path.includes('/reporting/schema')) && !tableName) {
      // Return comprehensive database schema
      const databaseSchema = await ReportingService.getDatabaseSchema();
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,OPTIONS'
        },
        body: JSON.stringify({
          ...databaseSchema,
          message: 'Comprehensive database schema information'
        })
      };
    }

    if (!tableName) {
      // Return list of available tables
      const availableTables = await ReportingService.getAvailableTables();
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,OPTIONS'
        },
        body: JSON.stringify({
          tables: availableTables,
          message: 'Available tables for reporting'
        })
      };
    }

    // Get schema for specific table
    const schema = await ReportingService.getTableSchema(tableName);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,OPTIONS'
      },
      body: JSON.stringify({
        schema,
        message: `Schema for table: ${tableName}`
      })
    };

  } catch (error) {
    console.error('Error in schema handler:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,OPTIONS'
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: 'Failed to retrieve schema information'
      })
    };
  }
}; 