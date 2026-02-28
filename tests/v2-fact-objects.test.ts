/**
 * Integration tests: fact_objects in /v2/run response.
 *
 * Verifies the sentinel contract for the ENABLE_FACTS_ASSEMBLY feature flag:
 * - Flag ON + HTTP 200 (computed/partial/failed): `fact_objects: [...]` (key present, may be empty)
 * - Flag OFF: `fact_objects` key entirely absent from response
 *
 * Note: HTTP 422 blocked responses use the V2RunError schema (not RunResponseV3)
 * and never include fact_objects. The sentinel contract applies only to 200 responses.
 *
 * Uses createServer() + app.inject() with ISL mock (no spawned process).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// ISL Mock — realistic analysis data for fact_objects assembly
// ---------------------------------------------------------------------------

const FACTOR_SENSITIVITY = [
  { factor_id: 'factor-a', factor_label: 'Factor A', elasticity: 0.85, direction: 'positive', attribution_stability: 'low', elasticity_std: 0.15, rank_flip_rate: 0.2 },
  { factor_id: 'factor-b', factor_label: 'Factor B', elasticity: -0.65, direction: 'negative', attribution_stability: 'moderate', elasticity_std: 0.1, rank_flip_rate: 0.1 },
];

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
        factor_sensitivity: FACTOR_SENSITIVITY,
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
// Fixtures
// ---------------------------------------------------------------------------

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

const PAYLOAD = {
  graph: GRAPH,
  options: OPTIONS,
  goal_node_id: 'goal',
  seed: '42',
};

// ---------------------------------------------------------------------------
// Tests — ENABLE_FACTS_ASSEMBLY=1
// ---------------------------------------------------------------------------

describe('fact_objects in /v2/run (ENABLE_FACTS_ASSEMBLY=1)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    process.env.ENABLE_FACTS_ASSEMBLY = '1';
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('includes fact_objects with valid structure when analysis succeeds', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: PAYLOAD,
    });

    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);

    // fact_objects key must be present when flag is ON
    expect(body).toHaveProperty('fact_objects');
    expect(Array.isArray(body.fact_objects)).toBe(true);
    expect(body.fact_objects.length).toBeGreaterThan(0);

    // Each fact object must have the required FactObjectV1 fields
    for (const fact of body.fact_objects) {
      expect(fact.fact_id).toBeDefined();
      expect(typeof fact.fact_id).toBe('string');
      expect(fact.fact_id.length).toBeGreaterThan(0);

      expect(fact.fact_key).toBeDefined();
      expect(typeof fact.fact_key).toBe('object');
      expect(fact.fact_key.type).toBeDefined();

      expect(fact.fact_type).toBeDefined();
      expect(['probability', 'factor_sensitivity', 'critique', 'robustness']).toContain(fact.fact_type);

      expect(fact.data).toBeDefined();
      expect(typeof fact.data).toBe('object');

      expect(fact.lineage).toBeDefined();
      expect(typeof fact.lineage.graph_hash).toBe('string');
      expect(fact.lineage.graph_hash).toMatch(/^[0-9a-f]{16}$/);
      expect(typeof fact.lineage.seed).toBe('number');

      expect(fact.content_hash).toBeDefined();
      expect(typeof fact.content_hash).toBe('string');
      expect(fact.content_hash).toMatch(/^[0-9a-f]{16}$/);
    }

    // Verify expected fact types are present (analysis succeeded with options + robustness)
    const factTypes = body.fact_objects.map((f: any) => f.fact_type);
    expect(factTypes).toContain('probability');
    expect(factTypes).toContain('robustness');
  });

  it('response_hash is stable across identical requests (fact_objects excluded from hash)', async () => {
    const res1 = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: PAYLOAD,
    });

    const res2 = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: PAYLOAD,
    });

    const body1 = JSON.parse(res1.body);
    const body2 = JSON.parse(res2.body);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    // response_hash must be identical — fact_objects is excluded from hash computation
    expect(body1.response_hash).toBeDefined();
    expect(body2.response_hash).toBeDefined();
    expect(body1.response_hash).toBe(body2.response_hash);
  });

  it('fact_objects key is present as array with different seed (sentinel: always present when flag ON)', async () => {
    // Same graph, different seed — verifies the sentinel contract that fact_objects
    // is always present when the flag is ON, regardless of the specific analysis data.
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: { ...PAYLOAD, seed: '99' },
    });

    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);

    // Sentinel: key MUST be present when flag is ON, regardless of array contents
    expect(body).toHaveProperty('fact_objects');
    expect(Array.isArray(body.fact_objects)).toBe(true);

    // Every fact (if any) must be a valid FactObjectV1
    for (const fact of body.fact_objects) {
      expect(fact.fact_id).toBeDefined();
      expect(fact.fact_type).toBeDefined();
      expect(fact.data).toBeDefined();
      expect(fact.lineage).toBeDefined();
      expect(fact.content_hash).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — Assembly parity: assembleFactObjects vs assembleFactsFromBundleResults
// Both paths must produce valid FactObjectV1[] with identical schema structure.
// ---------------------------------------------------------------------------

describe('fact_objects assembly parity (V2 vs run_bundle)', () => {
  it('both assembly functions produce FactObjectV1[] with identical schema structure', async () => {
    const { assembleFactObjects, assembleFactsFromBundleResults } = await import('../src/facts/mapper.js');
    const lineage = { graph_hash: 'abcdef0123456789', seed: 42, config_version: '1', isl_request_id: 'test-req' };

    // V2-path input (ISL response shape)
    const v2Envelope = assembleFactObjects({
      analysis_status: 'computed',
      options: [{ option_id: 'opt-a', label: 'A', outcome: { p10: 0.3, p50: 0.5, p90: 0.7, mean: 0.5 } }],
      factor_sensitivity: [{ node_id: 'f1', label: 'F1', sensitivity_score: 0.8, importance_rank: 1 }],
      robustness: { label: 'robust', score: 0.85 },
    }, lineage);

    // run_bundle-path input (local SCM-Lite shape)
    const bundleEnvelope = assembleFactsFromBundleResults([
      { label: 'Scenario A', summary: { p10: 0.3, p50: 0.5, p90: 0.7 } },
    ], lineage);

    // Both envelopes must have the same top-level shape
    expect(v2Envelope.facts_schema_version).toBeDefined();
    expect(bundleEnvelope.facts_schema_version).toBeDefined();
    expect(v2Envelope.facts_schema_version).toBe(bundleEnvelope.facts_schema_version);

    // Every fact from both paths must have identical required fields
    const requiredKeys = ['fact_id', 'fact_key', 'fact_type', 'data', 'lineage', 'content_hash'];
    for (const fact of [...v2Envelope.facts, ...bundleEnvelope.facts]) {
      for (const key of requiredKeys) {
        expect(fact).toHaveProperty(key);
      }
      // Lineage must have identical shape
      expect(fact.lineage.graph_hash).toBe('abcdef0123456789');
      expect(fact.lineage.seed).toBe(42);
      expect(typeof fact.content_hash).toBe('string');
      expect(fact.content_hash).toMatch(/^[0-9a-f]{16}$/);
    }

    // V2 path should have more fact types than bundle (probability + factor_sensitivity + robustness)
    const v2Types = new Set(v2Envelope.facts.map(f => f.fact_type));
    const bundleTypes = new Set(bundleEnvelope.facts.map(f => f.fact_type));
    expect(v2Types.has('probability')).toBe(true);
    expect(v2Types.has('robustness')).toBe(true);
    expect(bundleTypes.has('probability')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests — ENABLE_FACTS_ASSEMBLY=0
// ---------------------------------------------------------------------------

describe('fact_objects in /v2/run (ENABLE_FACTS_ASSEMBLY=0)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    process.env.ENABLE_FACTS_ASSEMBLY = '0';
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('fact_objects key is entirely absent from response when flag is OFF', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: PAYLOAD,
    });

    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);

    // Sentinel: key must NOT exist when flag is OFF
    expect(body).not.toHaveProperty('fact_objects');

    // Existing response fields should still be present
    expect(body.analysis_status).toBeDefined();
    expect(body.response_hash).toBeDefined();
    expect(body.option_comparison).toBeDefined();
  });
});
