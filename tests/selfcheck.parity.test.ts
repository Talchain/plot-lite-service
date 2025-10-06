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

  it('self-check hash equals canonical SHA256 of /v1/run body', async () => {
    // Minimal valid run payload per Ajv schema
    const run = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: {
        graph: GOLDEN_SCENARIO.graph
      }
    });
    expect(run.statusCode).toBe(200);
    const runBody: any = run.json();
    const expected = sha256Stable(runBody);

    const sc = await app.inject({ method: 'GET', url: '/v1/self-check' });
    expect(sc.statusCode).toBe(200);
    const scBody: any = sc.json();
    expect(scBody.hash).toBe(expected);
  });
});
