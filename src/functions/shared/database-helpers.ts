import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { Client } from 'pg';
import { captureAWSv3Client } from 'aws-xray-sdk-core';

const secretsClient = captureAWSv3Client(new SecretsManagerClient({}));

export interface DatabaseCredentials {
  username: string;
  password: string;
  host: string;
  port: number;
  dbname: string;
}

export interface LegalEntity {
  id: number;
  adyen_legal_entity_id: string;
  business_name: string;
  legal_entity_type?: string;
  country_code?: string;
  status: string;
  is_current: boolean;
  valid_from: Date;
  valid_to?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface AccountHolder {
  id: number;
  adyen_account_holder_id: string;
  legal_entity_id: number;
  account_holder_type?: string;
  status: string;
  is_current: boolean;
  valid_from: Date;
  valid_to?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface Account {
  id: number;
  adyen_account_id: string;
  account_holder_id: number;
  account_type?: string;
  currency?: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface AdyenEvent {
  id: number;
  event_id: string;
  event_type: string;
  entity_type?: string;
  entity_id?: string;
  
  // Core business fields
  psp_reference: string;
  merchant_account_code?: string;
  merchant_reference?: string;
  
  // Event-specific fields
  success?: boolean;
  reason?: string;
  
  // Entity details
  business_name?: string;
  country_code?: string;
  status?: string;
  
  // S3 Reference
  s3_key: string;
  
  // Timestamps
  processed_at: Date;
  webhook_received_at: Date;
}

export class DatabaseHelper {
  private client: Client | null = null;
  private credentials: DatabaseCredentials | null = null;

  async getDatabaseCredentials(): Promise<DatabaseCredentials> {
    if (this.credentials) {
      return this.credentials;
    }

    const secretArn = process.env.DB_SECRET_ARN;
    if (!secretArn) {
      throw new Error('DB_SECRET_ARN environment variable is not set');
    }

    const command = new GetSecretValueCommand({ SecretId: secretArn });
    const response = await secretsClient.send(command);
    
    if (!response.SecretString) {
      throw new Error('Database credentials not found in Secrets Manager');
    }

    const credentials = JSON.parse(response.SecretString);
    this.credentials = {
      username: credentials.username,
      password: credentials.password,
      host: process.env.DB_HOST!,
      port: parseInt(process.env.DB_PORT!),
      dbname: process.env.DB_NAME!,
    };

    return this.credentials;
  }

  async getClient(): Promise<Client> {
    if (this.client && !this.client.end) {
      return this.client;
    }

    const credentials = await this.getDatabaseCredentials();
    
    this.client = new Client({
      user: credentials.username,
      password: credentials.password,
      host: credentials.host,
      port: credentials.port,
      database: credentials.dbname,
      ssl: {
        rejectUnauthorized: false,
      },
    });

    await this.client.connect();
    return this.client;
  }

  async closeClient(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = null;
    }
  }

  // Legal Entity Operations
  async createLegalEntity(
    adyenLegalEntityId: string,
    businessName: string,
    legalEntityType?: string,
    countryCode?: string,
    status: string = 'pending'
  ): Promise<LegalEntity> {
    const client = await this.getClient();
    
    const result = await client.query(
      `INSERT INTO legal_entities 
       (adyen_legal_entity_id, business_name, legal_entity_type, country_code, status) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING *`,
      [adyenLegalEntityId, businessName, legalEntityType, countryCode, status]
    );

    return result.rows[0] as LegalEntity;
  }

  async findLegalEntityByAdyenId(adyenLegalEntityId: string): Promise<LegalEntity | null> {
    const client = await this.getClient();
    
    const result = await client.query(
      'SELECT * FROM legal_entities WHERE adyen_legal_entity_id = $1 AND is_current = true',
      [adyenLegalEntityId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0] as LegalEntity;
  }

  async updateLegalEntityStatus(legalEntityId: number, status: string): Promise<void> {
    const client = await this.getClient();
    
    await client.query(
      'UPDATE legal_entities SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, legalEntityId]
    );
  }

  // Account Holder Operations
  async createAccountHolder(
    adyenAccountHolderId: string,
    legalEntityId: number,
    accountHolderType?: string,
    status: string = 'pending'
  ): Promise<AccountHolder> {
    const client = await this.getClient();
    
    const result = await client.query(
      `INSERT INTO account_holders 
       (adyen_account_holder_id, legal_entity_id, account_holder_type, status) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [adyenAccountHolderId, legalEntityId, accountHolderType, status]
    );

    return result.rows[0] as AccountHolder;
  }

  async findAccountHolderByAdyenId(adyenAccountHolderId: string): Promise<AccountHolder | null> {
    const client = await this.getClient();
    
    const result = await client.query(
      'SELECT * FROM account_holders WHERE adyen_account_holder_id = $1 AND is_current = true',
      [adyenAccountHolderId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0] as AccountHolder;
  }

  // Account Operations
  async createAccount(
    adyenAccountId: string,
    accountHolderId: number,
    accountType?: string,
    currency?: string,
    status: string = 'pending'
  ): Promise<Account> {
    const client = await this.getClient();
    
    const result = await client.query(
      `INSERT INTO accounts 
       (adyen_account_id, account_holder_id, account_type, currency, status) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING *`,
      [adyenAccountId, accountHolderId, accountType, currency, status]
    );

    return result.rows[0] as Account;
  }

  async findAccountByAdyenId(adyenAccountId: string): Promise<Account | null> {
    const client = await this.getClient();
    
    const result = await client.query(
      'SELECT * FROM accounts WHERE adyen_account_id = $1',
      [adyenAccountId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0] as Account;
  }

  // Adyen Events - Main fact table
  async insertAdyenEvent(
    eventId: string,
    eventType: string,
    entityType: string,
    entityId: string,
    s3Key: string,
    pspReference: string,
    merchantAccountCode?: string,
    merchantReference?: string,
    success?: boolean,
    reason?: string,
    businessName?: string,
    countryCode?: string,
    status?: string
  ): Promise<AdyenEvent> {
    const client = await this.getClient();
    
    const query = `
      INSERT INTO adyen_events (
        event_id, event_type, entity_type, entity_id, s3_key,
        psp_reference, merchant_account_code, merchant_reference,
        success, reason, business_name, country_code, status,
        processed_at, webhook_received_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
      RETURNING *
    `;
    
    const values = [
      eventId, eventType, entityType, entityId, s3Key,
      pspReference, merchantAccountCode, merchantReference,
      success, reason, businessName, countryCode, status
    ];
    
    const result = await client.query(query, values);
    return result.rows[0];
  }

  // Check for duplicate events using unique constraint on psp_reference
  async checkDuplicateEvent(pspReference: string): Promise<boolean> {
    const client = await this.getClient();
    
    const query = 'SELECT COUNT(*) as count FROM adyen_events WHERE psp_reference = $1';
    const result = await client.query(query, [pspReference]);
    return parseInt(result.rows[0].count) > 0;
  }

  // Get events for UI display
  async getEventsForUI(limit: number = 50, offset: number = 0): Promise<AdyenEvent[]> {
    const client = await this.getClient();
    
    const query = `
      SELECT id, event_id, event_type, entity_type, entity_id,
             psp_reference, merchant_account_code, merchant_reference,
             success, reason, business_name, country_code, status,
             s3_key, processed_at, webhook_received_at
      FROM adyen_events 
      ORDER BY processed_at DESC 
      LIMIT $1 OFFSET $2
    `;
    
    const result = await client.query(query, [limit, offset]);
    return result.rows;
  }

  // Get events by type
  async getEventsByType(eventType: string, limit: number = 50): Promise<AdyenEvent[]> {
    const client = await this.getClient();
    
    const query = `
      SELECT * FROM adyen_events 
      WHERE event_type = $1 
      ORDER BY processed_at DESC 
      LIMIT $2
    `;
    
    const result = await client.query(query, [eventType, limit]);
    return result.rows;
  }

  // Get events by entity
  async getEventsByEntity(entityType: string, entityId: string, limit: number = 50): Promise<AdyenEvent[]> {
    const client = await this.getClient();
    
    const query = `
      SELECT * FROM adyen_events 
      WHERE entity_type = $1 AND entity_id = $2 
      ORDER BY processed_at DESC 
      LIMIT $3
    `;
    
    const result = await client.query(query, [entityType, entityId, limit]);
    return result.rows;
  }

  // Get event statistics
  async getEventStats(): Promise<{ total: number; byType: Record<string, number>; byStatus: Record<string, number> }> {
    const client = await this.getClient();
    
    const totalQuery = 'SELECT COUNT(*) as count FROM adyen_events';
    const typeQuery = 'SELECT event_type, COUNT(*) as count FROM adyen_events GROUP BY event_type';
    const statusQuery = 'SELECT status, COUNT(*) as count FROM adyen_events WHERE status IS NOT NULL GROUP BY status';
    
    const [totalResult, typeResult, statusResult] = await Promise.all([
      client.query(totalQuery),
      client.query(typeQuery),
      client.query(statusQuery)
    ]);
    
    const byType: Record<string, number> = {};
    typeResult.rows.forEach(row => {
      byType[row.event_type] = parseInt(row.count);
    });
    
    const byStatus: Record<string, number> = {};
    statusResult.rows.forEach(row => {
      byStatus[row.status] = parseInt(row.count);
    });
    
    return {
      total: parseInt(totalResult.rows[0].count),
      byType,
      byStatus
    };
  }
} 