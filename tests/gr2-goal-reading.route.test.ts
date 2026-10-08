import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const FACTORS = ['pro_plan_price', 'pro_paying_subscribers'];
const PRODUCT = { operation: 'product', factor_ids: FACTORS, addends: ['churn_loss'], stated_in_brief: false };
const LICENSED = { ...PRODUCT, reading_licence: 'olumi_reading' };
const WITHHELD = 'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED';
let islBodies: any[] = [];
let nextEvaluation: boolean | undefined;
let rejectFirst = false;
const reconciliation = { reconstructed: 13700, stated: 30000, mismatch_share: 16300 / 30000 };

const mockISLService = {
  isEnabled: () => true,
  isAvailable: async () => true,
  async callAnalysisEndpoint(_endpoint: string, request: any) {
    islBodies.push(structuredClone(request));
    if (rejectFirst && islBodies.length === 1) {
      return {
        data: null,
        error: {
          code: 'ISL_REJECTED', message: 'Validation failed', retryable: false, status: 422,
          critiques: [{
            id: 'mrr-inconsistent', code: 'IDENTITY_NOT_EVALUATED', severity: 'blocker', source: 'validation',
            message: 'MRR identity is inconsistent', suggestion: 'Correct the stated level',
            affected_node_ids: ['mrr', ...FACTORS, 'churn_loss'],
            identity: { node_id: 'mrr', operation: 'product', participants: [...FACTORS, 'churn_loss'], withheld_reason: 'identity_inconsistent', ...reconciliation },
          }],
        },
        latency_ms: 5, isl_echoed_request_id: null,
      };
    }
    return {
      error: null,
      data: {
        options: request.options.map((option: any, index: number) => ({
          option_id: option.id, rank: index + 1, probability_of_goal: index === 0 ? 0.4 : 0.3,
          win_probability: index === 0 ? 0.7 : 0.3,
          downside: { cvar_10: 0.42, p05: 0.45, expected_regret: 0.03 },
          outcome: { mean: 0.6, std: 0.1, p10: 0.5, p50: 0.6, p90: 0.7, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1 },
        })),
        edges: [], factors: [], value_of_information: [],
        overall_robustness: 'robust', robustness_score: 0.8, fragile_edges: [], robust_edges: [],
        ...(nextEvaluation !== undefined ? { identity_evaluations: [{
          node_id: 'mrr', ...PRODUCT, evaluated: nextEvaluation,
          ...(nextEvaluation ? { level_source: 'identity_inputs' } : { withheld_reason: 'identity_inconsistent' }),
        }] } : {}),
      },
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust', robustness_score: 0.8, latency_ms: 0, source: 'unavailable' };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';

function paulRequest(identity: unknown = LICENSED): any {
  const edge = (from: string, mean = 0.5) => ({ from, to: 'mrr', strength: { mean, std: 0.1 }, exists_probability: 1, provenance: { source: 'user_assumption' } });
  return {
    graph: {
      nodes: [
        { id: 'mrr', kind: 'goal', label: 'MRR', goal_threshold: 0.8, goal_threshold_raw: 20000, goal_threshold_unit: 'GBP/month', goal_threshold_frame: 'level', goal_threshold_cap: 25000, goal_horizon_months: 12, ...(identity ? { nonlinear_identity: identity } : {}) },
        { id: 'pro_plan_price', kind: 'factor', label: 'Pro plan price', observed_state: { value: 0.245, raw_value: 49, cap: 200, unit: 'GBP/month', source: 'brief_extraction' } },
        { id: 'pro_paying_subscribers', kind: 'factor', label: 'Pro paying subscribers', scale_frame: 2000, observed_state: { value: 0.15, raw_value: 300, unit: 'subscribers', source: 'cee_inference' } },
        { id: 'churn_loss', kind: 'risk', label: 'MRR lost to price-driven churn', observed_state: { value: -0.04, raw_value: -1000, cap: 25000, unit: 'GBP/month', source: 'cee_inference' } },
      ],
      edges: [edge('pro_plan_price'), edge('pro_paying_subscribers'), edge('churn_loss', -0.8)],
    },
    options: [
      { id: 'raise_59', label: 'Raise to £59', interventions: { pro_plan_price: 59 } },
      { id: 'hold_49', label: 'Hold at £49', interventions: { pro_plan_price: 49 }, is_baseline: true },
    ],
    goal_node_id: 'mrr', goal_threshold: 0.8, request_id: 'gr2-paul-mrr', n_samples: 1000,
  };
}

const options = (body: any): any[] => body.results ?? body.option_comparison ?? [];
const withholdWarnings = (body: any): any[] => (body.inference_warnings ?? []).filter((warning: any) => warning.code === WITHHELD);
const islGoal = (index = 0) => islBodies[index].graph.nodes.find((node: any) => node.id === 'mrr');
function expectWithheld(body: any): void {
  expect(options(body)).toHaveLength(2);
  for (const key of ['probability_of_goal', 'win_probability', 'downside']) {
    expect(options(body).every((option) => !Object.hasOwn(option, key)), `${key} must be withheld`).toBe(true);
  }
  expect(withholdWarnings(body).map((warning) => ({ code: warning.code, node_ids: warning.node_ids }))).toEqual([{ code: WITHHELD, node_ids: ['mrr'] }]);
}

describe('GR2 route — the licensed Paul MRR reading reaches ISL and evaluated chance survives', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app?.close(); });
  beforeEach(() => { islBodies = []; nextEvaluation = undefined; rejectFirst = false; });
  async function post(payload: any = paulRequest()): Promise<any> {
    const response = await app.inject({ method: 'POST', url: '/v2/run', payload });
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  }

  it('precondition: every option has its exact mocked chance with no identity or placeholder gate', async () => {
    const body = await post(paulRequest(null));
    expect(options(body).map((option) => [option.option_id, option.probability_of_goal])).toEqual([['raise_59', 0.4], ['hold_49', 0.3]]);
    expect(options(body).every((option) => Object.hasOwn(option, 'win_probability') && Object.hasOwn(option, 'downside'))).toBe(true);
    expect(withholdWarnings(body)).toEqual([]);
  });

  it('L1/L5/L6: licensed evaluated:true sends exact product/addend without licence and keeps every chance', async () => {
    nextEvaluation = true;
    const body = await post();
    expect(islBodies).toHaveLength(1);
    expect(islGoal().nonlinear_identity).toEqual(PRODUCT);
    expect(JSON.stringify(islBodies[0])).not.toContain('reading_licence');
    expect(Object.fromEntries(islBodies[0].graph.nodes.map((node: any) => [node.id, node.execution_frame]))).toEqual({
      mrr: { frame: 25000, carrier: 'cap' },
      pro_plan_price: { frame: 200, carrier: 'cap' },
      pro_paying_subscribers: { frame: 2000, carrier: 'scale_frame' },
      churn_loss: { frame: 25000, carrier: 'cap' },
    });
    expect(options(body).map((option) => [option.option_id, option.probability_of_goal])).toEqual([['raise_59', 0.4], ['hold_49', 0.3]]);
    expect(withholdWarnings(body)).toEqual([]);
    expect(body._meta?.identities_not_forwarded ?? []).toEqual([]);
    expect(body.identity_evaluations).toEqual([{ node_id: 'mrr', ...PRODUCT, evaluated: true, level_source: 'identity_inputs' }]);
  });

  it.each([undefined, false])('L5: licensed ISL evaluation %j withholds exact mrr code', async (evaluated) => {
    nextEvaluation = evaluated;
    const body = await post();
    expect(islGoal().nonlinear_identity).toEqual(PRODUCT);
    expectWithheld(body);
  });

  it('CTRL-T1b (DL): a CONFIRMED identity (stated_in_brief:true, no licence) is forwarded as today and keeps every chance', async () => {
    nextEvaluation = true;
    const STATED = { ...PRODUCT, stated_in_brief: true };
    const body = await post(paulRequest(STATED));
    expect(islGoal().nonlinear_identity).toEqual(STATED);
    expect(JSON.stringify(islBodies[0])).not.toContain('reading_licence');
    expect(options(body).map((option) => [option.option_id, option.probability_of_goal])).toEqual([['raise_59', 0.4], ['hold_49', 0.3]]);
    expect(withholdWarnings(body)).toEqual([]);
    expect(body._meta?.identities_not_forwarded ?? []).toEqual([]);
  });

  it('L2: no licence retains inferred_identity_unconfirmed and withholds', async () => {
    const body = await post(paulRequest(PRODUCT));
    expect(islGoal()).not.toHaveProperty('nonlinear_identity');
    expect(body._meta?.identities_not_forwarded).toEqual([{ node_id: 'mrr', reason: 'inferred_identity_unconfirmed', frameless_node_ids: [] }]);
    expectWithheld(body);
  });

  it('L3: a frameless licensed addend loses to variant b, naming churn_loss', async () => {
    const request = paulRequest();
    delete request.graph.nodes.find((node: any) => node.id === 'churn_loss').observed_state;
    const body = await post(request);
    expect(islGoal()).not.toHaveProperty('nonlinear_identity');
    expect(body._meta?.identities_not_forwarded).toEqual([{ node_id: 'mrr', reason: 'inferred_identity_frame_unresolved', frameless_node_ids: ['churn_loss'] }]);
    expect(islBodies[0].graph.nodes.every((node: any) => !node.execution_frame)).toBe(true);
    expectWithheld(body);
  });

  it('variant c: licensed inferred identity inconsistent at ISL retries once and withholds with reconciliation', async () => {
    rejectFirst = true;
    const body = await post();
    expect(islBodies).toHaveLength(2);
    expect(islGoal().nonlinear_identity).toEqual(PRODUCT);
    expect(islGoal(1)).not.toHaveProperty('nonlinear_identity');
    expect(islBodies[1].graph.nodes.every((node: any) => !node.execution_frame)).toBe(true);
    expect(body._meta?.identities_not_forwarded).toEqual([{ node_id: 'mrr', reason: 'inferred_identity_inconsistent', frameless_node_ids: [], reconciliation }]);
    expectWithheld(body);
  });
});
