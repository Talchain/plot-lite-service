import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import YAML from 'yaml';
import Ajv from 'ajv';

function compileFromOpenAPI(doc: any, ref: string) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  // give the whole doc an id so $ref with fragment works
  const id = 'https://example.com/openapi.json';
  const root = { $id: id, ...doc };
  ajv.addSchema(root);
  const schema = ajv.getSchema(id + ref);
  if (!schema) throw new Error('schema not found for ref ' + ref);
  return schema;
}

describe('OpenAPI dev-time schema validation (offline)', () => {
  const specPath = resolve(process.cwd(), 'openapi', 'openapi-plot-lite-v1.yaml');
  if (!existsSync(specPath)) {
    it('skipped (no spec present)', () => { expect(true).toBe(true); });
    return;
  }

  const doc = YAML.parse(readFileSync(specPath, 'utf8'));

  function stripNulls(input: any): any {
    if (Array.isArray(input)) return input.map(stripNulls);
    if (input && typeof input === 'object') {
      const out: any = {};
      for (const [k, v] of Object.entries(input)) {
        if (v === null) continue;
        out[k] = stripNulls(v);
      }
      return out;
    }
    return input;
  }

  it('validates fixture DraftFlowsResponse against OpenAPI schema (offline)', () => {
    const val = compileFromOpenAPI(doc, '#/components/schemas/DraftFlowsResponse');
    const fixturesPath = resolve(process.cwd(), 'fixtures', 'deterministic-fixtures.json');
    const fixtures = JSON.parse(readFileSync(fixturesPath, 'utf8'));
    for (const c of fixtures.cases || []) {
      const normal = stripNulls(c.response);
      const ok = val(normal);
      if (!ok) {
        // @ts-ignore
        throw new Error('Fixture does not match schema: ' + JSON.stringify(val.errors));
      }
    }
  });

  it('validates a sample CritiqueResponse against OpenAPI schema (offline)', () => {
    const val = compileFromOpenAPI(doc, '#/components/schemas/CritiqueResponse');
    const sample = { critique: [ { note: 'Example', severity: 'IMPROVEMENT', fix_available: true } ] };
    const ok = val(sample);
    if (!ok) {
      // @ts-ignore
      throw new Error('Critique sample does not match schema: ' + JSON.stringify(val.errors));
    }
  });
});