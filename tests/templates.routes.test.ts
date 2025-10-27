import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

describe('Templates routes (read-only)', () => {
  let app: FastifyInstance;
  let port: number;

  beforeAll(async () => {
    delete process.env.AUTH_ENABLED; // ensure routes are open for tests
    app = await createServer({ enableTestRoutes: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/templates returns a catalog array', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/templates`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(3);
    const item = data[0];
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('label');
    expect(item).toHaveProperty('summary');
    expect(item).toHaveProperty('updated_at');
  });

  it('GET /v1/templates/small/graph returns a graph', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/templates/small/graph`);
    expect(res.status).toBe(200);
    const g = await res.json();
    expect(g).toHaveProperty('nodes');
    expect(g).toHaveProperty('edges');
    expect(Array.isArray(g.nodes)).toBe(true);
    expect(Array.isArray(g.edges)).toBe(true);
  });

  it('GET /v1/templates/does-not-exist/graph returns 404 error.v1', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/templates/does-not-exist/graph`);
    expect(res.status).toBe(404);
    const err = await res.json();
    expect(err.schema).toBe('error.v1');
    expect(err.code).toBe('NOT_FOUND');
    expect(typeof err.message).toBe('string');
  });
});
