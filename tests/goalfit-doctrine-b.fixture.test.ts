/**
 * Goal-fit doctrine B fixture (lane P0-C2, ratified 2026-07-07).
 *
 * Doctrine decision (product owner, 2026-07-07, "option B"): goal-fit is
 * scored from the goal node's forward-propagated outcome distribution vs the
 * normalised threshold — instead of being suppressed because the goal node
 * has no observed value channel.
 *
 * Live shape this reproduces (post PR #203): the goal node carries a
 * CEE-stamped goal_threshold 0.2 / goal_threshold_cap 100 and an explicit '%'
 * goal constraint. Threshold normalisation now succeeds (producer-declared
 * scale), so the ONLY remaining unreliability reason is target_base_defaulted
 * (ISL CONSTRAINT_NODE_DEFAULT_BASE — the goal node has no observed value).
 * ISL still computes differentiated per-option goal probabilities from the
 * exact goal outcome-sample series (robustness_analyzer_v2.py — evaluate_multi
 * shares the outcome code path; prob_satisfied compares the same samples the
 * delivered probability_of_goal already uses).
 *
 * ⚠⚠ L63 AMENDMENT — THE SENTENCE DIRECTLY ABOVE EXPIRED, AND THIS SUITE WAS
 * STILL ASSERTING IT. "prob_satisfied compares the same samples the delivered
 * probability_of_goal already uses" was true when this doctrine was ratified
 * (2026-07-07) and was invalidated by ROADMAP 2.258/2.286: probability_of_goal
 * no longer compares a threshold against raw samples at all — it rides a
 * per-draw GoalThresholdPlan (`level_i = B + (option_i − sq_i)`) or REFUSES
 * outright. The constraint path still compares raw. So the two are no longer
 * the same comparison, and "deliver the second because the first was
 * delivered" no longer follows from anything.
 *
 * Measured consequence, deployed staging 2026-08-04 (PLoT 2864b0c / ISL
 * 80aa83f, `PHASE0-EVIDENCE-2026-07-28/diagnosis-goalfit-untruth.md`): on the
 * witnessed runs `probability_of_goal` was ABSENT (the 2.258 guard honestly
 * refusing) while `probability_of_joint_goal` = 0 was DELIVERED under this very
 * exception and marked decision-grade — two channels answering in opposite
 * directions inside one response, with the UI substituting the delivered zero
 * into the goal-fit surface the refusal had left empty.
 *
 * DOCTRINE B IS THEREFORE RESTRICTED, NOT REPEALED. It still delivers wherever
 * its rationale still holds — i.e. wherever the target node's samples carry an
 * absolute anchor (root-with-observed-value, pinned by every option, or a
 * producer-attested 'delta' frame). It no longer delivers for a target whose
 * samples are `intercept + SUM(parent*strength)` with base 0.0, because no
 * absolute threshold is comparable against those. The delivery fixtures below
 * therefore carry the producer's `goal_threshold_frame: 'delta'` attestation,
 * and the L63 block at the end of this file pins the un-attested shape — the
 * exact live one — as SUPPRESSED.
 *
 * Contract under test (RED on origin/staging ff423310 — suppressed today):
 *   1. probability_of_joint_goal / constraint_probabilities are DELIVERED,
 *      differentiated per option;
 *   2. each delivering option carries an honest provenance annotation
 *      goal_fit_basis { scored_from: 'modelled_outcome_distribution' };
 *   3. NO warning-severity CONSTRAINT_TARGET_UNRELIABLE — instead an
 *      info-severity CONSTRAINT_GOALFIT_MODELLED_BASIS note names the node
 *      and never quotes the probabilities;
 *   4. PIN: any OTHER reason combination keeps suppressing exactly as today
 *      (default-range normalisation, mixed multi-constraint runs);
 *   5. PIN: a defaulted-base target WITHOUT forward-propagated inputs (root
 *      node) still suppresses — its samples are a constant placeholder, not a
 *      modelled distribution;
 *   6. Regression: reliable-target runs and runs without goal constraints are
 *      byte-identical to today (no annotation, no note).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Mutable mock state (per-request ISL behaviour)
// ---------------------------------------------------------------------------

/** Node id the ISL mock flags with CONSTRAINT_NODE_DEFAULT_BASE (null = no warning). */
let defaultBaseNodeId: string | null = null;

/** Captures the last analysis request body forwarded to ISL. */
let lastISLRequestBody: any = null;

/** Differentiated per-option goal probabilities (the post-#203 live shape). */
const JOINT_PROB_BY_INDEX = [0.62, 0.38];

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

    return {
      data: {
        options: options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
          win_probability: idx === 0 ? 0.6 : 0.4,
          rank: idx + 1,
          ...(goalConstraints.length > 0
            ? {
                constraint_analysis: {
                  joint_probability: JOINT_PROB_BY_INDEX[idx] ?? 0.5,
                  constraints: goalConstraints.map((c: any) => ({
                    node_id: c.node_id,
                    operator: c.operator,
                    threshold: c.threshold ?? c.value,
                    prob_satisfied: JOINT_PROB_BY_INDEX[idx] ?? 0.5,
                  })),
                },
              }
            : {}),
        })),
        factor_sensitivity: [],
        robustness: { label: 'moderate', score: 0.6, fragile_edges: [], robust_edges: [] },
        // Live ISL wire shape for the defaulted-base signal (InferenceWarning
        // with nested detail — see ISL robustness_analyzer_v2.py:742-757).
        inference_warnings: defaultBaseNodeId
          ? [{
              code: 'CONSTRAINT_NODE_DEFAULT_BASE',
              field: `nodes[${defaultBaseNodeId}].base`,
              detail: {
                node_id: defaultBaseNodeId,
                defaulted_to: 0.0,
                reason: 'no_parameter_uncertainty',
                message: `Node '${defaultBaseNodeId}' has no ParameterUncertainty — defaulted to base=0.0, constraint probability may be unreliable`,
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
 * The live goal-target shape: goal node with NO observed value, CEE-stamped
 * goal_threshold 0.2 / goal_threshold_cap 100, fed by forward propagation.
 */
const GRAPH_GOAL_TARGET = {
  nodes: [
    {
      id: 'goal_productivity', kind: 'goal', label: 'Improve productivity',
      goal_threshold: 0.2,
      goal_threshold_cap: 100,
      // L63: the producer attests that targets on this node are stated in the
      // samples' own frame. Doctrine B's delivery scope is now conditional on
      // an anchor, and this is the limb that supplies one here. Removing this
      // line moves every DELIVERS/annotates/downgrades case below into the
      // suppressed population — which is what GRAPH_GOAL_TARGET_UNATTESTED
      // (the live shape) exists to pin.
      goal_threshold_frame: 'delta',
    },
    { id: 'out_focus', kind: 'outcome', label: 'Focus time' },
    { id: 'fac_training', kind: 'factor', label: 'Training investment', observed_state: { value: 0.6 } },
  ],
  edges: [
    { from: 'fac_training', to: 'out_focus', strength: { mean: 0.5, std: 0.1 } },
    { from: 'out_focus', to: 'goal_productivity', strength: { mean: 0.6, std: 0.1 } },
  ],
};

/**
 * Root-target variant: fac_orphan has NO incoming edges and NO observed value.
 * If ISL ever flagged it CONSTRAINT_NODE_DEFAULT_BASE, its "samples" would be
 * a constant placeholder (no forward-propagated inputs) — not a modelled
 * distribution. PLoT must keep suppressing defensively.
 */
const GRAPH_ROOT_TARGET = {
  nodes: [
    { id: 'goal_productivity', kind: 'goal', label: 'Improve productivity' },
    { id: 'out_focus', kind: 'outcome', label: 'Focus time' },
    { id: 'fac_training', kind: 'factor', label: 'Training investment', observed_state: { value: 0.6 } },
    { id: 'fac_orphan', kind: 'factor', label: 'Untracked morale' },
  ],
  edges: [
    { from: 'fac_training', to: 'out_focus', strength: { mean: 0.5, std: 0.1 } },
    { from: 'out_focus', to: 'goal_productivity', strength: { mean: 0.6, std: 0.1 } },
    { from: 'fac_orphan', to: 'goal_productivity', strength: { mean: 0.4, std: 0.1 } },
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

describe('goal-fit doctrine B (P0-C2 — scored from the modelled outcome distribution)', () => {
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
    defaultBaseNodeId = null;
  });

  async function run(graph: any, constraints: any[] | undefined) {
    lastISLRequestBody = null;
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({
        graph,
        options: OPTIONS,
        goal_node_id: 'goal_productivity',
        seed: 'goalfit-doctrine-b',
        ...(constraints ? { goal_constraints: constraints } : {}),
      }),
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body);
  }

  function warningsByCode(body: any, code: string): any[] {
    return (body.inference_warnings ?? []).filter((w: any) => w.code === code);
  }

  // -------------------------------------------------------------------------
  // RED core: doctrine B delivery
  // -------------------------------------------------------------------------

  it('DELIVERS differentiated per-option goal probabilities when the only reason is target_base_defaulted', async () => {
    defaultBaseNodeId = 'goal_productivity';
    try {
      const body = await run(GRAPH_GOAL_TARGET, [AT_LEAST_20_PCT]);

      // Threshold normalisation is sound post-#203 (0.2 went to ISL) …
      expect(lastISLRequestBody.goal_constraints[0].value).toBeCloseTo(0.2, 9);

      // … and the modelled goal probabilities are delivered, differentiated.
      const byId = new Map(body.option_comparison.map((o: any) => [o.option_id, o]));
      expect((byId.get('opt_a') as any).probability_of_joint_goal).toBe(0.62);
      expect((byId.get('opt_b') as any).probability_of_joint_goal).toBe(0.38);
      expect((byId.get('opt_a') as any).constraint_probabilities).toEqual({ success_target: 0.62 });
      expect((byId.get('opt_b') as any).constraint_probabilities).toEqual({ success_target: 0.38 });
    } finally {
      defaultBaseNodeId = null;
    }
  });

  it('annotates every delivering option with goal_fit_basis (honest provenance)', async () => {
    defaultBaseNodeId = 'goal_productivity';
    try {
      const body = await run(GRAPH_GOAL_TARGET, [AT_LEAST_20_PCT]);

      for (const opt of body.option_comparison) {
        expect(opt.goal_fit_basis, opt.option_id).toEqual({
          scored_from: 'modelled_outcome_distribution',
          node_ids: ['goal_productivity'],
        });
      }
    } finally {
      defaultBaseNodeId = null;
    }
  });

  it('downgrades the honesty signal: info-severity CONSTRAINT_GOALFIT_MODELLED_BASIS instead of the warning', async () => {
    defaultBaseNodeId = 'goal_productivity';
    try {
      const body = await run(GRAPH_GOAL_TARGET, [AT_LEAST_20_PCT]);

      // No suppression warning …
      expect(warningsByCode(body, 'CONSTRAINT_TARGET_UNRELIABLE')).toHaveLength(0);

      // … but an informational disclosure names the node and the basis.
      const notes = warningsByCode(body, 'CONSTRAINT_GOALFIT_MODELLED_BASIS');
      expect(notes).toHaveLength(1);
      expect(notes[0].severity).toBe('info');
      expect(notes[0].message).toContain('Improve productivity');
      // Modelled, not observed — and the raw numbers are never quoted.
      expect(notes[0].message.toLowerCase()).toContain('modelled');
      expect(notes[0].message).not.toContain('0.62');
      expect(notes[0].message).not.toContain('0.38');
      expect(notes[0].message).not.toContain('62%');
    } finally {
      defaultBaseNodeId = null;
    }
  });

  // -------------------------------------------------------------------------
  // PINs: every other reason combination keeps suppressing exactly as today
  // -------------------------------------------------------------------------

  it('PIN: default-range threshold normalisation still suppresses (with or without the base marker)', async () => {
    defaultBaseNodeId = 'goal_productivity';
    try {
      // No producer-declared scale ('points') on a node with no derivable
      // range → threshold_normalisation_defaulted + target_base_defaulted.
      const body = await run(
        {
          ...GRAPH_GOAL_TARGET,
          nodes: GRAPH_GOAL_TARGET.nodes.map((n) =>
            n.id === 'goal_productivity' ? { id: n.id, kind: n.kind, label: n.label } : n,
          ),
        },
        [{ ...AT_LEAST_20_PCT, unit: 'points', label: 'Productivity at least 20 points' }],
      );

      for (const opt of body.option_comparison) {
        expect(opt, opt.option_id).not.toHaveProperty('probability_of_joint_goal');
        expect(opt, opt.option_id).not.toHaveProperty('constraint_probabilities');
        expect(opt, opt.option_id).not.toHaveProperty('goal_fit_basis');
      }
      const warnings = warningsByCode(body, 'CONSTRAINT_TARGET_UNRELIABLE');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warning');
      expect(warningsByCode(body, 'CONSTRAINT_GOALFIT_MODELLED_BASIS')).toHaveLength(0);
    } finally {
      defaultBaseNodeId = null;
    }
  });

  it('PIN: a mixed multi-constraint run (one doctrine-B-eligible, one default-range) suppresses the whole run', async () => {
    defaultBaseNodeId = 'goal_productivity';
    try {
      const body = await run(GRAPH_GOAL_TARGET, [
        AT_LEAST_20_PCT,
        {
          constraint_id: 'focus_floor',
          node_id: 'out_focus', // valueless, no declared scale → default [0,1] range
          operator: '>=',
          value: 50,
          unit: 'points',
          label: 'Focus at least 50 points',
        },
      ]);

      for (const opt of body.option_comparison) {
        expect(opt, opt.option_id).not.toHaveProperty('probability_of_joint_goal');
        expect(opt, opt.option_id).not.toHaveProperty('constraint_probabilities');
        expect(opt, opt.option_id).not.toHaveProperty('goal_fit_basis');
      }
      // Exactly today's multi-target behaviour: one warning per affected node.
      const warnings = warningsByCode(body, 'CONSTRAINT_TARGET_UNRELIABLE');
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      for (const w of warnings) expect(w.severity).toBe('warning');
      expect(warningsByCode(body, 'CONSTRAINT_GOALFIT_MODELLED_BASIS')).toHaveLength(0);
    } finally {
      defaultBaseNodeId = null;
    }
  });

  it('PIN: a defaulted-base target with NO forward-propagated inputs (root node) still suppresses', async () => {
    defaultBaseNodeId = 'fac_orphan';
    try {
      const body = await run(GRAPH_ROOT_TARGET, [{
        constraint_id: 'morale_floor',
        node_id: 'fac_orphan',
        operator: '>=',
        value: 20,
        unit: '%', // producer-declared scale → normalisation sound; base is the only reason
        label: 'Morale at least 20%',
      }]);

      for (const opt of body.option_comparison) {
        expect(opt, opt.option_id).not.toHaveProperty('probability_of_joint_goal');
        expect(opt, opt.option_id).not.toHaveProperty('constraint_probabilities');
        expect(opt, opt.option_id).not.toHaveProperty('goal_fit_basis');
      }
      const warnings = warningsByCode(body, 'CONSTRAINT_TARGET_UNRELIABLE');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warning');
      expect(warningsByCode(body, 'CONSTRAINT_GOALFIT_MODELLED_BASIS')).toHaveLength(0);
    } finally {
      defaultBaseNodeId = null;
    }
  });

  // -------------------------------------------------------------------------
  // Regression: unaffected runs are byte-identical
  // -------------------------------------------------------------------------

  it('regression: a reliable goal target (no base marker) delivers WITHOUT annotation or note', async () => {
    defaultBaseNodeId = null;
    const body = await run(GRAPH_GOAL_TARGET, [AT_LEAST_20_PCT]);

    const byId = new Map(body.option_comparison.map((o: any) => [o.option_id, o]));
    expect((byId.get('opt_a') as any).probability_of_joint_goal).toBe(0.62);
    expect((byId.get('opt_b') as any).probability_of_joint_goal).toBe(0.38);
    for (const opt of body.option_comparison) {
      expect(opt, opt.option_id).not.toHaveProperty('goal_fit_basis');
    }
    expect(warningsByCode(body, 'CONSTRAINT_TARGET_UNRELIABLE')).toHaveLength(0);
    expect(warningsByCode(body, 'CONSTRAINT_GOALFIT_MODELLED_BASIS')).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // L63 — THE LIVE SHAPE, UN-ATTESTED: doctrine B no longer delivers it.
  //
  // This is GRAPH_GOAL_TARGET with the 'delta' attestation removed, i.e. the
  // exact shape measured on deployed staging: a goal target normalised against
  // a producer cap, on a non-root goal node whose samples are
  // `intercept + SUM(parent*strength)` with base 0.0. Every input doctrine B
  // keys on is unchanged — same node, same constraint, same ISL marker, same
  // forward-propagated inputs — so the ONLY thing that can move the verdict
  // between this test and the DELIVERS test above is the sample-frame anchor.
  // -------------------------------------------------------------------------
  it('L63: the un-attested live shape is SUPPRESSED, not delivered under doctrine B', async () => {
    defaultBaseNodeId = 'goal_productivity';
    try {
      const body = await run(
        {
          ...GRAPH_GOAL_TARGET,
          nodes: GRAPH_GOAL_TARGET.nodes.map((n) => {
            if (n.id !== 'goal_productivity') return n;
            const { goal_threshold_frame: _dropped, ...unattested } = n as any;
            return unattested;
          }),
        },
        [AT_LEAST_20_PCT],
      );

      for (const opt of body.option_comparison) {
        expect(opt, opt.option_id).not.toHaveProperty('probability_of_joint_goal');
        expect(opt, opt.option_id).not.toHaveProperty('constraint_probabilities');
        expect(opt, opt.option_id).not.toHaveProperty('goal_fit_basis');
      }

      // The honesty signal is the WARNING, not the info-severity modelled-basis
      // note — PLoT hides severity 'info', and this is a degradation to
      // disclose, not a basis footnote under a headline number.
      const warnings = warningsByCode(body, 'CONSTRAINT_TARGET_UNRELIABLE');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warning');
      expect(warnings[0].message).toContain('Improve productivity');
      expect(warningsByCode(body, 'CONSTRAINT_GOALFIT_MODELLED_BASIS')).toHaveLength(0);
    } finally {
      defaultBaseNodeId = null;
    }
  });

  it("L63: the same shape suppresses even with NO ISL base marker — PLoT derives it, not mirrors it", async () => {
    // defaultBaseNodeId stays null, so the ISL CONSTRAINT_NODE_DEFAULT_BASE
    // channel emits nothing and the pre-existing detector sees a clean run.
    // The refusal must still fire, because it is derived from the graph PLoT
    // is sending rather than read off an upstream warning list.
    defaultBaseNodeId = null;
    const body = await run(
      {
        ...GRAPH_GOAL_TARGET,
        nodes: GRAPH_GOAL_TARGET.nodes.map((n) => {
          if (n.id !== 'goal_productivity') return n;
          const { goal_threshold_frame: _dropped, ...unattested } = n as any;
          return unattested;
        }),
      },
      [AT_LEAST_20_PCT],
    );

    for (const opt of body.option_comparison) {
      expect(opt, opt.option_id).not.toHaveProperty('probability_of_joint_goal');
    }
    expect(warningsByCode(body, 'CONSTRAINT_TARGET_UNRELIABLE')).toHaveLength(1);
  });

  it('regression: a run without goal constraints carries no constraint fields, annotation, or note', async () => {
    defaultBaseNodeId = null;
    // Unstamped goal node: a goal_threshold stamp would auto-generate a
    // constraint (auto_constraint_from_threshold, pre-existing behaviour),
    // which is not the "no goal constraints" case this test pins.
    const body = await run(
      {
        ...GRAPH_GOAL_TARGET,
        nodes: GRAPH_GOAL_TARGET.nodes.map((n) =>
          n.id === 'goal_productivity' ? { id: n.id, kind: n.kind, label: n.label } : n,
        ),
      },
      undefined,
    );

    for (const opt of body.option_comparison) {
      expect(opt, opt.option_id).not.toHaveProperty('probability_of_joint_goal');
      expect(opt, opt.option_id).not.toHaveProperty('constraint_probabilities');
      expect(opt, opt.option_id).not.toHaveProperty('goal_fit_basis');
    }
    expect(warningsByCode(body, 'CONSTRAINT_TARGET_UNRELIABLE')).toHaveLength(0);
    expect(warningsByCode(body, 'CONSTRAINT_GOALFIT_MODELLED_BASIS')).toHaveLength(0);
  });
});
