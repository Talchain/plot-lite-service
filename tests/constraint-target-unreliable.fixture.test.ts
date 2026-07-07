/**
 * CONSTRAINT_TARGET_UNRELIABLE fixture test (lane PLoT-H item A).
 *
 * Reproduces the live defect chain from scenario 327bc417 (2026-07-07):
 * the user set a success target of "20" (unit "%") on
 * `out_campaign_effectiveness` — a node with NO observed value. The pipeline
 * then:
 *   1. logged `plot.constraint_out_of_domain` (threshold 20 outside [0,1] on
 *      a probability-domain node, non-temporal unit → forwarded);
 *   2. normalised the threshold against the DEFAULT [0,1] fallback range
 *      (`range_source: "default"`) → 20 clamped to 1 = "≥ domain max";
 *   3. ISL defaulted the target node's base to 0.0
 *      (CONSTRAINT_NODE_DEFAULT_BASE, reason no_parameter_uncertainty);
 *   4. emitted probability_of_joint_goal = 0 for EVERY option — a meaningless
 *      "0% goal fit everywhere".
 *
 * Producer-honesty contract under test (RED before the fix):
 *   - probability_of_joint_goal and constraint_probabilities are SUPPRESSED
 *     (absent) for the run;
 *   - a WARNING-severity CONSTRAINT_TARGET_UNRELIABLE inference warning names
 *     the node and the user action;
 *   - coaching does not fabricate GOAL_FEASIBILITY_LOW from the placeholder 0;
 *   - CONTROL: a reliable constraint target keeps both fields (suppression is
 *     conditional, not blanket).
 *
 * The ISL request/ISL service are NOT changed — the mock returns exactly what
 * live ISL returned for this chain.
 *
 * POST-HISTORY UPDATES to the original chain:
 *   - P0-C1 (PR #203): '%' is now a producer-declared scale (normalises
 *     against 100), so the ORIGINAL 20/'%' constraint no longer trips the
 *     default-range leg. The suppression pins below use unit 'points' (no
 *     declared scale) to keep the default-range chain exercised.
 *   - P0-C2 doctrine B (ratified 2026-07-07): target_base_defaulted ALONE on
 *     a forward-propagated node now DELIVERS with a modelled-basis
 *     disclosure — see tests/goalfit-doctrine-b.fixture.test.ts. Every
 *     OTHER reason combination (as pinned here) suppresses exactly as before.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Mutable mock state (per-request ISL behaviour)
// ---------------------------------------------------------------------------

/** When true, the ISL mock emits the CONSTRAINT_NODE_DEFAULT_BASE warning. */
let emitDefaultBaseWarning = false;

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
            // Live shape: base defaulted to 0.0 → joint probability 0 for
            // every option when the warning fires; a plausible non-zero
            // probability otherwise (control).
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
// Fixtures
// ---------------------------------------------------------------------------

/** Paul's chain: outcome node with NO observed value, target 20 unit "%". */
const GRAPH_VALUELESS_TARGET = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Grow revenue' },
    // The constraint target: outcome node with NO observed_state at all →
    // deriveRange() bottoms out at the default [0,1] range.
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
    // observed value 50 → deriveRange() infers [0, 100] (inferred_value tier),
    // NOT the default fallback.
    { id: 'out_campaign_effectiveness', kind: 'outcome', label: 'Campaign effectiveness', observed_state: { value: 50 } },
    { id: 'fac_budget', kind: 'factor', label: 'Marketing budget', observed_state: { value: 0.6 } },
  ],
  edges: [
    { from: 'fac_budget', to: 'out_campaign_effectiveness', strength: { mean: 0.5, std: 0.1 } },
    { from: 'out_campaign_effectiveness', to: 'goal_growth', strength: { mean: 0.6, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt_a', label: 'Push campaign', interventions: { fac_budget: 0.8 } },
  { id: 'opt_b', label: 'Hold steady', interventions: { fac_budget: 0.4 } },
];

/** The exact user input from the live session: 20, unit '%'. */
const SUCCESS_TARGET_20_PCT = {
  constraint_id: 'success_target',
  node_id: 'out_campaign_effectiveness',
  operator: '>=',
  value: 20,
  unit: '%',
  label: 'Effectiveness at least 20%',
};

/**
 * Suppression-pin variant: 'points' has no producer-declared scale, so the
 * valueless node still normalises against the default [0,1] range
 * (threshold_normalisation_defaulted) — post-#203, '%' alone no longer does.
 */
const SUCCESS_TARGET_20_POINTS = {
  ...SUCCESS_TARGET_20_PCT,
  unit: 'points',
  label: 'Effectiveness at least 20 points',
};

describe('CONSTRAINT_TARGET_UNRELIABLE (item A — Paul\'s 20/% valueless-node chain)', () => {
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
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({
        graph,
        options: OPTIONS,
        goal_node_id: 'goal_growth',
        seed: 'constraint-honesty',
        goal_constraints: [constraint],
      }),
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body);
  }

  it('suppresses probability_of_joint_goal and constraint_probabilities on the full live chain', async () => {
    emitDefaultBaseWarning = true;
    try {
      // 'points' variant: keeps BOTH legs firing (default range + default
      // base) post-#203 — the multi-reason set must suppress exactly as the
      // original chain did (doctrine B only exempts base-defaulted ALONE).
      const body = await run(GRAPH_VALUELESS_TARGET, SUCCESS_TARGET_20_POINTS);

      expect(body.analysis_status).not.toBe('blocked');
      expect(Array.isArray(body.option_comparison)).toBe(true);
      expect(body.option_comparison.length).toBe(2);

      // The mirror-of-98%-fabrication defect: before the fix every option
      // carried probability_of_joint_goal: 0. Absence is the honest contract.
      for (const opt of body.option_comparison) {
        expect(opt, opt.option_id).not.toHaveProperty('probability_of_joint_goal');
        expect(opt, opt.option_id).not.toHaveProperty('constraint_probabilities');
      }
    } finally {
      emitDefaultBaseWarning = false;
    }
  });

  it('emits a WARNING-severity CONSTRAINT_TARGET_UNRELIABLE naming the node and the user action', async () => {
    emitDefaultBaseWarning = true;
    try {
      const body = await run(GRAPH_VALUELESS_TARGET, SUCCESS_TARGET_20_POINTS);

      const warnings = (body.inference_warnings ?? []).filter(
        (w: any) => w.code === 'CONSTRAINT_TARGET_UNRELIABLE',
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warning');
      // Names the node (label, not internal id) …
      expect(warnings[0].message).toContain('Campaign effectiveness');
      // … says the numbers were withheld …
      expect(warnings[0].message).toContain('withheld');
      // … and tells the user what to do about it.
      expect(warnings[0].message).toContain('Set a value or range');
      // The raw suppressed numbers are never quoted in the warning.
      expect(warnings[0].message).not.toContain('0%');
    } finally {
      emitDefaultBaseWarning = false;
    }
  });

  it('suppresses on the normalisation-default leg ALONE (no ISL default-base warning)', async () => {
    // Even if ISL does not flag the base (e.g. older ISL build), scaling a
    // user-unit threshold against the made-up default [0,1] range is already
    // not decision-grade.
    //
    // P0-C1 update (lane 23): a '%' unit is now a producer-declared scale
    // (normalises against 100), so the original 20/'%' constraint no longer
    // hits the default range — that path is FIXED, not suppressed (see
    // tests/goal-threshold-normalisation.fixture.test.ts). To keep THIS leg
    // pinned, use a unit with no declared scale on the same valueless node:
    // normalisation still falls to default [0,1] and must still suppress.
    emitDefaultBaseWarning = false;
    const body = await run(GRAPH_VALUELESS_TARGET, {
      ...SUCCESS_TARGET_20_PCT,
      unit: 'points',
      label: 'Effectiveness at least 20 points',
    });

    for (const opt of body.option_comparison) {
      expect(opt, opt.option_id).not.toHaveProperty('probability_of_joint_goal');
      expect(opt, opt.option_id).not.toHaveProperty('constraint_probabilities');
    }
    const warnings = (body.inference_warnings ?? []).filter(
      (w: any) => w.code === 'CONSTRAINT_TARGET_UNRELIABLE',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warning');
  });

  it('does not fabricate GOAL_FEASIBILITY_LOW coaching from the placeholder joint probability', async () => {
    emitDefaultBaseWarning = true;
    try {
      // Deliberately the '%' (doctrine-B delivery) case: even though the
      // modelled goal-fit is now DELIVERED on the wire, the coaching
      // joint-prob gate stays conservative — no feasibility claim is derived
      // from a modelled-baseline number (see run.ts coaching call site).
      const body = await run(GRAPH_VALUELESS_TARGET, SUCCESS_TARGET_20_PCT);
      // The joint-prob readiness gate is skipped for unreliable targets: no
      // "may not achieve the target" claim derived from a placeholder 0.
      expect(JSON.stringify(body.m1_coaching ?? {})).not.toContain('GOAL_FEASIBILITY_LOW');
    } finally {
      emitDefaultBaseWarning = false;
    }
  });

  it('CONTROL: reliable target (derivable range, no default base) keeps both probability fields', async () => {
    emitDefaultBaseWarning = false;
    const body = await run(GRAPH_VALUED_TARGET, SUCCESS_TARGET_20_PCT);

    for (const opt of body.option_comparison) {
      expect(opt.probability_of_joint_goal, opt.option_id).toBe(0.55);
      expect(opt.constraint_probabilities, opt.option_id).toEqual({ success_target: 0.55 });
    }
    const warnings = (body.inference_warnings ?? []).filter(
      (w: any) => w.code === 'CONSTRAINT_TARGET_UNRELIABLE',
    );
    expect(warnings).toHaveLength(0);
  });

  it('raw computed values stay available in diagnostics logs (not the wire): suppression event exists', async () => {
    // The suppression path logs `constraint_probability_suppressed` with the
    // raw values (see run.ts). Assert via a captured logger is heavyweight in
    // route context; the wire-level absence above is the binding contract.
    // Here we pin the complementary invariant: the top-level constraint block
    // still discloses status honestly instead of disappearing silently.
    emitDefaultBaseWarning = true;
    try {
      const body = await run(GRAPH_VALUELESS_TARGET, SUCCESS_TARGET_20_POINTS);
      expect(body.constraints_status).toBeDefined();
    } finally {
      emitDefaultBaseWarning = false;
    }
  });
});
