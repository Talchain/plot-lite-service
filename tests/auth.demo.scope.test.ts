import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import http from 'http';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

let app: FastifyInstance;
let port = 0;

const prevAuth = process.env.AUTH_ENABLED;
const prevTestRoutes = process.env.TEST_ROUTES;

beforeAll(async () => {
  process.env.AUTH_ENABLED = '1';
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

describe('Auth × Demo scope', () => {
  it('GET /v1/stream?demo=1 bypasses auth (200 SSE)', async () => {
    const url = `http://127.0.0.1:${port}/v1/stream?demo=1`;
    await new Promise<void>((resolve, reject) => {
      const req = http.get(url, res => {
        expect(res.statusCode).toBe(200);
        expect(String(res.headers['content-type'])).toContain('text/event-stream');
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 5000);
    });
  });

  it('GET /v1/stream?demo=true bypasses auth (200 SSE)', async () => {
    const url = `http://127.0.0.1:${port}/v1/stream?demo=true`;
    await new Promise<void>((resolve, reject) => {
      const req = http.get(url, res => {
        expect(res.statusCode).toBe(200);
        expect(String(res.headers['content-type'])).toContain('text/event-stream');
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 5000);
    });
  });

  it('POST /v1/run?demo=1 requires auth (401 or 403 error.v1)', async () => {
    const url = `http://127.0.0.1:${port}/v1/run?demo=1`;
    await new Promise<void>((resolve, reject) => {
      const req = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
        expect([401, 403]).toContain(res.statusCode || 0);
        let body = '';
        res.on('data', c => (body += c.toString('utf8')));
        res.on('end', () => {
          try {
            const js = JSON.parse(body);
            expect(js?.schema).toBe('error.v1');
            expect(['UNAUTHORIZED', 'FORBIDDEN']).toContain(js?.code);
          } catch {}
          resolve();
        });
      });
      req.on('error', reject);
      req.write(JSON.stringify({ graph: { nodes: [{ id: 'a', label: 'A' }], edges: [] } }));
      req.end();
      setTimeout(() => reject(new Error('timeout')), 5000);
    });
  });

  it('POST /v1/run?demo=true requires auth (401 or 403 error.v1)', async () => {
    const url = `http://127.0.0.1:${port}/v1/run?demo=true`;
    await new Promise<void>((resolve, reject) => {
      const req = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
        expect([401, 403]).toContain(res.statusCode || 0);
        let body = '';
        res.on('data', c => (body += c.toString('utf8')));
        res.on('end', () => {
          try {
            const js = JSON.parse(body);
            expect(js?.schema).toBe('error.v1');
            expect(['UNAUTHORIZED', 'FORBIDDEN']).toContain(js?.code);
          } catch {}
          resolve();
        });
      });
      req.on('error', reject);
      req.write(JSON.stringify({ graph: { nodes: [{ id: 'a', label: 'A' }], edges: [] } }));
      req.end();
      setTimeout(() => reject(new Error('timeout')), 5000);
    });
  });
});
