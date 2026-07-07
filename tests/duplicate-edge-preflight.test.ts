/**
 * Duplicate-edge preflight (Lane 2, item E).
 *
 * ISL now 422s duplicate (from, to, type) edges. Before calling ISL, PLoT:
 *  - coalesces EXACT identical duplicates only, logged via the existing
 *    repairs_applied mechanism (observable, never silent);
 *  - blocks NON-identical duplicates (differing weight/belief) with a typed
 *    actionable critique — PLoT must not silently pick one of the user's
 *    contradictory claims.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  preflightDuplicateEdges,
  type DuplicateCheckEdge,
} from '../src/integrations/isl/preflight.js';

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

const edge = (
  from: string,
  to: string,
  mean = 0.5,
  std = 0.1,
  existsProbability = 0.8,
  edgeType?: 'directed' | 'bidirected',
): DuplicateCheckEdge => ({
  from,
  to,
  exists_probability: existsProbability,
  strength: { mean, std },
  ...(edgeType ? { edge_type: edgeType } : {}),
});

describe('preflightDuplicateEdges (unit)', () => {
  it('returns input untouched when there are no duplicates', () => {
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('a', 'c')];
    const result = preflightDuplicateEdges(edges);
    expect(result.edges).toBe(edges);
    expect(result.coalesced).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it('coalesces EXACT identical duplicates to one edge, reporting the group', () => {
    const edges = [edge('a', 'b'), edge('a', 'b'), edge('b', 'c')];
    const result = preflightDuplicateEdges(edges);
    expect(result.conflicts).toEqual([]);
    expect(result.coalesced).toEqual([
      { from: 'a', to: 'b', edge_type: 'directed', count: 2 },
    ]);
    expect(result.edges).toHaveLength(2);
    expect(result.edges.map((e) => `${e.from}->${e.to}`)).toEqual(['a->b', 'b->c']);
  });

  it('coalesces triple identical duplicates, preserving first position', () => {
    const edges = [edge('x', 'y'), edge('a', 'b'), edge('x', 'y'), edge('x', 'y')];
    const result = preflightDuplicateEdges(edges);
    expect(result.coalesced).toEqual([
      { from: 'x', to: 'y', edge_type: 'directed', count: 3 },
    ]);
    expect(result.edges.map((e) => `${e.from}->${e.to}`)).toEqual(['x->y', 'a->b']);
  });

  it('flags NON-identical duplicates as conflicts and does NOT dedupe them', () => {
    const edges = [edge('a', 'b', 0.5), edge('a', 'b', 0.9), edge('b', 'c')];
    const result = preflightDuplicateEdges(edges);
    expect(result.coalesced).toEqual([]);
    expect(result.conflicts).toEqual([
      {
        from: 'a',
        to: 'b',
        edge_type: 'directed',
        count: 2,
        divergent_fields: ['strength.mean'],
      },
    ]);
    // Conflicting edges are NOT silently removed
    expect(result.edges).toHaveLength(3);
  });

  it('reports every divergent field for a conflicting group', () => {
    const a = edge('a', 'b', 0.5, 0.1, 0.8);
    const b = { ...edge('a', 'b', 0.9, 0.2, 0.6), label: 'other' };
    const result = preflightDuplicateEdges([a, b]);
    expect(result.conflicts[0].divergent_fields).toEqual([
      'exists_probability',
      'strength.mean',
      'strength.std',
      'label',
    ]);
  });

  it('treats directed and bidirected edges between the same pair as DIFFERENT keys', () => {
    const edges = [edge('a', 'b'), edge('a', 'b', 0.5, 0.1, 0.8, 'bidirected')];
    const result = preflightDuplicateEdges(edges);
    expect(result.coalesced).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.edges).toHaveLength(2);
  });

  it('handles a mixed graph: identical group coalesced AND conflicting group reported', () => {
    const edges = [
      edge('a', 'b'),
      edge('a', 'b'), // identical dupe → coalesce
      edge('c', 'd', 0.1),
      edge('c', 'd', 0.2), // conflicting dupe → conflict
    ];
    const result = preflightDuplicateEdges(edges);
    expect(result.coalesced).toHaveLength(1);
    expect(result.conflicts).toHaveLength(1);
  });

  it('does not confuse key delimiters (from="a b", to="c" vs from="a", to="b c")', () => {
    const result = preflightDuplicateEdges([edge('a b', 'c'), edge('a', 'b c')]);
    expect(result.coalesced).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.edges).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Route-level tests: /v2/run with a mocked ISL service
// ---------------------------------------------------------------------------

let lastIslRequestBody: any = null;

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high',
      adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    lastIslRequestBody = body;
    const options = body.options || [];
    return {
      data: {
        analysis_status: 'computed',
        options: options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: { mean: 0.6 + idx * 0.1, std: 0.05, p10: 0.4, p50: 0.6, p90: 0.8, n_samples: 100, n_valid_samples: 100, validity_ratio: 1.0 },
          win_probability: idx === 0 ? 0.7 : 0.3,
          status: 'computed',
        })),
        factor_sensitivity: [],
        robustness: { confidence: 0.8, level: 'high', is_robust: true, fragile_edges: [], robust_edges: [] },
        inference_warnings: [],
      } as T,
      error: null,
    };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';

const NODES = [
  { id: 'factor-a', kind: 'factor', label: 'Factor A', observed_state: { value: 0.5 } },
  { id: 'factor-b', kind: 'factor', label: 'Factor B', observed_state: { value: 0.4 } },
  { id: 'goal', kind: 'goal', label: 'Goal' },
];

const OPTIONS = [
  { id: 'opt-a', label: 'Option A', interventions: { 'factor-a': { value: 0.8, source: 'user_specified' } } },
  { id: 'opt-b', label: 'Option B', interventions: { 'factor-b': { value: 0.7, source: 'user_specified' } } },
];

const EDGE_A = { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } };
const EDGE_B = { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.3, std: 0.1 } };

describe('duplicate-edge preflight via /v2/run', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('coalesces exact-identical duplicate edges before calling ISL and logs a repair', async () => {
    lastIslRequestBody = null;
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        graph: { nodes: NODES, edges: [EDGE_A, { ...EDGE_A }, EDGE_B] },
        options: OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
      },
    });

    expect(res.statusCode).toBe(200);

    // ISL received exactly ONE factor-a -> goal edge (would 422 on two)
    expect(lastIslRequestBody).not.toBeNull();
    const sentPairs = lastIslRequestBody.graph.edges.map((e: any) => `${e.from}->${e.to}`);
    expect(sentPairs.filter((p: string) => p === 'factor-a->goal')).toHaveLength(1);
    expect(sentPairs).toHaveLength(2);

    // Coalescing is observable via the existing repairs_applied mechanism
    const body = JSON.parse(res.body);
    const repairs = body._meta?.repairs_applied ?? [];
    const coalesceRepairs = repairs.filter((r: any) =>
      String(r.reason ?? '').startsWith('COALESCE_DUPLICATE_EDGE'),
    );
    expect(coalesceRepairs).toHaveLength(1);
    expect(coalesceRepairs[0].reason).toContain('factor-a -> goal');
  });

  it('blocks NON-identical duplicate edges with a typed actionable critique (422), never silent dedupe', async () => {
    lastIslRequestBody = null;
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        graph: {
          nodes: NODES,
          edges: [EDGE_A, { ...EDGE_A, strength: { mean: 0.9, std: 0.1 } }, EDGE_B],
        },
        options: OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
      },
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.analysis_status).toBe('blocked');
    const critique = (body.critiques ?? []).find((c: any) => c.code === 'DUPLICATE_EDGE_CONFLICT');
    expect(critique).toBeDefined();
    expect(critique.severity).toBe('blocker');
    expect(critique.blocks_analysis).toBe(true);
    // Actionable: names the edge pair and the divergent field
    expect(critique.message).toContain('factor-a -> goal');
    expect(critique.message).toContain('strength.mean');
    // ISL must never have been called with the conflicting graph
    expect(lastIslRequestBody).toBeNull();
  });

  it('clean graphs pass through with no coalesce repairs and no conflict critiques', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        graph: { nodes: NODES, edges: [EDGE_A, EDGE_B] },
        options: OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const repairs = body._meta?.repairs_applied ?? [];
    expect(repairs.filter((r: any) => String(r.reason ?? '').startsWith('COALESCE_DUPLICATE_EDGE'))).toHaveLength(0);
    expect((body.critiques ?? []).filter((c: any) => c.code === 'DUPLICATE_EDGE_CONFLICT')).toHaveLength(0);
  });
});
