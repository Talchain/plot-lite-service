/**
 * Review Cards Integration Test
 *
 * Verifies that evidence_priority cards appear in /v2/run response
 * when ENABLE_REVIEW_PASS=1 and factor sensitivity data is present.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// ISL Mock — scenario-driven factor sensitivity
// ---------------------------------------------------------------------------

/** Switch between mock scenarios per test */
let MOCK_SCENARIO: 'low_confidence' | 'high_confidence' = 'low_confidence';

const FACTOR_SENSITIVITY_LOW_CONFIDENCE = [
  { factor_id: 'factor-a', factor_label: 'Factor A', elasticity: 0.85, direction: 'positive', attribution_stability: 'low', elasticity_std: 0.15, rank_flip_rate: 0.2 },
  { factor_id: 'factor-b', factor_label: 'Factor B', elasticity: -0.65, direction: 'negative', attribution_stability: 'moderate', elasticity_std: 0.1, rank_flip_rate: 0.1 },
];

const FACTOR_SENSITIVITY_HIGH_CONFIDENCE = [
  { factor_id: 'factor-a', factor_label: 'Factor A', elasticity: 0.85, direction: 'positive', attribution_stability: 'high', elasticity_std: 0.02, rank_flip_rate: 0.01, stability_method: 'bootstrap' },
  { factor_id: 'factor-b', factor_label: 'Factor B', elasticity: -0.65, direction: 'negative', attribution_stability: 'high', elasticity_std: 0.01, rank_flip_rate: 0.01, stability_method: 'bootstrap' },
];

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
      edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factors: [
        { node_id: 'factor-a', sensitivity: 0.5, confidence: 0.8, direction: 'positive' },
        { node_id: 'factor-b', sensitivity: -0.3, confidence: 0.7, direction: 'negative' },
      ],
      value_of_information: [],
      factors_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      factor_sensitivity_status: 'available' as const,
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
        factor_sensitivity: MOCK_SCENARIO === 'high_confidence'
          ? FACTOR_SENSITIVITY_HIGH_CONFIDENCE
          : FACTOR_SENSITIVITY_LOW_CONFIDENCE,
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

describe('Review cards in /v2/run', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLE = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '1';
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

  it('includes evidence_priority card in review_cards when sensitivity data is present', async () => {
    MOCK_SCENARIO = 'low_confidence';
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        graph: GRAPH,
        options: OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
      },
    });

    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);

    // review_cards should be present when ENABLE_REVIEW_PASS=1
    expect(body.review_cards).toBeDefined();
    expect(Array.isArray(body.review_cards)).toBe(true);
    expect(body.review_cards.length).toBeGreaterThan(0);

    // Find the evidence_priority card
    const epCard = body.review_cards.find((c: any) => c.card_type === 'evidence_priority');
    expect(epCard).toBeDefined();
    expect(epCard.card_id).toMatch(/^ep_/);
    expect(epCard.review_phase).toBe('post_analysis');
    expect(epCard.priority).toBe(2);
    expect(epCard.suggested_action).toBe('add_evidence');
    expect(epCard.items).toBeDefined();
    expect(epCard.items.length).toBeGreaterThan(0);
    expect(epCard.items.length).toBeLessThanOrEqual(3);

    // Each item should have the expected structure
    for (const item of epCard.items) {
      expect(item.factor_id).toBeDefined();
      expect(item.factor_label).toBeDefined();
      expect(typeof item.score).toBe('number');
      expect(typeof item.confidence_normalised).toBe('number');
      expect(typeof item.elasticity).toBe('number');
    }
  });

  it('suppresses evidence_priority card when all factors have high confidence and weak influence', async () => {
    MOCK_SCENARIO = 'high_confidence';

    // Graph with outcome → factor → goal chain. Parent nodes are 'outcome' kind
    // so they don't appear in factor sensitivity. Each factor has:
    //   - incoming edge with high exists_probability (0.99)
    //   - weak outgoing edge to goal (mean: 0.01)
    //   - attribution_stability='high' via ISL mock (stability_method present)
    // Result: confidence_normalised ≈ 0.995, elasticity tiny → score < 0.05 → suppressed.
    const SUPPRESSED_GRAPH = {
      nodes: [
        { id: 'ctx-a', kind: 'outcome', label: 'Context A', observed_state: { value: 80 } },
        { id: 'ctx-b', kind: 'outcome', label: 'Context B', observed_state: { value: 60 } },
        { id: 'factor-a', kind: 'factor', label: 'Factor A', observed_state: { value: 50 } },
        { id: 'factor-b', kind: 'factor', label: 'Factor B', observed_state: { value: 30 } },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        // Outcome → factor: provides incoming_edges with high exists_probability
        { from: 'ctx-a', to: 'factor-a', exists_probability: 0.99, strength: { mean: 0.5, std: 0.1 } },
        { from: 'ctx-b', to: 'factor-b', exists_probability: 0.99, strength: { mean: 0.5, std: 0.1 } },
        // Factor → goal: very weak — keeps graph-computed elasticity tiny
        { from: 'factor-a', to: 'goal', exists_probability: 0.99, strength: { mean: 0.01, std: 0.05 } },
        { from: 'factor-b', to: 'goal', exists_probability: 0.99, strength: { mean: -0.01, std: 0.05 } },
      ],
    };

    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        graph: SUPPRESSED_GRAPH,
        options: OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
      },
    });

    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);

    // Only factor-a/b in sensitivity (outcome nodes excluded).
    // confidence_normalised = 0.5*1.0 + 0.5*0.99 = 0.995, score ≈ 0.005 < 0.05
    const epCard = (body.review_cards ?? []).find((c: any) => c.card_type === 'evidence_priority');
    expect(epCard).toBeUndefined();
  });
});
