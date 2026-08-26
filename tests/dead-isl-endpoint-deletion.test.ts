/**
 * Dead-ISL-endpoint deletion (Lane 3, Science & Value contracts).
 *
 * Two PLoT call sites addressed ISL endpoints that are NOT MOUNTED in
 * Inference-Service-Layer at staging 28fe0c95:
 *
 *   1. POST /api/v1/analysis/thresholds   (V2 run, "Phase 6b" threshold analysis)
 *      - ISL src/api/main.py:74  `# from .threshold import router as threshold_router`   COMMENTED
 *      - ISL src/api/main.py:792 `# app.include_router(threshold_router, ...)`            COMMENTED
 *      - AND the payload PLoT sent could never validate: ISL's
 *        ThresholdIdentificationRequest (src/models/requests.py:1687) makes
 *        `parameter_sweeps` REQUIRED (min_length=1); PLoT sent
 *        {graph, options, seed, goal_node_id, request_id} — no parameter_sweeps.
 *
 *   2. POST /api/v1/causal/validate       (V1 run, causal validator)
 *      - ISL src/api/main.py:64  `# from .causal import router as causal_router`          COMMENTED
 *      - ISL src/api/main.py:782 `# app.include_router(causal_router, ...)`               COMMENTED
 *      - ISL's own comment (main.py:765-770) names `validate` as deliberately dark.
 *
 * Both were guarantee theatre: a live network call, retries and a request budget
 * spent to reach a route that cannot answer. The pre-existing suite
 * (tests/threshold-analysis.test.ts) was GREEN throughout, because it asserts
 * against a hand-written mock of a response ISL cannot produce — a self-authored
 * fixture is not evidence about the wire.
 *
 * These tests name the BEHAVIOURAL consequence of the deletion, so they RED at
 * pristine and GREEN after it.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Recorder: every ISL analysis endpoint the route asks for, in order.
// ---------------------------------------------------------------------------
const analysisEndpointsCalled: string[] = [];

const mockISLService = {
  isEnabled: () => true,
  isAvailable: async () => true,
  async validateCausal() {
    return {
      status: 'unavailable' as const,
      confidence: 'low' as const,
      explanation: { summary: 'ISL validation unavailable', reasoning: 'mock' },
      source: 'engine_fallback' as const,
    };
  },
  async analyseSensitivity() {
    return { edges: [], latency_ms: 0, source: 'unavailable' as const };
  },
  async analyseRobustness() {
    return {
      options: [], edges: [], factors: [], value_of_information: [],
      robustness_label: 'robust' as const, robustness_score: 0.82,
      fragile_edges: [], robust_edges: [],
      latency_ms: 42, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return {
      factors: [], value_of_information: [], robustness_label: 'robust' as const,
      robustness_score: 0.82, latency_ms: 0, source: 'unavailable' as const,
    };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },

  async callAnalysisEndpoint<T>(endpoint: string, body: any): Promise<{ data: T | null; error: any; latency_ms: number }> {
    analysisEndpointsCalled.push(endpoint);

    if (endpoint === '/api/v1/analysis/thresholds') {
      // Deliberately answer as the UNMOUNTED route really would: no data.
      // Success-shaped mocking here is exactly what hid the defect before.
      return {
        data: null,
        error: { code: 'ISL_HTTP_404', message: 'Not Found' },
        latency_ms: 5,
      };
    }

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
        edges: [], factors: [], value_of_information: [],
        overall_robustness: 'robust', robustness_score: 0.82,
        robustness: { score: 0.82, label: 'robust', fragile_edges: [], robust_edges: [] },
        fragile_edges: [], robust_edges: [],
      } as T,
      error: null,
      latency_ms: 42,
    };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';

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
  seed: 'lane3-deletion-seed',
};

describe('Lane 3 — dead ISL endpoint deletion', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.ready();
    // src/routes/v2/run.ts is ~470 KB; a cold transform of its module graph
    // exceeds vitest's 10s default hook timeout on a first (uncached) run.
    // Measured at PRISTINE as well as on this branch, so it is a harness timing
    // fact, not a property of the change under test.
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  beforeEach(() => {
    analysisEndpointsCalled.length = 0;
  });

  // -------------------------------------------------------------------------
  // RED at pristine: the route calls the unmounted endpoint.
  // -------------------------------------------------------------------------
  it('include_thresholds: true → PLoT makes NO call to the unmounted /api/v1/analysis/thresholds', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      payload: { ...BASE_PAYLOAD, include_thresholds: true },
    });

    expect(res.statusCode).toBe(200);

    // Bind by IDENTITY (the exact endpoint path), never by a count another
    // endpoint could satisfy.
    expect(analysisEndpointsCalled).not.toContain('/api/v1/analysis/thresholds');

    // Positive control on the SAME recorder, same execution context: the live
    // mounted robustness endpoint IS still called. Without this, a recorder that
    // silently stopped recording would pass the assertion above by being blind.
    expect(analysisEndpointsCalled).toContain('/api/v1/robustness/analyze/v2');
  });

  // -------------------------------------------------------------------------
  // The deletion must not become a SILENT drop: a caller that asked for
  // thresholds must still be told, on the wire, that it is not available.
  // -------------------------------------------------------------------------
  it('include_thresholds: true → response still DISCLOSES unavailability (never silently omits)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      payload: { ...BASE_PAYLOAD, include_thresholds: true },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.thresholds_status).toBeDefined();
    expect(body.thresholds_status).not.toBe('computed');
    expect(body.thresholds_status).not.toBe('not_requested');
    // No fabricated rows may accompany an unavailable capability.
    expect(body.threshold_analysis).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // include_thresholds absent → unchanged: no disclosure fields at all.
  // Discriminates the deletion from "always emit a status".
  // -------------------------------------------------------------------------
  it('include_thresholds absent → no thresholds disclosure fields and no threshold call', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      payload: { ...BASE_PAYLOAD },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.thresholds_status).toBeUndefined();
    expect(body.threshold_analysis).toBeUndefined();
    expect(analysisEndpointsCalled).not.toContain('/api/v1/analysis/thresholds');
    expect(analysisEndpointsCalled).toContain('/api/v1/robustness/analyze/v2');
  });
});
