import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';
import { sha256Stable } from '../src/util/canonical-json.js';
import { GOLDEN_SCENARIO } from '../src/fixtures/self-check.js';

/**
 * Selfcheck Parity & Round-trip Consistency Tests
 * 
 * Test A: /v1/self-check hash equals /v1/run.model_card.response_hash
 * Test B: /v1/run.model_card.response_hash equals sha256Stable(runBody)
 */
describe('/v1/self-check parity with /v1/run', () => {
  let app: FastifyInstance;
  const prevTestRoutes = process.env.TEST_ROUTES;

  beforeAll(async () => {
    process.env.TEST_ROUTES = '1';
    app = await createServer({ enableTestRoutes: true });
  });

  afterAll(async () => {
    await app.close();
    if (prevTestRoutes === undefined) delete process.env.TEST_ROUTES; else process.env.TEST_ROUTES = prevTestRoutes;
  });

  it('self-check hash equals /v1/run response_hash', async () => {
    const run = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: { graph: GOLDEN_SCENARIO.graph }
    });
    expect(run.statusCode).toBe(200);
    const runBody: any = run.json();
    
    const sc = await app.inject({ method: 'GET', url: '/v1/self-check' });
    expect(sc.statusCode).toBe(200);
    const scBody: any = sc.json();
    
    expect(typeof scBody.hash).toBe('string');
    expect(scBody.hash).toBe(runBody.model_card.response_hash);
  });

  it('response_hash equals sha256Stable(runBody)', async () => {
    const run = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: { graph: GOLDEN_SCENARIO.graph }
    });
    expect(run.statusCode).toBe(200);
    const runBody: any = run.json();
    
    const expected = sha256Stable(runBody);
    expect(runBody.model_card.response_hash).toBe(expected);
  });
});
