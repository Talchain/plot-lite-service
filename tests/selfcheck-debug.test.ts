import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';
import { sha256Stable, stableStringify, normaliseReport } from '../src/util/canonical-json.js';
import { GOLDEN_SCENARIO } from '../src/fixtures/self-check.js';
import { writeFileSync } from 'node:fs';

describe('Selfcheck debug', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.TEST_ROUTES = '1';
    app = await createServer({ enableTestRoutes: true });
  });

  afterAll(async () => {
    await app.close();
    delete process.env.TEST_ROUTES;
  });

  it('debug hash difference', async () => {
    const run = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: { graph: GOLDEN_SCENARIO.graph }
    });
    const runBody: any = run.json();
    
    const sc = await app.inject({ method: 'GET', url: '/v1/self-check' });
    const scBody: any = sc.json();
    
    // Write normalized versions
    const runNorm = normaliseReport(runBody);
    const runCanon = stableStringify(runNorm);
    writeFileSync('.debug-run-normalized.json', runCanon);
    
    console.log('\n=== RUN BODY KEYS ===');
    console.log(Object.keys(runBody).sort());
    
    console.log('\n=== NORMALIZED RUN KEYS ===');
    console.log(Object.keys(runNorm as any).sort());
    
    console.log('\n=== HASHES ===');
    console.log('Run hash:', sha256Stable(runBody));
    console.log('SC hash:', scBody.hash);
    
    console.log('\n=== RUN model_card ===');
    console.log(JSON.stringify(runBody.model_card, null, 2));
  });
});
