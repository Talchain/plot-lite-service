import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

let app: FastifyInstance;
let port = 0;

beforeAll(async () => {
  app = await createServer({ enableTestRoutes: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  port = typeof addr === 'object' && addr ? (addr.port as number) : 0;
});

afterAll(async () => {
  await app.close();
});

describe('Health endpoint exposes idempotency cache size', () => {
  it('includes idem_cache_size as integer >= 0', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/v1/health`);
    expect(r.status).toBe(200);
    
    const health: any = await r.json();
    expect(health).toBeTruthy();
    expect(typeof health.idem_cache_size).toBe('number');
    expect(health.idem_cache_size).toBeGreaterThanOrEqual(0);
  });
});
