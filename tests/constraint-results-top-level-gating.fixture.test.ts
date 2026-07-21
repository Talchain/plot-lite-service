/**
 * Top-level constraint_results gating fixture (lane 27, ROADMAP 1.26a).
 *
 * LEAK under test (RED before the fix — filed as the follow-up in
 * docs/lanes/LANE25-goalfit-doctrine-b-2026-07-07.md §8):
 *
 * The producer-honesty suppression for unreliable constraint targets
 * (src/lib/constraint-reliability.ts, applied in buildResponse of
 * src/routes/v2/run.ts) gates ONLY the per-option fields
 * `probability_of_joint_goal` and `constraint_probabilities`. The TOP-LEVEL
 * constraint block built by buildConstraintFields() still emits
 * `constraint_results[].probability` (= the first option's prob_satisfied)
 * REGARDLESS of target reliability — so on a suppressed run the withheld
 * probabilities leak via the top-level surface, and `constraints_status:
 * 'computed'` claims a decision-grade result that the per-option doctrine
 * already ruled not decision-grade.
 *
 * Contract under test (mirrors the per-option doctrine, run-level):
 *   - FULLY-SUPPRESSED run (any suppressed target): the top-level constraint
 *     block is withheld — `constraints_status: 'unavailable'` (existing
 *     vocabulary; the WARNING-severity CONSTRAINT_TARGET_UNRELIABLE emitted
 *     by the per-option path explains WHY) and NO constraint_results /
 *     constraint_diagnostics / conditional_probabilities. Absence is honest.
 *   - MIXED run (one suppressed + one reliable target): run-level suppression
 *     wins, exactly as it does per-option.
 *   - DOCTRINE-B run (target_base_defaulted ALONE on a forward-propagated
 *     node, lane P0-C2): the top-level block DELIVERS unchanged — the
 *     modelled probability is the ratified scoring basis, disclosed by the
 *     info-severity CONSTRAINT_GOALFIT_MODELLED_BASIS note + per-option
 *     goal_fit_basis annotation.
 *   - RELIABLE run: byte-identical top-level block (regression pin).
 *
 * The ISL request/ISL service are NOT changed — the mock mirrors
 * tests/constraint-target-unreliable.fixture.test.ts (live wire shapes).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Mutable mock state (per-request ISL behaviour)
// ---------------------------------------------------------------------------

/** When true, the ISL mock emits the CONSTRAINT_NODE_DEFAULT_BASE warning. */
let emitDefaultBaseWarning = false;
/** prob_satisfied / joint_probability the ISL mock returns (distinguishable per test). */
let mockProbSatisfied = 0.55;

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

    const constraintAnalysis = goalConstraints.length > 0
      ? {
          constraint_analysis: {
            joint_probability: mockProbSatisfied,
            constraints: goalConstraints.map((c: any) => ({
              node_id: c.node_id,
              operator: c.operator,
              threshold: c.threshold ?? c.value,
              prob_satisfied: mockProbSatisfied,
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
        // Live ISL wire shape for the defaulted-base signal (see ISL
        // robustness_analyzer_v2.py — InferenceWarning with nested detail):
        inference_warnings: emitDefaultBaseWarning
          ? [{
              code: 'CONSTRAINT_NODE_DEFAULT_BASE',
              field: 'nodes[out_campaign_effectiveness].base',
              detail: {
                node_id: 'out_campaign_effectiveness',
                defaulted_to: 0.0,
                reason: 'no_parameter_uncertainty',
                message: "Node 'out_campaign_effectiveness' has no ParameterUncertainty — defaulted to base=0.0, constraint probability may be unreliable",
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
// Fixtures (mirror tests/constraint-target-unreliable.fixture.test.ts)
// ---------------------------------------------------------------------------

/** Constraint target: outcome node with NO observed value → default [0,1] range. */
const GRAPH_VALUELESS_TARGET = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Grow revenue' },
    { id: 'out_campaign_effectiveness', kind: 'outcome', label: 'Campaign effectiveness' },
    { id: 'fac_budget', kind: 'factor', label: 'Marketing budget', observed_state: { value: 0.6 } },
  ],
  edges: [
    { from: 'fac_budget', to: 'out_campaign_effectiveness', strength: { mean: 0.5, std: 0.1 } },
    { from: 'out_campaign_effectiveness', to: 'goal_growth', strength: { mean: 0.6, std: 0.1 } },
  ],
};

/** Control: same shape but the target node HAS an observed value (range derivable). */
const GRAPH_VALUED_TARGET = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Grow revenue' },
    // observed value 50 → deriveRange() infers [0, 100] (inferred_value tier).
    { id: 'out_campaign_effectiveness', kind: 'outcome', label: 'Campaign effectiveness', observed_state: { value: 50 } },
    { id: 'fac_budget', kind: 'factor', label: 'Marketing budget', observed_state: { value: 0.6 } },
  ],
  edges: [
    { from: 'fac_budget', to: 'out_campaign_effectiveness', strength: { mean: 0.5, std: 0.1 } },
    { from: 'out_campaign_effectiveness', to: 'goal_growth', strength: { mean: 0.6, std: 0.1 } },
  ],
};

/** Mixed run: one valueless target (suppresses) + one valued target (reliable). */
const GRAPH_MIXED_TARGETS = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Grow revenue' },
    { id: 'out_campaign_effectiveness', kind: 'outcome', label: 'Campaign effectiveness' },
    { id: 'out_retention', kind: 'outcome', label: 'Customer retention', observed_state: { value: 50 } },
    { id: 'fac_budget', kind: 'factor', label: 'Marketing budget', observed_state: { value: 0.6 } },
  ],
  edges: [
    { from: 'fac_budget', to: 'out_campaign_effectiveness', strength: { mean: 0.5, std: 0.1 } },
    { from: 'fac_budget', to: 'out_retention', strength: { mean: 0.4, std: 0.1 } },
    { from: 'out_campaign_effectiveness', to: 'goal_growth', strength: { mean: 0.6, std: 0.1 } },
    { from: 'out_retention', to: 'goal_growth', strength: { mean: 0.3, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt_a', label: 'Push campaign', interventions: { fac_budget: 0.8 } },
  { id: 'opt_b', label: 'Hold steady', interventions: { fac_budget: 0.4 } },
];

/** Doctrine-B / control constraint: '%' is a producer-declared scale post-#203. */
const SUCCESS_TARGET_20_PCT = {
  constraint_id: 'success_target',
  node_id: 'out_campaign_effectiveness',
  operator: '>=',
  value: 20,
  unit: '%',
  label: 'Effectiveness at least 20%',
};

/**
 * Suppression variant: 'points' has no producer-declared scale, so the
 * valueless node normalises against the default [0,1] range
 * (threshold_normalisation_defaulted) — post-#203, '%' alone no longer does.
 */
const SUCCESS_TARGET_20_POINTS = {
  ...SUCCESS_TARGET_20_PCT,
  unit: 'points',
  label: 'Effectiveness at least 20 points',
};

/** Reliable second constraint for the mixed run (valued node, declared '%' scale). */
const RETENTION_TARGET_30_PCT = {
  constraint_id: 'retention_floor',
  node_id: 'out_retention',
  operator: '>=',
  value: 30,
  unit: '%',
  label: 'Retention at least 30%',
};

describe('top-level constraint_results gating by target reliability (lane 27, ROADMAP 1.26a)', () => {
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
    mockProbSatisfied = 0.55;
  });

  async function run(graph: any, constraints: any[]) {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({
        graph,
        options: OPTIONS,
        goal_node_id: 'goal_growth',
        seed: 'constraint-top-level-gating',
        goal_constraints: constraints,
      }),
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body);
  }

  it('LEAK: fully-suppressed run (both legs) must not emit the top-level constraint block', async () => {
    emitDefaultBaseWarning = true;
    mockProbSatisfied = 0; // the live placeholder value the per-option path withholds
    try {
      const body = await run(GRAPH_VALUELESS_TARGET, [SUCCESS_TARGET_20_POINTS]);

      // Sanity — the per-option suppression doctrine (lane PLoT-H item A)
      // already holds on base; this test targets the top-level mirror.
      for (const opt of body.option_comparison) {
        expect(opt, opt.option_id).not.toHaveProperty('probability_of_joint_goal');
        expect(opt, opt.option_id).not.toHaveProperty('constraint_probabilities');
      }
      const warnings = (body.inference_warnings ?? []).filter(
        (w: any) => w.code === 'CONSTRAINT_TARGET_UNRELIABLE',
      );
      expect(warnings).toHaveLength(1);

      // THE LEAK (RED on base): the withheld probability re-surfaces at the
      // top level as constraint_results[0].probability = first option's
      // prob_satisfied, under a fabricated constraints_status: 'computed'.
      expect(body.constraints_status).toBe('unavailable');
      expect(body).not.toHaveProperty('constraint_results');
      expect(body).not.toHaveProperty('constraint_diagnostics');
      expect(body).not.toHaveProperty('conditional_probabilities');
    } finally {
      emitDefaultBaseWarning = false;
      mockProbSatisfied = 0.55;
    }
  });

  it('LEAK: normalisation-default leg ALONE (no ISL warning) gates the top level too', async () => {
    emitDefaultBaseWarning = false;
    mockProbSatisfied = 0.55;
    const body = await run(GRAPH_VALUELESS_TARGET, [SUCCESS_TARGET_20_POINTS]);

    expect(body.constraints_status).toBe('unavailable');
    expect(body).not.toHaveProperty('constraint_results');
    expect(body).not.toHaveProperty('constraint_diagnostics');
    expect(body).not.toHaveProperty('conditional_probabilities');
  });

  it('LEAK: mixed run (one suppressed + one reliable target) withholds the WHOLE top-level block', async () => {
    // Run-level doctrine (lane P0-C2): when ANY target suppresses, the whole
    // run suppresses — the reliable constraint's probability must not ship
    // alongside a withheld one at either surface.
    emitDefaultBaseWarning = false;
    mockProbSatisfied = 0.55;
    const body = await run(GRAPH_MIXED_TARGETS, [SUCCESS_TARGET_20_POINTS, RETENTION_TARGET_30_PCT]);

    expect(body.constraints_status).toBe('unavailable');
    expect(body).not.toHaveProperty('constraint_results');
    expect(body).not.toHaveProperty('constraint_diagnostics');
    expect(body).not.toHaveProperty('conditional_probabilities');
  });

  it('DOCTRINE B: modelled-basis run DELIVERS the top-level constraint block', async () => {
    // '%' on the valueless node post-#203: threshold normalisation is sound,
    // the ONLY reason is target_base_defaulted, and the node is
    // forward-propagated → doctrine-B delivery (lane P0-C2), disclosed by the
    // info-severity note. The top-level block must deliver consistently.
    emitDefaultBaseWarning = true;
    mockProbSatisfied = 0.62;
    try {
      const body = await run(GRAPH_VALUELESS_TARGET, [SUCCESS_TARGET_20_PCT]);

      expect(body.constraints_status).toBe('computed');
      expect(body.constraint_results).toEqual([
        {
          constraint_id: 'success_target',
          node_id: 'out_campaign_effectiveness',
          operator: '>=',
          value: 20,
          probability: 0.62,
          // A3 trust marker (additive): a '%' constraint on a valueless target
          // resolves via the producer unit_percent scale, unclamped ⇒ decision-grade.
          scale_provenance: { source: 'unit_percent', range_unified: true, decision_grade: true },
        },
      ]);
      expect(body.conditional_probabilities).toEqual([]);

      const unreliable = (body.inference_warnings ?? []).filter(
        (w: any) => w.code === 'CONSTRAINT_TARGET_UNRELIABLE',
      );
      expect(unreliable).toHaveLength(0);
      const modelled = (body.inference_warnings ?? []).filter(
        (w: any) => w.code === 'CONSTRAINT_GOALFIT_MODELLED_BASIS',
      );
      expect(modelled).toHaveLength(1);
      expect(modelled[0].severity).toBe('info');
    } finally {
      emitDefaultBaseWarning = false;
      mockProbSatisfied = 0.55;
    }
  });

  it('REGRESSION PIN: reliable run keeps the exact top-level constraint block', async () => {
    // Byte-identity pin for runs with NO unreliable targets: the block below
    // is exactly what base emits today — the fix must not perturb it.
    emitDefaultBaseWarning = false;
    mockProbSatisfied = 0.55;
    const body = await run(GRAPH_VALUED_TARGET, [SUCCESS_TARGET_20_PCT]);

    expect(body.constraints_status).toBe('computed');
    expect(body.constraint_results).toEqual([
      {
        constraint_id: 'success_target',
        node_id: 'out_campaign_effectiveness',
        operator: '>=',
        value: 20,
        probability: 0.55,
        // A3 trust marker (additive): producer '%' scale, unclamped ⇒ decision-grade.
        scale_provenance: { source: 'unit_percent', range_unified: true, decision_grade: true },
      },
    ]);
    expect(body).not.toHaveProperty('constraint_diagnostics');
    expect(body.conditional_probabilities).toEqual([]);

    const constraintCodes = (body.inference_warnings ?? []).filter(
      (w: any) => w.code === 'CONSTRAINT_TARGET_UNRELIABLE' || w.code === 'CONSTRAINT_GOALFIT_MODELLED_BASIS',
    );
    expect(constraintCodes).toHaveLength(0);
  });

  it('REGRESSION PIN: no goal constraints → no top-level constraint fields', async () => {
    emitDefaultBaseWarning = false;
    mockProbSatisfied = 0.55;
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({
        graph: GRAPH_VALUED_TARGET,
        options: OPTIONS,
        goal_node_id: 'goal_growth',
        seed: 'constraint-top-level-gating',
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body).not.toHaveProperty('constraints_status');
    expect(body).not.toHaveProperty('constraint_results');
    expect(body).not.toHaveProperty('constraint_diagnostics');
    expect(body).not.toHaveProperty('conditional_probabilities');
  });
});
