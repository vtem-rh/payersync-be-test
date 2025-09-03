# PayerSync Onboarder Backend

[![Code Coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/USERNAME/GIST_ID/raw/coverage.json)](https://github.com/rectanglehealth/payersync-onboarder-backend/actions/workflows/code-coverage.yml)
[![NPM Audit](https://github.com/rectanglehealth/payersync-onboarder-backend/actions/workflows/npm-audit-badge.yml/badge.svg)](https://github.com/rectanglehealth/payersync-onboarder-backend/actions/workflows/npm-audit-badge.yml)

This is the backend service for PayerSync onboarding, built with AWS CDK and TypeScript. The service provides a multi-step form backend that gathers information from users and stores/retrieves data as needed, hosted on AWS EKS with NextJS and Cognito authentication.

## Quick Start

### Prerequisites

- Node.js 24.2.0 or later
- AWS CLI configured with appropriate credentials
- AWS CDK CLI installed (`npm install -g aws-cdk`)

### Initial Setup

1. Install dependencies:
```bash
npm install
```

2. Bootstrap your AWS environment (required only once per AWS account/region):
```bash
npx cdk bootstrap
```

3. Set up environment variables:
```bash
cp env.example .env
# Edit .env with your actual values
```

### Deploy

Deploy to any environment:
```bash
npm run deploy <environment>
```

Examples:
```bash
npm run deploy dev
npm run deploy prod
```

## Environment Variables

Create a `.env` file based on `env.example` with the following required variables:

**Required:**
- `ADYEN_LEM_API_KEY`: Adyen Legal Entity Management API key
- `ADYEN_BP_API_KEY`: Adyen Business Platform API key  
- `ADYEN_PSP_API_KEY`: Adyen Payment Service Provider API key

**Optional:**
- `APP_NAME`: Application name (defaults to `PayerSyncOnboarder`)
- `CORS_ALLOWED_ORIGINS`: Comma-separated list of allowed origins
- Other Adyen configuration variables (see `env.example` for defaults)

## Environment-Specific Configuration

The application now supports environment-specific configuration files. When deploying to different environments, the system will automatically load the appropriate `.env-{environment}` file.

### Setup Environment Files

Create environment-specific configuration files in your project root:

```bash
.env-qa          # QA environment configuration
.env-staging     # Staging environment configuration  
.env-prod        # Production environment configuration
.env-dev         # Development environment configuration (optional, falls back to .env)
```

### Deployment Commands

Deploy to specific environments using:

```bash
# Using npm scripts
npm run deploy qa
npm run deploy staging
npm run deploy prod

# Using CDK directly
cdk deploy --context environment=qa
cdk deploy --context environment=staging
cdk deploy --context environment=prod
```

### How It Works

1. The deployment command specifies the environment context: `--context environment=qa`
2. The application automatically looks for `.env-qa` file
3. If found, loads all environment variables from that file
4. If not found, falls back to the default `.env` file
5. Environment variables are loaded before the CDK stack is created

### Example Environment File Structure

```bash
# .env-qa
ADYEN_LEM_API_KEY=your_qa_adyen_lem_api_key_here
ADYEN_BP_API_KEY=your_qa_adyen_bp_api_key_here
ADYEN_PSP_API_KEY=your_qa_adyen_psp_api_key_here
ADYEN_MERCHANT_ACCOUNT=QAMerchantAccount
CORS_ALLOWED_ORIGINS=https://qa.yourdomain.com
CDK_DEFAULT_ACCOUNT=your_qa_aws_account_id_here

# .env-staging  
ADYEN_LEM_API_KEY=your_staging_adyen_lem_api_key_here
ADYEN_BP_API_KEY=your_staging_adyen_bp_api_key_here
ADYEN_PSP_API_KEY=your_staging_adyen_psp_api_key_here
ADYEN_MERCHANT_ACCOUNT=StagingMerchantAccount
CORS_ALLOWED_ORIGINS=https://staging.yourdomain.com
CDK_DEFAULT_ACCOUNT=your_staging_aws_account_id_here
```

**Note**: Environment-specific `.env-*` files are automatically ignored by git to prevent committing sensitive configuration data.

## Documentation

For detailed information see more:

- **[Developer Guide](doc/DEVELOPER_GUIDE.md)** - Development setup, testing, and code quality
- **[DevOps Guide](doc/DEVOPS_GUIDE.md)** - Deployment, infrastructure, and operations
- **[Security Guide](doc/SECURITY_GUIDE.md)** - Security practices, compliance, and monitoring
- **[Architecture](doc/ARCHITECTURE.md)** - System architecture overview
- **[API Endpoints](doc/API_ENDPOINTS.md)** - Complete API reference and CDK stack implementation
- **[Adyen API Flow](doc/adyen-onboarding-api.md)** - Adyen integration details
- **[Webhook Setup](doc/WEBHOOK_SETUP.md)** - Adyen webhook endpoint configuration and testing

## Project Structure

```
src/functions/onboarding/  # Lambda function source code
lib/                      # CDK stack definitions and configuration
test/                     # Test files (unit, integration, snapshot)
doc/                      # Documentation and API references
```

## Available Commands

```bash
npm test              # Run all tests
npm run deploy dev    # Deploy to development
npm run destroy dev   # Destroy development stack
npm run lint          # Check code quality
npm run format        # Format code
```

## Important Notes

- Lambda functions are automatically bundled using esbuild
- Secrets are created in AWS Secrets Manager during deployment
- All resources follow the naming pattern: `${appName}-${environment}-resourceName`
- Bootstrapping is only required once per AWS account/region
