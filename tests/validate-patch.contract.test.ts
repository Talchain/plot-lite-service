/**
 * validate-patch Contract Tests
 *
 * 12 golden fixtures testing the 5-phase validation pipeline.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerValidatePatchRoute } from '../src/routes/v1/validate-patch.js';

let app: FastifyInstance;

const ENV = {
  ENABLE_VALIDATE_PATCH: '1',
};

beforeAll(async () => {
  // Set env
  for (const [k, v] of Object.entries(ENV)) {
    process.env[k] = v;
  }
  app = Fastify();
  await registerValidatePatchRoute(app);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  for (const k of Object.keys(ENV)) {
    delete process.env[k];
  }
});

function post(body: unknown) {
  return app.inject({
    method: 'POST',
    url: '/v1/validate-patch',
    headers: { 'Content-Type': 'application/json' },
    payload: body,
  });
}

// =============================================================================
// Fixture 1: Valid patch, no repairs (determinism assertion)
// =============================================================================

describe('validate-patch contract', () => {
  it('Fixture 1: valid patch with no repairs produces deterministic hash', async () => {
    const body = {
      graph: {
        nodes: [
          { id: 'a', kind: 'factor', label: 'A' },
          { id: 'b', kind: 'factor', label: 'B' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          { from: 'a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        ],
      },
      operations: [
        {
          op: 'add_edge',
          path: 'b->goal',
          value: { from: 'b', to: 'goal', exists_probability: 0.7, strength: { mean: 0.3, std: 0.1 } },
        },
      ],
    };

    const res1 = await post(body);
    const res2 = await post(body);
    expect(res1.statusCode).toBe(200);
    const d1 = res1.json();
    const d2 = res2.json();
    expect(d1.status).toBe('applied');
    expect(d1.graph_hash).toMatch(/^[0-9a-f]{16}$/);
    // Determinism: same input → same hash
    expect(d1.graph_hash).toBe(d2.graph_hash);
  });

  // =============================================================================
  // Fixture 2: Rejected — cycle detected
  // =============================================================================

  it('Fixture 2: rejects graph with cycle', async () => {
    const body = {
      graph: {
        nodes: [
          { id: 'a', kind: 'factor', label: 'A' },
          { id: 'b', kind: 'factor', label: 'B' },
        ],
        edges: [
          { from: 'a', to: 'b', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        ],
      },
      operations: [
        {
          op: 'add_edge',
          path: 'b->a',
          value: { from: 'b', to: 'a', exists_probability: 0.7, strength: { mean: 0.3, std: 0.1 } },
        },
      ],
    };

    const res = await post(body);
    expect(res.statusCode).toBe(422);
    const d = res.json();
    expect(d.status).toBe('rejected');
    expect(d.code).toBe('CYCLE_DETECTED');
  });

  // =============================================================================
  // Fixture 3: Rejected — POC edge limit
  // =============================================================================

  it('Fixture 3: rejects graph exceeding edge limit', async () => {
    // Build a two-layer DAG: 10 source nodes × 10 target nodes = 100 edges + 1 overflow
    const sources = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`, kind: 'factor', label: `S${i}`,
    }));
    const targets = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`, kind: 'factor', label: `T${i}`,
    }));
    const goal = { id: 'goal', kind: 'goal', label: 'Goal' };

    const edges: Array<{ from: string; to: string; exists_probability: number; strength: { mean: number; std: number } }> = [];
    for (const s of sources) {
      for (const t of targets) {
        edges.push({
          from: s.id, to: t.id, exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 },
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
  });

  // =============================================================================
  // Fixture 4: Valid with repairs
  // =============================================================================

  it('Fixture 4: applies semantic repairs (DEFAULT_EXISTS_PROBABILITY, CLAMP_STD_MINIMUM)', async () => {
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
          value: { from: 'a', to: 'goal', strength: { mean: 0.5, std: 0.0001 } },
          // No exists_probability → should get DEFAULT_EXISTS_PROBABILITY repair
          // std 0.0001 < MIN_STD 0.001 → should get CLAMP_STD_MINIMUM repair
        },
      ],
    };

    const res = await post(body);
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.status).toBe('applied');

    const repairCodes = d.repairs_applied.map((r: any) => r.code);
    expect(repairCodes).toContain('DEFAULT_EXISTS_PROBABILITY');
    expect(repairCodes).toContain('CLAMP_STD_MINIMUM');

    // Verify repaired edge values
    const edge = d.graph.edges.find((e: any) => e.from === 'a' && e.to === 'goal');
    expect(edge.exists_probability).toBe(0.8);
    expect(edge.strength.std).toBe(0.001);
  });

  // =============================================================================
  // Fixture 5: Multi-operation sequential with deep merge
  // =============================================================================

  it('Fixture 5: multi-operation sequential with deep merge', async () => {
    const body = {
      graph: {
        nodes: [
          { id: 'a', kind: 'factor', label: 'A' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          { from: 'a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        ],
      },
      operations: [
        {
          op: 'add_node',
          path: 'b',
          value: { id: 'b', kind: 'factor', label: 'B' },
        },
        {
          op: 'add_edge',
          path: 'b->goal',
          value: { from: 'b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.6, std: 0.1 } },
        },
        {
          op: 'update_edge',
          path: 'a->goal',
          value: { strength: { mean: 0.7 } },  // Deep merge: only update mean, keep std
        },
      ],
    };

    const res = await post(body);
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.status).toBe('applied');
    expect(d.graph.nodes).toHaveLength(3);
    expect(d.graph.edges).toHaveLength(2);

    // Verify deep merge preserved std
    const edge = d.graph.edges.find((e: any) => e.from === 'a' && e.to === 'goal');
    expect(edge.strength.mean).toBe(0.7);
    expect(edge.strength.std).toBe(0.1);
  });

  // =============================================================================
  // Fixture 6: Rejected — invalid patch target
  // =============================================================================

  it('Fixture 6: rejects invalid patch target (operation index in message)', async () => {
    const body = {
      graph: {
        nodes: [
          { id: 'a', kind: 'factor', label: 'A' },
        ],
        edges: [],
      },
      operations: [
        {
          op: 'remove_node',
          path: 'nonexistent',
        },
      ],
    };

    const res = await post(body);
    expect(res.statusCode).toBe(422);
    const d = res.json();
    expect(d.status).toBe('rejected');
    expect(d.code).toBe('INVALID_PATCH_TARGET');
    expect(d.message).toContain('Operation 0');
  });

  // =============================================================================
  // Fixture 7: Cascade warning cap
  // =============================================================================

  it('Fixture 7: cascade warning cap (hub with 12 spokes → 10 warnings + 1 summary)', async () => {
    const spokes = Array.from({ length: 12 }, (_, i) => ({
      id: `s${i}`, kind: 'factor', label: `Spoke ${i}`,
    }));
    const hub = { id: 'hub', kind: 'factor', label: 'Hub' };

    const edges = spokes.map(s => ({
      from: s.id, to: 'hub', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 },
    }));

    const body = {
      graph: {
        nodes: [...spokes, hub],
        edges,
      },
      operations: [
        { op: 'remove_node', path: 'hub' },
      ],
    };

    const res = await post(body);
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.status).toBe('applied');

    // Should have CASCADE_REMOVE_EDGE warnings capped at 10 + 1 summary
    const cascadeWarnings = d.warnings.filter((w: any) => w.code === 'CASCADE_REMOVE_EDGE');
    const summaryWarnings = d.warnings.filter((w: any) => w.code === 'CASCADE_REMOVE_EDGE_SUMMARY');
    expect(cascadeWarnings).toHaveLength(10);
    expect(summaryWarnings).toHaveLength(1);
    expect(summaryWarnings[0].message).toContain('12');

    // Repairs should have all 12
    const cascadeRepairs = d.repairs_applied.filter((r: any) => r.code === 'CASCADE_REMOVE_EDGE');
    expect(cascadeRepairs).toHaveLength(12);
  });
});

  // Fixture 8: Rejected — non-canonical edge field (INVALID_PATCH_FIELD)
  it('Fixture 8: rejects patch with non-canonical edge field (belief)', async () => {
    const res = await post({
      graph: {
        nodes: [
          { id: 'a', kind: 'factor', label: 'A' },
          { id: 'b', kind: 'goal', label: 'B' },
        ],
        edges: [
          { from: 'a', to: 'b', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        ],
      },
      operations: [
        { op: 'update_edge', path: 'a->b', value: { belief: 0.7 } },
      ],
    });

    expect(res.statusCode).toBe(422);
    const d = JSON.parse(res.body);
    expect(d.status).toBe('rejected');
    expect(d.code).toBe('INVALID_PATCH_FIELD');
    expect(d.message).toContain('belief');
    expect(d.message).toContain('non-canonical');
    expect(d.message).toContain('Operation 0');
  });

  // =============================================================================
  // Fixture 9: add_node with valid kind passes
  // =============================================================================

  it('Fixture 9: add_node with valid kind passes', async () => {
    const res = await post({
      graph: {
        nodes: [
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [],
      },
      operations: [
        { op: 'add_node', path: 'r1', value: { id: 'r1', kind: 'risk', label: 'Risk 1' } },
      ],
    });

    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.status).toBe('applied');
    expect(d.graph.nodes).toHaveLength(2);
    expect(d.graph.nodes.find((n: any) => n.id === 'r1').kind).toBe('risk');
  });

  // =============================================================================
  // Fixture 10: add_node with invalid kind rejected
  // =============================================================================

  it('Fixture 10: rejects add_node with invalid kind', async () => {
    const res = await post({
      graph: {
        nodes: [
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [],
      },
      operations: [
        { op: 'add_node', path: 'bad', value: { id: 'bad', kind: 'banana', label: 'Bad' } },
      ],
    });

    expect(res.statusCode).toBe(422);
    const d = res.json();
    expect(d.status).toBe('rejected');
    expect(d.code).toBe('INVALID_NODE_KIND');
    expect(d.message).toContain('banana');
    expect(d.message).toContain('bad');
    expect(d.violations).toBeDefined();
    expect(d.violations.some((v: any) => v.code === 'INVALID_NODE_KIND' && v.node_id === 'bad')).toBe(true);
  });

  // =============================================================================
  // Fixture 11: update_node changing kind to invalid rejected
  // =============================================================================

  it('Fixture 11: rejects update_node changing kind to invalid value', async () => {
    const res = await post({
      graph: {
        nodes: [
          { id: 'a', kind: 'factor', label: 'A' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [],
      },
      operations: [
        { op: 'update_node', path: 'a', value: { kind: 'unknown_type' } },
      ],
    });

    expect(res.statusCode).toBe(422);
    const d = res.json();
    expect(d.status).toBe('rejected');
    expect(d.code).toBe('INVALID_NODE_KIND');
    expect(d.message).toContain('unknown_type');
    expect(d.message).toContain("'a'");
  });

  // =============================================================================
  // Fixture 12: update_node not touching kind passes (no regression)
  // =============================================================================

  it('Fixture 12: update_node not touching kind passes', async () => {
    const res = await post({
      graph: {
        nodes: [
          { id: 'a', kind: 'factor', label: 'A' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [],
      },
      operations: [
        { op: 'update_node', path: 'a', value: { label: 'Updated A' } },
      ],
    });

    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.status).toBe('applied');
    expect(d.graph.nodes.find((n: any) => n.id === 'a').label).toBe('Updated A');
    expect(d.graph.nodes.find((n: any) => n.id === 'a').kind).toBe('factor');
  });
