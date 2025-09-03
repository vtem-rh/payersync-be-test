import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
/**
 * Adds CDK Nag to the application to check for security and compliance issues
 * @param app The CDK app to add CDK Nag to
 */
export declare function addCdkNagToApp(app: Construct): void;
/**
 * Adds suppressions for known CDK Nag issues in the stack
 * @param stack The stack to add suppressions to
 * @param stackId The ID of the stack
 */
export declare function addCdkNagSuppressions(stack: Stack, stackId: string): void;
