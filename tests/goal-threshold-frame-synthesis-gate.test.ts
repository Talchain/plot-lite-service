/**
 * ROADMAP 2.266 — the AUTO-SYNTHESISED goal constraint must not be evaluated in
 * the wrong frame.
 *
 * WHY THIS FILE EXISTS. 2.258 taught ISL's MAIN path to refuse a goal threshold
 * whose frame is unknown: `probability_of_goal` is omitted and
 * GOAL_THRESHOLD_FRAME_UNSPECIFIED rides back. But the same threshold is ALSO
 * auto-materialised as a constraint (`auto_goal_threshold`, run.ts Phase 1c+),
 * and ISL evaluates constraints against the goal node's change-from-baseline
 * samples WITHOUT consulting any frame. One path refused; the parallel path
 * shipped the very comparison the first one declined.
 *
 * WITNESSED (`PHASE0-EVIDENCE-2026-07-28/witness-2258-goal-probability-live.md`,
 * three live runs, 2026-08-01): a target of 0.8 — a LEVEL, £6,000,000 against a
 * £7,500,000 cap — was synthesised verbatim and compared against uplift samples
 * with mean 0.2915. ISL answered "is the UPLIFT >= £6,000,000?" and returned
 * `constraint_probabilities.auto_goal_threshold = 0.0054`, mirrored to
 * `probability_of_joint_goal` and `analysis_summary.goal_fit`. The question the
 * user asked answers ~0.55. The screen said "< 1%" — a ~100x understatement.
 *
 * THE ASSERTION SURFACE. Every test reads the OUTBOUND ISL REQUEST BODY, and
 * the wire tests below read the RESPONSE. A 200 proves a response, not a
 * computation.
 *
 * SCOPE. USER-authored `goal_constraints` are untouched — T5 pins that.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// ISL mock — captures the outbound request body verbatim, and returns a
// constraint_analysis whenever constraints were sent, so the RESPONSE-side
// assertions below exercise the real assembly path rather than a stub.
// ---------------------------------------------------------------------------

let capturedISLRequestBody: any = null;

function mockOptionRows(body: any) {
  const options = body.options || [];
  const constraints = body.goal_constraints || [];
  return options.map((opt: any, idx: number) => ({
    option_id: opt.id,
    outcome: {
      mean: 0.2915, std: 0.2048, p10: 0.05, p50: 0.294, p90: 0.555,
      n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0,
    },
    rank: idx + 1,
    // The witnessed shape: ISL evaluates whatever constraints it is sent and
    // returns a near-zero probability for a level-vs-delta comparison.
    ...(constraints.length > 0
      ? {
          constraint_analysis: {
            constraints: constraints.map((c: any) => ({
              constraint_id: c.constraint_id,
              prob_satisfied: 0.0054,
              satisfied: false,
            })),
            joint_probability: 0.0054,
          },
        }
      : {}),
  }));
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
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return {
      options: options.map((opt: any, idx: number) => ({
        option_id: opt.id,
        outcome: {
          mean: 0.2915, std: 0.2048, p10: 0.05, p50: 0.294, p90: 0.555,
          n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0,
        },
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
    return {
      data: {
        options: mockOptionRows(body),
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
// Fixtures — the witnessed Run-1 shape, reduced.
// ---------------------------------------------------------------------------

const OPTIONS = [
  { id: 'opt1', label: 'Expand Leeds', interventions: { lever: 0.9 } },
  { id: 'opt2', label: 'Expand Bristol', interventions: { lever: 0.2 } },
];

function graphWithGoal(goalOverrides: Record<string, unknown> = {}) {
  return {
    nodes: [
      {
        id: 'goal_arr',
        kind: 'goal',
        label: 'Reach 6M ARR',
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

/** The witnessed live shape: a target, and NO frame stamped. */
const GOAL_TARGET_UNSTAMPED = {
  goal_threshold: 0.8,
  goal_threshold_raw: 6000000,
  goal_threshold_unit: '£',
  goal_threshold_cap: 7500000,
};

describe('ROADMAP 2.266 — auto-synthesis is gated on the ISL sample frame', () => {
  let app: FastifyInstance;

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
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload });
    return { res, isl: capturedISLRequestBody };
  }

  function basePayload(goalNodeExtras: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    return {
      graph: graphWithGoal(goalNodeExtras),
      options: OPTIONS,
      goal_node_id: 'goal_arr',
      seed: 'frame-gate-2266',
      ...extra,
    };
  }

  // -------------------------------------------------------------------------
  // T1 — THE WITNESSED RUN-1 SHAPE. Threshold present, frame ABSENT.
  // Before this row: one synthesised constraint reached ISL. After: none.
  // -------------------------------------------------------------------------
  it('T1: frame ABSENT — no auto constraint is synthesised', async () => {
    const { res, isl } = await run(basePayload(GOAL_TARGET_UNSTAMPED));

    expect(res.statusCode).toBe(200);
    expect(isl).not.toBeNull();

    const sent = (isl.goal_constraints ?? []) as any[];
    expect(sent.find((c) => c.constraint_id === 'auto_goal_threshold')).toBeUndefined();
    expect(sent).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // T2 — THE WIRE. A guard that only changes an internal plan is theatre, so
  // this asserts what CEE actually receives: the joint-goal figure is ABSENT,
  // not zero. (`buildResponse` omits the whole constraint block when no
  // constraints were sent — run.ts:2095-2098.)
  // -------------------------------------------------------------------------
  it('T2: frame ABSENT — the response carries NO goal_fit derived from the synthesis', async () => {
    const { res } = await run(basePayload(GOAL_TARGET_UNSTAMPED));
    const body = res.json() as any;

    for (const opt of body.option_comparison ?? []) {
      expect(opt.constraint_probabilities, opt.option_id).toBeUndefined();
      expect(opt.probability_of_joint_goal, opt.option_id).toBeUndefined();
      expect(opt.goal_fit_basis, opt.option_id).toBeUndefined();
    }

    // And nothing re-introduces it downstream in the brief.
    expect(body.decision_brief?.analysis_summary?.goal_fit).toBeUndefined();

    // The near-zero witnessed value must appear NOWHERE on the wire.
    expect(JSON.stringify(body)).not.toContain('0.0054');
  });

  // -------------------------------------------------------------------------
  // T3 — REFUSING THE CONSTRAINT MUST NOT WITHDRAW THE TARGET.
  // The disclosure is the whole point: ISL still receives goal_threshold, so it
  // still returns GOAL_THRESHOLD_FRAME_UNSPECIFIED. Clearing it would turn a
  // DISCLOSED gap into a SILENT one.
  // -------------------------------------------------------------------------
  it('T3: frame ABSENT — goal_threshold still reaches ISL (request-root target)', async () => {
    const { isl } = await run(basePayload(GOAL_TARGET_UNSTAMPED, { goal_threshold: 0.8 }));
    expect(isl.goal_threshold).toBe(0.8);
    expect(isl.goal_threshold_frame).toBeUndefined();
  });

  it('T3b: frame ABSENT — a NODE-sourced target also still reaches ISL', async () => {
    // No request-root goal_threshold at all: the target exists only on the goal
    // node. This is the case the 2.266 carry exists for — without it, refusing
    // the synthesis would also delete the target, and ISL would return
    // "(None, None)" with nothing to disclose.
    const { isl } = await run(basePayload(GOAL_TARGET_UNSTAMPED));
    expect(isl.goal_threshold).toBe(0.8);
    expect(isl.goal_threshold_frame).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // T4 — THE 'level' CASE. This is the one that matters most for the future:
  // the witnessed target IS a level, so a gate on mere frame-PRESENCE would
  // reintroduce the ~100x error the moment CEE starts stamping.
  // -------------------------------------------------------------------------
  it("T4: frame attested 'level' — still no auto constraint (level != sample frame)", async () => {
    const { isl } = await run(
      basePayload({ ...GOAL_TARGET_UNSTAMPED, goal_threshold_frame: 'level' }),
    );

    const sent = (isl.goal_constraints ?? []) as any[];
    expect(sent.find((c) => c.constraint_id === 'auto_goal_threshold')).toBeUndefined();

    // The target and its attestation still go, so ISL's own main-path
    // converter can do the job PLoT declines to guess at.
    expect(isl.goal_threshold).toBe(0.8);
    expect(isl.goal_threshold_frame).toBe('level');
  });

  // -------------------------------------------------------------------------
  // T5 — POSITIVE CONTROL. Attested 'delta' IS the frame ISL evaluates
  // constraints in, so synthesis proceeds exactly as before. Without this the
  // gate could be satisfied by never synthesising anything at all.
  // -------------------------------------------------------------------------
  it("T5: frame attested 'delta' — synthesis PROCEEDS, unchanged", async () => {
    const { isl } = await run(
      basePayload({ ...GOAL_TARGET_UNSTAMPED, goal_threshold_frame: 'delta' }),
    );

    const sent = (isl.goal_constraints ?? []) as any[];
    const auto = sent.find((c) => c.constraint_id === 'auto_goal_threshold');
    expect(auto).toBeDefined();
    expect(auto.node_id).toBe('goal_arr');
    expect(auto.operator).toBe('>=');
    expect(auto.value).toBe(0.8);
    expect(isl.goal_threshold_frame).toBe('delta');
  });

  it("T5b: frame attested 'delta' — the joint-goal figure DOES reach the wire", async () => {
    const { res } = await run(
      basePayload({ ...GOAL_TARGET_UNSTAMPED, goal_threshold_frame: 'delta' }),
    );
    const body = res.json() as any;
    const withJoint = (body.option_comparison ?? []).filter(
      (o: any) => o.probability_of_joint_goal !== undefined,
    );
    expect(withJoint.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // T6 — SCOPE PIN. A USER-authored goal constraint is never touched by this
  // gate, frame or no frame: it does not come from the goal target and PLoT has
  // no standing to second-guess the frame the user stated it in.
  // -------------------------------------------------------------------------
  it('T6: a USER-authored goal_constraint survives with the frame ABSENT', async () => {
    const { isl } = await run(
      basePayload(GOAL_TARGET_UNSTAMPED, {
        goal_constraints: [
          { constraint_id: 'user_target', node_id: 'goal_arr', operator: '>=', value: 0.5 },
        ],
      }),
    );

    const sent = (isl.goal_constraints ?? []) as any[];
    expect(sent.map((c) => c.constraint_id)).toContain('user_target');
    expect(sent.find((c) => c.constraint_id === 'auto_goal_threshold')).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // T7 — no target at all: unchanged behaviour, and no accidental synthesis
  // just because a frame happens to be stamped.
  // -------------------------------------------------------------------------
  it('T7: a frame with NO target synthesises nothing', async () => {
    const { isl } = await run(basePayload({ goal_threshold_frame: 'delta' }));
    const sent = (isl.goal_constraints ?? []) as any[];
    expect(sent).toHaveLength(0);
  });
});
