/**
 * Phase 2: Constraints clarity tests
 * Proves /v1/run validates only, /v1/optimise applies
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Constraints clarity', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer({ profile: 'fallback' }); });
  afterAll(async () => { await server.kill(); });

  const testGraph = {
    nodes: [
      { id: 'A', label: 'Node A', belief: 0.5 },
      { id: 'B', label: 'Node B' }
    ],
    edges: [{ id: 'e1', from: 'A', to: 'B', weight: 0.7 }]
  };

  describe('/v1/run: validates only (does not apply)', () => {
    it('accepts valid constraints without applying them', async () => {
      const res = await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: testGraph,
          constraints: { bounds: { A: { min: 0, max: 1 } } },
          seed: 4242
        })
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.schema).toBe('run.v1');
      // Constraints are validated but not applied - results should be same as without constraints
    });

    it('results unchanged with/without valid constraints (same seed)', async () => {
      // Run without constraints
      const res1 = await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: testGraph,
          seed: 4242
        })
      });
      const body1 = await res1.json();

      // Run with valid constraints
      const res2 = await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: testGraph,
          constraints: { bounds: { A: { min: 0, max: 1 } } },
          seed: 4242
        })
      });
      const body2 = await res2.json();

      // Same seed, same results (constraints not applied)
      expect(body1.model_card.response_hash).toBe(body2.model_card.response_hash);
    });

    it('rejects constraints with violated bounds', async () => {
      const res = await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: {
            nodes: [{ id: 'A', label: 'Node A', value: 5.0 }],
            edges: []
          },
          constraints: { bounds: { A: { min: 0, max: 1 } } },
          seed: 4242
        })
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.type).toBe('BAD_INPUT');
      expect(body.error.message).toMatch(/violates.*bound/i);
    });

    it('rejects constraints with non-existent node', async () => {
      const res = await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: testGraph,
          constraints: { bounds: { NonExistent: { min: 0, max: 1 } } },
          seed: 4242
        })
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.type).toBe('BAD_INPUT');
      expect(body.error.message).toMatch(/non-existent node/i);
    });
  });

  describe('/v1/optimise: applies constraints deterministically', () => {
    it('applies must constraint and includes meta.constraints_applied', async () => {
      const res = await fetch(`${server.baseUrl}/v1/optimise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: testGraph,
          budget: 100,
          actions: [
            { id: 'a1', cost: 50, do: [] },
            { id: 'a2', cost: 40, do: [] }
          ],
          objective: { type: 'utility_linear', weights: { B: 1.0 } },
          constraints: { must: ['a1'] },
          seed: 4242
        })
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.selected).toContain('a1');
      expect(body.meta.constraints_applied).toContain('must');
      expect(body.meta.constraints_resolved).toBeDefined();
    });

    it('applies must_not constraint and includes meta.constraints_applied', async () => {
      const res = await fetch(`${server.baseUrl}/v1/optimise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: testGraph,
          budget: 100,
          actions: [
            { id: 'a1', cost: 30, do: [] },
            { id: 'a2', cost: 40, do: [] }
          ],
          objective: { type: 'utility_linear', weights: { B: 1.0 } },
          constraints: { must_not: ['a2'] },
          seed: 4242
        })
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.selected).not.toContain('a2');
      expect(body.meta.constraints_applied).toContain('must_not');
    });

    it('includes constraints_note in model_card', async () => {
      const res = await fetch(`${server.baseUrl}/v1/optimise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: testGraph,
          budget: 100,
          actions: [{ id: 'a1', cost: 50, do: [] }],
          objective: { type: 'utility_linear', weights: { B: 1.0 } },
          constraints: { must: ['a1'] },
          seed: 4242
        })
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.model_card.constraints_note).toBeDefined();
      expect(body.model_card.constraints_note).toMatch(/must/i);
    });

    it('constraints_note mentions no constraints when only budget present', async () => {
      const res = await fetch(`${server.baseUrl}/v1/optimise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: testGraph,
          budget: 100,
          actions: [{ id: 'a1', cost: 50, do: [] }],
          objective: { type: 'utility_linear', weights: { B: 1.0 } },
          seed: 4242
        })
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.model_card.constraints_note).toBeDefined();
      expect(body.model_card.constraints_note).toMatch(/no constraints.*beyond budget/i);
    });

    it('rejects infeasible must constraint with 400 and violations', async () => {
      const res = await fetch(`${server.baseUrl}/v1/optimise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: testGraph,
          budget: 10,
          actions: [{ id: 'a1', cost: 50, do: [] }],
          objective: { type: 'utility_linear', weights: { B: 1.0 } },
          constraints: { must: ['a1'] }
        })
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('INFEASIBLE');
      expect(body.error.violations).toBeDefined();
      expect(body.error.violations.length).toBeGreaterThan(0);
    });

    it('rejects conflicting must/must_not with 400 and hint', async () => {
      const res = await fetch(`${server.baseUrl}/v1/optimise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: testGraph,
          budget: 100,
          actions: [{ id: 'a1', cost: 50, do: [] }],
          objective: { type: 'utility_linear', weights: { B: 1.0 } },
          constraints: { must: ['a1'], must_not: ['a1'] }
        })
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('INFEASIBLE');
      expect(body.error.violations[0].type).toBe('CONFLICTING_CONSTRAINTS');
    });

    it('deterministic: same constraints + seed = same selection', async () => {
      const payload = {
        graph: testGraph,
        budget: 100,
        actions: [
          { id: 'a1', cost: 30, do: [] },
          { id: 'a2', cost: 40, do: [] },
          { id: 'a3', cost: 50, do: [] }
        ],
        objective: { type: 'utility_linear', weights: { B: 1.0 } },
        constraints: { must: ['a1'], must_not: ['a3'] },
        seed: 4242
      };

      const res1 = await fetch(`${server.baseUrl}/v1/optimise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const body1 = await res1.json();

      const res2 = await fetch(`${server.baseUrl}/v1/optimise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const body2 = await res2.json();

      // Same seed + constraints = identical selection
      expect(body1.selected).toEqual(body2.selected);
      expect(body1.model_card.response_hash).toBe(body2.model_card.response_hash);
    });
  });
});
