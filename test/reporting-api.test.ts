import { handler } from '../src/functions/reporting/index';
import { APIGatewayProxyEvent } from 'aws-lambda';

// Mock AWS XRay
jest.mock('aws-xray-sdk-core', () => ({
  captureAWSv3Client: jest.fn((client) => client),
  captureAsyncFunc: jest.fn((name, fn) => fn()),
}));

// Mock auth helpers
jest.mock('../src/functions/shared/dynamodb-helpers', () => ({
  getUserId: jest.fn().mockReturnValue('test-user-id'),
  getUserEmail: jest.fn().mockReturnValue('test@example.com'),
}));

// Mock secrets manager for database helpers
jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(),
  GetSecretValueCommand: jest.fn(),
}));

// Mock the reporting service
jest.mock('../src/functions/reporting/data-access/reporting-service', () => ({
  ReportingService: {
    getAvailableTables: jest.fn().mockResolvedValue(['onboarding_sessions', 'onboarding_events']),
    getDatabaseSchema: jest.fn().mockResolvedValue({
      tables: ['onboarding_sessions', 'onboarding_events'],
      schemas: {
        onboarding_sessions: {
          tableName: 'onboarding_sessions',
          columns: [
            { name: 'id', type: 'uuid', nullable: false, isPrimaryKey: true, isForeignKey: false },
            { name: 'user_email', type: 'character varying', nullable: false, isPrimaryKey: false, isForeignKey: false }
          ]
        }
      }
    }),
    getTableSchema: jest.fn().mockResolvedValue({
      tableName: 'onboarding_sessions',
      columns: [
        {
          name: 'id',
          type: 'uuid',
          nullable: false,
          isPrimaryKey: true,
          isForeignKey: false
        },
        {
          name: 'user_email',
          type: 'character varying',
          nullable: false,
          isPrimaryKey: false,
          isForeignKey: false
        }
      ]
    }),
    executeQuery: jest.fn().mockResolvedValue({
      data: [
        {
          id: 'test-uuid',
          user_email: 'test@example.com',
          status: 'ONBOARDED',
          created_at: '2024-01-15T10:30:00Z'
        }
      ],
      total: 1,
      page: 1,
      limit: 10,
      totalPages: 1,
      hasNext: false,
      hasPrevious: false
    }),
    getReportingStats: jest.fn().mockResolvedValue({
      totalSessions: 150,
      totalEvents: 450,
      onboardedCount: 75,
      inProgressCount: 50,
      failedCount: 25,
      recentActivity: []
    }),
    getAnalyticsData: jest.fn().mockResolvedValue({
      statusDistribution: [
        { status: 'ONBOARDED', count: 75 },
        { status: 'SUBMITTED', count: 30 }
      ],
      dailyRegistrations: [
        { date: '2024-01-15', count: 5 }
      ],
      webhookActivity: [
        { webhook: 'account.updated', count: 150 }
      ]
    })
  }
}));

describe('Reporting API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Schema endpoints', () => {
    it('should return available tables', async () => {
      const event: APIGatewayProxyEvent = {
        path: '/reporting/schema',
        httpMethod: 'GET',
        headers: {
          Authorization: 'Bearer test-token'
        }
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.tables).toEqual(['onboarding_sessions', 'onboarding_events']);
    });

    it('should return table schema', async () => {
      const event: APIGatewayProxyEvent = {
        path: '/reporting/schema/onboarding_sessions',
        httpMethod: 'GET',
        pathParameters: {
          tableName: 'onboarding_sessions'
        },
        headers: {
          Authorization: 'Bearer test-token'
        }
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.schema.tableName).toBe('onboarding_sessions');
      expect(body.schema.columns).toHaveLength(2);
    });
  });

  describe('Data endpoints', () => {
    it('should return data with query parameters', async () => {
      const event: APIGatewayProxyEvent = {
        path: '/reporting/data',
        httpMethod: 'GET',
        queryStringParameters: {
          table: 'onboarding_sessions',
          filters: JSON.stringify([{ field: 'status', operator: 'eq', value: 'ONBOARDED' }]),
          sort: JSON.stringify([{ field: 'created_at', direction: 'desc' }]),
          page: '1',
          limit: '10',
          fields: 'id,user_email,status'
        },
        headers: {
          Authorization: 'Bearer test-token'
        }
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.data).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(body.query.table).toBe('onboarding_sessions');
    });

    it('should return 400 for missing table parameter', async () => {
      const event: APIGatewayProxyEvent = {
        path: '/reporting/data',
        httpMethod: 'GET',
        queryStringParameters: {},
        headers: {
          Authorization: 'Bearer test-token'
        }
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Bad Request');
    });
  });

  describe('Stats endpoints', () => {
    it('should return basic statistics', async () => {
      const event: APIGatewayProxyEvent = {
        path: '/reporting/stats',
        httpMethod: 'GET',
        headers: {
          Authorization: 'Bearer test-token'
        }
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.type).toBe('stats');
      expect(body.data.totalSessions).toBe(150);
      expect(body.data.onboardedCount).toBe(75);
    });

    it('should return analytics data', async () => {
      const event: APIGatewayProxyEvent = {
        path: '/reporting/stats/analytics',
        httpMethod: 'GET',
        pathParameters: {
          type: 'analytics'
        },
        headers: {
          Authorization: 'Bearer test-token'
        }
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.type).toBe('analytics');
      expect(body.data.statusDistribution).toHaveLength(2);
      expect(body.data.dailyRegistrations).toHaveLength(1);
      expect(body.data.webhookActivity).toHaveLength(1);
    });
  });

  describe('Error handling', () => {
    it('should return 404 for unknown endpoint', async () => {
      const event: APIGatewayProxyEvent = {
        path: '/reporting/unknown',
        httpMethod: 'GET',
        headers: {
          Authorization: 'Bearer test-token'
        }
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Not Found');
      expect(body.availableEndpoints).toBeDefined();
    });
  });
}); 