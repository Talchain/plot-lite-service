import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

/**
 * R3: a request missing/invalid `graph` currently reaches the unguarded completion
 * log (`body.graph.nodes.length` / `body.graph.edges.length`) and throws -> HTTP 500,
 * or (graph.nodes as a string) silently 200s. The route must reject with a clean 400
 * using the repo's standard BAD_INPUT error.v1 envelope (same shape as missing-budget).
 *
 * Each case fails at HEAD (500 or a wrong 200) and passes after the graph-presence guard.
 */
const validBudgetActionsObjective = {
  budget: 10,
  actions: [{ id: 'a1', cost: 2, do: [{ node_id: 'R', set_to: 3 }] }],
  objective: { type: 'utility_linear', weights: { T: 1.0 } },
  seed: 4242,
};

describe('POST /v1/optimise - R3 graph validation (clean 400, not 500)', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer(); });
  afterAll(async () => { await server.kill(); });

  it('returns 400 with the error.v1 BAD_INPUT envelope when graph is missing', async () => {
    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBudgetActionsObjective }), // no graph
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    // Match the repo's standard envelope (top-level error.v1 + legacy error object).
    expect(data.schema).toBe('error.v1');
    expect(data.code).toBe('BAD_INPUT');
    expect(data.error).toBeDefined();
    expect(typeof data.error.message).toBe('string');
    expect(data.error.message.toLowerCase()).toContain('graph');
  });

  it('returns 400 when graph is null', async () => {
    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: null, ...validBudgetActionsObjective }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when graph.nodes is not an array', async () => {
    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: { nodes: 'oops', edges: [] }, ...validBudgetActionsObjective }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when graph.edges is missing', async () => {
    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: { nodes: [] }, ...validBudgetActionsObjective }),
    });
    expect(res.status).toBe(400);
  });

  it('still accepts a well-formed empty graph (no false-positive rejection)', async () => {
    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: { nodes: [], edges: [] }, ...validBudgetActionsObjective }),
    });
    expect(res.status).toBe(200);
  });
});
