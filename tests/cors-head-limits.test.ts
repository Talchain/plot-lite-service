import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../src/createServer.js';

let app: any;

beforeEach(async () => {
  process.env.CORS_ALLOW_ORIGINS = 'http://localhost:5173';
  app = await createServer();
  await app.ready();
});

afterEach(async () => {
  if (app) await app.close();
  delete process.env.CORS_ALLOW_ORIGINS;
});

describe('CORS + HEAD + Limits', () => {
  it('CORS preflight OPTIONS /v1/run returns proper headers', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/run',
      headers: {
        'origin': 'http://localhost:5173',
        'access-control-request-method': 'POST',
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toContain('Content-Type');
    expect(res.headers['access-control-allow-headers']).toContain('Idempotency-Key');
    expect(res.headers['access-control-expose-headers']).toContain('X-RateLimit-Limit');
    expect(res.headers['access-control-expose-headers']).toContain('Retry-After');
  });

  it('HEAD /v1/run returns 204 with no body', async () => {
    const res = await app.inject({
      method: 'HEAD',
      url: '/v1/run',
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });

  it('GET /v1/limits returns limits.v1 schema with integer fields', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/limits',
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.schema).toBe('limits.v1');
    expect(typeof data.max_nodes).toBe('number');
    expect(typeof data.max_edges).toBe('number');
    expect(typeof data.max_body_kb).toBe('number');
    expect(data.max_nodes).toBeGreaterThanOrEqual(50);
    expect(data.max_edges).toBeGreaterThanOrEqual(200);
  });
});
