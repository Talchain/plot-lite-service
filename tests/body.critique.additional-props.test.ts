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

describe('Body route strictness: /v1/critique', () => {
  it('rejects unknown top-level key with 400 BAD_INPUT', async () => {
    const url = `http://127.0.0.1:${port}/v1/critique`;
    const body = {
      graph: { nodes: [{ id: 'a', label: 'A' }], edges: [] },
      extra: 1,
    };
    await new Promise<void>((resolve, reject) => {
      const req = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
        let buf = '';
        res.on('data', c => (buf += c.toString('utf8')));
        res.on('end', () => {
          expect(res.statusCode).toBe(400);
          try {
            const js = JSON.parse(buf);
            expect(js?.schema).toBe('error.v1');
            expect(js?.code).toBe('BAD_INPUT');
          } catch {}
          resolve();
        });
      });
      req.on('error', reject);
      req.write(JSON.stringify(body));
      req.end();
      setTimeout(() => reject(new Error('timeout')), 5000);
    });
  });
});
