export enum OnboardingStatus {
    NOT_ONBOARDED = 'SUBMITTED',
    ONBOARDING = 'READY_FOR_ADYEN',
    ONBOARDED = 'ONBOARDED',
}

export interface VerificationStatuses {
    receivePayments: boolean;
    sendToTransferInstrument: boolean;
    sendToBalanceAccount: boolean;
    receiveFromBalanceAccount: boolean;
    receiveFromTransferInstrument: boolean;
    receiveFromPlatformPayments: boolean;
}

export interface AdyenData {
    legalEntityId?: string;
    soleProprietorshipLegalEntityId?: string; // ONLY FOR INDIVIDUAL MAPPING
    accountHolderId?: string;
    businessLineId?: string;
    splitConfigurationId?: string;
    balanceAccountId?: string;
    storeId?: string;
    visaPaymentMethodId?: string;
    mastercardPaymentMethodId?: string;
    transferInstrumentId?: string;
    sweepId?: string;
    verificationStatuses?: VerificationStatuses;
}