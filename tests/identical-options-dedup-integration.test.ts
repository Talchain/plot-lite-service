/**
 * IDENTICAL_OPTIONS Deduplication Integration Test
 *
 * Verifies the full /v2/run pipeline when options are deduplicated:
 * - 3 options (2 identical + 1 different) → 200 with IDENTICAL_OPTIONS_DEDUPED warning
 * - Deduplicated options flow to ISL (only 2 unique options in ISL request)
 *
 * Uses vi.mock to intercept the ISL service and capture the request body.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// ISL Mock — captures the request body for assertion
// ---------------------------------------------------------------------------

let capturedISLRequestBody: any = null;

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
      })),
      edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factors: [], value_of_information: [],
      factors_provenance: 'unavailable' as const,
      factor_sensitivity_status: 'skipped_no_factor_values' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.8,
      fragile_edges: [], robust_edges: [], latency_ms: 50, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    capturedISLRequestBody = body;
    const options = body.options || [];
    return {
      data: {
        options: options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
          rank: idx + 1,
        })),
        edges: [], factors: [], value_of_information: [],
        overall_robustness: 'robust', robustness_score: 0.8,
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
// Fixtures
// ---------------------------------------------------------------------------

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'factor-a', kind: 'factor', label: 'Marketing Spend', observed_state: { value: 0.6 } },
    { id: 'factor-b', kind: 'factor', label: 'Customer Churn', observed_state: { value: 0.5 } },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
    { from: 'factor-b', to: 'goal', strength: { mean: -0.5, std: 0.1 } },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IDENTICAL_OPTIONS dedup integration', () => {
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
    capturedISLRequestBody = null;
  });

  it('3 options (2 identical + 1 different) → 200 with dedup warning, ISL gets 2 options', async () => {
    capturedISLRequestBody = null;

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: GRAPH,
        options: [
          { id: 'opt1', label: 'Option A', interventions: { 'factor-a': 1.5 } },
          { id: 'opt2', label: 'Option B', interventions: { 'factor-a': 1.5 } }, // identical to opt1
          { id: 'opt3', label: 'Option C', interventions: { 'factor-b': 0.2 } }, // different
        ],
        goal_node_id: 'goal',
        seed: '42',
      }),
    });

    expect(res.status).toBe(200);

    const body = await res.json() as any;

    // IDENTICAL_OPTIONS_DEDUPED warning should be in critiques
    const dedupWarning = body.critiques?.find((c: any) => c.code === 'IDENTICAL_OPTIONS_DEDUPED');
    expect(dedupWarning).toBeDefined();
    expect(dedupWarning.severity).toBe('warning');
    expect(dedupWarning.affected_option_ids).toEqual(['opt1', 'opt2']);

    // ISL should have received only 2 unique options (opt1, opt3)
    expect(capturedISLRequestBody).not.toBeNull();
    const islOptions = capturedISLRequestBody.options ?? [];
    expect(islOptions).toHaveLength(2);
    expect(islOptions.map((o: any) => o.id).sort()).toEqual(['opt1', 'opt3']);

    // Response should have 2 option comparisons (not 3)
    const optionResults = body.option_comparison ?? [];
    expect(optionResults).toHaveLength(2);
  });

  it('2 identical options → 422 with IDENTICAL_OPTIONS blocker + IDENTICAL_OPTIONS_DEDUPED warning', async () => {
    capturedISLRequestBody = null;

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: GRAPH,
        options: [
          { id: 'opt1', label: 'Option A', interventions: { 'factor-a': 1.5 } },
          { id: 'opt2', label: 'Option B', interventions: { 'factor-a': 1.5 } }, // identical
        ],
        goal_node_id: 'goal',
        seed: '42',
      }),
    });

    expect(res.status).toBe(422);

    const body = await res.json() as any;
    expect(body.analysis_status).toBe('blocked');

    // Blocker critique
    expect(body.critiques.some((c: any) => c.code === 'IDENTICAL_OPTIONS')).toBe(true);

    // Dedup warning also present
    expect(body.critiques.some((c: any) => c.code === 'IDENTICAL_OPTIONS_DEDUPED')).toBe(true);
  });
});
