import { beforeAll, afterAll, describe, it, expect } from 'vitest';
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

describe('/v1/health enrichment', () => {
  it('includes optional version, uptime_s, and last_request_at fields', async () => {
    const h = await fetch(`http://127.0.0.1:${port}/v1/health`).then(r => r.json());
    expect(h.status).toBe('ok');
    // fields are additive and optional; when present, types must match
    if ('version' in h) expect(typeof h.version).toBe('string');
    if ('uptime_s' in h) expect(typeof h.uptime_s).toBe('number');
    if ('last_request_at' in h) expect(typeof h.last_request_at).toBe('string');
  });
});
