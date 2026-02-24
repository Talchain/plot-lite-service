/**
 * Regression: B8-8 — 3C field segregation.
 * ISL stability fields must not leak into factor_sensitivity.
 *
 * When ISL returns factor_sensitivity entries that include 3C stability fields
 * (elasticity_std, attribution_stability, rank_flip_rate, stability_method),
 * the PLoT /v2/run response must:
 *   - factor_sensitivity[]: NOT contain any of the four fields
 *   - factor_stability[]: DOES contain all four fields
 *
 * @regression
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// ISL Mock — returns stability fields inside factor_sensitivity (the leak scenario)
// ---------------------------------------------------------------------------

const STABILITY_FIELDS = {
  elasticity_std: 0.12,
  attribution_stability: 'moderate' as const,
  rank_flip_rate: 0.08,
  stability_method: 'bootstrap',
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
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return {
      options: options.map((opt: any, idx: number) => ({
        option_id: opt.id,
        outcome: { mean: 0.65 + idx * 0.12, std: 0.08, p10: 0.45, p50: 0.65, p90: 0.85, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
        rank: idx + 1,
      })),
      edges: [
        { from: 'factor-a', to: 'goal', sensitivity: 0.5, confidence: 0.8, direction: 'positive' },
        { from: 'factor-b', to: 'goal', sensitivity: -0.3, confidence: 0.7, direction: 'negative' },
      ],
      factors: [
        { node_id: 'factor-a', sensitivity: 0.5, confidence: 0.8, direction: 'positive' },
        { node_id: 'factor-b', sensitivity: -0.3, confidence: 0.7, direction: 'negative' },
      ],
      value_of_information: [],
      overall_robustness: 'robust' as const, robustness_score: 0.82,
      fragile_edges: [], robust_edges: [],
      latency_ms: 42, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.82, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null; isl_echoed_request_id?: string }> {
    const options = body.options || [];
    return {
      data: {
        options: options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: { mean: 0.65 + idx * 0.12, std: 0.08, p10: 0.45, p50: 0.65, p90: 0.85, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
          rank: idx + 1,
        })),
        edges: [
          { from: 'factor-a', to: 'goal', sensitivity: 0.5, confidence: 0.8, direction: 'positive' },
          { from: 'factor-b', to: 'goal', sensitivity: -0.3, confidence: 0.7, direction: 'negative' },
        ],
        factors: [
          { node_id: 'factor-a', sensitivity: 0.5, confidence: 0.8, direction: 'positive' },
          { node_id: 'factor-b', sensitivity: -0.3, confidence: 0.7, direction: 'negative' },
        ],
        // KEY: ISL returns stability fields inside factor_sensitivity — the leak scenario
        factor_sensitivity: [
          { factor_id: 'factor-a', factor_label: 'Factor A', elasticity: 0.85, direction: 'positive', ...STABILITY_FIELDS },
          { factor_id: 'factor-b', factor_label: 'Factor B', elasticity: -0.65, direction: 'negative', ...STABILITY_FIELDS },
        ],
        value_of_information: [],
        overall_robustness: 'robust', robustness_score: 0.82,
        fragile_edges: [], robust_edges: [],
      } as T,
      error: null,
    };
  },
};

vi.mock('../src/integrations/isl/index.js', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.js');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('B8-8: 3C field segregation in /v2/run response', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLE = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const GRAPH = {
    nodes: [
      { id: 'factor-a', kind: 'factor', label: 'Factor A', observed_state: { value: 50 } },
      { id: 'factor-b', kind: 'factor', label: 'Factor B', observed_state: { value: 30 } },
      { id: 'goal', kind: 'goal', label: 'Goal' },
    ],
    edges: [
      { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
      { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: -0.3, std: 0.1 } },
    ],
  };

  const OPTIONS = [
    { id: 'opt-a', label: 'Option A', interventions: { 'factor-a': { value: 0.8, source: 'user_specified' } } },
    { id: 'opt-b', label: 'Option B', interventions: { 'factor-b': { value: 0.7, source: 'user_specified' } } },
  ];

  const LEAKED_FIELDS = ['elasticity_std', 'attribution_stability', 'rank_flip_rate', 'stability_method'];

  // Regression: B8-8 — 3C field segregation. ISL stability fields must not leak into factor_sensitivity.
  it('factor_sensitivity[] does NOT contain 3C stability fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: { graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: '42' },
    });

    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.factor_sensitivity).toBeDefined();
    expect(body.factor_sensitivity.length).toBeGreaterThan(0);

    for (const factor of body.factor_sensitivity) {
      for (const field of LEAKED_FIELDS) {
        expect(factor).not.toHaveProperty(field);
      }
    }
  });

  // Regression: B8-8 — 3C field segregation. ISL stability fields must not leak into factor_sensitivity.
  it('factor_stability[] DOES contain all 3C stability fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: { graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: '42' },
    });

    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.factor_stability).toBeDefined();
    expect(body.factor_stability.length).toBeGreaterThan(0);

    for (const entry of body.factor_stability) {
      expect(entry).toHaveProperty('elasticity_std');
      expect(entry).toHaveProperty('attribution_stability');
      expect(entry).toHaveProperty('rank_flip_rate');
      expect(entry).toHaveProperty('stability_method');
    }
  });
});
