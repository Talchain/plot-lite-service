/**
 * CONSTRAINT_DIRECTION_SUSPECT fixture test (lane PLoT-goal-fit-sign-defense).
 *
 * Third blind spot on the Phase 1c+ auto-constraint fallback (run.ts
 * ~line 3696): when `goal_constraints` is empty but a bare `goal_threshold`
 * exists, PLoT synthesises a single `>= goal_threshold` constraint. PLoT has
 * no visibility into the goal-framing text CEE extracted the number from —
 * a target phrased as a maximum ("keep churn under X") needs `<=`, not the
 * hardcoded `>=`. Guessing wrong usually just produces a plausible-but-wrong
 * probability (invisible on the wire). This test pins the one sub-case PLoT
 * CAN detect on its own evidence, with no NLP: the guessed threshold is
 * positive, but the modelled outcome for the SAME target node never reaches
 * non-negative territory even at its most favourable sampled percentile
 * (p90 < 0). `>= positive_threshold` is then structurally unsatisfiable —
 * ISL's ~0% joint probability is a mechanical certainty of the sign
 * mismatch, not a computed signal about the graph. The fix must:
 *   - SUPPRESS probability_of_joint_goal / constraint_probabilities for the
 *     affected option (absence is honest — same contract as
 *     CONSTRAINT_TARGET_UNRELIABLE);
 *   - emit exactly one WARNING-severity CONSTRAINT_DIRECTION_SUSPECT naming
 *     the node, via the existing code-keyed inference_warnings channel;
 *   - leave the normal (non-suspect, e.g. positive-outcome) auto-constraint
 *     path byte-for-byte unchanged — this is a narrow abstention, not a
 *     behaviour change to the fallback itself;
 *   - never fire for explicit user-supplied constraints (PLoT only guesses
 *     direction for its OWN synthesis — a user who wrote `>=` explicitly
 *     meant it).
 *
 * The ISL request/ISL service shape is not changed — only the constraint
 * fallback + response-assembly honesty layer in run.ts.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Mutable mock state (per-request ISL behaviour)
// ---------------------------------------------------------------------------

/**
 * 'negative': every option's modelled outcome stays negative even at p90
 * (structurally can never satisfy '>= positive_threshold').
 * 'positive': normal satisfiable-looking outcome (control / regression case).
 */
let outcomeMode: 'negative' | 'positive' = 'positive';

function buildOutcome(idx: number) {
  if (outcomeMode === 'negative') {
    // Every percentile strictly negative — the whole modelled distribution
    // sits below zero, so a '>= positive' threshold can never be reached.
    return { mean: -0.4, std: 0.1, p10: -0.6, p50: -0.4, p90: -0.1, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 };
  }
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

    // ISL evaluates the (near-)guaranteed-unsatisfiable case exactly like any
    // other: a real Monte Carlo joint probability that happens to round to
    // ~0 because the sampled distribution never crosses the threshold. This
    // mirrors the live "fake ~0%" shape — ISL is not at fault; it computed
    // honestly against what it was sent.
    const constraintAnalysis = goalConstraints.length > 0
      ? {
          constraint_analysis: {
            joint_probability: outcomeMode === 'negative' ? 0.001 : 0.72,
            constraints: goalConstraints.map((c: any) => ({
              node_id: c.node_id,
              operator: c.operator,
              threshold: c.threshold ?? c.value,
              prob_satisfied: outcomeMode === 'negative' ? 0.001 : 0.72,
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
// Fixtures
// ---------------------------------------------------------------------------

const GRAPH = {
  nodes: [
    // The goal node is the auto-constraint's implicit target (Phase 1c+
    // synthesises node_id: goal_node_id).
    //
    // ROADMAP 2.266: the auto-synthesis is now gated on
    // `goal_threshold_frame === 'delta'` — the only frame provably matching the
    // change-from-baseline samples ISL evaluates constraints against. This
    // suite is about the SIGN defence, not about framing, so the frame is
    // stamped here to keep the synthesis engaged and the subject under test
    // reachable. (A 'delta' frame is also the honest reading of this fixture:
    // the goal node is literally labelled "Net cost change".)
    { id: 'goal_cost_reduction', kind: 'goal', label: 'Net cost change', goal_threshold_frame: 'delta' },
    { id: 'fac_spend', kind: 'factor', label: 'Marketing spend', observed_state: { value: 0.5 } },
  ],
  edges: [
    { from: 'fac_spend', to: 'goal_cost_reduction', strength: { mean: 0.5, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt_a', label: 'Increase spend', interventions: { fac_spend: 0.8 } },
  { id: 'opt_b', label: 'Hold steady', interventions: { fac_spend: 0.4 } },
];

async function run(app: FastifyInstance, goalThreshold: number, explicitConstraint?: any) {
  const payload: Record<string, unknown> = {
    graph: GRAPH,
    options: OPTIONS,
    goal_node_id: 'goal_cost_reduction',
    seed: 'goal-fit-direction-defense',
    goal_threshold: goalThreshold,
  };
  if (explicitConstraint) {
    payload.goal_constraints = [explicitConstraint];
  }
  const res = await app.inject({
    method: 'POST',
    url: '/v2/run',
    headers: { 'Content-Type': 'application/json' },
    payload: JSON.stringify(payload),
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body);
}

describe('CONSTRAINT_DIRECTION_SUSPECT (auto-constraint sign defense)', () => {
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

  it('RED: strictly-negative modelled outcome + positive auto-threshold → suppressed fields + CONSTRAINT_DIRECTION_SUSPECT', async () => {
    outcomeMode = 'negative';
    try {
      const body = await run(app, 0.5);

      expect(body.analysis_status).not.toBe('blocked');
      expect(Array.isArray(body.option_comparison)).toBe(true);
      expect(body.option_comparison.length).toBe(2);

      // Abstention, not fabrication: no fake ~0% on the wire.
      for (const opt of body.option_comparison) {
        expect(opt, opt.option_id).not.toHaveProperty('probability_of_joint_goal');
        expect(opt, opt.option_id).not.toHaveProperty('constraint_probabilities');
      }

      const warnings = (body.inference_warnings ?? []).filter(
        (w: any) => w.code === 'CONSTRAINT_DIRECTION_SUSPECT',
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warning');
      expect(warnings[0].message).toContain('Net cost change');
      // Raw fabricated-looking number never quoted.
      expect(warnings[0].message).not.toContain('0.001');
      expect(warnings[0].message).not.toContain('0%');
    } finally {
      outcomeMode = 'positive';
    }
  });

  it('CONTROL: positive/satisfiable modelled outcome — auto-constraint path byte-unchanged (no suppression, no new warning)', async () => {
    outcomeMode = 'positive';
    const body = await run(app, 0.5);

    for (const opt of body.option_comparison) {
      expect(opt.probability_of_joint_goal, opt.option_id).toBe(0.72);
      expect(opt.constraint_probabilities, opt.option_id).toEqual({ auto_goal_threshold: 0.72 });
    }

    const warnings = (body.inference_warnings ?? []).filter(
      (w: any) => w.code === 'CONSTRAINT_DIRECTION_SUSPECT',
    );
    expect(warnings).toHaveLength(0);

    // Auto-synthesis repair still fires exactly as before (unrelated to this defence).
    const autoRepair = (body._meta?.repairs_applied ?? []).find(
      (r: any) => r.field === 'goal_constraints' && r.action === 'derived',
    );
    expect(autoRepair).toBeDefined();
  });

  it('does NOT fire for an explicit user-supplied constraint (PLoT only guesses direction for its OWN synthesis)', async () => {
    outcomeMode = 'negative';
    try {
      const body = await run(app, undefined as unknown as number, {
        constraint_id: 'user_target',
        node_id: 'goal_cost_reduction',
        operator: '>=',
        value: 0.5,
      });

      // No auto-synthesis (explicit constraint present) → the defensive
      // sign-check is scoped to _internal.source === 'auto_from_goal_threshold'
      // only, so it must not fire here even though the outcome is negative.
      const warnings = (body.inference_warnings ?? []).filter(
        (w: any) => w.code === 'CONSTRAINT_DIRECTION_SUSPECT',
      );
      expect(warnings).toHaveLength(0);

      // The user explicitly asked for this comparison — ISL's honestly-
      // computed near-zero is delivered, not suppressed by this lane.
      for (const opt of body.option_comparison) {
        expect(opt.probability_of_joint_goal, opt.option_id).toBe(0.001);
      }
    } finally {
      outcomeMode = 'positive';
    }
  });
});
