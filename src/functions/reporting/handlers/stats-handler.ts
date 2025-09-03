import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserId, getUserEmail } from '../../shared/dynamodb-helpers';
import { ReportingService } from '../data-access/reporting-service';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // Route to appropriate handler based on path
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

    const { type } = event.pathParameters || {};

    if (type === 'analytics') {
      // Get analytics data for charts
      const analyticsData = await ReportingService.getAnalyticsData();
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,OPTIONS'
        },
        body: JSON.stringify({
          type: 'analytics',
          data: analyticsData,
          message: 'Analytics data retrieved successfully'
        })
      };
    }

    // Default: Get basic reporting stats
    const stats = await ReportingService.getReportingStats();
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,OPTIONS'
      },
      body: JSON.stringify({
        type: 'stats',
        data: stats,
        message: 'Reporting statistics retrieved successfully'
      })
    };

  } catch (error) {
    console.error('Error in stats handler:', error);
    
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
        message: 'Failed to retrieve statistics'
      })
    };
  }
}; 