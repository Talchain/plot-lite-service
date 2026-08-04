/**
 * L63 — a constraint may not be scored against samples that carry no absolute
 * anchor.
 *
 * WHY THIS FILE EXISTS. ROADMAP 2.258/2.286 taught ISL's goal-threshold channel
 * to convert a LEVEL target into the samples' frame or REFUSE. 2.266 taught
 * PLoT's auto-SYNTHESIS path the same discipline. The third path — an actual
 * `goal_constraints` row, whether the user authored it, the draft minted it, or
 * a chat turn added it — was left comparing the threshold to raw Monte-Carlo
 * samples with no frame plan, no baseline and no refusal
 * (`robustness_analyzer_v2.py:7329` `_check_constraint_satisfied`:
 * `value >= constraint.threshold`).
 *
 * WITNESSED, on the deployed tips PLoT `2864b0c` / ISL `80aa83f`
 * (`PHASE0-EVIDENCE-2026-07-28/diagnosis-goalfit-untruth.md`, artefacts in
 * `l60-artefacts/`, probe request_id `l60-goalfit-diagnosis-probe-20260804`):
 * `probability_of_joint_goal` came back 0 for EVERY option in EVERY witnessed
 * shape, marked `constraints_status: "computed"` and
 * `scale_provenance.decision_grade: true`, while the guarded channel's
 * `probability_of_goal` was ABSENT — the two channels answering in opposite
 * directions inside one response. The UI then substituted the delivered zero
 * into the goal-fit surface the refusal had honestly left empty
 * (`joint_goal_substituted`), rendering "< 1% chance of meeting every target".
 *
 * THE THREE WITNESSED FLAVOURS ARE ALL REPRODUCED BELOW, at their measured
 * shapes, because they arrive by three different routes and the earlier fixes
 * each covered only one route:
 *   F1  goal-target       goal_mrr >= 250000 '£'      cap 312500, frame 'level'
 *   F2  draft-minted      out_gross_margin >= 0.8     bare outcome node, no cap
 *   F3  chat-minted       risk_ae_attrition <= 2      'count', observed cap
 *
 * ⚠ EVERY ONE OF THE THREE PASSES THE PRE-EXISTING RELIABILITY DETECTION. None
 * normalises against the default range, so `threshold_normalisation_defaulted`
 * never fires; and the ISL mock here emits no CONSTRAINT_NODE_DEFAULT_BASE, so
 * `target_base_defaulted` never fires either. That is the hole, stated as a
 * test property: if the new derived detector is removed, these three deliver.
 *
 * THE ASSERTION SURFACE. The mock returns a NON-ZERO joint probability (0.0054,
 * the witnessed magnitude) for whatever it is sent, so every "withheld"
 * assertion below is proving an ABSENCE that the mock was able to produce as a
 * PRESENCE — the positive controls prove exactly that on the same wire. A test
 * that cannot observe the presence cannot prove the absence.
 *
 * Assertions bind to constraints and nodes BY IDENTITY (constraint_id, node_id,
 * option_id), never by a value predicate another object could satisfy.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// ISL mock — captures the outbound request and always returns a constraint
// analysis when constraints were sent, at the witnessed near-zero magnitude.
// ---------------------------------------------------------------------------

let capturedISLRequestBody: any = null;

const WITNESSED_JOINT = 0.0054;

function mockOptionRows(body: any) {
  const options = body.options || [];
  const constraints = body.goal_constraints || [];
  return options.map((opt: any, idx: number) => ({
    option_id: opt.id,
    outcome: {
      mean: 0.1578, std: 0.2048, p10: -0.142, p50: 0.1578, p90: 0.376,
      n_samples: 2000, n_valid_samples: 2000, validity_ratio: 1.0,
    },
    rank: idx + 1,
    ...(constraints.length > 0
      ? {
          constraint_analysis: {
            constraints: constraints.map((c: any) => ({
              constraint_id: c.constraint_id,
              node_id: c.node_id,
              operator: c.operator,
              value: c.value,
              prob_satisfied: WITNESSED_JOINT,
              satisfied: false,
            })),
            joint_probability: WITNESSED_JOINT,
            constraint_probabilities: Object.fromEntries(
              constraints.map((c: any) => [c.constraint_id, WITNESSED_JOINT]),
            ),
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
          mean: 0.1578, std: 0.2048, p10: -0.142, p50: 0.1578, p90: 0.376,
          n_samples: 2000, n_valid_samples: 2000, validity_ratio: 1.0,
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
// Graph fixture — the witnessed pricing scenario's topology, at the measured
// in-edge counts (l60-artefacts/scenario-pricing.json):
//   goal_mrr           kind goal     in_edges 4   observed_state null
//   out_gross_margin   kind outcome  in_edges 1   observed_state null
//   risk_logo_churn    kind risk     in_edges 3   observed_state {value .02, cap 100}
//   fac_price_sens     kind factor   in_edges 0   observed_state {value .75}   <- ROOT
// NOTE `intercept` is absent on every node, exactly as in both witnessed live
// graphs — so a non-root node's samples are bare parent propagation.
// ---------------------------------------------------------------------------

function baseGraph(goalNodeExtras: Record<string, unknown> = {}) {
  return {
    nodes: [
      { id: 'goal_mrr', kind: 'goal', label: 'Grow MRR to £250,000', ...goalNodeExtras },
      { id: 'out_gross_margin', kind: 'outcome', label: 'Gross margin' },
      { id: 'risk_logo_churn', kind: 'risk', label: 'Logo churn', observed_state: { value: 0.02, cap: 100, unit: '%' } },
      { id: 'fac_price_level', kind: 'factor', label: 'Seat price level', observed_state: { value: 0.49 } },
      { id: 'fac_price_sens', kind: 'factor', label: 'Customer price sensitivity', observed_state: { value: 0.75 } },
    ],
    edges: [
      { from: 'fac_price_level', to: 'goal_mrr', exists_probability: 0.9, strength: { mean: 0.5, std: 0.15 } },
      { from: 'fac_price_sens', to: 'goal_mrr', exists_probability: 0.9, strength: { mean: -0.4, std: 0.15 } },
      { from: 'fac_price_level', to: 'out_gross_margin', exists_probability: 0.9, strength: { mean: 0.4, std: 0.1 } },
      { from: 'fac_price_sens', to: 'risk_logo_churn', exists_probability: 0.9, strength: { mean: 0.3, std: 0.1 } },
      // out_gross_margin and risk_logo_churn need a path to the goal or
      // preflight blocks any option that intervenes on them (NO_PATH_TO_GOAL).
      // Both keep their incoming edges, so both stay NON-ROOT — which is what
      // these fixtures are here to exercise.
      { from: 'out_gross_margin', to: 'goal_mrr', exists_probability: 0.9, strength: { mean: 0.3, std: 0.1 } },
      { from: 'risk_logo_churn', to: 'goal_mrr', exists_probability: 0.9, strength: { mean: -0.2, std: 0.1 } },
    ],
  };
}

const OPTIONS = [
  { id: 'opt_hold', label: 'Hold at £49', interventions: { fac_price_level: { value: 0.49, source: 'user_specified' } } },
  { id: 'opt_raise', label: 'Raise to £59', interventions: { fac_price_level: { value: 0.59, source: 'user_specified' } } },
];

/** The manual-path goal node, exactly as CEE stamps it (diagnosis §2.2). */
const GOAL_NODE_LEVEL_STAMPED = {
  goal_threshold_raw: 250000,
  goal_threshold_cap: 312500,
  goal_threshold: 0.8,
  goal_threshold_unit: '£',
  goal_threshold_frame: 'level',
};

describe('L63 — constraints are not scored against unanchored samples', () => {
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
    return { res, body: res.json() as any, isl: capturedISLRequestBody };
  }

  function payloadWith(
    goalConstraints: unknown[],
    goalNodeExtras: Record<string, unknown> = {},
    options: unknown[] = OPTIONS,
  ) {
    return {
      graph: baseGraph(goalNodeExtras),
      options,
      goal_node_id: 'goal_mrr',
      seed: 'l63-sample-frame',
      n_samples: 2000,
      goal_constraints: goalConstraints,
    };
  }

  /** Every option's joint-goal figure, keyed by option id (identity, not order). */
  function jointByOption(body: any): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const o of body.option_comparison ?? []) out[o.option_id] = o.probability_of_joint_goal;
    return out;
  }

  function unreliableWarnings(body: any): any[] {
    return (body.inference_warnings ?? []).filter(
      (w: any) => w.code === 'CONSTRAINT_TARGET_UNRELIABLE',
    );
  }

  // =========================================================================
  // F1 — the goal-target flavour (diagnosis §6, the synthetic live probe)
  // =========================================================================
  it('F1: a LEVEL goal target on a non-root goal node is WITHHELD, not scored', async () => {
    const { res, body, isl } = await run(
      payloadWith(
        [{ constraint_id: 'gc_goal_target', node_id: 'goal_mrr', operator: '>=', value: 250000, unit: '£', label: 'Grow MRR to £250,000' }],
        GOAL_NODE_LEVEL_STAMPED,
      ),
    );

    expect(res.statusCode).toBe(200);

    // The mock WAS given the constraint and DID answer — so the absence below
    // is a decision, not an empty pipeline (trap 13: prove it can see presence).
    expect((isl.goal_constraints ?? []).map((c: any) => c.constraint_id)).toContain('gc_goal_target');

    // The fabricated joint figure reaches NO option.
    const joint = jointByOption(body);
    expect(Object.keys(joint).sort()).toEqual(['opt_hold', 'opt_raise']);
    expect(joint.opt_hold).toBeUndefined();
    expect(joint.opt_raise).toBeUndefined();

    // ...and it is not smuggled in per-constraint either.
    for (const o of body.option_comparison ?? []) {
      expect(o.constraint_probabilities).toBeUndefined();
    }

    // Nothing about this run may read as decision-grade.
    expect(body.constraints_status).not.toBe('computed');
    for (const o of body.option_comparison ?? []) {
      expect(o.constraints_decision_grade).not.toBe(true);
    }

    // The refusal is DISCLOSED, at warning severity, naming the node.
    const warned = unreliableWarnings(body);
    expect(warned).toHaveLength(1);
    expect(warned[0].severity).toBe('warning');
    expect(warned[0].message).toContain('Grow MRR to £250,000');

    // And it is NOT downgraded to the info-severity modelled-basis note, which
    // is the exception that delivered this exact number on the live run.
    expect(
      (body.inference_warnings ?? []).some(
        (w: any) => w.code === 'CONSTRAINT_GOALFIT_MODELLED_BASIS',
      ),
    ).toBe(false);
  });

  // =========================================================================
  // F2 — the draft-minted flavour (diagnosis §8.2, pricing runs 1+2)
  // "and gross margin above 80%" on a bare outcome node with no cap.
  // =========================================================================
  it('F2: a draft-minted fraction target on a non-root outcome node is WITHHELD', async () => {
    const { body, isl } = await run(
      payloadWith([
        { constraint_id: 'constraint_out_gross_margin_min', node_id: 'out_gross_margin', operator: '>=', value: 0.8, unit: 'fraction' },
      ]),
    );

    expect((isl.goal_constraints ?? []).map((c: any) => c.constraint_id)).toContain(
      'constraint_out_gross_margin_min',
    );

    const joint = jointByOption(body);
    expect(joint.opt_hold).toBeUndefined();
    expect(joint.opt_raise).toBeUndefined();
    expect(body.constraints_status).not.toBe('computed');

    const warned = unreliableWarnings(body);
    expect(warned.map((w: any) => w.message).join(' ')).toContain('Gross margin');
  });

  // =========================================================================
  // F3 — the chat-minted flavour (diagnosis §8.2, people run).
  // A COUNT target on a non-root risk node. This node DOES carry an
  // observed_state value+cap — and it is still refused, because ISL reads
  // observed_state.value as a base for ROOT nodes only. That discrimination is
  // the whole point: a present observed value is not an anchor on a non-root.
  // =========================================================================
  it('F3: a COUNT target on a non-root risk node is WITHHELD even though it has an observed value', async () => {
    const { body, isl } = await run(
      payloadWith([
        { constraint_id: 'constraint_churn_max', node_id: 'risk_logo_churn', operator: '<=', value: 3, unit: '%' },
      ]),
    );

    expect((isl.goal_constraints ?? []).map((c: any) => c.constraint_id)).toContain(
      'constraint_churn_max',
    );

    const joint = jointByOption(body);
    expect(joint.opt_hold).toBeUndefined();
    expect(joint.opt_raise).toBeUndefined();

    const warned = unreliableWarnings(body);
    expect(warned.map((w: any) => w.message).join(' ')).toContain('Logo churn');
  });

  // =========================================================================
  // PC1 — POSITIVE CONTROL (topology). A ROOT node carrying an observed value
  // IS anchored: ISL seeds its sample base from observed_state.value, so a
  // level threshold on it is exactly what the samples are in. This is the
  // live-reachable control — it must keep delivering.
  // =========================================================================
  it('PC1: a target on a ROOT node with an observed value STILL delivers', async () => {
    const { body, isl } = await run(
      payloadWith([
        { constraint_id: 'gc_root_factor', node_id: 'fac_price_sens', operator: '>=', value: 0.5 },
      ]),
    );

    expect((isl.goal_constraints ?? []).map((c: any) => c.constraint_id)).toContain('gc_root_factor');

    const joint = jointByOption(body);
    expect(joint.opt_hold).toBe(WITNESSED_JOINT);
    expect(joint.opt_raise).toBe(WITNESSED_JOINT);
    expect(unreliableWarnings(body)).toHaveLength(0);
  });

  // =========================================================================
  // PC2 — POSITIVE CONTROL (attestation). The producer stamps 'delta' on the
  // goal node: targets on it are attested to be in the samples' own frame.
  // Same attestation, same reading, as the 2.266 auto-synthesis gate — this
  // control is what stops L63 from silently repealing 2.266's T5/T5b.
  // =========================================================================
  it("PC2: a target on a non-root node attested 'delta' STILL delivers", async () => {
    const { body } = await run(
      payloadWith(
        [{ constraint_id: 'gc_delta_target', node_id: 'goal_mrr', operator: '>=', value: 0.3 }],
        { goal_threshold: 0.3, goal_threshold_frame: 'delta' },
      ),
    );

    const joint = jointByOption(body);
    expect(joint.opt_hold).toBe(WITNESSED_JOINT);
    expect(joint.opt_raise).toBe(WITNESSED_JOINT);
    expect(unreliableWarnings(body)).toHaveLength(0);
  });

  // =========================================================================
  // PC3 — POSITIVE CONTROL (pinning). Every option intervenes on the target,
  // so each sample IS that absolute value and the comparison is well-posed.
  //
  // ⚠ THE TARGET IS `out_gross_margin`, A NON-ROOT NODE WITH NO OBSERVED VALUE,
  // ON PURPOSE. An earlier draft of this control pinned a ROOT factor that
  // already carried an observed value — so it passed through the
  // `root_observed_level` limb and would have stayed green with the pinning
  // limb deleted entirely. A control must fail for the reason it names.
  // =========================================================================
  const PIN_OPTIONS = [
    { id: 'opt_hold', label: 'Hold at £49', interventions: { out_gross_margin: { value: 0.82, source: 'user_specified' } } },
    { id: 'opt_raise', label: 'Raise to £59', interventions: { out_gross_margin: { value: 0.86, source: 'user_specified' } } },
  ];

  it('PC3: a target on a NON-ROOT node pinned by EVERY option STILL delivers', async () => {
    const { body } = await run(
      payloadWith(
        [{ constraint_id: 'gc_pinned', node_id: 'out_gross_margin', operator: '>=', value: 0.8 }],
        {},
        PIN_OPTIONS,
      ),
    );

    const joint = jointByOption(body);
    expect(joint.opt_hold).toBe(WITNESSED_JOINT);
    expect(joint.opt_raise).toBe(WITNESSED_JOINT);
    expect(unreliableWarnings(body)).toHaveLength(0);
  });

  // =========================================================================
  // PC3b — the pinning limb must require EVERY option, not merely one. A node
  // one option pins and another leaves free is not comparable across options.
  // Same node and same constraint as PC3 — only the option set differs, so the
  // pinning limb is the ONLY thing that can explain the difference in verdict.
  // =========================================================================
  it('PC3b: the SAME target pinned by only ONE option is WITHHELD', async () => {
    const { body } = await run(
      payloadWith(
        [{ constraint_id: 'gc_pinned', node_id: 'out_gross_margin', operator: '>=', value: 0.8 }],
        {},
        [
          PIN_OPTIONS[0],
          { id: 'opt_raise', label: 'Raise to £59', interventions: { fac_price_level: { value: 0.59, source: 'user_specified' } } },
        ],
      ),
    );

    const joint = jointByOption(body);
    expect(joint.opt_hold).toBeUndefined();
    expect(joint.opt_raise).toBeUndefined();
    expect(unreliableWarnings(body)).toHaveLength(1);
  });

  // =========================================================================
  // MIX — one anchored constraint beside one unanchored one. The run-level
  // suppression must win: a joint figure computed over a SUBSET, presented as
  // "every target", is the same untruth in a quieter register.
  // =========================================================================
  it('MIX: one unanchored constraint suppresses the whole run, not just itself', async () => {
    const { body } = await run(
      payloadWith(
        [
          { constraint_id: 'gc_root_factor', node_id: 'fac_price_sens', operator: '>=', value: 0.5 },
          { constraint_id: 'gc_goal_target', node_id: 'goal_mrr', operator: '>=', value: 250000, unit: '£' },
        ],
        GOAL_NODE_LEVEL_STAMPED,
      ),
    );

    const joint = jointByOption(body);
    expect(joint.opt_hold).toBeUndefined();
    expect(joint.opt_raise).toBeUndefined();

    // Exactly one node is named — the unanchored one, by identity.
    const warned = unreliableWarnings(body);
    expect(warned).toHaveLength(1);
    expect(warned[0].message).toContain('Grow MRR to £250,000');
    expect(warned[0].message).not.toContain('Customer price sensitivity');
  });
});
