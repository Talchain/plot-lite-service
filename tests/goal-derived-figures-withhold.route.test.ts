/**
 * ⛔ UNDER AN UNEVALUATED GOAL IDENTITY, THE SAME WALK'S SENSITIVITY / VALUE-OF-INFORMATION / ROBUSTNESS FIGURES ARE
 * WITHHELD TOO (R3 SCIENCE #72 5888737291, the step after PLoT #417).
 *
 * #416 withholds P(goal) and #417 each option's chance of leading and outcome figures when a declared identity on the
 * goal's path was not evaluated. The same links-only draws also produce:
 *   - `p_win_sensitivity` (its `current_metric` is the chance of meeting the goal), `factor_evppi`, `decision_evpi`;
 *   - `robustness` (edges' switch probabilities / alternative winners, is_robust, level, and `confidence` — the
 *     leader's chance of leading, relabelled);
 *   - `flip_thresholds` (tipping points) and `driver_order` (the driver ranking), and the brief built from them.
 * They are withheld by the SAME predicate (`goalIdentitiesNotEvaluated`), said once by #416's warning.
 *
 * THE WIRE: a real ISL /analyze/v2 answer (local ISL, R3-B witness W214, 28 Sep: AIQ's r3prod P1 request, Paul's MRR
 * identity stated and evaluated), replayed through the mocked ISL client. CONTROL: that answer as ISL gave it (evaluated)
 * keeps every carrier. RED: the same answer with the identity inferred and reported `evaluated: false`.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXTURE_DIR = resolve(__dirname, 'fixtures/r3b-goal-derived-withhold-20260929');
const ISL_BODY = JSON.parse(readFileSync(resolve(FIXTURE_DIR, 'isl-analyze-v2.response.json'), 'utf8'));
const REQUEST = JSON.parse(readFileSync(resolve(FIXTURE_DIR, 'plot-v2-run.request.json'), 'utf8'));

/** What the mocked ISL answers next: the captured body with these top-level keys replaced. */
let islOverride: Record<string, unknown> = {};

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [],
      backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock validation', reasoning: 'Test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseRobustness(): Promise<never> { throw new Error('not called'); },
  async analyseFactorSensitivity() {
    return {
      factors: [], value_of_information: [], robustness_label: 'robust' as const,
      robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const,
    };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(): Promise<{ data: T | null; error: unknown }> {
    return { data: { ...structuredClone(ISL_BODY), ...structuredClone(islOverride) } as T, error: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

// The legacy CEE review (/review) — reached only with CEE_ORCHESTRATOR_ENABLED on and M2 off (its own row below).
const mockOrchestrateCeeReview = vi.fn();
vi.mock('../src/cee/orchestrator.ts', () => ({ orchestrateCeeReview: (...a: unknown[]) => mockOrchestrateCeeReview(...a) }));

import { createServer } from '../src/createServer.js';

const WITHHELD = 'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED';
const codes = (body: any): string[] => (body.inference_warnings ?? []).map((w: any) => w.code);

/** The request with Paul's identity INFERRED (stated_in_brief:false): ISL evaluating it false withholds, never refuses. */
function inferredRequest(): any {
  const d = structuredClone(REQUEST);
  d.graph.nodes.find((n: any) => n.id === 'mrr').nonlinear_identity.stated_in_brief = false;
  return d;
}
/** ISL's own identity row, reported NOT evaluated. */
function notEvaluated(): unknown[] {
  const { level_source: _l, reconciliation: _r, ...row } = (ISL_BODY.identity_evaluations as any[])[0];
  return [{ ...row, stated_in_brief: false, evaluated: false, withheld_reason: 'identity_frame_missing' }];
}

describe("route — the goal's sensitivity, value-of-information and robustness figures are withheld with it", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  async function run(payload: any) {
    const res = await fetch(`${baseUrl}/v2/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    expect(res.status).toBe(200);
    return res.json();
  }
  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    // Staging parity: the M2 decision review is on (it skips before any CEE call when it has nothing honest to read).
    process.env.DECISION_REVIEW_ENABLE = '1';
    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  }, 60_000);
  afterAll(async () => { await app?.close(); });
  afterEach(() => { islOverride = {}; });

  // conditional_winners: the W214 answer carries none, so this row adds one block in ISL's own wire shape — copied from
  // the real ISL 3717e36 answer (tests/fixtures/b5-per-limit-0e19bb82/isl-3717e36.two-limits.response.json), with its
  // ids relabelled to W214's factor and options. A shape discriminator for the gate, not a claim about W214's wire.
  const CONDITIONAL_WINNERS = [{
    factor_id: 'pro_paying_subscribers', factor_label: 'Pro paying subscribers', split_value: 0.4, split_unit: 'subscribers',
    low_bucket: { n_samples: 5000, winner_id: 'keep_current_49_price', winner_label: 'Keep current £49 price', winner_probability: 0.5796, runner_up_id: 'increase_price_to_59', runner_up_probability: 0.152 },
    high_bucket: { n_samples: 5000, winner_id: 'increase_price_to_59', winner_label: 'Increase price to £59', winner_probability: 0.3716, runner_up_id: 'increase_price_to_54', runner_up_probability: 0.3688 },
    winner_flips: true,
  }];

  it('⭐ legacy CEE review (CEE_ORCHESTRATOR_ENABLED on, M2 off): never sent the walk under the withhold — the evaluated control still is (PR Review 5890819288)', async () => {
    const env = { CEE_ORCHESTRATOR_ENABLED: '1', DECISION_REVIEW_ENABLE: '0', CEE_BASE_URL: 'http://cee.test', CEE_API_KEY: 'test-key' };
    const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    Object.assign(process.env, env);
    const NARRATIVE = 'Increase price to £59 leads with a 95% chance and the result is robust.';
    mockOrchestrateCeeReview.mockReset();
    mockOrchestrateCeeReview.mockResolvedValue({
      ceeReview: {
        decision_quality: { level: 'good', summary: NARRATIVE },
        insights: [{ type: 'fragile_assumption', content: NARRATIVE, severity: 'medium' }],
        blocks: [{ id: 'robustness', headline: NARRATIVE, factors: [NARRATIVE] }],
      },
      ceeTrace: { requestId: 'r', degraded: false, timestamp: 't', source: 'orchestrator' },
    });
    try {
      // CONTROL (evaluated): the legacy review is sent ISL's outcomes and its narrative is published, as today.
      const control = await run(withBrief(REQUEST));
      expect(mockOrchestrateCeeReview).toHaveBeenCalledTimes(1);
      const sent = mockOrchestrateCeeReview.mock.calls[0][1];
      expect(sent.inference_results.per_option_outcomes?.length).toBeGreaterThan(0);
      expect(control.cee_status).toBe('available');
      expect(JSON.stringify(control.insights)).toContain(NARRATIVE);
      expect(control.robustness_synthesis?.headline).toBe(NARRATIVE);

      // RED (unevaluated): never called; no narrative, no robustness synthesis; one #416 warning.
      mockOrchestrateCeeReview.mockClear();
      islOverride = { identity_evaluations: notEvaluated() };
      const body = await run(withBrief(inferredRequest()));
      expect(mockOrchestrateCeeReview).not.toHaveBeenCalled();
      expect(body.cee_status).toBe('skipped');
      for (const k of ['decision_quality', 'insights', 'improvement_guidance', 'rationale', 'robustness_synthesis']) {
        expect(body[k] ?? null, k).toBeNull();
      }
      expect(JSON.stringify(body)).not.toContain(NARRATIVE);
      expect(codes(body).filter((c) => c === WITHHELD)).toHaveLength(1);
    } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });

  // Finite E-values: W214's are all null, so this row puts two rows in ISL's own wire shape at robustness.edge_e_values —
  // copied from the real ISL staging capture (tests/fixtures/isl-v2-live-20260708/isl-staging-capture.json), with the
  // edge ids relabelled to two of W214's links. A shape discriminator for the gate, not a claim about W214's wire.
  const E_VALUES = [
    { edge_id: 'monthly_churn->pro_paying_subscribers', from_id: 'monthly_churn', to_id: 'pro_paying_subscribers', e_value: 3.6404, is_unflippable: false, flip_direction: 'increase', current_mean: -0.15, flip_mean: 0.436845 },
    { edge_id: 'monthly_new_pro_subscribers->pro_paying_subscribers', from_id: 'monthly_new_pro_subscribers', to_id: 'pro_paying_subscribers', e_value: 1.2228, is_unflippable: false, flip_direction: 'increase', current_mean: 0.1, flip_mean: 0.620287 },
  ];

  it('⭐ edge_e_values — how far a link must move to change the walk\'s winner: shown when evaluated, withheld when not (AIQ 5890824310)', async () => {
    islOverride = { robustness: { ...ISL_BODY.robustness, edge_e_values: E_VALUES } };
    const control = await run(REQUEST);
    expect(control.edge_e_values.map((e: any) => e.e_value)).toEqual([3.6404, 1.2228]);

    islOverride = { robustness: { ...ISL_BODY.robustness, edge_e_values: E_VALUES }, identity_evaluations: notEvaluated() };
    const body = await run(inferredRequest());
    expect(codes(body).filter((c) => c === WITHHELD)).toHaveLength(1);
    expect(body.edge_e_values).toEqual([]);
    expect(codes(body).filter((c) => /E_VALUE/.test(c))).toEqual([]);
  });

  it('⭐ conditional_winners — which option wins as a factor moves is the walk\'s: shown when evaluated, withheld when not', async () => {
    islOverride = { conditional_winners: CONDITIONAL_WINNERS };
    const control = await run(REQUEST);
    expect(control.conditional_winners.map((c: any) => c.factor_id)).toEqual(['pro_paying_subscribers']);

    islOverride = { conditional_winners: CONDITIONAL_WINNERS, identity_evaluations: notEvaluated() };
    const body = await run(inferredRequest());
    expect(codes(body).filter((c) => c === WITHHELD)).toHaveLength(1);
    expect(body.conditional_winners).toEqual([]);
  });

  const withBrief = (r: any) => ({ ...r, brief: 'Should we raise the Pro plan price to get MRR above £85k?' });
  const COACHING_KEPT = ['assumptions_ledger', 'coaching_version', 'computed_at', 'key_drivers', 'model_critiques', 'thresholds_used'];

  it('⭐ RED — the M2 review is skipped with its own reason, and coaching keeps only what makes no claim about the goal (AIQ 5889514782)', async () => {
    const control = await run(withBrief(REQUEST));
    // CONTROL: the review is attempted as today (CEE is not configured in this harness), coaching leads with the walk.
    expect(control.review_skip_reason).not.toBe('GOAL_FIGURES_WITHHELD');
    expect(control.m1_coaching.executive_summary?.summary).toMatch(/leads/);
    expect(control.m1_coaching.headline_type).toBeDefined();
    expect(control.confidence_tier).toBeDefined();

    // ONE carrier (AIQ 5889873087): the route decides the predicate once; the review path and the published figures
    // agree on the evaluated control (neither fires) and on the unevaluated case (both fire).
    expect(codes(control)).not.toContain(WITHHELD);
    expect(control.option_comparison.some((o: any) => typeof o.win_probability === 'number')).toBe(true);

    islOverride = { identity_evaluations: notEvaluated() };
    const body = await run(withBrief(inferredRequest()));
    expect(codes(body).filter((c) => c === WITHHELD)).toHaveLength(1);
    for (const o of body.option_comparison) expect('win_probability' in o, o.option_id).toBe(false);
    expect(body.review_status).toBe('skipped');
    expect(body.review_skip_reason).toBe('GOAL_FIGURES_WITHHELD');
    expect(body.m1_review ?? null).toBeNull();
    // Coaching: only the structural fields; no lead, no readiness, no next action, no evidence gap, no confidence tier.
    expect(Object.keys(body.m1_coaching).sort()).toEqual(COACHING_KEPT);
    expect('confidence_tier' in body).toBe(false);
    expect(body.m1_coaching.key_drivers).toEqual(control.m1_coaching.key_drivers);
    // The assumptions ledger lists inputs; the entries ISL flagged from the walk's bootstrap confidence go with the walk.
    const entries = (b: any) => JSON.stringify(b.m1_coaching.assumptions_ledger.assumptions);
    const fromWalk = (b: any) => (b.m1_coaching.assumptions_ledger.assumptions as any[]).filter((a) => a.source_service === 'isl_engine');
    const inputs = (b: any) => (b.m1_coaching.assumptions_ledger.assumptions as any[]).filter((a) => a.source_service !== 'isl_engine');
    expect(fromWalk(control).length).toBeGreaterThan(0);
    expect(fromWalk(body)).toEqual([]);
    expect(inputs(body)).toEqual(inputs(control));
    expect(entries(body)).not.toEqual(entries(control));
    // Nothing anywhere in the coaching names a chance of leading or a lead.
    expect(JSON.stringify(body.m1_coaching)).not.toMatch(/win probability|leads by|too close to call/i);
  });

  it("CONTROL — ISL's own answer (Paul's identity evaluated): every carrier ships, the goal's figures with it", async () => {
    const body = await run(REQUEST);
    expect(codes(body)).not.toContain(WITHHELD);
    expect(body.option_comparison.some((o: any) => typeof o.win_probability === 'number')).toBe(true);
    // ISL's figures, bound by identity to the captured answer.
    expect(body.p_win_sensitivity).toEqual(ISL_BODY.p_win_sensitivity);
    expect(body.factor_evppi).toEqual(ISL_BODY.factor_evppi);
    expect(body.decision_evpi).toBe(ISL_BODY.decision_evpi);
    expect(body.robustness).toMatchObject({ is_robust: ISL_BODY.robustness.is_robust, level: ISL_BODY.robustness.level, confidence: ISL_BODY.robustness.confidence });
    expect(body.robustness.robust_edges.length).toBe(ISL_BODY.robustness.robust_edges.length);
    expect(body.robustness.display_verdict).not.toBe('not_assessed');
    expect(body.flip_thresholds.length).toBeGreaterThan(0);
    expect(body.driver_order?.ranked_factor_ids?.length).toBeGreaterThan(0);
    expect(body.driver_order.rank_stability.max_rank_flip_rate).toEqual(expect.any(Number));
    expect(body.decision_brief?.top_drivers?.length).toBeGreaterThan(0);
    // R3 5889055195 — the goal's sensitivity to each factor / edge and the facts and cards built from it.
    expect(body.factor_sensitivity?.length).toBeGreaterThan(0);
    expect(body.edge_sensitivity.length).toBeGreaterThan(0);
    expect(body.factor_stability.length).toBeGreaterThan(0);
    const factTypes = new Set((body.fact_objects ?? []).map((f: any) => f.fact_type));
    for (const t of ['probability', 'factor_sensitivity', 'robustness']) expect(factTypes.has(t), t).toBe(true);
    expect((body.review_cards ?? []).map((c: any) => c.card_type)).toContain('evidence_priority');
  });

  it('⭐ RED — the identity inferred and ISL reports it evaluated:false: the same answer\'s six carriers are withheld, said once', async () => {
    islOverride = { identity_evaluations: notEvaluated() };
    const body = await run(inferredRequest());
    expect(body.analysis_status).not.toBe('blocked');
    // #417's precondition holds on this wire: the per-option figures are gone.
    expect(body.option_comparison.length).toBeGreaterThan(1);
    for (const o of body.option_comparison) expect('win_probability' in o, o.option_id).toBe(false);

    // Value of information: absent, not zero.
    for (const k of ['p_win_sensitivity', 'factor_evppi', 'decision_evpi']) expect(k in body, k).toBe(false);
    // Robustness: the always-present empty shape; no verdict-bearing fact, no leader's chance under another name.
    expect(body.robustness.fragile_edges).toEqual([]);
    expect(body.robustness.robust_edges).toEqual([]);
    for (const k of ['confidence', 'confidence_basis', 'is_robust', 'level', 'explanation', 'recommended_option_id']) {
      expect(k in body.robustness, `robustness.${k}`).toBe(false);
    }
    expect(body.robustness.display_verdict).toBe('not_assessed');
    // Tipping points: none.
    expect(body.flip_thresholds).toEqual([]);
    expect(body.flip_thresholds_status).toBe('unavailable');
    // The goal's sensitivity to each factor / edge, per-factor stability, and what is built from them (R3 5889055195).
    // (conditional_winners: this ISL answer carries none — its own discriminating row is below.)
    // R3 5889219876 — ONE RULE: withhold what the walk computed, keep what the structure computed. On this answer every
    // row's basis is ISL's STRUCTURAL influence (R3-5), so the driver order, each row's rank / score / elasticity /
    // direction / influence and the brief's drivers are the control's; each row loses the walk's quantities.
    islOverride = {};
    const control = await run(REQUEST);
    islOverride = { identity_evaluations: notEvaluated() };
    expect(control.driver_order.basis).toBe('isl_structural');
    // The structural order stays; its rank_stability (aggregated from the walk's row fields) takes "not measured".
    expect(control.driver_order.rank_stability.max_rank_flip_rate).toEqual(expect.any(Number));
    expect(body.driver_order).toEqual({ ...control.driver_order, rank_stability: { max_rank_flip_rate: null, min_attribution_stability: null } });
    // Each link's E-value is how far it must move to change the walk's winner (AIQ 5890824310): none, and no E-value
    // diagnostic about rows that are not published. (W214's 7 E-values are all null, so the control's published list is
    // empty too, with its non-finite-drop diagnostic — the discriminating row with finite E-values is below.)
    expect(codes(control)).toContain('EDGE_E_VALUE_NON_FINITE_DROPPED');
    expect(body.edge_e_values).toEqual([]);
    expect(codes(body).filter((c) => /E_VALUE/.test(c))).toEqual([]);
    expect(body.decision_brief?.top_drivers).toEqual(control.decision_brief?.top_drivers);
    const WALK = ['value_of_information', 'attribution_stability', 'rank_flip_rate', 'flip_risk_category', 'evpi_percentage_points', 'evpi_method'];
    const STRUCTURE = ['factor_id', 'influence_score', 'influence_rank', 'influence_basis', 'importance_basis', 'sensitivity_score', 'elasticity', 'importance_rank', 'direction'];
    expect(body.factor_sensitivity.length).toBe(control.factor_sensitivity.length);
    for (const c of control.factor_sensitivity) {
      const r = body.factor_sensitivity.find((f: any) => f.factor_id === c.factor_id);
      for (const k of STRUCTURE) expect(r?.[k], `${c.factor_id}.${k}`).toEqual(c[k]);
      for (const k of WALK) expect(k in r, `${c.factor_id}.${k}`).toBe(false);
      // confidence only where it is attested structural (graph); a bootstrap-blended confidence is the walk's.
      expect('confidence' in r, `${c.factor_id}.confidence`).toBe(c.confidence_source === 'plot_unified_from_graph');
    }
    // The walk-blended confidence is really present on the control (the row discriminates).
    expect(control.factor_sensitivity.some((f: any) => f.confidence_source === 'plot_unified_from_isl_bootstrap')).toBe(true);
    expect(control.factor_sensitivity.some((f: any) => typeof f.value_of_information === 'number' || typeof f.attribution_stability === 'string')).toBe(true);
    expect(body.edge_sensitivity).toEqual([]);
    expect(body.factor_stability).toEqual([]);
    expect(body.conditional_winners).toEqual([]);
    // No option, robustness or factor fact: a factor fact states the walk's stability and confidence, and the fact
    // mapper would default them ('moderate' / 0.5) rather than omit them.
    expect([...new Set((body.fact_objects ?? []).map((f: any) => f.fact_type))]).toEqual(['critique']);
    // The evidence-priority card ranks by the rows' elasticity — structural here — so it stays, as on the control.
    expect((body.review_cards ?? []).map((c: any) => c.card_type)).toEqual((control.review_cards ?? []).map((c: any) => c.card_type));
    expect((control.review_cards ?? []).map((c: any) => c.card_type)).toContain('evidence_priority');

    // ONE reason, #416's, naming the node — and no other warning appears because of the withhold.
    expect(codes(body).filter((c) => c === WITHHELD)).toHaveLength(1);
    expect(body.inference_warnings.find((w: any) => w.code === WITHHELD).node_ids).toEqual(['mrr']);
    islOverride = { identity_evaluations: [{ ...(notEvaluated()[0] as any), evaluated: true, withheld_reason: undefined }] };
    const evaluatedInferred = await run(inferredRequest());
    const added = codes(body).filter((c) => !codes(evaluatedInferred).includes(c));
    expect(added).toEqual([WITHHELD]);
  });
});
