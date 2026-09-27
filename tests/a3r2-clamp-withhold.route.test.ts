/**
 * A3 ROUND 2 — A CLAMPED VALUE IS NEVER ANALYSED AS IF IT WERE THE STATED ONE,
 * ASSERTED ON THE ISL WIRE. Ruling: AIQ olumi-programme-docs#70 5855192170.
 *
 * POSTs to the REAL `/v2/run` route with ISL mocked (the harness of
 * `intervention-frame-rung.route.test.ts`) and reads what the translator
 * handed ISL, plus the response a consumer reads.
 *
 * Fixtures (captured, not authored):
 *   - `fixtures/paul-17d1cd3a-20260927/cee-to-plot.request.json` — the REAL
 *     CEE→PLoT body for Paul's first export 17d1cd3a (CEE 263dbd5's run loader
 *     + run_analysis handler, fake PLoT client; MG replay 27 Sep).
 *   - `…/CAPTURED-1f6ad52.plot-to-isl.request.json` — what PLoT 1f6ad52 then
 *     handed a real local ISL (capture proxy), hash-bound to staging's
 *     `downstream_calls.isl[0].payload_hash` 8e8cd6c14cb7.
 *   - `fixtures/paul-own-a295e4a1-20260927/cee-to-plot.request.json` — Paul's
 *     later graph (A3 round 1's fixture).
 *
 * The rows that ADD a factor or an option say so; every assertion binds by
 * `option_id` / `constraint_id`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Every ISL analysis body, in call order. THE WIRE. */
let islBodies: any[] = [];

function echoConstraintAnalysis(goalConstraints: any[] | undefined) {
  if (!goalConstraints || goalConstraints.length === 0) return undefined;
  return {
    constraints: goalConstraints.map((c: any) => ({
      constraint_id: c.constraint_id,
      node_id: c.node_id,
      operator: c.operator,
      value: c.value,
      prob_satisfied: 0.8,
      failure_margin_median: 0.01,
      near_miss_fraction: 0.1,
      binding: false,
    })),
    joint_probability: 0.8,
    conditional_probabilities: null,
  };
}

function optionResults(options: any[], goalConstraints?: any[]) {
  const ca = echoConstraintAnalysis(goalConstraints);
  return options.map((opt: any, idx: number) => ({
    option_id: opt.id,
    outcome: {
      mean: 0.6 + idx * 0.01, std: 0.1, p10: 0.5, p50: 0.6, p90: 0.7,
      n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0,
    },
    rank: idx + 1,
    ...(ca && { constraint_analysis: ca }),
  }));
}

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
  async analyseRobustness(graph: any, goalNodeId: string, options: any[], _t?: any, constraints?: any[]) {
    islBodies.push({ graph, goal_node_id: goalNodeId, options, goal_constraints: constraints ?? [] });
    return {
      options: optionResults(options, constraints),
      edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factors: [], value_of_information: [], factors_provenance: 'unavailable' as const,
      factor_sensitivity_status: 'skipped_no_factor_values' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.8,
      fragile_edges: [], robust_edges: [], latency_ms: 50, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return {
      factors: [], value_of_information: [], robustness_label: 'robust' as const,
      robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const,
    };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    islBodies.push(body);
    return {
      data: {
        options: optionResults(body.options || [], body.goal_constraints),
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

import { createServer } from '../src/createServer.js';

const DIR_17D1 = resolve(__dirname, 'fixtures/paul-17d1cd3a-20260927');
const DIR_A295 = resolve(__dirname, 'fixtures/paul-own-a295e4a1-20260927');
const CHURN_LIMIT = 'agent-lane:monthly_churn:<=';
const PRICE_LIMIT = 'a3r2:pro_plan_price:<=';

function read(dir: string, name: string): any {
  return JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
}

const body17d1 = (): any => read(DIR_17D1, 'cee-to-plot.request.json');
const captured17d1 = (): any => read(DIR_17D1, 'CAPTURED-1f6ad52.plot-to-isl.request.json');
const bodyA295 = (): any => read(DIR_A295, 'cee-to-plot.request.json');

/** Every recorded ISL call's option ids (all calls must agree). */
function wireOptionIds(): string[][] {
  expect(islBodies.length, 'ISL must have been called').toBeGreaterThan(0);
  return islBodies.map((b) => (b.options ?? []).map((o: any) => o.id));
}

function wireOption(optionId: string): any[] {
  expect(islBodies.length, 'ISL must have been called').toBeGreaterThan(0);
  return islBodies.map((b) => (b.options ?? []).find((o: any) => o.id === optionId));
}

function wireConstraint(id: string): any[] {
  expect(islBodies.length, 'ISL must have been called').toBeGreaterThan(0);
  return islBodies.map((b) => (b.goal_constraints ?? []).find((c: any) => c.constraint_id === id));
}

/** ADDED to a captured body: an unframed factor (level only, no cap / frame / pair) feeding the goal. */
function addUnframedFactor(req: any, id: string, level: number): void {
  req.graph.nodes.push({ id, kind: 'factor', label: id, observed_state: { value: level }, category: 'controllable' });
  req.graph.edges.push({
    from: id, to: 'mrr', strength: { mean: 0.2, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive',
  });
}

function addOption(req: any, id: string, interventions: Record<string, number>): void {
  req.options.push({ id, option_id: id, label: id, interventions, is_baseline: false });
}

describe('A3 round 2 — the route withholds what would be clamped', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  async function post(payload: any): Promise<{ status: number; body: any }> {
    islBodies = [];
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json() };
  }

  async function run(payload: any): Promise<any> {
    const { status, body } = await post(payload);
    expect(status, JSON.stringify(body).slice(0, 600)).toBe(200);
    return body;
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

  // ===========================================================================
  // THE CORRECTED PREMISE — 17d1's churn limit reaches ISL as 0.04, unchanged
  // ===========================================================================
  it("17d1 (captured body) — the churn limit reaches ISL byte-identical to PLoT 1f6ad52's captured wire (0.04), and nothing is withheld", async () => {
    const body = await run(body17d1());
    const then = captured17d1().goal_constraints.find((c: any) => c.constraint_id === CHURN_LIMIT);
    expect(then.value, 'precondition: the captured wire').toBe(0.04);
    for (const now of wireConstraint(CHURN_LIMIT)) {
      expect(JSON.stringify(now)).toBe(JSON.stringify(then));
    }
    for (const opt of captured17d1().options) {
      for (const now of wireOption(opt.id)) expect(JSON.stringify(now?.interventions), opt.id).toBe(JSON.stringify(opt.interventions));
    }
    expect(body._meta?.withheld_options).toBeUndefined();
    expect(body._meta?.filtered_constraints).toBeUndefined();
  });

  // ===========================================================================
  // RULE 3 — a '%' threshold that would clamp is refused, never scored
  // ===========================================================================
  function clampedChurnLimitWithPriceSibling(): any {
    const req = body17d1();
    const churn = req.goal_constraints.find((c: any) => c.constraint_id === CHURN_LIMIT);
    churn.value = 150; // 150 '%' on the [0,100] '%' scale ⇒ pins to 1
    churn.provenance_unit_relabelled.pre_normalisation_value = 150;
    // ADDED sibling limit that normalises in range (price cap 200 ⇒ 60 → 0.3),
    // so ISL still returns a joint for the refusal to be kept out of.
    req.goal_constraints.push({
      constraint_id: PRICE_LIMIT, node_id: 'pro_plan_price', operator: '<=', value: 60,
      label: 'Pro plan price', provenance: 'explicit', value_frame: 'level',
    });
    req.graph.goal_constraints = structuredClone(req.goal_constraints);
    return req;
  }

  it("RED→GREEN — a '%' churn limit that would clamp (150 %) is refused with threshold_clamped: not sent, no P, no joint", async () => {
    const body = await run(clampedChurnLimitWithPriceSibling());
    // Not sent: it cannot feed ISL's joint.
    for (const c of wireConstraint(CHURN_LIMIT)) expect(c, 'the clamped limit must not reach ISL').toBeUndefined();
    // The sibling is still scored.
    for (const c of wireConstraint(PRICE_LIMIT)) expect(c?.value).toBe(0.3);
    // Disclosed by name with its typed cause.
    expect((body._meta?.filtered_constraints ?? []).filter((r: any) => r.constraint_id === CHURN_LIMIT)).toEqual([
      { constraint_id: CHURN_LIMIT, node_id: 'monthly_churn', reason: 'threshold_clamped' },
    ]);
    const refusal = (body.critiques ?? [])
      .find((c: any) => c.code === 'CONSTRAINT_REFUSED_FRAME_FIDELITY' && String(c.message).includes(CHURN_LIMIT));
    expect(refusal, 'a frame-fidelity critique names the refused limit').toBeDefined();
    // No P for it, on any option; and the joint over "all your limits" is withheld.
    const oc = body.option_comparison ?? [];
    expect(oc.length).toBeGreaterThan(0);
    for (const o of oc) {
      expect(o.constraint_probabilities?.[CHURN_LIMIT], o.option_id).toBeUndefined();
      expect(o.probability_of_joint_goal, o.option_id).toBeUndefined();
    }
    for (const c of body.constraint_results ?? []) expect(c.constraint_id).not.toBe(CHURN_LIMIT);
  });

  it('CONTRAST — the same shape with the churn limit in range (4 %): both limits reach ISL, and the joint is delivered', async () => {
    const req = clampedChurnLimitWithPriceSibling();
    const churn = req.goal_constraints.find((c: any) => c.constraint_id === CHURN_LIMIT);
    churn.value = 4;
    churn.provenance_unit_relabelled.pre_normalisation_value = 4;
    req.graph.goal_constraints = structuredClone(req.goal_constraints);
    const body = await run(req);
    for (const c of wireConstraint(CHURN_LIMIT)) expect(c?.value).toBe(0.04);
    for (const c of wireConstraint(PRICE_LIMIT)) expect(c?.value).toBe(0.3);
    expect(body._meta?.filtered_constraints).toBeUndefined();
    const oc = body.option_comparison ?? [];
    expect(oc.length).toBeGreaterThan(0);
    for (const o of oc) expect(o.probability_of_joint_goal, o.option_id).toBe(0.8);
  });

  // ===========================================================================
  // RULE 1/2 — an option whose stated level would clamp is withheld
  // ===========================================================================
  it('RED→GREEN — an unframed factor at 3 with one option at 10: that option is withheld (intervention_clamped), no share, not on the wire', async () => {
    const req = body17d1();
    addUnframedFactor(req, 'sales_hires', 3);
    addOption(req, 'hire10', { sales_hires: 10 });
    const body = await run(req);
    for (const ids of wireOptionIds()) {
      expect(ids).not.toContain('hire10');
      expect(ids).toEqual(['keep_current_49_price', 'increase_price_to_59', 'increase_price_to_54']);
    }
    expect(body._meta?.withheld_options).toEqual([
      { option_id: 'hire10', reason: 'intervention_clamped', factor_id: 'sales_hires', stated: 10, applied: 6 },
    ]);
    // No share, mean gap or rank.
    expect((body.option_comparison ?? []).map((o: any) => o.option_id)).not.toContain('hire10');
    expect(body.option_comparison?.length).toBe(3);
    // The repair stays as the evidence.
    expect((body._meta?.repairs_applied ?? []).filter((r: any) => r.action === 'clamped')).toEqual([
      expect.objectContaining({
        field: 'intervention.value.sales_hires', action: 'clamped', from_value: 10, to_value: 1, option_id: 'hire10',
      }),
    ]);
    const warning = (body.critiques ?? []).find((c: any) => c.code === 'INTERVENTION_CLAMPED');
    expect(warning, 'a typed warning names the withheld option').toMatchObject({
      severity: 'warning', affected_option_ids: ['hire10'], affected_node_ids: ['sales_hires'],
    });
  });

  it('CONTRAST — the same at 5 (≤ 6): analysed at 5/6 on the wire, and the range is disclosed as Olumi\'s (inferred_value)', async () => {
    const req = body17d1();
    addUnframedFactor(req, 'sales_hires', 3);
    addOption(req, 'hire5', { sales_hires: 5 });
    const body = await run(req);
    for (const o of wireOption('hire5')) {
      const iv = o?.interventions?.sales_hires;
      expect(typeof iv === 'number' ? iv : iv?.value).toBeCloseTo(5 / 6, 12);
    }
    expect((body.option_comparison ?? []).map((o: any) => o.option_id)).toContain('hire5');
    expect(body._meta?.withheld_options).toBeUndefined();
    expect(body._meta?.range_derivation_sources?.sales_hires).toBe('inferred_value');
    expect((body.critiques ?? []).find((c: any) => c.code === 'INTERVENTION_CLAMPED')).toBeUndefined();
  });

  it('a withheld option does not contaminate the survivors: their wire is identical to a request that never contained it', async () => {
    // ADDED: an unframed spend factor two price options set (20, 30) and the
    // withheld option sets to 200 — widening the spend spread if it counted.
    const make = (withWithheld: boolean): any => {
      const req = body17d1();
      addUnframedFactor(req, 'sales_hires', 3);
      addUnframedFactor(req, 'ad_spend', 0.5);
      req.options.find((o: any) => o.id === 'keep_current_49_price').interventions.ad_spend = 20;
      req.options.find((o: any) => o.id === 'increase_price_to_59').interventions.ad_spend = 30;
      if (withWithheld) addOption(req, 'hire10', { sales_hires: 10, ad_spend: 200 });
      return req;
    };
    const withBody = await run(make(true));
    const withWire = islBodies.map((b) => JSON.stringify(b.options));
    expect(withBody._meta?.withheld_options?.map((r: any) => r.option_id)).toEqual(['hire10']);
    await run(make(false));
    const withoutWire = islBodies.map((b) => JSON.stringify(b.options));
    expect(withWire).toEqual(withoutWire);
  });

  it('CASCADE — a survivor whose level fits only the withheld option\'s spread is withheld in turn (re-normalised until nothing clamps)', async () => {
    // ADDED: `staff` (unframed, level 1) is set by 'grow' (5) and by 'hire_big'
    // (20). With both, the staff spread is [2, 23] and 5 fits. 'hire_big' is
    // withheld on its OWN clamp (sales_hires 100 on [0, 6]); without it, 5 is
    // the only staff level, the range is Olumi's [0, 2], and 5 would clamp.
    const req = body17d1();
    addUnframedFactor(req, 'sales_hires', 3);
    addUnframedFactor(req, 'staff', 1);
    addOption(req, 'hire_big', { sales_hires: 100, staff: 20 });
    addOption(req, 'grow', { staff: 5 });
    const body = await run(req);
    expect(body._meta?.withheld_options).toEqual([
      { option_id: 'hire_big', reason: 'intervention_clamped', factor_id: 'sales_hires', stated: 100, applied: 6 },
      { option_id: 'grow', reason: 'intervention_clamped', factor_id: 'staff', stated: 5, applied: 2 },
    ]);
    for (const ids of wireOptionIds()) {
      expect(ids).toEqual(['keep_current_49_price', 'increase_price_to_59', 'increase_price_to_54']);
    }
    expect((body._meta?.repairs_applied ?? []).filter((r: any) => r.action === 'clamped').map((r: any) => r.option_id)).toEqual(['hire_big', 'grow']);
  });

  it('every option clamped ⇒ the run is refused with a typed reason (INTERVENTION_CLAMPED_NO_COMPARISON)', async () => {
    const req = body17d1();
    addUnframedFactor(req, 'sales_hires', 3);
    addUnframedFactor(req, 'support_hires', 2);
    req.options = [];
    addOption(req, 'hire10', { sales_hires: 10 });
    addOption(req, 'support12', { support_hires: 12 });
    const { status, body } = await post(req);
    expect(status).toBe(422);
    expect(islBodies).toEqual([]);
    const all = JSON.stringify(body);
    expect(all).toContain('INTERVENTION_CLAMPED_NO_COMPARISON');
    const blocker = (body.critiques ?? [])
      .find((c: any) => c.code === 'INTERVENTION_CLAMPED_NO_COMPARISON');
    expect(blocker).toMatchObject({ severity: 'blocker', blocks_analysis: true });
    expect([...blocker.affected_option_ids].sort()).toEqual(['hire10', 'support12']);
  });

  // ===========================================================================
  // PAUL'S OWN GRAPH (a295e4a1) — nothing clamps, nothing is withheld
  // ===========================================================================
  it("Paul's a295e4a1: retention 0.025 / conversion 0.09 reach ISL, every option is sent, none withheld", async () => {
    const req = bodyA295();
    const body = await run(req);
    // '146aa89d' sets the same price as 'increase_price_to_59', so the EXISTING
    // dedupe precedent (IDENTICAL_OPTIONS_DEDUPED) drops it before ISL — at base
    // and now. Every other option is sent.
    const dedupe = (body.critiques ?? []).find((c: any) => c.code === 'IDENTICAL_OPTIONS_DEDUPED');
    expect(dedupe?.affected_option_ids).toEqual(['increase_price_to_59', '146aa89d']);
    const ids = req.options.map((o: any) => o.id).filter((id: string) => id !== '146aa89d');
    for (const sent of wireOptionIds()) expect(sent).toEqual(ids);
    for (const o of wireOption('ca47b368')) expect(o.interventions.monthly_churn).toBe(0.025);
    for (const o of wireOption('6dbac00d')) expect(o.interventions.monthly_new_pro_subscribers).toBe(0.09);
    expect(body._meta?.withheld_options).toBeUndefined();
  });
});
