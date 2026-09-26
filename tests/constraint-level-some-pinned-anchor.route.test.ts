/**
 * A LEVEL limit on a NON-root target that SOME options set, through /v2/run —
 * the ISL request PLoT builds (read by constraint id and option id) and what
 * PLoT delivers from the answer. Unit half:
 * `constraint-level-some-pinned-anchor.unit.test.ts`.
 *
 * THE DEFECT (MG's review of ISL #179, N1, EXECUTED at PLoT #368's head
 * `4638dee`): one option that sets the limited quantity itself (a win-back
 * offer that "cuts churn to 3%") made the sample-frame gate resolve no anchor
 * for that limit, and the run-level suppression then withheld EVERY limit.
 * ISL #179 scores the shape (pinned options by identity, the rest against the
 * status-quo reference from `observed_state.baseline`), so the refusal is now
 * PLoT's alone.
 *
 * ⚠ WHAT THE MOCK IS AND IS NOT (same posture as
 * `constraint-level-baseline-anchor.route.test.ts`). It answers EVERY request
 * that carries constraints with a per-option, per-constraint analysis, and
 * emits CONSTRAINT_NODE_DEFAULT_BASE exactly where ISL's rule does (non-root,
 * no PU, not pinned by every option). It does NOT reproduce ISL's refusals:
 * every "withheld" below is PLoT's own decision, proved against a mock that was
 * able to deliver. That real ISL #179 SCORES L4, and that a pre-#179 ISL
 * REFUSES it (`target_pinned_by_intervention`, no number for any option), is
 * the engine-direct evidence in the PR body, not something this suite claims.
 *
 * Assertions bind by IDENTITY (constraint_id, node_id, option_id, code).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// ISL mock
// ---------------------------------------------------------------------------

let capturedISLRequestBody: any = null;

/** Per (option, constraint) numbers — distinct, so a passthrough is recognisable by identity. */
const PROB: Record<string, Record<string, number>> = {
  opt_hold: { gc_churn: 0.61, gc_support: 0.88, gc_goal: 0.33 },
  opt_raise: { gc_churn: 0.42, gc_support: 0.86, gc_goal: 0.71 },
  opt_winback: { gc_churn: 0.97, gc_support: 0.84 },
  opt_contract: { gc_goal: 0.99 },
};
const probFor = (optionId: string, constraintId: string) => PROB[optionId]?.[constraintId] ?? 0.5;

/** ISL's CONSTRAINT_NODE_DEFAULT_BASE rule: non-root target, no PU, not intervened by EVERY option. */
function defaultBaseWarnings(body: any): any[] {
  const edges: any[] = body.graph?.edges ?? [];
  const puIds = new Set((body.parameter_uncertainties ?? []).map((p: any) => p.node_id));
  const options: any[] = body.options ?? [];
  const out: any[] = [];
  const seen = new Set<string>();
  for (const c of body.goal_constraints ?? []) {
    const id = c.node_id;
    if (seen.has(id)) continue;
    seen.add(id);
    const isRoot = !edges.some((e) => e.to === id);
    const allIntervene = options.length > 0 && options.every((o) => o.interventions && id in o.interventions);
    if (!isRoot && !puIds.has(id) && !allIntervene) {
      out.push({
        code: 'CONSTRAINT_NODE_DEFAULT_BASE',
        field: `nodes[${id}].base`,
        severity: 'info',
        detail: { node_id: id, defaulted_to: 0.0, reason: 'no_parameter_uncertainty' },
      });
    }
  }
  return out;
}

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
    capturedISLRequestBody = body;
    const options = body.options || [];
    const constraints = body.goal_constraints || [];
    return {
      data: {
        options: options.map((opt: any, idx: number) => {
          const perConstraint = constraints.map((c: any) => probFor(opt.id, c.constraint_id));
          return {
            option_id: opt.id,
            outcome: { mean: 0.1 + idx * 0.02, std: 0.05, p10: 0.04, p50: 0.1, p90: 0.16, n_samples: 2000, n_valid_samples: 2000, validity_ratio: 1.0 },
            win_probability: idx === 0 ? 0.2 : 0.4,
            rank: idx + 1,
            ...(constraints.length > 0
              ? {
                  constraint_analysis: {
                    joint_probability: Math.min(...perConstraint),
                    constraints: constraints.map((c: any, i: number) => ({
                      constraint_id: c.constraint_id,
                      node_id: c.node_id,
                      operator: c.operator,
                      threshold: c.value,
                      prob_satisfied: perConstraint[i],
                    })),
                  },
                }
              : {}),
          };
        }),
        factor_sensitivity: [],
        robustness: { label: 'moderate', score: 0.6, fragile_edges: [], robust_edges: [] },
        inference_warnings: defaultBaseWarnings(body),
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
// The churn fixture
//   fac_price    factor  ROOT     -> fac_churn, -> goal_revenue
//   fac_support  factor  ROOT     -> fac_churn
//   fac_churn    factor  NON-root (price, support) -> goal_revenue   <- the level target
//   goal_revenue goal
// ---------------------------------------------------------------------------

type Obs = Record<string, unknown> | undefined;

function graph(churnObs: Obs = { value: 0.07, baseline: 0.07 }, goalObs?: Obs) {
  return {
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Monthly revenue', ...(goalObs ? { observed_state: goalObs } : {}) },
      { id: 'fac_price', kind: 'factor', label: 'Seat price level', observed_state: { value: 0.49 } },
      { id: 'fac_support', kind: 'factor', label: 'Support quality', observed_state: { value: 0.3 } },
      { id: 'fac_churn', kind: 'factor', label: 'Monthly churn', ...(churnObs ? { observed_state: churnObs } : {}) },
    ],
    edges: [
      { from: 'fac_price', to: 'fac_churn', exists_probability: 0.95, strength: { mean: 0.3, std: 0.1 } },
      { from: 'fac_support', to: 'fac_churn', exists_probability: 0.95, strength: { mean: -0.4, std: 0.1 } },
      { from: 'fac_churn', to: 'goal_revenue', exists_probability: 0.95, strength: { mean: -0.8, std: 0.1 } },
      { from: 'fac_price', to: 'goal_revenue', exists_probability: 0.95, strength: { mean: 0.6, std: 0.1 } },
    ],
  };
}

const iv = (value: number) => ({ value, source: 'user_specified' });

/** L4 — only the win-back offer sets churn; hold and raise leave it free. */
function optionsOnePins(price = [0.49, 0.59, 0.49], churnSet = 0.03) {
  return [
    { id: 'opt_hold', label: 'Hold at 49', interventions: { fac_price: iv(price[0]) } },
    { id: 'opt_raise', label: 'Raise to 59', interventions: { fac_price: iv(price[1]) } },
    { id: 'opt_winback', label: 'Win-back offer: cut churn to 3%', interventions: { fac_price: iv(price[2]), fac_churn: iv(churnSet) } },
  ];
}
/** L1 — no option sets churn. */
const OPTIONS_NONE_PIN = [
  { id: 'opt_hold', label: 'Hold at 49', interventions: { fac_price: iv(0.49) } },
  { id: 'opt_raise', label: 'Raise to 59', interventions: { fac_price: iv(0.59) } },
];
/** L3 — every option sets churn. */
const OPTIONS_EVERY_PINS = [
  { id: 'opt_hold', label: 'Hold', interventions: { fac_churn: iv(0.07) } },
  { id: 'opt_winback', label: 'Win-back', interventions: { fac_churn: iv(0.03) } },
];
/** Root control — one option sets the ROOT fac_support. */
const OPTIONS_ONE_PINS_ROOT = [
  { id: 'opt_hold', label: 'Hold at 49', interventions: { fac_price: iv(0.49) } },
  { id: 'opt_winback', label: 'Invest in support', interventions: { fac_support: iv(0.6) } },
];

const GC_CHURN = { constraint_id: 'gc_churn', node_id: 'fac_churn', operator: '<=', value: 0.05, value_frame: 'level' };
const GC_SUPPORT = { constraint_id: 'gc_support', node_id: 'fac_support', operator: '>=', value: 0.2, value_frame: 'level' };

describe('a LEVEL limit on a non-root target that SOME options set (N1) — scored, and no longer withholds its siblings', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    app = await createServer();
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
    delete process.env.DECISION_REVIEW_ENABLE;
    delete process.env.ENABLE_REVIEW_PASS;
    capturedISLRequestBody = null;
  });

  async function run(g: unknown, constraints: unknown[], options: unknown[]) {
    capturedISLRequestBody = null;
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      payload: {
        graph: g,
        options,
        goal_node_id: 'goal_revenue',
        seed: 'n1-some-pinned',
        n_samples: 2000,
        goal_constraints: constraints,
      },
    });
    expect(res.statusCode).toBe(200);
    return { body: res.json() as any, isl: capturedISLRequestBody };
  }

  const byOption = (body: any) =>
    Object.fromEntries((body.option_comparison ?? []).map((o: any) => [o.option_id, o]));
  const warnings = (body: any, code: string) =>
    (body.inference_warnings ?? []).filter((w: any) => w.code === code);
  const sentConstraint = (isl: any, id: string) =>
    (isl?.goal_constraints ?? []).find((c: any) => c.constraint_id === id);
  const sentOption = (isl: any, id: string) => (isl?.options ?? []).find((o: any) => o.id === id);
  const sentNode = (isl: any, id: string) => (isl?.graph?.nodes ?? []).find((n: any) => n.id === id);

  /** The L4 preconditions ISL #179's plan reads, on the request PLoT actually sent. */
  function expectL4OnWire(isl: any, pinnedValue: number, threshold: number, baseline: number) {
    const sent = sentConstraint(isl, 'gc_churn');
    expect(sent, 'gc_churn reached ISL').toBeDefined();
    expect(sent.node_id).toBe('fac_churn');
    expect(sent.value_frame).toBe('level');
    expect(sent.value).toBe(threshold);
    expect(sentNode(isl, 'fac_churn')?.observed_state?.baseline, 'baseline reached ISL').toBe(baseline);
    expect((isl.graph?.edges ?? []).some((e: any) => e.to === 'fac_churn'), 'non-root in ISL graph').toBe(true);
    expect(sentOption(isl, 'opt_winback')?.interventions?.fac_churn, 'winback sets churn, as stated').toBe(pinnedValue);
    expect(Object.keys(sentOption(isl, 'opt_hold')?.interventions ?? {})).not.toContain('fac_churn');
    expect(Object.keys(sentOption(isl, 'opt_raise')?.interventions ?? {})).not.toContain('fac_churn');
  }

  // =========================================================================
  // RED core
  // =========================================================================

  it('L4: one option sets churn (baseline present, level frame) — forwarded as stated, and DELIVERED for every option', async () => {
    const { body, isl } = await run(graph(), [GC_CHURN], optionsOnePins());

    expectL4OnWire(isl, 0.03, 0.05, 0.07);

    const opts = byOption(body);
    expect(Object.keys(opts).sort()).toEqual(['opt_hold', 'opt_raise', 'opt_winback']);
    expect(opts.opt_hold.constraint_probabilities).toEqual({ gc_churn: 0.61 });
    expect(opts.opt_raise.constraint_probabilities).toEqual({ gc_churn: 0.42 });
    expect(opts.opt_winback.constraint_probabilities).toEqual({ gc_churn: 0.97 });
    expect(body.constraints_status).toBe('computed');
    expect(warnings(body, 'CONSTRAINT_TARGET_UNRELIABLE')).toEqual([]);
  });

  it('L4 + an UNRELATED level limit: the unrelated limit is no longer withheld (nor is L4)', async () => {
    const { body, isl } = await run(graph(), [GC_CHURN, GC_SUPPORT], optionsOnePins());

    expect(sentConstraint(isl, 'gc_support')?.node_id).toBe('fac_support');
    const opts = byOption(body);
    expect(opts.opt_hold.constraint_probabilities).toEqual({ gc_churn: 0.61, gc_support: 0.88 });
    expect(opts.opt_raise.constraint_probabilities).toEqual({ gc_churn: 0.42, gc_support: 0.86 });
    expect(opts.opt_winback.constraint_probabilities).toEqual({ gc_churn: 0.97, gc_support: 0.84 });
    expect(opts.opt_winback.probability_of_joint_goal).toBe(0.84);
    expect(warnings(body, 'CONSTRAINT_TARGET_UNRELIABLE')).toEqual([]);
  });

  // The no-PU shape. A factor or outcome target with a value carries a PU (the
  // translator's, or the constraint-PU injector's std-0.001 pin), so ISL emits no
  // defaulted-base warning for it; the GOAL node is never pinned by the
  // injector, so a limit on it is where ISL's warning meets this limb (C50 L5a,
  // here with one option that sets the goal level itself).
  it("L4 on the GOAL node (no PU): ISL's defaulted-base warning does not route it to the false 'no observed baseline' note", async () => {
    const options = [
      OPTIONS_NONE_PIN[0],
      OPTIONS_NONE_PIN[1],
      { id: 'opt_contract', label: 'Sign the anchor contract', interventions: { fac_price: iv(0.49), goal_revenue: iv(0.12) } },
    ];
    const gcGoal = { constraint_id: 'gc_goal', node_id: 'goal_revenue', operator: '>=', value: 0.1, value_frame: 'level' };
    const { body, isl } = await run(graph(undefined, { value: 0.1, baseline: 0.1 }), [gcGoal], options);

    expect(sentConstraint(isl, 'gc_goal')?.node_id).toBe('goal_revenue');
    expect(sentOption(isl, 'opt_contract')?.interventions?.goal_revenue).toBe(0.12);
    expect(sentNode(isl, 'goal_revenue')?.observed_state?.baseline).toBe(0.1);
    // The mock DID emit the defaulted-base signal (as real ISL does for this shape), so its absence below is PLoT's call.
    expect(defaultBaseWarnings(isl).map((w) => w.detail.node_id)).toEqual(['goal_revenue']);
    const opts = byOption(body);
    expect(opts.opt_hold.constraint_probabilities).toEqual({ gc_goal: 0.33 });
    expect(opts.opt_raise.constraint_probabilities).toEqual({ gc_goal: 0.71 });
    expect(opts.opt_contract.constraint_probabilities).toEqual({ gc_goal: 0.99 });
    expect(warnings(body, 'CONSTRAINT_GOALFIT_MODELLED_BASIS')).toEqual([]);
    for (const o of body.option_comparison ?? []) expect(o.goal_fit_basis, o.option_id).toBeUndefined();
    expect(warnings(body, 'CONSTRAINT_TARGET_UNRELIABLE')).toEqual([]);
  });

  // =========================================================================
  // Frame guard — the pinned levels must reach ISL as stated
  // =========================================================================

  it('FRAME GUARD: a raw price forces Phase 4a, which rescales the pinned churn AND the threshold but not the baseline — WITHHELD', async () => {
    const { body, isl } = await run(graph(), [GC_CHURN], optionsOnePins([49, 59, 49]));

    // What the guard exists for, read off the wire: the pin and the threshold
    // moved onto Phase 4a's scale for fac_churn (inferred_baseline [0, 2 × 0.07]),
    // and the threshold followed it (ladder rung 1) — but the baseline the
    // unpinned options are converted against travelled verbatim. So hold/raise
    // would compare `0.07 + delta` with 0.05/0.14 ≈ 0.357: two frames.
    const sent = sentConstraint(isl, 'gc_churn');
    const pinned = sentOption(isl, 'opt_winback')?.interventions?.fac_churn;
    expect(pinned).toBeCloseTo(0.03 / 0.14, 9);
    expect(sent?.value).toBeCloseTo(0.05 / 0.14, 9);
    expect(sentNode(isl, 'fac_churn')?.observed_state?.baseline).toBe(0.07);

    const opts = byOption(body);
    expect(opts.opt_hold.constraint_probabilities).toBeUndefined();
    expect(opts.opt_winback.constraint_probabilities).toBeUndefined();
    const warned = warnings(body, 'CONSTRAINT_TARGET_UNRELIABLE');
    expect(warned).toHaveLength(1);
    expect(warned[0].message).toContain('Monthly churn');
  });

  it("FRAME GUARD: Phase 4a CLAMPS the pinned level (1.4 on churn's [0,1] scale) — WITHHELD", async () => {
    const { body, isl } = await run(
      graph({ value: 0.5, baseline: 0.5 }),
      [{ ...GC_CHURN, value: 60, unit: '%' }],
      optionsOnePins([0.49, 0.59, 0.49], 1.4),
    );

    // Reached ISL at 1.0, not the 1.4 the option states.
    expect(sentOption(isl, 'opt_winback')?.interventions?.fac_churn).toBe(1);
    expect(sentConstraint(isl, 'gc_churn')?.value).toBe(0.6);

    const opts = byOption(body);
    expect(opts.opt_winback.constraint_probabilities).toBeUndefined();
    const warned = warnings(body, 'CONSTRAINT_TARGET_UNRELIABLE');
    expect(warned).toHaveLength(1);
    expect(warned[0].message).toContain('Monthly churn');
  });

  // =========================================================================
  // Controls — every one of these is the base's behaviour, unchanged
  // =========================================================================

  it('CONTROL L4 without a baseline: still WITHHELD', async () => {
    const { body } = await run(graph({ value: 0.07 }), [GC_CHURN], optionsOnePins());
    expect(byOption(body).opt_winback.constraint_probabilities).toBeUndefined();
    expect(byOption(body).opt_hold.constraint_probabilities).toBeUndefined();
    const warned = warnings(body, 'CONSTRAINT_TARGET_UNRELIABLE');
    expect(warned).toHaveLength(1);
    expect(warned[0].message).toContain('Monthly churn');
  });

  it("CONTROL L4 with a 'delta' frame: unchanged — WITHHELD", async () => {
    const { body } = await run(graph(), [{ ...GC_CHURN, value_frame: 'delta' }], optionsOnePins());
    expect(byOption(body).opt_winback.constraint_probabilities).toBeUndefined();
    expect(warnings(body, 'CONSTRAINT_TARGET_UNRELIABLE')).toHaveLength(1);
  });

  it('CONTROL L4 unframed: unchanged — WITHHELD', async () => {
    const { value_frame: _drop, ...unframed } = GC_CHURN;
    const { body } = await run(graph(), [unframed], optionsOnePins());
    expect(byOption(body).opt_winback.constraint_probabilities).toBeUndefined();
    expect(warnings(body, 'CONSTRAINT_TARGET_UNRELIABLE')).toHaveLength(1);
  });

  it('CONTROL L1 (no option sets churn): unchanged — delivered under observed_baseline_level', async () => {
    const { body } = await run(graph(), [GC_CHURN], OPTIONS_NONE_PIN);
    const opts = byOption(body);
    expect(opts.opt_hold.constraint_probabilities).toEqual({ gc_churn: 0.61 });
    expect(opts.opt_raise.constraint_probabilities).toEqual({ gc_churn: 0.42 });
    expect(warnings(body, 'CONSTRAINT_TARGET_UNRELIABLE')).toEqual([]);
  });

  it('CONTROL L3 (every option sets churn): unchanged — delivered under pinned_by_every_option', async () => {
    const { body } = await run(graph(), [GC_CHURN], OPTIONS_EVERY_PINS);
    const opts = byOption(body);
    expect(opts.opt_hold.constraint_probabilities).toEqual({ gc_churn: 0.61 });
    expect(opts.opt_winback.constraint_probabilities).toEqual({ gc_churn: 0.97 });
    expect(warnings(body, 'CONSTRAINT_TARGET_UNRELIABLE')).toEqual([]);
  });

  it('CONTROL a ROOT target one option sets: unchanged — delivered under root_observed_level', async () => {
    const { body } = await run(graph(), [GC_SUPPORT], OPTIONS_ONE_PINS_ROOT);
    const opts = byOption(body);
    expect(opts.opt_hold.constraint_probabilities).toEqual({ gc_support: 0.88 });
    expect(opts.opt_winback.constraint_probabilities).toEqual({ gc_support: 0.84 });
    expect(warnings(body, 'CONSTRAINT_TARGET_UNRELIABLE')).toEqual([]);
  });
});
