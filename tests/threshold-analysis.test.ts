/**
 * Threshold Analysis Tests (B10.3)
 *
 * Tests for ISL native threshold analysis integration in /v2/run:
 * 1. include_thresholds: true + ISL success → threshold_analysis present with enriched labels
 * 2. include_thresholds: false/absent → threshold_analysis absent, ISL threshold NOT called
 * 3. include_thresholds: true + ISL error → main analysis succeeds, thresholds_status: 'error'
 * 4. include_thresholds: true + insufficient budget → skipped_budget
 * 5. response_hash identical with/without include_thresholds
 * 6. Label enrichment with missing labels → fallback to IDs
 * 7. affected_options stable-ordered by option_id
 * 8. Same factor_id, different threshold_value → sorted by ascending threshold_value
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Test state — tracks ISL calls
// ---------------------------------------------------------------------------
let thresholdEndpointCalled = false;
let thresholdEndpointCallCount = 0;
let lastThresholdEndpoint: string | null = null;

// ---------------------------------------------------------------------------
// Mock ISL threshold response
// ---------------------------------------------------------------------------
const MOCK_THRESHOLD_RESPONSE = {
  thresholds: [
    {
      sweep_id: 'sweep-1',
      node_id: 'factor-a',
      parameter: 'value',
      threshold_value: 0.45,
      crossing_type: 'falling' as const,
      options_affected: ['opt2', 'opt1'],  // intentionally unordered to test sorting
      description: 'Factor drops below 0.45',
    },
    {
      sweep_id: 'sweep-2',
      node_id: 'factor-b',
      parameter: 'value',
      threshold_value: 0.8,
      crossing_type: 'rising' as const,
      options_affected: ['opt1'],
      description: 'Factor rises above 0.8',
    },
  ],
  sensitivity_ranking: [
    { sweep_id: 'sweep-1', node_id: 'factor-a', parameter: 'value', sensitivity_score: 0.7, rank: 1 },
    { sweep_id: 'sweep-2', node_id: 'factor-b', parameter: 'value', sensitivity_score: 0.3, rank: 2 },
  ],
  summary: 'Two threshold crossings detected',
};

// ---------------------------------------------------------------------------
// ISL Mock — routes robustness and threshold calls separately
// ---------------------------------------------------------------------------
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
        outcome: { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
        rank: idx + 1,
        win_probability: idx === 0 ? 0.7 : 0.3,
      })),
      sensitivity: [
        { edge_from: 'factor-a', edge_to: 'goal', sensitivity_type: 'magnitude', elasticity: 0.6, importance_rank: 1, interpretation: 'High impact' },
      ],
      factor_sensitivity: [
        { node_id: 'factor-a', label: 'Marketing Spend', sensitivity_score: 0.5, direction: 'positive', confidence: 0.8 },
      ],
      edges: [],
      factors: [],
      value_of_information: [],
      edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factors_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      factor_sensitivity_status: 'available' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.82,
      robustness: { score: 0.82, label: 'robust', fragile_edges: [], robust_edges: [] },
      fragile_edges: [], robust_edges: [],
      latency_ms: 42, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.82, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },

  // Route-aware: robustness vs threshold endpoint
  async callAnalysisEndpoint<T>(endpoint: string, body: any): Promise<{ data: T | null; error: any; latency_ms: number }> {
    if (endpoint === '/api/v1/analysis/thresholds') {
      thresholdEndpointCalled = true;
      thresholdEndpointCallCount++;
      lastThresholdEndpoint = endpoint;
      return {
        data: MOCK_THRESHOLD_RESPONSE as T,
        error: null,
        latency_ms: 15,
      };
    }

    // Default: robustness analysis
    const options = body.options || [];
    return {
      data: {
        options: options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
          rank: idx + 1,
          win_probability: idx === 0 ? 0.7 : 0.3,
        })),
        sensitivity: [
          { edge_from: 'factor-a', edge_to: 'goal', sensitivity_type: 'magnitude', elasticity: 0.6, importance_rank: 1, interpretation: 'High impact' },
        ],
        factor_sensitivity: [
          { node_id: 'factor-a', label: 'Marketing Spend', sensitivity_score: 0.5, direction: 'positive', confidence: 0.8 },
        ],
        edges: [],
        factors: [],
        value_of_information: [],
        overall_robustness: 'robust', robustness_score: 0.82,
        robustness: { score: 0.82, label: 'robust', fragile_edges: [], robust_edges: [] },
        fragile_edges: [], robust_edges: [],
      } as T,
      error: null,
      latency_ms: 42,
    };
  },
};

vi.mock('../src/integrations/isl/index.js', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.js');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const BASE_PAYLOAD = {
  graph: {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Revenue Growth' },
      { id: 'factor-a', kind: 'factor', label: 'Marketing Spend', observed_state: { value: 0.6 } },
      { id: 'factor-b', kind: 'factor', label: 'Hiring Rate', observed_state: { value: 0.5 } },
    ],
    edges: [
      { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
      { from: 'factor-b', to: 'goal', strength: { mean: 0.3, std: 0.1 } },
    ],
  },
  options: [
    { id: 'opt1', label: 'Increase Marketing', interventions: { 'factor-a': 0.8 } },
    { id: 'opt2', label: 'Boost Hiring', interventions: { 'factor-b': 0.9 } },
  ],
  goal_node_id: 'goal',
  seed: 'threshold-test-seed',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Threshold Analysis (B10.3)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLE = '0';
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLE;
  });

  beforeEach(() => {
    thresholdEndpointCalled = false;
    thresholdEndpointCallCount = 0;
    lastThresholdEndpoint = null;
  });

  // -------------------------------------------------------------------------
  // Test 1: include_thresholds: true + ISL success → computed
  // -------------------------------------------------------------------------
  it('include_thresholds: true → threshold_analysis present with enriched labels', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({ ...BASE_PAYLOAD, include_thresholds: true }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // Status
    expect(body.thresholds_status).toBe('computed');
    expect(body.thresholds_meta).toBeDefined();
    expect(body.thresholds_meta.duration_ms).toBeTypeOf('number');

    // Data
    expect(body.threshold_analysis).toBeDefined();
    expect(body.threshold_analysis).toHaveLength(2);

    // First threshold: factor-a (sorted by factor_id)
    const ta0 = body.threshold_analysis[0];
    expect(ta0.factor_id).toBe('factor-a');
    expect(ta0.factor_label).toBe('Marketing Spend');  // enriched from graph
    expect(ta0.threshold_value).toBe(0.45);
    expect(ta0.current_value).toBe(0.6);  // from observed_state
    expect(ta0.crossing_direction).toBe('below');  // falling → below
    expect(ta0.margin).toBeCloseTo(0.15, 5);  // |0.45 - 0.6|

    // Second threshold: factor-b
    const ta1 = body.threshold_analysis[1];
    expect(ta1.factor_id).toBe('factor-b');
    expect(ta1.factor_label).toBe('Hiring Rate');
    expect(ta1.threshold_value).toBe(0.8);
    expect(ta1.current_value).toBe(0.5);
    expect(ta1.crossing_direction).toBe('above');  // rising → above
    expect(ta1.margin).toBeCloseTo(0.3, 5);

    // ISL threshold endpoint was called
    expect(thresholdEndpointCalled).toBe(true);
    expect(lastThresholdEndpoint).toBe('/api/v1/analysis/thresholds');

    // Main analysis still present
    expect(body.analysis_status).toBeDefined();
    expect(body.option_comparison).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Test 2: include_thresholds: false (default) → absent, ISL not called
  // -------------------------------------------------------------------------
  it('include_thresholds: false → threshold_analysis absent, ISL threshold NOT called', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify(BASE_PAYLOAD),  // no include_thresholds
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // Threshold fields absent (not_requested is filtered from response)
    expect(body.thresholds_status).toBeUndefined();
    expect(body.threshold_analysis).toBeUndefined();
    expect(body.thresholds_meta).toBeUndefined();

    // ISL threshold endpoint NOT called
    expect(thresholdEndpointCalled).toBe(false);
    expect(thresholdEndpointCallCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 3: include_thresholds: true + ISL error → main analysis ok
  // -------------------------------------------------------------------------
  it('include_thresholds: true + ISL threshold error → main analysis succeeds', async () => {
    // Override callAnalysisEndpoint to fail on threshold endpoint
    const originalCall = mockISLService.callAnalysisEndpoint;
    mockISLService.callAnalysisEndpoint = async function <T>(endpoint: string, body: any): Promise<any> {
      if (endpoint === '/api/v1/analysis/thresholds') {
        thresholdEndpointCalled = true;
        return {
          data: null,
          error: { code: 'ISL_ERROR', message: 'Service unavailable', retryable: true },
          latency_ms: 5,
        };
      }
      return originalCall.call(this, endpoint, body);
    };

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v2/run',
        headers: { 'Content-Type': 'application/json' },
        payload: JSON.stringify({ ...BASE_PAYLOAD, include_thresholds: true }),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // Threshold error — non-blocking
      expect(body.thresholds_status).toBe('error');
      expect(body.thresholds_meta?.reason).toContain('Service unavailable');
      expect(body.threshold_analysis).toBeUndefined();

      // Main analysis still succeeds
      expect(body.analysis_status).not.toBe('failed');
      expect(body.option_comparison).toBeDefined();
    } finally {
      // Restore original
      mockISLService.callAnalysisEndpoint = originalCall;
    }
  });

  // -------------------------------------------------------------------------
  // Test 4: include_thresholds: true + insufficient budget → skipped_budget
  // -------------------------------------------------------------------------
  it('include_thresholds: true + insufficient budget → skipped_budget', async () => {
    // Set an impossibly low budget so threshold is always skipped
    const origBudget = process.env.REQUEST_BUDGET_MS;
    process.env.REQUEST_BUDGET_MS = '1';  // 1ms budget — always exhausted

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v2/run',
        headers: { 'Content-Type': 'application/json' },
        payload: JSON.stringify({ ...BASE_PAYLOAD, include_thresholds: true }),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      expect(body.thresholds_status).toBe('skipped_budget');
      expect(body.thresholds_meta?.reason).toContain('remaining_budget_ms');
      expect(body.threshold_analysis).toBeUndefined();

      // ISL threshold NOT called
      expect(thresholdEndpointCalled).toBe(false);
    } finally {
      if (origBudget === undefined) {
        delete process.env.REQUEST_BUDGET_MS;
      } else {
        process.env.REQUEST_BUDGET_MS = origBudget;
      }
    }
  });

  // -------------------------------------------------------------------------
  // Test 5: response_hash identical with/without include_thresholds
  // -------------------------------------------------------------------------
  it('response_hash identical with/without include_thresholds', async () => {
    const [resWithout, resWith] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v2/run',
        headers: { 'Content-Type': 'application/json' },
        payload: JSON.stringify({ ...BASE_PAYLOAD, include_thresholds: false }),
      }),
      app.inject({
        method: 'POST',
        url: '/v2/run',
        headers: { 'Content-Type': 'application/json' },
        payload: JSON.stringify({ ...BASE_PAYLOAD, include_thresholds: true }),
      }),
    ]);

    const bodyWithout = JSON.parse(resWithout.body);
    const bodyWith = JSON.parse(resWith.body);

    expect(bodyWithout.response_hash).toBeDefined();
    expect(bodyWith.response_hash).toBeDefined();
    expect(bodyWith.response_hash).toBe(bodyWithout.response_hash);
  });

  // -------------------------------------------------------------------------
  // Test 6: Label enrichment with missing labels → fallback to IDs
  // -------------------------------------------------------------------------
  it('factor/option label enrichment with missing labels → falls back to IDs', async () => {
    // Override to return threshold referencing a node/option not in graph
    const originalCall = mockISLService.callAnalysisEndpoint;
    mockISLService.callAnalysisEndpoint = async function <T>(endpoint: string, body: any): Promise<any> {
      if (endpoint === '/api/v1/analysis/thresholds') {
        thresholdEndpointCalled = true;
        return {
          data: {
            thresholds: [{
              sweep_id: 'sweep-x',
              node_id: 'unknown-factor',     // not in graph
              parameter: 'value',
              threshold_value: 0.5,
              crossing_type: 'rising',
              options_affected: ['unknown-opt'],  // not in options
              description: 'Unknown crossing',
            }],
            sensitivity_ranking: [],
            summary: '',
          } as T,
          error: null,
          latency_ms: 5,
        };
      }
      return originalCall.call(this, endpoint, body);
    };

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v2/run',
        headers: { 'Content-Type': 'application/json' },
        payload: JSON.stringify({ ...BASE_PAYLOAD, include_thresholds: true }),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      expect(body.thresholds_status).toBe('computed');
      expect(body.threshold_analysis).toHaveLength(1);

      const ta = body.threshold_analysis[0];
      // Falls back to IDs when labels not found
      expect(ta.factor_id).toBe('unknown-factor');
      expect(ta.factor_label).toBe('unknown-factor');  // fallback to ID
      expect(ta.current_value).toBeUndefined();  // no observed_state
      expect(ta.margin).toBeUndefined();  // no current_value → no margin

      expect(ta.affected_options[0].option_id).toBe('unknown-opt');
      expect(ta.affected_options[0].option_label).toBe('unknown-opt');  // fallback to ID
    } finally {
      mockISLService.callAnalysisEndpoint = originalCall;
    }
  });

  // -------------------------------------------------------------------------
  // Test 7: affected_options stable-ordered by option_id
  // -------------------------------------------------------------------------
  it('affected_options stable-ordered by option_id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({ ...BASE_PAYLOAD, include_thresholds: true }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.threshold_analysis).toBeDefined();

    // factor-a threshold has options_affected: ['opt2', 'opt1'] (unordered in ISL response)
    const factorAThreshold = body.threshold_analysis.find((t: any) => t.factor_id === 'factor-a');
    expect(factorAThreshold).toBeDefined();
    expect(factorAThreshold.affected_options).toHaveLength(2);
    // Sorted by option_id
    expect(factorAThreshold.affected_options[0].option_id).toBe('opt1');
    expect(factorAThreshold.affected_options[1].option_id).toBe('opt2');
    // Labels enriched from options
    expect(factorAThreshold.affected_options[0].option_label).toBe('Increase Marketing');
    expect(factorAThreshold.affected_options[1].option_label).toBe('Boost Hiring');
  });

  // -------------------------------------------------------------------------
  // Test 8: Same factor_id tie-broken by threshold_value (ascending)
  // -------------------------------------------------------------------------
  it('same factor_id → sorted by ascending threshold_value', async () => {
    // Return two thresholds for the SAME factor with different threshold_values
    const originalCall = mockISLService.callAnalysisEndpoint;
    mockISLService.callAnalysisEndpoint = async function <T>(endpoint: string, body: any): Promise<any> {
      if (endpoint === '/api/v1/analysis/thresholds') {
        thresholdEndpointCalled = true;
        return {
          data: {
            thresholds: [
              {
                sweep_id: 'sweep-high',
                node_id: 'factor-a',
                parameter: 'value',
                threshold_value: 0.9,       // higher value, listed first
                crossing_type: 'rising',
                options_affected: ['opt1'],
                description: 'High breakpoint',
              },
              {
                sweep_id: 'sweep-low',
                node_id: 'factor-a',
                parameter: 'value',
                threshold_value: 0.3,       // lower value, listed second
                crossing_type: 'falling',
                options_affected: ['opt2'],
                description: 'Low breakpoint',
              },
            ],
            sensitivity_ranking: [],
            summary: 'Two piecewise breakpoints for same factor',
          } as T,
          error: null,
          latency_ms: 10,
        };
      }
      return originalCall.call(this, endpoint, body);
    };

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v2/run',
        headers: { 'Content-Type': 'application/json' },
        payload: JSON.stringify({ ...BASE_PAYLOAD, include_thresholds: true }),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      expect(body.thresholds_status).toBe('computed');
      expect(body.threshold_analysis).toHaveLength(2);

      // Both share factor_id 'factor-a' — must be sorted by threshold_value ascending
      expect(body.threshold_analysis[0].factor_id).toBe('factor-a');
      expect(body.threshold_analysis[0].threshold_value).toBe(0.3);
      expect(body.threshold_analysis[0].crossing_direction).toBe('below');

      expect(body.threshold_analysis[1].factor_id).toBe('factor-a');
      expect(body.threshold_analysis[1].threshold_value).toBe(0.9);
      expect(body.threshold_analysis[1].crossing_direction).toBe('above');
    } finally {
      mockISLService.callAnalysisEndpoint = originalCall;
    }
  });
});
