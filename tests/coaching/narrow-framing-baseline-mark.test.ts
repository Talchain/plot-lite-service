import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
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
            id: opt.id, // ISL OptionResultV2.id (response_v2.py), the real shape
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

vi.mock('../../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

const { createServer } = await import('../../src/createServer.js');


import { generateCritiques } from '../../src/coaching/critiques.js';
import { normaliseCoachingInputs } from '../../src/coaching/normalise-inputs.js';
import type { CoachingInputs } from '../../src/coaching/types.js';

/**
 * Paul pricing r2 (judge, recorded contradiction): the Run's brief said "Only 2 options without a baseline. Are you missing
 * alternatives?" while its own "Keep Pro price at £49" carried CEE's `is_baseline: true` and was "analysed as no change".
 * The critique read label words only. Now the caller's own mark decides first; label words remain for a caller with no mark.
 */
const KEEP = 'Keep Pro price at £49';
const RAISE = 'Raise Pro price to £59';
const NARROW = 'Only 2 options without a baseline. Are you missing alternatives?';
const inputs = (options: CoachingInputs['options']): CoachingInputs => ({
  graph: { nodes: [{ id: 'mrr', kind: 'goal', label: 'MRR' }], edges: [] } as any, options, factorSensitivity: [], fragileEdges: [],
  robustness: { level: undefined, recommendationStability: undefined, isRobust: undefined }, interventionTargetIds: new Set<string>(),
} as CoachingInputs);
const opt = (id: string, label: string, mark?: true) => ({ id, label, winProbability: 0.5, outcomeP10: undefined, outcomeP90: undefined, ...(mark ? { isBaseline: mark } : {}) });

describe('narrow framing reads the caller\'s own baseline mark', () => {
  it('RED: Paul\'s two pricing options, the £49 one marked as the baseline → no "without a baseline" critique', () => {
    expect(generateCritiques(inputs([opt('keep', KEEP, true), opt('raise', RAISE)])).map((c) => c.type)).not.toContain('NARROW_FRAMING');
  });
  it('CONTRAST: the same two options with no mark → the critique still fires, as before', () => {
    const c = generateCritiques(inputs([opt('keep', KEEP), opt('raise', RAISE)])).find((x) => x.type === 'NARROW_FRAMING');
    expect(c?.challenge_question).toBe(NARROW);
  });
  it('the normaliser binds the mark on ISL\'s RECORDED response shape (pricing canary), only when exactly true', () => {
    // A recorded ISL response (`tests/golden/pricing-canary/isl-response.json`): its options carry `id`, as ISL's
    // OptionResultV2 declares. A rename on either side unbinds the mark and turns this row RED.
    const isl = JSON.parse(readFileSync('tests/golden/pricing-canary/isl-response.json', 'utf8'));
    expect(isl.options.map((o: any) => o.id)).toEqual(['opt_keep_49', 'opt_raise_59']);
    const graph = { nodes: [{ id: 'mrr', kind: 'goal', label: 'MRR' }], edges: [] } as any;
    const options = [{ id: 'opt_keep_49', label: KEEP, interventions: {}, is_baseline: true as const }, { id: 'opt_raise_59', label: RAISE, interventions: {} }];
    const n = normaliseCoachingInputs(graph, options as any, isl).options;
    expect(n.find((o) => o.id === 'opt_keep_49')).toMatchObject({ label: KEEP, isBaseline: true });
    expect(n.find((o) => o.id === 'opt_raise_59')).not.toHaveProperty('isBaseline');
    expect(generateCritiques({ ...inputs(n), options: n }).map((c) => c.type)).not.toContain('NARROW_FRAMING');
  });
});

const iv = (value: number) => ({ value, source: 'user_specified' });
function body(baseline: unknown) {
  return {
    request_id: 'narrow-framing-baseline',
    graph: {
      nodes: [{ id: 'mrr', kind: 'goal', label: 'MRR' }, { id: 'price', kind: 'factor', label: 'Pro plan monthly price', observed_state: { value: 0.49 } }],
      edges: [{ from: 'price', to: 'mrr', exists_probability: 0.9, strength: { mean: 0.3, std: 0.1 } }],
    },
    options: [
      { id: 'keep', label: KEEP, interventions: { price: iv(0.49) }, ...(baseline === undefined ? {} : { is_baseline: baseline }) },
      { id: 'raise', label: RAISE, interventions: { price: iv(0.59) } },
    ],
    goal_node_id: 'mrr', seed: 42,
  };
}

describe('the route carries the mark to coaching, never to ISL', () => {
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
  const run = async (payload: unknown) => { capturedISLRequestBody = null; const res = await app.inject({ method: 'POST', url: '/v2/run', payload }); return { status: res.statusCode, text: res.body }; };

  it('RED: is_baseline true on "Keep Pro price at £49" → the served Run says nothing about a missing baseline; ISL never sees the key', async () => {
    const r = await run(body(true));
    expect(r.status).toBe(200);
    expect(r.text).not.toContain('without a baseline');
    expect(JSON.stringify(capturedISLRequestBody)).not.toContain('is_baseline');
  });
  it('CONTRAST: no mark (or a non-true mark) → the served Run still carries the critique', async () => {
    for (const mark of [undefined, 'yes']) {
      const r = await run(body(mark));
      expect([mark, r.status]).toEqual([mark, 200]);
      expect([mark, r.text.includes(NARROW)]).toEqual([mark, true]);
    }
  });
});
