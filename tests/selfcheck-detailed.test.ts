import { describe, it, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';
import { stableStringify, normaliseReport } from '../src/util/canonical-json.js';
import { GOLDEN_SCENARIO } from '../src/fixtures/self-check.js';
import { writeFileSync } from 'node:fs';

describe('Selfcheck detailed', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.TEST_ROUTES = '1';
    app = await createServer({ enableTestRoutes: true });
  });

  afterAll(async () => {
    await app.close();
    delete process.env.TEST_ROUTES;
  });

  it('detailed comparison', async () => {
    const run = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: { graph: GOLDEN_SCENARIO.graph }
    });
    const runBody: any = run.json();
    
    const runNorm = normaliseReport(runBody);
    const runCanon = stableStringify(runNorm);
    
    writeFileSync('.debug-run-full.json', JSON.stringify(runBody, null, 2));
    writeFileSync('.debug-run-norm.json', runCanon);
    
    console.log('\nRun response keys:', Object.keys(runBody).sort().join(', '));
    console.log('Run normalized keys:', Object.keys(runNorm as any).sort().join(', '));
    console.log('Run canon length:', runCanon.length);
  });
});
