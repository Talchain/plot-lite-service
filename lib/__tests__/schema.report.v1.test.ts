import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/createServer.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';

const schemaPath = resolve(process.cwd(), 'docs', 'schema', 'report.v1.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(schema);

function validateJson(obj: any): string[] {
  const ok = validate(obj) as boolean;
  if (ok) return [];
  return (validate.errors || []).map(e => `${e.instancePath} ${e.message}`);
}

describe('report.v1 schema validation', () => {
  let app: Awaited<ReturnType<typeof createServer>>;
  beforeAll(async () => {
    app = await createServer({ enableTestRoutes: true });
  });
  afterAll(async () => { await app.close(); });

  it('fixtures conform to schema', async () => {
    const cases = [
      ['pricing_change', 101],
      ['feature_launch', 202],
      ['build_vs_buy', 303],
    ] as const;
    for (const [tmpl, seed] of cases) {
      const fp = resolve(process.cwd(), 'fixtures', tmpl, `${seed}.json`);
      const obj = JSON.parse(readFileSync(fp, 'utf8'));
      const errs = validateJson(obj);
      if (errs.length) {
        // eslint-disable-next-line no-console
        console.error('Schema errors for', fp, errs);
      }
      expect(errs.length).toBe(0);
    }
  });

  it('GET /draft-flows responses conform to schema', async () => {
    const cases = [
      ['pricing_change', 101],
      ['feature_launch', 202],
      ['build_vs_buy', 303],
    ] as const;
    for (const [tmpl, seed] of cases) {
      const res = await app.inject({ method: 'GET', url: `/draft-flows?template=${tmpl}&seed=${seed}` });
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-cache');
      const obj = res.json();
      const errs = validateJson(obj);
      if (errs.length) {
        // eslint-disable-next-line no-console
        console.error('Schema errors for GET', tmpl, seed, errs);
      }
      expect(errs.length).toBe(0);
    }
  });
});
