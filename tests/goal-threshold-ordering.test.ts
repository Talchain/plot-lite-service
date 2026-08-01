/**
 * ROADMAP 2.239 — the goal target must survive to the ISL request.
 *
 * This file exists in the gap the 2026-08-01 live walk fell through. Two
 * well-tested, individually correct blocks sat either side of it and never
 * crossed:
 *
 *   tests/auto-constraint-fallback.test.ts   — 0 occurrences of deadline_metadata
 *   tests/golden/temporal-filter-e2e.test.ts — 0 occurrences of goal_threshold
 *
 * So the fallback was tested with no deadline, the filter was tested with no
 * threshold, and the defect lived in their untested intersection.
 *
 * The two holes pinned here:
 *
 *  A. ORDERING. The auto-synthesis fallback used to be gated on the PRE-filter
 *     constraint set (run.ts:4994) while the temporal filter that deletes
 *     unevaluable constraints ran later (run.ts:5102). A deadline constraint
 *     that was about to be DELETED still suppressed the fallback — so a user
 *     who stated "£6M ARR within 12 months" got a strictly worse analysis than
 *     one who stated the target alone.
 *
 *  B. THE FALLBACK DESTROYED THE THRESHOLD IT RECOVERED. Auto-synthesis emits a
 *     CONSTRAINT; one constraint tripped precedence routing, which cleared
 *     `effectiveGoalThreshold`, so the translator omitted `goal_threshold` and
 *     ISL — whose `probability_of_goal` is gated SOLELY on
 *     `request.goal_threshold is not None` — computed nothing. Measured on
 *     pristine 2f6e997: NO auto-synthesis request has ever carried a
 *     `goal_threshold`, deadline or not.
 *
 * Every assertion below is on the OUTBOUND ISL REQUEST BODY, which is the only
 * place either hole is visible. A 200 proves a response, not a computation.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// ISL mock — captures the outbound request body.
//
// NOTE the mock deliberately returns options with NO `probability_of_goal`.
// That is what makes it a usable control for the alarm assertions: real ISL
// would return one whenever goal_threshold is sent, so "target stated + no
// probability back" is exactly the state the alarm exists to name.
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
  { id: 'opt1', label: 'Ship fast', interventions: { 'lever': 0.9 } },
  { id: 'opt2', label: 'Ship slow', interventions: { 'lever': 0.2 } },
];

/** Graph whose goal node carries whatever CEE stamped on it. */
function graphWithGoal(goalOverrides: Record<string, unknown> = {}) {
  return {
    nodes: [
      { id: 'goal_arr', kind: 'goal', label: 'Reach 6M ARR Within 12 Months', ...goalOverrides },
      { id: 'lever', kind: 'factor', label: 'Sales headcount', observed_state: { value: 0.5 } },
      { id: 'other', kind: 'factor', label: 'Market', observed_state: { value: 0.3 } },
    ],
    edges: [
      { from: 'lever', to: 'goal_arr', strength: { mean: 0.6, std: 0.1 } },
      { from: 'other', to: 'goal_arr', strength: { mean: 0.3, std: 0.1 } },
    ],
  };
}

/** CEE's goal node for a target that was stated with a deadline (the walk's S1). */
const GOAL_NODE_WITH_TARGET = {
  goal_threshold: 0.65,
  goal_threshold_raw: 6000000,
  goal_threshold_unit: '£',
  goal_threshold_cap: 9000000,
  provenance: 'ai_inferred',
};

/** The exact constraint CEE attached on the walk — verbatim shape from the wire. */
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

describe('ROADMAP 2.239 — goal target reaches the ISL request', () => {
  let app: FastifyInstance;
  const logCalls: any[] = [];
  const warnCalls: any[] = [];

  beforeAll(async () => {
    // Set BEFORE createServer(): the rate limiter reads env at plugin
    // registration, and a missed flag here leaks 429s into sibling files.
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

  /** POST /v2/run, capturing the outbound ISL body and the structured logs. */
  async function run(payload: Record<string, unknown>) {
    capturedISLRequestBody = null;
    logCalls.length = 0;
    warnCalls.length = 0;

    const originalChildLogger = app.log.child.bind(app.log);
    const spy = vi.spyOn(app.log, 'child').mockImplementation((...args: any[]) => {
      const child = originalChildLogger(...args);
      const originalInfo = child.info.bind(child);
      const originalWarn = child.warn.bind(child);
      child.info = (...infoArgs: any[]) => { logCalls.push(infoArgs[0]); return originalInfo(...infoArgs); };
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

  const warned = () => warnCalls.find((c: any) => c?.event === 'goal_threshold_no_probability');

  // =========================================================================
  // THE CRITICAL PIN — the assertion no existing test makes.
  // =========================================================================

  it('HOLE A+B: a deadline-bearing constraint PLUS a goal-node threshold still sends goal_threshold to ISL', async () => {
    const { status, isl, body } = await run({
      graph: graphWithGoal(GOAL_NODE_WITH_TARGET),
      options: OPTIONS,
      goal_node_id: 'goal_arr',
      seed: '42',
      goal_constraints: [DEADLINE_CONSTRAINT],
    });

    expect(status).toBe(200);
    expect(isl).not.toBeNull();

    // THE pin. Pre-fix this is `undefined`: the deadline suppressed the
    // fallback (hole A), was then deleted, and nothing replaced it.
    expect(isl.goal_threshold).toBe(0.65);

    // The fallback fired despite a constraint having been present on arrival.
    const sent = (isl.goal_constraints ?? []) as any[];
    const auto = sent.find((c) => c.constraint_id === 'auto_goal_threshold');
    expect(auto).toBeDefined();
    expect(auto.operator).toBe('>=');

    // The threshold and the constraint describe the same number — derived from
    // the constraint actually being sent, not from a parallel copy, so
    // downstream re-scaling cannot make them disagree.
    expect(isl.goal_threshold).toBe(auto.value);

    // The deadline itself is STILL filtered — this fix must not smuggle an
    // unevaluable temporal constraint into ISL.
    expect(sent.find((c) => c.constraint_id === 'constraint_goal_arr_max')).toBeUndefined();
    expect(body._meta?.filtered_constraints).toEqual([
      { constraint_id: 'constraint_goal_arr_max', node_id: 'goal_arr', reason: 'temporal_deadline' },
    ]);

    // And the log says the fallback ran, not that it was skipped.
    const autoLog = logCalls.find((c: any) => c?.event === 'plot.auto_constraint_from_threshold');
    expect(autoLog?.action).toBe('synthesised');
    expect(autoLog?.threshold_source).toBe('goal_node');
  });

  // =========================================================================
  // The shapes the diagnosis believed were already healthy. They were not.
  // =========================================================================

  it('HOLE B: target stated on the goal node, no deadline → goal_threshold still reaches ISL', async () => {
    const { status, isl } = await run({
      graph: graphWithGoal(GOAL_NODE_WITH_TARGET),
      options: OPTIONS,
      goal_node_id: 'goal_arr',
      seed: '42',
    });

    expect(status).toBe(200);
    expect(isl.goal_threshold).toBe(0.65);
    const auto = ((isl.goal_constraints ?? []) as any[]).find((c) => c.constraint_id === 'auto_goal_threshold');
    expect(auto).toBeDefined();
    expect(isl.goal_threshold).toBe(auto.value);
  });

  it('HOLE B: an EXPLICIT root-level goal_threshold is no longer discarded by the fallback derived from it', async () => {
    const { status, isl, body } = await run({
      graph: graphWithGoal(),
      options: OPTIONS,
      goal_node_id: 'goal_arr',
      seed: '42',
      goal_threshold: 0.7,
    });

    expect(status).toBe(200);
    expect(isl.goal_threshold).toBe(0.7);
    const auto = ((isl.goal_constraints ?? []) as any[]).find((c) => c.constraint_id === 'auto_goal_threshold');
    expect(auto.value).toBe(0.7);
    expect(isl.goal_threshold).toBe(auto.value);

    // No "goal_threshold ignored" repair: nothing overrode it. Pre-fix the
    // response carried exactly that repair while silently dropping the field.
    const repairs = (body._meta?.repairs_applied ?? []) as Array<Record<string, unknown>>;
    const ignored = repairs.find(
      (r) => r.field === 'goal_threshold' && r.to_value === 'ignored'
    );
    expect(ignored).toBeUndefined();
  });

  it('DERIVE-NOT-MIRROR: when Phase 4b re-scales the synthesised constraint, goal_threshold follows it', async () => {
    // The threshold and the constraint are the SAME number stated twice. Phase 4b
    // re-normalises constraint values onto the intervention scale, so a threshold
    // carried from the pre-normalisation copy would put two different numbers on
    // one wire: ISL would be asked P(goal >= 20000) and P(constraint goal >= 0.4)
    // in the same response. Here the raw £20k target normalises to 0.4 against the
    // node's declared 50k cap — the assertion is that BOTH land on 0.4.
    const { status, isl } = await run({
      graph: {
        nodes: [
          { id: 'goal_arr', kind: 'goal', label: 'ARR', goal_threshold_cap: 50000 },
          {
            id: 'lever', kind: 'factor', label: 'MRR',
            observed_state: { value: 15000 },
            state_space: { range: { min: 0, max: 50000 } },
          },
          { id: 'other', kind: 'factor', label: 'Market', observed_state: { value: 0.3 } },
        ],
        edges: [
          { from: 'lever', to: 'goal_arr', strength: { mean: 0.6, std: 0.1 } },
          { from: 'other', to: 'goal_arr', strength: { mean: 0.3, std: 0.1 } },
        ],
      },
      options: [
        { id: 'opt1', label: 'A', interventions: { lever: { value: 25000, source: 'user_specified' } } },
        { id: 'opt2', label: 'B', interventions: { lever: { value: 10000, source: 'user_specified' } } },
      ],
      goal_node_id: 'goal_arr',
      seed: '42',
      goal_threshold: 20000,
    });

    expect(status).toBe(200);
    const auto = ((isl.goal_constraints ?? []) as any[]).find((c) => c.constraint_id === 'auto_goal_threshold');
    expect(auto.value).toBe(0.4);          // re-scaled by Phase 4b
    expect(isl.goal_threshold).toBe(0.4);  // and the threshold followed it, not 20000
  });

  // =========================================================================
  // NARROWNESS GUARD — a genuine user constraint must still take precedence.
  // Without this, the hole-B fix could be widened into "always send both",
  // which would silently override a user's explicit multi-constraint intent.
  // =========================================================================

  it('a real user constraint still clears goal_threshold (precedence routing unchanged)', async () => {
    const { status, isl, body } = await run({
      graph: graphWithGoal(),
      options: OPTIONS,
      goal_node_id: 'goal_arr',
      seed: '42',
      goal_threshold: 0.7,
      goal_constraints: [
        { constraint_id: 'lever_floor', node_id: 'lever', operator: '>=', value: 0.6 },
      ],
    });

    expect(status).toBe(200);
    expect(isl.goal_threshold).toBeUndefined();
    const sent = (isl.goal_constraints ?? []) as any[];
    expect(sent.map((c) => c.constraint_id)).toEqual(['lever_floor']);

    const repairs = (body._meta?.repairs_applied ?? []) as Array<Record<string, unknown>>;
    expect(
      repairs.find((r) => r.field === 'goal_threshold' && r.to_value === 'ignored')
    ).toBeDefined();

    const multiLog = logCalls.find((c: any) => c?.event === 'multi_constraint_path_activated');
    expect(multiLog?.goal_threshold_carried).toBe(false);
  });

  it('the synthesised constraint still goes through the temporal filter safety gate', async () => {
    // Moving the fallback to AFTER the filter must not exempt the constraint it
    // synthesises. A threshold outside [0,1] on a probability-domain node is a
    // data issue the filter is supposed to flag (it warns, it does not drop).
    // Before the move that gate applied for free; it now applies because the
    // fallback re-enters filterTemporalConstraints with its own constraint.
    const { status, body } = await run({
      graph: graphWithGoal(),
      options: OPTIONS,
      goal_node_id: 'goal_arr',
      seed: '42',
      goal_threshold: 1.5,   // out of [0,1], no declared cap to scale it into range
    });

    expect(status).toBe(200);
    const outOfDomain = ((body.critiques ?? []) as Array<Record<string, unknown>>)
      .filter((c) => c.code === 'CONSTRAINT_OUT_OF_DOMAIN');
    expect(outOfDomain).toHaveLength(1);
    expect(outOfDomain[0].affected_node_ids).toEqual(['goal_arr']);

    const w = warnCalls.find((c: any) => c?.event === 'plot.constraint_out_of_domain');
    expect(w?.constraint_id).toBe('auto_goal_threshold');
  });

  it('no target stated anywhere → no synthesis, no goal_threshold, no constraints', async () => {
    const { status, isl } = await run({
      graph: graphWithGoal(),
      options: OPTIONS,
      goal_node_id: 'goal_arr',
      seed: '42',
    });

    expect(status).toBe(200);
    expect(isl.goal_threshold).toBeUndefined();
    expect(isl.goal_constraints).toBeUndefined();
  });

  // =========================================================================
  // THE ALARM — it was gated on the variable that is cleared in every failing
  // case, so it was silent by construction. These are its first real controls.
  // =========================================================================

  describe('goal_threshold_no_probability alarm', () => {
    it('FIRES when a target was stated on the goal node and no probability came back', async () => {
      await run({
        graph: graphWithGoal(GOAL_NODE_WITH_TARGET),
        options: OPTIONS,
        goal_node_id: 'goal_arr',
        seed: '42',
        goal_constraints: [DEADLINE_CONSTRAINT],
      });

      const w = warned();
      expect(w).toBeDefined();
      expect(w.options_missing_probability).toBe(2);
      expect(w.goal_target).toBe(0.65);
      expect(w.goal_target_source).toBe('goal_node');
    });

    it('FIRES when precedence routing cleared the threshold — the case it was blind to', async () => {
      // The old gate (`effectiveGoalThreshold !== undefined`) made this exact
      // scenario impossible to observe: a stated target, routed away, no
      // probability back, and total silence. This assertion is the inversion of
      // the old T10 in tests/auto-constraint-fallback.test.ts.
      await run({
        graph: graphWithGoal(),
        options: OPTIONS,
        goal_node_id: 'goal_arr',
        seed: '42',
        goal_threshold: 0.7,
        goal_constraints: [
          { constraint_id: 'lever_floor', node_id: 'lever', operator: '>=', value: 0.6 },
        ],
      });

      const w = warned();
      expect(w).toBeDefined();
      expect(w.goal_threshold).toBeNull();   // nothing was sent to ISL
      expect(w.goal_target).toBe(0.7);       // but the user did state a target
      expect(w.goal_target_source).toBe('request');
    });

    it('FIRES on a raw-only target (goal_threshold_raw with no normalised twin)', async () => {
      await run({
        graph: graphWithGoal({ goal_threshold_raw: 6000000, goal_threshold_unit: '£' }),
        options: OPTIONS,
        goal_node_id: 'goal_arr',
        seed: '42',
      });

      const w = warned();
      expect(w).toBeDefined();
      expect(w.goal_target_source).toBe('goal_node_raw');
      expect(w.goal_target).toBe(6000000);
    });

    it('does NOT fire when no target was stated (the alarm can be silent)', async () => {
      // Trap 13 in the other direction: an alarm that fires on everything is as
      // useless as one that never fires. This proves it discriminates.
      await run({
        graph: graphWithGoal(),
        options: OPTIONS,
        goal_node_id: 'goal_arr',
        seed: '42',
      });

      expect(warned()).toBeUndefined();
    });
  });
});
