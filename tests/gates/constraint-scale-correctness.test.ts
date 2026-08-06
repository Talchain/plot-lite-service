/**
 * SCIENTIFIC REGRESSION GATE — WP1: Constraint scale & correctness
 * ----------------------------------------------------------------------------
 * Pins the PLoT/ISL-owned constraint invariants so they cannot silently
 * regress. All assertions are cheap, deterministic, mocked and network-free
 * (unit calls on pure normalisation functions + one `app.inject` HTTP pin
 * against a mocked ISL). Safe for the normal pre-push/CI suite.
 *
 * What this gate protects:
 *   A. Scale SYMMETRY — goal constraints use the *same* [0,1] gate and the
 *      *same* deriveRange/normaliseValue machinery as interventions. There is
 *      no PLoT-side scale bypass. (The "constraints bypass the intervention
 *      scale shim" concern, if it ever bites, originates in CEE request
 *      construction — see the V5 handoff note in the lane plan.)
 *   B. original_value preservation through normalisation.
 *   C. HONEST status — a present-but-empty ISL `constraint_analysis.constraints`
 *      array must NOT be reported as `constraints_status: 'computed'`; it is
 *      `'unavailable'` (no per-constraint results were actually produced).
 *   D. HONEST drops — temporal/deadline constraints are filtered before ISL and
 *      recorded (the records feed `_meta.filtered_constraints`). End-to-end
 *      temporal surfacing is additionally covered by
 *      tests/golden/temporal-filter-e2e.test.ts and
 *      tests/temporal-constraint-filter.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import {
  needsNormalisation,
  constraintsNeedNormalisation,
  normaliseGoalConstraints,
  normaliseOptionsForISL,
} from '../../src/lib/intervention-normaliser.js';
import { filterTemporalConstraints } from '../../src/normalisation/constraint-filter.js';
// ROADMAP 2.744: producer-derived option fixtures. See tests/helpers/isl-option-fixture.ts.
import { makeOptionResultV2, finiteOutcome } from '../helpers/isl-option-fixture.js';
import type {
  GoalConstraint,
  EngineNodeV3,
  OptionV3,
  RawGoalConstraint,
} from '../../src/types/engine-v3.js';

// ===========================================================================
// Part A/B/D — pure-function unit pins (no server, no ISL)
// ===========================================================================

describe('WP1 gate · constraint scale symmetry (PLoT-owned)', () => {
  it('uses the IDENTICAL [0,1] gate for constraints and interventions', () => {
    // Same numeric decisions on both paths: value < 0 || value > 1 ⇒ normalise.
    const userScale = [20000, 1.5, -3, 110];
    const alreadyNormalised = [0, 0.5, 1, 0.999];

    for (const v of userScale) {
      const opt = { interventions: { f: { value: v } } } as unknown as OptionV3;
      const con: GoalConstraint = { constraint_id: 'c', node_id: 'goal', operator: '>=', value: v };
      expect(constraintsNeedNormalisation([con])).toBe(true);
      // Symmetry: the intervention gate agrees for the same value.
      expect(needsNormalisation([opt])).toBe(constraintsNeedNormalisation([con]));
    }

    for (const v of alreadyNormalised) {
      const opt = { interventions: { f: { value: v } } } as unknown as OptionV3;
      const con: GoalConstraint = { constraint_id: 'c', node_id: 'goal', operator: '<=', value: v };
      expect(constraintsNeedNormalisation([con])).toBe(false);
      expect(needsNormalisation([opt])).toBe(constraintsNeedNormalisation([con]));
    }
  });

  it('normalises a user-scale constraint via shared deriveRange and preserves original_value', () => {
    // Goal node with an explicit range [0, 40000] (deriveRange source: 'explicit').
    const nodes = [
      { id: 'goal', kind: 'goal', goal_threshold_frame: 'delta', state_space: { range: { min: 0, max: 40000 } } },
    ] as unknown as EngineNodeV3[];

    const constraints: GoalConstraint[] = [
      { constraint_id: 'revenue-min', node_id: 'goal', operator: '>=', value: 20000 },
    ];

    const { constraints: normalised } = normaliseGoalConstraints(constraints, nodes);
    expect(normalised).toHaveLength(1);
    // 20000 on [0,40000] ⇒ 0.5 — identical formula an intervention would use.
    expect(normalised[0].value).toBeCloseTo(0.5, 10);
    // Original user-unit value preserved for honest response echo / denormalisation.
    expect(normalised[0].original_value).toBe(20000);
    // Value handed to ISL is in [0,1].
    expect(normalised[0].value).toBeGreaterThanOrEqual(0);
    expect(normalised[0].value).toBeLessThanOrEqual(1);
  });

  it('does NOT re-normalise an already-[0,1] constraint (gate is the call-site guard)', () => {
    // A probability-domain constraint already in [0,1] must pass the gate as
    // "no normalisation needed" — exactly as interventions in [0,1] do. This is
    // what prevents double-normalisation of already-normalised thresholds.
    const con: GoalConstraint = { constraint_id: 'p', node_id: 'goal', operator: '<=', value: 0.3 };
    expect(constraintsNeedNormalisation([con])).toBe(false);
  });

  // -------------------------------------------------------------------------
  // A3 STRENGTHENING — pin shared ARGUMENTS, not just shared functions.
  // The header claims "same deriveRange/normaliseValue machinery as
  // interventions", but every fixture above uses an explicit range or a single
  // inferred_value with no competing intervention spread — so both sides land
  // on the same range by luck, never because the SAME per-node range object was
  // threaded through. On a heuristic-range node the two calls DIVERGE (the
  // constraint bare-derives while interventions use the spread). These pins fail
  // if a future refactor reverts to bare constraint derivation.
  // -------------------------------------------------------------------------
  it('SHARED ARGUMENT: constraint and interventions on a spread node resolve the IDENTICAL range', () => {
    // cost: observed value 30000, NO cap, NO state_space.range → heuristic node.
    const nodes = [
      { id: 'goal', kind: 'goal', goal_threshold_frame: 'delta', label: 'Goal', observed_state: { value: 0.4 } },
      { id: 'cost', kind: 'factor', label: 'Cost', observed_state: { value: 30000 } },
    ] as unknown as EngineNodeV3[];
    const options = [
      { id: 'a', label: 'A', interventions: { cost: { value: 25000, source: 'user_specified' } } },
      { id: 'b', label: 'B', interventions: { cost: { value: 45000, source: 'user_specified' } } },
    ] as unknown as OptionV3[];

    // Interventions derive the spread range.
    const { context } = normaliseOptionsForISL(options, nodes, 'goal');
    const interventionRange = context.factors.get('cost')!.range;
    expect(interventionRange.source).toBe('inferred_spread');

    // NEGATIVE CONTROL: a BARE constraint derivation (no shared scale) DIVERGES.
    const bare = normaliseGoalConstraints(
      [{ constraint_id: 'c', node_id: 'cost', operator: '<=', value: 20000 }],
      nodes,
    );
    expect(bare.diagnostics[0].range.max).not.toBeCloseTo(interventionRange.max, 0);

    // POSITIVE: threading the intervention scale makes both sides share the
    // EXACT SAME range values — the shared-argument invariant.
    const shared = normaliseGoalConstraints(
      [{ constraint_id: 'c', node_id: 'cost', operator: '<=', value: 20000 }],
      nodes,
      { interventionScaleByNodeId: new Map([['cost', interventionRange]]) },
    );
    expect(shared.diagnostics[0].range.min).toBeCloseTo(interventionRange.min, 6);
    expect(shared.diagnostics[0].range.max).toBeCloseTo(interventionRange.max, 6);
    expect(shared.diagnostics[0].range.source).toBe(interventionRange.source);
  });
});

describe('WP1 gate · honest constraint drops (temporal)', () => {
  it('filters a deadline_metadata constraint and records it (feeds _meta.filtered_constraints)', () => {
    const nodes = [{ id: 'goal', kind: 'goal' }] as unknown as EngineNodeV3[];
    const constraints = [
      { constraint_id: 'within-12mo', node_id: 'goal', operator: '<=', value: 12, unit: 'months', deadline_metadata: { horizon_months: 12 } },
      { constraint_id: 'keep-me', node_id: 'goal', operator: '>=', value: 0.8 },
    ] as unknown as RawGoalConstraint[];

    const result = filterTemporalConstraints(constraints, nodes);

    // Dropped constraint is honestly recorded, not silently swallowed.
    expect(result.filtered).toHaveLength(1);
    expect(result.filtered[0].constraint_id).toBe('within-12mo');
    expect(result.filtered[0].reason).toBe('temporal_deadline');

    // The evaluable constraint survives.
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].constraint_id).toBe('keep-me');
  });
});

// ===========================================================================
// Part C — HTTP honesty pin: empty constraint_analysis.constraints ⇒ unavailable
// ===========================================================================
// Mirrors the established mocked-ISL harness from
// tests/cil-constraint-passthrough.test.ts, trimmed to what /v2/run needs to
// reach buildConstraintFields. Uses app.inject (no socket).

let mockConstraintAnalysis: any = undefined;
// When set, the mocked ISL option result carries this `status` so we can pin that an
// explicit upstream option failure surfaces as constraints_status:'error'.
// 2.744: must be one of ISL's real per-option values — 'computed' | 'partial' |
// 'failed'. It used to be set to 'error', an ENVELOPE-level value ISL never emits
// per option, which is precisely how the dead guard in run.ts stayed green.
let mockOptionStatus: string | undefined = undefined;
// When set, the mocked ISL returns these option results VERBATIM (full per-option
// control of status/constraint_analysis) instead of the uniform default mapping —
// used to build a MIXED response (one errored option + one valid-constraints option).
let mockOptionResults: any[] | undefined = undefined;

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [],
      backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return {
      options: mockOptionResults ?? options.map((opt: any, idx: number) => ({
        option_id: opt.id,
        outcome: { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
        rank: idx + 1,
        ...(mockOptionStatus && { status: mockOptionStatus }),
        ...(mockConstraintAnalysis && { constraint_analysis: mockConstraintAnalysis }),
      })),
      edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const, factors: [], value_of_information: [],
      factors_provenance: 'unavailable' as const, factor_sensitivity_status: 'skipped_no_factor_values' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.8, fragile_edges: [], robust_edges: [],
      latency_ms: 50, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    const options = body.options || [];
    return {
      data: {
        options: mockOptionResults ?? options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
          rank: idx + 1,
          ...(mockOptionStatus && { status: mockOptionStatus }),
          ...(mockConstraintAnalysis && { constraint_analysis: mockConstraintAnalysis }),
        })),
        edges: [], factors: [], value_of_information: [], overall_robustness: 'robust',
        robustness_score: 0.8, fragile_edges: [], robust_edges: [],
      } as T,
      error: null,
    };
  },
};

vi.mock('../../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

const { createServer } = await import('../../src/createServer.js');

const BASE_PAYLOAD = {
  graph: {
    nodes: [
      // observed_state.value gives deriveRange() a real inferred range
      // ([0, 80000], source 'inferred_value') for the 20000/50000 constraints
      // below. Without it the threshold normalisation falls back to the
      // default [0,1] range, which since lane 27 (ROADMAP 1.26a) honestly
      // reports constraints_status: 'unavailable' (unreliable target) — this
      // suite tests the buildConstraintFields correspondence/validity
      // mechanics, so its target must be RELIABLE. Reliability suppression
      // itself is pinned in tests/constraint-results-top-level-gating.fixture.test.ts.
      { id: 'goal', kind: 'goal', goal_threshold_frame: 'delta', label: 'Revenue', observed_state: { value: 40000 } },
      { id: 'factor-a', kind: 'factor', label: 'Market Size' },
    ],
    edges: [{ from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } }],
  },
  options: [
    { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': 1.5 } },
    { id: 'opt2', label: 'Option 2', interventions: { 'factor-a': 2.0 } },
  ],
  goal_node_id: 'goal',
  seed: '42',
};

const GOAL_CONSTRAINTS = [
  { constraint_id: 'revenue-min', node_id: 'goal', operator: '>=', value: 20000 },
];

// Two forwarded constraints on the goal node (a >= / <= range): used to pin the
// completeness requirement — every forwarded constraint must map to a valid result.
const TWO_CONSTRAINTS = [
  { constraint_id: 'revenue-min', node_id: 'goal', operator: '>=', value: 20000 },
  { constraint_id: 'cost-max', node_id: 'goal', operator: '<=', value: 50000 },
];

describe('WP1 gate · honest constraints_status (no fabricated "computed")', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
    mockConstraintAnalysis = undefined;
    mockOptionStatus = undefined;
    mockOptionResults = undefined;
  });

  async function run(payload: any) {
    const res = await app.inject({
      method: 'POST', url: '/v2/run',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    return { status: res.statusCode, body: res.json() };
  }

  it('REGRESSION: present-but-empty constraint_analysis.constraints ⇒ "unavailable", not "computed"', async () => {
    // ISL echoed the analysis object but evaluated zero constraints. Emitting
    // "computed" here would be a misleading wrong-200. (`[]` is truthy in JS,
    // which is exactly why the previous predicate matched it.)
    mockConstraintAnalysis = { constraints: [] };

    const { status, body } = await run({ ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });
    expect(status).toBe(200);
    expect(body.constraints_status).toBe('unavailable');
    expect(body.constraint_results).toBeUndefined();
  });

  it('POSITIVE CONTROL: non-empty constraint_analysis.constraints ⇒ "computed" with results', async () => {
    mockConstraintAnalysis = {
      constraints: [{ node_id: 'goal', operator: '>=', value: 20000, prob_satisfied: 0.85 }],
      joint_probability: 0.85,
    };

    const { status, body } = await run({ ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });
    expect(status).toBe(200);
    expect(body.constraints_status).toBe('computed');
    expect(body.constraint_results).toBeDefined();
    expect(body.constraint_results).toHaveLength(1);
    expect(body.constraint_results[0].probability).toBe(0.85);
  });

  it('CONTROL: no constraint_analysis at all ⇒ "unavailable" (unchanged behaviour)', async () => {
    mockConstraintAnalysis = undefined;
    const { status, body } = await run({ ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });
    expect(status).toBe(200);
    expect(body.constraints_status).toBe('unavailable');
    expect(body.constraint_results).toBeUndefined();
  });

  // --- Completeness & validity: non-empty is NOT sufficient for "computed" ---

  it('REGRESSION: a malformed result (non-finite prob_satisfied) ⇒ "unavailable", not "computed"', async () => {
    mockConstraintAnalysis = {
      constraints: [{ node_id: 'goal', operator: '>=', value: 20000, prob_satisfied: Number.NaN }],
    };
    const { status, body } = await run({ ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });
    expect(status).toBe(200);
    expect(body.constraints_status).toBe('unavailable');
    expect(body.constraint_results).toBeUndefined();
  });

  it('REGRESSION: an out-of-range prob_satisfied (>1) ⇒ "unavailable"', async () => {
    mockConstraintAnalysis = {
      constraints: [{ node_id: 'goal', operator: '>=', value: 20000, prob_satisfied: 1.5 }],
    };
    const { status, body } = await run({ ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });
    expect(status).toBe(200);
    expect(body.constraints_status).toBe('unavailable');
  });

  it('REGRESSION: one result for two forwarded constraints ⇒ "unavailable" (incomplete coverage)', async () => {
    // ISL evaluated only one of the two forwarded constraints; reporting "computed"
    // would falsely imply both were assessed.
    mockConstraintAnalysis = {
      constraints: [{ node_id: 'goal', operator: '>=', value: 20000, prob_satisfied: 0.85 }],
    };
    const { status, body } = await run({ ...BASE_PAYLOAD, goal_constraints: TWO_CONSTRAINTS });
    expect(status).toBe(200);
    expect(body.constraints_status).toBe('unavailable');
  });

  it('POSITIVE CONTROL: two forwarded constraints with two valid results ⇒ "computed"', async () => {
    mockConstraintAnalysis = {
      constraints: [
        { node_id: 'goal', operator: '>=', value: 20000, prob_satisfied: 0.85 },
        { node_id: 'goal', operator: '<=', value: 50000, prob_satisfied: 0.6 },
      ],
      joint_probability: 0.55,
    };
    const { status, body } = await run({ ...BASE_PAYLOAD, goal_constraints: TWO_CONSTRAINTS });
    expect(status).toBe(200);
    expect(body.constraints_status).toBe('computed');
    expect(body.constraint_results).toHaveLength(2);
  });

  // --- Codex round-2: exact one-to-one correspondence (not mere coverage) ---

  it('REGRESSION: duplicate result rows (two ISL results for one forwarded constraint) ⇒ "unavailable"', async () => {
    mockOptionStatus = undefined;
    // Both rows resolve to the same forwarded id (revenue-min) via (node_id,operator);
    // coverage passes but cardinality (2) ≠ forwarded (1) → must be 'unavailable'.
    mockConstraintAnalysis = {
      constraints: [
        { node_id: 'goal', operator: '>=', value: 20000, prob_satisfied: 0.85 },
        { node_id: 'goal', operator: '>=', value: 20000, prob_satisfied: 0.70 },
      ],
    };
    const { status, body } = await run({ ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });
    expect(status).toBe(200);
    expect(body.constraints_status).toBe('unavailable');
  });

  it('REGRESSION: an extraneous result row (id not forwarded) ⇒ "unavailable"', async () => {
    mockOptionStatus = undefined;
    // Second row maps to a synthetic id not in the forwarded set → resolved ⊄ forwarded.
    mockConstraintAnalysis = {
      constraints: [
        { node_id: 'goal', operator: '>=', value: 20000, prob_satisfied: 0.85 },
        { node_id: 'other-node', operator: '<=', value: 5, prob_satisfied: 0.5 },
      ],
    };
    const { status, body } = await run({ ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });
    expect(status).toBe(200);
    expect(body.constraints_status).toBe('unavailable');
  });

  // ---------------------------------------------------------------------------
  // ROADMAP 2.744 — these four cases were written against a wire that does not
  // exist. They set `option.status = 'error'`, which ISL's per-option Literal
  // (["computed","partial","failed"]) cannot emit, and the mixed-response
  // fixture also carried `rank` (not a property of OptionResultV2) and
  // `option_id` (the V1 name; V2's identity field is `id`) — three
  // impossibilities in one object literal.
  //
  // They were regenerated FROM THE PRODUCER, not re-spelled by hand:
  // `makeOptionResultV2` derives the legal property set, the required set and
  // the status enum from the vendored, Pydantic-generated
  // tests/fixtures/isl-pinned/isl-openapi.json and THROWS on any undeclared
  // key, missing required key, or out-of-enum status. Re-introducing any of
  // the three original errors now fails loudly at fixture-construction time
  // instead of passing green against a mirror carrying the same mistake.
  //
  // The substantive value is `'failed'`: ISL's determine_option_status returns
  // it exactly when n_valid === 0, which is the genuine "this option errored"
  // condition these cases were always trying to describe.
  // ---------------------------------------------------------------------------

  it('REGRESSION: an explicit upstream ISL option failure (option.status="failed") ⇒ "error", not "unavailable"', async () => {
    mockOptionStatus = 'failed';
    mockConstraintAnalysis = {
      constraints: [{ node_id: 'goal', operator: '>=', value: 20000, prob_satisfied: 0.85 }],
    };
    const { status, body } = await run({ ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });
    expect(status).toBe(200);
    expect(body.constraints_status).toBe('error');
    mockOptionStatus = undefined;
  });

  it('REGRESSION (Codex round-4): failed status with ABSENT constraint_analysis ⇒ "error", not "unavailable"', async () => {
    // The COMMON ISL failure shape: option.status="failed" with NO constraint_analysis
    // payload at all. The non-empty-constraints lookup finds nothing, so this must be
    // detected in the 'unavailable' branch and surfaced as 'error' — not hidden.
    mockOptionStatus = 'failed';
    mockConstraintAnalysis = undefined; // absent payload
    const { status, body } = await run({ ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });
    expect(status).toBe(200);
    expect(body.constraints_status).toBe('error');
    expect(body.constraint_results).toBeUndefined();
    mockOptionStatus = undefined;
  });

  it('REGRESSION (Codex round-4): failed status with EMPTY constraint_analysis.constraints ⇒ "error"', async () => {
    // Present-but-empty constraints + failed status: also the no-usable-payload path,
    // and an explicit failure must win over a bare 'unavailable'.
    mockOptionStatus = 'failed';
    mockConstraintAnalysis = { constraints: [] };
    const { status, body } = await run({ ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });
    expect(status).toBe(200);
    expect(body.constraints_status).toBe('error');
    mockOptionStatus = undefined;
  });

  it('POLICY (Codex round-5): MIXED response — one failed option (no constraints) + one valid result ⇒ "computed"', async () => {
    // Deliberate round-4 policy: an option-level failure does NOT override another
    // option's valid constraint computation. Constraint analysis is per-option, so a
    // valid result means constraints WERE computed; the failed option's failure is
    // carried in its own option status, not in constraints_status. Lock it down.
    mockOptionResults = [
      // Failed, NO constraint_analysis. `rank` and `option_id` are gone because
      // the builder rejects them — ISL declares neither on OptionResultV2.
      makeOptionResultV2({ id: 'opt1', outcome: finiteOutcome(0.7), status: 'failed' }),
      makeOptionResultV2({
        id: 'opt2', outcome: finiteOutcome(0.7), status: 'computed',
        constraint_analysis: { constraints: [{ node_id: 'goal', operator: '>=', value: 20000, prob_satisfied: 0.85 }] },
      }),
    ];
    const { status, body } = await run({ ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });
    expect(status).toBe(200);
    expect(body.constraints_status).toBe('computed');           // valid result is authoritative
    expect(body.constraint_results).toHaveLength(1);
    expect(body.constraint_results[0].probability).toBe(0.85);
    mockOptionResults = undefined;
  });
});
