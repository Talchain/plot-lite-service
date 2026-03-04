/**
 * PLoT Tier 1 — Error shapes + seed authority contracts
 *
 * Task 1: buildV2RunError helper — blocked (422) responses include retryable + meta
 * Task 2: ISL errors → V2RunError (retryableFromIslStatus + outermost catch safety net)
 * Task 3: PLoT is seed authority — ISL seed_used never overrides plotSeedUsed
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// ISL mock — default success path
// ---------------------------------------------------------------------------

let mockISLBehaviour: 'success' | 'null_data' | 'throw_500' | 'throw_401' | 'throw_429' | 'throw_404' | 'throw_timeout' | 'analysis_failed' = 'success';
let mockISLSeedUsed: string | number | undefined = undefined;

import { ISLHttpError } from '../src/integrations/isl/errors.js';

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable' as const,
      confidence: 'high' as const,
      adjustment_sets: [],
      minimal_set: [],
      backdoor_paths: [],
      issues: [],
      explanation: { summary: 'ok', reasoning: 'ok' },
      source: 'isl' as const,
    };
  },
  async analyseSensitivity() {
    return {
      overall_robustness: 'robust' as const,
      sensitive_parameters: [],
      recommendations: [],
      source: 'isl' as const,
    };
  },
  async analyseRobustness() {
    return {
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
      latency_ms: 0,
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
    throw new Error('not called in these tests');
  },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<any> {
    const options = (body.options || []);

    if (mockISLBehaviour === 'throw_500') {
      throw new ISLHttpError(500, 'Internal Server Error', _endpoint);
    }
    if (mockISLBehaviour === 'throw_401') {
      throw new ISLHttpError(401, 'Unauthorized', _endpoint);
    }
    if (mockISLBehaviour === 'throw_429') {
      throw new ISLHttpError(429, 'Rate Limited', _endpoint);
    }
    if (mockISLBehaviour === 'throw_404') {
      throw new ISLHttpError(404, 'Not Found', _endpoint);
    }
    if (mockISLBehaviour === 'throw_timeout') {
      throw new Error('AbortError: The operation was aborted');
    }
    if (mockISLBehaviour === 'null_data') {
      return {
        data: null,
        error: { code: 'ISL_ERROR', message: 'ISL unavailable', retryable: true },
        latency_ms: 0,
      };
    }
    if (mockISLBehaviour === 'analysis_failed') {
      return {
        data: {
          analysis_status: 'failed',
          status_reason: 'ISL could not complete analysis',
          options: [],
          edges: [],
          factors: [],
          overall_robustness: 'fragile',
          fragile_edges: [],
          robust_edges: [],
        } as T,
        latency_ms: 0,
      };
    }

    // Default: success
    const responseData: any = {
      options: options.map((opt: any, idx: number) => ({
        option_id: opt.id,
        outcome: { mean: 0.7 + idx * 0.05, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
        rank: idx + 1,
      })),
      edges: [],
      factors: [],
      overall_robustness: 'robust',
      robustness_score: 0.8,
      fragile_edges: [],
      robust_edges: [],
    };
    if (mockISLSeedUsed !== undefined) {
      responseData.seed_used = mockISLSeedUsed;
    }
    return { data: responseData as T, latency_ms: 0 };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return {
    ...actual,
    getISLService: () => mockISLService,
    islService: mockISLService,
  };
});

import { createServer } from '../src/createServer.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'factor-a', kind: 'factor', label: 'Market Size', observed_state: { value: 50 } },
    { id: 'factor-b', kind: 'factor', label: 'Retention', observed_state: { value: 30 } },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
    { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': { value: 1.5, source: 'user_specified' } } },
  { id: 'opt2', label: 'Option 2', interventions: { 'factor-b': { value: 2.0, source: 'user_specified' } } },
];

const BASE_PAYLOAD = {
  graph: GRAPH,
  options: OPTIONS,
  goal_node_id: 'goal',
  seed: '12345',
};

async function postV2Run(app: FastifyInstance, payload = BASE_PAYLOAD) {
  const res = await app.inject({
    method: 'POST',
    url: '/v2/run',
    headers: { 'content-type': 'application/json' },
    payload,
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('V2RunError shapes + seed authority (PLoT Tier 1)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';

    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
    delete process.env.DECISION_REVIEW_ENABLE;
  });

  // Reset state before each test
  beforeAll(() => {
    mockISLBehaviour = 'success';
    mockISLSeedUsed = undefined;
  });

  // ==========================================================================
  // Task 1: Blocked response shape (V2 contract)
  // ==========================================================================

  describe('Task 1: blocked (422) response shape', () => {
    it('blocked response includes retryable: false', async () => {
      // Trigger a blocked response via missing goal node
      const { status, body } = await postV2Run(app, {
        ...BASE_PAYLOAD,
        goal_node_id: 'nonexistent-goal',
      });

      expect(status).toBe(422);
      expect(body.analysis_status).toBe('blocked');
      expect(body.retryable).toBe(false);
    });

    it('blocked response includes meta.request_id as string', async () => {
      const { status, body } = await postV2Run(app, {
        ...BASE_PAYLOAD,
        goal_node_id: 'nonexistent-goal',
      });

      expect(status).toBe(422);
      expect(typeof body.meta?.request_id).toBe('string');
      expect(body.meta.request_id.length).toBeGreaterThan(0);
    });

    it('blocked response includes meta.computed_at as ISO-like string', async () => {
      const { status, body } = await postV2Run(app, {
        ...BASE_PAYLOAD,
        goal_node_id: 'nonexistent-goal',
      });

      expect(status).toBe(422);
      expect(typeof body.meta?.computed_at).toBe('string');
      // ISO-8601 date: contains at least a 'T' separator
      expect(body.meta.computed_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
    });

    it('blocked response preserves analysis_status blocked and robustness contract', async () => {
      const { status, body } = await postV2Run(app, {
        ...BASE_PAYLOAD,
        goal_node_id: 'nonexistent-goal',
      });

      expect(status).toBe(422);
      expect(body.analysis_status).toBe('blocked');
      // CIL 0.2: robustness with empty arrays
      expect(Array.isArray(body.robustness?.fragile_edges)).toBe(true);
      expect(Array.isArray(body.robustness?.robust_edges)).toBe(true);
    });

    it('blocked response via preflight failure includes retryable and meta', async () => {
      // Empty interventions trigger EMPTY_INTERVENTIONS preflight blocker
      const { status, body } = await postV2Run(app, {
        ...BASE_PAYLOAD,
        options: [
          { id: 'opt1', label: 'Option 1', interventions: {} },
          { id: 'opt2', label: 'Option 2', interventions: {} },
        ],
      });

      expect(status).toBe(422);
      expect(body.analysis_status).toBe('blocked');
      expect(body.retryable).toBe(false);
      expect(typeof body.meta?.request_id).toBe('string');
      expect(typeof body.meta?.computed_at).toBe('string');
    });
  });

  // ==========================================================================
  // Task 2: ISL error → V2RunError
  // ==========================================================================

  describe('Task 2: ISL errors map to V2RunError', () => {
    afterEach(() => {
      mockISLBehaviour = 'success';
      mockISLSeedUsed = undefined;
    });

    it('ISL returns null data (500-like) → V2RunError failed, retryable: true', async () => {
      mockISLBehaviour = 'null_data';

      const { status, body } = await postV2Run(app);

      expect(status).toBe(200);
      expect(body.analysis_status).toBe('failed');
      expect(body.retryable).toBe(true);
      expect(typeof body.meta?.request_id).toBe('string');
      expect(typeof body.meta?.computed_at).toBe('string');
    });

    it('ISL HTTP 500 (thrown) → V2RunError failed, retryable: true', async () => {
      mockISLBehaviour = 'throw_500';

      const { status, body } = await postV2Run(app);

      expect(status).toBe(200);
      expect(body.analysis_status).toBe('failed');
      expect(body.retryable).toBe(true);
      expect(typeof body.meta?.request_id).toBe('string');
    });

    it('ISL HTTP 401 (thrown) → V2RunError failed, retryable: false', async () => {
      mockISLBehaviour = 'throw_401';

      const { status, body } = await postV2Run(app);

      expect(status).toBe(200);
      expect(body.analysis_status).toBe('failed');
      expect(body.retryable).toBe(false);
      expect(typeof body.meta?.request_id).toBe('string');
    });

    it('ISL HTTP 429 (thrown) → V2RunError failed, retryable: true', async () => {
      mockISLBehaviour = 'throw_429';

      const { status, body } = await postV2Run(app);

      expect(status).toBe(200);
      expect(body.analysis_status).toBe('failed');
      expect(body.retryable).toBe(true);
      expect(typeof body.meta?.request_id).toBe('string');
    });

    it('ISL HTTP 404 (other 4xx) → V2RunError failed, retryable: false', async () => {
      mockISLBehaviour = 'throw_404';

      const { status, body } = await postV2Run(app);

      expect(status).toBe(200);
      expect(body.analysis_status).toBe('failed');
      expect(body.retryable).toBe(false);
      expect(typeof body.meta?.request_id).toBe('string');
    });

    it('Network timeout / generic throw → V2RunError failed, retryable: true', async () => {
      mockISLBehaviour = 'throw_timeout';

      const { status, body } = await postV2Run(app);

      expect(status).toBe(200);
      expect(body.analysis_status).toBe('failed');
      expect(body.retryable).toBe(true);
      expect(typeof body.meta?.request_id).toBe('string');
    });

    it('ISL analysis_status=failed (HTTP 200) → V2RunError failed, retryable: true', async () => {
      mockISLBehaviour = 'analysis_failed';

      const { status, body } = await postV2Run(app);

      expect(status).toBe(200);
      expect(body.analysis_status).toBe('failed');
      expect(body.retryable).toBe(true);
      expect(typeof body.meta?.request_id).toBe('string');
    });

    it('no error.v1 schema is returned from /v2/run for any failure mode', async () => {
      for (const behaviour of ['null_data', 'throw_500', 'throw_401', 'throw_429', 'throw_404', 'throw_timeout', 'analysis_failed'] as const) {
        mockISLBehaviour = behaviour;

        const { body } = await postV2Run(app);

        expect(body.schema).not.toBe('error.v1');
      }
    });
  });

  describe('Task 2: outermost safety net (unhandled throw)', () => {
    it('unhandled exception in handler → V2RunError (not error.v1)', async () => {
      // Mock callAnalysisEndpoint to throw a generic unexpected error
      const originalCallAnalysisEndpoint = mockISLService.callAnalysisEndpoint;
      (mockISLService as any).callAnalysisEndpoint = async () => {
        throw new Error('Unexpected internal error from test');
      };

      const { status, body } = await postV2Run(app);

      // Restore
      (mockISLService as any).callAnalysisEndpoint = originalCallAnalysisEndpoint;

      // Outermost catch returns V2RunError (HTTP 200), not error.v1 (HTTP 500)
      expect(status).toBe(200);
      expect(body.analysis_status).toBe('failed');
      expect(body.retryable).toBe(true);
      expect(typeof body.meta?.request_id).toBe('string');
      expect(body.schema).not.toBe('error.v1');
    });
  });

  // ==========================================================================
  // Task 3: PLoT seed authority
  // ==========================================================================

  describe('Task 3: PLoT seed authority', () => {
    afterEach(() => {
      mockISLBehaviour = 'success';
      mockISLSeedUsed = undefined;
    });

    it('response meta.seed_used equals the seed PLoT sent (not ISL returned seed)', async () => {
      // ISL returns a different seed_used
      mockISLSeedUsed = 'isl-different-seed-99999';

      const { status, body } = await postV2Run(app);

      expect(status).toBe(200);
      expect(body.analysis_status).not.toBe('blocked');

      // PLoT sent seed '12345' — response must echo that, not ISL's seed
      expect(body.meta?.seed_used).toBe('12345');
    });

    it('response meta.seed_used equals PLoT seed even when ISL returns a different seed', async () => {
      mockISLSeedUsed = 'isl-different-seed-99999';

      const { status, body } = await postV2Run(app);

      expect(status).toBe(200);
      // The important contract: response always uses PLoT's seed, not ISL's
      expect(body.meta?.seed_used).toBe('12345');
    });

    it('response meta.seed_used equals PLoT seed when ISL returns same seed', async () => {
      // ISL echoes back the same seed PLoT sent
      mockISLSeedUsed = '12345';

      const { status, body } = await postV2Run(app);

      expect(status).toBe(200);
      expect(body.meta?.seed_used).toBe('12345');
    });

    it('response meta.seed_used equals PLoT seed when ISL returns no seed', async () => {
      // ISL does not return seed_used at all (undefined)
      mockISLSeedUsed = undefined;

      const { status, body } = await postV2Run(app);

      expect(status).toBe(200);
      expect(body.meta?.seed_used).toBe('12345');
    });
  });
});
