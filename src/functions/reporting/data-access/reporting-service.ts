import { DatabaseHelper } from '../../shared/database-helpers';

export interface ReportingFilter {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in';
  value: string | number | string[] | number[];
}

export interface ReportingSort {
  field: string;
  direction: 'asc' | 'desc';
}

export interface ReportingPagination {
  page: number;
  limit: number;
}

export interface ReportingQuery {
  table: 'legal_entities' | 'account_holders' | 'accounts' | 'adyen_events';
  filters?: ReportingFilter[];
  sort?: ReportingSort[];
  pagination?: ReportingPagination;
  fields?: string[];
}

export interface ReportingResult<T = any> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface TableSchema {
  tableName: string;
  columns: ColumnInfo[];
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  referencedTable?: string;
  defaultValue?: string;
  maxLength?: number;
  precision?: number;
  scale?: number;
}

export class ReportingService {
  /**
   * Get schema information for a table
   */
  static async getTableSchema(tableName: string): Promise<TableSchema> {
    const dbHelper = new DatabaseHelper();
    const client = await dbHelper.getClient();
    
    try {
      // Use a simpler query that just gets basic column information
      const columnsQuery = `
        SELECT 
          column_name as name,
          data_type as type,
          is_nullable as nullable,
          false as is_primary_key,
          false as is_foreign_key
        FROM information_schema.columns 
        WHERE table_name = $1
        ORDER BY ordinal_position
      `;
      
      const result = await client.query(columnsQuery, [tableName]);
      
      const columns: ColumnInfo[] = result.rows.map((row: any) => ({
        name: row.name,
        type: row.type,
        nullable: row.nullable === 'YES',
        isPrimaryKey: row.is_primary_key || false,
        isForeignKey: row.is_foreign_key || false,
        referencedTable: undefined
      }));

      return {
        tableName,
        columns
      };
    } catch (error) {
      console.error(`Error getting schema for table ${tableName}:`, error);
      // Return empty schema on error
      return {
        tableName,
        columns: []
      };
    } finally {
      await dbHelper.closeClient();
    }
  }

  /**
   * Get list of available tables for reporting
   */
  static async getAvailableTables(): Promise<string[]> {
    return [
      'legal_entities',
      'account_holders',
      'accounts',
      'adyen_events'
    ];
  }

  /**
   * Execute dynamic query with filtering, sorting, and pagination
   */
  static async executeQuery<T = any>(query: ReportingQuery): Promise<ReportingResult<T>> {
    const dbHelper = new DatabaseHelper();
    const client = await dbHelper.getClient();
    
    try {
      const { table, filters = [], sort = [], pagination, fields = ['*'] } = query;
      
      // Build WHERE clause
      const whereConditions: string[] = [];
      const queryParams: any[] = [];
      let paramIndex = 1;

      filters.forEach(filter => {
        const { field, operator, value } = filter;
        
        switch (operator) {
          case 'eq':
            whereConditions.push(`${field} = $${paramIndex}`);
            queryParams.push(value);
            break;
          case 'ne':
            whereConditions.push(`${field} != $${paramIndex}`);
            queryParams.push(value);
            break;
          case 'gt':
            whereConditions.push(`${field} > $${paramIndex}`);
            queryParams.push(value);
            break;
          case 'gte':
            whereConditions.push(`${field} >= $${paramIndex}`);
            queryParams.push(value);
            break;
          case 'lt':
            whereConditions.push(`${field} < $${paramIndex}`);
            queryParams.push(value);
            break;
          case 'lte':
            whereConditions.push(`${field} <= $${paramIndex}`);
            queryParams.push(value);
            break;
          case 'like':
            whereConditions.push(`${field} ILIKE $${paramIndex}`);
            queryParams.push(`%${value}%`);
            break;
          case 'in':
            if (Array.isArray(value) && value.length > 0) {
              const placeholders = value.map((_, i) => `$${paramIndex + i}`).join(',');
              whereConditions.push(`${field} IN (${placeholders})`);
              queryParams.push(...value);
              paramIndex += value.length - 1;
            }
            break;
        }
        paramIndex++;
      });

      // Build ORDER BY clause
      const orderByClause = sort.length > 0 
        ? `ORDER BY ${sort.map(s => `${s.field} ${s.direction.toUpperCase()}`).join(', ')}`
        : '';

      // Build LIMIT and OFFSET for pagination
      let limitOffsetClause = '';
      if (pagination) {
        const { page, limit } = pagination;
        const offset = (page - 1) * limit;
        limitOffsetClause = `LIMIT ${limit} OFFSET ${offset}`;
      }

      // Build the complete query
      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
      const selectFields = fields.join(', ');
      
      const dataQuery = `
        SELECT ${selectFields}
        FROM ${table}
        ${whereClause}
        ${orderByClause}
        ${limitOffsetClause}
      `;

      // Get total count for pagination
      const countQuery = `
        SELECT COUNT(*) as total
        FROM ${table}
        ${whereClause}
      `;

      const [dataResult, countResult] = await Promise.all([
        client.query(dataQuery, queryParams),
        client.query(countQuery, queryParams)
      ]);

      const total = parseInt(countResult.rows[0].total);
      const { page = 1, limit = 10 } = pagination || {};
      const totalPages = Math.ceil(total / limit);

      return {
        data: dataResult.rows,
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrevious: page > 1
      };
    } finally {
      await dbHelper.closeClient();
    }
  }

  /**
   * Get reporting statistics
   */
  static async getReportingStats(): Promise<{
    totalLegalEntities: number;
    totalAccountHolders: number;
    totalAccounts: number;
    totalEvents: number;
    activeLegalEntities: number;
    pendingLegalEntities: number;
    recentActivity: any[];
  }> {
    const dbHelper = new DatabaseHelper();
    const client = await dbHelper.getClient();
    
    try {
      // Get counts from new schema
      const legalEntitiesCount = await client.query('SELECT COUNT(*) as total FROM legal_entities WHERE is_current = true');
      const accountHoldersCount = await client.query('SELECT COUNT(*) as total FROM account_holders WHERE is_current = true');
      const accountsCount = await client.query('SELECT COUNT(*) as total FROM accounts');
      const eventsCount = await client.query('SELECT COUNT(*) as total FROM adyen_events');
      
      // Get status distribution for legal entities
      const activeLegalEntities = await client.query("SELECT COUNT(*) as total FROM legal_entities WHERE status = 'active' AND is_current = true");
      const pendingLegalEntities = await client.query("SELECT COUNT(*) as total FROM legal_entities WHERE status = 'pending' AND is_current = true");
      
      // Get recent activity (last 10 events)
      const recentActivity = await client.query(`
        SELECT 
          e.event_type,
          e.entity_type,
          e.webhook_received_at,
          e.event_data
        FROM adyen_events e
        ORDER BY e.webhook_received_at DESC
        LIMIT 10
      `);

      return {
        totalLegalEntities: parseInt(legalEntitiesCount.rows[0].total),
        totalAccountHolders: parseInt(accountHoldersCount.rows[0].total),
        totalAccounts: parseInt(accountsCount.rows[0].total),
        totalEvents: parseInt(eventsCount.rows[0].total),
        activeLegalEntities: parseInt(activeLegalEntities.rows[0].total),
        pendingLegalEntities: parseInt(pendingLegalEntities.rows[0].total),
        recentActivity: recentActivity.rows
      };
    } catch (error) {
      console.error('Error getting reporting stats:', error);
      return {
        totalLegalEntities: 0,
        totalAccountHolders: 0,
        totalAccounts: 0,
        totalEvents: 0,
        activeLegalEntities: 0,
        pendingLegalEntities: 0,
        recentActivity: []
      };
    } finally {
      await dbHelper.closeClient();
    }
  }

  /**
   * Get analytics data for charts and dashboards
   */
  static async getAnalyticsData(): Promise<{
    legalEntityStatusDistribution: { status: string; count: number }[];
    accountHolderStatusDistribution: { status: string; count: number }[];
    dailyEvents: { date: string; count: number }[];
    eventTypeDistribution: { eventType: string; count: number }[];
  }> {
    const dbHelper = new DatabaseHelper();
    const client = await dbHelper.getClient();
    
    try {
      // Get legal entity status distribution
      const legalEntityStatusDistribution = await client.query(`
        SELECT 
          status,
          COUNT(*) as count
        FROM legal_entities 
        WHERE is_current = true
        GROUP BY status 
        ORDER BY count DESC
      `);

      // Get account holder status distribution
      const accountHolderStatusDistribution = await client.query(`
        SELECT 
          status,
          COUNT(*) as count
        FROM account_holders 
        WHERE is_current = true
        GROUP BY status 
        ORDER BY count DESC
      `);

      // Get daily events for the last 30 days
      const dailyEvents = await client.query(`
        SELECT 
          DATE(e.webhook_received_at) as date,
          COUNT(*) as count
        FROM adyen_events e
        WHERE e.webhook_received_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(e.webhook_received_at)
        ORDER BY date DESC
      `);

      // Get event type distribution
      const eventTypeDistribution = await client.query(`
        SELECT 
          event_type,
          COUNT(*) as count
        FROM adyen_events
        GROUP BY event_type 
        ORDER BY count DESC
      `);

      return {
        legalEntityStatusDistribution: legalEntityStatusDistribution.rows.map((row: any) => ({
          status: row.status,
          count: parseInt(row.count)
        })),
        accountHolderStatusDistribution: accountHolderStatusDistribution.rows.map((row: any) => ({
          status: row.status,
          count: parseInt(row.count)
        })),
        dailyEvents: dailyEvents.rows.map((row: any) => ({
          date: row.date,
          count: parseInt(row.count)
        })),
        eventTypeDistribution: eventTypeDistribution.rows.map((row: any) => ({
          eventType: row.event_type,
          count: parseInt(row.count)
        }))
      };
    } catch (error) {
      console.error('Error getting analytics data:', error);
      return {
        legalEntityStatusDistribution: [],
        accountHolderStatusDistribution: [],
        dailyEvents: [],
        eventTypeDistribution: []
      };
    } finally {
      await dbHelper.closeClient();
    }
  }

  /**
   * Get comprehensive database schema information
   */
  static async getDatabaseSchema(): Promise<{
    database: string;
    tables: Array<{
      tableName: string;
      columns: ColumnInfo[];
      rowCount?: number;
      size?: string;
    }>;
    totalTables: number;
    totalColumns: number;
  }> {
    const dbHelper = new DatabaseHelper();
    const client = await dbHelper.getClient();
    
    try {
      // Get all tables in the database - look for our enhanced schema tables
      const tablesQuery = `
        SELECT 
          table_name,
          (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
        FROM information_schema.tables t
        WHERE table_schema = 'public'
        AND table_name IN ('legal_entities', 'account_holders', 'accounts', 'adyen_events')
        ORDER BY table_name
      `;
      
      const tablesResult = await client.query(tablesQuery);
      const tables = [];
      
      for (const tableRow of tablesResult.rows) {
        const tableName = tableRow.table_name;
        
        // Get detailed column information for each table with primary key detection
        const columnsQuery = `
          SELECT 
            c.column_name as name,
            c.data_type as type,
            c.is_nullable as nullable,
            c.column_default as default_value,
            c.character_maximum_length as max_length,
            c.numeric_precision as precision,
            c.numeric_scale as scale,
            CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key,
            CASE WHEN fk.column_name IS NOT NULL THEN true ELSE false END as is_foreign_key,
            fk.referenced_table_name
          FROM information_schema.columns c
          LEFT JOIN (
            SELECT kcu.column_name, kcu.table_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
            WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1
          ) pk ON c.column_name = pk.column_name
          LEFT JOIN (
            SELECT kcu.column_name, kcu.table_name, ccu.table_name as referenced_table_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1
          ) fk ON c.column_name = fk.column_name
          WHERE c.table_name = $1
          ORDER BY c.ordinal_position
        `;
        
        const columnsResult = await client.query(columnsQuery, [tableName]);
        
        // Get row count for the table
        const countQuery = `SELECT COUNT(*) as row_count FROM "${tableName}"`;
        let rowCount = 0;
        try {
          const countResult = await client.query(countQuery);
          rowCount = parseInt(countResult.rows[0].row_count);
        } catch (error) {
          console.warn(`Could not get row count for table ${tableName}:`, error);
        }
        
        // Get table size
        const sizeQuery = `
          SELECT pg_size_pretty(pg_total_relation_size($1)) as table_size
        `;
        let size = 'Unknown';
        try {
          const sizeResult = await client.query(sizeQuery, [tableName]);
          size = sizeResult.rows[0].table_size;
        } catch (error) {
          console.warn(`Could not get size for table ${tableName}:`, error);
        }
        
        const columns: ColumnInfo[] = columnsResult.rows.map((row: any) => ({
          name: row.name,
          type: row.type,
          nullable: row.nullable === 'YES',
          isPrimaryKey: row.is_primary_key || false,
          isForeignKey: row.is_foreign_key || false,
          referencedTable: row.referenced_table_name,
          defaultValue: row.default_value,
          maxLength: row.max_length,
          precision: row.precision,
          scale: row.scale
        }));
        
        tables.push({
          tableName,
          columns,
          rowCount,
          size
        });
      }
      
      const totalColumns = tables.reduce((sum, table) => sum + table.columns.length, 0);
      
      return {
        database: 'onboarding_reporting',
        tables,
        totalTables: tables.length,
        totalColumns
      };
    } catch (error) {
      console.error('Error getting database schema:', error);
      return {
        database: 'onboarding_reporting',
        tables: [],
        totalTables: 0,
        totalColumns: 0
      };
    } finally {
      await dbHelper.closeClient();
    }
  }
} 