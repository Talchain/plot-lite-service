/**
 * ROADMAP 2.258 — the goal target must reach ISL WITH ITS FRAME, or reach it
 * honestly unstamped.
 *
 * WHY THIS FILE EXISTS. 2.239 (#299) got `goal_threshold` onto the ISL request.
 * That was necessary and not sufficient: the number it delivered was a
 * STRUCTURAL ZERO. CEE mints `goal_threshold` as a normalised LEVEL (0.8 == a
 * £6.0m target against a £7.5m cap), while a non-root goal's ISL samples are,
 * per doctrine B, the forward-propagated composition of its parents measured
 * from an origin of `intercept` — a CHANGE, not a level. Comparing a level
 * against change-from-origin samples is a category error, and the product
 * rendered its output as "< 1% chance of hitting your goal". #299 was reverted
 * on 2026-08-01 for exactly that reason.
 *
 * ISL #118 (`29cb4e27`) closes it with a request-level attestation,
 * `goal_threshold_frame: 'level' | 'delta'`, and FAILS CLOSED when it is
 * missing. PLoT's job — the whole of it — is to FORWARD what the producer
 * stamped and to invent nothing.
 *
 * THE ASSERTION SURFACE. Every test below reads the OUTBOUND ISL REQUEST BODY.
 * A 200 proves a response, not a computation, and the frame is a request-side
 * field — it is invisible anywhere else.
 *
 * ⚠ A NOTE ON WHAT "UNSTAMPED" DOES, because the distinction decides the
 * design and is easy to get wrong from prose. ISL does NOT reject an unstamped
 * request. `_resolve_goal_threshold` (robustness_analyzer_v2.py:3108-3147)
 * returns `(None, warning)`: `probability_of_goal` is OMITTED and a
 * GOAL_THRESHOLD_FRAME_UNSPECIFIED InferenceWarning rides back at severity
 * 'warning'. The run succeeds. So forwarding an unstamped threshold yields
 * "no number PLUS a named reason", whereas clearing it PLoT-side would yield
 * "no number and nothing to disclose" — ISL returns `(None, None)` when no
 * threshold arrives at all. T7/T8 pin the forwarding choice.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { filterTemporalConstraints } from '../src/normalisation/constraint-filter.js';
import type { EngineNodeV3, GoalConstraint } from '../src/types/engine-v3.js';
type RawGoalConstraint = GoalConstraint & Record<string, unknown>;

// ---------------------------------------------------------------------------
// ISL mock — captures the outbound request body verbatim.
// ---------------------------------------------------------------------------

let capturedISLRequestBody: any = null;

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
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return {
      options: options.map((opt: any, idx: number) => ({
        option_id: opt.id,
        outcome: { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
        rank: idx + 1,
      })),
      edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factors: [], value_of_information: [],
      factors_provenance: 'unavailable' as const,
      factor_sensitivity_status: 'skipped_no_factor_values' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.8,
      fragile_edges: [], robust_edges: [], latency_ms: 50, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    capturedISLRequestBody = body;
    const options = body.options || [];
    return {
      data: {
        options: options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
          rank: idx + 1,
        })),
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

const { createServer } = await import('../src/createServer.js');

// ---------------------------------------------------------------------------
// Fixtures — the 2026-08-01 walk's S1 shape, reduced.
// ---------------------------------------------------------------------------

const OPTIONS = [
  { id: 'opt1', label: 'Ship fast', interventions: { lever: 0.9 } },
  { id: 'opt2', label: 'Ship slow', interventions: { lever: 0.2 } },
];

/**
 * Goal node carrying whatever CEE stamped. `observed_state.baseline` is present
 * on purpose: ISL REQUIRES it to convert a 'level' threshold
 * (`missing_goal_baseline` is one of its refusal reasons), so the graph shape
 * that makes 'level' usable is the one worth testing against.
 */
function graphWithGoal(goalOverrides: Record<string, unknown> = {}) {
  return {
    nodes: [
      {
        id: 'goal_arr',
        kind: 'goal',
        label: 'Reach 6M ARR Within 12 Months',
        observed_state: { value: 0.4, baseline: 0.35, unit: '£' },
        ...goalOverrides,
      },
      { id: 'lever', kind: 'factor', label: 'Sales headcount', observed_state: { value: 0.5 } },
      { id: 'other', kind: 'factor', label: 'Market', observed_state: { value: 0.3 } },
    ],
    edges: [
      { from: 'lever', to: 'goal_arr', strength: { mean: 0.6, std: 0.1 } },
      { from: 'other', to: 'goal_arr', strength: { mean: 0.3, std: 0.1 } },
    ],
  };
}

/** CEE's goal node for a stated target, with no frame stamped (today's live shape). */
const GOAL_TARGET_UNSTAMPED = {
  goal_threshold: 0.65,
  goal_threshold_raw: 6000000,
  goal_threshold_unit: '£',
  goal_threshold_cap: 9000000,
  provenance: 'ai_inferred',
};

/** The exact deadline constraint CEE attached on the 2026-08-01 walk. */
const DEADLINE_CONSTRAINT = {
  constraint_id: 'constraint_goal_arr_max',
  node_id: 'goal_arr',
  operator: '<=' as const,
  value: 12,
  label: 'Delivery deadline',
  unit: 'months',
  source_quote: 'within 12 months',
  confidence: 0.95,
  provenance: 'inferred',
  deadline_metadata: {
    deadline_date: '2027-08-01',
    reference_date: '2026-08-01',
    assumed_reference_date: true,
  },
};

describe('ROADMAP 2.258 — goal_threshold_frame reaches the ISL request', () => {
  let app: FastifyInstance;
  const warnCalls: any[] = [];

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
    capturedISLRequestBody = null;
  });

  async function run(payload: Record<string, unknown>) {
    capturedISLRequestBody = null;
    warnCalls.length = 0;

    const originalChildLogger = app.log.child.bind(app.log);
    const spy = vi.spyOn(app.log, 'child').mockImplementation((...args: any[]) => {
      const child = originalChildLogger(...args);
      const originalWarn = child.warn.bind(child);
      child.warn = (...warnArgs: any[]) => { warnCalls.push(warnArgs[0]); return originalWarn(...warnArgs); };
      return child;
    });

    try {
      const res = await app.inject({ method: 'POST', url: '/v2/run', payload });
      return { status: res.statusCode, isl: capturedISLRequestBody, body: res.json() as any };
    } finally {
      spy.mockRestore();
    }
  }

  // =========================================================================
  // PART 3 — forward the producer's frame, verbatim, and only the producer's.
  // =========================================================================

  it("T1: a 'level' frame stamped on the goal node reaches ISL beside goal_threshold", async () => {
    const { status, isl } = await run({
      graph: graphWithGoal({ ...GOAL_TARGET_UNSTAMPED, goal_threshold_frame: 'level' }),
      options: OPTIONS,
      goal_node_id: 'goal_arr',
      seed: '42',
    });

    expect(status).toBe(200);
    expect(isl).not.toBeNull();
    expect(isl.goal_threshold).toBe(0.65);
    // THE pin: pre-fix the key does not exist on the request at all.
    expect(isl.goal_threshold_frame).toBe('level');
  });

  it("T2: a 'delta' frame is forwarded verbatim — PLoT does not re-interpret it", async () => {
    const { status, isl } = await run({
      graph: graphWithGoal({ ...GOAL_TARGET_UNSTAMPED, goal_threshold_frame: 'delta' }),
      options: OPTIONS,
      goal_node_id: 'goal_arr',
      seed: '42',
    });

    expect(status).toBe(200);
    expect(isl.goal_threshold).toBe(0.65);
    expect(isl.goal_threshold_frame).toBe('delta');
  });

  it('T3: `data.`-nested frames are read, matching every other CEE-stamped field', async () => {
    const { status, isl } = await run({
      graph: graphWithGoal({
        ...GOAL_TARGET_UNSTAMPED,
        data: { goal_threshold_frame: 'level' },
      }),
      options: OPTIONS,
      goal_node_id: 'goal_arr',
      seed: '42',
    });

    expect(status).toBe(200);
    expect(isl.goal_threshold_frame).toBe('level');
  });

  it('T4: NO frame on the node ⇒ NO frame key on the request — PLoT never mints one', async () => {
    const { status, isl } = await run({
      graph: graphWithGoal(GOAL_TARGET_UNSTAMPED),
      options: OPTIONS,
      goal_node_id: 'goal_arr',
      seed: '42',
    });

    expect(status).toBe(200);
    expect(isl.goal_threshold).toBe(0.65);
    // Absent, not defaulted. A 'delta' default would silently restore the
    // pre-2.258 structural zero; a 'level' default would assert an unverified
    // domain. Both are the fabrication this row exists to kill.
    expect('goal_threshold_frame' in isl).toBe(false);
  });

  it('T5: a JUNK frame degrades to ABSENT rather than being forwarded', async () => {
    const { status, isl } = await run({
      graph: graphWithGoal({ ...GOAL_TARGET_UNSTAMPED, goal_threshold_frame: 'levl' }),
      options: OPTIONS,
      goal_node_id: 'goal_arr',
      seed: '42',
    });

    expect(status).toBe(200);
    expect(isl.goal_threshold).toBe(0.65);
    // Forwarding 'levl' would fail ISL's Pydantic Literal validation and turn a
    // producer typo into a FAILED ANALYSIS. Degrading to absent turns it into a
    // disclosed missing frame, which is recoverable and honest.
    expect('goal_threshold_frame' in isl).toBe(false);
  });

  it('T6: a frame NEVER travels without the threshold it describes', async () => {
    // Frame stamped, but no target anywhere: no request-level goal_threshold,
    // no node goal_threshold. A frame alone describes nothing.
    const { status, isl } = await run({
      graph: graphWithGoal({ goal_threshold_frame: 'level' }),
      options: OPTIONS,
      goal_node_id: 'goal_arr',
      seed: '42',
    });

    expect(status).toBe(200);
    expect(isl.goal_threshold).toBeUndefined();
    expect('goal_threshold_frame' in isl).toBe(false);
  });

  // =========================================================================
  // PART 5 — the temporal-filter residual path. Zero coverage before this file.
  // =========================================================================

  it('T7: deadline drops EVERY constraint + a stamped frame ⇒ threshold AND frame both ship', async () => {
    // The 2026-08-01 walk's shape. Explicit constraints compile non-empty, the
    // temporal filter then deletes all of them. Pre-2.239 the fallback had
    // already been skipped (it read the PRE-filter set), so the request reached
    // ISL with neither constraints nor threshold. With the fallback moved after
    // the filter, auto-synthesis fires here — and 2.258 requires the frame to
    // ride with the threshold it recovers.
    const { status, isl, body } = await run({
      graph: graphWithGoal({ ...GOAL_TARGET_UNSTAMPED, goal_threshold_frame: 'level' }),
      options: OPTIONS,
      goal_node_id: 'goal_arr',
      seed: '42',
      goal_constraints: [DEADLINE_CONSTRAINT],
    });

    expect(status).toBe(200);
    expect(isl.goal_threshold).toBe(0.65);
    // THE part-5 pin. An unstamped threshold on this path would make ISL omit
    // probability_of_goal — the fix would look landed and compute nothing.
    expect(isl.goal_threshold_frame).toBe('level');

    // The recovery really did run through auto-synthesis...
    const sent = (isl.goal_constraints ?? []) as any[];
    expect(sent.find((c) => c.constraint_id === 'auto_goal_threshold')).toBeDefined();
    // ...and the deadline is still filtered — this must not smuggle an
    // unevaluable temporal constraint into ISL.
    expect(sent.find((c) => c.constraint_id === 'constraint_goal_arr_max')).toBeUndefined();
    expect(body._meta?.filtered_constraints?.length).toBeGreaterThan(0);
  });

  it('T8: the same path with NO frame ships the threshold UNSTAMPED and says so', async () => {
    const { status, isl } = await run({
      graph: graphWithGoal(GOAL_TARGET_UNSTAMPED),
      options: OPTIONS,
      goal_node_id: 'goal_arr',
      seed: '42',
      goal_constraints: [DEADLINE_CONSTRAINT],
    });

    expect(status).toBe(200);

    // THE DECISION, pinned. The threshold is FORWARDED, not cleared. Clearing
    // it would make ISL return `(None, None)` — "nothing to disclose" — and the
    // user would get silence instead of GOAL_THRESHOLD_FRAME_UNSPECIFIED.
    expect(isl.goal_threshold).toBe(0.65);
    expect('goal_threshold_frame' in isl).toBe(false);

    // PLoT's own witness that it happened, since the ISL warning is only
    // visible in the response body.
    const unstamped = warnCalls.find((c: any) => c?.event === 'goal_threshold_frame_unstamped');
    expect(unstamped).toBeDefined();
    expect(unstamped.goal_threshold).toBe(0.65);
  });

  it('T9: the auto-synthesised constraint survives its OWN temporal filter pass', async () => {
    // The re-landed fallback re-filters the constraint it synthesises, and its
    // comment claims that constraint "can never be DROPPED here: it carries no
    // deadline_metadata and no unit, so neither drop rule can match". If that
    // claim ever stopped holding, `autoSynthesisOnly` (which requires
    // `constraints.length === 1`) would go false, the threshold-carry would not
    // run, and the goal probability would vanish again — silently. Pin the
    // claim rather than trusting the comment.
    const { status, isl, body } = await run({
      graph: graphWithGoal({ ...GOAL_TARGET_UNSTAMPED, goal_threshold_frame: 'level' }),
      options: OPTIONS,
      goal_node_id: 'goal_arr',
      seed: '42',
      goal_constraints: [DEADLINE_CONSTRAINT],
    });

    expect(status).toBe(200);
    const sent = (isl.goal_constraints ?? []) as any[];
    const auto = sent.find((c) => c.constraint_id === 'auto_goal_threshold');
    expect(auto).toBeDefined();
    expect(sent).toHaveLength(1);          // exactly one ⇒ autoSynthesisOnly holds
    expect(isl.goal_threshold).toBe(auto.value);  // carry ran

    // The survival itself, read where a drop would actually SHOW: a constraint
    // removed by the filter is recorded in `_meta.filtered_constraints` with a
    // reason. The deadline is there; the synthesised constraint must not be.
    //
    // ⚠ THIS REPLACED TWO VACUOUS ASSERTIONS (adversarial review, 2026-08-01).
    // They read `auto.deadline_metadata` and `auto.unit` off the WIRE — but
    // `toISLRobustnessRequest` projects every constraint onto six keys
    // (constraint_id, node_id, operator, value, label?, weight?), so those two
    // keys are absent for EVERY constraint, always. Both assertions were true
    // by construction and could never have seen a regression: trap 13's shape,
    // inside a test written to pin a claim.
    const filteredIds = ((body._meta?.filtered_constraints ?? []) as any[])
      .map((r) => r.constraint_id);
    expect(filteredIds).toContain('constraint_goal_arr_max');   // positive control
    expect(filteredIds).not.toContain('auto_goal_threshold');   // the pin
  });

  it('T9b: the drop rules CANNOT match the synthesised constraint (source-side)', () => {
    // T9 proves survival end-to-end. This proves WHY, at the function that owns
    // the drop rules — which is where a newly-added rule would bite, and where
    // the route-level test would only report the damage after the fact.
    //
    // The re-landed fallback asserts in a CODE COMMENT that its constraint "can
    // never be DROPPED here: it carries no deadline_metadata and no unit, so
    // neither drop rule can match". That claim is load-bearing: if it failed,
    // `constraints.length === 1` goes false, `autoSynthesisOnly` goes false, the
    // threshold carry never runs, and the goal probability vanishes SILENTLY.
    // A comment is not a test.
    const goalNode = {
      id: 'goal_arr', kind: 'goal', label: 'Goal',
      observed_state: { value: 0.4, baseline: 0.35 },
    } as unknown as EngineNodeV3;

    // Byte-for-byte the shape run.ts synthesises (run.ts, Phase 1c+).
    const synthesised = {
      constraint_id: 'auto_goal_threshold',
      node_id: 'goal_arr',
      operator: '>=',
      value: 0.65,
      label: 'Goal target',
    } as unknown as RawGoalConstraint;

    const result = filterTemporalConstraints([synthesised], [goalNode]);
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].constraint_id).toBe('auto_goal_threshold');
    expect(result.filtered).toHaveLength(0);

    // POSITIVE CONTROL — the filter really can drop things on this same node,
    // so the assertion above is discriminating rather than a filter that never
    // fires. DROP RULE 1 (deadline_metadata) and DROP RULE 2 (probability-domain
    // node + value > 1 + temporal unit) are the two ways in, and the synthesised
    // constraint is built to satisfy neither.
    const withDeadline = {
      ...synthesised, constraint_id: 'has_deadline',
      deadline_metadata: { deadline_date: '2027-08-01' },
    } as unknown as RawGoalConstraint;
    const withTemporalUnit = {
      ...synthesised, constraint_id: 'has_unit',
      operator: '<=', value: 12, unit: 'months',
    } as unknown as RawGoalConstraint;

    const dropped = filterTemporalConstraints([withDeadline, withTemporalUnit], [goalNode]);
    expect(dropped.passed).toHaveLength(0);
    expect(dropped.filtered.map((r) => r.constraint_id).sort())
      .toEqual(['has_deadline', 'has_unit']);
  });

  // =========================================================================
  // PART 3 (second half) — observed_state.baseline must genuinely transit.
  // =========================================================================

  it("T10: observed_state.baseline transits to ISL — ISL's 'level' conversion needs it", async () => {
    // `baseline` is in ISL_DECLARED_OBSERVED_STATE_FIELDS
    // (translator-v3.ts), which is a HAND-MAINTAINED MIRROR of ISL's model and
    // says so in its own comment. Its drift is silent by construction: drop
    // `baseline` from that list and PLoT simply stops sending it, ISL refuses
    // every 'level' threshold with `missing_goal_baseline`, and no type error
    // is raised anywhere. This test is the alarm that list cannot raise itself.
    const { status, isl } = await run({
      graph: graphWithGoal({ ...GOAL_TARGET_UNSTAMPED, goal_threshold_frame: 'level' }),
      options: OPTIONS,
      goal_node_id: 'goal_arr',
      seed: '42',
    });

    expect(status).toBe(200);
    const goalNode = (isl.graph?.nodes ?? []).find((n: any) => n.id === 'goal_arr');
    expect(goalNode).toBeDefined();
    expect(goalNode.observed_state).toBeDefined();
    expect(goalNode.observed_state.baseline).toBe(0.35);
    // The sibling fields the conversion also reads, pinned in the same breath.
    expect(goalNode.observed_state.value).toBe(0.4);
  });
});
