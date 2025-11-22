import Ajv from 'ajv';
import { runResponseSchema } from '../../../src/schemas/response.js';

export const ajv = new Ajv({ allErrors: true, strict: false, removeAdditional: false });

export const validateRunResponse = ajv.compile(runResponseSchema);

export function expectSchema(body: unknown, validator: Ajv.ValidateFunction, label = 'response'): void {
  const ok = validator(body);
  if (!ok) {
    const errors = JSON.stringify(validator.errors, null, 2);
    throw new Error(`${label} schema validation failed:\n${errors}`);
  }
}
