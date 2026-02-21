/**
 * 3A-trust: Route-Level Critique Integration Test (T7a)
 *
 * Verifies that the full /v2/run pipeline emits both:
 * - IDENTIFIABILITY_WARNING (when pairs are not backdoor-identifiable)
 * - UNMEASURED_CONFOUNDING_WARNING (when bidirected edges caused it)
 *
 * Uses vi.mock to intercept ISL service, same pattern as
 * identical-options-dedup-integration.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// ISL Mock — returns valid robustness results so the pipeline completes
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

/** Graph with bidirected edge between treatment and outcome → non-identifiable */
const BIDIRECTED_GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'factor-a', kind: 'factor', label: 'Marketing Spend', observed_state: { value: 0.6 } },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
    { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 }, edge_type: 'bidirected' },
  ],
};

/** Same graph but directed-only → identifiable */
const DIRECTED_ONLY_GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'factor-a', kind: 'factor', label: 'Marketing Spend', observed_state: { value: 0.6 } },
    { id: 'factor-b', kind: 'factor', label: 'Customer Churn', observed_state: { value: 0.5 } },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
    { from: 'factor-b', to: 'goal', strength: { mean: -0.3, std: 0.1 } },
  ],
};

const OPTIONS_BIDIRECTED = [
  { id: 'opt1', label: 'Option A', interventions: { 'factor-a': { value: 10, source: 'user_specified' } } },
  { id: 'opt2', label: 'Option B', interventions: { 'factor-a': { value: 20, source: 'user_specified' } } },
];

const OPTIONS_DIRECTED = [
  { id: 'opt1', label: 'Option A', interventions: { 'factor-a': { value: 10, source: 'user_specified' } } },
  { id: 'opt2', label: 'Option B', interventions: { 'factor-b': { value: 5, source: 'user_specified' } } },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('3A-trust: Route-level critique emission (T7a)', () => {
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
  });

  it('bidirected graph emits both IDENTIFIABILITY_WARNING and UNMEASURED_CONFOUNDING_WARNING', async () => {
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: BIDIRECTED_GRAPH,
        options: OPTIONS_BIDIRECTED,
        goal_node_id: 'goal',
        seed: '42',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;

    // Both warnings should be present in critiques
    const critiques = body.critiques ?? [];
    const identWarning = critiques.find((c: any) => c.code === 'IDENTIFIABILITY_WARNING');
    const confoundWarning = critiques.find((c: any) => c.code === 'UNMEASURED_CONFOUNDING_WARNING');

    expect(identWarning).toBeDefined();
    expect(identWarning.severity).toBe('warning');
    expect(identWarning.blocks_analysis).toBe(false);

    expect(confoundWarning).toBeDefined();
    expect(confoundWarning.severity).toBe('warning');
    expect(confoundWarning.blocks_analysis).toBe(false);
    expect(confoundWarning.message).toContain('unmeasured confounding');
  });

  it('directed-only graph does NOT emit UNMEASURED_CONFOUNDING_WARNING', async () => {
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: DIRECTED_ONLY_GRAPH,
        options: OPTIONS_DIRECTED,
        goal_node_id: 'goal',
        seed: '42',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;

    const critiques = body.critiques ?? [];
    const confoundWarning = critiques.find((c: any) => c.code === 'UNMEASURED_CONFOUNDING_WARNING');
    expect(confoundWarning).toBeUndefined();
  });
});
