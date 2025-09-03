import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { Client } from 'pg';

const secretsClient = new SecretsManagerClient({});

async function getDatabaseClient(): Promise<Client> {
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
  
  const client = new Client({
    user: credentials.username,
    password: credentials.password,
    host: process.env.DB_HOST!,
    port: parseInt(process.env.DB_PORT!),
    database: process.env.DB_NAME!,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  await client.connect();
  return client;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // Parse query parameters
    const { action } = event.queryStringParameters || {};
    
    switch (action) {
      case 'add':
        return await addTestData();
      case 'query':
        return await queryData();
      case 'clear':
        return await clearData();
      default:
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
            message: 'Action parameter is required. Use: add, query, or clear'
          })
        };
    }
  } catch (error) {
    console.error('Error in test data handler:', error);
    
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
        message: 'Failed to process test data request'
      })
    };
  }
};

async function addTestData(): Promise<APIGatewayProxyResult> {
  const client = await getDatabaseClient();
  
  try {
    // Insert test legal entity
    const legalEntityResult = await client.query(`
      INSERT INTO legal_entities (
        adyen_legal_entity_id, business_name, legal_entity_type, country_code, status
      ) VALUES ($1, $2, $3, $4, $5) RETURNING id
    `, ['LE123456789', 'Test Business Inc.', 'corporation', 'US', 'active']);
    
    const legalEntityId = legalEntityResult.rows[0].id;
    
    // Insert test account holder
    const accountHolderResult = await client.query(`
      INSERT INTO account_holders (
        adyen_account_holder_id, legal_entity_id, account_holder_type, status
      ) VALUES ($1, $2, $3, $4) RETURNING id
    `, ['AH123456789', legalEntityId, 'business', 'active']);
    
    const accountHolderId = accountHolderResult.rows[0].id;
    
    // Insert test account
    await client.query(`
      INSERT INTO accounts (
        adyen_account_id, account_holder_id, account_type, currency, status
      ) VALUES ($1, $2, $3, $4, $5)
    `, ['AC123456789', accountHolderId, 'standard', 'USD', 'active']);
    
    // Insert test adyen event
    await client.query(`
      INSERT INTO adyen_events (
        event_id, event_type, entity_type, entity_id, s3_key,
        psp_reference, merchant_account_code, merchant_reference,
        success, business_name, country_code, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
      'test-event-1',
      'ACCOUNT_HOLDER_CREATED',
      'account_holder',
      'AH123456789',
      'adyen-webhooks/2025/08/test-event-1.json',
      'PSP123456789',
      'TestMerchant',
      'TEST_REF_001',
      true,
      'Test Business Inc.',
      'US',
      'active'
    ]);
    
    console.log('Test data added successfully');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Test data added successfully',
        summary: {
          legalEntities: 1,
          accountHolders: 1,
          accounts: 1,
          events: 1
        }
      })
    };
  } catch (error) {
    console.error('Error adding test data:', error);
    throw error;
  } finally {
    await client.end();
  }
}

async function queryData(): Promise<APIGatewayProxyResult> {
  const client = await getDatabaseClient();
  
  try {
    // Get legal entities
    const legalEntities = await client.query(`
      SELECT 
        id, adyen_legal_entity_id, business_name, legal_entity_type, country_code, status, created_at
      FROM legal_entities 
      WHERE is_current = true 
      ORDER BY created_at DESC
    `);

    // Get account holders
    const accountHolders = await client.query(`
      SELECT 
        ah.id, ah.adyen_account_holder_id, ah.account_holder_type, ah.status, ah.created_at,
        le.business_name as legal_entity_name
      FROM account_holders ah
      LEFT JOIN legal_entities le ON ah.legal_entity_id = le.id
      WHERE ah.is_current = true
      ORDER BY ah.created_at DESC
    `);

    // Get accounts
    const accounts = await client.query(`
      SELECT 
        a.id, a.adyen_account_id, a.account_type, a.currency, a.status, a.created_at,
        ah.adyen_account_holder_id as account_holder_id
      FROM accounts a
      LEFT JOIN account_holders ah ON a.account_holder_id = ah.id
      ORDER BY a.created_at DESC
    `);

    // Get events
    const events = await client.query(`
      SELECT 
        id, event_id, event_type, entity_type, entity_id, webhook_received_at
      FROM adyen_events
      ORDER BY webhook_received_at DESC
    `);

    // Get summary statistics
    const legalEntityStats = await client.query('SELECT COUNT(*) as total FROM legal_entities WHERE is_current = true');
    const accountHolderStats = await client.query('SELECT COUNT(*) as total FROM account_holders WHERE is_current = true');
    const accountStats = await client.query('SELECT COUNT(*) as total FROM accounts');
    const eventStats = await client.query('SELECT COUNT(*) as total FROM adyen_events');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Test data queried successfully',
        data: {
          legalEntities: legalEntities.rows,
          accountHolders: accountHolders.rows,
          accounts: accounts.rows,
          events: events.rows
        },
        statistics: {
          totalLegalEntities: parseInt(legalEntityStats.rows[0].total),
          totalAccountHolders: parseInt(accountHolderStats.rows[0].total),
          totalAccounts: parseInt(accountStats.rows[0].total),
          totalEvents: parseInt(eventStats.rows[0].total)
        }
      })
    };
  } catch (error) {
    console.error('Error querying test data:', error);
    throw error;
  } finally {
    await client.end();
  }
}

async function clearData(): Promise<APIGatewayProxyResult> {
  const client = await getDatabaseClient();
  
  try {
    // Clear data in reverse order of dependencies
    await client.query('DELETE FROM adyen_events');
    await client.query('DELETE FROM accounts');
    await client.query('DELETE FROM account_holders');
    await client.query('DELETE FROM legal_entities');
    
    console.log('Test data cleared successfully');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Test data cleared successfully',
        cleared: [
          'adyen_events',
          'accounts',
          'account_holders',
          'legal_entities'
        ]
      })
    };
  } catch (error) {
    console.error('Error clearing test data:', error);
    throw error;
  } finally {
    await client.end();
  }
} 