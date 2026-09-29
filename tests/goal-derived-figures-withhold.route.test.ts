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
    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  }, 60_000);
  afterAll(async () => { await app?.close(); });
  afterEach(() => { islOverride = {}; });

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
    // Tipping points and the driver ranking: none, and the brief ranks no drivers.
    expect(body.flip_thresholds).toEqual([]);
    expect(body.flip_thresholds_status).toBe('unavailable');
    expect('driver_order' in body).toBe(false);
    expect(body.decision_brief?.top_drivers ?? []).toEqual([]);
    // The goal's sensitivity to each factor / edge, per-factor stability, and what is built from them (R3 5889055195).
    // (conditional_winners is withheld too; this ISL answer carries none, so no row here can discriminate it.)
    expect('factor_sensitivity' in body).toBe(false);
    expect(body.edge_sensitivity).toEqual([]);
    expect(body.factor_stability).toEqual([]);
    expect(body.conditional_winners).toEqual([]);
    expect([...new Set((body.fact_objects ?? []).map((f: any) => f.fact_type))]).toEqual(['critique']);
    expect((body.review_cards ?? []).map((c: any) => c.card_type)).not.toContain('evidence_priority');

    // ONE reason, #416's, naming the node — and no other warning appears because of the withhold.
    expect(codes(body).filter((c) => c === WITHHELD)).toHaveLength(1);
    expect(body.inference_warnings.find((w: any) => w.code === WITHHELD).node_ids).toEqual(['mrr']);
    islOverride = { identity_evaluations: [{ ...(notEvaluated()[0] as any), evaluated: true, withheld_reason: undefined }] };
    const evaluatedInferred = await run(inferredRequest());
    const added = codes(body).filter((c) => !codes(evaluatedInferred).includes(c));
    expect(added).toEqual([WITHHELD]);
  });
});
