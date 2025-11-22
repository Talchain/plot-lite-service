import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

let app: FastifyInstance;
let port = 0;
const prev = { AUTH_ENABLED: process.env.AUTH_ENABLED, AUTH_TOKEN: process.env.AUTH_TOKEN, RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED };

beforeAll(async () => {
  process.env.AUTH_ENABLED = '1';
  process.env.AUTH_TOKEN = 'test-secret-token-12345';
  process.env.RATE_LIMIT_ENABLED = '0';
  app = await createServer({ enableTestRoutes: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  port = typeof addr === 'object' && addr ? (addr.port as number) : 0;
});

afterAll(async () => {
  await app.close();
  Object.assign(process.env, prev);
});

describe('Timing-safe auth', () => {
  const BASE = () => `http://127.0.0.1:${port}`;

  it('401 when no bearer token', async () => {
    const r = await fetch(`${BASE()}/v1/health`);
    expect(r.status).toBe(401);
  });

  it('403 when wrong length', async () => {
    const r = await fetch(`${BASE()}/v1/health`, { headers: { Authorization: 'Bearer short' } });
    expect(r.status).toBe(403);
  });

  it('403 when equal length but wrong bytes', async () => {
    const r = await fetch(`${BASE()}/v1/health`, { headers: { Authorization: 'Bearer wrong-secret-token-1234' } });
    expect(r.status).toBe(403);
  });

  it('200 when valid token', async () => {
    const r = await fetch(`${BASE()}/v1/health`, { headers: { Authorization: 'Bearer test-secret-token-12345' } });
    expect(r.status).toBe(200);
  });
});
