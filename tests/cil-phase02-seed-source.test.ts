/**
 * CIL Phase 0.2 — seed_source metadata
 *
 * Tests that response meta includes seed_source indicating whether seed was
 * user-provided or internally derived.
 */

import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// X.1.3 ISL Mock — returns controlled seed_used to test adoption
// ---------------------------------------------------------------------------

const ISL_OVERRIDE_SEED = '999';

const seedOverrideMockISL = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high',
      adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock validation', reasoning: 'Test' }, source: 'isl',
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
      factors: [],
      value_of_information: [],
      factors_provenance: 'unavailable' as const,
      factor_sensitivity_status: 'skipped_no_factor_values' as const,
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
        seed_used: ISL_OVERRIDE_SEED,
        options: options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: { mean: 0.65 + idx * 0.12, std: 0.08, p10: 0.45, p50: 0.65, p90: 0.85, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
          rank: idx + 1,
        })),
        edges: [
          { from: 'factor-a', to: 'goal', sensitivity: 0.5, confidence: 0.8, direction: 'positive' },
          { from: 'factor-b', to: 'goal', sensitivity: -0.3, confidence: 0.7, direction: 'negative' },
        ],
        factors: [],
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
  return { ...actual, getISLService: () => seedOverrideMockISL, islService: seedOverrideMockISL };
});

import { createServer } from '../src/createServer.js';

// ---------------------------------------------------------------------------
// Spawn-server tests (existing)
// ---------------------------------------------------------------------------

describe('CIL Phase 0.2 — seed_source metadata', () => {
  let server: ServerHandle | null = null;

  const ENV = {
    TEST_ROUTES: '1',
    AUTH_ENABLED: '0',
    RATE_LIMIT_ENABLED: '0',
    ISL_BASE_URL: 'mock',
    ISL_MOCK_ENABLE: '1',
  };

  afterEach(async () => {
    await server?.kill();
    server = null;
  });

  const VALID_GRAPH = {
    nodes: [
      { id: 'factor-a', kind: 'factor', label: 'Factor A', observed_state: { value: 50 } },
      { id: 'factor-b', kind: 'factor', label: 'Factor B', observed_state: { value: 30 } },
      { id: 'goal', kind: 'goal', label: 'Goal' },
    ],
    edges: [
      { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
      { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
    ],
  };

  const VALID_OPTIONS = [
    {
      id: 'opt-a',
      label: 'Option A',
      interventions: { 'factor-a': { value: 0.8, source: 'user_specified' } },
    },
    {
      id: 'opt-b',
      label: 'Option B',
      interventions: { 'factor-b': { value: 0.7, source: 'user_specified' } },
    },
  ];

  it('seed_source is "provided" when user provides seed', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const res = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: VALID_GRAPH,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
      }),
    });

    expect(res.status).toBe(200);
    expect(res.data.meta.seed_source).toBe('client_generated');
    expect(res.data.meta.seed_used).toBe('42');
  });

  it('seed_source is "derived" when no seed provided', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const res = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: VALID_GRAPH,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        // No seed provided
      }),
    });

    expect(res.status).toBe(200);
    expect(res.data.meta.seed_source).toBe('server_generated');
    expect(res.data.meta.seed_used).toBeDefined(); // Should have a derived seed
  });

  it('seed_source is "provided" when user provides numeric seed', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const res = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: VALID_GRAPH,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        seed: 4242,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.data.meta.seed_source).toBe('client_generated');
    expect(res.data.meta.seed_used).toBe('4242'); // Converted to string
  });
});

// ---------------------------------------------------------------------------
// X.1.3: ISL seed adoption — uses vi.mock + createServer (in-process)
// ---------------------------------------------------------------------------

describe('CIL Phase 0.2 — X.1.3 seed adoption', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
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
      { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
    ],
  };

  const OPTIONS = [
    { id: 'opt-a', label: 'Option A', interventions: { 'factor-a': { value: 0.8, source: 'user_specified' } } },
    { id: 'opt-b', label: 'Option B', interventions: { 'factor-b': { value: 0.7, source: 'user_specified' } } },
  ];

  it('adopts ISL seed_used when different from PLoT seed', async () => {
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
    // PLoT sent seed 42 but ISL returned seed_used: 999
    // Platform Contract §5.2: PLoT must adopt ISL's value
    expect(body.meta.seed_used).toBe(ISL_OVERRIDE_SEED);
    expect(body.meta.seed_source).toBe('client_generated');
  });
});
