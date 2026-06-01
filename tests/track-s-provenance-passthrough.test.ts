/**
 * Track S — factor value provenance passthrough (end-to-end).
 *
 * Proves that ISL's additive FactorSensitivityV2 provenance fields
 * (value_source / value_extraction_type / value_defaulted) survive the full
 * /v2/run pipeline:
 *
 *   ISL response  →  mapIslFactorEntry (run.ts)  →
 *   mergeIslConfidenceIntoGraphFactors graph+ISL branch (factor-influence.ts)  →
 *   /v2/run response.factor_sensitivity
 *
 * `factor-a` exists in BOTH the request graph and the mocked ISL response, so
 * this exercises the graph+ISL merge branch — the common production path that
 * previously dropped these fields (mapIslFactorEntry used an explicit object
 * literal; the merge graph-branch copied only a named allow-list of ISL fields).
 *
 * This file uses a SINGLE vi.mock of the ISL service so the mocked
 * factor_sensitivity actually reaches the route (the broader
 * boundary-isl-to-ui.contract.test.ts registers two vi.mocks for the same
 * module, the second of which wins and returns an empty factor_sensitivity).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ISL factor_sensitivity entry carrying the Track S provenance trio plus a
// bootstrap stability field (so the merge's v3 confidence branch fires cleanly).
const ISL_FACTOR_A = {
  node_id: 'factor-a',
  label: 'Marketing Spend',
  sensitivity_score: 0.5,
  direction: 'positive' as const,
  confidence: 0.8,
  attribution_stability: 'high' as const,
  value_source: 'user_input',
  value_extraction_type: 'explicit',
  value_defaulted: true,
};

const ISL_DATA = {
  options: [
    { option_id: 'opt1', outcome: { mean: 0.8, std: 0.1, p10: 0.6, p50: 0.8, p90: 0.95, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 }, rank: 1, win_probability: 0.7, probability_of_goal: 0.65 },
    { option_id: 'opt2', outcome: { mean: 0.7, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 }, rank: 2, win_probability: 0.3, probability_of_goal: 0.55 },
  ],
  sensitivity: [
    { edge_from: 'factor-a', edge_to: 'goal', sensitivity_type: 'magnitude', elasticity: 0.6, importance_rank: 1, interpretation: 'High impact' },
  ],
  factor_sensitivity: [ISL_FACTOR_A],
  robustness: {
    score: 0.82,
    label: 'robust',
    fragile_edges: [],
    robust_edges: ['factor-a::goal'],
  },
};

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high',
      adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseRobustness() {
    return { ...ISL_DATA, source: 'isl' as const, latency_ms: 42 };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.82, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, _body: any): Promise<{ data: T | null; error: string | null }> {
    return { data: ISL_DATA as T, error: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'factor-a', kind: 'factor', label: 'Marketing Spend', observed_state: { value: 0.6 } },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt1', label: 'Increase Marketing', interventions: { 'factor-a': 0.8 } },
  { id: 'opt2', label: 'Reduce Spend', interventions: { 'factor-a': 0.3 } },
];

describe('Track S provenance passthrough — /v2/run end-to-end', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  async function run() {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({ graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: 'track-s-test' }),
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body);
  }

  it('value_source / value_extraction_type / value_defaulted survive ISL → mapIslFactorEntry → merge → response', async () => {
    const body = await run();
    expect(Array.isArray(body.factor_sensitivity)).toBe(true);
    const factor = body.factor_sensitivity.find((f: any) => f.factor_id === 'factor-a');
    expect(factor).toBeDefined();
    // factor-a is graph-derived (`source: 'graph'`), so it merges via the
    // graph-match branch with a graph factor as the base. Pinning this proves
    // the provenance survived the *common* graph+ISL merge path — the decisive
    // historical drop point — rather than only the ISL-only append branch.
    expect(factor.source).toBe('graph');
    expect(factor.value_source).toBe('user_input');
    expect(factor.value_extraction_type).toBe('explicit');
    expect(factor.value_defaulted).toBe(true);
    // Confidence is still PLoT-recomputed (provenance carry must not disturb the
    // confidence honesty contract — A1-PRIMARY).
    expect(factor.confidence_source).toMatch(/^plot_unified_/);
  });
});
