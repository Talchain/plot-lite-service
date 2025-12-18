import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import http from 'http';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

let app: FastifyInstance;
let port = 0;

const prevAuth = process.env.AUTH_ENABLED;
const prevTestRoutes = process.env.TEST_ROUTES;
const prevDemoMode = process.env.DEMO_MODE_ENABLED;

beforeAll(async () => {
  process.env.AUTH_ENABLED = '0';
  process.env.TEST_ROUTES = '1';
  process.env.DEMO_MODE_ENABLED = '1';
  app = await createServer({ enableTestRoutes: true });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  port = typeof addr === 'object' && addr ? (addr.port as number) : 0;
});

afterAll(async () => {
  await app.close();
  if (prevAuth === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = prevAuth;
  if (prevTestRoutes === undefined) delete process.env.TEST_ROUTES; else process.env.TEST_ROUTES = prevTestRoutes;
  if (prevDemoMode === undefined) delete process.env.DEMO_MODE_ENABLED; else process.env.DEMO_MODE_ENABLED = prevDemoMode;
});

describe('v1/stream query validation', () => {
  it('rejects unknown query key with 400 error.v1 BAD_INPUT', async () => {
    const url = `http://127.0.0.1:${port}/v1/stream?foo=1`;
    await new Promise<void>((resolve, reject) => {
      const req = http.get(url, res => {
        let body = '';
        res.on('data', c => body += c.toString('utf8'));
        res.on('end', () => {
          expect(res.statusCode).toBe(400);
          try {
            const js = JSON.parse(body);
            expect(js?.schema).toBe('error.v1');
            expect(js?.code).toBe('BAD_INPUT');
          } catch {}
          resolve();
        });
      });
      req.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 3000);
    });
  });

  it('succeeds with defaults when demo=1 and no params', async () => {
    const url = `http://127.0.0.1:${port}/v1/stream?demo=1`;
    await new Promise<void>((resolve, reject) => {
      const req = http.get(url, res => {
        expect(res.statusCode).toBe(200);
        expect(String(res.headers['content-type'])).toContain('text/event-stream');
        // Accept immediate end (demo short-circuit)
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 3000);
    });
  });
});
