/**
 * A CONSTRAINT THAT NEVER REACHED THE ENGINE MUST NOT LEAVE THE RUN SILENT.
 *
 * `buildConstraintFields` returns `{}` — every constraint field omitted — when
 * the active constraint list is empty. That is correct for a decision that
 * states no constraints. It is a LIE for a decision that states one and has it
 * withheld, and TWO producers reach it that way:
 *
 *   · THE TEMPORAL FILTER. "We must ship by March" carries `deadline_metadata`
 *     and is dropped before ISL — time is not a modelled dimension. When every
 *     constraint is temporal the compiled list is empty, `activeGoalConstraints`
 *     is never assigned, and the user gets TOTAL SILENCE about the one limit
 *     they stated.
 *   · A REFUSAL (ROADMAP 2.878). The refusal MUST leave the active list, or the
 *     one-to-one guard collapses every SIBLING's verdict to zero results (2.878
 *     F1, proven by execution). When the refused constraint is the only one,
 *     that same removal empties the list.
 *
 * **AN OMITTED `constraints_status` IS BYTE-IDENTICAL TO "THIS DECISION STATES
 * NO CONSTRAINTS."** PLoT has already written the reason into
 * `_meta.filtered_constraints` and raised a typed critique — and then reports
 * the run as though no constraint ever existed. A consumer reading absence has
 * nothing to disclose and no reason to look for the reason already sitting in
 * the payload.
 *
 * That is the ratified eligibility doctrine's third clause breached by
 * omission: *if compliance cannot be evaluated, say so and name what is
 * missing.* Both arms are measured RED at pristine `7e5d8a7` (T1, T2).
 *
 * The fix reports `unavailable` — "constraints exist; this run has no verdict
 * on them". T3 pins the other direction: a run that genuinely states no
 * constraints still omits every constraint field, so `unavailable` is a
 * discrimination and not a constant.
 *
 * THE ISL MOCK DERIVES ITS RESULTS FROM THE CONSTRAINTS IT ACTUALLY RECEIVED
 * (same discipline as tests/constraint-delta-frame-refusal.route.test.ts): a
 * fixed mock would echo N results whatever PLoT forwarded, which is exactly the
 * blindness that lets a wire claim be asserted against a list built by removing
 * the item.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

/** Every `goal_constraints` array ISL was handed, in call order. */
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
    // THE WIRE. This is the payload the translator built.
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

// -----------------------------------------------------------------------------
// Fixture
// -----------------------------------------------------------------------------

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Support quality', observed_state: { value: 0.4 } },
    { id: 'market', kind: 'factor', label: 'Market Size', observed_state: { value: 0.3 } },
    // A producer-declared cap ⇒ deriveRange priority 0, `explicit_cap [0,8000]`,
    // and not intervened by any option — so this constraint delivers a verdict
    // and can serve as the positive control and the surviving sibling.
    { id: 'retention', kind: 'factor', label: 'Retained accounts', observed_state: { value: 4000, cap: 8000 } },
    // observed_state.value = 100 ⇒ `inferred_value [0,200]`, so a delta-framed
    // value is re-scaled by normalisation and hits the 2.878 refusal.
    { id: 'spend-scaled', kind: 'factor', label: 'Year one spend', observed_state: { value: 100 } },
  ],
  edges: [
    { from: 'market', to: 'goal', strength: { mean: 0.4, std: 0.1 } },
    { from: 'retention', to: 'goal', strength: { mean: 0.3, std: 0.1 } },
    { from: 'spend-scaled', to: 'goal', strength: { mean: 0.2, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt1', label: 'Option 1', interventions: { 'market': 0.5 } },
  { id: 'opt2', label: 'Option 2', interventions: { 'market': 0.8 } },
];

const BASE_PAYLOAD = { graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: '42' };

/** The shape CEE mints for "reduce X by N" — refused by ROADMAP 2.878. */
const REFUSED_DELTA = {
  constraint_id: 'cost-reduce',
  node_id: 'spend-scaled',
  operator: '<=',
  value: -0.15,
  value_frame: 'delta',
  label: 'Unit cost down by 15%',
};

/** Dropped by the TEMPORAL filter — a different producer, a different class. */
const TEMPORAL_DROPPED = {
  constraint_id: 'ship-by',
  node_id: 'spend-scaled',
  operator: '<=',
  value: 6,
  unit: 'months',
  label: 'Ship within six months',
  deadline_metadata: { deadline: '2027-01-01' },
};

/** An ordinary constraint on a producer-capped node — it must still deliver. */
const SIBLING = {
  constraint_id: 'retention-min',
  node_id: 'retention',
  operator: '>=',
  value: 3000,
  label: 'Retention floor',
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

describe('a refused constraint reports "unavailable", never silence', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterAll(async () => { await app?.close(); });

  // ---------------------------------------------------------------------------
  // T1 — THE DEFECT, producer 1 of 2: a REFUSAL.
  // ---------------------------------------------------------------------------
  it('T1: a sole REFUSED constraint reports constraints_status "unavailable" — not absent', async () => {
    const body = await run(baseUrl, [REFUSED_DELTA]);

    // PIN THE PRECONDITION (trap 13b): it really was refused, by identity and
    // by reason — otherwise this arm could pass on a run that refused nothing.
    const row = (body._meta?.filtered_constraints ?? [])
      .find((f: any) => f.constraint_id === 'cost-reduce');
    expect(row).toBeDefined();
    expect(row.reason).toBe('delta_frame_value_altered_by_normalisation');
    expect(row.node_id).toBe('spend-scaled');

    // …and it genuinely never reached the wire, so the emptiness is real.
    expect(islRequests.length).toBeGreaterThan(0);
    expect(islRequests.flat().map((c: any) => c.constraint_id)).not.toContain('cost-reduce');

    // THE BRANCH. `undefined` at pristine.
    expect(body.constraints_status).toBe('unavailable');
    expect(body.constraint_results ?? []).toHaveLength(0);

    // …and the reason the consumer needs is beside it, already typed.
    const critique = (body.critiques ?? [])
      .find((c: any) => c.code === 'CONSTRAINT_REFUSED_FRAME_FIDELITY');
    expect(critique).toBeDefined();
    expect(critique.blocks_analysis).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // T2 — THE DEFECT, producer 2 of 2: the TEMPORAL FILTER. One predicate has to
  // cover both, or the producer nobody remembers is the one that stays silent
  // (trap 21 — two guards under one name).
  // ---------------------------------------------------------------------------
  it('T2: a sole TEMPORAL-filtered constraint reports "unavailable" — a deadline is not silence', async () => {
    const body = await run(baseUrl, [TEMPORAL_DROPPED]);

    // PIN THE PRECONDITION: dropped, and by the TEMPORAL filter — a DIFFERENT
    // producer from T1's refusal, so the two arms cannot pass for one reason.
    const row = (body._meta?.filtered_constraints ?? [])
      .find((f: any) => f.constraint_id === 'ship-by');
    expect(row).toBeDefined();
    expect(row.reason).toBe('temporal_deadline');
    expect(islRequests.flat().map((c: any) => c.constraint_id)).not.toContain('ship-by');

    // THE BRANCH. `undefined` at pristine — the user who said "ship by March"
    // was told nothing at all.
    expect(body.constraints_status).toBe('unavailable');

    // …and the reason is already typed and beside it.
    const critique = (body.critiques ?? [])
      .find((c: any) => c.code === 'CONSTRAINT_FILTERED_TEMPORAL');
    expect(critique).toBeDefined();
    expect(critique.blocks_analysis).toBe(false);
    expect(critique.affected_node_ids).toContain('spend-scaled');
  });

  // ---------------------------------------------------------------------------
  // T3 — NEGATIVE CONTROL. Silence is still correct when it is TRUE.
  // ---------------------------------------------------------------------------
  it('T3 (CONTROL): a run with genuinely NO constraints still omits every constraint field', async () => {
    const body = await run(baseUrl, []);

    expect(body.constraints_status).toBeUndefined();
    expect(body.constraint_results).toBeUndefined();
    expect((body._meta?.filtered_constraints ?? [])).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // T4 — POSITIVE CONTROL. The block is reachable in this fixture at all, so
  // T1's 'unavailable' and T2/T3's absence are discriminations rather than a
  // constant this fixture always produces.
  // ---------------------------------------------------------------------------
  it('T4 (CONTROL): an ordinary constraint still computes', async () => {
    const body = await run(baseUrl, [SIBLING]);

    expect(body.constraints_status).toBe('computed');
    expect((body.constraint_results ?? []).map((r: any) => r.constraint_id))
      .toEqual(['retention-min']);
  });

  // ---------------------------------------------------------------------------
  // T5 — a refusal ALONGSIDE a survivor still computes (the 2.878 F1 harm must
  // stay closed): the branch only fires when the list is genuinely emptied.
  // ---------------------------------------------------------------------------
  it('T5: a refusal alongside a surviving constraint still reports "computed"', async () => {
    const body = await run(baseUrl, [REFUSED_DELTA, SIBLING]);

    expect((body._meta?.filtered_constraints ?? [])
      .find((f: any) => f.constraint_id === 'cost-reduce')).toBeDefined();
    expect(body.constraints_status).toBe('computed');
    expect((body.constraint_results ?? []).map((r: any) => r.constraint_id))
      .toEqual(['retention-min']);
  });
});
