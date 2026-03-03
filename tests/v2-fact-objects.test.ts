/**
 * Integration tests: fact_objects and review_cards in /v2/run response.
 *
 * Verifies the required-field contract (H.1 + F.7):
 * - fact_objects: always present ([] when ENABLE_FACTS_ASSEMBLY=0, populated when =1)
 * - review_cards: always present ([] when ENABLE_REVIEW_PASS=0, populated when =1)
 * - response_hash: unaffected by fact_objects/review_cards (excluded from hash computation)
 * - meta.feature_flags.facts_assembly: boolean, reflects ENABLE_FACTS_ASSEMBLY value
 * - meta.feature_flags.review_pass: boolean, reflects ENABLE_REVIEW_PASS value
 *
 * Note: HTTP 422 blocked responses use the V2RunError schema (not RunResponseV3)
 * and never include fact_objects. The required-field contract applies only to 200 responses.
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

    // Verify expected fact types are present (analysis succeeded with options + robustness + sensitivity)
    const factTypes = body.fact_objects.map((f: any) => f.fact_type);
    expect(factTypes).toContain('probability');
    expect(factTypes).toContain('robustness');
    expect(factTypes).toContain('factor_sensitivity');
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
//
// Note: byte-identical *content* across /v1/run_bundle and /v2/run is NOT a
// valid invariant — these are different analysis pipelines (SCM-Lite bundle
// scenarios vs ISL robustness) producing different fact types for different
// inputs. The invariant here is structural schema parity (same required fields,
// same schema version), not content identity.
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

  it('fact_objects is [] (required field, never absent) when flag is OFF', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: PAYLOAD,
    });

    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);

    // Required field contract: key must always be present, even when flag OFF → []
    expect(body).toHaveProperty('fact_objects');
    expect(Array.isArray(body.fact_objects)).toBe(true);
    expect(body.fact_objects).toHaveLength(0);

    // review_cards follows same pattern: always present as [] when flag OFF
    expect(body).toHaveProperty('review_cards');
    expect(Array.isArray(body.review_cards)).toBe(true);
    expect(body.review_cards).toHaveLength(0);

    // Existing response fields should still be present
    expect(body.analysis_status).toBeDefined();
    expect(body.response_hash).toBeDefined();
    expect(body.option_comparison).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests — Flag toggle: response_hash invariant across ENABLE_FACTS_ASSEMBLY ON/OFF
// ---------------------------------------------------------------------------

describe('response_hash invariant: ENABLE_FACTS_ASSEMBLY flag toggle', () => {
  async function getHash(flagValue: string): Promise<string> {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    process.env.ENABLE_FACTS_ASSEMBLY = flagValue;
    const app = await createServer();
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: PAYLOAD,
    });
    await app.close();
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    return body.response_hash;
  }

  it('response_hash is identical when ENABLE_FACTS_ASSEMBLY is ON vs OFF', async () => {
    const hashOn = await getHash('1');
    const hashOff = await getHash('0');
    expect(hashOn).toBeDefined();
    expect(hashOff).toBeDefined();
    expect(hashOn).toBe(hashOff);
  });
});

// ---------------------------------------------------------------------------
// Tests — Flag toggle: response_hash invariant across ENABLE_REVIEW_PASS ON/OFF
// ---------------------------------------------------------------------------

describe('response_hash invariant: ENABLE_REVIEW_PASS flag toggle', () => {
  async function getHash(flagValue: string): Promise<string> {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_FACTS_ASSEMBLY = '0';
    process.env.ENABLE_REVIEW_PASS = flagValue;
    const app = await createServer();
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: PAYLOAD,
    });
    await app.close();
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    return body.response_hash;
  }

  it('response_hash is identical when ENABLE_REVIEW_PASS is ON vs OFF', async () => {
    const hashOn = await getHash('1');
    const hashOff = await getHash('0');
    expect(hashOn).toBeDefined();
    expect(hashOff).toBeDefined();
    expect(hashOn).toBe(hashOff);
  });
});

// ---------------------------------------------------------------------------
// Tests — meta.feature_flags named booleans
// ---------------------------------------------------------------------------

describe('meta.feature_flags named booleans (facts_assembly, review_pass)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_FACTS_ASSEMBLY = '1';
    process.env.ENABLE_REVIEW_PASS = '1';
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('meta.feature_flags.facts_assembly is true when ENABLE_FACTS_ASSEMBLY=1', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: PAYLOAD,
    });

    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.meta.feature_flags).toBeDefined();
    expect(body.meta.feature_flags.facts_assembly).toBe(true);
    expect(body.meta.feature_flags.review_pass).toBe(true);
  });

  it('meta.feature_flags.facts_assembly is false when ENABLE_FACTS_ASSEMBLY=0', async () => {
    process.env.ENABLE_FACTS_ASSEMBLY = '0';
    const app2 = await createServer();
    await app2.ready();

    const res = await app2.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: PAYLOAD,
    });

    await app2.close();
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.meta.feature_flags.facts_assembly).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — Golden fixture: fact_objects determinism (byte-identical JSON.stringify)
// Two identical requests produce byte-identical fact_objects serialisation.
// ---------------------------------------------------------------------------

describe('fact_objects golden fixture: byte-identical determinism', () => {
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

  it('fact_objects content is byte-identical across two identical requests (excluding per-request lineage)', async () => {
    const [res1, res2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v2/run',
        headers: { 'Content-Type': 'application/json' },
        payload: PAYLOAD,
      }),
      app.inject({
        method: 'POST',
        url: '/v2/run',
        headers: { 'Content-Type': 'application/json' },
        payload: PAYLOAD,
      }),
    ]);

    const body1 = JSON.parse(res1.body);
    const body2 = JSON.parse(res2.body);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    expect(Array.isArray(body1.fact_objects)).toBe(true);
    expect(Array.isArray(body2.fact_objects)).toBe(true);

    // Same number of facts
    expect(body1.fact_objects.length).toBe(body2.fact_objects.length);

    // fact_id includes isl_request_id (per-request UUID via lineage), so it varies between requests.
    // The canonical content — fact_key, fact_type, data, content_hash — must be byte-identical.
    // This is the "golden fixture" invariant: same graph + options + seed → same facts, same ordering.
    const canonicalise = (facts: any[]) => JSON.stringify(
      facts.map(f => ({ fact_key: f.fact_key, fact_type: f.fact_type, data: f.data, content_hash: f.content_hash }))
    );
    const canonical1 = canonicalise(body1.fact_objects);
    const canonical2 = canonicalise(body2.fact_objects);
    expect(canonical1).toBe(canonical2);
  });
});
