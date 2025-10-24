import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';
import { sha256Stable } from '../src/util/canonical-json.js';
import { GOLDEN_SCENARIO } from '../src/fixtures/self-check.js';

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

  it('self-check hash equals response_hash from /v1/run', async () => {
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
    
    // Self-check should match the response_hash that /v1/run computed
    expect(scBody.hash).toBe(runBody.model_card.response_hash);
  });
});
