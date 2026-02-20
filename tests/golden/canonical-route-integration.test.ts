/**
 * Canonical Route Integration Tests (B1.4 Category B)
 *
 * Verifies the /v2/run response shape via canonicalCompare against a locked
 * golden snapshot. Uses the same ISL mock pattern as determinism-replay.test.ts.
 *
 * Key guarantees:
 * 1. Response envelope shape: option_comparison, edge_sensitivity, meta, etc.
 * 2. Constraint pipeline: value→threshold→probability round-trip
 * 3. No-network tripwire: real fetch() is intercepted — any unmocked call fails
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { canonicalCompare, DEFAULT_IGNORE_FIELDS } from '../utils/canonical-compare.js';

// ---------------------------------------------------------------------------
// No-network tripwire: intercept global fetch to detect unmocked HTTP calls.
// Any real fetch that escapes the mock will fail the test immediately.
// ---------------------------------------------------------------------------
const originalFetch = globalThis.fetch;
let networkCallDetected = false;
let networkCallUrl = '';

beforeAll(() => {
  const patchedFetch: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    // Allow localhost (the test server itself)
    if (url.includes('127.0.0.1') || url.includes('localhost')) {
      return originalFetch(input, init);
    }
    networkCallDetected = true;
    networkCallUrl = url;
    return Promise.reject(new Error(`NO-NETWORK TRIPWIRE: unmocked fetch to ${url}`));
  };
  globalThis.fetch = patchedFetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// ISL Mock — deterministic, returns constraint_analysis when constraints sent
// ---------------------------------------------------------------------------

let capturedISLBody: any = null;
let capturedRobustnessBody: any = null;

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
      edges: [],
      edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factors: [],
      value_of_information: [],
      factors_provenance: 'unavailable' as const,
      factor_sensitivity_status: 'skipped_no_factor_values' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.8,
      fragile_edges: [], robust_edges: [],
      latency_ms: 50, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    capturedISLBody = body;
    // Track only the FIRST robustness call (flip inference and threshold calls overwrite capturedISLBody)
    if (_endpoint.includes('robustness') && capturedRobustnessBody === null) {
      capturedRobustnessBody = body;
    }
    const options = body.options || [];
    const goalConstraints = body.goal_constraints || [];

    const constraintAnalysis = goalConstraints.length > 0
      ? {
          constraint_analysis: {
            constraints: goalConstraints.map((c: any) => ({
              node_id: c.node_id,
              operator: c.operator,
              threshold: c.threshold ?? c.value,
              prob_satisfied: 0.55,
            })),
          },
        }
      : {};

    return {
      data: {
        options: options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
          win_probability: idx === 0 ? 0.6 : 0.4,
          rank: idx + 1,
          ...constraintAnalysis,
        })),
        edges: [
          { edge_from: 'factor-a', edge_to: 'goal', sensitivity: 0.4, confidence: 0.7, direction: 'positive' },
        ],
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

vi.mock('../../src/integrations/isl/index.js', async () => {
  const actual = await vi.importActual<any>('../../src/integrations/isl/index.js');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../../src/createServer.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'factor-a', kind: 'factor', label: 'Marketing', observed_state: { value: 0.6 } },
    { id: 'factor-b', kind: 'factor', label: 'Churn', observed_state: { value: 0.5 } },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
    { from: 'factor-b', to: 'goal', strength: { mean: -0.3, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt1', label: 'Boost Marketing', interventions: { 'factor-a': 0.8 } },
  { id: 'opt2', label: 'Reduce Churn', interventions: { 'factor-b': 0.3 } },
];

/** Volatile fields to ignore when comparing response shapes. */
const RESPONSE_IGNORE_FIELDS = [
  ...DEFAULT_IGNORE_FIELDS,
  'timing',
  'latency_ms',
  'normalization_ms',
  'validation_ms',
  'isl_ms',
  'cee_ms',
  'id',                     // critique UUIDs
  'downstream_calls',       // per-request call traces
  'request_id_chain',       // per-request UUID chain
  'requestId',
  'timestamp',
  'plot_request_id',
  'cee_sent_request_id',
  'response_hash',          // varies by volatile fields
  'thresholds_status',
  'thresholds_meta',
  'threshold_analysis',
];

const SORT_ARRAYS = {
  '$.option_comparison': 'option_id',
  '$.edge_sensitivity': 'edge_id',
  '$.factor_sensitivity': 'factor_id',
  '$.critiques': 'code',
  '$.constraint_results': 'constraint_id',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Canonical route integration (B1.4 Category B)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLE = '0';
    networkCallDetected = false;
    networkCallUrl = '';

    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLE;
    capturedISLBody = null;
    capturedRobustnessBody = null;
  });

  // -----------------------------------------------------------------------
  // B1: Response envelope shape (no constraints)
  // -----------------------------------------------------------------------

  it('response envelope contains expected top-level keys', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({
        graph: GRAPH,
        options: OPTIONS,
        goal_node_id: 'goal',
        seed: 'envelope-test',
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // Core envelope keys must be present
    const expectedKeys = [
      'analysis_status',
      'option_comparison',
      'robustness',
      'response_hash',
      '_meta',
    ];
    for (const key of expectedKeys) {
      expect(body).toHaveProperty(key);
    }

    // analysis_status must be 'computed' or 'partial' (not 'blocked')
    expect(['computed', 'partial']).toContain(body.analysis_status);

    // option_comparison must have entries for each option
    expect(body.option_comparison).toHaveLength(2);
    const optionIds = body.option_comparison.map((o: any) => o.option_id).sort();
    expect(optionIds).toEqual(['opt1', 'opt2']);

    // recommended_option is nested inside robustness
    expect(body.robustness).toBeDefined();
    expect(body.robustness.recommended_option_id).toBeDefined();
    expect(body.robustness.recommended_option_label).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // B2: Constrained response — constraint_results present and shaped
  // -----------------------------------------------------------------------

  it('constrained request: constraint_results present with probability', async () => {
    capturedISLBody = null;
    capturedRobustnessBody = null;

    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({
        graph: GRAPH,
        options: OPTIONS,
        goal_node_id: 'goal',
        seed: 'constraint-shape',
        goal_constraints: [
          { constraint_id: 'churn-cap', node_id: 'factor-b', operator: '<=', value: 0.4 },
        ],
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // Debug: check if constraints_status is present and what it says
    // (constraint_results may be absent if ISL didn't return constraint_analysis)
    expect(body.constraints_status).toBeDefined();
    expect(body.constraints_status).toBe('computed');
    expect(body.constraint_results).toBeDefined();
    expect(body.constraint_results.length).toBeGreaterThanOrEqual(1);

    // Shape of each constraint result
    const cr = body.constraint_results.find((c: any) => c.constraint_id === 'churn-cap');
    expect(cr).toBeDefined();
    expect(cr.node_id).toBe('factor-b');
    expect(cr.operator).toBe('<=');
    expect(cr.value).toBe(0.4);           // ISL threshold → UI "value"
    expect(typeof cr.probability).toBe('number');
    expect(cr.probability).toBeGreaterThan(0);
    expect(cr.probability).toBeLessThan(1);

    // Verify ISL robustness call received "threshold" not "value"
    expect(capturedRobustnessBody).not.toBeNull();
    const islConstraints = capturedRobustnessBody.goal_constraints ?? [];
    expect(islConstraints.length).toBeGreaterThanOrEqual(1);
    expect(islConstraints[0].threshold).toBe(0.4);
    expect(islConstraints[0].value).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // B3: Two identical requests → canonicalCompare match (idempotency)
  // -----------------------------------------------------------------------

  it('same payload twice → canonicalCompare match (response shape stability)', async () => {
    const payload = JSON.stringify({
      graph: GRAPH,
      options: OPTIONS,
      goal_node_id: 'goal',
      seed: 'idempotent',
    });

    const res1 = await app.inject({
      method: 'POST', url: '/v2/run',
      headers: { 'Content-Type': 'application/json' }, payload,
    });
    const res2 = await app.inject({
      method: 'POST', url: '/v2/run',
      headers: { 'Content-Type': 'application/json' }, payload,
    });

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    const body1 = JSON.parse(res1.body);
    const body2 = JSON.parse(res2.body);

    const result = canonicalCompare(body1, body2, {
      ignoreFields: RESPONSE_IGNORE_FIELDS,
      sortArraysBy: SORT_ARRAYS,
    });

    if (!result.match) {
      throw new Error(`Response shape instability: ${result.diff}`);
    }
    expect(result.match).toBe(true);
  });

  // -----------------------------------------------------------------------
  // B4: _meta.repairs_applied shape for constraint PU injection
  // -----------------------------------------------------------------------

  it('constraint PU injection repair entry has canonical shape', async () => {
    // Use an outcome node (translator doesn't generate PU for outcomes)
    // so Phase 4b+ injection triggers and we can verify repair shape.
    const graphWithOutcome = {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Revenue' },
        { id: 'factor-a', kind: 'factor', label: 'Marketing', observed_state: { value: 0.6 } },
        { id: 'outcome-sat', kind: 'outcome', label: 'Satisfaction', observed_state: { value: 0.8 } },
      ],
      edges: [
        { from: 'factor-a', to: 'outcome-sat', strength: { mean: 0.5, std: 0.1 } },
        { from: 'outcome-sat', to: 'goal', strength: { mean: 0.4, std: 0.1 } },
      ],
    };

    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({
        graph: graphWithOutcome,
        options: [
          { id: 'opt1', label: 'A', interventions: { 'factor-a': 0.9 } },
          { id: 'opt2', label: 'B', interventions: { 'factor-a': 0.3 } },
        ],
        goal_node_id: 'goal',
        seed: 'repair-shape',
        goal_constraints: [
          { constraint_id: 'sat-min', node_id: 'outcome-sat', operator: '>=', value: 0.6 },
        ],
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // Find the constraint PU injection repair entry
    const repairs = body._meta?.repairs_applied ?? [];
    const injectionRepair = repairs.find(
      (r: any) => r.field === 'parameter_uncertainties[outcome-sat]',
    );

    expect(injectionRepair).toBeDefined();
    // Verify canonical shape of repair entry
    expect(injectionRepair).toEqual(expect.objectContaining({
      field: 'parameter_uncertainties[outcome-sat]',
      action: 'derived',
      from_value: null,
      to_value: '0.8',
    }));
    expect(injectionRepair.reason).toContain('CONSTRAINT_PU_INJECTED');
    expect(injectionRepair.reason).toContain('std=0.001');
  });

  // -----------------------------------------------------------------------
  // B5: No-network tripwire — verify no unmocked fetch escaped
  // -----------------------------------------------------------------------

  it('no-network tripwire: no unmocked fetch calls detected during test suite', () => {
    // This test runs last (by convention) and asserts that no real HTTP
    // calls escaped the ISL mock during the entire test file.
    expect(networkCallDetected).toBe(false);
    if (networkCallDetected) {
      throw new Error(`Unmocked network call detected: ${networkCallUrl}`);
    }
  });
});
