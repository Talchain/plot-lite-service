/**
 * ⛔ F1b (DL 5932454064; CODE-READ from CODEX 5931449433's probe on PLoT #427): A DECLARED QUANTITY UNDER A DECLARED CAP
 * IS NEVER "ALREADY NORMALISED".
 *
 * The route invokes the constraint normaliser only when some value sits outside [0,1] (or one of the named disjuncts),
 * and the normaliser's forward-raw rung outranks the producer cap. So "≤ 1 points" on a goal whose CEE-stamped
 * `goal_threshold_cap` is 12 went to ISL as 1.0, the TOP of the normalised score: trivially true. "≤ 2 points" opened the
 * gate and went as 2/12. One unit flipped the reading, and the same "≤ 1" read 1/12 once any batch-mate opened the gate.
 * That is 2.957's defect, for any declared unit under a cap. It is not specific to percent or time.
 *
 * THE RULE: a constraint whose unit is a declared QUANTITY (the unit table's count / currency, or a token it does not
 * know), on a node with a declared `goal_threshold_cap`, reads on that cap at ANY value. One predicate decides both the
 * route's invocation disjunct and the forward-raw rung, so the two cannot drift. No unit, %, and fraction/ratio keep
 * their existing readings.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

/** Every `goal_constraints` array ISL was handed, in call order. THE WIRE. */
let islRequests: any[][] = [];

function echoConstraintAnalysis(goalConstraints: any[] | undefined) {
  if (!goalConstraints || goalConstraints.length === 0) return undefined;
  return {
    constraints: goalConstraints.map((c: any, i: number) => ({
      constraint_id: c.constraint_id,
      node_id: c.node_id,
      operator: c.operator,
      value: c.value,
      prob_satisfied: 0.8 + i * 0.05,
      failure_margin_median: 0.04,
      near_miss_fraction: 0.1,
      binding: false,
    })),
    joint_probability: 0.75,
    conditional_probabilities: null,
  };
}

function optionResults(options: any[], goalConstraints: any[] | undefined) {
  const ca = echoConstraintAnalysis(goalConstraints);
  return options.map((opt: any, idx: number) => ({
    option_id: opt.id,
    outcome: {
      mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9,
      n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0,
    },
    rank: idx + 1,
    ...(ca && { constraint_analysis: ca }),
  }));
}

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [],
      backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock validation', reasoning: 'Test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[], _t?: any, constraints?: any[]) {
    islRequests.push(constraints ?? []);
    return {
      options: optionResults(options, constraints),
      edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factors: [], value_of_information: [], factors_provenance: 'unavailable' as const,
      factor_sensitivity_status: 'skipped_no_factor_values' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.8,
      fragile_edges: [], robust_edges: [], latency_ms: 50, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return {
      factors: [], value_of_information: [], robustness_label: 'robust' as const,
      robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const,
    };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    islRequests.push(body.goal_constraints ?? []);
    return {
      data: {
        options: optionResults(body.options || [], body.goal_constraints),
        edges: [], factors: [], value_of_information: [],
        overall_robustness: 'robust', robustness_score: 0.8,
        fragile_edges: [], robust_edges: [],
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

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue', observed_state: { value: 15000 } },
    { id: 'factor-a', kind: 'factor', label: 'Market Size' },
    { id: 'factor-b', kind: 'factor', label: 'Retention' },
    // Carries an observed value so the constraint pipeline delivers a verdict.
    // It feeds `deriveRange` rung 6 (`inferred_value`), BELOW the '%' rung (4),
    // so it can never be the source of the '%' arms' answers.
    { id: 'factor-c', kind: 'factor', label: 'Churn rate', observed_state: { value: 0.1 } },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
    { from: 'factor-b', to: 'goal', strength: { mean: 0.7, std: 0.1 } },
    { from: 'factor-c', to: 'goal', strength: { mean: 0.3, std: 0.1 } },
  ],
};

/**
 * Interventions ALL inside [0,1] on purpose: Phase 4a is skipped, every
 * intervention scale is identity, and the route's `anyNonIdentityScale`
 * disjunct reads FALSE. Moving these outside [0,1] would invoke the normaliser
 * for an unrelated reason and silently hollow this file out.
 */
const OPTIONS = [
  { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': 0.5 } },
  { id: 'opt2', label: 'Option 2', interventions: { 'factor-b': 0.6 } },
];

const BASE_PAYLOAD = { graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: '42' };


const capped = (cap: number) => ({ ...GRAPH, nodes: GRAPH.nodes.map((n: any) => (n.id === 'goal' ? { ...n, goal_threshold_cap: cap } : n)) });
const limit = (unit: string | undefined, value: number) => ({
  constraint_id: 'goal-limit', node_id: 'goal', operator: '<=', value, ...(unit !== undefined ? { unit } : {}), label: 'Goal limit',
});
/** Unrelated, out-of-range — its only job is to open the route's gate. */
const GATE_OPENER = { constraint_id: 'revenue-min', node_id: 'goal', operator: '>=', value: 20_000, unit: '£', label: 'Revenue floor' };

async function wireValue(baseUrl: string, cap: number, constraints: any[]): Promise<number> {
  islRequests = [];
  const res = await fetch(`${baseUrl}/v2/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ graph: capped(cap), options: OPTIONS, goal_node_id: 'goal', seed: '42', goal_constraints: constraints }),
  });
  expect(res.status).toBe(200);
  expect(islRequests.length, 'ISL was called').toBeGreaterThan(0);
  const seen = new Set<number>();
  for (const sent of islRequests) {
    const row = sent.find((c: any) => c.constraint_id === 'goal-limit');
    expect(row, 'goal-limit must reach the ISL wire').toBeDefined();
    seen.add(row.value);
  }
  expect(seen.size, 'one reading per run').toBe(1);
  return [...seen][0]!;
}

describe('F1b: a declared quantity under a declared cap reads on the cap at ANY value, alone or batched', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  }, 60_000);
  afterAll(async () => { await app?.close(); });

  it('PRECONDITION: "≤ 2 points" under cap 12 already reads 2/12 (the gate opens above 1)', async () => {
    expect(await wireValue(baseUrl, 12, [limit('points', 2)])).toBeCloseTo(2 / 12, 6);
  });

  it('RED: "≤ 1 points" ALONE under cap 12 reads 1/12, never 1.0 (the top of the score)', async () => {
    expect(await wireValue(baseUrl, 12, [limit('points', 1)])).toBeCloseTo(1 / 12, 6);
  });

  it('RED: the same "≤ 1 points" alone and beside a gate-opener reads the SAME number', async () => {
    const alone = await wireValue(baseUrl, 12, [limit('points', 1)]);
    const batched = await wireValue(baseUrl, 12, [limit('points', 1), GATE_OPENER]);
    expect(alone).toBeCloseTo(batched, 9);
  });

  it('RED: a known count and a currency ≤ 1 under a cap read on the cap too ("≤ 1 count" / "≤ 0.5 £" under 100)', async () => {
    expect(await wireValue(baseUrl, 100, [limit('count', 1)])).toBeCloseTo(0.01, 9);
    expect(await wireValue(baseUrl, 100, [limit('£', 0.5)])).toBeCloseTo(0.005, 9);
  });

  it('CONTROL: no unit, and a fraction/ratio, under the same cap keep their forwarded-raw reading', async () => {
    expect(await wireValue(baseUrl, 12, [limit(undefined, 0.8)])).toBeCloseTo(0.8, 9);
    expect(await wireValue(baseUrl, 12, [limit('fraction', 0.3)])).toBeCloseTo(0.3, 9);
    expect(await wireValue(baseUrl, 12, [limit('ratio', 0.9)])).toBeCloseTo(0.9, 9);
  });

  it('CONTROL: with NO declared cap, "≤ 1 points" keeps its existing reading (this rule needs the cap)', async () => {
    islRequests = [];
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: '42', goal_constraints: [limit('points', 1)] }),
    });
    expect(res.status).toBe(200);
    const rows = islRequests.flat().filter((c: any) => c.constraint_id === 'goal-limit');
    expect(rows.length, 'control: the limit reaches ISL').toBeGreaterThan(0);
    for (const row of rows) expect(row.value).toBe(1);
  });
});
