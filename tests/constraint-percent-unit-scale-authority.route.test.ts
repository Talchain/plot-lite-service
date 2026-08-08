/**
 * ROADMAP 2.957 — BATCH-INVARIANCE, ASSERTED ON THE REAL ISL WIRE.
 *
 * ⚠ WHY A ROUTE TEST IS NOT REDUNDANT WITH THE MODULE SUITE. The invocation
 * decision lives in `routes/v2/run.ts`, not in `normaliseGoalConstraints`: when
 * the legacy gate reads false and no node carries a non-identity intervention
 * scale, the route's `else` arm forwards `activeGoalConstraints` VERBATIM and
 * the normaliser never runs. A module-level suite calls the normaliser directly,
 * so it cannot observe that arm at all — it would stay green with the route
 * disjunct deleted. Every assertion here reads the payload the translator
 * actually built.
 *
 * THE PROPERTY: the value PLoT sends for a constraint is a function of THAT
 * CONSTRAINT ALONE. Each case below is run twice against byte-identical
 * payloads but for the presence of an unrelated, out-of-range batch-mate, and
 * the '%' row's wire value must be the same both times — and must be the value
 * the PRODUCER meant:
 *
 *   {unit:'%', value:0.04}  → 0.04   (CEE's LLM emits "4%" as 0.04 — a FRACTION
 *                                     under a '%' label; NOT 0.0004)
 *   {unit:'%', value:1}     → 0.01   (CEE reads '%' with value >= 1 as
 *                                     PERCENTAGE POINTS; NOT 1.0)
 *   {unit:'%', value:40}    → 0.4    (unchanged behaviour, pinned as a control)
 *
 * ⚠ THE FIXTURE PINS ITS OWN PRECONDITION (trap 13b). The no-batch-mate arm is
 * only meaningful if it genuinely reproduces the GATE-CLOSED state: all
 * interventions inside [0,1] (Phase 4a skipped ⇒ every intervention scale is
 * identity) and no out-of-range constraint. The PRECONDITION test observes a
 * NON-percent constraint being forwarded raw — an outcome possible only when
 * both legacy disjuncts are false. If either drifts, it REDs rather than
 * letting the other arms pass for an unrelated reason.
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

const churn = (unit: string, value: number) => ({
  constraint_id: 'churn-cap',
  node_id: 'factor-c',
  operator: '<=',
  value,
  unit,
  label: 'Churn target',
});

/** Unrelated, out-of-range, NON-percent — its only job is to open the gate. */
const GATE_OPENER = {
  constraint_id: 'revenue-min',
  node_id: 'goal',
  operator: '>=',
  value: 20_000,
  unit: '£',
  label: 'Revenue floor',
};

async function run(baseUrl: string, goal_constraints: any[]) {
  islRequests = [];
  const res = await fetch(`${baseUrl}/v2/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...BASE_PAYLOAD, goal_constraints }),
  });
  expect(res.status).toBe(200);
  return res.json();
}

/** The value ISL was actually handed for `churn-cap` on every recorded call. */
function churnWire(): number[] {
  expect(islRequests.length).toBeGreaterThan(0);
  const seen: number[] = [];
  for (const sent of islRequests) {
    const row = sent.find((c: any) => c.constraint_id === 'churn-cap');
    expect(row, 'churn-cap must reach the ISL wire').toBeDefined();
    seen.push(row.value);
  }
  expect(seen.length).toBeGreaterThan(0);
  return seen;
}

describe('2.957 route — a % threshold reaches ISL with the same meaning, alone or batched', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    // The global hookTimeout is 10s and a COLD vitest cache spends ~8s
    // transforming before `createServer` is reached — measured. A route suite
    // that reds only on a cold cache is a flake, and a flake in a wrong-number
    // guard is worse than no guard.
  }, 60_000);

  afterAll(async () => { await app?.close(); });

  it('PRECONDITION: the no-batch-mate arm is genuinely GATE-CLOSED', async () => {
    // A non-percent 0.9 forwarded raw is only possible when BOTH legacy
    // disjuncts are false. If this reds, every "alone" arm below is void.
    await run(baseUrl, [churn('count', 0.9)]);
    for (const v of churnWire()) expect(v).toBe(0.9);
  });

  it('0.04 with unit "%" reaches ISL as 0.04 — alone AND batched (not 0.0004)', async () => {
    await run(baseUrl, [churn('%', 0.04)]);
    const alone = churnWire();
    await run(baseUrl, [churn('%', 0.04), GATE_OPENER]);
    const batched = churnWire();

    for (const v of alone) expect(v).toBeCloseTo(0.04, 12);
    for (const v of batched) expect(v).toBeCloseTo(0.04, 12);
    expect(alone[0]).toBe(batched[0]);
    // The refuted direction, named so a regression is unmistakable.
    expect(batched[0]).not.toBeCloseTo(0.0004, 12);
  });

  it('1 with unit "%" reaches ISL as 0.01 — alone AND batched (not 1.0)', async () => {
    // The cell the route disjunct exists for: value 1 opens no gate.
    await run(baseUrl, [churn('%', 1)]);
    const alone = churnWire();
    await run(baseUrl, [churn('%', 1), GATE_OPENER]);
    const batched = churnWire();

    for (const v of alone) expect(v).toBeCloseTo(0.01, 12);
    for (const v of batched) expect(v).toBeCloseTo(0.01, 12);
    expect(alone[0]).toBe(batched[0]);
    expect(alone[0]).not.toBe(1);
  });

  it('CONTROL: 40 with unit "%" reaches ISL as 0.4 — unchanged behaviour', async () => {
    await run(baseUrl, [churn('%', 40)]);
    for (const v of churnWire()) expect(v).toBeCloseTo(0.4, 12);
  });

  it('DISCRIMINATING PAIR: same value, different unit string, different wire value', async () => {
    await run(baseUrl, [churn('%', 1)]);
    const pct = churnWire();
    await run(baseUrl, [churn('count', 1)]);
    const cnt = churnWire();
    expect(pct[0]).toBeCloseTo(0.01, 12);
    expect(cnt[0]).toBe(1);
    expect(pct[0]).not.toBe(cnt[0]);
  });

  it('CONTROL: the run still succeeds and delivers the constraint verdict', async () => {
    const body = await run(baseUrl, [churn('%', 0.04)]);
    expect(body.constraints_status).toBe('computed');
    expect((body.constraint_results ?? []).map((r: any) => r.constraint_id)).toContain('churn-cap');
  });
});
