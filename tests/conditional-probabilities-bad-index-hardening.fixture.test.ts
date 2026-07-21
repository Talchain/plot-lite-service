/**
 * A3 adjacent-hunt FIX #3 — conditional_probabilities bad-index crash hardening.
 *
 * CONFIRMED PRE-EXISTING CRASH (RED before the fix):
 *
 * buildConstraintFields() filters ISL-supplied conditional_probabilities rows
 * only on `given_constraint_index < islConstraints.length` (and target) — with
 * NO `>= 0` / integer guard. A negative or fractional ISL index passes that
 * check, then `islConstraints[idx]` is `undefined` and
 * `resolveConstraintId(undefined, idx)` dereferences `undefined.node_id` and
 * THROWS. The throw propagates out of buildResponse to the route's outermost
 * catch, which degrades the ENTIRE /v2/run response to `analysis_status:
 * 'failed'` + a PLOT_INTERNAL_ERROR critique — the whole analysis is lost
 * because of one malformed row.
 *
 * Contract under test (consistent with the file's untrusted-ISL numeric-egress
 * posture — a bad row is an honest omission, never a fabrication, and never a
 * crash):
 *   - a conditional_probabilities row with a negative index is DROPPED; the
 *     response builds normally (analysis_status computed, valid rows survive).
 *   - a row with a fractional index is DROPPED likewise.
 *
 * The ISL request/ISL service shape is not changed — the mock mirrors the live
 * wire shapes used by tests/constraint-results-top-level-gating.fixture.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Mutable mock state — the conditional_probabilities array ISL returns.
// ---------------------------------------------------------------------------

let mockConditionalProbabilities: any[] = [];

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
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    const options = body.options || [];
    const goalConstraints = body.goal_constraints || [];

    const constraintAnalysis = goalConstraints.length > 0
      ? {
          constraint_analysis: {
            joint_probability: 0.6,
            constraints: goalConstraints.map((c: any) => ({
              node_id: c.node_id,
              operator: c.operator,
              threshold: c.threshold ?? c.value,
              prob_satisfied: 0.6,
            })),
            conditional_probabilities: mockConditionalProbabilities,
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
        factor_sensitivity: [],
        robustness: { label: 'moderate', score: 0.6, fragile_edges: [], robust_edges: [] },
        inference_warnings: [],
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
// Fixtures — two reliable (valued-target, declared '%' scale) constraints so
// the top-level block is BUILT and reaches the conditional_probabilities map.
// ---------------------------------------------------------------------------

const GRAPH = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Grow revenue' },
    { id: 'out_effectiveness', kind: 'outcome', label: 'Campaign effectiveness', observed_state: { value: 50 } },
    { id: 'out_retention', kind: 'outcome', label: 'Customer retention', observed_state: { value: 50 } },
    { id: 'fac_budget', kind: 'factor', label: 'Marketing budget', observed_state: { value: 0.6 } },
  ],
  edges: [
    { from: 'fac_budget', to: 'out_effectiveness', strength: { mean: 0.5, std: 0.1 } },
    { from: 'fac_budget', to: 'out_retention', strength: { mean: 0.4, std: 0.1 } },
    { from: 'out_effectiveness', to: 'goal_growth', strength: { mean: 0.6, std: 0.1 } },
    { from: 'out_retention', to: 'goal_growth', strength: { mean: 0.3, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt_a', label: 'Push campaign', interventions: { fac_budget: 0.8 } },
  { id: 'opt_b', label: 'Hold steady', interventions: { fac_budget: 0.4 } },
];

const CONSTRAINTS = [
  { constraint_id: 'effectiveness_floor', node_id: 'out_effectiveness', operator: '>=', value: 20, unit: '%', label: 'Effectiveness >= 20%' },
  { constraint_id: 'retention_floor', node_id: 'out_retention', operator: '>=', value: 30, unit: '%', label: 'Retention >= 30%' },
];

/** A well-formed conditional row (index 0 given index 1) that must always survive. */
const VALID_ROW = { given_constraint_index: 0, target_constraint_index: 1, probability: 0.5, effective_sample_size: 100 };

async function run(app: FastifyInstance) {
  const res = await app.inject({
    method: 'POST',
    url: '/v2/run',
    headers: { 'Content-Type': 'application/json' },
    payload: JSON.stringify({
      graph: GRAPH,
      options: OPTIONS,
      goal_node_id: 'goal_growth',
      seed: 'conditional-bad-index-hardening',
      goal_constraints: CONSTRAINTS,
    }),
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body);
}

describe('conditional_probabilities bad-index hardening (A3 adjacent-hunt FIX #3)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    app = await createServer();
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app.close();
    mockConditionalProbabilities = [];
  });

  it('CRASH: a NEGATIVE given_constraint_index drops the row, not the whole analysis', async () => {
    // -1 passes the `< length` check (length 2) → islConstraints[-1] is
    // undefined → resolveConstraintId(undefined, -1) throws on base.
    mockConditionalProbabilities = [
      VALID_ROW,
      { given_constraint_index: -1, target_constraint_index: 0, probability: 0.4, effective_sample_size: 50 },
    ];
    try {
      const body = await run(app);

      // On base the throw degrades the ENTIRE response to failed +
      // PLOT_INTERNAL_ERROR; the fix must build normally and drop only the row.
      expect(body.analysis_status).not.toBe('failed');
      const internalErr = (body.critiques ?? []).filter((c: any) => c.code === 'PLOT_INTERNAL_ERROR');
      expect(internalErr).toHaveLength(0);

      expect(body.constraints_status).toBe('computed');
      // Only the well-formed row survives; the bad-index row is honestly dropped.
      expect(body.conditional_probabilities).toEqual([
        { given_constraint_id: 'effectiveness_floor', target_constraint_id: 'retention_floor', probability: 0.5, effective_sample_size: 100 },
      ]);
    } finally {
      mockConditionalProbabilities = [];
    }
  });

  it('CRASH: a FRACTIONAL given_constraint_index drops the row, not the whole analysis', async () => {
    mockConditionalProbabilities = [
      VALID_ROW,
      { given_constraint_index: 1.5, target_constraint_index: 0, probability: 0.4, effective_sample_size: 50 },
    ];
    try {
      const body = await run(app);

      expect(body.analysis_status).not.toBe('failed');
      const internalErr = (body.critiques ?? []).filter((c: any) => c.code === 'PLOT_INTERNAL_ERROR');
      expect(internalErr).toHaveLength(0);

      expect(body.constraints_status).toBe('computed');
      expect(body.conditional_probabilities).toEqual([
        { given_constraint_id: 'effectiveness_floor', target_constraint_id: 'retention_floor', probability: 0.5, effective_sample_size: 100 },
      ]);
    } finally {
      mockConditionalProbabilities = [];
    }
  });
});
