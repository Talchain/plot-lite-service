import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';

const FIXTURES_DIR = resolve(process.cwd(), 'contracts/fixtures');

const runSchema = JSON.parse(readFileSync(resolve(process.cwd(), 'contracts/run.v1.schema.json'), 'utf8'));
const errorSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['schema', 'code', 'message'],
  properties: {
    schema: { type: 'string', const: 'error.v1' },
    code: { type: 'string' },
    message: { type: 'string' },
    details: { type: 'object' }
  },
  additionalProperties: true,
};

const ajv = new Ajv({ allErrors: true, strict: false });
const validateRun = ajv.compile(runSchema);
const validateError = ajv.compile(errorSchema);

function validateFixture(p: string) {
  const raw = readFileSync(p, 'utf8');
  const json = JSON.parse(raw);
  const schema = json?.schema;
  if (schema === 'run.v1') {
    const ok = validateRun(json);
    if (!ok) throw new Error(`${p} invalid run.v1: ${JSON.stringify(validateRun.errors)}`);
  } else if (schema === 'error.v1') {
    const ok = validateError(json);
    if (!ok) throw new Error(`${p} invalid error.v1: ${JSON.stringify(validateError.errors)}`);
  } else {
    throw new Error(`${p} unknown schema: ${schema}`);
  }
}

describe('Contracts: fixtures validate against schemas', () => {
  it('all fixtures are valid', () => {
    const files = readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      validateFixture(resolve(FIXTURES_DIR, f));
    }
  });
});
