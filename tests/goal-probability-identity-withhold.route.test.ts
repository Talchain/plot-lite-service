/**
 * ⛔ A CHANCE OF REACHING THE GOAL THAT THE MODEL DOES NOT SUPPORT IS WITHHELD, NOT SHOWN (AI Quality #72 5884802000;
 * DL 5884931550). Served scenario 401e0925 (CEE e4934e7): a declared product identity on the goal's path was not
 * evaluated, and every option still showed a `probability_of_goal` from the additive walk ("40% chance of a 15% cut").
 *
 * Route rows run the real /v2/run on Paul's own CEE→PLoT capture (`paul-own-a295e4a1-20260927`), ISL mocked exactly as
 * `r3-nonlinear-identity-carry.route.test.ts` does, with every option answering a `probability_of_goal`. The CONTROL is
 * Paul's evaluated MRR = price × subscribers: the chance stays. Pure rows pin the path rule.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { goalIdentitiesNotEvaluated, goalIdentityWithheldMessage } from '../src/lib/goal-identity-withhold.js';

/** Every ISL analysis body, in call order. THE WIRE. */
let islBodies: any[] = [];

/**
 * What the mocked ISL /analyze/v2 call answers next (R3 rung a, DL takeover): `extra` top-level
 * envelope keys merged into the computed body, or a typed `error` (the no-throw contract's shape —
 * a 422 carries ISL's structured critiques). `null` = the plain computed body (every earlier row).
 */
let islNext: null | { extra?: Record<string, unknown>; error?: Record<string, unknown> } = null;
/** Per-call answers, consumed first (variant (c): a 422, then the answer to the ONE retry); then `islNext`. */
let islSeq: Array<{ extra?: Record<string, unknown>; error?: Record<string, unknown> }> = [];

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
    // Every option carries a chance of reaching the goal, as ISL returns one when a target reached it.
    probability_of_goal: Math.max(0.05, 0.4 - idx * 0.1),
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
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: unknown }> {
    // A copy: PLoT may withdraw a declaration from the same request object before asking again (variant (c)).
    islBodies.push(structuredClone(body));
    const next = islSeq.length > 0 ? islSeq.shift()! : islNext;
    if (next?.error) {
      return { data: null, error: next.error, latency_ms: 5, isl_echoed_request_id: null } as any;
    }
    return {
      data: {
        options: optionResults(body.options || [], body.goal_constraints),
        edges: [], factors: [], value_of_information: [],
        overall_robustness: 'robust', robustness_score: 0.8,
        fragile_edges: [], robust_edges: [],
        ...(next?.extra ?? {}),
      } as T,
      error: null,
    };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';

const FIXTURE_DIR = resolve(__dirname, 'fixtures/paul-own-a295e4a1-20260927');
const PRODUCT = { operation: 'product', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'], stated_in_brief: true };
const INFERRED = { ...PRODUCT, stated_in_brief: false };

function paulRequest(identity?: unknown): any {
  const d = JSON.parse(readFileSync(resolve(FIXTURE_DIR, 'cee-to-plot.request.json'), 'utf8'));
  if (identity !== undefined) d.graph.nodes.find((n: any) => n.id === 'mrr').nonlinear_identity = identity;
  return d;
}

const evaluation = (evaluated: boolean, stated_in_brief = false) => ({
  node_id: 'mrr', operation: 'product', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'], stated_in_brief, evaluated,
  ...(evaluated ? { level_source: 'stated_level' } : { withheld_reason: 'identity_frame_missing' }),
});

const WITHHELD = 'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED';
const options = (body: any): any[] => body.results ?? body.option_comparison ?? [];
const warnings = (body: any): any[] => (body.inference_warnings ?? []).filter((w: any) => w.code === WITHHELD);

describe('route — the goal\'s chance is withheld when a declared identity on its path was not evaluated', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  async function post(payload: any) {
    islBodies = [];
    return fetch(`${baseUrl}/v2/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
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
  afterEach(() => { islNext = null; islSeq = []; });

  it('PRECONDITION: the harness answers a chance for every option, and with no identity it is shown on every option', async () => {
    const res = await post(paulRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(options(body).length).toBeGreaterThan(1);
    expect(options(body).every((o: any) => typeof o.probability_of_goal === 'number')).toBe(true);
    expect(warnings(body)).toEqual([]);
  });

  // The vehicle is the STATED product: under translator variant (d) (AIQ 5891286280) an INFERRED goal product never
  // reaches ISL, so "ISL reports it evaluated:false" can only be about a product the user stated or confirmed.
  it('⭐ RED — ISL reports the goal\'s identity evaluated:false: no option carries a chance, and the warning names the node', async () => {
    islNext = { extra: { identity_evaluations: [evaluation(false, true)] } };
    const res = await post(paulRequest(PRODUCT));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analysis_status).not.toBe('blocked');
    expect(options(body).length).toBeGreaterThan(1);
    expect(options(body).filter((o: any) => 'probability_of_goal' in o)).toEqual([]);
    const w = warnings(body);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ severity: 'warning', node_ids: ['mrr'] });
    // AI Quality's exact words (#72 5885033487 (2)): labels from the graph, no action asked of the user.
    expect(w[0].message).toBe("Not shown. 'MRR' depends on Pro plan price × Pro paying subscribers, but this run couldn't calculate it that way, so the figures for each option would be wrong.");
  });

  it('⭐ (d) — the goal\'s product INFERRED (Olumi\'s reading, unconfirmed): withheld, said as awaiting the user, never sent', async () => {
    const res = await post(paulRequest(INFERRED));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(options(body).filter((o: any) => 'probability_of_goal' in o)).toEqual([]);
    const w = warnings(body);
    expect(w.map((x: any) => x.node_ids)).toEqual([['mrr']]);
    expect(w[0].message).toBe("Not shown. Olumi reads 'MRR' as Pro plan price × Pro paying subscribers, but you haven't confirmed that, so the chance for each option isn't calculated yet.");
  });

  it('⭐ RED — declared, and ISL says nothing about it: silence is not evaluation, the chance is withheld', async () => {
    const res = await post(paulRequest(PRODUCT));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(options(body).filter((o: any) => 'probability_of_goal' in o)).toEqual([]);
    expect(warnings(body).map((w: any) => w.node_ids)).toEqual([['mrr']]);
  });

  it('CONTROL — Paul\'s evaluated MRR identity (evaluated:true): every option keeps its chance, nothing is said', async () => {
    islNext = { extra: { identity_evaluations: [evaluation(true)] } };
    const res = await post(paulRequest(PRODUCT));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(options(body).length).toBeGreaterThan(1);
    expect(options(body).every((o: any) => typeof o.probability_of_goal === 'number')).toBe(true);
    expect(warnings(body)).toEqual([]);
  });
});

describe('route — a LIMIT on an unevaluated identity\'s path is withheld too, and the joint follows (AIQ 5886183999)', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  const CHURN = 'agent-lane:monthly_churn:<=';
  async function post(payload: any) {
    islBodies = [];
    return fetch(`${baseUrl}/v2/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  }
  /** Paul's capture (its churn limit on `monthly_churn`), with an INFERRED product identity declared on `nodeId`. */
  function withIdentityOn(nodeId: string): any {
    const d = paulRequest();
    d.graph.nodes.find((n: any) => n.id === nodeId).nonlinear_identity = { operation: 'product', factor_ids: ['pro_plan_price', 'fac_existing_customers_grandfathered'], stated_in_brief: false };
    return d;
  }
  const evalOn = (nodeId: string, evaluated: boolean) => ({ ...evaluation(evaluated), node_id: nodeId, factor_ids: ['pro_plan_price', 'fac_existing_customers_grandfathered'] });
  const limitWarnings = (body: any): any[] => (body.inference_warnings ?? []).filter((w: any) => w.code === 'CONSTRAINT_IDENTITY_NOT_EVALUATED');
  const churnScoredEverywhere = (body: any) => options(body).every((o: any) => typeof o.constraint_probabilities?.[CHURN] === 'number');
  const churnScoredNowhere = (body: any) => options(body).every((o: any) => o.constraint_probabilities?.[CHURN] === undefined);

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  }, 60_000);
  afterAll(async () => { await app?.close(); });
  afterEach(() => { islNext = null; islSeq = []; });

  it('PRECONDITION: Paul\'s churn limit reaches ISL and is scored on every option, with a joint', async () => {
    const res = await post(paulRequest());
    const body = await res.json();
    expect(islBodies[0].goal_constraints.map((c: any) => c.constraint_id)).toContain(CHURN);
    expect(churnScoredEverywhere(body)).toBe(true);
    expect(options(body).every((o: any) => typeof o.probability_of_joint_goal === 'number')).toBe(true);
  });

  it('⭐ RED — the limit\'s target IS the unevaluated identity (churn): withheld on every option, joint withheld naming it, said with the node', async () => {
    islNext = { extra: { identity_evaluations: [evalOn('monthly_churn', false)] } };
    const res = await post(withIdentityOn('monthly_churn'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(churnScoredNowhere(body)).toBe(true);
    expect(options(body).filter((o: any) => 'probability_of_joint_goal' in o)).toEqual([]);
    expect(body.joint_withheld).toEqual({ reason: 'limit_unscored', constraint_ids: [CHURN] });
    expect((body.constraint_results ?? []).map((r: any) => r.constraint_id)).not.toContain(CHURN);
    const w = limitWarnings(body);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ severity: 'warning', constraint_ids: [CHURN], node_ids: ['monthly_churn'] });
    expect(w[0].message).toMatch(/^Not shown for the limit on 'Monthly churn'\. 'Monthly churn' depends on /);
    // Not mis-said as an unreliable target.
    expect((body.inference_warnings ?? []).filter((x: any) => x.code === 'CONSTRAINT_TARGET_UNRELIABLE')).toEqual([]);
  });

  it('⭐ RED — the limit\'s target is REACHED THROUGH the unevaluated identity (price sensitivity → churn): withheld', async () => {
    islNext = { extra: { identity_evaluations: [evalOn('price_sensitivity', false)] } };
    const body = await (await post(withIdentityOn('price_sensitivity'))).json();
    expect(churnScoredNowhere(body)).toBe(true);
    expect(limitWarnings(body).map((x: any) => [x.constraint_ids, x.node_ids])).toEqual([[[CHURN], ['price_sensitivity']]]);
  });

  it('CONTROL — an unevaluated identity that does NOT reach the limit (on the goal MRR, downstream of churn): the limit and joint keep theirs', async () => {
    islNext = { extra: { identity_evaluations: [evaluation(false)] } };
    const body = await (await post(paulRequest(INFERRED))).json();
    expect(churnScoredEverywhere(body)).toBe(true);
    expect(options(body).every((o: any) => typeof o.probability_of_joint_goal === 'number')).toBe(true);
    expect(limitWarnings(body)).toEqual([]);
    // …while the goal's own chance IS withheld (it rests on MRR).
    expect(options(body).filter((o: any) => 'probability_of_goal' in o)).toEqual([]);
  });

  it('CONTROL — the identity on churn EVALUATED: the limit and joint are scored, nothing said', async () => {
    islNext = { extra: { identity_evaluations: [evalOn('monthly_churn', true)] } };
    const body = await (await post(withIdentityOn('monthly_churn'))).json();
    expect(churnScoredEverywhere(body)).toBe(true);
    expect(body.joint_withheld).toBeUndefined();
    expect(limitWarnings(body)).toEqual([]);
  });
});

describe('pure — which identities the goal\'s chance would rest on', () => {
  const graph = {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Monthly cloud bill' },
      { id: 'savings', kind: 'outcome', label: 'Monthly reserved-instance savings', nonlinear_identity: { operation: 'product', factor_ids: ['a', 'b'], stated_in_brief: false } },
      { id: 'side', kind: 'outcome', label: 'Team morale', nonlinear_identity: { operation: 'product', factor_ids: ['a', 'b'], stated_in_brief: false } },
      { id: 'a', kind: 'factor', label: 'A' }, { id: 'b', kind: 'factor', label: 'B' }, { id: 'c', kind: 'factor', label: 'C' },
    ],
    edges: [{ from: 'a', to: 'savings' }, { from: 'b', to: 'savings' }, { from: 'savings', to: 'goal' }, { from: 'a', to: 'side' }],
  };
  it('an identity that reaches the goal and was not evaluated is named; one off the goal\'s path is not', () => {
    expect(goalIdentitiesNotEvaluated(graph, [], [])).toEqual([{ node_id: 'savings', label: 'Monthly reserved-instance savings', parts: ['A', 'B'], operation: 'product' }]);
  });
  it('evaluated:true clears it; evaluated:false does not', () => {
    const ev = (evaluated: boolean) => [{ node_id: 'savings', operation: 'product', factor_ids: ['a', 'b'], stated_in_brief: false, evaluated }] as any;
    expect(goalIdentitiesNotEvaluated(graph, ev(true), [])).toEqual([]);
    expect(goalIdentitiesNotEvaluated(graph, ev(false), []).map((n) => n.node_id)).toEqual(['savings']);
  });
  it('a withdrawn identity (identities_not_forwarded) counts even when the graph copy lost its declaration', () => {
    const g = { ...graph, nodes: graph.nodes.map((n) => (n.id === 'savings' ? { id: n.id, kind: n.kind, label: n.label } : n)) };
    expect(goalIdentitiesNotEvaluated(g, [], ['savings']).map((n) => n.node_id)).toEqual(['savings']);
  });
  it('the words: labels from the graph, "×" for a product, "+" for a sum, the first named and "(and N more)"', () => {
    const named = goalIdentitiesNotEvaluated(graph, [], []);
    expect(goalIdentityWithheldMessage(named)).toBe("Not shown. 'Monthly reserved-instance savings' depends on A × B, but this run couldn't calculate it that way, so the figures for each option would be wrong.");
    const two = [...named, { node_id: 'x', label: 'X', parts: ['P', 'Q'], operation: 'sum' as const }];
    expect(goalIdentityWithheldMessage(two)).toBe("Not shown. 'Monthly reserved-instance savings' depends on A × B (and 1 more), but this run couldn't calculate it that way, so the figures for each option would be wrong.");
    expect(goalIdentityWithheldMessage([{ node_id: 's', label: 'S', parts: ['P', 'Q'], operation: 'sum' }])).toMatch(/depends on P \+ Q,/);
  });
  it('an identity on the goal itself is on its path; no goal or no identity → nothing', () => {
    const g = { nodes: [{ id: 'mrr', kind: 'goal', label: 'MRR', nonlinear_identity: { operation: 'product', factor_ids: ['p', 'q'], stated_in_brief: true } }], edges: [] };
    expect(goalIdentitiesNotEvaluated(g, [], []).map((n) => n.node_id)).toEqual(['mrr']);
    expect(goalIdentitiesNotEvaluated({ nodes: graph.nodes.filter((n) => n.kind !== 'goal'), edges: graph.edges }, [], [])).toEqual([]);
    expect(goalIdentitiesNotEvaluated({ nodes: [{ id: 'goal', kind: 'goal' }], edges: [] }, [], [])).toEqual([]);
    expect(goalIdentitiesNotEvaluated(undefined, [], [])).toEqual([]);
  });
});
