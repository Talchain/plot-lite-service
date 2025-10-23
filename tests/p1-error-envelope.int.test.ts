import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('P1: error.v1 integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.AUTH_ENABLED = '0';
    process.env.RATE_LIMIT_ENABLE = '1';
    process.env.RATE_LIMIT_MAX = '2';
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    app = await createServer();
    await app.listen({ port: 0 });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('RATE_LIMITED includes retry_after and Retry-After header', async () => {
    const payload = { template: 'test', graph: { nodes: [{ id: '1', label: 'A' }], edges: [] } };
    
    // Exhaust rate limit
    await app.inject({ method: 'POST', url: '/v1/run', payload });
    await app.inject({ method: 'POST', url: '/v1/run', payload });
    
    const res = await app.inject({ method: 'POST', url: '/v1/run', payload });
    
    expect(res.statusCode).toBe(429);
    const body = res.json();
    expect(body.schema).toBe('error.v1');
    expect(body.code).toBe('RATE_LIMITED');
    expect(body.retry_after).toBeGreaterThanOrEqual(1);
    expect(body.retry_after).toBeLessThanOrEqual(60);
    
    const retryAfter = res.headers['retry-after'];
    expect(retryAfter).toBeDefined();
    expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
    
    const resetHeader = res.headers['x-ratelimit-reset'];
    if (resetHeader) {
      const resetEpoch = Number(resetHeader);
      const nowEpoch = Math.floor(Date.now() / 1000);
      expect(resetEpoch).toBeGreaterThan(nowEpoch);
    }
  });

  it('LIMIT_EXCEEDED includes field and max', async () => {
    const payload = {
      template: 'test',
      graph: {
        nodes: Array.from({ length: 15 }, (_, i) => ({ id: String(i), label: `N${i}` })),
        edges: []
      }
    };
    
    const res = await app.inject({ method: 'POST', url: '/v1/run', payload });
    
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.schema).toBe('error.v1');
    expect(body.code).toBe('LIMIT_EXCEEDED');
    expect(body.fields).toBeDefined();
    expect(body.fields.field).toBe('graph.nodes');
    expect(body.fields.max).toBeGreaterThan(0);
  });

  it('BAD_INPUT for invalid payload', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/run', payload: { invalid: true } });
    
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.schema).toBe('error.v1');
    expect(body.code).toBe('BAD_INPUT');
  });
});
