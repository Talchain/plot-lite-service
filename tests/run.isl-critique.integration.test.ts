/**
 * ISL → Critique Integration Tests
 *
 * Verifies that /v1/run maps ISL validation and sensitivity results into
 * critique items, and that failures in ISL do not break the endpoint.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Lightweight ISL service stub used via module mock
const fakeISLService = {
  isEnabled(): boolean {
    return true;
  },
  async isAvailable(): Promise<boolean> {
    return true;
  },
  async validateCausal(_graph: any, _treatment: string, _outcome: string, _requestId: string) {
    if (process.env.TEST_ISL_MODE === 'error') {
      throw new Error('simulated ISL validation error');
    }

    return {
      status: 'cannot_identify',
      confidence: 'low',
      adjustment_sets: [],
      minimal_set: [],
      backdoor_paths: [],
      issues: [
        {
          type: 'test_issue',
          description: 'Test ISL issue: unblocked backdoor path',
          affected_nodes: ['A', 'B'],
          suggested_action: 'Adjust for confounder node C',
        },
      ],
      explanation: {
        summary: 'Cannot identify causal effect in test graph',
        reasoning: 'Test reasoning from ISL stub',
      },
      source: 'isl',
    };
  },
  async analyseSensitivity(_graph: any, _treatment: string, _outcome: string, _requestId: string) {
    if (process.env.TEST_ISL_MODE === 'error') {
      throw new Error('simulated ISL sensitivity error');
    }

    return {
      overall_robustness: 'fragile',
      sensitive_parameters: [
        {
          parameter: 'beta_AB',
          sensitivity: 0.9,
          impact_direction: 'positive',
        },
      ],
      recommendations: ['Test recommendation: stabilise key parameter beta_AB'],
      source: 'isl',
    };
  },
  async analyseRobustness(_graph: any, _goalNodeId: string, _options: any[], _requestId: string) {
    if (process.env.TEST_ISL_MODE === 'error') {
      throw new Error('simulated ISL robustness error');
    }

    return {
      edges: [
        {
          edge_id: 'A::B',
          from: 'A',
          to: 'B',
          elasticity: 0.9,
          interpretation: 'Increasing this edge increases outcome',
        },
      ],
      edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factors: [],
      value_of_information: [],
      factors_provenance: 'unavailable' as const,
      factor_sensitivity_status: 'skipped_no_factor_values' as const,
      overall_robustness: 'fragile' as const,
      robustness_score: 0.3,
      fragile_edges: ['A::B'],
      robust_edges: [],
      latency_ms: 100,
      source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity(_graph: any, _parameterUncertainties: any[], _goalNodeId: string, _options: any[], _requestId: string) {
    return {
      factors: [],
      value_of_information: [],
      robustness_label: 'moderate' as const,
      robustness_score: 0.5,
      latency_ms: 0,
      source: 'unavailable' as const,
    };
  },
  // Not used by /v1/run in these tests
  async computeCounterfactual(): Promise<never> {
    throw new Error('computeCounterfactual should not be called in ISL critique tests');
  },
};

vi.mock('../src/integrations/isl/index.js', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.js');
  return {
    ...actual,
    getISLService: () => fakeISLService,
    islService: fakeISLService,
  };
});

import { createServer } from '../src/createServer.js';

describe('/v1/run ISL → critique integration', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLE = '0';

    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLE;
    delete process.env.TEST_ISL_MODE;
  });

  it('attaches ISL-derived critique items when ISL returns issues', async () => {
    delete process.env.TEST_ISL_MODE;

    const payload = {
      graph: {
        nodes: [
          { id: 'A', label: 'Input' },
          { id: 'B', label: 'Output' },
          { id: 'C', label: 'Confounder' },
        ],
        edges: [
          { from: 'A', to: 'B', weight: 0.5 },
          { from: 'C', to: 'A', weight: 0.4 },
          { from: 'C', to: 'B', weight: 0.4 },
        ],
      },
      seed: 123,
      outcome_node: 'B',
      detail_level: 'deep',
    };

    const res = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.critique)).toBe(true);
    const messages = (body.critique as any[]).map((c) => String(c.message || ''));

    expect(
      messages.some((m) =>
        m.includes('ISL validation indicates the causal effect cannot be identified')
      ),
    ).toBe(true);

    expect(
      messages.some((m) =>
        m.includes('ISL sensitivity analysis indicates fragile estimates')
      ),
    ).toBe(true);
  });

  it('continues without ISL-derived critique when ISL throws', async () => {
    process.env.TEST_ISL_MODE = 'error';

    const payload = {
      graph: {
        nodes: [
          { id: 'A', label: 'Input' },
          { id: 'B', label: 'Output' },
        ],
        edges: [
          { from: 'A', to: 'B', weight: 0.5 },
        ],
      },
      seed: 456,
      outcome_node: 'B',
      detail_level: 'deep',
    };

    const res = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.critique)).toBe(true);
    const messages = (body.critique as any[]).map((c) => String(c.message || ''));

    expect(
      messages.some((m) =>
        m.includes('ISL validation indicates the causal effect cannot be identified')
      ),
    ).toBe(false);
  });
});
