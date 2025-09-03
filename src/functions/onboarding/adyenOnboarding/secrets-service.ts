import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { captureAWSv3Client } from 'aws-xray-sdk-core';

const secretsManager = captureAWSv3Client(new SecretsManagerClient({}));

export async function getApiKey(secretName: string): Promise<string> {
  if (!secretName) {
    throw new Error(`Secret name is not defined.`);
  }
  const command = new GetSecretValueCommand({ SecretId: secretName });
  try {
    const result = await secretsManager.send(command);
    const secretString = result.SecretString;
    if (!secretString) {
      throw new Error(`API key not found in Secrets Manager for ${secretName}`);
    }
    
    // Parse the JSON secret string to extract the apiKey
    const secretData = JSON.parse(secretString);
    const apiKey = secretData.apiKey;
    if (!apiKey) {
      throw new Error(`API key not found in secret data for ${secretName}`);
    }
    
    return apiKey;
  } catch (err: any) {
    if (err.name === 'ResourceNotFoundException' || err.Code === 'ResourceNotFoundException') {
      console.error(`Secret not found: ${secretName}`, err);
      throw new Error(`Secret not found: ${secretName}`);
    }
    console.error(`Error fetching secret: ${secretName}`, err);
    throw err;
  }
}

export interface AdyenApiKeys {
  lemApiKey: string;
  bpApiKey: string;
  pspApiKey: string;
}

export async function getAdyenApiKeys(): Promise<AdyenApiKeys> {
  const lemSecretName = process.env.ADYEN_LEM_SECRET_NAME;
  const bpSecretName = process.env.ADYEN_BP_SECRET_NAME;
  const pspSecretName = process.env.ADYEN_PSP_SECRET_NAME;
  
  if (!lemSecretName || !bpSecretName || !pspSecretName) {
    throw new Error('Missing required environment variables for Adyen API key secret names');
  }
  
  const [lemApiKey, bpApiKey, pspApiKey] = await Promise.all([
    getApiKey(lemSecretName),
    getApiKey(bpSecretName),
    getApiKey(pspSecretName)
  ]);
  
  return { lemApiKey, bpApiKey, pspApiKey };
}