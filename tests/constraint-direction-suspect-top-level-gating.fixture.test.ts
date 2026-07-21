/**
 * A3 adjacent-hunt FIX #1 — direction-suspect top-level constraint_results leak.
 *
 * CONFIRMED PRE-EXISTING LEAK (RED before the fix):
 *
 * The per-option honesty gate withholds `probability_of_joint_goal` /
 * `constraint_probabilities` when the auto-constraint's guessed '>=' direction
 * is structurally unsatisfiable (isAutoConstraintDirectionSuspect fires:
 * positive auto-threshold + strictly-negative modelled outcome). But the
 * TOP-LEVEL constraint block built by buildConstraintFields() is gated ONLY on
 * the suppressed-target partition — NOT on direction-suspicion. On a
 * direction-suspect run whose targets are otherwise decision-grade (real base
 * + non-default normalisation range ⇒ `suppressed` is empty), the top-level
 * surface re-emits `constraint_results[].probability` = the first option's
 * near-0 prob_satisfied under `constraints_status: 'computed'` — leaking the
 * exact number the per-option gate just withheld.
 *
 * Contract under test (mirrors the suppressed-target top-level gate, for the
 * direction-suspect partition):
 *   - DIRECTION-SUSPECT run with `suppressed` empty: the top-level block is
 *     withheld — `constraints_status: 'unavailable'` and NO constraint_results
 *     / constraint_diagnostics / conditional_probabilities. Absence is honest;
 *     the WARNING-severity CONSTRAINT_DIRECTION_SUSPECT explains WHY.
 *   - CONTROL (positive/satisfiable outcome): the top-level block DELIVERS
 *     unchanged — regression pin.
 *
 * The ISL request/ISL service shape is not changed — the mock mirrors
 * tests/goal-fit-direction-defense.fixture.test.ts (live wire shapes).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Mutable mock state (per-request ISL behaviour)
// ---------------------------------------------------------------------------

/**
 * 'negative': every option's modelled outcome stays negative even at p90
 * (structurally can never satisfy '>= positive_threshold' → direction-suspect).
 * 'positive': normal satisfiable-looking outcome + high joint prob (control /
 * regression case — no critique because it's feasible).
 * 'infeasible_positive': satisfiable-DIRECTION outcome (p90 > 0, so NOT
 * direction-suspect) but a genuinely-low joint probability — a real
 * "this may not reach the target" signal that MUST survive the coaching gate.
 * This is the positive control that proves the direction-suspect skip does not
 * over-suppress honest GOAL_FEASIBILITY_LOW warnings.
 */
let outcomeMode: 'negative' | 'positive' | 'infeasible_positive' = 'positive';

/** The near-0 prob_satisfied the per-option gate withholds and the top-level block leaks. */
const NEG_PROB = 0.02;
const POS_PROB = 0.72;
/** Genuinely-low feasibility (< readiness_joint_prob_floor 0.05) on a NON-suspect run. */
const LOW_FEASIBLE_PROB = 0.03;

function buildOutcome(idx: number) {
  if (outcomeMode === 'negative') {
    // Whole modelled distribution below zero — '>= positive' unsatisfiable.
    return { mean: -0.4, std: 0.1, p10: -0.6, p50: -0.4, p90: -0.1, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 };
  }
  // 'positive' AND 'infeasible_positive' share a satisfiable-DIRECTION outcome
  // (p90 > 0 ⇒ isAutoConstraintDirectionSuspect returns false). They differ
  // only in the joint probability the mock reports below.
  return { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 };
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
    const options = body.options || [];
    const goalConstraints = body.goal_constraints || [];
    const prob = outcomeMode === 'negative'
      ? NEG_PROB
      : outcomeMode === 'infeasible_positive'
        ? LOW_FEASIBLE_PROB
        : POS_PROB;

    const constraintAnalysis = goalConstraints.length > 0
      ? {
          constraint_analysis: {
            joint_probability: prob,
            constraints: goalConstraints.map((c: any) => ({
              node_id: c.node_id,
              operator: c.operator,
              threshold: c.threshold ?? c.value,
              prob_satisfied: prob,
            })),
          },
        }
      : {};

    return {
      data: {
        options: options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: buildOutcome(idx),
          win_probability: idx === 0 ? 0.6 : 0.4,
          rank: idx + 1,
          ...constraintAnalysis,
        })),
        factor_sensitivity: [],
        robustness: { label: 'moderate', score: 0.6, fragile_edges: [], robust_edges: [] },
        // NO CONSTRAINT_NODE_DEFAULT_BASE — the target has a real observed base,
        // so `target_base_defaulted` never fires (suppressed partition empty).
        inference_warnings: [],
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

// ---------------------------------------------------------------------------
// Fixtures — goal node carries a real observed base (value 50 ⇒ deriveRange
// infers [0, 100], a NON-default normalisation range), so the auto-constraint's
// target is decision-grade and `suppressed` stays empty. The auto-threshold is
// a raw positive user quantity (20) that normalises against that [0,100] range.
// ---------------------------------------------------------------------------

const GRAPH = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Net revenue change', observed_state: { value: 50 } },
    { id: 'fac_spend', kind: 'factor', label: 'Marketing spend', observed_state: { value: 40 } },
  ],
  edges: [
    { from: 'fac_spend', to: 'goal_growth', strength: { mean: 0.5, std: 0.1 } },
  ],
};

// Interventions in RAW units (outside [0,1]) force the normalisation ladder to
// run, so the constraint threshold is normalised against a recorded, non-default
// range rather than forwarded raw.
const OPTIONS = [
  { id: 'opt_a', label: 'Increase spend', interventions: { fac_spend: 80 } },
  { id: 'opt_b', label: 'Hold steady', interventions: { fac_spend: 30 } },
];

async function run(app: FastifyInstance, goalThreshold: number) {
  const res = await app.inject({
    method: 'POST',
    url: '/v2/run',
    headers: { 'Content-Type': 'application/json' },
    payload: JSON.stringify({
      graph: GRAPH,
      options: OPTIONS,
      goal_node_id: 'goal_growth',
      seed: 'direction-suspect-top-level-gating',
      goal_threshold: goalThreshold,
    }),
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body);
}

describe('top-level constraint_results gating by direction-suspicion (A3 adjacent-hunt FIX #1)', () => {
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
    await app.close();
    outcomeMode = 'positive';
  });

  it('LEAK: direction-suspect run with empty suppressed partition must withhold the top-level block', async () => {
    outcomeMode = 'negative';
    try {
      const body = await run(app, 20);

      // Preconditions — the scenario is exactly the co-occurrence the leak needs.
      // (a) direction-suspect fired:
      const suspect = (body.inference_warnings ?? []).filter(
        (w: any) => w.code === 'CONSTRAINT_DIRECTION_SUSPECT',
      );
      expect(suspect).toHaveLength(1);
      // (b) suppressed partition is EMPTY (real base + non-default range ⇒ target
      //     is decision-grade → no CONSTRAINT_TARGET_UNRELIABLE):
      const unreliable = (body.inference_warnings ?? []).filter(
        (w: any) => w.code === 'CONSTRAINT_TARGET_UNRELIABLE',
      );
      expect(unreliable).toHaveLength(0);
      // (c) per-option honesty gate already holds:
      for (const opt of body.option_comparison) {
        expect(opt, opt.option_id).not.toHaveProperty('probability_of_joint_goal');
        expect(opt, opt.option_id).not.toHaveProperty('constraint_probabilities');
      }

      // THE LEAK (RED on base): the withheld ~0 prob re-surfaces at the top level
      // as constraint_results[0].probability under a fabricated 'computed'.
      expect(body.constraints_status).toBe('unavailable');
      expect(body).not.toHaveProperty('constraint_results');
      expect(body).not.toHaveProperty('constraint_diagnostics');
      expect(body).not.toHaveProperty('conditional_probabilities');
    } finally {
      outcomeMode = 'positive';
    }
  });

  it('CONTROL: satisfiable outcome — top-level constraint block DELIVERS unchanged', async () => {
    outcomeMode = 'positive';
    const body = await run(app, 20);

    // No direction-suspicion, no suppression → the block delivers.
    const suspect = (body.inference_warnings ?? []).filter(
      (w: any) => w.code === 'CONSTRAINT_DIRECTION_SUSPECT',
    );
    expect(suspect).toHaveLength(0);

    expect(body.constraints_status).toBe('computed');
    expect(Array.isArray(body.constraint_results)).toBe(true);
    expect(body.constraint_results.length).toBe(1);
    expect(body.constraint_results[0].probability).toBe(POS_PROB);
  });

  // ---------------------------------------------------------------------------
  // FIX #1 coaching companion (adversarial-pass finding #1): the leak also
  // escapes via the M1 joint-probability gate. applyJointProbabilityGate reads
  // the RAW ISL joint_probability directly, so on a direction-suspect run it
  // emits GOAL_FEASIBILITY_LOW ("may not achieve the target") into
  // m1_coaching.model_critiques — AND assembleBrief folds that into
  // decision_brief.warnings[] — from the SAME near-0 the wire block now
  // withholds. Post-FIX-#1 the response is internally INCOHERENT
  // (constraints_status 'unavailable' vs a definite feasibility verdict). The
  // coaching gate is guarded on the SUPPRESSED-target partition, which is EMPTY
  // on this decision-grade direction-suspect run, so the guard never fires.
  // The companion fix ORs the direction-suspect condition into that guard.
  // ---------------------------------------------------------------------------

  it('COACHING LEAK: direction-suspect run must NOT emit GOAL_FEASIBILITY_LOW in coaching or brief', async () => {
    outcomeMode = 'negative';
    try {
      const body = await run(app, 20);

      // Same co-occurrence preconditions as the wire-block LEAK test.
      const suspect = (body.inference_warnings ?? []).filter(
        (w: any) => w.code === 'CONSTRAINT_DIRECTION_SUSPECT',
      );
      expect(suspect).toHaveLength(1);
      const unreliable = (body.inference_warnings ?? []).filter(
        (w: any) => w.code === 'CONSTRAINT_TARGET_UNRELIABLE',
      );
      expect(unreliable).toHaveLength(0);
      // Wire block already withheld (FIX #1) — the incoherence this test closes
      // is coaching CONTRADICTING that 'unavailable'.
      expect(body.constraints_status).toBe('unavailable');

      // Positive control INSIDE the assertion: the coaching machinery IS present
      // and DID run (so the absence below is a real skip, not a missing block).
      expect(body.m1_coaching, 'm1_coaching must be generated').toBeTruthy();
      expect(Array.isArray(body.m1_coaching.model_critiques)).toBe(true);

      // THE COACHING LEAK (RED at 94b46e7): the withheld ~0 re-surfaces as a
      // definite GOAL_FEASIBILITY_LOW feasibility verdict.
      const coachingTypes = body.m1_coaching.model_critiques.map((c: any) => c.type);
      expect(coachingTypes).not.toContain('GOAL_FEASIBILITY_LOW');

      // Second wire surface (same root): decision_brief folds coaching critiques
      // into warnings[]. It must not carry the direction-suspect feasibility claim.
      // Hard presence assertion (not a vacuous guard): a 'computed' 2-option run
      // always assembles a brief.
      expect(body.decision_brief, 'decision_brief must be assembled').toBeTruthy();
      const briefCodes = (body.decision_brief.warnings ?? []).map((w: any) => w.code);
      expect(briefCodes).not.toContain('GOAL_FEASIBILITY_LOW');
    } finally {
      outcomeMode = 'positive';
    }
  });

  it('POSITIVE CONTROL: genuinely-infeasible NON-suspect run STILL emits GOAL_FEASIBILITY_LOW', async () => {
    // p90 > 0 ⇒ NOT direction-suspect; joint prob 0.03 < floor 0.05 ⇒ a real
    // low-feasibility signal. The direction-suspect skip must NOT touch it.
    outcomeMode = 'infeasible_positive';
    try {
      const body = await run(app, 20);

      // NOT direction-suspect, and suppressed partition empty → the gate runs.
      const suspect = (body.inference_warnings ?? []).filter(
        (w: any) => w.code === 'CONSTRAINT_DIRECTION_SUSPECT',
      );
      expect(suspect).toHaveLength(0);
      const unreliable = (body.inference_warnings ?? []).filter(
        (w: any) => w.code === 'CONSTRAINT_TARGET_UNRELIABLE',
      );
      expect(unreliable).toHaveLength(0);

      // Honest low feasibility is DELIVERED on the wire block (not withheld)...
      expect(body.constraints_status).toBe('computed');
      expect(body.constraint_results[0].probability).toBe(LOW_FEASIBLE_PROB);

      // ...and the honest GOAL_FEASIBILITY_LOW coaching critique SURVIVES
      // (green both with and without the fix — the fix must not over-suppress).
      expect(body.m1_coaching, 'm1_coaching must be generated').toBeTruthy();
      const coachingTypes = body.m1_coaching.model_critiques.map((c: any) => c.type);
      expect(coachingTypes).toContain('GOAL_FEASIBILITY_LOW');

      expect(body.decision_brief, 'decision_brief must be assembled').toBeTruthy();
      const briefCodes = (body.decision_brief.warnings ?? []).map((w: any) => w.code);
      expect(briefCodes).toContain('GOAL_FEASIBILITY_LOW');
    } finally {
      outcomeMode = 'positive';
    }
  });
});
