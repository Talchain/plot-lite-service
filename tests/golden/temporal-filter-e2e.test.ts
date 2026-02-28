/**
 * Temporal Constraint Filter End-to-End Tests
 *
 * Verifies that temporal constraints (carrying deadline_metadata or temporal
 * units) are filtered before reaching ISL, and that _meta.filtered_constraints
 * surfaces in the response.
 *
 * Data flow: request body → constraint compilation → temporal filter →
 *            constraintsForISL (filtered) + filteredConstraintRecords (_meta)
 *
 * Uses vi.mock to intercept ISL and capture the request body.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

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
// Fixtures
// ---------------------------------------------------------------------------

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'factor-a', kind: 'factor', label: 'Marketing Spend', observed_state: { value: 0.6 } },
    { id: 'factor-b', kind: 'factor', label: 'Churn Rate', observed_state: { value: 0.5 } },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
    { from: 'factor-b', to: 'goal', strength: { mean: -0.5, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': 1.5 } },
  { id: 'opt2', label: 'Option 2', interventions: { 'factor-b': 0.2 } },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Temporal Constraint Filter E2E', () => {
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

  it('constraint with deadline_metadata → filtered from ISL, surfaced in _meta.filtered_constraints', async () => {
    capturedISLRequestBody = null;

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: GRAPH,
        options: OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
        goal_constraints: [
          // Normal constraint — should pass through to ISL
          {
            constraint_id: 'churn-cap',
            node_id: 'factor-b',
            operator: '<=',
            value: 0.04,
          },
          // Temporal constraint — should be filtered
          {
            constraint_id: 'deadline-12m',
            node_id: 'goal',
            operator: '>=',
            value: 12,
            unit: 'months',
            deadline_metadata: { is_temporal: true, deadline_months: 12 },
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(capturedISLRequestBody).not.toBeNull();

    // The temporal constraint should NOT appear in ISL's goal_constraints
    const islConstraints = capturedISLRequestBody.goal_constraints ?? [];
    const temporalInISL = islConstraints.find(
      (c: any) => c.constraint_id === 'deadline-12m',
    );
    expect(temporalInISL).toBeUndefined();

    // The normal constraint SHOULD appear in ISL
    const normalInISL = islConstraints.find(
      (c: any) => c.constraint_id === 'churn-cap',
    );
    expect(normalInISL).toBeDefined();
    expect(normalInISL.threshold).toBe(0.04); // value → threshold rename

    // Response _meta should contain filtered_constraints
    const body = await res.json() as any;
    const filteredConstraints = body._meta?.filtered_constraints;
    expect(filteredConstraints).toBeDefined();
    expect(filteredConstraints).toHaveLength(1);
    expect(filteredConstraints[0].constraint_id).toBe('deadline-12m');
    expect(filteredConstraints[0].node_id).toBe('goal');
    expect(filteredConstraints[0].reason).toBe('temporal_deadline');
  });

  it('all constraints are non-temporal → _meta.filtered_constraints is absent', async () => {
    capturedISLRequestBody = null;

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: GRAPH,
        options: OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
        goal_constraints: [
          { constraint_id: 'churn-cap', node_id: 'factor-b', operator: '<=', value: 0.04 },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;

    // No temporal constraints → filtered_constraints should be absent
    expect(body._meta?.filtered_constraints).toBeUndefined();
  });

  it('temporal unit on goal node with value > 1 → filtered via drop rule 2', async () => {
    capturedISLRequestBody = null;

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: GRAPH,
        options: OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
        goal_constraints: [
          // Drop rule 2: probability-domain node (goal) + value > 1 + temporal unit
          {
            constraint_id: 'goal-6m',
            node_id: 'goal',
            operator: '<=',
            value: 6,
            unit: 'months',
          },
          // Normal constraint survives
          {
            constraint_id: 'churn-cap',
            node_id: 'factor-b',
            operator: '<=',
            value: 0.04,
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(capturedISLRequestBody).not.toBeNull();

    // goal-6m should be filtered
    const islConstraints = capturedISLRequestBody.goal_constraints ?? [];
    const goalInISL = islConstraints.find((c: any) => c.constraint_id === 'goal-6m');
    expect(goalInISL).toBeUndefined();

    // churn-cap should pass through
    const churnInISL = islConstraints.find((c: any) => c.constraint_id === 'churn-cap');
    expect(churnInISL).toBeDefined();

    const body = await res.json() as any;
    const filteredConstraints = body._meta?.filtered_constraints;
    expect(filteredConstraints).toBeDefined();
    expect(filteredConstraints).toHaveLength(1);
    expect(filteredConstraints[0].constraint_id).toBe('goal-6m');
    expect(filteredConstraints[0].reason).toBe('temporal_against_normalised_goal');
  });

  it('constraint arriving via graph node with deadline_metadata → surfaced in _meta.filtered_constraints (B1-8)', async () => {
    capturedISLRequestBody = null;

    // Graph with a constraint node carrying deadline_metadata (CEE pattern).
    // The constraint node has an incoming edge from goal, so the compiler
    // targets goal as the constrained node.
    const graphWithConstraintNode = {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Revenue' },
        { id: 'factor-a', kind: 'factor', label: 'Marketing Spend', observed_state: { value: 0.6 } },
        { id: 'factor-b', kind: 'factor', label: 'Churn Rate', observed_state: { value: 0.5 } },
        // Constraint node with CEE deadline_metadata
        {
          id: 'deadline_constraint',
          kind: 'constraint',
          label: 'Delivery deadline',
          observed_state: { value: 12, metadata: { operator: '<=' } },
          deadline_metadata: { deadline_date: '2027-02-19' },
          unit: 'months',
          source_quote: 'within 12 months',
          provenance: 'inferred',
        },
      ],
      edges: [
        { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
        { from: 'factor-b', to: 'goal', strength: { mean: -0.5, std: 0.1 } },
        // Edge from goal to constraint node (constraint targets goal)
        { from: 'goal', to: 'deadline_constraint', strength: { mean: 1, std: 0 } },
      ],
    };

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: graphWithConstraintNode,
        options: OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
        // No explicit goal_constraints — constraint comes solely from graph node
      }),
    });

    expect(res.status).toBe(200);

    const body = await res.json() as any;
    const filteredConstraints = body._meta?.filtered_constraints;

    // The graph constraint node carries deadline_metadata → temporal filter
    // should catch it and surface it in _meta.filtered_constraints
    expect(filteredConstraints).toBeDefined();
    expect(filteredConstraints).toHaveLength(1);
    expect(filteredConstraints[0].constraint_id).toBe('compiled:deadline_constraint');
    expect(filteredConstraints[0].node_id).toBe('goal');
    expect(filteredConstraints[0].reason).toBe('temporal_deadline');

    // The temporal constraint should NOT appear in ISL's goal_constraints
    if (capturedISLRequestBody) {
      const islConstraints = capturedISLRequestBody.goal_constraints ?? [];
      const deadlineInISL = islConstraints.find(
        (c: any) => c.constraint_id === 'compiled:deadline_constraint',
      );
      expect(deadlineInISL).toBeUndefined();
    }
  });
});
