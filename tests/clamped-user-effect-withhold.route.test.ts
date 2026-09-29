/**
 * ⛔ AI Quality #72 5893355501 — a USER-STATED link size the analysis cut to fit the model's scale withholds the goal
 * figures that rest on it (#419's one carrier); an Olumi estimate that was cut is said, and its figures kept.
 * Served Run c96fc4bb: the user's £49 per subscriber was written as strength 4.61, PLoT clamped it to 1, and every goal
 * figure shipped with no trace but `_meta.repairs_applied[].code: LEGACY_REPAIR` (R3-B 5893317255, measured at
 * da014a8). Rows on the real W214 ISL answer (tests/fixtures/r3b-goal-derived-withhold-20260929/): the link
 * `pro_paying_subscribers → mrr` is made user-stated here (`provenance.magnitude: 'user_stated'`, the shape a served
 * CEE graph carries) — a constructed row on a real answer, not a claim about W214's own wire.
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

const IDENTITY_WITHHELD = 'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED';
const CUT = 'GOAL_FIGURES_USER_EFFECT_CLAMPED';
const DISCLOSED = 'EDGE_STRENGTH_CLAMPED';
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


const LINK = (e: any) => e.from === 'pro_paying_subscribers' && e.to === 'mrr';
/** W214 with the goal-path link `Pro paying subscribers → MRR` sized as the user's own, at `mean`. */
function withUserLink(mean: number, extra: Record<string, unknown> = {}, magnitude = 'user_stated'): any {
  const d = structuredClone(REQUEST);
  const e = d.graph.edges.find(LINK);
  e.strength = { ...e.strength, mean, ...extra };
  e.provenance = { ...(e.provenance ?? {}), source: 'brief_extraction', magnitude };
  return d;
}
const GOAL_FIGURES = ['probability_of_goal', 'win_probability'] as const;

describe('route — a user-stated link size cut to the model\'s scale withholds the goal figures (AIQ 5893355501)', () => {
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
    process.env.DECISION_REVIEW_ENABLE = '1';
    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  }, 60_000);
  afterAll(async () => { await app?.close(); });
  afterEach(() => { islOverride = {}; });

  const withBrief = (r: any) => ({ ...r, brief: 'Should we raise the Pro plan price to get MRR above £85k?' });
  const clampRepair = (b: any) => (b._meta?.repairs_applied ?? []).find((r: any) => /pro_paying_subscribers/.test(String(r.field_path ?? r.field)) && /strength\.mean/.test(String(r.field_path ?? r.field)));

  it('CONTROL — the same user-stated link IN range: every goal figure ships, nothing is said', async () => {
    const body = await run(withUserLink(0.15));
    expect(body.option_comparison.length).toBeGreaterThan(0);
    for (const o of body.option_comparison) for (const k of GOAL_FIGURES) expect(typeof o[k], `${o.option_id}.${k}`).toBe('number');
    expect(codes(body)).not.toContain(CUT);
    expect(codes(body)).not.toContain(DISCLOSED);
    expect(clampRepair(body)).toBeUndefined();
  });

  it('⭐ RED — the user-stated link at 4.61 (cut to 1): no goal figure on any option, the cut said once in the user\'s terms, the typed code on the repair', async () => {
    const control = await run(withBrief(withUserLink(0.15)));
    const body = await run(withBrief(withUserLink(4.61)));
    for (const o of body.option_comparison) {
      for (const k of GOAL_FIGURES) expect(k in o, `${o.option_id}.${k}`).toBe(false);
      expect(o.outcome?.mean, `${o.option_id}.outcome.mean`).toBeUndefined();
      expect(o.outcome?.n_samples, `${o.option_id}.outcome.n_samples (not a claim about the goal)`).toEqual(expect.any(Number));
    }
    const said = (body.inference_warnings ?? []).filter((w: any) => w.code === CUT);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatchObject({ severity: 'warning', node_ids: ['pro_paying_subscribers', 'mrr'] });
    expect(said[0].message).toBe("Not shown. Your size for how ‘Pro paying subscribers’ moves ‘MRR’ is bigger than this model's scale can hold, so the run couldn't use it at full size, and the figures that depend on it would be wrong.");
    expect(codes(body)).not.toContain(IDENTITY_WITHHELD);
    // The typed code reaches `_meta` (it was LEGACY_REPAIR): the cut is named, with its before / after.
    expect(clampRepair(body)).toMatchObject({ code: 'CLAMP_STRENGTH_MEAN', before: 4.61, after: 1, severity: 'warn' });
    // The rest of #419's class follows the ONE carrier: flips, robustness, the coaching lead, the M2 review.
    expect(control.flip_thresholds.length).toBeGreaterThan(0);
    expect(body.flip_thresholds).toEqual([]);
    expect(body.robustness).toMatchObject({ fragile_edges: [], robust_edges: [], display_verdict: 'not_assessed' });
    expect(control.m1_coaching.headline_type).toBeDefined();
    expect('headline_type' in body.m1_coaching).toBe(false);
    expect(body.review_skip_reason).toBe('GOAL_FIGURES_WITHHELD');
  });

  it("an OLUMI estimate at 4.61 (cut to 1): figures kept, the cut said as Olumi's — disclosure only", async () => {
    const body = await run(withUserLink(4.61, {}, 'olumi_estimate'));
    for (const o of body.option_comparison) for (const k of GOAL_FIGURES) expect(typeof o[k], `${o.option_id}.${k}`).toBe('number');
    expect(codes(body)).not.toContain(CUT);
    const said = (body.inference_warnings ?? []).filter((w: any) => w.code === DISCLOSED);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatchObject({ severity: 'info', node_ids: ['pro_paying_subscribers', 'mrr'] });
    expect(said[0].message).toBe("Olumi's estimate for ‘Pro paying subscribers’ → ‘MRR’ was capped at the model's limit.");
    expect(clampRepair(body)).toMatchObject({ code: 'CLAMP_STRENGTH_MEAN', before: 4.61, after: 1 });
  });

  it("the producer's marker alone (a stored ±1 that remembers the user's 4.61) withholds the same way", async () => {
    const body = await run(withUserLink(1, { clamped_from: 4.6117647 }));
    for (const o of body.option_comparison) for (const k of GOAL_FIGURES) expect(k in o, `${o.option_id}.${k}`).toBe(false);
    expect(codes(body).filter((c) => c === CUT)).toHaveLength(1);
    // Nothing was cut in THIS run (the stored mean is in range): no repair, but the figures still rest on the cut size.
    expect(clampRepair(body)).toBeUndefined();
  });
});
