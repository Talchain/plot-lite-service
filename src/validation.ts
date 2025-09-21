import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { ErrorObject } from 'ajv';

let compiled: any | null = null;
let lastErrors: ErrorObject[] | null = null;

async function getValidator() {
  if (compiled) return compiled;
  const AjvCtor = (await import('ajv')).default as any;
  const ajv = new AjvCtor({ strict: true, allErrors: true });
  const schemaPath = resolve(process.cwd(), 'schemas', 'flow.schema.json');
  const flowSchema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  // Normalise schema for Ajv by removing the $schema meta if present
  if (flowSchema.$schema) delete flowSchema.$schema;
  const validateFn = ajv.compile(flowSchema);
  compiled = (data: unknown) => {
    const ok = validateFn(data);
    lastErrors = (validateFn.errors || null) as any;
    return ok;
  };
  return compiled;
}

export type ValidationResult = { ok: true } | { ok: false; hint: string };

export async function validateFlowAsync(value: unknown): Promise<ValidationResult> {
  const validator = await getValidator();
  const ok = validator(value);
  if (ok) return { ok: true };
  const err = (lastErrors?.[0] as ErrorObject | undefined);
  const hint = err ? `${err.instancePath || '/'} ${err.message}` : 'Schema validation failed';
  return { ok: false, hint };
}
