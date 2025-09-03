# Adyen Onboarding API Flow

This document outlines the sequence of Adyen API calls required to onboard a new merchant. The calls are presented in the order they should be executed, as some calls depend on the output of others.

For a high-level overview of the system, please refer to the [System Architecture Diagram](ARCHITECTURE.md).

The full reference for these API calls can be found in the Postman collection located at `scripts/Payersync Onboarding.postman_collection.json`.

## Onboarding Steps

The onboarding process involves the following sequence of API calls:

1.  Create a Legal Entity (Organization or Individual)
2.  Create an Account Holder
3.  Create a Business Line
4.  Create a Balance Account
5.  Create a Store
6.  Create a Hosted Onboarding Link

---

### 1. Create a Legal Entity

This is the first step in the onboarding process. A legal entity can be either an `organization` or an `individual`. This call returns a `legalEntityId` which is required for subsequent steps.

**Endpoint:** `POST /legalEntities`

#### Organization Payload
```json
{
    "type": "organization",
    "organization": {
        "legalName": "BK Group",
        "type": "privateCompany",
        "registeredAddress": {
            "city": "Greenacres",
            "country": "US",
            "postalCode": "33463",
            "stateOrProvince": "FL",
            "street": "5943 Westfall Rd",
            "street2": "11th floor"
        }
    }
}
```

#### Individual Payload
```json
{
  "type": "individual",
  "individual": {
    "name": {
      "firstName": "Matt",
      "lastName": "Bernier"
    },
    "residentialAddress": {
      "country": "US"
    }
  }
}
```

---

### 2. Create an Account Holder

This call creates an account holder, which is linked to the previously created legal entity.

**Endpoint:** `POST /accountHolders`
**Dependency:** `legalEntityId` from Step 1.

#### Payload
```json
{
    "description": "BK Group",
    "reference": "BK Group Inc",
    "legalEntityId": "{LEGAL_ENTITY_ID}"
}
```

---

### 3. Create a Business Line

This call creates a business line for the legal entity, which describes their line of business.

**Endpoint:** `POST /businessLines`
**Dependency:** `legalEntityId` from Step 1.

#### Payload
```json
{
    "service": "paymentProcessing",
    "industryCode": "339E",
    "salesChannels": ["eCommerce", "ecomMoto"],
    "legalEntityId": "{LEGAL_ENTITY_ID}",
    "webData": [{
        "webAddress": "https://yoururl.com"
    }]
}
```
This returns a `businessLineId`.

---

### 4. Create a Balance Account

This call creates a balance account for the account holder to hold funds.

**Endpoint:** `POST /balanceAccounts`
**Dependency:** `accountHolderId` from Step 2.

#### Payload
```json
{
    "accountHolderId": "{ACCOUNT_HOLDER_ID}",
    "description": "USD Balance Account",
    "defaultCurrencyCode": "USD",
    "timeZone": "America/Chicago"
}
```

---

### 5. Create a Store

This call creates a store for the merchant, which is associated with their business line(s).

**Endpoint:** `POST /stores`
**Dependencies:** `businessLineIds` from Step 3 and `merchantId`.

#### Payload
```json
{
    "merchantId": "RectangleHealthCOM",
    "description": "BK Group",
    "shopperStatement": "BK Group",
    "reference": "bk_group",
    "phoneNumber": "+13123456789",
    "address": {
        "country": "US",
        "line1": "200 Main Street",
        "line2": "Building 5A",
        "line3": "Suite 3",
        "city": "Springfield",
        "stateOrProvince": "NY",
        "postalCode": "20250"
    },
    "businessLineIds": ["{BUSINESS_LINE_ID}"]
}
```

---

### 6. Create a Hosted Onboarding Link

This call generates a link to an Adyen-hosted onboarding page for the user.

**Endpoint:** `POST /legalEntities/{id}/onboardingLinks`
**Dependency:** `legalEntityId` from Step 1.

#### Payload
```json
{
    "themeId": "ONBT42CQ3223226G5MHSFMQ68M68ZD",
    "redirectUrl": "https://rectanglehealth.com",
    "locale": "en-US"
}
``` 