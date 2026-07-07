/**
 * Goal-threshold normalisation fixture (lane P0-C1).
 *
 * Live defect (2026-07-07): the user registered a success target of
 * "at least 20%" ({ value: 20, unit: '%' }) on his goal node. CEE stamped the
 * goal node with the correctly-normalised `goal_threshold: 0.2` and a
 * `goal_threshold_cap: 100` for exactly this purpose — but PLoT's constraint
 * normaliser ignored BOTH the constraint's '%' unit AND the node's
 * goal_threshold_cap: `deriveRange()` reads only observed_state.cap /
 * state_space / hints, so the goal node (no observed value) fell to the
 * default [0,1] range, threshold 20 was clamped to 1.0, PLoT emitted
 * `plot.constraint_out_of_domain` + `threshold_normalisation_defaulted`, and
 * every option's goal probability came back ~0 and was suppressed as
 * unreliable — the displayed results silently ignored the user's target.
 *
 * Contract under test (RED on origin/staging 38d589cd):
 *   1. ISL receives the constraint with normalised value 0.2 (not 1.0);
 *   2. NO CONSTRAINT_OUT_OF_DOMAIN critique — the threshold IS in-domain once
 *      its producer-declared scale ('%' → 100, goal_threshold_cap) is honored;
 *   3. NO threshold_normalisation_defaulted suppression — goal-fit
 *      probabilities are emitted;
 *   4. P0-C2 doctrine B (ratified 2026-07-07): the target_base_defaulted leg
 *      ALONE no longer suppresses — goal-fit is DELIVERED, scored from the
 *      forward-propagated outcome distribution, with a goal_fit_basis
 *      annotation and an info-severity disclosure (see
 *      tests/goalfit-doctrine-b.fixture.test.ts for the full contract);
 *   5. Regression: non-'%' units and explicit-range nodes behave exactly as
 *      before.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Mutable mock state (per-request ISL behaviour)
// ---------------------------------------------------------------------------

/** When true, the ISL mock emits the CONSTRAINT_NODE_DEFAULT_BASE warning. */
let emitDefaultBaseWarning = false;

/** Captures the last analysis request body forwarded to ISL. */
let lastISLRequestBody: any = null;

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
    lastISLRequestBody = body;
    const options = body.options || [];
    const goalConstraints = body.goal_constraints || [];

    const constraintAnalysis = goalConstraints.length > 0
      ? {
          constraint_analysis: {
            joint_probability: emitDefaultBaseWarning ? 0 : 0.55,
            constraints: goalConstraints.map((c: any) => ({
              node_id: c.node_id,
              operator: c.operator,
              threshold: c.threshold ?? c.value,
              prob_satisfied: emitDefaultBaseWarning ? 0 : 0.55,
            })),
          },
        }
      : {};

    return {
      data: {
        options: options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
          win_probability: idx === 0 ? 0.6 : 0.4,
          rank: idx + 1,
          ...constraintAnalysis,
        })),
        factor_sensitivity: [],
        robustness: { label: 'moderate', score: 0.6, fragile_edges: [], robust_edges: [] },
        inference_warnings: emitDefaultBaseWarning
          ? [{
              code: 'CONSTRAINT_NODE_DEFAULT_BASE',
              field: 'nodes[goal_productivity].base',
              detail: {
                node_id: 'goal_productivity',
                defaulted_to: 0.0,
                reason: 'no_parameter_uncertainty',
                message: "Node 'goal_productivity' has no ParameterUncertainty — defaulted to base=0.0, constraint probability may be unreliable",
              },
            }]
          : [],
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

/**
 * The live shape: goal node with NO observed value, but CEE-stamped
 * goal_threshold (already normalised) + goal_threshold_cap.
 */
const GRAPH_GOAL_WITH_THRESHOLD_CAP = {
  nodes: [
    {
      id: 'goal_productivity', kind: 'goal', label: 'Improve productivity',
      // CEE stamps these on the goal node for exactly this normalisation:
      goal_threshold: 0.2,
      goal_threshold_cap: 100,
    },
    { id: 'out_focus', kind: 'outcome', label: 'Focus time' },
    { id: 'fac_training', kind: 'factor', label: 'Training investment', observed_state: { value: 0.6 } },
  ],
  edges: [
    { from: 'fac_training', to: 'out_focus', strength: { mean: 0.5, std: 0.1 } },
    { from: 'out_focus', to: 'goal_productivity', strength: { mean: 0.6, std: 0.1 } },
  ],
};

/** Same graph but WITHOUT the CEE stamps — only the constraint's '%' unit travels. */
const GRAPH_GOAL_NO_STAMPS = {
  nodes: [
    { id: 'goal_productivity', kind: 'goal', label: 'Improve productivity' },
    { id: 'out_focus', kind: 'outcome', label: 'Focus time' },
    { id: 'fac_training', kind: 'factor', label: 'Training investment', observed_state: { value: 0.6 } },
  ],
  edges: [
    { from: 'fac_training', to: 'out_focus', strength: { mean: 0.5, std: 0.1 } },
    { from: 'out_focus', to: 'goal_productivity', strength: { mean: 0.6, std: 0.1 } },
  ],
};

/** Regression control: target node with an explicit user-confirmed range. */
const GRAPH_EXPLICIT_RANGE_TARGET = {
  nodes: [
    { id: 'goal_productivity', kind: 'goal', label: 'Improve productivity' },
    {
      id: 'out_focus', kind: 'outcome', label: 'Focus time',
      state_space: { range: { min: 0, max: 200 } },
    },
    { id: 'fac_training', kind: 'factor', label: 'Training investment', observed_state: { value: 0.6 } },
  ],
  edges: [
    { from: 'fac_training', to: 'out_focus', strength: { mean: 0.5, std: 0.1 } },
    { from: 'out_focus', to: 'goal_productivity', strength: { mean: 0.6, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt_a', label: 'Invest in training', interventions: { fac_training: 0.8 } },
  { id: 'opt_b', label: 'Hold steady', interventions: { fac_training: 0.4 } },
];

/** The exact live user input: "at least 20%" on the goal node. */
const AT_LEAST_20_PCT = {
  constraint_id: 'success_target',
  node_id: 'goal_productivity',
  operator: '>=',
  value: 20,
  unit: '%',
  label: 'Productivity at least 20%',
};

describe('goal-threshold normalisation (P0-C1 — "at least 20%" silently nullified)', () => {
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
    emitDefaultBaseWarning = false;
  });

  async function run(graph: any, constraint: any) {
    lastISLRequestBody = null;
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({
        graph,
        options: OPTIONS,
        goal_node_id: 'goal_productivity',
        seed: 'goal-threshold-normalisation',
        goal_constraints: [constraint],
      }),
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body);
  }

  function outOfDomainCritiques(body: any): any[] {
    return (body.critiques ?? []).filter((c: any) => c.code === 'CONSTRAINT_OUT_OF_DOMAIN');
  }

  function unreliableWarnings(body: any): any[] {
    return (body.inference_warnings ?? []).filter(
      (w: any) => w.code === 'CONSTRAINT_TARGET_UNRELIABLE',
    );
  }

  // -------------------------------------------------------------------------
  // RED core: the live chain, fixed
  // -------------------------------------------------------------------------

  it('forwards the constraint to ISL with normalised value 0.2 (not clamped to 1.0)', async () => {
    emitDefaultBaseWarning = false;
    await run(GRAPH_GOAL_WITH_THRESHOLD_CAP, AT_LEAST_20_PCT);

    expect(lastISLRequestBody).toBeTruthy();
    expect(Array.isArray(lastISLRequestBody.goal_constraints)).toBe(true);
    expect(lastISLRequestBody.goal_constraints).toHaveLength(1);
    expect(lastISLRequestBody.goal_constraints[0].value).toBeCloseTo(0.2, 9);
  });

  it('emits NO CONSTRAINT_OUT_OF_DOMAIN critique — 20 on a %-scale is in-domain', async () => {
    emitDefaultBaseWarning = false;
    const body = await run(GRAPH_GOAL_WITH_THRESHOLD_CAP, AT_LEAST_20_PCT);
    expect(outOfDomainCritiques(body)).toHaveLength(0);
  });

  it('does NOT suppress goal-fit via threshold_normalisation_defaulted — probabilities are emitted', async () => {
    emitDefaultBaseWarning = false;
    const body = await run(GRAPH_GOAL_WITH_THRESHOLD_CAP, AT_LEAST_20_PCT);

    // No suppression: goal-fit probabilities present on every option.
    for (const opt of body.option_comparison) {
      expect(opt.probability_of_joint_goal, opt.option_id).toBe(0.55);
      expect(opt.constraint_probabilities, opt.option_id).toEqual({ success_target: 0.55 });
    }
    expect(unreliableWarnings(body)).toHaveLength(0);

    // The normalisation repair records a producer-declared scale, not the
    // made-up default [0,1] range.
    const constraintRepairs = (body._meta?.repairs_applied ?? []).filter(
      (r: any) => r.field === 'constraint.value.success_target',
    );
    for (const r of constraintRepairs) {
      expect(r.reason).not.toContain('source=default');
    }
  });

  it("honors the constraint's '%' unit alone (no CEE node stamps): 20% -> 0.2", async () => {
    emitDefaultBaseWarning = false;
    const body = await run(GRAPH_GOAL_NO_STAMPS, AT_LEAST_20_PCT);

    expect(lastISLRequestBody.goal_constraints[0].value).toBeCloseTo(0.2, 9);
    expect(outOfDomainCritiques(body)).toHaveLength(0);
    for (const opt of body.option_comparison) {
      expect(opt.probability_of_joint_goal, opt.option_id).toBe(0.55);
    }
  });

  // -------------------------------------------------------------------------
  // P0-C2 doctrine B (ratified 2026-07-07): target_base_defaulted ALONE
  // delivers — scored from the modelled outcome distribution
  // -------------------------------------------------------------------------

  it('doctrine B: target_base_defaulted ALONE delivers goal-fit with a modelled-basis disclosure', async () => {
    emitDefaultBaseWarning = true;
    try {
      const body = await run(GRAPH_GOAL_WITH_THRESHOLD_CAP, AT_LEAST_20_PCT);

      // Threshold normalisation succeeded (0.2 went to ISL)…
      expect(lastISLRequestBody.goal_constraints[0].value).toBeCloseTo(0.2, 9);
      // …and although ISL defaulted the goal node's base, the goal node is
      // forward-propagated, so the modelled probabilities are DELIVERED with
      // honest provenance (doctrine B) instead of suppressed.
      for (const opt of body.option_comparison) {
        expect(opt.probability_of_joint_goal, opt.option_id).toBe(0);
        expect(opt.constraint_probabilities, opt.option_id).toEqual({ success_target: 0 });
        expect(opt.goal_fit_basis, opt.option_id).toEqual({
          scored_from: 'modelled_outcome_distribution',
          node_ids: ['goal_productivity'],
        });
      }
      // The honesty signal is downgraded: no warning, one info note.
      expect(unreliableWarnings(body)).toHaveLength(0);
      const notes = (body.inference_warnings ?? []).filter(
        (w: any) => w.code === 'CONSTRAINT_GOALFIT_MODELLED_BASIS',
      );
      expect(notes).toHaveLength(1);
      expect(notes[0].severity).toBe('info');
    } finally {
      emitDefaultBaseWarning = false;
    }
  });

  // -------------------------------------------------------------------------
  // Regression (deliverable 4): non-'%' units and explicit ranges unchanged
  // -------------------------------------------------------------------------

  it('regression: a non-percent unit on a rangeless node still defaults and still suppresses', async () => {
    emitDefaultBaseWarning = false;
    const body = await run(GRAPH_GOAL_NO_STAMPS, {
      constraint_id: 'success_target',
      node_id: 'goal_productivity',
      operator: '>=',
      value: 20,
      unit: 'points',
      label: 'Productivity at least 20 points',
    });

    // No producer-declared scale → the pre-existing chain is unchanged:
    // out-of-domain critique + default-range suppression.
    expect(outOfDomainCritiques(body)).toHaveLength(1);
    for (const opt of body.option_comparison) {
      expect(opt, opt.option_id).not.toHaveProperty('probability_of_joint_goal');
      expect(opt, opt.option_id).not.toHaveProperty('constraint_probabilities');
    }
    expect(unreliableWarnings(body)).toHaveLength(1);
  });

  it('regression: an explicit state_space.range still normalises a unit-less constraint as before', async () => {
    emitDefaultBaseWarning = false;
    const body = await run(GRAPH_EXPLICIT_RANGE_TARGET, {
      constraint_id: 'focus_floor',
      node_id: 'out_focus',
      operator: '>=',
      value: 50,
      label: 'Focus time at least 50',
    });

    // 50 against explicit [0, 200] → 0.25, exactly as before the fix.
    expect(lastISLRequestBody.goal_constraints[0].value).toBeCloseTo(0.25, 9);
    expect(unreliableWarnings(body)).toHaveLength(0);
    for (const opt of body.option_comparison) {
      expect(opt.probability_of_joint_goal, opt.option_id).toBe(0.55);
    }
  });
});
