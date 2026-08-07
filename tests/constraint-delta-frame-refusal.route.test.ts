/**
 * ROADMAP 2.878 F1 — REFUSING ONE DELTA CONSTRAINT MUST NOT DELETE EVERY OTHER
 * CONSTRAINT'S VERDICT.
 *
 * THE DEFECT THIS FILE EXISTS FOR, and it is the harm the refusal design
 * explicitly rejected the drop-the-frame alternative to avoid — reproduced by
 * the fix itself, in the half of the change that had no tests:
 *
 *   `buildConstraintFields` (routes/v2/run.ts) enforces an EXACT one-to-one
 *   correspondence between ISL's constraint results and the ACTIVE constraint
 *   list, and is handed `activeGoalConstraints`. The pre-existing temporal
 *   filter keeps that invariant by REPLACING the list *before* the active set
 *   is derived. The refusal drops ~700 lines later and originally never removed
 *   the constraint from the active set, so `results (N−1) !== active (N)`, the
 *   guard returned `constraints_status: 'unavailable'`, and the run reported
 *   **ZERO** constraint results — while the disclosure said "1 constraint was
 *   not evaluated". A partial-loss notice over a total loss is worse than
 *   silence.
 *
 * ⚠ WHY THE MODULE-LEVEL SUITE COULD NOT SEE IT. Its wire test passes
 * `out.constraints` — the ALREADY-FILTERED list — into the translator, so it
 * asserts absence from a list built by removing the item. It would stay green
 * no matter what `run.ts` did with the active set. Every assertion here goes
 * through the real route.
 *
 * THE ISL MOCK DERIVES ITS RESULTS FROM THE CONSTRAINTS IT ACTUALLY RECEIVED
 * rather than returning a hardcoded list. That is deliberate: a fixed mock
 * would return N results regardless of what PLoT forwarded, which is exactly
 * the blindness that let the count mismatch ship. Deriving makes the mock a
 * witness to the wire — if PLoT forwards the refused constraint after all, the
 * mock echoes it back and the ISOLATOR/PROBE distinction collapses.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

/** Every `goal_constraints` array ISL was handed, in call order. */
let islRequests: any[][] = [];

/** Build one ISL constraint result per constraint actually received. */
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
// Fixtures — constraint targets carry observed values so their ranges derive
// from real data (inferred_value), matching tests/cil-constraint-passthrough.
// -----------------------------------------------------------------------------

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', goal_threshold_frame: 'delta', label: 'Revenue', observed_state: { value: 15000 } },
    { id: 'factor-a', kind: 'factor', label: 'Market Size' },
    { id: 'factor-b', kind: 'factor', label: 'Retention', observed_state: { value: 4000 } },
    { id: 'factor-c', kind: 'factor', label: 'Unit cost', observed_state: { value: 100 } },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
    { from: 'factor-b', to: 'goal', strength: { mean: 0.7, std: 0.1 } },
    { from: 'factor-c', to: 'goal', strength: { mean: 0.3, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': 1.5 } },
  { id: 'opt2', label: 'Option 2', interventions: { 'factor-b': 2.0 } },
];

const BASE_PAYLOAD = { graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: '42' };

/** Two ordinary LEVEL constraints — the verdicts that must survive. */
const TWO_LEVELS = [
  { constraint_id: 'revenue-min', node_id: 'goal', operator: '>=', value: 20000 },
  { constraint_id: 'retention-max', node_id: 'factor-b', operator: '<=', value: 5000 },
];

/**
 * The reduction constraint, in the shape CEE mints it
 * (`extractor.ts` — `operator: '<=', value: -N, valueFrame: 'delta'`).
 * `frame` is the ONE field the ISOLATOR varies.
 */
const reduction = (frame: 'delta' | 'level') => ({
  constraint_id: 'cost-reduce',
  node_id: 'factor-c',
  operator: '<=',
  value: -0.15,
  value_frame: frame,
  unit: 'fraction',
  label: 'Unit cost down by 15%',
});

async function run(app: string, goal_constraints: any[]) {
  islRequests = [];
  const res = await fetch(`${app}/v2/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...BASE_PAYLOAD, goal_constraints }),
  });
  expect(res.status).toBe(200);
  return res.json();
}

describe('2.878 F1 — a refused delta must not destroy its siblings verdicts', () => {
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

  it('CONTROL: two level constraints alone are computed and both delivered', async () => {
    const body = await run(baseUrl, TWO_LEVELS);

    expect(body.constraints_status).toBe('computed');
    expect((body.constraint_results ?? []).map((r: any) => r.constraint_id).sort())
      .toEqual(['retention-max', 'revenue-min']);
  });

  it('DEFECT: adding a REFUSED delta leaves both level verdicts intact', async () => {
    const body = await run(baseUrl, [...TWO_LEVELS, reduction('delta')]);

    // THE BLOCK. Before the fix this was 'unavailable' with zero results.
    expect(body.constraints_status).toBe('computed');

    const ids = (body.constraint_results ?? []).map((r: any) => r.constraint_id).sort();
    expect(ids).toEqual(['retention-max', 'revenue-min']);

    // Bind by identity: the refused one is absent, the siblings are present.
    expect(ids).not.toContain('cost-reduce');
  });

  it('DEFECT: the refused constraint never reaches the ISL wire — asserted on the REAL payload', async () => {
    await run(baseUrl, [...TWO_LEVELS, reduction('delta')]);

    expect(islRequests.length).toBeGreaterThan(0);
    for (const sent of islRequests) {
      const ids = sent.map((c: any) => c.constraint_id);
      expect(ids).not.toContain('cost-reduce');
      // …and the siblings DID travel, so this is not vacuous absence.
      expect(ids).toContain('revenue-min');
      expect(ids).toContain('retention-max');
    }
  });

  it('ISOLATOR / DISCRIMINATING PAIR: the SAME payload with value_frame "level" delivers all THREE', async () => {
    // Byte-identical but for one string. If this arm ever stops delivering 3,
    // the refusal has started catching levels and the separation has broken.
    const body = await run(baseUrl, [...TWO_LEVELS, reduction('level')]);

    expect(body.constraints_status).toBe('computed');
    expect((body.constraint_results ?? []).map((r: any) => r.constraint_id).sort())
      .toEqual(['cost-reduce', 'retention-max', 'revenue-min']);
  });

  it('DEFECT: the refusal is disclosed by name in _meta.filtered_constraints', async () => {
    const body = await run(baseUrl, [...TWO_LEVELS, reduction('delta')]);

    const filtered = body._meta?.filtered_constraints ?? [];
    const row = filtered.find((f: any) => f.constraint_id === 'cost-reduce');
    expect(row).toBeDefined();
    expect(row.reason).toBe('delta_frame_value_altered_by_normalisation');
    expect(row.node_id).toBe('factor-c');
  });

  it('DEFECT: a CONSTRAINT_REFUSED_FRAME_FIDELITY critique names it, and does not block the run', async () => {
    const body = await run(baseUrl, [...TWO_LEVELS, reduction('delta')]);

    const critiques = body.critiques ?? [];
    const c = critiques.find((x: any) => x.code === 'CONSTRAINT_REFUSED_FRAME_FIDELITY');
    expect(c).toBeDefined();
    expect(c.severity).toBe('warning');
    expect(c.blocks_analysis).toBe(false);
    expect(c.message).toContain('cost-reduce');
    expect(c.affected_node_ids).toContain('factor-c');

    // The count in the notice must be TRUE of what happened — the original
    // defect said "1 constraint(s) were not evaluated" while in fact ZERO were.
    expect(c.message).toContain('1 constraint(s) were not evaluated');
    expect(body.constraints_status).toBe('computed');
  });

  it('PIN: a run with NO refusal discloses nothing and is byte-unchanged in these fields', async () => {
    const body = await run(baseUrl, TWO_LEVELS);

    const filtered = body._meta?.filtered_constraints ?? [];
    expect(filtered.find((f: any) => f.constraint_id === 'cost-reduce')).toBeUndefined();
    expect((body.critiques ?? []).find((x: any) => x.code === 'CONSTRAINT_REFUSED_FRAME_FIDELITY'))
      .toBeUndefined();
  });

  it('DEFECT (F9): a refused constraint discloses NO scale provenance — with a positive control', async () => {
    const body = await run(baseUrl, [...TWO_LEVELS, reduction('delta')]);

    const results = body.constraint_results ?? [];

    // ⚠ POSITIVE CONTROL FIRST. `scale_provenance` rides on each
    // `constraint_results[]` row, so an "it is absent" assertion is vacuous
    // unless the field is demonstrably POPULATED for the constraints that DID
    // travel. Prove the instrument can see a presence before trusting it about
    // an absence.
    const survivors = results.filter((r: any) =>
      r.constraint_id === 'revenue-min' || r.constraint_id === 'retention-max');
    expect(survivors).toHaveLength(2);
    for (const s of survivors) {
      expect(s.scale_provenance).toBeDefined();
      // Field is `source` (RangeSource) — derived from
      // `ConstraintScaleProvenance` in types/engine-v3.ts, not assumed.
      expect(typeof s.scale_provenance.source).toBe('string');
      expect(typeof s.scale_provenance.range_unified).toBe('boolean');
    }

    // Now the absence is meaningful: the refused constraint was never sent, so
    // it must carry no provenance claim anywhere. Left in the active set it
    // would have disclosed as `source: 'default', range_unified: true` — i.e.
    // as a constraint that WAS forwarded raw — a wrong disclosure about a
    // constraint that never travelled.
    expect(results.map((r: any) => r.constraint_id)).not.toContain('cost-reduce');
  });
});
