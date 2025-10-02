import { expect, test, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let port: number;

beforeAll(async () => {
  process.env.TEST_ROUTES = '1';
  app = await createServer({ enableTestRoutes: true });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
});

afterAll(async () => {
  await app.close();
  delete process.env.TEST_ROUTES;
});

test('demo SSE emits hello/token/done when TEST_ROUTES=1', async () => {
  const url = `http://127.0.0.1:${port}/demo/stream?scenario=sch1`;
  await new Promise<void>((resolve, reject) => {
    const req = http.get(url, res => {
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/event-stream');
      let buf = '';
      res.on('data', chunk => (buf += chunk.toString('utf8')));
      res.on('end', () => {
        expect(buf).toContain('event: hello');
        expect(buf).toContain('"scenario":"sch1"');
        expect(buf).toContain('event: token');
        expect(buf).toContain('"text":"This"');
        expect(buf).toContain('event: done');
        resolve();
      });
    });
    req.on('error', reject);
    setTimeout(() => reject(new Error('Timeout')), 3000);
  });
});
