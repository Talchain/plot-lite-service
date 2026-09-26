/**
 * `observed_baseline_level` through /v2/run — the ISL request PLoT builds, and
 * what PLoT delivers from the answer. Unit half:
 * `constraint-level-baseline-anchor.unit.test.ts`.
 *
 * THE SHAPE is AI Quality's C50 fixture (`build_cases.py`,
 * ~/olumi-ai-quality-20260924/quality-evidence/c50-level-demo-20260925/), so
 * this suite, the unit suite and the engine-direct witness share ONE graph.
 * At PLoT `b09c0f2` / ISL `3c4ab84d` (WIRE, C50):
 *   - L2b (out_subscribers {value .5, baseline .5}, level >= .47): PLoT pinned
 *     the target with a std-0.001 PU, ISL refused, PLoT refused too. ISL #177
 *     converts that PU (the base cancels under CRN), so this PR leaves the
 *     injector alone: the pin is still sent, and only PLoT's gate changes;
 *   - L5a (goal_revenue {value .1, baseline .1}, level >= .1): ISL computed
 *     0.4895 / 0.781 and PLoT withheld both (its suppression log);
 *   - L5b (L5a + node stamp 'delta'): delivered, but under doctrine B, with a
 *     note saying the goal "has no observed baseline value" (C50 finding 8).
 *
 * ⚠ WHAT THE MOCK IS AND IS NOT. It answers EVERY request that carries
 * constraints with a per-option constraint analysis (ISL's own L5a numbers,
 * 0.4895 / 0.781, borrowed so a passthrough is recognisable), and emits
 * CONSTRAINT_NODE_DEFAULT_BASE exactly where ISL's rule does (non-root target,
 * no PU, not pinned by every option — ra_v2.py @3c4ab84d). It does NOT
 * reproduce ISL's refusals: every "withheld" below is therefore PLoT's own
 * decision, proved against a mock that was able to deliver. That real ISL
 * SCORES the positive shape is not provable here — the engine-direct plan in
 * the PR body is the witness for that; this suite pins the request PLoT sends
 * (every precondition ISL's level plan reads) and what PLoT does with the reply.
 *
 * Assertions bind by IDENTITY (constraint_id, node_id, option_id, code).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// ISL mock
// ---------------------------------------------------------------------------

let capturedISLRequestBody: any = null;

/** ISL's own per-option numbers for the L5a shape (C50 render-logs-suppressed.json). */
const PROB_BY_OPTION: Record<string, number> = { opt_hold: 0.4895, opt_raise: 0.781 };

/**
 * ISL's CONSTRAINT_NODE_DEFAULT_BASE rule (ra_v2.py @3c4ab84d, the
 * `constraint_default_base_critiques` block): a constraint target that is
 * non-root, has no ParameterUncertainty, and is not intervened by EVERY option.
 */
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
          const p = PROB_BY_OPTION[opt.id] ?? 0.5;
          return {
            option_id: opt.id,
            outcome: { mean: 0.1 + idx * 0.02, std: 0.05, p10: 0.04, p50: 0.1, p90: 0.16, n_samples: 2000, n_valid_samples: 2000, validity_ratio: 1.0 },
            win_probability: idx === 0 ? 0.07 : 0.93,
            rank: idx + 1,
            ...(constraints.length > 0
              ? {
                  constraint_analysis: {
                    joint_probability: p,
                    constraints: constraints.map((c: any) => ({
                      constraint_id: c.constraint_id,
                      node_id: c.node_id,
                      operator: c.operator,
                      threshold: c.value,
                      prob_satisfied: p,
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
// The C50 fixture (build_cases.py graph(), graph_goal(), OPTIONS, OPTIONS_L4)
// ---------------------------------------------------------------------------

function graph(subObs?: Record<string, unknown>, goalObs?: Record<string, unknown>, goalStamp?: string) {
  return {
    nodes: [
      {
        id: 'goal_revenue', kind: 'goal', label: 'Monthly revenue',
        ...(goalObs ? { observed_state: goalObs } : {}),
        ...(goalStamp ? { goal_threshold_frame: goalStamp } : {}),
      },
      { id: 'out_subscribers', kind: 'outcome', label: 'Paying subscribers', ...(subObs ? { observed_state: subObs } : {}) },
      { id: 'fac_price', kind: 'factor', label: 'Seat price level', observed_state: { value: 0.49 } },
      { id: 'fac_churn', kind: 'factor', label: 'Monthly logo churn', observed_state: { value: 0.07, std: 0.01 } },
    ],
    edges: [
      { from: 'fac_price', to: 'out_subscribers', exists_probability: 0.95, strength: { mean: -0.5, std: 0.1 } },
      { from: 'fac_churn', to: 'out_subscribers', exists_probability: 0.95, strength: { mean: -0.6, std: 0.1 } },
      { from: 'out_subscribers', to: 'goal_revenue', exists_probability: 0.95, strength: { mean: 0.7, std: 0.1 } },
      { from: 'fac_price', to: 'goal_revenue', exists_probability: 0.95, strength: { mean: 0.6, std: 0.1 } },
    ],
  };
}

const OPTIONS = [
  { id: 'opt_hold', label: 'Hold at 49', interventions: { fac_price: { value: 0.49, source: 'user_specified' } } },
  { id: 'opt_raise', label: 'Raise to 59', interventions: { fac_price: { value: 0.59, source: 'user_specified' } } },
];
/**
 * opt_raise also sets the level target itself. ISL #179 scores this (the pinned
 * option by identity, the other against the baseline), and PLoT now anchors it
 * when the pinned level reached ISL as stated (N1).
 */
const OPTIONS_ONE_PINS_SUBS = [
  OPTIONS[0],
  { id: 'opt_raise', label: 'Raise to 59 and buy subscribers', interventions: {
    fac_price: { value: 0.59, source: 'user_specified' },
    out_subscribers: { value: 0.6, source: 'user_specified' },
  } },
];

const SUB_WITH_BASELINE = { value: 0.5, baseline: 0.5 };
const SUB_NO_BASELINE = { value: 0.5 };
const GC_L2B = { constraint_id: 'gc_l2b', node_id: 'out_subscribers', operator: '>=', value: 0.47, value_frame: 'level' };

describe('observed_baseline_level — a LEVEL limit on an outcome the options move is scored', () => {
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

  async function run(g: unknown, constraints: unknown[], options: unknown[] = OPTIONS) {
    capturedISLRequestBody = null;
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      payload: {
        graph: g,
        options,
        goal_node_id: 'goal_revenue',
        seed: 'c50-level-demo',
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
  const islPuFor = (isl: any, nodeId: string) =>
    (isl.parameter_uncertainties ?? []).filter((p: any) => p.node_id === nodeId);
  const injectedRepairFor = (body: any, nodeId: string) =>
    (body._meta?.repairs_applied ?? []).filter(
      (r: any) => r.field === `parameter_uncertainties[${nodeId}]` && String(r.reason).startsWith('CONSTRAINT_PU_INJECTED'),
    );

  /** Every precondition ISL's level plan reads, asserted on the request PLoT actually sent. */
  function expectLevelPlanPreconditionsOnWire(isl: any, constraintId: string, nodeId: string, baseline: number) {
    const sent = (isl.goal_constraints ?? []).find((c: any) => c.constraint_id === constraintId);
    expect(sent, 'constraint reached ISL').toBeDefined();
    expect(sent.node_id).toBe(nodeId);
    expect(sent.value_frame).toBe('level');
    const node = (isl.graph?.nodes ?? []).find((n: any) => n.id === nodeId);
    expect(node?.observed_state?.baseline, 'baseline reached ISL').toBe(baseline);
    expect((isl.graph?.edges ?? []).some((e: any) => e.to === nodeId), 'non-root in ISL graph').toBe(true);
    for (const o of isl.options ?? []) {
      expect(Object.keys(o.interventions ?? {}), `option ${o.id} leaves the target free`).not.toContain(nodeId);
    }
  }

  // =========================================================================
  // RED core
  // =========================================================================

  it('C50 L2b shape: the PU pin is still sent (ISL #177 converts it), and the per-option probabilities are DELIVERED', async () => {
    const { body, isl } = await run(graph(SUB_WITH_BASELINE), [GC_L2B]);

    expectLevelPlanPreconditionsOnWire(isl, 'gc_l2b', 'out_subscribers', 0.5);
    // The injector is UNCHANGED: the std-0.001 pin still reaches ISL, which is
    // why ISL #177 must deploy first. With a PU present, ISL (and this mock)
    // emit no CONSTRAINT_NODE_DEFAULT_BASE for the target.
    expect(islPuFor(isl, 'out_subscribers')).toEqual([
      { node_id: 'out_subscribers', distribution: 'normal', std: 0.001 },
    ]);
    expect(injectedRepairFor(body, 'out_subscribers')).toHaveLength(1);
    expect(defaultBaseWarnings(isl)).toEqual([]);

    const opts = byOption(body);
    expect(Object.keys(opts).sort()).toEqual(['opt_hold', 'opt_raise']);
    expect(opts.opt_hold.constraint_probabilities).toEqual({ gc_l2b: 0.4895 });
    expect(opts.opt_raise.constraint_probabilities).toEqual({ gc_l2b: 0.781 });
    expect(opts.opt_hold.probability_of_joint_goal).toBe(0.4895);
    expect(opts.opt_raise.probability_of_joint_goal).toBe(0.781);
    expect(body.constraints_status).toBe('computed');

    expect(warnings(body, 'CONSTRAINT_TARGET_UNRELIABLE')).toEqual([]);
  });

  it('C50 L5a shape (goal target): withheld at the base, DELIVERED now', async () => {
    const { body, isl } = await run(
      graph(undefined, { value: 0.1, baseline: 0.1 }),
      [{ constraint_id: 'gc_l5a', node_id: 'goal_revenue', operator: '>=', value: 0.1, value_frame: 'level' }],
    );
    expectLevelPlanPreconditionsOnWire(isl, 'gc_l5a', 'goal_revenue', 0.1);
    // The injector never pins the goal node, so this is the no-PU shape.
    expect(islPuFor(isl, 'goal_revenue')).toEqual([]);

    const opts = byOption(body);
    expect(opts.opt_hold.constraint_probabilities).toEqual({ gc_l5a: 0.4895 });
    expect(opts.opt_raise.constraint_probabilities).toEqual({ gc_l5a: 0.781 });
    expect(warnings(body, 'CONSTRAINT_TARGET_UNRELIABLE')).toEqual([]);
  });

  it('(1b) C50 L5a shape: ISL’s defaulted-base warning does not trigger the false "no observed baseline" note', async () => {
    const { body, isl } = await run(
      graph(undefined, { value: 0.1, baseline: 0.1 }),
      [{ constraint_id: 'gc_l5a', node_id: 'goal_revenue', operator: '>=', value: 0.1, value_frame: 'level' }],
    );
    // The mock DID emit the defaulted-base signal for this target (as real ISL
    // does for an unpinned non-root target) — so the absence below is PLoT's call.
    expect(defaultBaseWarnings(isl).map((w) => w.detail.node_id)).toEqual(['goal_revenue']);
    expect(warnings(body, 'CONSTRAINT_GOALFIT_MODELLED_BASIS')).toEqual([]);
    for (const o of body.option_comparison ?? []) expect(o.goal_fit_basis, o.option_id).toBeUndefined();
  });

  it("(1b) C50 L5b shape (node stamped 'delta', constraint 'level'): still delivered, but the false 'no observed baseline' note is gone", async () => {
    const { body } = await run(
      graph(undefined, { value: 0.1, baseline: 0.1 }, 'delta'),
      [{ constraint_id: 'gc_l5b', node_id: 'goal_revenue', operator: '>=', value: 0.1, value_frame: 'level' }],
    );
    const opts = byOption(body);
    expect(opts.opt_hold.constraint_probabilities).toEqual({ gc_l5b: 0.4895 });
    expect(opts.opt_raise.constraint_probabilities).toEqual({ gc_l5b: 0.781 });
    expect(warnings(body, 'CONSTRAINT_GOALFIT_MODELLED_BASIS')).toEqual([]);
    for (const o of body.option_comparison ?? []) expect(o.goal_fit_basis, o.option_id).toBeUndefined();
  });

  // =========================================================================
  // Controls — every one of these is today's behaviour, unchanged
  // =========================================================================

  it('CONTROL no baseline: target still PINNED on the wire and the limit still WITHHELD', async () => {
    const { body, isl } = await run(graph(SUB_NO_BASELINE), [GC_L2B]);

    expect(islPuFor(isl, 'out_subscribers')).toEqual([
      { node_id: 'out_subscribers', distribution: 'normal', std: 0.001 },
    ]);
    expect(injectedRepairFor(body, 'out_subscribers')).toHaveLength(1);

    const opts = byOption(body);
    expect(opts.opt_hold.constraint_probabilities).toBeUndefined();
    expect(opts.opt_raise.constraint_probabilities).toBeUndefined();
    const warned = warnings(body, 'CONSTRAINT_TARGET_UNRELIABLE');
    expect(warned).toHaveLength(1);
    expect(warned[0].message).toContain('Paying subscribers');
  });

  it("CONTROL 'delta' frame without a node stamp: unchanged — pinned and withheld", async () => {
    const { body, isl } = await run(graph(SUB_WITH_BASELINE), [{ ...GC_L2B, value_frame: 'delta' }]);

    expect(islPuFor(isl, 'out_subscribers')).toHaveLength(1);
    expect(byOption(body).opt_hold.constraint_probabilities).toBeUndefined();
    expect(warnings(body, 'CONSTRAINT_TARGET_UNRELIABLE')).toHaveLength(1);
  });

  it('CONTROL unframed: unchanged — pinned and withheld', async () => {
    const { value_frame: _drop, ...unframed } = GC_L2B;
    const { body, isl } = await run(graph(SUB_WITH_BASELINE), [unframed]);

    expect(islPuFor(isl, 'out_subscribers')).toHaveLength(1);
    expect(byOption(body).opt_hold.constraint_probabilities).toBeUndefined();
    expect(warnings(body, 'CONSTRAINT_TARGET_UNRELIABLE')).toHaveLength(1);
  });

  // SUPERSEDES "CONTROL pinned by ONE option: unchanged — pinned and withheld"
  // (N1, MG's review of ISL #179). That row pinned the defect: one option setting
  // the target withheld the limit — and, through the run-level suppression, every
  // other limit. All interventions here are already in [0,1], so Phase 4a leaves
  // the pinned 0.6 as stated, and the limb opens. The full N1 matrix (frame
  // guard, controls, the unrelated-limit row) is
  // `constraint-level-some-pinned-anchor.route.test.ts`.
  it('pinned by ONE option (level, baseline, pinned level forwarded as stated): DELIVERED — N1', async () => {
    const { body, isl } = await run(graph(SUB_WITH_BASELINE), [GC_L2B], OPTIONS_ONE_PINS_SUBS);

    expect(islPuFor(isl, 'out_subscribers')).toHaveLength(1);
    const sentRaise = (isl.options ?? []).find((o: any) => o.id === 'opt_raise');
    expect(sentRaise?.interventions?.out_subscribers).toBe(0.6);
    expect(byOption(body).opt_hold.constraint_probabilities).toEqual({ gc_l2b: 0.4895 });
    expect(byOption(body).opt_raise.constraint_probabilities).toEqual({ gc_l2b: 0.781 });
    expect(warnings(body, 'CONSTRAINT_TARGET_UNRELIABLE')).toEqual([]);
  });

  // (Real ISL scores a root target option-INVARIANT — C50 L1, 0.842 / 0.842.
  // The mock's per-option numbers here only prove PLoT's passthrough.)
  it('CONTROL root target (C50 L1 shape): unchanged — delivered under root_observed_level', async () => {
    const { body } = await run(graph(), [
      { constraint_id: 'gc_l1', node_id: 'fac_churn', operator: '<=', value: 0.08, value_frame: 'level' },
    ]);
    const opts = byOption(body);
    expect(opts.opt_hold.constraint_probabilities).toEqual({ gc_l1: 0.4895 });
    expect(opts.opt_raise.constraint_probabilities).toEqual({ gc_l1: 0.781 });
    expect(warnings(body, 'CONSTRAINT_TARGET_UNRELIABLE')).toEqual([]);
  });

  it('MIX: a scoreable level limit beside an unanchored one — the run-level suppression still wins, and names only the unanchored target', async () => {
    const { body } = await run(graph(SUB_WITH_BASELINE), [
      GC_L2B,
      { constraint_id: 'gc_goal_unframed', node_id: 'goal_revenue', operator: '>=', value: 0.1 },
    ]);
    const opts = byOption(body);
    expect(opts.opt_hold.constraint_probabilities).toBeUndefined();
    expect(opts.opt_raise.probability_of_joint_goal).toBeUndefined();
    const warned = warnings(body, 'CONSTRAINT_TARGET_UNRELIABLE');
    expect(warned).toHaveLength(1);
    expect(warned[0].message).toContain('Monthly revenue');
    expect(warned[0].message).not.toContain('Paying subscribers');
  });
});
