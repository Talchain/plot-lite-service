/**
 * Constraint Pipeline Integration Tests
 *
 * End-to-end verification of the constraint pipeline:
 * 1. Constraint PU end-to-end (non-factor node → CONSTRAINT_PINNED_STD)
 * 2. XOR enforcement (goal_threshold + goal_constraints → constraints win)
 * 3. Rename verification (PLoT "value" → ISL "threshold")
 * 4. Translator PU not overridden by Phase 4b+ injection
 *
 * Uses vi.mock to intercept ISL and capture the request body.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CONSTRAINT_PINNED_STD } from '../../src/integrations/isl/constraint-pu-injection.js';

// ---------------------------------------------------------------------------
// ISL Mock — captures request body for assertion
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

vi.mock('../../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../../src/createServer.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'factor-a', kind: 'factor', label: 'Marketing Spend', observed_state: { value: 0.6 } },
    { id: 'factor-b', kind: 'factor', label: 'Customer Churn', observed_state: { value: 0.5 } },
    { id: 'outcome-x', kind: 'outcome', label: 'Customer Retention', observed_state: { value: 0.85 } },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
    { from: 'factor-b', to: 'goal', strength: { mean: -0.5, std: 0.1 } },
    { from: 'factor-a', to: 'outcome-x', strength: { mean: 0.4, std: 0.1 } },
    { from: 'outcome-x', to: 'goal', strength: { mean: 0.3, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': 1.5 } },
  { id: 'opt2', label: 'Option 2', interventions: { 'factor-b': 0.2 } },
];

const BASE_PAYLOAD = {
  graph: GRAPH,
  options: OPTIONS,
  goal_node_id: 'goal',
  seed: '42',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Constraint Pipeline Integration', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';

    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
    capturedISLRequestBody = null;
  });

  // -------------------------------------------------------------------------
  // 1. Constraint PU end-to-end (outcome node → CONSTRAINT_PINNED_STD)
  // -------------------------------------------------------------------------

  it('outcome node constrained → PU injected with CONSTRAINT_PINNED_STD', async () => {
    capturedISLRequestBody = null;

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...BASE_PAYLOAD,
        goal_constraints: [
          { constraint_id: 'ret-min', node_id: 'outcome-x', operator: '>=', value: 0.7 },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(capturedISLRequestBody).not.toBeNull();

    // outcome-x is kind='outcome', translator only generates PU for kind='factor'.
    // Phase 4b+ safety net should inject PU with CONSTRAINT_PINNED_STD.
    const puArray = capturedISLRequestBody.parameter_uncertainties ?? [];
    const outcomeXPU = puArray.find((p: any) => p.node_id === 'outcome-x');

    expect(outcomeXPU).toBeDefined();
    expect(outcomeXPU.std).toBe(CONSTRAINT_PINNED_STD);
    expect(outcomeXPU.mean).toBe(0.85);
  });

  // -------------------------------------------------------------------------
  // 2. XOR enforcement: goal_threshold + goal_constraints → constraints win
  // -------------------------------------------------------------------------

  it('both goal_threshold and goal_constraints → ISL gets constraints, NOT threshold', async () => {
    capturedISLRequestBody = null;

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...BASE_PAYLOAD,
        goal_threshold: 20000,
        goal_constraints: [
          { constraint_id: 'churn-cap', node_id: 'factor-b', operator: '<=', value: 0.04 },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(capturedISLRequestBody).not.toBeNull();

    // XOR: when both present, goal_constraints takes precedence
    expect(capturedISLRequestBody.goal_constraints).toBeDefined();
    expect(capturedISLRequestBody.goal_constraints.length).toBeGreaterThanOrEqual(1);
    expect(capturedISLRequestBody.goal_threshold).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 3. Field verification: ISL uses canonical "value" field (F-20)
  // -------------------------------------------------------------------------

  it('ISL goal_constraints use canonical "value" field, not legacy "threshold" (F-20)', async () => {
    capturedISLRequestBody = null;

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...BASE_PAYLOAD,
        goal_constraints: [
          { constraint_id: 'churn-cap', node_id: 'factor-b', operator: '<=', value: 0.04 },
          { constraint_id: 'mrr-min', node_id: 'goal', operator: '>=', value: 15000 },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(capturedISLRequestBody).not.toBeNull();

    for (const constraint of capturedISLRequestBody.goal_constraints) {
      // F-20: ISL wire format uses canonical "value"
      expect(constraint.value).toBeDefined();
      expect(typeof constraint.value).toBe('number');
      // Legacy "threshold" field must NOT appear
      expect(constraint.threshold).toBeUndefined();
    }

    // Verify the actual values were mapped correctly
    const churnCap = capturedISLRequestBody.goal_constraints.find(
      (c: any) => c.constraint_id === 'churn-cap',
    );
    expect(churnCap?.value).toBe(0.04);
  });

  // -------------------------------------------------------------------------
  // 4. Translator PU not overridden by Phase 4b+ injection
  // -------------------------------------------------------------------------

  it('factor node with translator PU (std ≥ 0.1) is NOT replaced by CONSTRAINT_PINNED_STD', async () => {
    capturedISLRequestBody = null;

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...BASE_PAYLOAD,
        goal_constraints: [
          { constraint_id: 'churn-cap', node_id: 'factor-b', operator: '<=', value: 0.04 },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(capturedISLRequestBody).not.toBeNull();

    // factor-b is kind='factor' with observed_state.value=0.5.
    // The translator (buildParameterUncertaintiesV3) creates PU with std >= 0.1.
    // Phase 4b+ should see the existing PU entry and SKIP (inject-only-when-missing).
    const puArray = capturedISLRequestBody.parameter_uncertainties ?? [];
    const factorBPU = puArray.find((p: any) => p.node_id === 'factor-b');

    expect(factorBPU).toBeDefined();
    // std should be from translator (>= 0.1), NOT from Phase 4b+ (0.001)
    expect(factorBPU.std).toBeGreaterThanOrEqual(0.1);
    expect(factorBPU.std).not.toBe(CONSTRAINT_PINNED_STD);

    // Exactly one PU entry for factor-b (no duplicate)
    const factorBEntries = puArray.filter((p: any) => p.node_id === 'factor-b');
    expect(factorBEntries).toHaveLength(1);
  });
});
