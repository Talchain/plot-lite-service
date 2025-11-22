import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

let app: FastifyInstance;
let port = 0;
const prevAuth = process.env.AUTH_ENABLED;
const prevTestRoutes = process.env.TEST_ROUTES;
const prevEnv = process.env.ENVIRONMENT;
const prevBuildShort = process.env.BUILD_ID_SHORT;

beforeAll(async () => {
  process.env.AUTH_ENABLED = '0';
  process.env.TEST_ROUTES = '1';
  process.env.ENVIRONMENT = 'staging';
  process.env.BUILD_ID_SHORT = 'abc1234';
  app = await createServer({ enableTestRoutes: true });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  port = typeof addr === 'object' && addr ? (addr.port as number) : 0;
});

afterAll(async () => {
  await app.close();
  if (prevAuth === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = prevAuth;
  if (prevTestRoutes === undefined) delete process.env.TEST_ROUTES; else process.env.TEST_ROUTES = prevTestRoutes;
  if (prevEnv === undefined) delete process.env.ENVIRONMENT; else process.env.ENVIRONMENT = prevEnv;
  if (prevBuildShort === undefined) delete process.env.BUILD_ID_SHORT; else process.env.BUILD_ID_SHORT = prevBuildShort;
});

describe('/v1/health environment & build enrichment', () => {
  it('exposes environment and build when provided via env', async () => {
    const h = await fetch(`http://127.0.0.1:${port}/v1/health`).then(r => r.json());
    expect(h.status).toBe('ok');
    expect(h.environment).toBe('staging');
    expect(h.build).toBe('abc1234');
  });
});
