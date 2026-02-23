import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Idempotency-Key - Real Tests', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer({ env: { IDEMPOTENCY_ENABLE: '1' } }); });
  afterAll(async () => { await server.kill(); });

  describe('/v1/intervene', () => {
    it('caches response with Idempotency-Key', async () => {
      const idempotencyKey = `intervene-${Date.now()}`;
      const payload = {
        graph: {
          nodes: [{ id: 'X', label: 'X' }],
          edges: []
        },
        do: [{ node_id: 'X', set_to: 1.0 }],
        seed: 4242
      };

      // First request
      const res1 = await fetch(`${server.baseUrl}/v1/intervene`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(payload)
      });

      expect(res1.status).toBe(200);
      const data1 = await res1.json();
      expect(data1.schema).toBe('intervene.v1');

      // Second request with same key - should get cached response
      const res2 = await fetch(`${server.baseUrl}/v1/intervene`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(payload)
      });

      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      
      // Should be identical
      expect(data2).toEqual(data1);
    });

    it('clears inflight key on 400', async () => {
      const idempotencyKey = `intervene-400-${Date.now()}`;
      
      const res = await fetch(`${server.baseUrl}/v1/intervene`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({
          graph: { nodes: [], edges: [] },
          do: [{ node_id: 'NONEXISTENT', set_to: 1.0 }]
        })
      });

      expect(res.status).toBe(400);
      
      // Key should be cleared, not cached
      const res2 = await fetch(`${server.baseUrl}/v1/intervene`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({
          graph: { nodes: [], edges: [] },
          do: [{ node_id: 'NONEXISTENT', set_to: 1.0 }]
        })
      });

      expect(res2.status).toBe(400);
    });
  });

  describe('/v1/optimise', () => {
    it('caches response with Idempotency-Key', async () => {
      const idempotencyKey = `optimise-${Date.now()}`;
      const payload = {
        graph: {
          nodes: [
            { id: 'Price', label: 'Price' },
            { id: 'Revenue', label: 'Revenue' }
          ],
          edges: [{ from: 'Price', to: 'Revenue', weight: 0.5 }]
        },
        budget: 100,
        actions: [
          { id: 'action1', cost: 50, do: [{ node_id: 'Price', set_to: 0.8 }] }
        ],
        objective: {
          type: 'utility_linear',
          weights: { Revenue: 1.0 }
        },
        seed: 4242
      };

      // First request
      const res1 = await fetch(`${server.baseUrl}/v1/optimise`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(payload)
      });

      expect(res1.status).toBe(200);
      const data1 = await res1.json();
      expect(data1.schema).toBe('optimise.v1');

      // Second request with same key
      const res2 = await fetch(`${server.baseUrl}/v1/optimise`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(payload)
      });

      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2).toEqual(data1);
    });
  });

  describe('/v1/run_bundle', () => {
    it('caches response with Idempotency-Key', async () => {
      const idempotencyKey = `bundle-${Date.now()}`;
      const payload = {
        base_graph: {
          nodes: [{ id: 'A', label: 'A' }],
          edges: []
        },
        deltas: [
          { label: 'S1', nodes: [{ id: 'A', value: 0.5 }] }
        ],
        seed: 4242
      };

      // First request
      const res1 = await fetch(`${server.baseUrl}/v1/run_bundle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(payload)
      });

      expect(res1.status).toBe(200);
      const data1 = await res1.json();
      expect(data1.schema).toBe('run_bundle.v1');

      // Second request with same key
      const res2 = await fetch(`${server.baseUrl}/v1/run_bundle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(payload)
      });

      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2).toEqual(data1);
    });
  });
});
