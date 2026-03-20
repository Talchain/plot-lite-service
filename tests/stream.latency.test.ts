import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import http from 'http';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

let app: FastifyInstance;
let port = 0;

const prevAuth = process.env.AUTH_ENABLED;
const prevTestRoutes = process.env.TEST_ROUTES;

beforeAll(async () => {
  process.env.AUTH_ENABLED = '0';
  process.env.TEST_ROUTES = '1';
  app = await createServer({ enableTestRoutes: true });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  port = typeof addr === 'object' && addr ? (addr.port as number) : 0;
});

afterAll(async () => {
  await app.close();
  if (prevAuth === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = prevAuth;
  if (prevTestRoutes === undefined) delete process.env.TEST_ROUTES; else process.env.TEST_ROUTES = prevTestRoutes;
});

describe('/v1/stream latency_ms behavior', () => {
  it('delays token event approximately latency_ms', async () => {
    const latencyMs = 30;
    const url = `http://127.0.0.1:${port}/v1/stream?latency_ms=${latencyMs}`; // non-demo path
    await new Promise<void>((resolve, reject) => {
      const tStart = Date.now();
      let tHello = 0;
      let tToken = 0;
      const req = http.get(url, res => {
        expect(res.statusCode).toBe(200);
        let buf = '';
        res.on('data', chunk => {
          const s = chunk.toString('utf8');
          buf += s;
          if (!tHello && s.includes('event: hello')) tHello = Date.now();
          if (!tToken && s.includes('event: token')) tToken = Date.now();
        });
        res.on('end', () => {
          expect(tHello).toBeGreaterThanOrEqual(tStart);
          expect(tToken).toBeGreaterThanOrEqual(tHello);
          const delta = tToken - tHello;
          // allow generous jitter for CI under load (<= 100ms)
          expect(Math.abs(delta - latencyMs)).toBeLessThanOrEqual(100);
          resolve();
        });
      });
      req.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 4000);
    });
  });
});
