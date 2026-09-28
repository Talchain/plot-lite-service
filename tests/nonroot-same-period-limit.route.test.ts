/**
 * Paul's churn limit — a SAME-PERIOD relabelled '%' limit on a NON-ROOT target
 * one option sets — through the REAL /v2/run route.
 *
 * RULING: Delivery Lead, olumi-programme-docs#72 5861214582 (28 Sep 2026
 * 00:23Z), on MG's measurement 5861189189
 * (`model-generation/successor-71229dfd/nonroot-gate/MEASURE-NONROOT.md`):
 *   - SAME PERIOD (the CEE-stamped `provenance_unit_relabelled.pre_normalisation_unit`
 *     equals the node's unit) → NOT refused: scored as `unit_percent` on the
 *     node's OWN frame, with `level_domain` sent.
 *   - A DIFFERENT period stays refused, and so does a limit with NO stamp whose
 *     unit mismatches the node's. Nothing is inferred from words.
 *   - (1) forwarded-as-stated accepts a level re-expressed on the node's own
 *     frame (2.5 → 0.025 on [0,100], `scale_frame` / `pair_frame`), unclamped.
 *   - (3) `scale_frame` joins the decision-grade whitelist (rung 1.6 only;
 *     never a default range).
 *
 * THE THREE PLoT CHECKS that held Paul's limit at 22f3d94 (MG's EXEC measure):
 *   (1) `collectInterventionsForwardedAsStated` accepted only the identity
 *       range, so churn's own-frame 2.5 → 0.025 left the some-pinned level
 *       limb (`isObservedBaselineLevelTarget`) closed;
 *   (2) the unit check: '%' (relabelled) vs the node's '% per month';
 *   (3) `DECISION_GRADE_SOURCES` omitted `scale_frame`.
 *
 * ⚠ WHAT THE MOCK IS. It answers every constraint for every option (per-option
 * distinct numbers) and emits CONSTRAINT_NODE_DEFAULT_BASE exactly where ISL's
 * rule does (non-root, no PU, not pinned by every option). It does NOT
 * reproduce ISL's refusals, so every "withheld" below is PLoT's own decision,
 * proved against a mock that was able to deliver. Real ISL scoring this shape
 * is NOT claimed here.
 *
 * Assertions bind by IDENTITY: constraint_id, node_id, option_id.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CHURN,
  CHURN_LIMIT,
  RETENTION_OPTION,
  paulRequest,
  variant,
  churnLimits,
  demote,
  deliveredChurnBlock,
} from './helpers/paul-churn-shapes.js';

// ---------------------------------------------------------------------------
// ISL mock — the some-pinned-anchor posture (see header)
// ---------------------------------------------------------------------------

let islBodies: any[] = [];

function defaultBaseWarnings(body: any): any[] {
  const edges: any[] = body.graph?.edges ?? [];
  const puIds = new Set((body.parameter_uncertainties ?? []).map((p: any) => p.node_id));
  const options: any[] = body.options ?? [];
  const out: any[] = [];
  const seen = new Set<string>();
  for (const c of body.goal_constraints ?? []) {
    const id = c.node_id;
    if (seen.has(id)) continue;
    seen.add(id);
    const isRoot = !edges.some((e) => e.to === id);
    const allIntervene = options.length > 0 && options.every((o) => o.interventions && id in o.interventions);
    if (!isRoot && !puIds.has(id) && !allIntervene) {
      out.push({ code: 'CONSTRAINT_NODE_DEFAULT_BASE', severity: 'info', detail: { node_id: id, defaulted_to: 0.0, reason: 'no_parameter_uncertainty' } });
    }
  }
  return out;
}

function optionResults(options: any[], constraints: any[] | undefined) {
  return options.map((opt: any, idx: number) => ({
    option_id: opt.id,
    outcome: { mean: 0.6 + idx * 0.01, std: 0.1, p10: 0.5, p50: 0.6, p90: 0.7, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
    win_probability: 1 / Math.max(1, options.length),
    rank: idx + 1,
    ...(constraints && constraints.length > 0
      ? {
          constraint_analysis: {
            joint_probability: 0.5 + idx / 100,
            constraints: constraints.map((c: any) => ({
              constraint_id: c.constraint_id,
              node_id: c.node_id,
              operator: c.operator,
              threshold: c.value,
              prob_satisfied: 0.5 + idx / 100,
              failure_margin_median: 0.01,
              near_miss_fraction: 0.1,
              binding: false,
            })),
            conditional_probabilities: null,
          },
        }
      : {}),
  }));
}

const mockISLService = {
  isEnabled: () => true,
  isAvailable: async () => true,
  async validateCausal() {
    return { status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [], explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl' };
  },
  async analyseSensitivity() { return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' }; },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_e: string, body: any): Promise<{ data: T | null; error: string | null }> {
    islBodies.push(body);
    return {
      data: {
        options: optionResults(body.options || [], body.goal_constraints),
        factor_sensitivity: [],
        robustness: { label: 'moderate', score: 0.6, fragile_edges: [], robust_edges: [] },
        inference_warnings: defaultBaseWarnings(body),
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
const { buildConstraintScaleProvenance } = await import('../src/routes/v2/run.js');
const { collectInterventionsForwardedAsStated } = await import('../src/lib/intervention-normaliser.js');

// ---------------------------------------------------------------------------

/** The unit clause the user must be told for a '%' limit on the '% per month' churn node. */
const unitClause = (limitUnit: string, nodeUnit = '% per month') =>
  `your target is stated in ${limitUnit} while "Monthly churn" is measured in ${nodeUnit}`;

const JA_BASE_BLOCK = resolve(__dirname, 'fixtures/nonroot-same-period-limit-20260928/J-a-4.delivered-churn-block.base-22f3d94.json');

describe("Paul's churn limit on a non-root, some-pinned target: the same-period relabel (DL 5861214582)", () => {
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
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
    delete process.env.DECISION_REVIEW_ENABLE;
    delete process.env.ENABLE_REVIEW_PASS;
  });

  async function run(payload: any): Promise<{ body: any; isl: any }> {
    islBodies = [];
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload });
    expect(res.statusCode).toBe(200);
    expect(islBodies.length, 'ISL was asked').toBeGreaterThan(0);
    return { body: res.json(), isl: islBodies[islBodies.length - 1] };
  }

  const islChurnLimit = (isl: any) => (isl?.goal_constraints ?? []).find((c: any) => c.constraint_id === CHURN_LIMIT);
  const islSetting = (isl: any, optionId: string, nodeId: string) => {
    const iv = (isl?.options ?? []).find((o: any) => o.id === optionId)?.interventions?.[nodeId];
    return typeof iv === 'number' ? iv : iv?.value;
  };
  const churnWarnings = (body: any) =>
    (body.inference_warnings ?? []).filter(
      (w: any) => w.code === 'CONSTRAINT_TARGET_UNRELIABLE' && (w.constraint_ids ?? []).includes(CHURN_LIMIT),
    );
  const churnResult = (body: any) => (body.constraint_results ?? []).find((c: any) => c.constraint_id === CHURN_LIMIT);

  /** Scored for EVERY option, decision-grade, not joint-withheld, no unreliable warning. */
  function expectScoredDecisionGrade(body: any, source: string) {
    const rows = body.option_comparison ?? [];
    expect(rows.length, 'options reached the response').toBeGreaterThan(0);
    for (const o of rows) {
      expect(typeof o.constraint_probabilities?.[CHURN_LIMIT], `${o.option_id} churn P`).toBe('number');
      expect(o.constraints_decision_grade, `${o.option_id} decision-grade`).toBe(true);
    }
    expect(body.constraints_status).toBe('computed');
    expect(body.joint_withheld?.constraint_ids ?? []).not.toContain(CHURN_LIMIT);
    expect(churnWarnings(body)).toEqual([]);
    expect(churnResult(body)?.scale_provenance).toEqual({ source, range_unified: true, decision_grade: true });
  }

  /** Withheld for every option, and a CONSTRAINT_TARGET_UNRELIABLE names the churn limit. */
  function expectWithheld(body: any): any {
    for (const o of body.option_comparison ?? []) {
      expect(o.constraint_probabilities?.[CHURN_LIMIT], `${o.option_id} churn P withheld`).toBeUndefined();
    }
    expect(churnResult(body)).toBeUndefined();
    const warned = churnWarnings(body);
    expect(warned).toHaveLength(1);
    return warned[0];
  }

  /**
   * Withheld for every option AND named — by whichever gate withholds it, never silently. The SPEC (DL 5861214582:
   * "no-baseline stays withheld") is the outcome, not the gate: on today's staging the post-ISL
   * CONSTRAINT_TARGET_UNRELIABLE names it; with A3 r2 (#376) merged, a no-baseline '%' limit whose frame is refused
   * falls back to an INFERRED range and is refused BEFORE ISL as `threshold_clamped` (a typed `_meta` record + a
   * critique) — AIQ's rule 3, "a clamped threshold is refused, never scored". Found by MG's batch-7 combined-tree run
   * (#379 + #376 + #381). Either way: no P, no result, and a record that names this limit.
   */
  function expectWithheldAndNamed(body: any): void {
    for (const o of body.option_comparison ?? []) {
      expect(o.constraint_probabilities?.[CHURN_LIMIT], `${o.option_id} churn P withheld`).toBeUndefined();
    }
    expect(churnResult(body)).toBeUndefined();
    const warned = churnWarnings(body);
    const filtered = [...(body._meta?.constraints_filtered ?? []), ...(body._meta?.filtered_constraints ?? [])]
      .filter((f: any) => f?.constraint_id === CHURN_LIMIT);
    expect(warned.length + filtered.length, JSON.stringify({ warned, filtered })).toBeGreaterThanOrEqual(1);
    expect(body.joint_withheld?.constraint_ids ?? [], 'the joint names the unscored churn limit').toContain(CHURN_LIMIT);
  }

  // =========================================================================
  // R1 — Paul's own wire (P-a): scored, decision-grade, level_domain sent
  // =========================================================================

  it("R1 (P-a, Paul's fixture as served): churn is scored for EVERY option, decision-grade, unit_percent, level_domain sent, not joint-withheld", async () => {
    const req = paulRequest();
    // Precondition, read off the fixture rather than assumed: the same-period stamp.
    for (const c of churnLimits(req)) {
      expect(c.unit).toBe('%');
      expect(c.provenance_unit_relabelled?.pre_normalisation_unit).toBe('% per month');
    }
    expect(req.graph.nodes.find((n: any) => n.id === CHURN).observed_state.unit).toBe('% per month');

    const { body, isl } = await run(req);
    const optionIds = (body.option_comparison ?? []).map((o: any) => o.option_id);
    expect(optionIds).toContain(RETENTION_OPTION);
    expect(optionIds).toContain('keep_current_49_price');

    expectScoredDecisionGrade(body, 'unit_percent');
    // The node's OWN frame: 4 → 0.04 and 2.5 → 0.025 on [0,100], the frame its 0.03 baseline is on.
    expect(islChurnLimit(isl)).toMatchObject({ node_id: CHURN, operator: '<=', value: 0.04, value_frame: 'level', level_domain: { min: 0, max: 1 } });
    expect(islSetting(isl, RETENTION_OPTION, CHURN)).toBe(0.025);
    expect((isl.graph?.nodes ?? []).find((n: any) => n.id === CHURN)?.observed_state?.baseline).toBe(0.03);
  });

  // =========================================================================
  // R1b — (3) on its own: the limit spelt in the node's unit (P-b), no stamp
  // =========================================================================

  it("R1b (P-b, limit '% per month' verbatim, no stamp): scored for every option, decision-grade on the node's own scale_frame", async () => {
    const { body, isl } = await run(variant('P', 'b', 4));
    expectScoredDecisionGrade(body, 'scale_frame');
    expect(islChurnLimit(isl)).toMatchObject({ value: 0.04, value_frame: 'level' });
    expect(islChurnLimit(isl)?.level_domain).toBeUndefined();
    expect(islSetting(isl, RETENTION_OPTION, CHURN)).toBe(0.025);
  });

  // =========================================================================
  // R2 — RAW form scores the same as CEE's DEMOTED form
  // =========================================================================

  for (const [tag, s] of [['J-a (journey A)', 'J'], ['P-a (Paul)', 'P']] as const) {
    it(`R2 ${tag}: the RAW request scores the churn limit exactly as the DEMOTED request does, decision-grade`, async () => {
      const raw = variant(s, 'a', 4);
      const demoted = demote(raw);
      // Precondition: the demoted request is all-[0,1] (Phase 4a skips it) and the raw one is not.
      const all = (r: any) => r.options.flatMap((o: any) => Object.values<any>(o.interventions).map((v) => (typeof v === 'number' ? v : v.value)));
      expect(all(demoted).every((v: number) => v >= 0 && v <= 1)).toBe(true);
      expect(all(raw).some((v: number) => v > 1)).toBe(true);

      const R = await run(raw);
      const D = await run(demoted);
      expectScoredDecisionGrade(D.body, 'unit_percent');
      expectScoredDecisionGrade(R.body, 'unit_percent');
      expect(islChurnLimit(R.isl)).toEqual(islChurnLimit(D.isl));
      expect(R.isl.options.map((o: any) => [o.id, o.interventions])).toEqual(D.isl.options.map((o: any) => [o.id, o.interventions]));
      // Two fields legitimately differ, and both are DISCLOSURE of what Phase 4a
      // did, not the score: the raw form carries a `constraint.value` repair
      // either way, and `margin_precision: 'exact'` appears only where Phase 4a
      // RECORDED an unclamped diagnostic for an option's setting (the raw
      // retention option); the demoted form ran no Phase 4a, so it says nothing.
      const precisions = (b: any) =>
        (b.option_comparison ?? []).flatMap((o: any) =>
          (o.constraint_margins ?? []).filter((m: any) => m.constraint_id === CHURN_LIMIT && 'margin_precision' in m)
            .map((m: any) => [o.option_id, m.margin_precision]));
      expect(precisions(D.body)).toEqual([]);
      expect(precisions(R.body)).toEqual(s === 'P' ? [[RETENTION_OPTION, 'exact']] : []);
      const block = (b: any, i: any) => {
        const { constraint_repairs: _r, ...rest } = deliveredChurnBlock(b, i);
        for (const o of rest.option_comparison) {
          o.constraint_margins = o.constraint_margins.map(({ margin_precision: _p, ...m }: any) => m);
        }
        return rest;
      };
      expect(block(R.body, R.isl)).toEqual(block(D.body, D.isl));
    });
  }

  // =========================================================================
  // R3 — J-a is unchanged (byte-compare against the block recorded at base)
  // =========================================================================

  it('R3 (J-a): the delivered churn block is byte-identical to the one recorded at base 22f3d94', async () => {
    const { body, isl } = await run(variant('J', 'a', 4));
    const recorded = readFileSync(JA_BASE_BLOCK, 'utf8');
    expect(JSON.stringify(deliveredChurnBlock(body, isl), null, 1) + '\n').toBe(recorded);
  });

  // =========================================================================
  // R4 — no baseline: still withheld
  // =========================================================================

  it('R4 (P-a with NO baseline): the same-period stamp does not open the level limb — withheld', async () => {
    const { body } = await run(variant('P', 'an', 4));
    expectWithheld(body);
  });

  it("R4 (P-bn, Canonical's no-baseline spelling): withheld", async () => {
    const { body } = await run(variant('P', 'bn', 4));
    expectWithheld(body);
  });

  it('R4 (J-bn, not intervened, no baseline): withheld, and named (by either gate — see expectWithheldAndNamed)', async () => {
    const { body } = await run(variant('J', 'bn', 4));
    expectWithheldAndNamed(body);
  });

  // =========================================================================
  // R5 — a DIFFERENT period is refused, with the unit reason
  // =========================================================================

  it("R5 (stamp '% per year' relabelled to '%' on the '% per month' node): refused on the unit", async () => {
    const req = paulRequest();
    for (const c of churnLimits(req)) c.provenance_unit_relabelled.pre_normalisation_unit = '% per year';
    const { body } = await run(req);
    expect(expectWithheld(body).message).toContain(unitClause('%'));
  });

  it("R5 ('% per year' limit verbatim on the '% per month' node, baseline present): refused on the unit", async () => {
    const { body } = await run(variant('P', 'y', 10));
    expect(expectWithheld(body).message).toContain(unitClause('% per year'));
  });

  it("R5 (stamp '% per month' on a '% per year' node): refused on the unit", async () => {
    const req = paulRequest();
    req.graph.nodes.find((n: any) => n.id === CHURN).observed_state.unit = '% per year';
    const { body } = await run(req);
    expect(expectWithheld(body).message).toContain(unitClause('%', '% per year'));
  });

  it("R5 (stamp 'percent per month' on a '% per month' node): no vocabulary is invented — refused on the unit", async () => {
    const req = paulRequest();
    for (const c of churnLimits(req)) c.provenance_unit_relabelled.pre_normalisation_unit = 'percent per month';
    const { body } = await run(req);
    expect(expectWithheld(body).message).toContain(unitClause('%'));
  });

  it("CONTROL (stamp ' % PER MONTH ', the existing canonicaliser's trim + case): the same unit — scored", async () => {
    const req = paulRequest();
    for (const c of churnLimits(req)) c.provenance_unit_relabelled.pre_normalisation_unit = ' % PER MONTH ';
    const { body } = await run(req);
    expectScoredDecisionGrade(body, 'unit_percent');
  });

  // =========================================================================
  // R6 — NO stamp + a mismatched unit: refused
  // =========================================================================

  it("R6 (no stamp: a bare '%' limit on the '% per month' node): refused on the unit", async () => {
    const req = paulRequest();
    for (const c of churnLimits(req)) delete c.provenance_unit_relabelled;
    const { body } = await run(req);
    expect(expectWithheld(body).message).toContain(unitClause('%'));
  });

  // =========================================================================
  // The rung's other two conjuncts, each with a row that only it decides
  // =========================================================================

  it("R9 (same-period stamp, FRACTIONAL '%' 0.04): the '%' rung reads [0,1], not the samples' [0,100] — refused, never scored as 0.0004", async () => {
    const req = paulRequest();
    for (const c of churnLimits(req)) {
      c.value = 0.04;
      c.provenance_unit_relabelled.pre_normalisation_value = 0.04;
    }
    const { body, isl } = await run(req);
    // The unit check withholds at the RESPONSE (the payload still carries the
    // mis-scaled number, as for every unit-mismatched limit) — what matters is
    // that nothing is delivered, and it is not re-labelled as the '%' rung.
    expect(islChurnLimit(isl)?.level_domain).toBeUndefined();
    expect(expectWithheld(body).message).toContain(unitClause('%'));
  });

  it("CONTROL (a stamped relabel on a node ALREADY in '%'): the unit check never refused it, so its delivered block is byte-identical to the unstamped one", async () => {
    const plain = variant('P', 'c', 4);
    const stamped = variant('P', 'c', 4);
    for (const c of churnLimits(stamped)) {
      c.provenance_unit_relabelled = { rule: 'agent_lane_limit_unit_v1', pre_normalisation_value: 4, pre_normalisation_unit: 'percent' };
    }
    const A = await run(plain);
    const B = await run(stamped);
    expect(churnResult(A.body)?.scale_provenance?.source).toBe('scale_frame');
    expect(JSON.stringify(deliveredChurnBlock(B.body, B.isl))).toBe(JSON.stringify(deliveredChurnBlock(A.body, A.isl)));
  });
});

// ===========================================================================
// R7 — (3)'s scope, on the trust marker itself
// ===========================================================================

describe("R7 — the decision-grade whitelist admits scale_frame (the node's own frame, rung 1.6) and nothing else new", () => {
  // Same bounds for all three, so only the SOURCE can decide.
  const gc = (id: string) => ({ constraint_id: id, node_id: CHURN, operator: '<=' as const, value: 4, value_frame: 'level' as const });
  const ids = ['r7:scale_frame', 'r7:default', 'r7:pair_frame'];
  const ranges = new Map<string, any>([
    ['r7:scale_frame', { min: 0, max: 100, source: 'scale_frame' }],
    ['r7:default', { min: 0, max: 100, source: 'default' }],
    ['r7:pair_frame', { min: 0, max: 100, source: 'pair_frame' }],
  ]);
  const prov = buildConstraintScaleProvenance(ids.map(gc) as any, ranges, undefined, undefined, undefined);

  it('scale_frame [0,100]: decision-grade', () => {
    expect(prov.get('r7:scale_frame')?.decision_grade).toBe(true);
  });
  it('R7 a default-range threshold [0,100]: NOT decision-grade', () => {
    expect(prov.get('r7:default')?.decision_grade).toBe(false);
  });
  it('pair_frame [0,100]: NOT decision-grade (the ruling admits scale_frame only)', () => {
    expect(prov.get('r7:pair_frame')?.decision_grade).toBe(false);
  });
});

// ===========================================================================
// R8 — (1)'s scope: only the node's own frame counts as "as stated"
// ===========================================================================

describe("R8 — forwarded-as-stated accepts a setting re-expressed on the node's OWN frame, unclamped, and nothing else", () => {
  const opts = (nodeId: string) => [{ interventions: { [nodeId]: 1 } }, { interventions: {} }];
  const as = (range: any, clamped = false) =>
    collectInterventionsForwardedAsStated(opts('n'), [{ factor_id: 'n', range, clamped }]).has('n');

  it('scale_frame [0,100], unclamped: as stated', () => expect(as({ min: 0, max: 100, source: 'scale_frame' })).toBe(true));
  it('pair_frame [0,100], unclamped: as stated', () => expect(as({ min: 0, max: 100, source: 'pair_frame' })).toBe(true));
  it('scale_frame [0,100], CLAMPED: not as stated', () => expect(as({ min: 0, max: 100, source: 'scale_frame' }, true)).toBe(false));
  it('R8 inferred_baseline [0,0.14] (the FRAME GUARD range): not as stated', () =>
    expect(as({ min: 0, max: 0.14, source: 'inferred_baseline' })).toBe(false));
  it('inferred_spread, explicit_cap, explicit, default (non-identity): not as stated', () => {
    for (const source of ['inferred_spread', 'explicit_cap', 'explicit', 'default']) {
      expect(as({ min: 0, max: 100, source }), source).toBe(false);
    }
  });
  it('identity [0,1], unclamped: as stated (unchanged)', () => expect(as({ min: 0, max: 1, source: 'default' })).toBe(true));
});
