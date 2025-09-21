import Ajv, { ErrorObject } from 'ajv';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ajv = new Ajv({ strict: true, allErrors: true });

const schemaPath = resolve(process.cwd(), 'schemas', 'flow.schema.json');
const flowSchema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const validateFlowSchema = ajv.compile(flowSchema);

export type ValidationResult = { ok: true } | { ok: false; hint: string };

export function validateFlow(value: unknown): ValidationResult {
  const ok = validateFlowSchema(value);
  if (ok) return { ok: true };
  const err = (validateFlowSchema.errors?.[0] as ErrorObject | undefined);
  const hint = err ? `${err.instancePath || '/'} ${err.message}` : 'Schema validation failed';
  return { ok: false, hint };
}