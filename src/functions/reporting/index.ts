import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler as schemaHandler } from './handlers/schema-handler';
import { handler as dataHandler } from './handlers/data-handler';
import { handler as statsHandler } from './handlers/stats-handler';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // Route to appropriate handler based on path
    const path = (event as any).rawPath || event.path;
    const httpMethod = event.httpMethod;

    // Route based on path and method
    if (path.startsWith('/reporting/schema')) {
      return await schemaHandler(event);
    } else if (path.startsWith('/reporting/data')) {
      return await dataHandler(event);
    } else if (path.startsWith('/reporting/stats')) {
      return await statsHandler(event);
    } else {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,OPTIONS'
        },
        body: JSON.stringify({
          error: 'Not Found',
          message: 'Reporting endpoint not found',
          availableEndpoints: [
            'GET /reporting/schema - Get available tables',
            'GET /reporting/schema/{tableName} - Get table schema',
            'GET /reporting/schema/test - Get comprehensive database schema (test endpoint)',
            'GET /reporting/data?table={tableName}&filters={filters}&sort={sort}&page={page}&limit={limit}&fields={fields} - Get data with filtering, sorting, and pagination',
            'GET /reporting/stats - Get basic reporting statistics',
            'GET /reporting/stats/analytics - Get analytics data for charts'
          ]
        })
      };
    }

  } catch (error) {
    console.error('Error in reporting handler:', error);
    
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
        message: 'Failed to process reporting request'
      })
    };
  }
}; 