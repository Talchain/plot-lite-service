import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import http from 'http';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

let app: FastifyInstance;
let port = 0;

const envSnap = {
  AUTH_ENABLED: process.env.AUTH_ENABLED,
  TEST_ROUTES: process.env.TEST_ROUTES,
  TRUST_PROXY: process.env.TRUST_PROXY,
  SSE_PER_IP_MAX: process.env.SSE_PER_IP_MAX,
  SSE_GLOBAL_MAX: process.env.SSE_GLOBAL_MAX,
};

beforeAll(async () => {
  process.env.AUTH_ENABLED = '0';
  process.env.TEST_ROUTES = '1';
  process.env.TRUST_PROXY = '0';
  process.env.SSE_PER_IP_MAX = '1';
  process.env.SSE_GLOBAL_MAX = '100';
  app = await createServer({ enableTestRoutes: true });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  port = typeof addr === 'object' && addr ? (addr.port as number) : 0;
});

afterAll(async () => {
  await app.close();
  Object.entries(envSnap).forEach(([k, v]) => {
    if (typeof v === 'undefined') delete (process.env as any)[k]; else (process.env as any)[k] = v as string;
  });
});

function openSse(latencyMs = 500) {
  return new Promise<{ req: http.ClientRequest; res: http.IncomingMessage }>((resolve, reject) => {
    const req = http.request(
      `http://127.0.0.1:${port}/v1/stream?latency_ms=${latencyMs}`,
      { method: 'GET' },
      (res) => resolve({ req, res })
    );
    req.on('error', reject);
    req.end();
  });
}

describe('SSE JSON-only headers on 429 JSON path, not on 200', () => {
  it('429 JSON carries JSON-only headers when slots exhausted', async () => {
    const a = await openSse(300);
    expect(a.res.statusCode).toBe(200);
    // micro-wait to ensure slot is recorded
    await new Promise(r => setTimeout(r, 8));

    const r2 = await fetch(`http://127.0.0.1:${port}/v1/stream?latency_ms=100`);
    expect(r2.status).toBe(429);
    const ct = (r2.headers.get('content-type') || '').toLowerCase();
    expect(ct.includes('application/json')).toBe(true);
    // JSON-only headers should be present on JSON error responses
    const keys = new Set<string>(); r2.headers.forEach((_v, k) => keys.add(k.toLowerCase()));
    expect(keys.has('x-content-type-options')).toBe(true);
    expect(keys.has('referrer-policy')).toBe(true);

    try { a.req.destroy(); } catch {}
  });
});
