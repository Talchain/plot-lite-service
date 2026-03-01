/**
 * validate-patch Integration Tests
 *
 * Tests the /v1/validate-patch endpoint through the full Fastify server
 * (createServer + app.inject), exercising the 5-phase pipeline:
 *   1. Apply ops
 *   2. Structural pre-check (limits, cycles, dangling refs)
 *   3. Semantic repairs (defaults, clamping, direction inference)
 *   4. Full schema validation
 *   5. Deterministic graph hash
 *
 * Complements validate-patch.contract.test.ts (which registers the route
 * directly) by verifying behaviour through the full server middleware stack
 * (auth guard, rate limiter, CORS, etc.).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import { MAX_NODES, MAX_EDGES } from '../src/constants/limits.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

const savedEnv: Record<string, string | undefined> = {};

function saveAndSet(key: string, value: string) {
  savedEnv[key] = process.env[key];
  process.env[key] = value;
}

beforeAll(async () => {
  saveAndSet('ENABLE_VALIDATE_PATCH', '1');
  saveAndSet('RATE_LIMIT_ENABLED', '0');
  saveAndSet('AUTH_ENABLED', '0');
  app = await createServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function post(body: unknown) {
  return app.inject({
    method: 'POST',
    url: '/v1/validate-patch',
    headers: { 'Content-Type': 'application/json' },
    payload: body,
  });
}

// ---------------------------------------------------------------------------
// Base graph fixture: A → B → Goal
// ---------------------------------------------------------------------------

const BASE_GRAPH = {
  nodes: [
    { id: 'a', kind: 'factor', label: 'A' },
    { id: 'b', kind: 'factor', label: 'B' },
    { id: 'goal', kind: 'goal', label: 'Goal' },
  ],
  edges: [
    { from: 'a', to: 'b', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
    { from: 'b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.3, std: 0.1 } },
  ],
};

// =============================================================================
// Test Suite
// =============================================================================

describe('validate-patch integration', () => {
  // -------------------------------------------------------------------------
  // 1. Valid patch -> status 'applied', graph_hash present
  // -------------------------------------------------------------------------

  it('valid patch returns status applied with 16-char hex graph_hash and repairs_applied array', async () => {
    const body = {
      graph: BASE_GRAPH,
      operations: [
        {
          op: 'add_node',
          path: 'c',
          value: { id: 'c', kind: 'factor', label: 'C' },
        },
        {
          op: 'add_edge',
          path: 'c->goal',
          value: { from: 'c', to: 'goal', exists_probability: 0.7, strength: { mean: 0.4, std: 0.1 } },
        },
      ],
    };

    const res = await post(body);
    expect(res.statusCode).toBe(200);

    const d = res.json();
    expect(d.status).toBe('applied');
    expect(d.graph_hash).toMatch(/^[a-f0-9]{16}$/);
    expect(Array.isArray(d.repairs_applied)).toBe(true);
    expect(d.graph).toBeDefined();
    expect(d.normalised_graph).toBeDefined();
    expect(Array.isArray(d.warnings)).toBe(true);

    // Verify the added node and edge are in the result graph
    expect(d.graph.nodes).toHaveLength(4);
    expect(d.graph.edges).toHaveLength(3);
    expect(d.graph.nodes.some((n: any) => n.id === 'c')).toBe(true);
    expect(d.graph.edges.some((e: any) => e.from === 'c' && e.to === 'goal')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. Patch creating a cycle -> rejected CYCLE_DETECTED
  // -------------------------------------------------------------------------

  it('patch creating a cycle is rejected with CYCLE_DETECTED', async () => {
    // Graph: A -> B -> C -> Goal (linear chain with goal)
    const graph = {
      nodes: [
        { id: 'a', kind: 'factor', label: 'A' },
        { id: 'b', kind: 'factor', label: 'B' },
        { id: 'c', kind: 'factor', label: 'C' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'a', to: 'b', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        { from: 'b', to: 'c', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        { from: 'c', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
      ],
    };

    const body = {
      graph,
      operations: [
        {
          op: 'add_edge',
          path: 'c->a',
          value: { from: 'c', to: 'a', exists_probability: 0.7, strength: { mean: 0.3, std: 0.1 } },
        },
      ],
    };

    const res = await post(body);
    expect(res.statusCode).toBe(422);

    const d = res.json();
    expect(d.status).toBe('rejected');
    expect(d.code).toBe('CYCLE_DETECTED');
    expect(d.message).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 3. Semantic repair: strength.mean > 1.0 is clamped
  // -------------------------------------------------------------------------

  it('edge with strength.mean > 1.0 triggers CLAMP_STRENGTH_MEAN repair', async () => {
    const body = {
      graph: {
        nodes: [
          { id: 'a', kind: 'factor', label: 'A' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [],
      },
      operations: [
        {
          op: 'add_edge',
          path: 'a->goal',
          value: {
            from: 'a',
            to: 'goal',
            exists_probability: 0.8,
            strength: { mean: 1.5, std: 0.1 },
          },
        },
      ],
    };

    const res = await post(body);
    expect(res.statusCode).toBe(200);

    const d = res.json();
    expect(d.status).toBe('applied');
    expect(Array.isArray(d.repairs_applied)).toBe(true);
    expect(d.repairs_applied.length).toBeGreaterThan(0);

    // Should contain a CLAMP_STRENGTH_MEAN repair entry
    const clampRepair = d.repairs_applied.find(
      (r: any) => r.code === 'CLAMP_STRENGTH_MEAN',
    );
    expect(clampRepair).toBeDefined();

    // The normalised graph should have the mean clamped to [-1, 1]
    const edge = d.normalised_graph.edges.find(
      (e: any) => e.from === 'a' && e.to === 'goal',
    );
    expect(edge).toBeDefined();
    expect(edge.strength.mean).toBeLessThanOrEqual(1.0);
    expect(edge.strength.mean).toBeGreaterThanOrEqual(-1.0);
  });

  // -------------------------------------------------------------------------
  // 4. Determinism: same valid patch input twice -> identical graph_hash
  // -------------------------------------------------------------------------

  it('same valid patch input produces identical graph_hash on repeated calls', async () => {
    const body = {
      graph: BASE_GRAPH,
      operations: [
        {
          op: 'add_node',
          path: 'd',
          value: { id: 'd', kind: 'factor', label: 'D' },
        },
        {
          op: 'add_edge',
          path: 'd->goal',
          value: { from: 'd', to: 'goal', exists_probability: 0.6, strength: { mean: 0.2, std: 0.1 } },
        },
      ],
    };

    const res1 = await post(body);
    const res2 = await post(body);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    const d1 = res1.json();
    const d2 = res2.json();

    expect(d1.status).toBe('applied');
    expect(d2.status).toBe('applied');
    expect(d1.graph_hash).toBe(d2.graph_hash);
    expect(d1.graph_hash).toMatch(/^[a-f0-9]{16}$/);
  });

  // -------------------------------------------------------------------------
  // 5. Auth: request without token returns 401 when AUTH_ENABLED=1
  // -------------------------------------------------------------------------

  it('returns 401 when AUTH_ENABLED=1 and no bearer token is provided', async () => {
    const prev = process.env.AUTH_ENABLED;
    const prevToken = process.env.AUTH_TOKEN;
    try {
      process.env.AUTH_ENABLED = '1';
      process.env.AUTH_TOKEN = 'test-secret-token';

      const res = await app.inject({
        method: 'POST',
        url: '/v1/validate-patch',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          graph: BASE_GRAPH,
          operations: [],
        },
      });

      expect(res.statusCode).toBe(401);
    } finally {
      // Restore original auth state
      if (prev === undefined) {
        delete process.env.AUTH_ENABLED;
      } else {
        process.env.AUTH_ENABLED = prev;
      }
      if (prevToken === undefined) {
        delete process.env.AUTH_TOKEN;
      } else {
        process.env.AUTH_TOKEN = prevToken;
      }
    }
  });

  // -------------------------------------------------------------------------
  // 6. Patch exceeding MAX_NODES -> rejected POC_NODE_LIMIT
  // -------------------------------------------------------------------------

  it(`rejects graph exceeding MAX_NODES (${MAX_NODES})`, async () => {
    // Build a graph with MAX_NODES nodes already
    const nodes = Array.from({ length: MAX_NODES }, (_, i) => ({
      id: `n${i}`,
      kind: 'factor' as const,
      label: `Node ${i}`,
    }));

    // Minimal edges to keep it a valid DAG (linear chain of first few)
    const edges = [
      { from: 'n0', to: 'n1', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
    ];

    const body = {
      graph: { nodes, edges },
      operations: [
        {
          op: 'add_node',
          path: 'overflow',
          value: { id: 'overflow', kind: 'factor', label: 'Overflow' },
        },
      ],
    };

    const res = await post(body);
    expect(res.statusCode).toBe(422);

    const d = res.json();
    expect(d.status).toBe('rejected');
    expect(d.code).toBe('POC_NODE_LIMIT');
    expect(d.message).toContain(String(MAX_NODES));
  });

  // -------------------------------------------------------------------------
  // 7. Flag OFF -> 501 FEATURE_DISABLED
  // -------------------------------------------------------------------------

  it('returns 501 FEATURE_DISABLED when ENABLE_VALIDATE_PATCH=0', async () => {
    const prev = process.env.ENABLE_VALIDATE_PATCH;
    try {
      process.env.ENABLE_VALIDATE_PATCH = '0';

      const res = await post({
        graph: BASE_GRAPH,
        operations: [],
      });

      expect(res.statusCode).toBe(501);

      const d = res.json();
      expect(d.status).toBe('rejected');
      expect(d.code).toBe('FEATURE_DISABLED');
      expect(d.message).toContain('not enabled');
    } finally {
      if (prev === undefined) {
        delete process.env.ENABLE_VALIDATE_PATCH;
      } else {
        process.env.ENABLE_VALIDATE_PATCH = prev;
      }
    }
  });

  // -------------------------------------------------------------------------
  // 8. Patch exceeding MAX_EDGES -> rejected POC_EDGE_LIMIT
  // -------------------------------------------------------------------------

  it(`rejects graph exceeding MAX_EDGES (${MAX_EDGES})`, async () => {
    // Strategy: build a bipartite DAG with enough edges to hit the limit.
    // sources (layer 0) -> targets (layer 1) to avoid cycles.
    // We need MAX_EDGES + 1 edges total after the operation.
    // Use ceil(sqrt(MAX_EDGES+1)) nodes per layer.
    const layerSize = Math.ceil(Math.sqrt(MAX_EDGES + 1));

    const sources = Array.from({ length: layerSize }, (_, i) => ({
      id: `s${i}`,
      kind: 'factor' as const,
      label: `S${i}`,
    }));
    const targets = Array.from({ length: layerSize }, (_, i) => ({
      id: `t${i}`,
      kind: 'factor' as const,
      label: `T${i}`,
    }));
    const goal = { id: 'goal', kind: 'goal' as const, label: 'Goal' };

    // Create exactly MAX_EDGES edges in the base graph
    const edges: Array<{ from: string; to: string; exists_probability: number; strength: { mean: number; std: number } }> = [];
    outer:
    for (const s of sources) {
      for (const t of targets) {
        if (edges.length >= MAX_EDGES) break outer;
        edges.push({
          from: s.id,
          to: t.id,
          exists_probability: 0.8,
          strength: { mean: 0.5, std: 0.1 },
        });
      }
    }

    const body = {
      graph: {
        nodes: [...sources, ...targets, goal],
        edges,
      },
      operations: [
        {
          op: 'add_edge',
          path: 's0->goal',
          value: { from: 's0', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        },
      ],
    };

    const res = await post(body);
    expect(res.statusCode).toBe(422);

    const d = res.json();
    expect(d.status).toBe('rejected');
    expect(d.code).toBe('POC_EDGE_LIMIT');
    expect(d.message).toContain(String(MAX_EDGES));
  });

  // -------------------------------------------------------------------------
  // 8. Patch triggering warning narration (cascade remove)
  // -------------------------------------------------------------------------

  it('removing a node with connected edges produces non-empty warnings', async () => {
    // Graph: A -> B -> C. Remove node B → edges A->B and B->C cascade-removed.
    const graph = {
      nodes: [
        { id: 'a', kind: 'factor', label: 'A' },
        { id: 'b', kind: 'factor', label: 'B' },
        { id: 'c', kind: 'goal', label: 'C' },
      ],
      edges: [
        { from: 'a', to: 'b', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        { from: 'b', to: 'c', exists_probability: 0.9, strength: { mean: 0.6, std: 0.1 } },
      ],
    };

    const body = {
      graph,
      operations: [
        { op: 'remove_node', path: 'b' },
      ],
    };

    const res = await post(body);
    expect(res.statusCode).toBe(200);

    const d = res.json();
    expect(d.status).toBe('applied');

    // Warnings should be non-empty (cascade edge removal narration)
    expect(Array.isArray(d.warnings)).toBe(true);
    expect(d.warnings.length).toBeGreaterThan(0);
    expect(d.warnings.some((w: any) => w.code === 'CASCADE_REMOVE_EDGE')).toBe(true);

    // The removed node's edges should be gone
    expect(d.graph.nodes).toHaveLength(2);
    expect(d.graph.edges).toHaveLength(0);
  });
});
