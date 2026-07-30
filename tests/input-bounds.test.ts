/**
 * Input Bounds Validation Tests - Track B
 * 
 * Verifies that API routes enforce strict input limits defined in OpenAPI:
 * - maxLength on strings
 * - maxItems on arrays
 * - min/max on numbers
 * 
 * Expected behavior: 400 BAD_INPUT for violations, not runtime errors.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('Input Bounds Validation (Track B)', () => {
  let app: FastifyInstance;
  let port: number;

  beforeAll(async () => {
    app = await createServer({ enableTestRoutes: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('/v1/run bounds', () => {
    it('rejects graph with >200 nodes', async () => {
      const oversizedGraph = {
        nodes: Array.from({ length: 201 }, (_, i) => ({
          id: `node${i}`,
          label: `Node ${i}`,
          type: 'decision',
        })),
        edges: [{ from: 'node0', to: 'node1' }],
      };

      const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: oversizedGraph }),
      });

      // Should reject with 400, not 500
      expect([400, 413]).toContain(res.status);
    });

    it('rejects k_samples > 10000', async () => {
      const validGraph = {
        nodes: [
          { id: 'a', label: 'A', type: 'decision' },
          { id: 'b', label: 'B', type: 'outcome' },
        ],
        edges: [{ from: 'a', to: 'b' }],
      };

      const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: validGraph, k_samples: 100000 }),
      });

      // The runtime cost governor may kick in with specific error
      expect([400, 413]).toContain(res.status);
    });

    it('rejects node.id > 100 chars', async () => {
      const longId = 'x'.repeat(101);
      const invalidGraph = {
        nodes: [
          { id: longId, label: 'Test', type: 'decision' },
          { id: 'b', label: 'B', type: 'outcome' },
        ],
        edges: [{ from: longId, to: 'b' }],
      };

      const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: invalidGraph }),
      });

      // Ajv validation should enforce 400/413 for oversized id
      expect([400, 413]).toContain(res.status);
    });

    it('accepts valid graph within bounds', async () => {
      const validGraph = {
        nodes: [
          { id: 'start', label: 'Start', type: 'decision' },
          { id: 'end', label: 'End', type: 'outcome' },
        ],
        edges: [{ from: 'start', to: 'end' }],
      };

      const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: validGraph, seed: 42, k_samples: 1000 }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.schema).toBe('run.v1');
    });
  });

  describe('/v1/counterfactual bounds — WITHDRAWN (ROADMAP 2.105)', () => {
    // The two cases here asserted a 400/413 for an out-of-range intervention and
    // a 200 for an in-range one. Both are now unreachable BY DESIGN: the route is
    // withdrawn and refuses before validation runs, because no input is valid for
    // a capability that does not exist and a 400 would imply a good body would
    // have been answered. The Ajv schema was deleted with the route.
    //
    // Kept as a single case rather than deleted, so the bounds surface cannot be
    // quietly resurrected without someone reading this.
    it('refuses BOTH in-range and out-of-range interventions with the same 501', async () => {
      const validGraph = {
        nodes: [
          { id: 'price', label: 'Price', type: 'decision' },
          { id: 'revenue', label: 'Revenue', type: 'outcome' },
        ],
        edges: [{ from: 'price', to: 'revenue' }],
      };
      const post = (to_value: number) =>
        fetch(`http://127.0.0.1:${port}/v1/counterfactual`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            graph: validGraph,
            intervention: { node_id: 'price', from_value: 100, to_value },
            outcome_node: 'revenue',
            seed: 42,
          }),
        });

      const inRange = await post(120);
      const outOfRange = await post(10000000); // 10M, formerly over the 1M bound

      expect(inRange.status).toBe(501);
      expect(outOfRange.status).toBe(501);
      expect((await inRange.json()).code).toBe('ANALYSIS_UNAVAILABLE');
      expect((await outOfRange.json()).code).toBe('ANALYSIS_UNAVAILABLE');
    });
  });

  describe('/v1/critique bounds', () => {
    it('rejects >20 assumptions', async () => {
      const validGraph = {
        nodes: [
          { id: 'a', label: 'A', type: 'decision' },
          { id: 'b', label: 'B', type: 'outcome' },
        ],
        edges: [{ from: 'a', to: 'b' }],
      };

      const tooManyAssumptions = Array.from({ length: 21 }, (_, i) => `Assumption ${i}`);

      const res = await fetch(`http://127.0.0.1:${port}/v1/critique`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: validGraph,
          assumptions: tooManyAssumptions,
        }),
      });

      // Should reject with 400
      expect([400, 413]).toContain(res.status);
    });

    it('accepts valid critique request', async () => {
      const validGraph = {
        nodes: [
          { id: 'treatment', label: 'Treatment', type: 'decision' },
          { id: 'outcome', label: 'Outcome', type: 'outcome' },
        ],
        edges: [{ from: 'treatment', to: 'outcome' }],
      };

      const res = await fetch(`http://127.0.0.1:${port}/v1/critique`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: validGraph,
          assumptions: ['Linear relationship', 'No confounding'],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.schema).toBe('critique.v1');
    });
  });

  describe('/v1/draft bounds', () => {
    it('rejects description >500 chars', async () => {
      const longDescription = 'a'.repeat(501);

      const res = await fetch(`http://127.0.0.1:${port}/v1/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: longDescription }),
      });

      // Should reject with 400
      expect([400, 413]).toContain(res.status);
    });

    it('accepts valid draft request', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: 'Optimize subscription pricing',
          domain: 'pricing',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.schema).toBe('draft.v1');
    });
  });

  describe('Numeric boundary edge cases', () => {
    it('accepts seed at maximum (2^31 - 1)', async () => {
      const validGraph = {
        nodes: [
          { id: 'a', label: 'A', type: 'decision' },
          { id: 'b', label: 'B', type: 'outcome' },
        ],
        edges: [{ from: 'a', to: 'b' }],
      };

      const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: validGraph, seed: 2147483647 }),
      });

      expect(res.status).toBe(200);
    });

    it('accepts k_samples at minimum (100)', async () => {
      const validGraph = {
        nodes: [
          { id: 'a', label: 'A', type: 'decision' },
          { id: 'b', label: 'B', type: 'outcome' },
        ],
        edges: [{ from: 'a', to: 'b' }],
      };

      const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: validGraph, k_samples: 100 }),
      });

      expect(res.status).toBe(200);
    });
  });
});
