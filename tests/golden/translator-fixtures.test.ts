/**
 * Translator V3 Unit Test Fixtures
 *
 * Verifies the ISL translator produces correct wire-format output for:
 * 1. Simple brief (no constraints)
 * 2. Constrained brief (goal_constraints present)
 * 3. PU generation (std floors, external priors, skip rules)
 * 4. Canonical shape verification (B1.4 Category A) — full ISL request shape
 *    locked via canonicalCompare to catch silent regressions
 */

import { describe, it, expect } from 'vitest';
import {
  toISLRobustnessRequest,
  buildParameterUncertaintiesV3,
} from '../../src/integrations/isl/translator-v3.js';
import {
  injectConstraintParameterUncertainties,
  CONSTRAINT_PINNED_STD,
} from '../../src/integrations/isl/constraint-pu-injection.js';
import { canonicalCompare } from '../utils/canonical-compare.js';
import type { EngineGraphV3, EngineNodeV3, OptionV3, GoalConstraint } from '../../src/types/engine-v3.js';

// =============================================================================
// Minimal Test Graphs
// =============================================================================

function simpleGraph(): EngineGraphV3 {
  return {
    nodes: [
      {
        id: 'goal_revenue',
        kind: 'goal',
        label: 'Revenue',
        intercept: 0,
      },
      {
        id: 'factor_price',
        kind: 'factor',
        label: 'Price',
        observed_state: { value: 50 },
      },
      {
        id: 'factor_demand',
        kind: 'factor',
        label: 'Demand',
        observed_state: { value: 100, std: 0.5 },
      },
      {
        id: 'factor_cost',
        kind: 'factor',
        label: 'Cost',
        observed_state: { value: 0 },
      },
    ],
    edges: [
      { from: 'factor_price', to: 'goal_revenue', exists_probability: 1, strength: { mean: 0.8, std: 0.1 } },
      { from: 'factor_demand', to: 'goal_revenue', exists_probability: 0.9, strength: { mean: 0.6, std: 0.2 } },
      { from: 'factor_cost', to: 'goal_revenue', exists_probability: 1, strength: { mean: -0.3, std: 0.1 } },
    ],
  };
}

function simpleOptions(): OptionV3[] {
  return [
    {
      id: 'opt_raise',
      label: 'Raise Price',
      interventions: {
        factor_price: { value: 60, source: 'user_specified' },
      },
    },
    {
      id: 'opt_lower',
      label: 'Lower Price',
      interventions: {
        factor_price: { value: 40, source: 'user_specified' },
      },
    },
  ];
}

function constrainedGraph(): EngineGraphV3 {
  return {
    nodes: [
      { id: 'goal_mrr', kind: 'goal', label: 'MRR', intercept: 0 },
      { id: 'factor_churn', kind: 'factor', label: 'Churn Rate', observed_state: { value: 0.04 } },
      { id: 'factor_acv', kind: 'factor', label: 'ACV', observed_state: { value: 1200 } },
      { id: 'outcome_retention', kind: 'outcome', label: 'Retention', observed_state: { value: 0.85 } },
    ],
    edges: [
      { from: 'factor_churn', to: 'goal_mrr', exists_probability: 1, strength: { mean: -0.7, std: 0.15 } },
      { from: 'factor_acv', to: 'goal_mrr', exists_probability: 1, strength: { mean: 0.5, std: 0.1 } },
      { from: 'factor_churn', to: 'outcome_retention', exists_probability: 0.8, strength: { mean: -0.9, std: 0.1 } },
    ],
  };
}

function constrainedOptions(): OptionV3[] {
  return [
    {
      id: 'opt_upsell',
      label: 'Upsell Strategy',
      interventions: {
        factor_acv: { value: 1500, source: 'user_specified' },
      },
    },
  ];
}

function sampleConstraints(): GoalConstraint[] {
  return [
    {
      constraint_id: 'c1',
      node_id: 'factor_churn',
      operator: '<=',
      value: 0.05,
      label: 'Keep churn under 5%',
    },
    {
      constraint_id: 'c2',
      node_id: 'goal_mrr',
      operator: '>=',
      value: 20000,
      label: 'Reach £20k MRR',
    },
  ];
}

// =============================================================================
// 1. Simple Brief (no constraints)
// =============================================================================

describe('Translator: Simple Brief (no constraints)', () => {
  it('produces correct ISL request structure', () => {
    const graph = simpleGraph();
    const options = simpleOptions();
    const request = toISLRobustnessRequest(graph, options, 'goal_revenue', 'req-001');

    expect(request.request_id).toBe('req-001');
    expect(request.goal_node_id).toBe('goal_revenue');
    expect(request.analysis_types).toEqual(['comparison', 'sensitivity', 'robustness']);
    expect(request.goal_threshold).toBeUndefined();
    expect(request.goal_constraints).toBeUndefined();
  });

  it('does not include decision/option nodes in ISL graph', () => {
    // EngineGraphV3 already has option nodes filtered out (kind: 'option' is not valid)
    // but ensure goal nodes pass through (ISL needs goal)
    const graph = simpleGraph();
    const request = toISLRobustnessRequest(graph, simpleOptions(), 'goal_revenue', 'req-002');

    const nodeIds = request.graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain('goal_revenue');
    expect(nodeIds).toContain('factor_price');
    expect(nodeIds).toContain('factor_demand');
    expect(nodeIds).toContain('factor_cost');
    expect(nodeIds).toHaveLength(4);
  });

  it('generates PU entries for observed factor nodes', () => {
    const graph = simpleGraph();
    const request = toISLRobustnessRequest(graph, simpleOptions(), 'goal_revenue', 'req-003');

    // Factor nodes with observed_state.value should have PU entries
    const puNodeIds = request.parameter_uncertainties?.map((pu) => pu.node_id) ?? [];
    expect(puNodeIds).toContain('factor_price');
    expect(puNodeIds).toContain('factor_demand');
    expect(puNodeIds).toContain('factor_cost');

    // Goal node should NOT have a PU entry
    expect(puNodeIds).not.toContain('goal_revenue');
  });

  it('flattens intervention values (no nested source/value)', () => {
    const graph = simpleGraph();
    const request = toISLRobustnessRequest(graph, simpleOptions(), 'goal_revenue', 'req-004');

    // ISL format: interventions are Record<string, number> (flat)
    const raiseInterventions = request.options.find((o) => o.id === 'opt_raise')?.interventions;
    expect(raiseInterventions).toEqual({ factor_price: 60 });
    expect(typeof raiseInterventions?.factor_price).toBe('number');
  });
});

// =============================================================================
// 2. Constrained Brief
// =============================================================================

describe('Translator: Constrained Brief', () => {
  it('sends canonical "value" field to ISL in goal_constraints (F-20)', () => {
    const graph = constrainedGraph();
    const constraints = sampleConstraints();
    const request = toISLRobustnessRequest(
      graph,
      constrainedOptions(),
      'goal_mrr',
      'req-010',
      undefined, // nSamples
      undefined, // goalThreshold — cleared by XOR
      constraints,
    );

    expect(request.goal_constraints).toBeDefined();
    expect(request.goal_constraints).toHaveLength(2);

    const c1 = request.goal_constraints!.find((c) => c.constraint_id === 'c1');
    expect(c1).toBeDefined();
    expect(c1!.value).toBe(0.05);
    expect(c1!.node_id).toBe('factor_churn');
    expect(c1!.operator).toBe('<=');

    // F-20: legacy "threshold" field must NOT be present
    expect((c1 as any).threshold).toBeUndefined();
  });

  it('omits goal_threshold when constraints are present', () => {
    const graph = constrainedGraph();
    const request = toISLRobustnessRequest(
      graph,
      constrainedOptions(),
      'goal_mrr',
      'req-011',
      undefined,
      undefined, // effectiveGoalThreshold is undefined when constraints active
      sampleConstraints(),
    );

    expect(request.goal_threshold).toBeUndefined();
    expect(request.goal_constraints).toBeDefined();
  });

  it('preserves optional constraint fields (label, weight)', () => {
    const constraints: GoalConstraint[] = [
      {
        constraint_id: 'c-weighted',
        node_id: 'factor_churn',
        operator: '<=',
        value: 0.03,
        label: 'Strict churn',
        weight: 2.0,
      },
    ];
    const request = toISLRobustnessRequest(
      constrainedGraph(),
      constrainedOptions(),
      'goal_mrr',
      'req-012',
      undefined,
      undefined,
      constraints,
    );

    const c = request.goal_constraints![0];
    expect(c.label).toBe('Strict churn');
    expect(c.weight).toBe(2.0);
  });
});

// =============================================================================
// 3. PU Generation
// =============================================================================

describe('Translator: buildParameterUncertaintiesV3', () => {
  it('floors factor std at 0.1', () => {
    const nodes: EngineNodeV3[] = [
      {
        id: 'small_factor',
        kind: 'factor',
        label: 'Small',
        observed_state: { value: 0.5 }, // 15% of 0.5 = 0.075 → floored to 0.1
      },
    ];

    const pus = buildParameterUncertaintiesV3(nodes)!;
    const pu = pus.find((p) => p.node_id === 'small_factor');
    expect(pu).toBeDefined();
    expect(pu!.std).toBeGreaterThanOrEqual(0.1);
    // Slice 6: `mean` is not an ISL-declared PU member and is no longer sent.
    expect(pu!).not.toHaveProperty('mean');
  });

  it('uses observed_state.std when provided (capped at 2.0)', () => {
    const nodes: EngineNodeV3[] = [
      {
        id: 'known_std',
        kind: 'factor',
        label: 'Known',
        observed_state: { value: 10, std: 1.5 },
      },
      {
        id: 'huge_std',
        kind: 'factor',
        label: 'Huge',
        observed_state: { value: 10, std: 5.0 },
      },
    ];

    const pus = buildParameterUncertaintiesV3(nodes)!;

    const known = pus.find((p) => p.node_id === 'known_std')!;
    expect(known.std).toBe(1.5);

    const huge = pus.find((p) => p.node_id === 'huge_std')!;
    expect(huge.std).toBe(2.0); // capped
  });

  it('handles zero-valued factors (std = 0.5, floored at 0.1)', () => {
    const nodes: EngineNodeV3[] = [
      {
        id: 'zero_factor',
        kind: 'factor',
        label: 'Zero',
        observed_state: { value: 0 },
      },
    ];

    const pus = buildParameterUncertaintiesV3(nodes)!;
    const pu = pus.find((p) => p.node_id === 'zero_factor')!;
    expect(pu.std).toBe(0.5);
    // Slice 6: value 0 still produces an entry; its width comes from the
    // zero-value fallback. `mean` is not sent (undeclared by ISL).
    expect(pu).not.toHaveProperty('mean');
  });

  it('skips nodes without observed_state.value', () => {
    const nodes: EngineNodeV3[] = [
      { id: 'goal', kind: 'goal', label: 'Goal' },
      { id: 'factor_no_obs', kind: 'factor', label: 'No Obs' },
    ];

    const pus = buildParameterUncertaintiesV3(nodes);
    // No factor nodes have observed_state.value → undefined
    expect(pus).toBeUndefined();
  });

  it('generates a UNIFORM PU from an external factor prior, bounds intact', () => {
    // Was: "(std ≥ 0.01)" — a width-only normal, which left ISL centring this
    // factor on 0.0 because a prior-only node has no observed_state for its
    // normal branch to read. ISL's uniform branch takes the centre from these
    // bounds instead (robustness_analyzer_v2.py:1180-1188 @ 47f20068); the
    // behavioural proof lives in tests/isl-factor-sampler-centre.contract.test.ts.
    const nodes: EngineNodeV3[] = [
      {
        id: 'ext_factor',
        kind: 'factor',
        label: 'External Market',
        category: 'external',
        prior: { distribution: 'uniform', range_min: 0.2, range_max: 0.8 },
      },
    ];

    const pus = buildParameterUncertaintiesV3(nodes)!;
    const pu = pus.find((p) => p.node_id === 'ext_factor')!;
    expect(pu).toBeDefined();
    expect(pu).not.toHaveProperty('mean');
    expect(pu).toEqual({
      node_id: 'ext_factor',
      distribution: 'uniform',
      range_min: 0.2,
      range_max: 0.8,
    });
  });

  it('observed_state takes precedence over external prior', () => {
    const nodes: EngineNodeV3[] = [
      {
        id: 'dual_factor',
        kind: 'factor',
        label: 'Dual',
        category: 'external',
        observed_state: { value: 0.7 },
        prior: { distribution: 'uniform', range_min: 0.0, range_max: 1.0 },
      },
    ];

    const pus = buildParameterUncertaintiesV3(nodes)!;
    const pu = pus.find((p) => p.node_id === 'dual_factor')!;
    // Should use the observed_state path, not the prior path. Slice 6: `std` is
    // the discriminator — observed_state gives 0.7 * 0.15 = 0.105, the prior
    // path would give 1.0 / sqrt(12) ≈ 0.289.
    expect(pu).not.toHaveProperty('mean');
    expect(pu.std).toBeCloseTo(0.105, 3);
    expect(pu.std).not.toBeCloseTo(1.0 / Math.sqrt(12), 3);
  });

  it('binary factor detection: explicit range [0,1] → std = 0.3', () => {
    const nodes: EngineNodeV3[] = [
      {
        id: 'binary_flag',
        kind: 'factor',
        label: 'Is Active',
        observed_state: { value: 1 },
        state_space: { range: { min: 0, max: 1 } },
      },
    ];

    const pus = buildParameterUncertaintiesV3(nodes)!;
    const pu = pus.find((p) => p.node_id === 'binary_flag')!;
    expect(pu.std).toBe(0.3);
  });
});

// =============================================================================
// 4. Category A — Canonical Shape Verification (B1.4)
// =============================================================================

describe('Translator: Canonical ISL Request Shape (B1.4 Category A)', () => {
  it('simple brief: full ISL request matches canonical shape via canonicalCompare', () => {
    const graph = simpleGraph();
    const options = simpleOptions();
    const request = toISLRobustnessRequest(graph, options, 'goal_revenue', 'req-shape-1', 5000, undefined, undefined, 'seed-42');

    // Verify structural keys — ISL request must have these top-level fields
    expect(request.request_id).toBe('req-shape-1');
    expect(request.goal_node_id).toBe('goal_revenue');
    expect(request.n_samples).toBe(5000);
    expect(request.analysis_types).toEqual(['comparison', 'sensitivity', 'robustness']);
    expect(request.seed).toBe('seed-42');

    // Graph nodes: toISLNode adds intercept=0 for all nodes
    const nodeResult = canonicalCompare(
      request.graph.nodes,
      [
        { id: 'goal_revenue', kind: 'goal', label: 'Revenue', intercept: 0, epsilon_std: 0 },
        { id: 'factor_price', kind: 'factor', label: 'Price', intercept: 0, epsilon_std: 0 },
        { id: 'factor_demand', kind: 'factor', label: 'Demand', intercept: 0, epsilon_std: 0 },
        { id: 'factor_cost', kind: 'factor', label: 'Cost', intercept: 0, epsilon_std: 0 },
      ],
      { ignoreFields: ['observed_state'], sortArraysBy: { '$': 'id' } },
    );
    if (!nodeResult.match) throw new Error(`Node shape mismatch: ${nodeResult.diff}`);

    // Graph edges: preserved from input
    const edgeResult = canonicalCompare(
      request.graph.edges,
      [
        { from: 'factor_price', to: 'goal_revenue', exists_probability: 1, strength: { mean: 0.8, std: 0.1 } },
        { from: 'factor_demand', to: 'goal_revenue', exists_probability: 0.9, strength: { mean: 0.6, std: 0.2 } },
        { from: 'factor_cost', to: 'goal_revenue', exists_probability: 1, strength: { mean: -0.3, std: 0.1 } },
      ],
      { sortArraysBy: { '$': 'from::to' } },
    );
    if (!edgeResult.match) throw new Error(`Edge shape mismatch: ${edgeResult.diff}`);

    // Options: interventions flattened to numbers
    const optionResult = canonicalCompare(
      request.options,
      [
        { id: 'opt_raise', label: 'Raise Price', interventions: { factor_price: 60 } },
        { id: 'opt_lower', label: 'Lower Price', interventions: { factor_price: 40 } },
      ],
      { sortArraysBy: { '$': 'id' } },
    );
    if (!optionResult.match) throw new Error(`Option shape mismatch: ${optionResult.diff}`);

    // PU array verified separately (order-insensitive)
    const puNodeIds = (request.parameter_uncertainties ?? []).map((p) => p.node_id).sort();
    expect(puNodeIds).toEqual(['factor_cost', 'factor_demand', 'factor_price']);
  });

  it('constrained brief: canonical "value" field + constraint shape locked (F-20)', () => {
    const graph = constrainedGraph();
    const constraints = sampleConstraints();
    const request = toISLRobustnessRequest(
      graph, constrainedOptions(), 'goal_mrr', 'req-shape-2',
      undefined, undefined, constraints, 'seed-c',
    );

    // Lock the constraint wire-format shape — F-20: uses "value" not "threshold"
    const expectedConstraints = [
      { constraint_id: 'c1', node_id: 'factor_churn', operator: '<=', value: 0.05, label: 'Keep churn under 5%' },
      { constraint_id: 'c2', node_id: 'goal_mrr', operator: '>=', value: 20000, label: 'Reach £20k MRR' },
    ];

    const constraintResult = canonicalCompare(
      request.goal_constraints,
      expectedConstraints,
      { sortArraysBy: { '$': 'constraint_id' } },
    );
    expect(constraintResult.match).toBe(true);

    // F-20: legacy "threshold" must NOT exist in ISL constraints
    for (const c of request.goal_constraints!) {
      expect((c as any).threshold).toBeUndefined();
    }

    // goal_threshold must be absent (XOR: constraints active)
    expect(request.goal_threshold).toBeUndefined();
  });

  it('constraint PU injection + translator PU = combined list with no duplicates', () => {
    const graph = constrainedGraph();
    const constraints = sampleConstraints();
    const request = toISLRobustnessRequest(
      graph, constrainedOptions(), 'goal_mrr', 'req-shape-3',
      undefined, undefined, constraints,
    );

    // Translator generates PU for factor_churn, factor_acv (both have observed_state)
    // outcome_retention has observed_state but translator only generates PU for kind='factor'
    const puBefore = (request.parameter_uncertainties ?? []).map((p) => p.node_id).sort();

    // Phase 4b+ safety-net injection for constrained outcome_retention
    // (translator doesn't generate PU for outcomes, but constraint c1 targets factor_churn
    //  which already has a translator PU)
    const puResult = injectConstraintParameterUncertainties(
      request, constraints, graph.nodes, 'goal_mrr',
    );

    // factor_churn: already has translator PU → skipped by injection
    // goal_mrr: goal node → skipped
    expect(puResult.skipped).toEqual(
      expect.arrayContaining([
        { node_id: 'goal_mrr', reason: 'goal_node' },
      ]),
    );

    // No duplicates: each node_id appears at most once
    const puAfter = (request.parameter_uncertainties ?? []).map((p) => p.node_id);
    const uniqueIds = new Set(puAfter);
    expect(uniqueIds.size).toBe(puAfter.length);

    // PU count should be >= what translator produced (injection may add, never remove)
    expect(puAfter.length).toBeGreaterThanOrEqual(puBefore.length);
  });

  it('seed forwarding: string and number seeds both reach ISL request', () => {
    const graph = simpleGraph();
    const options = simpleOptions();

    const reqStr = toISLRobustnessRequest(graph, options, 'goal_revenue', 'r1', undefined, undefined, undefined, 'alpha');
    expect(reqStr.seed).toBe('alpha');

    const reqNum = toISLRobustnessRequest(graph, options, 'goal_revenue', 'r2', undefined, undefined, undefined, 42);
    expect(reqNum.seed).toBe(42);

    const reqNone = toISLRobustnessRequest(graph, options, 'goal_revenue', 'r3');
    expect(reqNone.seed).toBeUndefined();
  });
});
