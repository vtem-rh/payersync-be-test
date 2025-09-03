export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export const validatePayload = (merchantData: any) => {
  if (!merchantData) {
    throw new ValidationError("Validation failed: Missing 'merchantData' in payload");
  }
  const requiredFields = ['legalEntity', 'accountHolder', 'businessLine', 'balanceAccount', 'store'];
  for (const field of requiredFields) {
    if (!merchantData[field]) {
      throw new ValidationError(`Validation failed: Missing required field '${field}' in merchantData`);
    }
  }

  // Validate that store is an array
  if (!Array.isArray(merchantData.store)) {
    throw new ValidationError(`Validation failed: 'store' field must be an array in merchantData`);
  }

  // Validate each store in the array
  for (let i = 0; i < merchantData.store.length; i++) {
    if (!merchantData.store[i].phoneNumber) {
      throw new ValidationError(`Validation failed: Missing required field 'phoneNumber' in merchantData.store[${i}]`);
    }
  }
};
