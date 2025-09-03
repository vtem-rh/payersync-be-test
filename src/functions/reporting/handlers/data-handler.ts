import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserId, getUserEmail } from '../../shared/dynamodb-helpers';
import { ReportingService, ReportingQuery } from '../data-access/reporting-service';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
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
    
    // Parse query parameters
    const queryParams = event.queryStringParameters || {};
    const table = queryParams.table as 'legal_entities' | 'account_holders' | 'accounts' | 'adyen_events';
    
    if (!table) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,OPTIONS'
        },
        body: JSON.stringify({
          error: 'Bad Request',
          message: 'Table parameter is required'
        })
      };
    }

    // Parse filters
    const filters = parseFilters(queryParams.filters);
    
    // Parse sorting
    const sort = parseSorting(queryParams.sort);
    
    // Parse pagination
    const pagination = parsePagination(queryParams.page, queryParams.limit);
    
    // Parse fields
    const fields = queryParams.fields ? queryParams.fields.split(',') : ['*'];

    // Build query object
    const query: ReportingQuery = {
      table,
      filters,
      sort,
      pagination,
      fields
    };

    // Execute query
    const result = await ReportingService.executeQuery(query);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,OPTIONS'
      },
      body: JSON.stringify({
        ...result,
        query: {
          table,
          filters: filters.length > 0 ? filters : undefined,
          sort: sort.length > 0 ? sort : undefined,
          pagination: pagination || undefined,
          fields: fields.length > 0 && fields[0] !== '*' ? fields : undefined
        }
      })
    };

  } catch (error) {
    console.error('Error in data handler:', error);
    
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
        message: 'Failed to retrieve data'
      })
    };
  }
};

function parseFilters(filtersParam?: string): any[] {
  if (!filtersParam) return [];
  
  try {
    const filters = JSON.parse(filtersParam);
    return Array.isArray(filters) ? filters : [];
  } catch (error) {
    console.warn('Invalid filters parameter:', filtersParam);
    return [];
  }
}

function parseSorting(sortParam?: string): any[] {
  if (!sortParam) return [];
  
  try {
    const sort = JSON.parse(sortParam);
    return Array.isArray(sort) ? sort : [];
  } catch (error) {
    console.warn('Invalid sort parameter:', sortParam);
    return [];
  }
}

function parsePagination(pageParam?: string, limitParam?: string): { page: number; limit: number } | undefined {
  if (!pageParam && !limitParam) return undefined;
  
  const page = pageParam ? parseInt(pageParam) : 1;
  const limit = limitParam ? parseInt(limitParam) : 10;
  
  if (isNaN(page) || isNaN(limit) || page < 1 || limit < 1) {
    return undefined;
  }
  
  return { page, limit };
} 