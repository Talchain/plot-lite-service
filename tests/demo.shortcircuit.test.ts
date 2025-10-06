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

  beforeAll(async () => {
    process.env.TEST_ROUTES = '1';
    app = await createServer({ enableTestRoutes: true });
  });

  afterAll(async () => {
    await app.close();
    if (prevTestRoutes === undefined) delete process.env.TEST_ROUTES; else process.env.TEST_ROUTES = prevTestRoutes;
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

  it('/v1/counterfactual?demo=1 returns contract-true demo', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/counterfactual?demo=1' });
    expect(res.statusCode).toBe(200);
    const body: any = res.json();
    expect(body.schema).toBe('counterfactual.v1');
    expect(body?.model_card?.response_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
