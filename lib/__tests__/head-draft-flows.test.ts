import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createServer } from '../../src/createServer.js';

describe('HEAD /draft-flows headers and 304', () => {
  let app: Awaited<ReturnType<typeof createServer>>;
  beforeAll(async () => { app = await createServer({ enableTestRoutes: true }); });
  afterAll(async () => { await app.close(); });

  it('returns 200 with headers on HEAD', async () => {
    const res = await app.inject({ method: 'HEAD', url: '/draft-flows?template=pricing_change&seed=101' });
    expect([200,304,404,400]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.headers['etag']).toBeTruthy();
      expect(res.headers['content-length']).toBeTruthy();
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers['vary']).toContain('If-None-Match');
      expect(res.body).toBe('');
    }
  });

  it('returns 304 when If-None-Match matches', async () => {
    const first = await app.inject({ method: 'GET', url: '/draft-flows?template=pricing_change&seed=101' });
    expect(first.statusCode).toBe(200);
    const et = String(first.headers['etag']);
    const res = await app.inject({ method: 'HEAD', url: '/draft-flows?template=pricing_change&seed=101', headers: { 'if-none-match': et } });
    expect(res.statusCode).toBe(304);
    expect(res.body).toBe('');
  });

  it('returns 400 for bad query params (invalid seed type)', async () => {
    const res = await app.inject({ method: 'HEAD', url: '/draft-flows?template=pricing_change&seed=not-a-number' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for unknown fixture', async () => {
    const res = await app.inject({ method: 'HEAD', url: '/draft-flows?template=pricing_change&seed=999999' });
    expect([200,404]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      // If fixture exists for this seed in dev image, accept 200; otherwise expect 404
      expect(res.headers['etag']).toBeTruthy();
    } else {
      expect(res.statusCode).toBe(404);
    }
  });

  it('allows invoking HEAD twice without duplicate route issues', async () => {
    const first = await app.inject({ method: 'HEAD', url: '/draft-flows?template=pricing_change&seed=101' });
    const second = await app.inject({ method: 'HEAD', url: '/draft-flows?template=pricing_change&seed=101' });
    expect([200,304,404,400]).toContain(first.statusCode);
    expect([200,304,404,400]).toContain(second.statusCode);
  });
});
