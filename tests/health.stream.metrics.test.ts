import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import http from 'http';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';
import { resetStreamMetrics } from '../src/metrics.js';

let app: FastifyInstance;
let port = 0;

const prevAuth = process.env.AUTH_ENABLED;
const prevTestRoutes = process.env.TEST_ROUTES;
const prevCap = process.env.SSE_PER_IP_MAX;

async function openSse(path: string, headers?: Record<string, string>) {
  return new Promise<{ req: http.ClientRequest; res: http.IncomingMessage }>((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, headers }, (res) => resolve({ req, res }));
    req.on('error', reject);
  });
}

async function getHealth(): Promise<any> {
  return fetch(`http://127.0.0.1:${port}/v1/health`).then(r => r.json());
}

beforeAll(async () => {
  process.env.AUTH_ENABLED = '0';
  process.env.TEST_ROUTES = '1';
  process.env.SSE_PER_IP_MAX = '1';
  app = await createServer({ enableTestRoutes: true });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  port = typeof addr === 'object' && addr ? (addr.port as number) : 0;
});

afterAll(async () => {
  await app.close();
  if (prevAuth === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = prevAuth;
  if (prevTestRoutes === undefined) delete process.env.TEST_ROUTES; else process.env.TEST_ROUTES = prevTestRoutes;
  if (prevCap === undefined) delete process.env.SSE_PER_IP_MAX; else process.env.SSE_PER_IP_MAX = prevCap;
});

describe('/v1/health optional stream metrics', () => {
  beforeEach(() => { resetStreamMetrics(); });
  it('omits optional keys initially, then includes once observed', async () => {
    // Initial health: optional keys should be absent
    const h0 = await getHealth();
    expect(h0.status).toBe('ok');
    expect('stream_rate_limited' in h0).toBe(false);
    expect('stream_disconnects' in h0).toBe(false);

    // Open first stream (hold the slot deterministically)
    const s1 = await openSse('/v1/stream?latency_ms=2000');
    expect(s1.res.statusCode).toBe(200);

    // Second stream should hit per-IP limiter (cap=1)
    const s2 = await openSse('/v1/stream?latency_ms=2000');
    expect(s2.res.statusCode).toBe(429);

    // Close first stream to record disconnect
    try { s1.req.destroy(); } catch {}

    // Fetch health again (poll until disconnect observed to avoid race)
    let h1 = await getHealth();
    for (let i = 0; i < 20 && !('stream_disconnects' in h1); i++) {
      await new Promise(r => setTimeout(r, 100));
      h1 = await getHealth();
    }
    expect(h1.status).toBe('ok');
    expect(typeof h1.stream_rate_limited === 'number').toBe(true);
    expect(h1.stream_rate_limited).toBeGreaterThanOrEqual(1);
    expect(typeof h1.stream_disconnects === 'number').toBe(true);
    expect(h1.stream_disconnects).toBeGreaterThanOrEqual(1);
    if ('stream_write_backpressure' in h1) {
      expect(typeof h1.stream_write_backpressure === 'number').toBe(true);
      expect(h1.stream_write_backpressure).toBeGreaterThanOrEqual(0);
    }
  }, 10000);
});
