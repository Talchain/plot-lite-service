/**
 * Regression: B8-8 — 3C field handling in factor_sensitivity.
 *
 * After confidence unification (d293bfd) and audit A1-PRIMARY (commit 064a6b4),
 * ISL bootstrap fields (elasticity_std, attribution_stability, rank_flip_rate,
 * stability_method) are merged onto ALL factor_sensitivity entries that have
 * a matching ISL entry. The /v2/run response must:
 *   - factor_sensitivity[]: 3C fields PRESENT when
 *       confidence_source === 'plot_unified_from_isl_bootstrap'
 *   - factor_sensitivity[]: 3C fields MAY be present when
 *       confidence_source === 'plot_unified_from_graph'
 *   - factor_stability[]: DOES contain all four fields (unchanged)
 *   - All entries: confidence in [0,1], confidence_components present,
 *       confidence_provenance present (audit A1-PRIMARY)
 *
 * @regression
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// ISL Mock — returns stability fields inside factor_sensitivity
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
        // ISL returns stability fields inside factor_sensitivity
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

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('B8-8: 3C field handling in /v2/run response', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
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

  const THREE_C_FIELDS = ['elasticity_std', 'attribution_stability', 'rank_flip_rate', 'stability_method'] as const;

  it('factor_sensitivity[] entries with ISL-bootstrap provenance carry 3C stability fields', async () => {
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

    // Audit A1-PRIMARY: legacy 'isl' value replaced by honest
    // 'plot_unified_from_isl_bootstrap' — value is PLoT-recomputed.
    const islFactors = body.factor_sensitivity.filter(
      (f: any) => f.confidence_source === 'plot_unified_from_isl_bootstrap',
    );
    expect(islFactors.length).toBeGreaterThan(0);

    for (const factor of islFactors) {
      expect(typeof factor.elasticity_std).toBe('number');
      expect(['high', 'moderate', 'low', 'negligible']).toContain(factor.attribution_stability);
      expect(typeof factor.rank_flip_rate).toBe('number');
      expect(typeof factor.stability_method).toBe('string');
    }
  });

  // Audit A1-PRIMARY: public-vs-debug payload boundary regression. ISL's own
  // labels and confidence value may live inside internal _meta debug objects
  // but MUST NOT appear on the public factor_sensitivity[] entries.
  it('public factor_sensitivity[] never carries legacy or ISL-side confidence_source labels (audit A1-PRIMARY)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: { graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: '42' },
    });

    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(body.factor_sensitivity)).toBe(true);
    expect(body.factor_sensitivity.length).toBeGreaterThan(0);

    const FORBIDDEN = ['isl', 'graph', 'fallback_degenerate', 'bootstrap_sampling'] as const;
    const HONEST = ['plot_unified_from_isl_bootstrap', 'plot_unified_from_graph'] as const;

    for (const factor of body.factor_sensitivity) {
      // Heart of the fix: no legacy or upstream-ISL source labels in public output.
      for (const forbidden of FORBIDDEN) {
        expect(factor.confidence_source).not.toBe(forbidden);
      }
      // The honest enum value must be present.
      expect(HONEST).toContain(factor.confidence_source);
      // Provenance object populated and well-formed (audit A1-PRIMARY).
      expect(factor.confidence_provenance).toBeDefined();
      expect(typeof factor.confidence_provenance.is_provisional).toBe('boolean');
      expect(factor.confidence_provenance.formula_version).toBe('plot_unified_v2');
      expect(HONEST).toContain(factor.confidence_provenance.computation_source);
    }
  });

  it('all factor_sensitivity[] entries have unified confidence and components', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: { graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: '42' },
    });

    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);

    for (const factor of body.factor_sensitivity) {
      // Unified confidence in [0, 1]
      expect(typeof factor.confidence).toBe('number');
      expect(factor.confidence).toBeGreaterThanOrEqual(0);
      expect(factor.confidence).toBeLessThanOrEqual(1);

      // Progressive disclosure components
      expect(factor.confidence_components).toBeDefined();
      expect(typeof factor.confidence_components.structural_certainty).toBe('number');
      // sampling_stability is number when ISL data present, null otherwise
      const ss = factor.confidence_components.sampling_stability;
      expect(ss === null || typeof ss === 'number').toBe(true);
    }
  });

  it('mixed graph/ISL entries: 3C fields present on ISL-matched entries', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: { graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: '42' },
    });

    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);

    // The mock ISL returns factor_sensitivity for factor-a and factor-b,
    // so graph entries for these factors should be merged with ISL data
    const factorA = body.factor_sensitivity.find((f: any) => f.factor_id === 'factor-a');
    const factorB = body.factor_sensitivity.find((f: any) => f.factor_id === 'factor-b');

    expect(factorA).toBeDefined();
    expect(factorB).toBeDefined();

    // Both should have ISL-merged 3C fields. Audit A1-PRIMARY: source value
    // updated from legacy 'isl' to honest 'plot_unified_from_isl_bootstrap'.
    for (const factor of [factorA, factorB]) {
      expect(factor.confidence_source).toBe('plot_unified_from_isl_bootstrap');
      expect(factor.attribution_stability).toBe('moderate');
      // A3 lane 2 (r2 residual R1): BOTH fixture factors are option-pinned
      // levers (opt-a pins factor-a, opt-b pins factor-b), so the D-U
      // suppression contract (LEVER_SUPPRESSION_FIELDS) now forces
      // elasticity_std to 0 on the public factor_sensitivity entry — the
      // pre-lane assertion `toBe(0.12)` was pinning the leak itself (a
      // non-zero variance statistic of the suppressed elasticity). The raw
      // ISL value (0.12) still reaches factor_stability[] below: that surface
      // reads raw ISL input and sits outside the suppression contract
      // (disclosed residual, 2.25 hygiene sweep).
      expect(factor.elasticity_std).toBe(0);
      expect(factor.rank_flip_rate).toBe(0.08);
      expect(factor.stability_method).toBe('bootstrap');
    }
  });

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
