import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('Idempotency: Early-Exit Cleanup (P0)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createServer();
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('clears inflight key on 413 body too large', async () => {
    const idk = 'test-413-' + Date.now();
    const largePayload = { graph: { nodes: [], edges: [] }, data: 'x'.repeat(100 * 1024) };

    const res = await app.inject({
      method: 'POST',
      url: '/v1/run',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idk,
      },
      payload: largePayload,
    });

    expect(res.statusCode).toBe(413);

    // Verify key is cleared (not stuck in-flight)
    // Retry with same key should process, not hang
    const validPayload = {
      graph: {
        nodes: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        edges: [{ from: 'a', to: 'b', weight: 1, belief: 0.8 }],
      },
      seed: 42,
      treatment_node: 'a',
      outcome_node: 'b',
    };

    const res2 = await app.inject({
      method: 'POST',
      url: '/v1/run',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idk,
      },
      payload: validPayload,
    });

    // Should process normally (key was cleared, not stuck)
    expect(res2.statusCode).toBe(200);
  });

  it('clears inflight key on 400 graph_too_large', async () => {
    const idk = 'test-400-' + Date.now();
    const largeGraph = {
      graph: {
        nodes: Array.from({ length: 51 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}` })),
        edges: [],
      },
      seed: 42,
    };

    const res = await app.inject({
      method: 'POST',
      url: '/v1/run?scm_lite=1',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idk,
      },
      payload: largeGraph,
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.reason).toBe('graph_too_large');

    // Verify key is cleared (retry with same key processes new request)
    const validPayload = {
      graph: {
        nodes: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        edges: [{ from: 'a', to: 'b', weight: 1, belief: 0.8 }],
      },
      seed: 42,
      treatment_node: 'a',
      outcome_node: 'b',
    };

    const res2 = await app.inject({
      method: 'POST',
      url: '/v1/run?scm_lite=1',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idk,
      },
      payload: validPayload,
    });

    // Should process normally (not return cached 400)
    expect(res2.statusCode).toBe(200);
  });

  it('confirms 429 clears inflight (regression check)', async () => {
    // This was fixed in PR #77, verify it still works
    const idk = 'test-429-' + Date.now();
    
    // Exhaust rate limit
    const requests = [];
    for (let i = 0; i < 100; i++) {
      requests.push(
        app.inject({
          method: 'POST',
          url: '/v1/run',
          headers: { 'Content-Type': 'application/json' },
          payload: {
            graph: {
              nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
              edges: [{ from: 'a', to: 'b', weight: 1, belief: 0.8 }],
            },
            seed: 42 + i,
          },
        })
      );
    }

    const responses = await Promise.all(requests);
    const has429 = responses.some(r => r.statusCode === 429);
    expect(has429).toBe(true);

    // Verify a 429 with idempotency key clears inflight
    const res429 = await app.inject({
      method: 'POST',
      url: '/v1/run',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idk,
      },
      payload: {
        graph: {
          nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
          edges: [{ from: 'a', to: 'b', weight: 1, belief: 0.8 }],
        },
        seed: 42,
      },
    });

    expect(res429.statusCode).toBe(429);

    // Wait for rate limit to reset
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Retry with same key should work
    const res2 = await app.inject({
      method: 'POST',
      url: '/v1/run',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idk,
      },
      payload: {
        graph: {
          nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
          edges: [{ from: 'a', to: 'b', weight: 1, belief: 0.8 }],
        },
        seed: 42,
      },
    });

    expect([200, 429]).toContain(res2.statusCode);
  });
});
