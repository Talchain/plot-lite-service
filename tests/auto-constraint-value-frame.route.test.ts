/**
 * ROADMAP 2.1023 — THE AUTO-SYNTHESISED CONSTRAINT MUST CARRY ITS OWN FRAME.
 *
 * THE DEFECT. `run.ts` synthesises `auto_goal_threshold` ONLY when the goal
 * node's `goal_threshold_frame` is attested `'delta'` (the 2.266 gate). So at
 * the moment of synthesis PLoT KNOWS the frame — and then builds the constraint
 * without `value_frame`. The translator forwards `value_frame` by presence
 * (2.855, `translator-v3.ts`), so an absent key means an absent key on the wire.
 *
 * WHY THAT REMOVES SCIENCE RATHER THAN CORRUPTING IT. ISL fails closed on an
 * unstamped constraint. That is not inferred — it is witnessed in this repo's
 * own dated capture corpus against ISL commit c695feb7
 * (`tests/fixtures/isl-constraint-value-frame-20260807/`):
 *
 *     A  no value_frame        -> constraint_analysis ABSENT
 *     B  value_frame 'delta'   -> constraint_analysis PRESENT (0.856 / 0.032)
 *     D  key misspelled        -> ABSENT (unknown keys are ignored, not errored)
 *
 * So the user loses `constraint_probabilities`, `probability_of_joint_goal`,
 * `goal_fit` and win-sensitivity — silently, with a 200 on the wire.
 *
 * THE ASSERTION SURFACE is the OUTBOUND ISL REQUEST BODY. A response-side
 * assertion here would be worthless: the in-repo mock returns a fabricated
 * `constraint_analysis` for ANY constraint, framed or not, so it agrees with
 * itself. T3 below pins that the mock now models the captured refusal instead.
 *
 * BINDING BY IDENTITY, not by a value predicate: every assertion locates the
 * constraint by `constraint_id === 'auto_goal_threshold'`, so a user-authored
 * constraint that happened to share a value could not satisfy it.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let capturedISLRequestBody: any = null;

// ---------------------------------------------------------------------------
// ISL mock — models the CAPTURED fail-closed contract rather than fabricating.
// Derived from the dated corpus, not from this lane's belief about ISL.
// ---------------------------------------------------------------------------
function mockResultRows(body: any) {
  const options = body.options || [];
  const constraints = body.goal_constraints || [];
  // ISL evaluates ONLY constraints stamped `value_frame: 'delta'`; everything
  // else yields no constraint_analysis at all (corpus arms A / D / E).
  const evaluable = constraints.filter((c: any) => c.value_frame === 'delta');
  return options.map((opt: any, idx: number) => ({
    option_id: opt.id,
    outcome: {
      mean: 0.2915, std: 0.2048, p10: 0.05, p50: 0.294, p90: 0.555,
      n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0,
    },
    rank: idx + 1,
    ...(evaluable.length > 0
      ? {
          constraint_analysis: {
            constraints: evaluable.map((c: any) => ({
              constraint_id: c.constraint_id,
              prob_satisfied: 0.856,
              satisfied: true,
            })),
            joint_probability: 0.856,
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
        options: mockResultRows(body),
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

const GOAL_TARGET_DELTA = {
  goal_threshold: 0.8,
  goal_threshold_raw: 6000000,
  goal_threshold_unit: '£',
  goal_threshold_cap: 7500000,
  goal_threshold_frame: 'delta',
};

describe('ROADMAP 2.1023 — the auto-synthesised constraint carries value_frame', () => {
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
      seed: 'auto-frame-21023',
      ...extra,
    };
  }

  // -------------------------------------------------------------------------
  // T0 — PRECONDITION PIN. Without this, T1 could pass vacuously on a run that
  // synthesised nothing at all. Asserts the constraint EXISTS before asserting
  // anything about its frame.
  // -------------------------------------------------------------------------
  it('T0 PRECONDITION: a delta-attested target DOES synthesise auto_goal_threshold', async () => {
    const { isl } = await run(basePayload(GOAL_TARGET_DELTA));
    expect(isl).not.toBeNull();
    const auto = ((isl.goal_constraints ?? []) as any[]).find(
      (c) => c.constraint_id === 'auto_goal_threshold',
    );
    expect(auto).toBeDefined();
    expect(auto.value).toBe(0.8);
  });

  // -------------------------------------------------------------------------
  // T1 — THE DEFECT. The synthesised constraint reaches ISL with no frame, so
  // ISL fails closed and the joint-goal science is silently omitted.
  // -------------------------------------------------------------------------
  it("T1 DEFECT: auto_goal_threshold reaches the ISL wire stamped value_frame 'delta'", async () => {
    const { isl } = await run(basePayload(GOAL_TARGET_DELTA));
    const auto = ((isl.goal_constraints ?? []) as any[]).find(
      (c) => c.constraint_id === 'auto_goal_threshold',
    );
    expect(auto).toBeDefined();
    expect(auto.value_frame).toBe('delta');
  });

  // -------------------------------------------------------------------------
  // T2 — THE WIRE CONSEQUENCE. A frame that only changes an internal plan is
  // theatre; this asserts the science the user actually receives.
  // -------------------------------------------------------------------------
  it('T2 DEFECT: the joint-goal figure reaches the response', async () => {
    const { res } = await run(basePayload(GOAL_TARGET_DELTA));
    const body = res.json() as any;
    const withJoint = (body.option_comparison ?? []).filter(
      (o: any) => o.probability_of_joint_goal !== undefined,
    );
    expect(withJoint.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // T3 — THE MOCK IS NOT FABRICATING. This is the guard that stops C recurring:
  // it proves the mock DISCRIMINATES on the frame, so a green T1/T2 cannot be
  // the mock agreeing with itself. Bound to the captured corpus, so the mock's
  // contract is derived from ISL's witnessed behaviour, not from belief.
  // -------------------------------------------------------------------------
  it('T3 INSTRUMENT: an UNFRAMED user constraint yields NO constraint_analysis (mock fails closed)', async () => {
    const { res, isl } = await run(
      basePayload(
        { goal_threshold: 0.8, goal_threshold_raw: 6000000, goal_threshold_unit: '£' },
        {
          goal_constraints: [
            { constraint_id: 'user_unframed', node_id: 'goal_arr', operator: '>=', value: 0.5 },
          ],
        },
      ),
    );
    // It DOES reach the wire (PLoT forwards user constraints verbatim)...
    const sent = (isl.goal_constraints ?? []) as any[];
    expect(sent.map((c) => c.constraint_id)).toContain('user_unframed');
    expect(sent.find((c) => c.constraint_id === 'user_unframed').value_frame).toBeUndefined();
    // ...and ISL returns nothing for it, exactly as corpus arm A witnessed.
    const body = res.json() as any;
    for (const opt of body.option_comparison ?? []) {
      expect(opt.probability_of_joint_goal, opt.option_id).toBeUndefined();
    }
  });

  // -------------------------------------------------------------------------
  // T4 — THE CAPTURED CONTRACT IS REAL. Pins the mock's fail-closed rule to the
  // dated corpus so a future tidy-up of the mock cannot quietly restore the
  // fabrication. (Trap 12: derive, don't mirror — and fail loud on drift.)
  // -------------------------------------------------------------------------
  it('T4 CORPUS: the captured ISL arms still say framed=analysis, unframed=absent', () => {
    const dir = fileURLToPath(new URL('./fixtures/isl-constraint-value-frame-20260807/', import.meta.url));
    const read = (n: string) => JSON.parse(readFileSync(dir + n, 'utf8'));

    const aReq = read('A-control-no-frame.request.json');
    const aRes = read('A-control-no-frame.response.json');
    const bReq = read('B-valid-delta.request.json');
    const bRes = read('B-valid-delta.response.json');

    // Preconditions: the arms differ EXACTLY as claimed.
    expect(aReq.goal_constraints[0].value_frame).toBeUndefined();
    expect(bReq.goal_constraints[0].value_frame).toBe('delta');

    // Non-empty control: both captures actually carry results.
    expect(aRes.results.length).toBeGreaterThan(0);
    expect(bRes.results.length).toBeGreaterThan(0);

    // The contract the mock models.
    for (const r of aRes.results) expect(r.constraint_analysis ?? null).toBeNull();
    for (const r of bRes.results) expect(r.constraint_analysis?.joint_probability).toBeTypeOf('number');
  });

  // -------------------------------------------------------------------------
  // T5 — SCOPE PIN / DISCRIMINATING TWIN. A user-authored constraint keeps its
  // OWN frame; the fix must stamp the synthesised one WITHOUT overwriting
  // anyone else's. Without this, "stamp every constraint delta" would pass T1.
  // -------------------------------------------------------------------------
  it("T5 SCOPE: a user constraint's own 'level' frame is NOT overwritten by the fix", async () => {
    const { isl } = await run(
      basePayload(GOAL_TARGET_DELTA, {
        goal_constraints: [
          { constraint_id: 'user_level', node_id: 'goal_arr', operator: '>=', value: 0.5, value_frame: 'level' },
        ],
      }),
    );
    const sent = (isl.goal_constraints ?? []) as any[];
    const user = sent.find((c) => c.constraint_id === 'user_level');
    expect(user).toBeDefined();
    expect(user.value_frame).toBe('level');
  });
});
