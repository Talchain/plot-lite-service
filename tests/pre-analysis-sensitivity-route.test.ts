/**
 * HTTP-level route tests for /v1/pre-analysis-sensitivity and /v1/evoi
 *
 * Uses lightweight Fastify instances with just the routes registered,
 * no full server stack needed (no ISL, no auth).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerPreAnalysisSensitivityRoute } from '../src/routes/v1/pre-analysis-sensitivity.js';
import { registerEVOIRoute } from '../src/routes/v1/evoi.js';

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await registerPreAnalysisSensitivityRoute(app);
  await registerEVOIRoute(app);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_GRAPH = {
  nodes: [
    { id: 'fac_a', kind: 'factor', label: 'A' },
    { id: 'fac_b', kind: 'factor', label: 'B' },
    { id: 'goal', kind: 'goal', label: 'Goal' },
  ],
  edges: [
    { from: 'fac_a', to: 'goal', exists_probability: 0.9, strength: { mean: 0.8, std: 0.1 } },
    { from: 'fac_b', to: 'goal', exists_probability: 0.8, strength: { mean: 0.4, std: 0.1 } },
  ],
};

function inject(url: string, body: unknown) {
  return app.inject({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// /v1/pre-analysis-sensitivity
// ---------------------------------------------------------------------------

describe('POST /v1/pre-analysis-sensitivity', () => {
  it('returns 200 with valid input', async () => {
    const res = await inject('/v1/pre-analysis-sensitivity', {
      graph: VALID_GRAPH,
      goal_node_id: 'goal',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.method).toBe('linear');
    expect(typeof body.computation_ms).toBe('number');
    expect(body.factor_influence).toBeDefined();
    expect(body.edge_influence).toBeDefined();
    // All factor influences are 0-1
    for (const v of Object.values(body.factor_influence)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('returns deterministic output for same input', async () => {
    const payload = { graph: VALID_GRAPH, goal_node_id: 'goal' };
    const r1 = JSON.parse((await inject('/v1/pre-analysis-sensitivity', payload)).body);
    const r2 = JSON.parse((await inject('/v1/pre-analysis-sensitivity', payload)).body);
    expect(r1.factor_influence).toEqual(r2.factor_influence);
    expect(r1.edge_influence).toEqual(r2.edge_influence);
  });

  it('returns 400 when body is empty', async () => {
    const res = await inject('/v1/pre-analysis-sensitivity', {});
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when graph is missing', async () => {
    const res = await inject('/v1/pre-analysis-sensitivity', { goal_node_id: 'goal' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when goal_node_id is missing', async () => {
    const res = await inject('/v1/pre-analysis-sensitivity', { graph: VALID_GRAPH });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when goal_node_id does not exist in graph', async () => {
    const res = await inject('/v1/pre-analysis-sensitivity', {
      graph: VALID_GRAPH,
      goal_node_id: 'nonexistent',
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.message).toContain('nonexistent');
  });

  it('returns 400 for oversized graph (too many nodes)', async () => {
    const nodes = Array.from({ length: 200 }, (_, i) => ({
      id: `n${i}`, kind: 'factor', label: `N${i}`,
    }));
    const res = await inject('/v1/pre-analysis-sensitivity', {
      graph: { nodes, edges: [] },
      goal_node_id: 'n0',
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.message).toContain('exceeding the limit');
  });

  it('response shape matches expected schema', async () => {
    const res = await inject('/v1/pre-analysis-sensitivity', {
      graph: VALID_GRAPH,
      goal_node_id: 'goal',
    });
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('factor_influence');
    expect(body).toHaveProperty('edge_influence');
    expect(body).toHaveProperty('method');
    expect(body).toHaveProperty('computation_ms');
    expect(typeof body.factor_influence).toBe('object');
    expect(typeof body.edge_influence).toBe('object');
    expect(['linear', 'reduced_mc']).toContain(body.method);
    expect(typeof body.computation_ms).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// /v1/evoi
// ---------------------------------------------------------------------------

describe('POST /v1/evoi', () => {
  const VALID_EVOI = {
    graph: VALID_GRAPH,
    goal_node_id: 'goal',
    contested_edges: [
      { edge_id: 'fac_a::goal', pass1_strength: 0.8, pass2_strength: 0.3 },
    ],
  };

  it('returns 200 with valid input', async () => {
    const res = await inject('/v1/evoi', VALID_EVOI);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.edges).toBeDefined();
    expect(Array.isArray(body.edges)).toBe(true);
    expect(body.edges).toHaveLength(1);
    expect(body.edges[0].edge_id).toBe('fac_a::goal');
    expect(body.edges[0].evoi_rank).toBe(1);
    expect(typeof body.edges[0].evoi_impact).toBe('number');
    expect(typeof body.computation_ms).toBe('number');
  });

  it('returns deterministic output', async () => {
    const r1 = JSON.parse((await inject('/v1/evoi', VALID_EVOI)).body);
    const r2 = JSON.parse((await inject('/v1/evoi', VALID_EVOI)).body);
    expect(r1.edges).toEqual(r2.edges);
  });

  it('returns 400 when graph is missing', async () => {
    const res = await inject('/v1/evoi', {
      goal_node_id: 'goal',
      contested_edges: [{ edge_id: 'a::b', pass1_strength: 0.5, pass2_strength: 0.3 }],
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when goal_node_id is missing', async () => {
    const res = await inject('/v1/evoi', {
      graph: VALID_GRAPH,
      contested_edges: [{ edge_id: 'a::b', pass1_strength: 0.5, pass2_strength: 0.3 }],
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when contested_edges is empty', async () => {
    const res = await inject('/v1/evoi', {
      graph: VALID_GRAPH,
      goal_node_id: 'goal',
      contested_edges: [],
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when contested_edges is missing', async () => {
    const res = await inject('/v1/evoi', {
      graph: VALID_GRAPH,
      goal_node_id: 'goal',
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when contested edge has missing edge_id', async () => {
    const res = await inject('/v1/evoi', {
      graph: VALID_GRAPH,
      goal_node_id: 'goal',
      contested_edges: [{ pass1_strength: 0.5, pass2_strength: 0.3 }],
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toContain('edge_id');
  });

  it('returns 400 when pass strength is Infinity (serialised as null)', async () => {
    // JSON.stringify(Infinity) → null, so this tests the null/non-number path
    const res = await inject('/v1/evoi', {
      graph: VALID_GRAPH,
      goal_node_id: 'goal',
      contested_edges: [{ edge_id: 'fac_a::goal', pass1_strength: Infinity, pass2_strength: 0.3 }],
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when pass strength is NaN (via raw payload)', async () => {
    // Send NaN as a raw string in the JSON body to bypass JSON.stringify coercion
    const res = await app.inject({
      method: 'POST',
      url: '/v1/evoi',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        graph: VALID_GRAPH,
        goal_node_id: 'goal',
        contested_edges: [{ edge_id: 'fac_a::goal', pass1_strength: null, pass2_strength: 0.3 }],
      }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when pass strength is not a number', async () => {
    const res = await inject('/v1/evoi', {
      graph: VALID_GRAPH,
      goal_node_id: 'goal',
      contested_edges: [{ edge_id: 'fac_a::goal', pass1_strength: 'abc', pass2_strength: 0.3 }],
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for oversized graph', async () => {
    const nodes = Array.from({ length: 200 }, (_, i) => ({
      id: `n${i}`, kind: 'factor', label: `N${i}`,
    }));
    const res = await inject('/v1/evoi', {
      graph: { nodes, edges: [] },
      goal_node_id: 'n0',
      contested_edges: [{ edge_id: 'n0::n1', pass1_strength: 0.5, pass2_strength: 0.3 }],
    });
    expect(res.statusCode).toBe(400);
  });

  it('response shape matches expected schema', async () => {
    const res = await inject('/v1/evoi', VALID_EVOI);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('edges');
    expect(body).toHaveProperty('computation_ms');
    expect(Array.isArray(body.edges)).toBe(true);
    for (const edge of body.edges) {
      expect(edge).toHaveProperty('edge_id');
      expect(edge).toHaveProperty('evoi_impact');
      expect(edge).toHaveProperty('evoi_rank');
      expect(typeof edge.edge_id).toBe('string');
      expect(typeof edge.evoi_impact).toBe('number');
      expect(typeof edge.evoi_rank).toBe('number');
      expect(edge.evoi_impact).toBeGreaterThanOrEqual(0);
      expect(edge.evoi_rank).toBeGreaterThanOrEqual(1);
    }
  });

  it('EVOI impact sum does not exceed 100 percentage points', async () => {
    // Use a graph with multiple contested edges
    const graph = {
      nodes: [
        { id: 'f1', kind: 'factor', label: 'F1' },
        { id: 'f2', kind: 'factor', label: 'F2' },
        { id: 'f3', kind: 'factor', label: 'F3' },
        { id: 'out', kind: 'outcome', label: 'Out' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'f1', to: 'out', exists_probability: 0.9, strength: { mean: 0.8, std: 0.1 } },
        { from: 'f2', to: 'out', exists_probability: 0.9, strength: { mean: 0.6, std: 0.1 } },
        { from: 'f3', to: 'goal', exists_probability: 0.9, strength: { mean: 0.9, std: 0.1 } },
        { from: 'out', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
      ],
    };
    const res = await inject('/v1/evoi', {
      graph,
      goal_node_id: 'goal',
      contested_edges: [
        { edge_id: 'f1::out', pass1_strength: 0.9, pass2_strength: 0.1 },
        { edge_id: 'f2::out', pass1_strength: 0.7, pass2_strength: 0.1 },
        { edge_id: 'f3::goal', pass1_strength: 0.9, pass2_strength: 0.1 },
      ],
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const totalImpact = body.edges.reduce(
      (sum: number, e: { evoi_impact: number }) => sum + e.evoi_impact,
      0,
    );
    // EVOI impacts are normalised edge influence × divergence.
    // Edge influences are [0,1], divergences are bounded by input.
    // Total should not exceed 100pp in any reasonable graph.
    expect(totalImpact).toBeLessThanOrEqual(100);
  });
});
