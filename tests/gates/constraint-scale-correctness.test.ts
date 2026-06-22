/**
 * SCIENTIFIC REGRESSION GATE — WP1: Constraint scale & correctness
 * ----------------------------------------------------------------------------
 * Pins the PLoT/ISL-owned constraint invariants so they cannot silently
 * regress. All assertions are cheap, deterministic, mocked and network-free
 * (unit calls on pure normalisation functions + one `app.inject` HTTP pin
 * against a mocked ISL). Safe for the normal pre-push/CI suite.
 *
 * What this gate protects:
 *   A. Scale SYMMETRY — goal constraints use the *same* [0,1] gate and the
 *      *same* deriveRange/normaliseValue machinery as interventions. There is
 *      no PLoT-side scale bypass. (The "constraints bypass the intervention
 *      scale shim" concern, if it ever bites, originates in CEE request
 *      construction — see the V5 handoff note in the lane plan.)
 *   B. original_value preservation through normalisation.
 *   C. HONEST status — a present-but-empty ISL `constraint_analysis.constraints`
 *      array must NOT be reported as `constraints_status: 'computed'`; it is
 *      `'unavailable'` (no per-constraint results were actually produced).
 *   D. HONEST drops — temporal/deadline constraints are filtered before ISL and
 *      recorded (the records feed `_meta.filtered_constraints`). End-to-end
 *      temporal surfacing is additionally covered by
 *      tests/golden/temporal-filter-e2e.test.ts and
 *      tests/temporal-constraint-filter.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import {
  needsNormalisation,
  constraintsNeedNormalisation,
  normaliseGoalConstraints,
} from '../../src/lib/intervention-normaliser.js';
import { filterTemporalConstraints } from '../../src/normalisation/constraint-filter.js';
import type {
  GoalConstraint,
  EngineNodeV3,
  OptionV3,
  RawGoalConstraint,
} from '../../src/types/engine-v3.js';

// ===========================================================================
// Part A/B/D — pure-function unit pins (no server, no ISL)
// ===========================================================================

describe('WP1 gate · constraint scale symmetry (PLoT-owned)', () => {
  it('uses the IDENTICAL [0,1] gate for constraints and interventions', () => {
    // Same numeric decisions on both paths: value < 0 || value > 1 ⇒ normalise.
    const userScale = [20000, 1.5, -3, 110];
    const alreadyNormalised = [0, 0.5, 1, 0.999];

    for (const v of userScale) {
      const opt = { interventions: { f: { value: v } } } as unknown as OptionV3;
      const con: GoalConstraint = { constraint_id: 'c', node_id: 'goal', operator: '>=', value: v };
      expect(constraintsNeedNormalisation([con])).toBe(true);
      // Symmetry: the intervention gate agrees for the same value.
      expect(needsNormalisation([opt])).toBe(constraintsNeedNormalisation([con]));
    }

    for (const v of alreadyNormalised) {
      const opt = { interventions: { f: { value: v } } } as unknown as OptionV3;
      const con: GoalConstraint = { constraint_id: 'c', node_id: 'goal', operator: '<=', value: v };
      expect(constraintsNeedNormalisation([con])).toBe(false);
      expect(needsNormalisation([opt])).toBe(constraintsNeedNormalisation([con]));
    }
  });

  it('normalises a user-scale constraint via shared deriveRange and preserves original_value', () => {
    // Goal node with an explicit range [0, 40000] (deriveRange source: 'explicit').
    const nodes = [
      { id: 'goal', kind: 'goal', state_space: { range: { min: 0, max: 40000 } } },
    ] as unknown as EngineNodeV3[];

    const constraints: GoalConstraint[] = [
      { constraint_id: 'revenue-min', node_id: 'goal', operator: '>=', value: 20000 },
    ];

    const { constraints: normalised } = normaliseGoalConstraints(constraints, nodes);
    expect(normalised).toHaveLength(1);
    // 20000 on [0,40000] ⇒ 0.5 — identical formula an intervention would use.
    expect(normalised[0].value).toBeCloseTo(0.5, 10);
    // Original user-unit value preserved for honest response echo / denormalisation.
    expect(normalised[0].original_value).toBe(20000);
    // Value handed to ISL is in [0,1].
    expect(normalised[0].value).toBeGreaterThanOrEqual(0);
    expect(normalised[0].value).toBeLessThanOrEqual(1);
  });

  it('does NOT re-normalise an already-[0,1] constraint (gate is the call-site guard)', () => {
    // A probability-domain constraint already in [0,1] must pass the gate as
    // "no normalisation needed" — exactly as interventions in [0,1] do. This is
    // what prevents double-normalisation of already-normalised thresholds.
    const con: GoalConstraint = { constraint_id: 'p', node_id: 'goal', operator: '<=', value: 0.3 };
    expect(constraintsNeedNormalisation([con])).toBe(false);
  });
});

describe('WP1 gate · honest constraint drops (temporal)', () => {
  it('filters a deadline_metadata constraint and records it (feeds _meta.filtered_constraints)', () => {
    const nodes = [{ id: 'goal', kind: 'goal' }] as unknown as EngineNodeV3[];
    const constraints = [
      { constraint_id: 'within-12mo', node_id: 'goal', operator: '<=', value: 12, unit: 'months', deadline_metadata: { horizon_months: 12 } },
      { constraint_id: 'keep-me', node_id: 'goal', operator: '>=', value: 0.8 },
    ] as unknown as RawGoalConstraint[];

    const result = filterTemporalConstraints(constraints, nodes);

    // Dropped constraint is honestly recorded, not silently swallowed.
    expect(result.filtered).toHaveLength(1);
    expect(result.filtered[0].constraint_id).toBe('within-12mo');
    expect(result.filtered[0].reason).toBe('temporal_deadline');

    // The evaluable constraint survives.
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].constraint_id).toBe('keep-me');
  });
});

// ===========================================================================
// Part C — HTTP honesty pin: empty constraint_analysis.constraints ⇒ unavailable
// ===========================================================================
// Mirrors the established mocked-ISL harness from
// tests/cil-constraint-passthrough.test.ts, trimmed to what /v2/run needs to
// reach buildConstraintFields. Uses app.inject (no socket).

let mockConstraintAnalysis: any = undefined;

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [],
      backdoor_paths: [], issues: [],
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
        ...(mockConstraintAnalysis && { constraint_analysis: mockConstraintAnalysis }),
      })),
      edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const, factors: [], value_of_information: [],
      factors_provenance: 'unavailable' as const, factor_sensitivity_status: 'skipped_no_factor_values' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.8, fragile_edges: [], robust_edges: [],
      latency_ms: 50, source: 'isl' as const,
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
        edges: [], factors: [], value_of_information: [], overall_robustness: 'robust',
        robustness_score: 0.8, fragile_edges: [], robust_edges: [],
      } as T,
      error: null,
    };
  },
};

vi.mock('../../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

const { createServer } = await import('../../src/createServer.js');

const BASE_PAYLOAD = {
  graph: {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Revenue' },
      { id: 'factor-a', kind: 'factor', label: 'Market Size' },
    ],
    edges: [{ from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } }],
  },
  options: [
    { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': 1.5 } },
    { id: 'opt2', label: 'Option 2', interventions: { 'factor-a': 2.0 } },
  ],
  goal_node_id: 'goal',
  seed: '42',
};

const GOAL_CONSTRAINTS = [
  { constraint_id: 'revenue-min', node_id: 'goal', operator: '>=', value: 20000 },
];

describe('WP1 gate · honest constraints_status (no fabricated "computed")', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
    mockConstraintAnalysis = undefined;
  });

  async function run(payload: any) {
    const res = await app.inject({
      method: 'POST', url: '/v2/run',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    return { status: res.statusCode, body: res.json() };
  }

  it('REGRESSION: present-but-empty constraint_analysis.constraints ⇒ "unavailable", not "computed"', async () => {
    // ISL echoed the analysis object but evaluated zero constraints. Emitting
    // "computed" here would be a misleading wrong-200. (`[]` is truthy in JS,
    // which is exactly why the previous predicate matched it.)
    mockConstraintAnalysis = { constraints: [] };

    const { status, body } = await run({ ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });
    expect(status).toBe(200);
    expect(body.constraints_status).toBe('unavailable');
    expect(body.constraint_results).toBeUndefined();
  });

  it('POSITIVE CONTROL: non-empty constraint_analysis.constraints ⇒ "computed" with results', async () => {
    mockConstraintAnalysis = {
      constraints: [{ node_id: 'goal', operator: '>=', value: 20000, prob_satisfied: 0.85 }],
      joint_probability: 0.85,
    };

    const { status, body } = await run({ ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });
    expect(status).toBe(200);
    expect(body.constraints_status).toBe('computed');
    expect(body.constraint_results).toBeDefined();
    expect(body.constraint_results).toHaveLength(1);
    expect(body.constraint_results[0].probability).toBe(0.85);
  });

  it('CONTROL: no constraint_analysis at all ⇒ "unavailable" (unchanged behaviour)', async () => {
    mockConstraintAnalysis = undefined;
    const { status, body } = await run({ ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });
    expect(status).toBe(200);
    expect(body.constraints_status).toBe('unavailable');
    expect(body.constraint_results).toBeUndefined();
  });
});
