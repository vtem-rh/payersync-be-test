import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
export interface PayersyncOnboarderBackendStackProps extends cdk.StackProps {
    appName: string;
}
export declare class PayersyncOnboarderBackendStack extends cdk.Stack {
    private readonly config;
    private readonly appName;
    constructor(scope: Construct, id: string, props: PayersyncOnboarderBackendStackProps);
}
