import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

let capturedISLRequestBody: any = null;
/** When false, the mock behaves like an ISL that silently drops the field (no echo). */
let islEchoesRanges = true;
/** The coverage the mock ISL echoes (ISL's RATIFIED_COVERAGE is 0.5). */
let islEchoCoverage = 0.5;

/** When false, the mock behaves like an ISL that does not know target_forecast (drops it silently). */
let islScoresForecast = true;
let PROB: Record<string, number> = { opt_liftshift: 0.628, opt_phased: 0.905, opt_booked: 0.0 };

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [],
      backdoor_paths: [], issues: [], explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl',
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
    capturedISLRequestBody = JSON.parse(JSON.stringify(body));
    const constraints = body.goal_constraints || [];
    return {
      data: {
        options: (body.options || []).map((opt: any, idx: number) => {
          const ranged = opt.intervention_ranges ? Object.entries(opt.intervention_ranges) : [];
          return {
            option_id: opt.id,
            outcome: { mean: 0.1 + idx * 0.02, std: 0.05, p10: 0.04, p50: 0.1, p90: 0.16, n_samples: 2000, n_valid_samples: 2000, validity_ratio: 1.0 },
            win_probability: 1 / (body.options.length || 1),
            rank: idx + 1,
            ...(islEchoesRanges && ranged.length > 0
              ? {
                  sampled_intervention_ranges: ranged.map(([nodeId, r]: [string, any]) => ({
                    node_id: nodeId, meaning: r.meaning, family: 'lognormal', coverage: islEchoCoverage, low: r.low, high: r.high,
                  })),
                }
              : {}),
            ...(islScoresForecast && opt.target_forecast
              ? {
                  target_forecast_analysis: {
                    conditions: opt.target_forecast.conditions.map((c: any, i: number) => ({
                      constraint_id: c.constraint_id, quantity: c.quantity, threshold: c.threshold,
                      operator: (constraints.find((k: any) => k.constraint_id === c.constraint_id) ?? {}).operator ?? '>=',
                      prob_satisfied: [0.41, 0.56][i] ?? 0.5, prob_satisfied_precision: { n_informative: 2000, standard_error: 0.011 },
                    })),
                    joint_probability: 0.33, joint_probability_precision: { n_informative: 2000, standard_error: 0.0105 },
                    law: { family: 'beta_binomial', alpha: 9.1, beta: 46.2, rate_quartiles: opt.target_forecast.rate_quartiles,
                      exposure: opt.target_forecast.exposure, trials: 'conditionally independent given the cohort\'s propensity' },
                  },
                }
              : {}),
            ...(constraints.length > 0
              ? {
                  constraint_analysis: {
                    joint_probability: PROB[opt.id] ?? 0.5,
                    constraints: constraints.map((c: any) => ({
                      constraint_id: c.constraint_id, node_id: c.node_id, operator: c.operator,
                      threshold: c.value, prob_satisfied: PROB[opt.id] ?? 0.5,
                    })),
                  },
                }
              : {}),
          };
        }),
        factor_sensitivity: [],
        robustness: { label: 'moderate', score: 0.6, fragile_edges: [], robust_edges: [] },
        inference_warnings: [],
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


/**
 * AIE laws ruling (13 Oct, same cohort) — PLoT forwards an option's `target_forecast` to ISL verbatim and carries
 * ISL's `target_forecast_analysis` back as `option_comparison[].target_forecast`, never derived here.
 *   T1  absent → no `target_forecast` key reaches ISL, and none is served (byte-identical).
 *   T2  present → forwarded exactly {law, exposure, rate_quartiles, conditions}; ISL's scored block is served as
 *       {conditions[{constraint_id, quantity, operator, threshold, probability, precision}], joint_probability, …}.
 *   T3  an ISL that does not score it → nothing is served (absence, never a fabricated figure).
 *   T4  malformed, or naming a constraint the request does not send → 422 INVALID_TARGET_FORECAST, ISL not called.
 */
const CONV = { constraint_id: 'gc_conv', node_id: 'goal_conv', operator: '>', value: 0.15, label: 'Conversion rate', value_frame: 'level' };
const CUST = { constraint_id: 'gc_cust', node_id: 'out_cust', operator: '>=', value: 0.1, label: 'New customers', value_frame: 'level' };
const FORECAST = { law: 'same_cohort_beta_binomial', exposure: 100, rate_quartiles: [0.12, 0.22],
  conditions: [{ constraint_id: 'gc_conv', quantity: 'rate', threshold: 0.15 }, { constraint_id: 'gc_cust', quantity: 'count', threshold: 20 }] };
const iv = (value: number) => ({ value, source: 'user_specified' });

function body(forecast: any = FORECAST) {
  return {
    request_id: 'same-cohort-forward',
    graph: {
      nodes: [
        { id: 'goal_conv', kind: 'goal', label: 'Conversion rate' },
        { id: 'out_cust', kind: 'outcome', label: 'New customers' },
        { id: 'fac_plan', kind: 'factor', label: 'Planning quality', observed_state: { value: 0.3 } },
      ],
      edges: [
        { from: 'fac_plan', to: 'goal_conv', exists_probability: 0.9, strength: { mean: 0.3, std: 0.1 } },
        { from: 'fac_plan', to: 'out_cust', exists_probability: 0.9, strength: { mean: 0.3, std: 0.1 } },
      ],
    },
    options: [
      { id: 'opt_hire', label: 'Hire', interventions: { fac_plan: iv(0.7) }, ...(forecast === null ? {} : { target_forecast: forecast }) },
      { id: 'opt_ai', label: 'AI tool', interventions: { fac_plan: iv(0.5) } },
    ],
    goal_node_id: 'goal_conv',
    goal_constraints: [CONV, CUST],
    seed: 42,
  };
}

function islOption(id: string): any {
  return (capturedISLRequestBody?.options ?? []).find((o: any) => o.id === id);
}
function served(res: any, id: string): any {
  return (res.option_comparison ?? []).find((o: any) => o.option_id === id);
}

describe('same-cohort target forecast: PLoT forwards it and carries ISL\'s scored block back', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    app = await createServer();
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); });
  async function run(payload: any) {
    capturedISLRequestBody = null;
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload });
    return { status: res.statusCode, json: res.json() };
  }

  it('T1: absent → no target_forecast key reaches ISL or the response', async () => {
    islScoresForecast = true;
    const { status, json } = await run(body(null));
    expect(status).toBe(200);
    expect(JSON.stringify(capturedISLRequestBody)).not.toContain('target_forecast');
    expect(JSON.stringify(json)).not.toContain('target_forecast');
  });

  it('T2: present → forwarded verbatim; ISL\'s scored block served on that option only', async () => {
    islScoresForecast = true;
    const { status, json } = await run(body());
    expect(status).toBe(200);
    expect(islOption('opt_hire').target_forecast).toEqual(FORECAST);
    expect(islOption('opt_ai').target_forecast).toBeUndefined();
    expect(served(json, 'opt_hire')?.target_forecast).toEqual({
      conditions: [
        { constraint_id: 'gc_conv', quantity: 'rate', operator: '>', threshold: 0.15, probability: 0.41, precision: { n_informative: 2000, standard_error: 0.011 } },
        { constraint_id: 'gc_cust', quantity: 'count', operator: '>=', threshold: 20, probability: 0.56, precision: { n_informative: 2000, standard_error: 0.011 } },
      ],
      joint_probability: 0.33, joint_probability_precision: { n_informative: 2000, standard_error: 0.0105 },
      law: { family: 'beta_binomial', alpha: 9.1, beta: 46.2, rate_quartiles: [0.12, 0.22], exposure: 100,
        trials: 'conditionally independent given the cohort\'s propensity' },
    });
    expect(served(json, 'opt_ai')?.target_forecast).toBeUndefined();
  });

  it('T3: an ISL that does not score it → nothing is served', async () => {
    islScoresForecast = false;
    const { status, json } = await run(body());
    expect(status).toBe(200);
    expect(islOption('opt_hire').target_forecast).toEqual(FORECAST);
    expect(JSON.stringify(json)).not.toContain('target_forecast');
    islScoresForecast = true;
  });

  it.each([
    ['an unsent constraint', { ...FORECAST, conditions: [{ constraint_id: 'gc_nope', quantity: 'rate', threshold: 0.15 }] }],
    ['a rate in percent', { ...FORECAST, conditions: [{ constraint_id: 'gc_conv', quantity: 'rate', threshold: 15 }] }],
    ['inverted quartiles', { ...FORECAST, rate_quartiles: [0.3, 0.2] }],
    ['a fractional exposure', { ...FORECAST, exposure: 99.5 }],
    ['another law', { ...FORECAST, law: 'independent' }],
    ['a repeated condition', { ...FORECAST, conditions: [FORECAST.conditions[0], FORECAST.conditions[0]] }],
  ])('T4: %s → 422 INVALID_TARGET_FORECAST, ISL not called', async (_name, forecast) => {
    const { status, json } = await run(body(forecast));
    expect(status).toBe(422);
    expect(JSON.stringify(json)).toContain('INVALID_TARGET_FORECAST');
    expect(capturedISLRequestBody).toBeNull();
  });
});
