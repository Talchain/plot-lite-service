/**
 * ⛔ THE GOAL'S PER-OPTION FIGURES FROM AN UNEVALUATED IDENTITY'S WALK ARE WITHHELD, NOT SHOWN (AI Quality #72
 * 5886183999 follow-up to PLoT #416; R3-B census 5886351619).
 *
 * #416 withholds `probability_of_goal` when a declared identity on the goal's path was not evaluated. The same walk
 * produces each option's chance of leading (`win_probability`), the outcome's centre and spread (`outcome.mean/std/
 * p10/p50/p90`) and `downside`, so they are withheld too, on every option, by the SAME predicate
 * (`goalIdentitiesNotEvaluated`). The sample counts stay. `decision_brief.options[]` and its leader are built from the
 * published list, so they follow. ONE warning (#416's code and words) says why.
 *
 * Same harness as `goal-probability-identity-withhold.route.test.ts` (Paul's own capture, ISL mocked), with the mock
 * also answering a win probability and a downside per option. CONTROL: Paul's evaluated MRR identity keeps them all.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
    // Every option carries a chance of leading, a chance of reaching the goal and a downside, as ISL returns them.
    win_probability: Math.max(0.05, 0.6 - idx * 0.2),
    probability_of_goal: Math.max(0.05, 0.4 - idx * 0.1),
    downside: { cvar_10: 0.42, p05: 0.45, expected_regret: 0.03 },
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

const evaluation = (evaluated: boolean) => ({
  node_id: 'mrr', operation: 'product', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'], stated_in_brief: false, evaluated,
  ...(evaluated ? { level_source: 'stated_level' } : { withheld_reason: 'identity_frame_missing' }),
});

const WITHHELD = 'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED';
const options = (body: any): any[] => body.results ?? body.option_comparison ?? [];
const warnings = (body: any): any[] => (body.inference_warnings ?? []).filter((w: any) => w.code === WITHHELD);

const FIGURES = ['mean', 'std', 'p10', 'p50', 'p90'] as const;

describe("route — the goal's per-option figures are withheld with P(goal) when its identity was not evaluated", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  async function run(payload: any) {
    islBodies = [];
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
  afterEach(() => { islNext = null; islSeq = []; });

  function expectShown(body: any) {
    const rows = options(body);
    expect(rows.length).toBeGreaterThan(1);
    for (const o of rows) {
      expect(typeof o.win_probability, o.option_id).toBe('number');
      for (const k of FIGURES) expect(typeof o.outcome?.[k], `${o.option_id}.outcome.${k}`).toBe('number');
      expect(o.downside, o.option_id).toBeDefined();
    }
    expect(body.decision_brief?.options?.length).toBe(rows.length);
  }

  function expectWithheld(body: any) {
    const rows = options(body);
    expect(body.analysis_status).not.toBe('blocked');
    expect(rows.length).toBeGreaterThan(1);
    for (const o of rows) {
      expect('win_probability' in o, o.option_id).toBe(false);
      expect('probability_of_goal' in o, o.option_id).toBe(false);
      expect('downside' in o, o.option_id).toBe(false);
      for (const k of FIGURES) expect(o.outcome !== undefined && k in o.outcome, `${o.option_id}.outcome.${k}`).toBe(false);
      // The sample counts are not claims about the goal: they stay.
      expect(o.outcome?.n_samples, o.option_id).toBe(1000);
    }
    // The brief ranks by the published chance of leading: no ranking.
    expect(body.decision_brief?.options ?? []).toEqual([]);
    // ONE warning, #416's code and words, naming the node.
    const w = warnings(body);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ severity: 'warning', node_ids: ['mrr'] });
  }

  it('PRECONDITION: with no identity every option carries its figures, and the brief ranks them', async () => {
    const body = await run(paulRequest());
    expectShown(body);
    expect(warnings(body)).toEqual([]);
  });

  it('⭐ RED — ISL reports the identity evaluated:false: every per-option figure is withheld, and said once', async () => {
    islNext = { extra: { identity_evaluations: [evaluation(false)] } };
    expectWithheld(await run(paulRequest(INFERRED)));
  });

  it('⭐ RED — declared, and ISL says nothing about it: silence is not evaluation, the figures are withheld', async () => {
    expectWithheld(await run(paulRequest(PRODUCT)));
  });

  it("CONTROL — Paul's evaluated MRR identity (evaluated:true): every option keeps its figures, nothing is said", async () => {
    islNext = { extra: { identity_evaluations: [evaluation(true)] } };
    const body = await run(paulRequest(PRODUCT));
    expectShown(body);
    expect(warnings(body)).toEqual([]);
  });
});
