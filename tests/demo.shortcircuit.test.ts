import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

/**
 * Verifies demo short-circuit runs before Ajv and returns a contract-true payload.
 * We test /v1/run specifically (others have route-specific schemas).
 */
describe('v1 demo short-circuit', () => {
  let app: FastifyInstance;
  const prevTestRoutes = process.env.TEST_ROUTES;
  const prevDemoMode = process.env.DEMO_MODE_ENABLED;

  beforeAll(async () => {
    process.env.TEST_ROUTES = '1';
    process.env.DEMO_MODE_ENABLED = '1';
    app = await createServer({ enableTestRoutes: true });
  });

  afterAll(async () => {
    await app.close();
    if (prevTestRoutes === undefined) delete process.env.TEST_ROUTES; else process.env.TEST_ROUTES = prevTestRoutes;
    if (prevDemoMode === undefined) delete process.env.DEMO_MODE_ENABLED; else process.env.DEMO_MODE_ENABLED = prevDemoMode;
  });

  it('/v1/run?demo=1 returns contract-true demo', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/run?demo=1' });
    expect(res.statusCode).toBe(200);
    const body: any = res.json();
    expect(body.schema).toBe('run.v1');
    expect(typeof body?.meta?.seed).toBe('number');
    expect(body?.model_card?.response_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('/v1/critique?demo=1 returns contract-true demo', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/critique?demo=1' });
    expect(res.statusCode).toBe(200);
    const body: any = res.json();
    expect(body.schema).toBe('critique.v1');
    expect(body?.model_card?.response_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('/v1/draft?demo=1 returns contract-true demo', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/draft?demo=1' });
    expect(res.statusCode).toBe(200);
    const body: any = res.json();
    expect(body.schema).toBe('draft.v1');
    expect(body?.model_card?.response_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  // ROADMAP 2.105: the demo short-circuit was REMOVED from /v1/counterfactual
  // along with the route's compute. The refusal is unconditional and precedes
  // both validation and demo handling, so `?demo=1` cannot reopen the trap.
  it('/v1/counterfactual?demo=1 refuses — demo does not bypass a WITHDRAWN route', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/counterfactual?demo=1' });
    expect(res.statusCode).toBe(501);
    const body: any = res.json();
    expect(body.schema).toBe('error.v1');
    expect(body.code).toBe('ANALYSIS_UNAVAILABLE');
    expect(body.model_card).toBeUndefined();
  });
});
