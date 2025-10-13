import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import http from 'http';
import { createServer } from '../src/createServer.js';

let app: FastifyInstance;
let port = 0;
const prevs: Record<string, string | undefined> = {
  TEST_ROUTES: process.env.TEST_ROUTES,
  AUTH_ENABLED: process.env.AUTH_ENABLED,
  SSE_PER_IP_MAX: process.env.SSE_PER_IP_MAX,
  SSE_GLOBAL_MAX: process.env.SSE_GLOBAL_MAX,
};

beforeAll(async () => {
  process.env.TEST_ROUTES = '1';
  process.env.AUTH_ENABLED = '0';
  process.env.SSE_PER_IP_MAX = '1';
  process.env.SSE_GLOBAL_MAX = '100';
  app = await createServer({ enableTestRoutes: true });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  port = typeof addr === 'object' && addr ? (addr.port as number) : 0;
});

afterAll(async () => {
  await app.close();
  for (const k of Object.keys(prevs)) {
    const v = (prevs as any)[k];
    if (v === undefined) delete (process.env as any)[k]; else (process.env as any)[k] = v;
  }
});

describe('SSE limiter release on early close', () => {
  it('releases per-ip slot after abrupt client close', async () => {
    // Start a stream and abort after first chunk
    await new Promise<void>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}/v1/stream?latency_ms=50`, res => {
        expect(res.statusCode).toBe(200);
        expect(String(res.headers['content-type'])).toContain('text/event-stream');
        let seen = false;
        res.on('data', () => {
          if (!seen) {
            seen = true;
            try { req.destroy(); } catch {}
            resolve();
          }
        });
      });
      req.on('error', () => resolve()); // treat as closed
      setTimeout(() => reject(new Error('timeout open')), 3000);
    });

    // Small wait to allow server to process close
    await new Promise(r => setTimeout(r, 80));

    // Should be able to acquire slot again immediately (SSE_PER_IP_MAX=1)
    await new Promise<void>((resolve, reject) => {
      const req2 = http.get(`http://127.0.0.1:${port}/v1/stream?latency_ms=0`, res => {
        try {
          expect(res.statusCode).toBe(200);
          expect(String(res.headers['content-type'])).toContain('text/event-stream');
          res.resume();
          res.on('end', resolve);
        } catch (e) { reject(e); }
      });
      req2.on('error', reject);
      setTimeout(() => reject(new Error('timeout reacquire')), 3000);
    });
  });
});
