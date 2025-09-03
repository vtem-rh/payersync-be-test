process.env.ADYEN_BP_API_URL = 'https://test-bp-api.adyen.com';
process.env.ADYEN_MANAGEMENT_API_URL = 'https://test-management-api.adyen.com';
process.env.ADYEN_LEM_API_URL = 'https://test-lem-api.adyen.com';
process.env.ADYEN_MERCHANT_ACCOUNT = 'RectangleHealthCOM';
process.env.ADYEN_LEM_API_KEY_PARAM = 'test_lem_api_key';
process.env.ADYEN_BP_API_KEY_PARAM = 'test_bp_api_key';
process.env.ADYEN_PSP_API_KEY_PARAM = 'test_psp_api_key';
process.env.APP_NAME = process.env.APP_NAME || 'PayerSyncOnboarder';
process.env.ENVIRONMENT = process.env.ENVIRONMENT || 'test';
process.env.ADYEN_ONBOARDING_FUNCTION_NAME = process.env.ADYEN_ONBOARDING_FUNCTION_NAME || 'mock-adyen-onboarding-function';
process.env.LEAD_EVENT_TOPIC_ARN = process.env.LEAD_EVENT_TOPIC_ARN || 'mock-lead-event-topic-arn';
process.env.ONBOARDED_EVENT_TOPIC_ARN = process.env.ONBOARDED_EVENT_TOPIC_ARN || 'mock-onboarded-event-topic-arn';
process.env.GROUP_STEP_COMPLETED_TOPIC_ARN = process.env.GROUP_STEP_COMPLETED_TOPIC_ARN || 'mock-group-step-completed-topic-arn';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.CDK_DEFAULT_REGION = process.env.CDK_DEFAULT_REGION || 'us-east-1';
process.env.CDK_DEFAULT_ACCOUNT = process.env.CDK_DEFAULT_ACCOUNT || '000000000000';

import 'dotenv/config'; 