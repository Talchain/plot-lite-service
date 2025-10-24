import { describe, it, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';
import { stableStringify, normaliseReport } from '../src/util/canonical-json.js';
import { GOLDEN_SCENARIO } from '../src/fixtures/self-check.js';
import { writeFileSync } from 'node:fs';

describe('Selfcheck compare', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.TEST_ROUTES = '1';
    app = await createServer({ enableTestRoutes: true });
  });

  afterAll(async () => {
    await app.close();
    delete process.env.TEST_ROUTES;
  });

  it('compare normalized outputs', async () => {
    // Get actual /v1/run response
    const run = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: { graph: GOLDEN_SCENARIO.graph }
    });
    const runBody: any = run.json();
    
    // Get self-check
    const sc = await app.inject({ method: 'GET', url: '/v1/self-check' });
    const scBody: any = sc.json();
    
    // Normalize both
    const runNorm = normaliseReport(runBody);
    const runCanon = stableStringify(runNorm);
    
    // Write both for comparison
    writeFileSync('.debug-run.json', runCanon);
    writeFileSync('.debug-sc-hash.txt', scBody.hash);
    
    console.log('\n=== Comparison ===');
    console.log('Run normalized length:', runCanon.length);
    console.log('SC hash:', scBody.hash);
  });
});
