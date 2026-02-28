/**
 * V2 Legacy CEE Skip Tests
 *
 * Tests that when DECISION_REVIEW_ENABLE=true, legacy CEE /review + /options
 * calls are skipped (saving ~110ms latency since they fail with 400).
 *
 * Uses vi.mock for ISL to ensure V2 reaches the CEE code path.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Mock ISL service to return valid V2 responses
const mockISLService = {
  isEnabled(): boolean {
    return true;
  },
  async isAvailable(): Promise<boolean> {
    return true;
  },
  async validateCausal() {
    return {
      status: 'identifiable',
      confidence: 'high',
      adjustment_sets: [],
      minimal_set: [],
      backdoor_paths: [],
      issues: [],
      explanation: { summary: 'Mock ISL validation', reasoning: 'Test stub' },
      source: 'isl',
    };
  },
  async analyseSensitivity() {
    return {
      overall_robustness: 'robust',
      sensitive_parameters: [],
      recommendations: [],
      source: 'isl',
    };
  },
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[], _requestId: string) {
    // Return mock V2 robustness analysis with option results
    return {
      options: options.map((opt: any, idx: number) => ({
        option_id: opt.id,
        outcome: {
          mean: 0.7 + idx * 0.1,
          std: 0.1,
          p10: 0.5,
          p50: 0.7,
          p90: 0.9,
          n_samples: 1000,
          n_valid_samples: 1000,
          validity_ratio: 1.0,
        },
        rank: idx + 1,
      })),
      edges: [],
      edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factors: [],
      value_of_information: [],
      factors_provenance: 'unavailable' as const,
      factor_sensitivity_status: 'skipped_no_factor_values' as const,
      overall_robustness: 'robust' as const,
      robustness_score: 0.8,
      fragile_edges: [],
      robust_edges: [],
      latency_ms: 50,
      source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return {
      factors: [],
      value_of_information: [],
      robustness_label: 'robust' as const,
      robustness_score: 0.8,
      latency_ms: 0,
      source: 'unavailable' as const,
    };
  },
  async computeCounterfactual(): Promise<never> {
    throw new Error('computeCounterfactual should not be called');
  },
  // Generic analysis endpoint caller (used by V2 run)
  async callAnalysisEndpoint<T>(_endpoint: string, body: any, _requestId: string): Promise<{ data: T | null; error: string | null }> {
    // Return mock V2 robustness response for the analyze endpoint
    const options = body.options || [];
    return {
      data: {
        options: options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: {
            mean: 0.7 + idx * 0.1,
            std: 0.1,
            p10: 0.5,
            p50: 0.7,
            p90: 0.9,
            n_samples: 1000,
            n_valid_samples: 1000,
            validity_ratio: 1.0,
          },
          rank: idx + 1,
        })),
        edges: [],
        factors: [],
        value_of_information: [],
        overall_robustness: 'robust',
        robustness_score: 0.8,
        fragile_edges: [],
        robust_edges: [],
      } as T,
      error: null,
    };
  },
};

// Mock the ISL module BEFORE importing createServer
vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return {
    ...actual,
    getISLService: () => mockISLService,
    islService: mockISLService,
  };
});

import { createServer } from '../src/createServer.js';

describe('/v2/run Legacy CEE Skip Behavior', () => {
  // V2 payload for testing
  const v2Payload = {
    graph: {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Maximize Revenue' },
        { id: 'factor_a', kind: 'factor', label: 'Market Size' },
        { id: 'factor_b', kind: 'factor', label: 'Competition' },
      ],
      edges: [
        { from: 'factor_a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
        { from: 'factor_b', to: 'goal', strength: { mean: -0.3, std: 0.1 } },
      ],
    },
    options: [
      { id: 'opt_a', label: 'Option A', interventions: { factor_a: 0.8 } },
      { id: 'opt_b', label: 'Option B', interventions: { factor_a: 0.4, factor_b: 0.6 } },
    ],
    goal_node_id: 'goal',
    brief: 'Comparing market expansion strategies.',
    seed: 42,
  };

  describe('when DECISION_REVIEW_ENABLE=true', () => {
    let app: FastifyInstance;
    let baseUrl: string;

    beforeAll(async () => {
      // M2 Decision Review enabled - legacy CEE should be skipped
      process.env.DECISION_REVIEW_ENABLE = 'true';
      process.env.CEE_BASE_URL = 'http://127.0.0.1:1'; // unreachable (but shouldn't be called)
      process.env.CEE_API_KEY = 'test-legacy-skip-key';
      process.env.CEE_TIMEOUT_MS = '100';
      process.env.RATE_LIMIT_ENABLED = '0';

      app = await createServer();
      await app.listen({ port: 0, host: '127.0.0.1' });
      const addr = app.server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
      await app?.close();
      delete process.env.DECISION_REVIEW_ENABLE;
      delete process.env.CEE_BASE_URL;
      delete process.env.CEE_API_KEY;
      delete process.env.CEE_TIMEOUT_MS;
      delete process.env.RATE_LIMIT_ENABLED;
    });

    it('skips legacy CEE /review + /options calls (cee_status=skipped)', async () => {
      const res = await fetch(`${baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(v2Payload),
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      // Core response present
      expect(body.analysis_status).toBeDefined();

      // Legacy CEE should be skipped when M2 is enabled
      expect(body.cee_status).toBe('skipped');

      // M2 decision review should be present
      expect(body.review_status).toBeDefined();
    });

    it('cee_trace shows M2-enabled skip reason', async () => {
      const res = await fetch(`${baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(v2Payload),
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      // cee_trace should indicate legacy was skipped for M2
      expect(body.ceeTrace).toBeDefined();
      expect(body.ceeTrace.reason).toContain('M2');
      expect(body.ceeTrace.degraded).toBe(false);
    });
  });

  describe('when DECISION_REVIEW_ENABLE=false', () => {
    let app: FastifyInstance;
    let baseUrl: string;

    beforeAll(async () => {
      // M2 disabled - legacy CEE path should be preserved
      process.env.DECISION_REVIEW_ENABLE = 'false';
      // Enable legacy CEE orchestrator (required for legacy path to be taken)
      process.env.CEE_ORCHESTRATOR_ENABLED = '1';
      process.env.CEE_BASE_URL = 'http://127.0.0.1:1'; // unreachable → forces degraded
      process.env.CEE_API_KEY = 'test-legacy-preserved-key';
      process.env.CEE_TIMEOUT_MS = '100';
      process.env.RATE_LIMIT_ENABLED = '0';

      app = await createServer();
      await app.listen({ port: 0, host: '127.0.0.1' });
      const addr = app.server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
      await app?.close();
      delete process.env.DECISION_REVIEW_ENABLE;
      delete process.env.CEE_ORCHESTRATOR_ENABLED;
      delete process.env.CEE_BASE_URL;
      delete process.env.CEE_API_KEY;
      delete process.env.CEE_TIMEOUT_MS;
      delete process.env.RATE_LIMIT_ENABLED;
    });

    it('preserves legacy CEE path (cee_status NOT skipped)', async () => {
      const res = await fetch(`${baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(v2Payload),
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      // Core response present
      expect(body.analysis_status).toBeDefined();

      // Legacy CEE should NOT be skipped when M2 is disabled
      // It will be 'unavailable' or 'degraded' (due to unreachable CEE) but NOT 'skipped'
      expect(body.cee_status).toBeDefined();
      expect(body.cee_status).not.toBe('skipped');

      // M2 decision review should be disabled
      expect(body.review_status).toBe('disabled');
    });
  });
});
