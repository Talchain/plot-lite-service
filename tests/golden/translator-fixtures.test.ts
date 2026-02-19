/**
 * Translator V3 Unit Test Fixtures
 *
 * Verifies the ISL translator produces correct wire-format output for:
 * 1. Simple brief (no constraints)
 * 2. Constrained brief (goal_constraints present)
 * 3. PU generation (std floors, external priors, skip rules)
 */

import { describe, it, expect } from 'vitest';
import {
  toISLRobustnessRequest,
  buildParameterUncertaintiesV3,
} from '../../src/integrations/isl/translator-v3.js';
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
  it('maps PLoT "value" to ISL "threshold" in goal_constraints', () => {
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
    expect(c1!.threshold).toBe(0.05);
    expect(c1!.node_id).toBe('factor_churn');
    expect(c1!.operator).toBe('<=');

    // Ensure "value" field is NOT in ISL format (only "threshold")
    expect((c1 as any).value).toBeUndefined();
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
    expect(pu!.mean).toBe(0.5);
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
    expect(pu.mean).toBe(0);
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

  it('generates PU from external factor with uniform prior (std ≥ 0.01)', () => {
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
    expect(pu.mean).toBe(0.5); // (0.2 + 0.8) / 2
    expect(pu.std).toBeGreaterThanOrEqual(0.01);
    // Uniform [0.2, 0.8]: std = 0.6 / sqrt(12) ≈ 0.173
    expect(pu.std).toBeCloseTo(0.6 / Math.sqrt(12), 4);
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
    // Should use observed_state path: mean = 0.7, std ≥ 0.1 (not prior path)
    expect(pu.mean).toBe(0.7);
    // 15% of 0.7 = 0.105 > 0.1 floor
    expect(pu.std).toBeCloseTo(0.105, 3);
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
