import { beforeAll, afterAll, describe, it, expect } from 'vitest';
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
  process.env.TRUST_PROXY = '1';
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

function openSse(xff: string, latencyMs = 500) {
  return new Promise<{ req: http.ClientRequest; res: http.IncomingMessage }>((resolve, reject) => {
    const req = http.request(
      `http://127.0.0.1:${port}/v1/stream?latency_ms=${latencyMs}`,
      { method: 'GET', headers: { 'X-Forwarded-For': xff } },
      (res) => resolve({ req, res })
    );
    req.on('error', reject);
    req.end();
  });
}

describe('trust-proxy IP limiting sanity', () => {
  it('honors per-IP caps via X-Forwarded-For when TRUST_PROXY=1 and releases on disconnect', async () => {
    // two distinct IPs should be allowed (cap=1)
    const a = await openSse('1.1.1.1', 500);
    const b = await openSse('2.2.2.2', 500);
    expect(a.res.statusCode).toBe(200);
    expect(b.res.statusCode).toBe(200);

    // small delay to avoid racing fallback release timer
    await new Promise(r => setTimeout(r, 8));
    // third from same IP A should be limited
    const third = await new Promise<{ code: number }>((resolve) => {
      const r = http.request(
        `http://127.0.0.1:${port}/v1/stream?latency_ms=500`,
        { method: 'GET', headers: { 'X-Forwarded-For': '1.1.1.1' } },
        (res) => resolve({ code: res.statusCode || 0 })
      );
      r.on('error', () => resolve({ code: 0 }));
      r.end();
    });
    expect(third.code).toBe(429);

    // cleanup the first two sockets
    try { a.req.destroy(); } catch {}
    try { b.req.destroy(); } catch {}

    // after release, requests from A should be allowed again
    await new Promise(r => setTimeout(r, 50));
    const after = await openSse('1.1.1.1', 50);
    expect(after.res.statusCode).toBe(200);
    try { after.req.destroy(); } catch {}
  }, 8000);
});
