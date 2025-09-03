import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { Client } from 'pg';
import { CloudFormationCustomResourceEvent, CloudFormationCustomResourceResponse } from 'aws-lambda';

const secretsClient = new SecretsManagerClient({});

interface DatabaseCredentials {
  username: string;
  password: string;
  host: string;
  port: number;
  dbname: string;
}

async function getDatabaseCredentials(): Promise<DatabaseCredentials> {
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
  return {
    username: credentials.username,
    password: credentials.password,
    host: process.env.DB_HOST!,
    port: parseInt(process.env.DB_PORT!),
    dbname: process.env.DB_NAME!,
  };
}

export class CustomResourceHandler {
  private async getDatabaseClient(): Promise<Client> {
    const credentials = await getDatabaseCredentials();
    return new Client({
      user: credentials.username,
      password: credentials.password,
      host: credentials.host,
      port: credentials.port,
      database: credentials.dbname,
      ssl: {
        rejectUnauthorized: false,
      },
    });
  }

  async initializeDatabase(): Promise<void> {
    let client: Client | null = null;
    
    try {
      client = await this.getDatabaseClient();
      await client.connect();
      
      await client.query('BEGIN');
      
      // Enable UUID extension
      await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

      // Create legal_entities table (SCD Type 2)
      await client.query(`
        CREATE TABLE IF NOT EXISTS legal_entities (
          id BIGSERIAL PRIMARY KEY,
          adyen_legal_entity_id VARCHAR(255) UNIQUE NOT NULL,
          business_name VARCHAR(500) NOT NULL,
          legal_entity_type VARCHAR(100),
          country_code VARCHAR(2),
          status VARCHAR(50) NOT NULL,
          is_current BOOLEAN DEFAULT true,
          valid_from TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          valid_to TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // Create account_holders table (SCD Type 2)
      await client.query(`
        CREATE TABLE IF NOT EXISTS account_holders (
          id BIGSERIAL PRIMARY KEY,
          adyen_account_holder_id VARCHAR(255) UNIQUE NOT NULL,
          legal_entity_id BIGINT REFERENCES legal_entities(id),
          account_holder_type VARCHAR(100),
          status VARCHAR(50) NOT NULL,
          is_current BOOLEAN DEFAULT true,
          valid_from TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          valid_to TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // Create accounts table
      await client.query(`
        CREATE TABLE IF NOT EXISTS accounts (
          id BIGSERIAL PRIMARY KEY,
          adyen_account_id VARCHAR(255) UNIQUE NOT NULL,
          account_holder_id BIGINT REFERENCES account_holders(id),
          account_type VARCHAR(100),
          currency VARCHAR(3),
          status VARCHAR(50) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // Create optimized adyen_events table
      await client.query(`
        CREATE TABLE IF NOT EXISTS adyen_events (
          id BIGSERIAL PRIMARY KEY,
          event_id VARCHAR(255) UNIQUE NOT NULL,
          event_type VARCHAR(100) NOT NULL,
          entity_type VARCHAR(50),
          entity_id VARCHAR(255),
          
          -- Core business fields (from webhook)
          psp_reference VARCHAR(255) NOT NULL,
          merchant_account_code VARCHAR(255),
          merchant_reference VARCHAR(255),
          
          -- Event-specific fields
          success BOOLEAN,
          reason VARCHAR(500),
          
          -- Entity details (extracted from webhook)
          business_name VARCHAR(500),
          country_code VARCHAR(2),
          status VARCHAR(50),
          
          -- S3 Reference
          s3_key VARCHAR(500) NOT NULL,
          
          -- Timestamps
          processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          webhook_received_at TIMESTAMP WITH TIME ZONE NOT NULL,
          
          -- Unique constraint for deduplication
          CONSTRAINT idx_adyen_events_psp_reference UNIQUE (psp_reference)
        );
      `);

      // Create indexes for performance
      // Legal entities indexes
      await client.query('CREATE INDEX IF NOT EXISTS idx_legal_entities_adyen_id ON legal_entities(adyen_legal_entity_id);');
      await client.query('CREATE INDEX IF NOT EXISTS idx_legal_entities_status ON legal_entities(status);');
      await client.query('CREATE INDEX IF NOT EXISTS idx_legal_entities_country ON legal_entities(country_code);');
      await client.query('CREATE INDEX IF NOT EXISTS idx_legal_entities_current ON legal_entities(is_current);');

      // Account holders indexes
      await client.query('CREATE INDEX IF NOT EXISTS idx_account_holders_adyen_id ON account_holders(adyen_account_holder_id);');
      await client.query('CREATE INDEX IF NOT EXISTS idx_account_holders_legal_entity ON account_holders(legal_entity_id);');
      await client.query('CREATE INDEX IF NOT EXISTS idx_account_holders_status ON account_holders(status);');
      await client.query('CREATE INDEX IF NOT EXISTS idx_account_holders_current ON account_holders(is_current);');

      // Accounts indexes
      await client.query('CREATE INDEX IF NOT EXISTS idx_accounts_adyen_id ON accounts(adyen_account_id);');
      await client.query('CREATE INDEX IF NOT EXISTS idx_accounts_holder_id ON accounts(account_holder_id);');
      await client.query('CREATE INDEX IF NOT EXISTS idx_accounts_currency ON accounts(currency);');

      // Events indexes
      await client.query('CREATE INDEX IF NOT EXISTS idx_adyen_events_event_id ON adyen_events(event_id);');
      await client.query('CREATE INDEX IF NOT EXISTS idx_adyen_events_type ON adyen_events(event_type);');
      await client.query('CREATE INDEX IF NOT EXISTS idx_adyen_events_entity ON adyen_events(entity_type, entity_id);');
      await client.query('CREATE INDEX IF NOT EXISTS idx_adyen_events_processed ON adyen_events(processed_at);');
      await client.query('CREATE INDEX IF NOT EXISTS idx_adyen_events_ui_display ON adyen_events(event_type, entity_type, merchant_account_code, processed_at DESC, success);');
      await client.query('CREATE INDEX IF NOT EXISTS idx_adyen_events_s3_key ON adyen_events(s3_key);');

      // Create updated_at triggers
      await client.query(`
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
        $$ language 'plpgsql';
      `);

      // Add triggers to relevant tables
      await client.query(`
        DROP TRIGGER IF EXISTS update_legal_entities_updated_at ON legal_entities;
        CREATE TRIGGER update_legal_entities_updated_at
          BEFORE UPDATE ON legal_entities
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column();
      `);

      await client.query(`
        DROP TRIGGER IF EXISTS update_account_holders_updated_at ON account_holders;
        CREATE TRIGGER update_account_holders_updated_at
          BEFORE UPDATE ON account_holders
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column();
      `);

      await client.query(`
        DROP TRIGGER IF EXISTS update_accounts_updated_at ON accounts;
        CREATE TRIGGER update_accounts_updated_at
          BEFORE UPDATE ON accounts
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column();
      `);

      await client.query('COMMIT');
      console.log('Database initialization completed successfully');
    } catch (error) {
      await client?.query('ROLLBACK');
      console.error('Database initialization failed:', error);
      throw error;
    } finally {
      await client?.end();
    }
  }
}

export const handler = async (event: CloudFormationCustomResourceEvent): Promise<CloudFormationCustomResourceResponse> => {
  let response: CloudFormationCustomResourceResponse;

  try {
    switch (event.RequestType) {
      case 'Create':
      case 'Update':
        const handler = new CustomResourceHandler();
        await handler.initializeDatabase();
        response = {
          Status: 'SUCCESS',
          PhysicalResourceId: 'DatabaseInit',
          StackId: event.StackId,
          RequestId: event.RequestId,
          LogicalResourceId: event.LogicalResourceId,
          Data: {
            Message: 'Database initialization completed',
            Timestamp: new Date().toISOString(),
          },
        };
        break;
      
      case 'Delete':
        response = {
          Status: 'SUCCESS',
          PhysicalResourceId: 'DatabaseInit',
          StackId: event.StackId,
          RequestId: event.RequestId,
          LogicalResourceId: event.LogicalResourceId,
          Data: {
            Message: 'Database cleanup completed',
            Timestamp: new Date().toISOString(),
          },
        };
        break;
      
      default:
        const requestType = (event as any).RequestType;
        throw new Error(`Unsupported request type: ${requestType}`);
    }
  } catch (error) {
    console.error('Custom Resource handler failed:', error);
    response = {
      Status: 'FAILED',
      PhysicalResourceId: 'DatabaseInit',
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      Reason: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  return response;
}; 