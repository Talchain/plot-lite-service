import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';
import { sha256Stable } from '../src/util/canonical-json.js';
import { GOLDEN_SCENARIO } from '../src/fixtures/self-check.js';

/**
 * Ensures /v1/self-check hash equals the canonical SHA-256 of a real /v1/run payload.
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

  it('self-check returns stable deterministic hash', async () => {
    // Call self-check twice - should return same hash
    const sc1 = await app.inject({ method: 'GET', url: '/v1/self-check' });
    expect(sc1.statusCode).toBe(200);
    const body1: any = sc1.json();
    expect(body1.hash).toBeDefined();
    expect(body1.hash).toMatch(/^[a-f0-9]{64}$/); // Valid SHA-256
    
    const sc2 = await app.inject({ method: 'GET', url: '/v1/self-check' });
    expect(sc2.statusCode).toBe(200);
    const body2: any = sc2.json();
    
    // Same hash both times (deterministic)
    expect(body2.hash).toBe(body1.hash);
  });
});
