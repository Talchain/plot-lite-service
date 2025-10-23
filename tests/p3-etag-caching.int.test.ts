import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('P3: ETag caching for /v1/limits', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.AUTH_ENABLED = '0';
    app = await createServer();
    await app.listen({ port: 0 });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('first request returns 200 with ETag and Cache-Control', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/limits' });
    
    expect(res.statusCode).toBe(200);
    expect(res.headers['etag']).toBeDefined();
    expect(res.headers['etag']).toMatch(/^"[a-f0-9]+"/);
    expect(res.headers['cache-control']).toContain('max-age=60');
    expect(res.headers['cache-control']).toContain('must-revalidate');
    
    const body = res.json();
    expect(body.max_nodes).toBeGreaterThan(0);
    expect(body.max_edges).toBeGreaterThan(0);
  });

  it('second request with If-None-Match returns 304', async () => {
    // First request to get ETag
    const res1 = await app.inject({ method: 'GET', url: '/v1/limits' });
    const etag = res1.headers['etag'];
    expect(etag).toBeDefined();
    
    // Second request with If-None-Match
    const res2 = await app.inject({
      method: 'GET',
      url: '/v1/limits',
      headers: { 'if-none-match': etag as string }
    });
    
    expect(res2.statusCode).toBe(304);
    expect(res2.headers['etag']).toBe(etag);
    expect(res2.body).toBe(''); // 304 has no body
  });

  it('request with wrong ETag returns 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/limits',
      headers: { 'if-none-match': '"wrong-etag"' }
    });
    
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.max_nodes).toBeDefined();
  });

  it('ETag is stable across requests', async () => {
    const res1 = await app.inject({ method: 'GET', url: '/v1/limits' });
    const res2 = await app.inject({ method: 'GET', url: '/v1/limits' });
    
    expect(res1.headers['etag']).toBe(res2.headers['etag']);
  });

  it('does not have no-store in Cache-Control', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/limits' });
    
    const cacheControl = res.headers['cache-control'];
    expect(cacheControl).toBeDefined();
    expect(cacheControl).not.toContain('no-store');
  });
});
