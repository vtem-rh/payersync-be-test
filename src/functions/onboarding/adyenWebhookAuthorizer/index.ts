import { APIGatewayTokenAuthorizerEvent, APIGatewayAuthorizerResult } from 'aws-lambda';
import { captureAWSv3Client } from 'aws-xray-sdk-core';
import * as AWSXRay from 'aws-xray-sdk-core';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

// Configure X-Ray group for webhook traces
const xrayGroupName = process.env.AWS_XRAY_GROUP_NAME || 'webhooks';

const secretsManager = captureAWSv3Client(new SecretsManagerClient({}));

interface BasicAuthCredentials {
  username: string;
  password: string;
}

async function getBasicAuthCredentials(): Promise<BasicAuthCredentials> {
  const secretName = process.env.ADYEN_WEBHOOK_BASIC_AUTH_SECRET_NAME;
  
  if (!secretName) {
    throw new Error('ADYEN_WEBHOOK_BASIC_AUTH_SECRET_NAME environment variable is not set');
  }

  const command = new GetSecretValueCommand({ SecretId: secretName });
  const result = await secretsManager.send(command);
  
  if (!result.SecretString) {
    throw new Error(`Basic Auth credentials not found: ${secretName}`);
  }
  
  const secretData = JSON.parse(result.SecretString);
  return {
    username: secretData.username,
    password: secretData.password
  };
}

function parseBasicAuth(authorizationHeader: string): { username: string; password: string } | null {
  
  if (!authorizationHeader || !authorizationHeader.startsWith('Basic ')) {
    return null;
  }

  try {
    const base64Credentials = authorizationHeader.substring(6);
    
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
    
    const [username, password] = credentials.split(':');
    
    if (!username || !password) {
      return null;
    }
    
    return { username, password };
  } catch (error) {
    return null;
  }
}

export const handler = async (event: APIGatewayTokenAuthorizerEvent): Promise<APIGatewayAuthorizerResult> => {
  return AWSXRay.captureAsyncFunc('AdyenWebhookAuthorizer', async (subsegment) => {
    try {
      const authorizationHeader = event.authorizationToken;
      
      if (!authorizationHeader) {
        throw new Error('Missing Authorization header');
      }

      // Parse Basic Auth credentials from header
      const parsedCredentials = parseBasicAuth(authorizationHeader);
      
      if (!parsedCredentials) {
        throw new Error('Invalid Basic Auth format');
      }

      // Get stored credentials from Secrets Manager
      const storedCredentials = await getBasicAuthCredentials();
      
      if (parsedCredentials.username !== storedCredentials.username || 
          parsedCredentials.password !== storedCredentials.password) {
        throw new Error('Invalid credentials');
      }

      // Generate IAM policy for successful authentication
      const policy: APIGatewayAuthorizerResult = {
        principalId: parsedCredentials.username,
        policyDocument: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: 'execute-api:Invoke',
              Effect: 'Allow',
              Resource: event.methodArn,
            },
          ],
        },
      };

      return policy;

    } catch (error) {
      console.error('Authorization failed:', error);
      
      // Return deny policy for failed authentication
      return {
        principalId: 'unauthorized',
        policyDocument: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: 'execute-api:Invoke',
              Effect: 'Deny',
              Resource: event.methodArn,
            },
          ],
        },
      };
    }
  });
}; 