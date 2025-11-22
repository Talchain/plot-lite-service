import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createServer } from '../../src/createServer.js';

describe('GET /health contract and size', () => {
  let app: Awaited<ReturnType<typeof createServer>>;
  beforeAll(async () => {
    app = await createServer({ enableTestRoutes: true });
  });
  afterAll(async () => {
    await app.close();
  });

  it('includes required keys and types, and payload <= 4 KB', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;

    expect(typeof body.status).toBe('string');
    expect(typeof body.p95_ms).toBe('number');
    expect(typeof body.test_routes_enabled).toBe('boolean');
    expect(body.replay && typeof body.replay === 'object').toBe(true);
    expect(['ok','fail','unknown']).toContain(body.replay.lastStatus);
    expect(typeof body.replay.refusals).toBe('number');
    expect(typeof body.replay.retries).toBe('number');
    expect(body.replay.lastTs === null || typeof body.replay.lastTs === 'string').toBe(true);

    // size guard
    expect(Buffer.byteLength(res.payload, 'utf8')).toBeLessThanOrEqual(4096);
  });
});
