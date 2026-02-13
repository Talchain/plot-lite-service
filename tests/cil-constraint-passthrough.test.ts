/**
 * CIL C1: Constraint Results Passthrough
 *
 * Verifies that constraint analysis results from ISL are correctly
 * mapped and passed through to the PLoT response:
 *   - constraint_results, constraint_diagnostics, conditional_probabilities
 *   - constraints_status lifecycle: absent | unavailable | computed
 *   - Field name mapping: ISL threshold → contract value, joint_probability → probability_of_joint_goal
 *   - Per-option constraint_probabilities and probability_of_joint_goal
 *
 * Uses vi.mock to mock ISL service with constraint_analysis data.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// ISL Mock with constraint_analysis per-option
// ---------------------------------------------------------------------------

let mockConstraintAnalysis: any = undefined;

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable',
      confidence: 'high',
      adjustment_sets: [],
      minimal_set: [],
      backdoor_paths: [],
      issues: [],
      explanation: { summary: 'Mock validation', reasoning: 'Test' },
      source: 'isl',
    };
  },
  async analyseSensitivity() {
    return {
      overall_robustness: 'robust',
      sensitive_parameters: [],
      recommendations: [],
      source: 'isl',
    };
  },
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return {
      options: options.map((opt: any, idx: number) => ({
        option_id: opt.id,
        outcome: { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
        rank: idx + 1,
        // CIL C1: Include constraint_analysis when set
        ...(mockConstraintAnalysis && { constraint_analysis: mockConstraintAnalysis }),
      })),
      edges: [],
      edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factors: [],
      value_of_information: [],
      factors_provenance: 'unavailable' as const,
      factor_sensitivity_status: 'skipped_no_factor_values' as const,
      overall_robustness: 'robust' as const,
      robustness_score: 0.8,
      fragile_edges: [],
      robust_edges: [],
      latency_ms: 50,
      source: 'isl' as const,
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
          ...(mockConstraintAnalysis && { constraint_analysis: mockConstraintAnalysis }),
        })),
        edges: [],
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

vi.mock('../src/integrations/isl/index.js', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.js');
  return {
    ...actual,
    getISLService: () => mockISLService,
    islService: mockISLService,
  };
});

import { createServer } from '../src/createServer.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'factor-a', kind: 'factor', label: 'Market Size' },
    { id: 'factor-b', kind: 'factor', label: 'Retention' },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
    { from: 'factor-b', to: 'goal', strength: { mean: 0.7, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': 1.5 } },
  { id: 'opt2', label: 'Option 2', interventions: { 'factor-b': 2.0 } },
];

const BASE_PAYLOAD = {
  graph: GRAPH,
  options: OPTIONS,
  goal_node_id: 'goal',
  seed: '42',
};

const GOAL_CONSTRAINTS = [
  { constraint_id: 'revenue-min', node_id: 'goal', operator: '>=', value: 20000 },
  { constraint_id: 'retention-max', node_id: 'factor-b', operator: '<=', value: 5000 },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CIL C1: Constraint Results Passthrough', () => {
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
    mockConstraintAnalysis = undefined;
  });

  it('constraints_status absent when no goal_constraints sent', async () => {
    mockConstraintAnalysis = undefined;

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(BASE_PAYLOAD),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.constraints_status).toBeUndefined();
    expect(body.constraint_results).toBeUndefined();
  });

  it('constraints_status "unavailable" when ISL returns no constraint_analysis', async () => {
    // ISL returns options but without constraint_analysis
    mockConstraintAnalysis = undefined;

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.constraints_status).toBe('unavailable');
    expect(body.constraint_results).toBeUndefined();
  });

  it('passes through constraint_results with correct field mapping when ISL returns constraint_analysis', async () => {
    // ISL returns constraint_analysis per-option
    mockConstraintAnalysis = {
      constraints: [
        { node_id: 'goal', operator: '>=', threshold: 20000, prob_satisfied: 0.85, failure_margin_median: 1200, near_miss_fraction: 0.12, binding: true },
        { node_id: 'factor-b', operator: '<=', threshold: 5000, prob_satisfied: 0.92, failure_margin_median: 400, near_miss_fraction: 0.05, binding: false },
      ],
      joint_probability: 0.78,
      conditional_probabilities: [
        { given_constraint_index: 0, target_constraint_index: 1, probability: 0.91, effective_sample_size: 500 },
      ],
    };

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Top-level constraint fields
    expect(body.constraints_status).toBe('computed');
    expect(body.constraint_results).toBeDefined();
    expect(body.constraint_results).toHaveLength(2);

    // Field name mapping: ISL's threshold → contract's value
    const cr0 = body.constraint_results[0];
    expect(cr0.constraint_id).toBe('revenue-min');
    expect(cr0.value).toBe(20000);         // ISL "threshold" mapped to "value"
    expect(cr0.probability).toBe(0.85);    // ISL "prob_satisfied" mapped to "probability"
    expect(cr0.node_id).toBe('goal');
    expect(cr0.operator).toBe('>=');

    // Constraint diagnostics
    expect(body.constraint_diagnostics).toBeDefined();
    expect(body.constraint_diagnostics).toHaveLength(2);
    expect(body.constraint_diagnostics[0].failure_margin_median).toBe(1200);
    expect(body.constraint_diagnostics[0].binding).toBe(true);

    // Conditional probabilities (index-based → constraint_id-based)
    expect(body.conditional_probabilities).toBeDefined();
    expect(body.conditional_probabilities).toHaveLength(1);
    expect(body.conditional_probabilities[0].given_constraint_id).toBe('revenue-min');
    expect(body.conditional_probabilities[0].target_constraint_id).toBe('retention-max');
    expect(body.conditional_probabilities[0].probability).toBe(0.91);

    // Per-option fields: probability_of_joint_goal
    expect(body.option_comparison).toBeDefined();
    const opt0 = body.option_comparison.find((o: any) => o.option_id === 'opt1');
    expect(opt0).toBeDefined();
    expect(opt0.probability_of_joint_goal).toBe(0.78);

    // Per-option fields: constraint_probabilities keyed by constraint_id
    expect(opt0.constraint_probabilities).toBeDefined();
    expect(opt0.constraint_probabilities['revenue-min']).toBe(0.85);
    expect(opt0.constraint_probabilities['retention-max']).toBe(0.92);
  });

  it('maps ISL field names correctly: threshold→value, joint_probability→probability_of_joint_goal', async () => {
    mockConstraintAnalysis = {
      constraints: [
        { node_id: 'goal', operator: '>=', threshold: 99999, prob_satisfied: 0.55 },
      ],
      joint_probability: 0.55,
    };

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...BASE_PAYLOAD,
        goal_constraints: [
          { constraint_id: 'c1', node_id: 'goal', operator: '>=', value: 99999 },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Top-level: ISL's threshold → value
    expect(body.constraint_results[0].value).toBe(99999);
    // Should NOT have a "threshold" field
    expect(body.constraint_results[0].threshold).toBeUndefined();

    // Per-option: ISL's joint_probability → probability_of_joint_goal
    const opt = body.option_comparison?.[0];
    expect(opt?.probability_of_joint_goal).toBe(0.55);
  });

  it('deduplicates constraints with same (node_id, operator) — keeps stricter threshold', async () => {
    // Two constraints on same node with same operator but different thresholds.
    // compileConstraintNodes → mergeConstraints deduplicates by (node_id, operator),
    // keeping the stricter one: for >=, that's the higher value (30000).
    const dupConstraints = [
      { constraint_id: 'revenue-low', node_id: 'goal', operator: '>=', value: 10000 },
      { constraint_id: 'revenue-high', node_id: 'goal', operator: '>=', value: 30000 },
    ];

    // ISL will only receive one constraint (the stricter one), so mock only one result
    mockConstraintAnalysis = {
      constraints: [
        { node_id: 'goal', operator: '>=', threshold: 30000, prob_satisfied: 0.40 },
      ],
      joint_probability: 0.40,
    };

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BASE_PAYLOAD, goal_constraints: dupConstraints }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.constraints_status).toBe('computed');
    // Only one constraint result (the deduped/stricter one)
    expect(body.constraint_results).toHaveLength(1);
    expect(body.constraint_results[0].constraint_id).toBe('revenue-high');
    expect(body.constraint_results[0].value).toBe(30000);
    expect(body.constraint_results[0].probability).toBe(0.40);
  });
});
