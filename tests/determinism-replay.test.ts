/**
 * Determinism Replay Test (B4.6)
 *
 * Verifies that PLoT's own processing (preflight, translation, response
 * assembly) is deterministic given the same inputs. Sends the same request
 * twice with the same seed and asserts identical results via canonicalCompare().
 *
 * ISL is mocked to return a fixed, deterministic response — this test
 * exercises PLoT determinism, not ISL determinism.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  canonicalCompare,
  DEFAULT_IGNORE_FIELDS,
} from './utils/canonical-compare.js';

// ---------------------------------------------------------------------------
// ISL Mock — deterministic responses keyed by option ID
// ---------------------------------------------------------------------------

const mockISLService = {
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
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
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
    { from: 'factor-b', to: 'goal', strength: { mean: -0.3, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt1', label: 'Increase Marketing', interventions: { 'factor-a': 0.8 } },
  { id: 'opt2', label: 'Reduce Churn', interventions: { 'factor-b': 0.3 } },
];

/** Volatile fields that vary between runs (timestamps, durations, UUIDs). */
const IGNORE_FIELDS = [
  ...DEFAULT_IGNORE_FIELDS,
  'timing',
  'latency_ms',
  'normalization_ms',
  'validation_ms',
  'isl_ms',
  'cee_ms',
  'id', // critique UUIDs
  'downstream_calls', // per-request ISL/CEE call traces (IDs, timings, payloads)
  'request_id_chain', // per-request UUID chain across services
  'requestId', // ceeTrace.requestId (per-request UUID)
  'timestamp', // ceeTrace.timestamp, downstream_calls timestamps
  'plot_request_id', // ceeTrace.plot_request_id (per-request UUID)
  'cee_sent_request_id', // ceeTrace.cee_sent_request_id (per-request UUID)
];

/** Sort arrays by their natural key so element order doesn't cause false mismatches. */
const SORT_ARRAYS_BY = {
  '$.option_comparison': 'option_id',
  '$.edge_sensitivity': 'edge_id',
  '$.factor_sensitivity': 'factor_id',
  '$.critiques': 'code',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Determinism replay (B4.6)', () => {
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

  it('same seed + same payload → canonicalCompare match, identical response_hash', async () => {
    const payload = JSON.stringify({
      graph: GRAPH,
      options: OPTIONS,
      goal_node_id: 'goal',
      seed: '42',
    });

    // Run 1
    const res1 = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload,
    });

    // Run 2 — identical payload
    const res2 = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload,
    });

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    const body1 = JSON.parse(res1.body);
    const body2 = JSON.parse(res2.body);

    // response_hash must be identical (string equality, no ignore)
    expect(body1.response_hash).toBeDefined();
    expect(body1.response_hash).toBe(body2.response_hash);

    // seed_used must be identical (nested under meta)
    expect(body1.meta.seed_used).toBe(body2.meta.seed_used);
    expect(body1.meta.seed_used).toBe('42');

    // Full canonical comparison (ignoring volatile fields)
    const result = canonicalCompare(body1, body2, {
      ignoreFields: IGNORE_FIELDS,
      sortArraysBy: SORT_ARRAYS_BY,
    });

    if (!result.match) {
      // Surface the first divergent path for debugging
      throw new Error(`Determinism failure: ${result.diff}`);
    }
    expect(result.match).toBe(true);
  });

  it('same seed + goal_constraints (no goal_threshold) → canonicalCompare match', async () => {
    const payload = JSON.stringify({
      graph: GRAPH,
      options: OPTIONS,
      goal_node_id: 'goal',
      seed: 'constraint-seed',
      goal_constraints: [
        { constraint_id: 'c1', node_id: 'goal', operator: '>=', value: 0.5 },
      ],
    });

    const res1 = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload,
    });

    const res2 = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload,
    });

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    const body1 = JSON.parse(res1.body);
    const body2 = JSON.parse(res2.body);

    // response_hash must be identical
    expect(body1.response_hash).toBeDefined();
    expect(body1.response_hash).toBe(body2.response_hash);

    // goal_threshold must be absent (XOR: constraints present → no threshold)
    expect(body1.goal_threshold).toBeUndefined();

    // Full canonical comparison
    const result = canonicalCompare(body1, body2, {
      ignoreFields: IGNORE_FIELDS,
      sortArraysBy: SORT_ARRAYS_BY,
    });

    if (!result.match) {
      throw new Error(`Determinism failure (constraints path): ${result.diff}`);
    }
    expect(result.match).toBe(true);
  });

  it('same payload + different seed → response_hash differs', async () => {
    const makePayload = (seed: string) => JSON.stringify({
      graph: GRAPH,
      options: OPTIONS,
      goal_node_id: 'goal',
      seed,
    });

    const res1 = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: makePayload('seed-alpha'),
    });

    const res2 = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: makePayload('seed-beta'),
    });

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    const body1 = JSON.parse(res1.body);
    const body2 = JSON.parse(res2.body);

    // Seeds should be echoed correctly (nested under meta)
    expect(body1.meta.seed_used).toBe('seed-alpha');
    expect(body2.meta.seed_used).toBe('seed-beta');

    // response_hash must differ (seed is part of the hash input)
    expect(body1.response_hash).toBeDefined();
    expect(body2.response_hash).toBeDefined();
    expect(body1.response_hash).not.toBe(body2.response_hash);
  });
});
