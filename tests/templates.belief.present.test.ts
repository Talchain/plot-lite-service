import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

describe('Templates v1.2', () => {
  let app: FastifyInstance;
  let port: number;

  beforeAll(async () => {
    delete process.env.AUTH_ENABLED;
    app = await createServer({});
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterAll(async () => {
    await app.close();
  });

  it('templates have version 1.2 and belief on edges', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/templates/small/graph`);
    const g = await res.json();
    expect(g.version).toBe('1.2');
    expect(g.default_seed).toBeGreaterThan(0);
    expect(g.edges[0].belief).toBeGreaterThanOrEqual(0);
    expect(g.edges[0].belief).toBeLessThanOrEqual(1);
  });
});
