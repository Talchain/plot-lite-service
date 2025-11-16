/**
 * Constraints edge cases and negative paths
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Constraints edge cases', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer({ profile: 'fallback' }); });
  afterAll(async () => { await server.kill(); });

  const minimalGraph = {
    nodes: [
      { id: 'A', label: 'Node A', belief: 0.5 },
      { id: 'B', label: 'Node B' }
    ],
    edges: [{ id: 'e1', from: 'A', to: 'B', weight: 0.7 }]
  };

  it('/v1/run: rejects malformed constraints (not an object)', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        constraints: 'not-an-object'
      })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.type).toBe('BAD_INPUT');
  });

  it('/v1/run: accepts empty constraints object', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        constraints: {},
        seed: 4242
      })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schema).toBe('run.v1');
  });

  it('/v1/optimise: rejects constraints with unknown action IDs in must', async () => {
    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        budget: 100,
        actions: [{ id: 'a1', cost: 50, do: [] }],
        objective: { type: 'utility_linear', weights: {} },
        constraints: { must: ['unknown_action'] }
      })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INFEASIBLE');
    expect(body.error.violations).toBeDefined();
    expect(body.error.violations[0].type).toBe('MUST_ACTION_NOT_FOUND');
  });

  it('/v1/optimise: accepts constraints with unknown action IDs in must_not (no validation)', async () => {
    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        budget: 100,
        actions: [{ id: 'a1', cost: 50, do: [] }],
        objective: { type: 'utility_linear', weights: { B: 1.0 } },
        constraints: { must_not: ['unknown_action'] },
        seed: 4242
      })
    });

    // Unknown must_not IDs are silently ignored
    expect(res.status).toBe(200);
  });

  it('/v1/optimise: rejects overlapping must/must_not', async () => {
    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
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

  it('/v1/optimise: accepts valid must constraint', async () => {
    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        budget: 100,
        actions: [{ id: 'a1', cost: 50, do: [] }],
        objective: { type: 'utility_linear', weights: { B: 1.0 } },
        constraints: { must: ['a1'] },
        seed: 4242
      })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.selected).toContain('a1');
    expect(body.meta.constraints_applied).toContain('must');
  });

  it('/v1/optimise: accepts valid must_not constraint', async () => {
    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
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
});
