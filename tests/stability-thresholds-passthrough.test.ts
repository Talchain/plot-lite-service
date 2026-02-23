/**
 * stability_thresholds passthrough + hash_version in _meta
 *
 * ST1: stability_thresholds passes through when ISL provides it
 * ST2: stability_thresholds absent when ISL omits it
 * ST3: stability_thresholds NOT in response_hash (hashes identical with/without)
 * ST4: hash_version in _meta matches HASH_VERSION constant
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { canonicaliseRequest, computeResponseHash, HASH_VERSION } from '../src/normalisation/canonicalise.js';
import type { RunRequestV3, EngineGraphV3, IdentifiabilityAssessment, FactorStabilityEntry } from '../src/types/engine-v3.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'factor-a', kind: 'factor', label: 'Marketing Spend', observed_state: { value: 0.6 } },
    { id: 'factor-b', kind: 'factor', label: 'Brand Awareness', observed_state: { value: 0.5 } },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
    { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt1', label: 'Option A', interventions: { 'factor-a': { value: 10, source: 'user_specified' } } },
  { id: 'opt2', label: 'Option B', interventions: { 'factor-b': { value: 5, source: 'user_specified' } } },
];

const STABILITY_THRESHOLDS = {
  high_moderate_boundary: 0.1,
  moderate_low_boundary: 0.3,
  version: 'v1.0-operational-defaults',
  provisional: true,
};

function makeRequest(overrides: Partial<RunRequestV3> = {}): RunRequestV3 {
  return {
    graph: GRAPH,
    options: OPTIONS,
    goal_node_id: 'goal',
    seed: '42',
    ...overrides,
  } as RunRequestV3;
}

// ---------------------------------------------------------------------------
// ST3: Hash unit test — stability_thresholds NOT in hash (canonical form proof)
// ---------------------------------------------------------------------------

describe('ST3: stability_thresholds NOT in response_hash', () => {
  it('canonical form does not contain stability_thresholds', () => {
    const req = makeRequest();
    const ident: IdentifiabilityAssessment = {
      status: 'identifiable', method: 'backdoor',
      pairs_checked: 2, pairs_identifiable: 2,
    };
    const stability: FactorStabilityEntry[] = [
      { factor_id: 'factor-a', factor_label: 'A', elasticity_std: 0.042, attribution_stability: 'high', rank_flip_rate: 0.03, stability_method: 'bootstrap_1000' },
    ];

    const canonical = JSON.parse(canonicaliseRequest(req, GRAPH, '42', ident, stability));
    expect(canonical).not.toHaveProperty('stability_thresholds');
  });
});

// ---------------------------------------------------------------------------
// ISL mock — includes stability_thresholds conditionally
// ---------------------------------------------------------------------------

// Toggle for ST3 differential test: when true, mock omits thresholds regardless of goal_node_id
let forceOmitThresholds = false;
// Toggle for IW2 test: when true, mock strips 3C fields from factor_sensitivity
let forceStrip3CFields = false;
// Toggle for IW3 test: when set, mock includes this value as stability_thresholds (to test malformed rejection)
let forceMalformedThresholds: any = null;
// Toggle for IW4 test: when set, mock returns this value as factor_sensitivity (to test non-array guard)
let forceFactorSensitivityShape: any = undefined;

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
      factor_sensitivity: [
        { node_id: 'factor-a', sensitivity_score: 0.5, direction: 'positive',
          elasticity_std: 0.042, attribution_stability: 'high', rank_flip_rate: 0.03, stability_method: 'bootstrap_1000' },
        { node_id: 'factor-b', sensitivity_score: 0.7, direction: 'positive',
          elasticity_std: 0.11, attribution_stability: 'moderate', rank_flip_rate: 0.15, stability_method: 'bootstrap_1000' },
      ],
      factors: [], value_of_information: [],
      factors_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      factor_sensitivity_status: 'available' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.8,
      fragile_edges: [], robust_edges: [], latency_ms: 50, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null; isl_echoed_request_id?: string }> {
    const includeThresholds = !forceOmitThresholds && body.goal_node_id !== 'goal-no-thresholds';
    const options = body.options || [];

    // Determine factor_sensitivity shape
    const factorSensitivity = forceFactorSensitivityShape !== undefined
      ? forceFactorSensitivityShape
      : forceStrip3CFields
        ? [
            { node_id: 'factor-a', sensitivity_score: 0.5, direction: 'positive' },
            { node_id: 'factor-b', sensitivity_score: 0.7, direction: 'positive' },
          ]
        : [
            { node_id: 'factor-a', sensitivity_score: 0.5, direction: 'positive',
              elasticity_std: 0.042, attribution_stability: 'high', rank_flip_rate: 0.03, stability_method: 'bootstrap_1000' },
            { node_id: 'factor-b', sensitivity_score: 0.7, direction: 'positive',
              elasticity_std: 0.11, attribution_stability: 'moderate', rank_flip_rate: 0.15, stability_method: 'bootstrap_1000' },
          ];

    // Determine stability_thresholds shape
    const thresholds = forceMalformedThresholds !== null
      ? forceMalformedThresholds
      : includeThresholds ? STABILITY_THRESHOLDS : undefined;

    return {
      data: {
        options: options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
          rank: idx + 1,
        })),
        edges: [],
        factor_sensitivity: factorSensitivity,
        overall_robustness: 'robust', robustness_score: 0.8,
        fragile_edges: [], robust_edges: [],
        ...(thresholds !== undefined ? { stability_thresholds: thresholds } : {}),
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
// ST1, ST2, ST4: Route-level integration tests
// ---------------------------------------------------------------------------

describe('stability_thresholds passthrough + hash_version in _meta', () => {
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

  it('ST1: stability_thresholds passes through when ISL provides it', async () => {
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: GRAPH,
        options: OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.stability_thresholds).toBeDefined();
    expect(body.stability_thresholds).toEqual(STABILITY_THRESHOLDS);
    expect(body.stability_thresholds.high_moderate_boundary).toBe(0.1);
    expect(body.stability_thresholds.moderate_low_boundary).toBe(0.3);
    expect(body.stability_thresholds.version).toBe('v1.0-operational-defaults');
    expect(body.stability_thresholds.provisional).toBe(true);
  });

  it('ST2: stability_thresholds absent when ISL omits it', async () => {
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'goal-no-thresholds', kind: 'goal', label: 'Revenue' },
            { id: 'action-a', kind: 'action', label: 'Action A' },
          ],
          edges: [
            { from: 'action-a', to: 'goal-no-thresholds', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
          ],
        },
        options: [
          { id: 'opt1', label: 'Option A', interventions: { 'action-a': { value: 10, source: 'user_specified' } } },
          { id: 'opt2', label: 'Option B', interventions: { 'action-a': { value: 20, source: 'user_specified' } } },
        ],
        goal_node_id: 'goal-no-thresholds',
        seed: '42',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;

    // Field should be absent (not null, not undefined key)
    expect('stability_thresholds' in body).toBe(false);
  });

  it('ST3-route: same request produces identical response_hash with/without stability_thresholds', async () => {
    const payload = JSON.stringify({
      graph: GRAPH,
      options: OPTIONS,
      goal_node_id: 'goal',
      seed: '42',
    });

    // Request WITH stability_thresholds
    forceOmitThresholds = false;
    const res1 = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json() as any;
    expect(body1.stability_thresholds).toBeDefined();

    // Request WITHOUT stability_thresholds (same semantic payload)
    forceOmitThresholds = true;
    const res2 = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json() as any;
    expect('stability_thresholds' in body2).toBe(false);

    // Reset flag
    forceOmitThresholds = false;

    // response_hash must be identical — stability_thresholds is NOT in hash
    expect(body1.response_hash).toBeDefined();
    expect(body2.response_hash).toBeDefined();
    expect(body1.response_hash).toBe(body2.response_hash);
  });

  it('ST4: _meta.hash_version matches HASH_VERSION constant', async () => {
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: GRAPH,
        options: OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body._meta).toBeDefined();
    expect(body._meta.hash_version).toBe(HASH_VERSION);
    expect(body._meta.hash_version).toBe(5);
  });

  // ---------------------------------------------------------------------------
  // IW1/IW2: Inference warning — STABILITY_THRESHOLDS_MISSING diagnostic
  // ---------------------------------------------------------------------------

  it('IW1: emits STABILITY_THRESHOLDS_MISSING when ISL has 3C fields but no stability_thresholds', async () => {
    forceOmitThresholds = true;
    forceStrip3CFields = false;
    try {
      const res = await fetch(`${baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: GRAPH,
          options: OPTIONS,
          goal_node_id: 'goal',
          seed: '42',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;

      // stability_thresholds should be absent
      expect('stability_thresholds' in body).toBe(false);

      // inference_warnings should contain the diagnostic warning
      expect(body.inference_warnings).toBeDefined();
      expect(body.inference_warnings).toHaveLength(1);
      expect(body.inference_warnings[0]).toEqual({
        code: 'STABILITY_THRESHOLDS_MISSING',
        message: 'ISL returned factor-level stability fields but stability_thresholds metadata was absent or malformed — threshold classification context unavailable',
        severity: 'info',
      });
    } finally {
      forceOmitThresholds = false;
    }
  });

  it('IW2: no inference warning when ISL has no 3C fields and no stability_thresholds', async () => {
    forceOmitThresholds = true;
    forceStrip3CFields = true;
    try {
      const res = await fetch(`${baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: GRAPH,
          options: OPTIONS,
          goal_node_id: 'goal',
          seed: '42',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;

      // stability_thresholds should be absent
      expect('stability_thresholds' in body).toBe(false);

      // inference_warnings should be absent (no 3C fields → absence is expected)
      expect('inference_warnings' in body).toBe(false);
    } finally {
      forceOmitThresholds = false;
      forceStrip3CFields = false;
    }
  });

  it('IW3: emits STABILITY_THRESHOLDS_MISSING when ISL sends malformed stability_thresholds', async () => {
    // ISL sends thresholds but missing required `version` field → extractStabilityThresholds rejects it
    forceMalformedThresholds = { high_moderate_boundary: 0.1, moderate_low_boundary: 0.3, provisional: true };
    forceStrip3CFields = false;
    try {
      const res = await fetch(`${baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: GRAPH,
          options: OPTIONS,
          goal_node_id: 'goal',
          seed: '42',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;

      // Malformed thresholds should be rejected (not passed through)
      expect('stability_thresholds' in body).toBe(false);

      // Warning should fire because 3C fields are present but thresholds were rejected
      expect(body.inference_warnings).toBeDefined();
      expect(body.inference_warnings).toHaveLength(1);
      expect(body.inference_warnings[0].code).toBe('STABILITY_THRESHOLDS_MISSING');
    } finally {
      forceMalformedThresholds = null;
    }
  });

  it('IW4: non-array factor_sensitivity does not crash the request', async () => {
    // ISL returns factor_sensitivity as an object instead of an array — guard must prevent .some() crash
    forceOmitThresholds = true;
    forceFactorSensitivityShape = { broken: true };
    try {
      const res = await fetch(`${baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: GRAPH,
          options: OPTIONS,
          goal_node_id: 'goal',
          seed: '42',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;

      // Should not crash — response should still be valid
      // No 3C fields detected (non-array falls back to []), so no warning
      expect('inference_warnings' in body).toBe(false);
    } finally {
      forceOmitThresholds = false;
      forceFactorSensitivityShape = undefined;
    }
  });
});
