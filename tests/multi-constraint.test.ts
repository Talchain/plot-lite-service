/**
 * Multi-Constraint Analysis Tests
 *
 * Tests for Phase 1 of multi-constraint analysis:
 * - T1: Type compilation
 * - T2: Critique codes
 * - T3: Constraint validation
 * - T4: Precedence routing
 * - T5: Constraint normalisation
 * - T6: Constraint node compilation
 * - T7: ISL request extension
 *
 * @see Multi-Constraint Analysis Phase 1 Spec
 */

import { describe, it, expect } from 'vitest';
import type {
  GoalConstraint,
  ConstraintResult,
  ConstraintDiagnostic,
  ConditionalProbability,
  EngineGraphV3,
  EngineNodeV3,
  OptionComparisonResultV3,
  RunRequestV3,
  RunResponseV3,
  ConstraintFeatureStatus,
} from '../src/types/engine-v3.js';
import { validateGoalConstraints } from '../src/validation/preflight-v2.js';
import { compileConstraintNodes } from '../src/normalisation/constraint-compiler.js';
import {
  normaliseGoalConstraints,
  constraintsNeedNormalisation,
  deriveRange,
  normaliseValue,
} from '../src/lib/intervention-normaliser.js';
import { toISLRobustnessRequest } from '../src/integrations/isl/translator-v3.js';

// -----------------------------------------------------------------------------
// Test Fixtures
// -----------------------------------------------------------------------------

/**
 * Create a minimal valid graph for testing.
 */
function createTestGraph(nodes?: Partial<EngineNodeV3>[]): EngineGraphV3 {
  const defaultNodes: EngineNodeV3[] = [
    { id: 'goal_node', kind: 'goal', label: 'Goal' },
    { id: 'factor_a', kind: 'factor', label: 'Factor A', observed_state: { value: 100 } },
    { id: 'factor_b', kind: 'factor', label: 'Factor B', observed_state: { value: 50 } },
  ];

  const mergedNodes = nodes
    ? nodes.map((n, i) => ({ ...defaultNodes[i], ...n }))
    : defaultNodes;

  return {
    nodes: mergedNodes as EngineNodeV3[],
    edges: [
      { from: 'factor_a', to: 'goal_node', exists_probability: 1, strength: { mean: 0.5, std: 0.1 } },
      { from: 'factor_b', to: 'goal_node', exists_probability: 1, strength: { mean: 0.3, std: 0.1 } },
    ],
  };
}

/**
 * Create a valid GoalConstraint for testing.
 */
function createTestConstraint(overrides?: Partial<GoalConstraint>): GoalConstraint {
  return {
    constraint_id: 'test_constraint',
    node_id: 'factor_a',
    operator: '>=',
    value: 80,
    ...overrides,
  };
}

// =============================================================================
// T1: Type Compilation Tests
// =============================================================================

describe('T1: Type Compilation', () => {
  it('GoalConstraint interface compiles with required fields', () => {
    const constraint: GoalConstraint = {
      constraint_id: 'c1',
      node_id: 'factor_a',
      operator: '>=',
      value: 100,
    };
    expect(constraint.constraint_id).toBe('c1');
    expect(constraint.node_id).toBe('factor_a');
    expect(constraint.operator).toBe('>=');
    expect(constraint.value).toBe(100);
  });

  it('GoalConstraint interface compiles with optional fields', () => {
    const constraint: GoalConstraint = {
      constraint_id: 'c1',
      node_id: 'factor_a',
      operator: '<=',
      value: 50,
      label: 'Keep factor A below 50',
      weight: 0.8,
    };
    expect(constraint.label).toBe('Keep factor A below 50');
    expect(constraint.weight).toBe(0.8);
  });

  it('ConstraintResult interface compiles', () => {
    const result: ConstraintResult = {
      constraint_id: 'c1',
      node_id: 'factor_a',
      operator: '>=',
      value: 100,
      probability: 0.75,
    };
    expect(result.probability).toBe(0.75);
  });

  it('ConstraintDiagnostic interface compiles', () => {
    const diagnostic: ConstraintDiagnostic = {
      constraint_id: 'c1',
      failure_margin_median: 0.15,
      near_miss_fraction: 0.2,
      binding: true,
    };
    expect(diagnostic.binding).toBe(true);
  });

  it('ConditionalProbability interface compiles', () => {
    const conditionalProb: ConditionalProbability = {
      given_constraint_id: 'c1',
      target_constraint_id: 'c2',
      probability: 0.85,
      effective_sample_size: 850,
    };
    expect(conditionalProb.probability).toBe(0.85);
  });

  it('OptionComparisonResultV3 includes constraint probability fields', () => {
    const result: OptionComparisonResultV3 = {
      option_id: 'opt1',
      option_label: 'Option 1',
      probability_of_joint_goal: 0.65,
      constraint_probabilities: {
        c1: 0.8,
        c2: 0.75,
      },
    };
    expect(result.probability_of_joint_goal).toBe(0.65);
    expect(result.constraint_probabilities?.c1).toBe(0.8);
  });

  it('RunRequestV3 accepts goal_constraints', () => {
    const request: Partial<RunRequestV3> = {
      goal_constraints: [
        { constraint_id: 'c1', node_id: 'factor_a', operator: '>=', value: 100 },
      ],
    };
    expect(request.goal_constraints).toHaveLength(1);
  });

  it('ConstraintFeatureStatus type works', () => {
    const status: ConstraintFeatureStatus = 'computed';
    expect(['computed', 'unavailable', 'skipped', 'error']).toContain(status);
  });
});

// =============================================================================
// T2: Critique Code Tests
// =============================================================================

describe('T2: Critique Codes', () => {
  const graph = createTestGraph();

  it('CONSTRAINT_TARGET_NOT_FOUND fires for non-existent node', () => {
    const constraints: GoalConstraint[] = [
      createTestConstraint({ constraint_id: 'c1', node_id: 'non_existent_node' }),
    ];
    const result = validateGoalConstraints(constraints, graph);
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0].code).toBe('CONSTRAINT_TARGET_NOT_FOUND');
  });

  it('CONSTRAINT_TARGET_NOT_IN_INFERENCE fires for decision node', () => {
    const graphWithDecision: EngineGraphV3 = {
      nodes: [
        ...graph.nodes,
        { id: 'decision_node', kind: 'decision' as any, label: 'Decision' },
      ],
      edges: graph.edges,
    };
    const constraints: GoalConstraint[] = [
      createTestConstraint({ constraint_id: 'c1', node_id: 'decision_node' }),
    ];
    const result = validateGoalConstraints(constraints, graphWithDecision);
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0].code).toBe('CONSTRAINT_TARGET_NOT_IN_INFERENCE');
  });

  it('CONSTRAINT_TARGET_NOT_IN_INFERENCE fires for option node', () => {
    const graphWithOption: EngineGraphV3 = {
      nodes: [
        ...graph.nodes,
        { id: 'option_node', kind: 'option' as any, label: 'Option' },
      ],
      edges: graph.edges,
    };
    const constraints: GoalConstraint[] = [
      createTestConstraint({ constraint_id: 'c1', node_id: 'option_node' }),
    ];
    const result = validateGoalConstraints(constraints, graphWithOption);
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0].code).toBe('CONSTRAINT_TARGET_NOT_IN_INFERENCE');
  });

  it('CONSTRAINT_INVALID_OPERATOR fires for invalid operator', () => {
    const constraints: GoalConstraint[] = [
      { constraint_id: 'c1', node_id: 'factor_a', operator: '=' as any, value: 100 },
    ];
    const result = validateGoalConstraints(constraints, graph);
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0].code).toBe('CONSTRAINT_INVALID_OPERATOR');
  });

  it('CONSTRAINT_DUPLICATE_ID fires for duplicate constraint IDs', () => {
    const constraints: GoalConstraint[] = [
      createTestConstraint({ constraint_id: 'dup_id', node_id: 'factor_a' }),
      createTestConstraint({ constraint_id: 'dup_id', node_id: 'factor_b' }),
    ];
    const result = validateGoalConstraints(constraints, graph);
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0].code).toBe('CONSTRAINT_DUPLICATE_ID');
  });

  it('CONSTRAINT_VALUE_OUTSIDE_RANGE fires when value outside explicit range', () => {
    const graphWithRange: EngineGraphV3 = {
      nodes: [
        { id: 'goal_node', kind: 'goal', label: 'Goal' },
        {
          id: 'factor_a',
          kind: 'factor',
          label: 'Factor A',
          observed_state: { value: 50 },
          state_space: { range: { min: 0, max: 100 } },
        },
      ],
      edges: [],
    };
    const constraints: GoalConstraint[] = [
      createTestConstraint({ constraint_id: 'c1', node_id: 'factor_a', value: 150 }),
    ];
    const result = validateGoalConstraints(constraints, graphWithRange);
    expect(result.warnings.some(w => w.code === 'CONSTRAINT_VALUE_OUTSIDE_RANGE')).toBe(true);
  });

  it('CONSTRAINT_MISSING_RANGE fires as info when no derivable range', () => {
    const graphNoRange: EngineGraphV3 = {
      nodes: [
        { id: 'goal_node', kind: 'goal', label: 'Goal' },
        { id: 'factor_a', kind: 'factor', label: 'Factor A' }, // No observed_state, no state_space
      ],
      edges: [],
    };
    const constraints: GoalConstraint[] = [
      createTestConstraint({ constraint_id: 'c1', node_id: 'factor_a', value: 50 }),
    ];
    const result = validateGoalConstraints(constraints, graphNoRange);
    const critique = result.warnings.find(w => w.code === 'CONSTRAINT_MISSING_RANGE');
    expect(critique).toBeDefined();
    expect(critique!.severity).toBe('info');
  });

  it('CONSTRAINT_DUPLICATE_TARGET fires for same node/operator combination', () => {
    const constraints: GoalConstraint[] = [
      createTestConstraint({ constraint_id: 'c1', node_id: 'factor_a', operator: '>=', value: 80 }),
      createTestConstraint({ constraint_id: 'c2', node_id: 'factor_a', operator: '>=', value: 90 }),
    ];
    const result = validateGoalConstraints(constraints, graph);
    expect(result.warnings.some(w => w.code === 'CONSTRAINT_DUPLICATE_TARGET')).toBe(true);
  });

  it('CONSTRAINT_TARGET_NO_OBSERVED_VALUE fires for factor without observed_state.value', () => {
    const graphNoValue: EngineGraphV3 = {
      nodes: [
        { id: 'goal_node', kind: 'goal', label: 'Goal' },
        { id: 'factor_bare', kind: 'factor', label: 'Bare Factor' }, // No observed_state
      ] as EngineNodeV3[],
      edges: [],
    };
    const constraints: GoalConstraint[] = [
      createTestConstraint({ constraint_id: 'c1', node_id: 'factor_bare', value: 0.04 }),
    ];
    const result = validateGoalConstraints(constraints, graphNoValue);
    const critique = result.warnings.find(w => w.code === 'CONSTRAINT_TARGET_NO_OBSERVED_VALUE');
    expect(critique).toBeDefined();
    expect(critique!.severity).toBe('warning');
    expect(critique!.message).toContain('factor_bare');
    expect(critique!.message).toContain('no observed_state.value');
  });

  it('CONSTRAINT_TARGET_NO_OBSERVED_VALUE does NOT fire for factor with observed_state.value', () => {
    const constraints: GoalConstraint[] = [
      createTestConstraint({ constraint_id: 'c1', node_id: 'factor_a', value: 80 }),
    ];
    // graph fixture has factor_a with observed_state: { value: 100 }
    const result = validateGoalConstraints(constraints, graph);
    expect(result.warnings.some(w => w.code === 'CONSTRAINT_TARGET_NO_OBSERVED_VALUE')).toBe(false);
  });
});

// =============================================================================
// T3: Constraint Validation Function Tests
// =============================================================================

describe('T3: Constraint Validation Function', () => {
  const graph = createTestGraph();

  it('returns empty results for undefined goal_constraints', () => {
    const result = validateGoalConstraints(undefined, graph);
    expect(result.blockers).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('returns empty results for empty goal_constraints array', () => {
    const result = validateGoalConstraints([], graph);
    expect(result.blockers).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('validates valid constraints without errors', () => {
    const graphWithRange: EngineGraphV3 = {
      nodes: [
        { id: 'goal_node', kind: 'goal', label: 'Goal' },
        {
          id: 'factor_a',
          kind: 'factor',
          label: 'Factor A',
          observed_state: { value: 50 },
          state_space: { range: { min: 0, max: 100 } },
        },
      ],
      edges: [],
    };
    const constraints: GoalConstraint[] = [
      createTestConstraint({ constraint_id: 'c1', node_id: 'factor_a', value: 80 }),
    ];
    const result = validateGoalConstraints(constraints, graphWithRange);
    expect(result.blockers).toHaveLength(0);
    // No OUTSIDE_RANGE warning because value is within range
    expect(result.warnings.some(w => w.code === 'CONSTRAINT_VALUE_OUTSIDE_RANGE')).toBe(false);
  });

  it('handles mixed valid and invalid constraints', () => {
    const constraints: GoalConstraint[] = [
      createTestConstraint({ constraint_id: 'valid', node_id: 'factor_a' }),
      createTestConstraint({ constraint_id: 'invalid', node_id: 'non_existent' }),
    ];
    const result = validateGoalConstraints(constraints, graph);
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0].code).toBe('CONSTRAINT_TARGET_NOT_FOUND');
  });

  it('stops validation for a constraint after first blocker', () => {
    // Constraint with non-existent node should not also check operator
    const constraints: GoalConstraint[] = [
      { constraint_id: 'c1', node_id: 'non_existent', operator: 'invalid' as any, value: 100 },
    ];
    const result = validateGoalConstraints(constraints, graph);
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0].code).toBe('CONSTRAINT_TARGET_NOT_FOUND');
  });
});

// =============================================================================
// T4: Precedence Routing Tests
// =============================================================================

describe('T4: Precedence Routing', () => {
  // Note: Precedence routing is integrated into run.ts
  // These tests validate the logic conceptually

  it('goal_constraints takes precedence over goal_threshold', () => {
    // When goal_constraints is present and non-empty, goal_threshold is ignored
    const goalConstraints: GoalConstraint[] = [
      createTestConstraint({ constraint_id: 'c1', value: 100 }),
    ];
    const goalThreshold = 80;

    // Simulate precedence logic
    const useMultiConstraint = goalConstraints.length > 0;
    const effectiveThreshold = useMultiConstraint ? undefined : goalThreshold;

    expect(useMultiConstraint).toBe(true);
    expect(effectiveThreshold).toBeUndefined();
  });

  it('falls back to goal_threshold when goal_constraints is empty', () => {
    const goalConstraints: GoalConstraint[] = [];
    const goalThreshold = 80;

    const useMultiConstraint = goalConstraints.length > 0;
    const effectiveThreshold = useMultiConstraint ? undefined : goalThreshold;

    expect(useMultiConstraint).toBe(false);
    expect(effectiveThreshold).toBe(80);
  });

  it('falls back to goal_threshold when goal_constraints is undefined', () => {
    const goalConstraints: GoalConstraint[] | undefined = undefined;
    const goalThreshold = 80;

    const useMultiConstraint = (goalConstraints ?? []).length > 0;
    const effectiveThreshold = useMultiConstraint ? undefined : goalThreshold;

    expect(useMultiConstraint).toBe(false);
    expect(effectiveThreshold).toBe(80);
  });

  it('detects conflict when goal_threshold targets same node with different value', () => {
    const goalConstraints: GoalConstraint[] = [
      createTestConstraint({ constraint_id: 'c1', node_id: 'goal_node', operator: '>=', value: 100 }),
    ];
    const goalThreshold = 80;
    const goalNodeId = 'goal_node';

    const conflictingConstraint = goalConstraints.find(
      c => c.node_id === goalNodeId
    );
    const isConflicting = conflictingConstraint && (
      conflictingConstraint.value !== goalThreshold ||
      conflictingConstraint.operator === '<='
    );

    expect(isConflicting).toBe(true);
  });

  it('detects no conflict when goal_threshold matches constraint', () => {
    const goalConstraints: GoalConstraint[] = [
      createTestConstraint({ constraint_id: 'c1', node_id: 'goal_node', operator: '>=', value: 80 }),
    ];
    const goalThreshold = 80;
    const goalNodeId = 'goal_node';

    const conflictingConstraint = goalConstraints.find(
      c => c.node_id === goalNodeId
    );
    const isConflicting = conflictingConstraint && (
      conflictingConstraint.value !== goalThreshold ||
      conflictingConstraint.operator === '<='
    );

    expect(isConflicting).toBe(false);
  });
});

// =============================================================================
// T5: Constraint Normalisation Tests
// =============================================================================

describe('T5: Constraint Normalisation', () => {
  it('normalises constraint value using target node range', () => {
    const nodes: EngineNodeV3[] = [
      {
        id: 'factor_a',
        kind: 'factor',
        label: 'Factor A',
        observed_state: { value: 50 },
        state_space: { range: { min: 0, max: 100 } },
      },
    ];
    const constraints: GoalConstraint[] = [
      createTestConstraint({ constraint_id: 'c1', node_id: 'factor_a', value: 80 }),
    ];

    const result = normaliseGoalConstraints(constraints, nodes);

    expect(result.constraints).toHaveLength(1);
    expect(result.constraints[0].value).toBe(0.8); // 80/100 = 0.8
    expect(result.constraints[0].original_value).toBe(80);
  });

  it('preserves original value for denormalisation', () => {
    const nodes: EngineNodeV3[] = [
      {
        id: 'factor_a',
        kind: 'factor',
        label: 'Factor A',
        observed_state: { value: 50 },
        state_space: { range: { min: 0, max: 200 } },
      },
    ];
    const constraints: GoalConstraint[] = [
      createTestConstraint({ constraint_id: 'c1', node_id: 'factor_a', value: 150 }),
    ];

    const result = normaliseGoalConstraints(constraints, nodes);

    expect(result.constraints[0].value).toBe(0.75); // 150/200 = 0.75
    expect(result.constraints[0].original_value).toBe(150);
  });

  it('uses heuristic fallback when no explicit range', () => {
    const nodes: EngineNodeV3[] = [
      {
        id: 'factor_a',
        kind: 'factor',
        label: 'Factor A',
        observed_state: { value: 50 },
        // No state_space.range
      },
    ];
    const constraints: GoalConstraint[] = [
      createTestConstraint({ constraint_id: 'c1', node_id: 'factor_a', value: 80 }),
    ];

    const result = normaliseGoalConstraints(constraints, nodes);

    expect(result.constraints).toHaveLength(1);
    expect(result.diagnostics[0].used_heuristic).toBe(true);
  });

  it('generates repair records for normalisation', () => {
    const nodes: EngineNodeV3[] = [
      {
        id: 'factor_a',
        kind: 'factor',
        label: 'Factor A',
        state_space: { range: { min: 0, max: 100 } },
      },
    ];
    const constraints: GoalConstraint[] = [
      createTestConstraint({ constraint_id: 'c1', node_id: 'factor_a', value: 50 }),
    ];

    const result = normaliseGoalConstraints(constraints, nodes);

    expect(result.repairs).toHaveLength(1);
    expect(result.repairs[0].field).toBe('constraint.value.c1');
    expect(result.repairs[0].action).toBe('normalised');
    expect(result.repairs[0].from_value).toBe(50);
    expect(result.repairs[0].to_value).toBe(0.5);
  });

  it('constraintsNeedNormalisation returns true for values outside [0,1]', () => {
    const constraints: GoalConstraint[] = [
      createTestConstraint({ value: 100 }),
    ];
    expect(constraintsNeedNormalisation(constraints)).toBe(true);
  });

  it('constraintsNeedNormalisation returns false for values in [0,1]', () => {
    const constraints: GoalConstraint[] = [
      createTestConstraint({ value: 0.8 }),
    ];
    expect(constraintsNeedNormalisation(constraints)).toBe(false);
  });

  it('handles default range when node not found', () => {
    const nodes: EngineNodeV3[] = []; // Empty nodes
    const constraints: GoalConstraint[] = [
      createTestConstraint({ constraint_id: 'c1', node_id: 'non_existent', value: 0.5 }),
    ];

    const result = normaliseGoalConstraints(constraints, nodes);

    // Should use default [0,1] range, so value stays 0.5
    expect(result.constraints[0].value).toBe(0.5);
  });
});

// =============================================================================
// T6: Constraint Node Compilation Tests
// =============================================================================

describe('T6: Constraint Node Compilation', () => {
  it('compiles well-formed constraint node with explicit operator', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'factor_a', kind: 'factor', label: 'Factor A' },
        {
          id: 'constraint_node',
          kind: 'constraint' as any,
          label: 'MRR Constraint',
          observed_state: { value: 20000, metadata: { operator: '>=' } },
        },
      ],
      edges: [
        { from: 'factor_a', to: 'constraint_node', exists_probability: 1, strength: { mean: 1, std: 0.1 } },
      ],
    };

    const result = compileConstraintNodes(graph, undefined);

    expect(result.constraints).toHaveLength(1);
    expect(result.constraints[0].node_id).toBe('factor_a');
    expect(result.constraints[0].operator).toBe('>=');
    expect(result.constraints[0].value).toBe(20000);
    expect(result.constraints[0].constraint_id).toBe('compiled:constraint_node');
  });

  it('skips constraint node missing operator', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'factor_a', kind: 'factor', label: 'Factor A' },
        {
          id: 'constraint_node',
          kind: 'constraint' as any,
          label: 'MRR Constraint',
          observed_state: { value: 20000 }, // No operator
        },
      ],
      edges: [
        { from: 'factor_a', to: 'constraint_node', exists_probability: 1, strength: { mean: 1, std: 0.1 } },
      ],
    };

    const result = compileConstraintNodes(graph, undefined);

    expect(result.constraints).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('Missing explicit operator');
    expect(result.repairs.some(r => r.to_value === 'skipped')).toBe(true);
  });

  it('skips constraint node with missing value', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'factor_a', kind: 'factor', label: 'Factor A' },
        {
          id: 'constraint_node',
          kind: 'constraint' as any,
          label: 'MRR Constraint',
          observed_state: { metadata: { operator: '>=' } }, // No value
        },
      ],
      edges: [
        { from: 'factor_a', to: 'constraint_node', exists_probability: 1, strength: { mean: 1, std: 0.1 } },
      ],
    };

    const result = compileConstraintNodes(graph, undefined);

    expect(result.constraints).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('Missing or invalid observed_state.value');
  });

  it('skips constraint node with no incoming edge', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'factor_a', kind: 'factor', label: 'Factor A' },
        {
          id: 'constraint_node',
          kind: 'constraint' as any,
          label: 'MRR Constraint',
          observed_state: { value: 20000, metadata: { operator: '>=' } },
        },
      ],
      edges: [], // No edges
    };

    const result = compileConstraintNodes(graph, undefined);

    expect(result.constraints).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('No incoming edge');
  });

  it('skips constraint node with multiple incoming edges', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'factor_a', kind: 'factor', label: 'Factor A' },
        { id: 'factor_b', kind: 'factor', label: 'Factor B' },
        {
          id: 'constraint_node',
          kind: 'constraint' as any,
          label: 'MRR Constraint',
          observed_state: { value: 20000, metadata: { operator: '>=' } },
        },
      ],
      edges: [
        { from: 'factor_a', to: 'constraint_node', exists_probability: 1, strength: { mean: 1, std: 0.1 } },
        { from: 'factor_b', to: 'constraint_node', exists_probability: 1, strength: { mean: 1, std: 0.1 } },
      ],
    };

    const result = compileConstraintNodes(graph, undefined);

    expect(result.constraints).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('Multiple incoming edges');
  });

  it('explicit constraints win over compiled constraints', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'factor_a', kind: 'factor', label: 'Factor A' },
        {
          id: 'constraint_node',
          kind: 'constraint' as any,
          label: 'MRR Constraint',
          observed_state: { value: 20000, metadata: { operator: '>=' } },
        },
      ],
      edges: [
        { from: 'factor_a', to: 'constraint_node', exists_probability: 1, strength: { mean: 1, std: 0.1 } },
      ],
    };

    const explicitConstraints: GoalConstraint[] = [
      { constraint_id: 'explicit_c1', node_id: 'factor_a', operator: '>=', value: 25000 },
    ];

    const result = compileConstraintNodes(graph, explicitConstraints);

    // Only the explicit constraint should remain (same node_id + operator)
    expect(result.constraints).toHaveLength(1);
    expect(result.constraints[0].constraint_id).toBe('explicit_c1');
    expect(result.constraints[0].value).toBe(25000);
  });

  it('same-source dedupe keeps strictest threshold for >=', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'factor_a', kind: 'factor', label: 'Factor A' },
        {
          id: 'constraint_node_1',
          kind: 'constraint' as any,
          label: 'MRR Constraint 1',
          observed_state: { value: 20000, metadata: { operator: '>=' } },
        },
        {
          id: 'constraint_node_2',
          kind: 'constraint' as any,
          label: 'MRR Constraint 2',
          observed_state: { value: 25000, metadata: { operator: '>=' } },
        },
      ],
      edges: [
        { from: 'factor_a', to: 'constraint_node_1', exists_probability: 1, strength: { mean: 1, std: 0.1 } },
        { from: 'factor_a', to: 'constraint_node_2', exists_probability: 1, strength: { mean: 1, std: 0.1 } },
      ],
    };

    const result = compileConstraintNodes(graph, undefined);

    // Should keep the stricter threshold (25000 for >=)
    expect(result.constraints).toHaveLength(1);
    expect(result.constraints[0].value).toBe(25000);
  });

  it('same-source dedupe keeps strictest threshold for <=', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'factor_a', kind: 'factor', label: 'Factor A' },
        {
          id: 'constraint_node_1',
          kind: 'constraint' as any,
          label: 'Churn Constraint 1',
          observed_state: { value: 0.05, metadata: { operator: '<=' } },
        },
        {
          id: 'constraint_node_2',
          kind: 'constraint' as any,
          label: 'Churn Constraint 2',
          observed_state: { value: 0.04, metadata: { operator: '<=' } },
        },
      ],
      edges: [
        { from: 'factor_a', to: 'constraint_node_1', exists_probability: 1, strength: { mean: 1, std: 0.1 } },
        { from: 'factor_a', to: 'constraint_node_2', exists_probability: 1, strength: { mean: 1, std: 0.1 } },
      ],
    };

    const result = compileConstraintNodes(graph, undefined);

    // Should keep the stricter threshold (0.04 for <=)
    expect(result.constraints).toHaveLength(1);
    expect(result.constraints[0].value).toBe(0.04);
  });

  it('generates repair record for compiled constraints', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'factor_a', kind: 'factor', label: 'Factor A' },
        {
          id: 'constraint_node',
          kind: 'constraint' as any,
          label: 'MRR Constraint',
          observed_state: { value: 20000, metadata: { operator: '>=' } },
        },
      ],
      edges: [
        { from: 'factor_a', to: 'constraint_node', exists_probability: 1, strength: { mean: 1, std: 0.1 } },
      ],
    };

    const result = compileConstraintNodes(graph, undefined);

    expect(result.repairs.some(r => r.action === 'derived' && r.field.includes('constraint_node'))).toBe(true);
  });
});

// =============================================================================
// T7: ISL Request Extension Tests
// =============================================================================

describe('T7: ISL Request Extension', () => {
  const graph = createTestGraph();
  const options = [
    { id: 'opt1', label: 'Option 1', interventions: { factor_a: { value: 0.8, source: 'user_specified' as const } } },
    { id: 'opt2', label: 'Option 2', interventions: { factor_a: { value: 0.6, source: 'user_specified' as const } } },
  ];

  it('includes goal_constraints in ISL request when present', () => {
    const constraints: GoalConstraint[] = [
      createTestConstraint({ constraint_id: 'c1', node_id: 'factor_a', value: 0.8 }),
    ];

    const request = toISLRobustnessRequest(
      graph,
      options,
      'goal_node',
      'request-123',
      1000,
      undefined, // No goal_threshold
      constraints
    );

    expect(request.goal_constraints).toBeDefined();
    expect(request.goal_constraints).toHaveLength(1);
    expect(request.goal_constraints![0].constraint_id).toBe('c1');
  });

  it('omits goal_constraints from ISL request when absent', () => {
    const request = toISLRobustnessRequest(
      graph,
      options,
      'goal_node',
      'request-123',
      1000,
      80, // Use goal_threshold
      undefined // No constraints
    );

    expect(request.goal_constraints).toBeUndefined();
    expect(request.goal_threshold).toBe(80);
  });

  it('omits goal_constraints when empty array', () => {
    const request = toISLRobustnessRequest(
      graph,
      options,
      'goal_node',
      'request-123',
      1000,
      80,
      [] // Empty constraints
    );

    expect(request.goal_constraints).toBeUndefined();
  });

  it('can include both goal_threshold and goal_constraints', () => {
    // This tests that the translator doesn't block both being set
    // (precedence routing in run.ts handles the logic)
    const constraints: GoalConstraint[] = [
      createTestConstraint({ constraint_id: 'c1', value: 0.9 }),
    ];

    const request = toISLRobustnessRequest(
      graph,
      options,
      'goal_node',
      'request-123',
      1000,
      80,
      constraints
    );

    expect(request.goal_threshold).toBe(80);
    expect(request.goal_constraints).toHaveLength(1);
  });
});

// =============================================================================
// Integration Tests (Unit)
// =============================================================================

describe('Integration: End-to-End Constraint Flow (Unit)', () => {
  it('full pipeline: compile → validate → ISL request (raw values, no normalisation)', () => {
    // Graph with a constraint node
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'goal_node', kind: 'goal', label: 'Goal' },
        {
          id: 'mrr_factor',
          kind: 'factor',
          label: 'MRR',
          observed_state: { value: 15000 },
          state_space: { range: { min: 0, max: 50000 } },
        },
        {
          id: 'mrr_constraint',
          kind: 'constraint' as any,
          label: 'MRR Target',
          observed_state: { value: 20000, metadata: { operator: '>=' } },
        },
      ],
      edges: [
        { from: 'mrr_factor', to: 'goal_node', exists_probability: 1, strength: { mean: 0.5, std: 0.1 } },
        { from: 'mrr_factor', to: 'mrr_constraint', exists_probability: 1, strength: { mean: 1, std: 0.1 } },
      ],
    };

    const filteredGraph: EngineGraphV3 = {
      nodes: graph.nodes.filter(n => n.kind !== 'constraint'),
      edges: graph.edges.filter(e => e.to !== 'mrr_constraint'),
    };

    // Step 1: Compile constraint nodes
    const compilation = compileConstraintNodes(graph, undefined);
    expect(compilation.constraints).toHaveLength(1);
    expect(compilation.constraints[0].value).toBe(20000);

    // Step 2: Validate constraints against filtered graph
    const validation = validateGoalConstraints(compilation.constraints, filteredGraph);
    expect(validation.blockers).toHaveLength(0);

    // Step 3: Build ISL request with raw constraint values (no normalisation)
    // ISL compares raw sampled values against raw constraint values.
    const options = [
      { id: 'opt1', label: 'Option 1', interventions: { mrr_factor: { value: 0.5, source: 'user_specified' as const } } },
    ];
    const islRequest = toISLRobustnessRequest(
      filteredGraph,
      options,
      'goal_node',
      'request-123',
      1000,
      undefined,
      compilation.constraints // raw, not normalised
    );

    expect(islRequest.goal_constraints).toHaveLength(1);
    expect(islRequest.goal_constraints![0].threshold).toBe(20000); // raw value preserved (mapped to ISL's "threshold" field)
    expect(islRequest.goal_constraints![0]).not.toHaveProperty('value');
    expect(islRequest.goal_threshold).toBeUndefined();
  });

  it('constraint values >1 pass through to ISL without normalisation', () => {
    const testGraph = createTestGraph();
    const testOptions = [
      { id: 'opt1', label: 'Option 1', interventions: { factor_a: { value: 0.8, source: 'user_specified' as const } } },
    ];
    const constraints: GoalConstraint[] = [
      createTestConstraint({ constraint_id: 'mrr_min', node_id: 'factor_a', operator: '>=', value: 50000 }),
      createTestConstraint({ constraint_id: 'cac_max', node_id: 'factor_b', operator: '<=', value: 1200 }),
    ];

    const islRequest = toISLRobustnessRequest(
      testGraph,
      testOptions,
      'goal_node',
      'request-123',
      1000,
      undefined,
      constraints
    );

    expect(islRequest.goal_constraints).toHaveLength(2);
    expect(islRequest.goal_constraints![0].threshold).toBe(50000);
    expect(islRequest.goal_constraints![1].threshold).toBe(1200);
  });
});

// =============================================================================
// HTTP Integration Tests
// =============================================================================

import { spawnServer, requestJSON, type ServerHandle } from './utils.js';
import { afterEach, vi } from 'vitest';

describe('Integration: Precedence Routing via /v2/run', () => {
  let server: ServerHandle | null = null;

  const ENV = {
    TEST_ROUTES: '1',
    AUTH_ENABLED: '0',
    RATE_LIMIT_ENABLED: '0',
    ISL_BASE_URL: 'mock',
    ISL_MOCK_ENABLE: '1',
    UI_CANONICAL_META: '1', // Enable _meta to inspect repair records
  };

  afterEach(async () => {
    await server?.kill();
    server = null;
  });

  const VALID_GRAPH = {
    nodes: [
      {
        id: 'mrr_factor',
        kind: 'factor',
        label: 'MRR',
        observed_state: { value: 15000 },
        state_space: { range: { min: 0, max: 50000 } },
      },
      { id: 'churn_factor', kind: 'factor', label: 'Churn Rate', observed_state: { value: 0.05 } },
      { id: 'goal', kind: 'goal', label: 'Business Goal' },
    ],
    edges: [
      { from: 'mrr_factor', to: 'goal', exists_probability: 1, strength: { mean: 0.6, std: 0.1 } },
      { from: 'churn_factor', to: 'goal', exists_probability: 1, strength: { mean: -0.4, std: 0.1 } },
    ],
  };

  const VALID_OPTIONS = [
    {
      id: 'opt1',
      label: 'Growth Strategy',
      interventions: { mrr_factor: { value: 25000, source: 'user_specified' } },
    },
    {
      id: 'opt2',
      label: 'Retention Strategy',
      interventions: { churn_factor: { value: 0.02, source: 'user_specified' } },
    },
  ];

  it('goal_constraints takes precedence when both goal_threshold and goal_constraints provided', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const { status, data } = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: VALID_GRAPH,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        goal_threshold: 80, // Should be IGNORED
        goal_constraints: [
          { constraint_id: 'mrr_target', node_id: 'mrr_factor', operator: '>=', value: 20000, label: 'MRR Target' },
          { constraint_id: 'churn_cap', node_id: 'churn_factor', operator: '<=', value: 0.04, label: 'Churn Cap' },
        ],
      }),
    });

    expect(status).toBe(200);

    // Verify multi-constraint path was activated by checking for repair record about ignored goal_threshold
    // _meta.repairs_applied should contain a record showing goal_threshold was ignored
    expect(data?._meta?.repairs_applied).toBeDefined();
    const repairs = data?._meta?.repairs_applied as Array<{ field: string; action: string; reason: string }>;
    const goalThresholdRepair = repairs?.find(
      (r) => r.field === 'goal_threshold' && r.action === 'inferred'
    );
    expect(goalThresholdRepair).toBeDefined();
    expect(goalThresholdRepair?.reason).toContain('goal_constraints');
    expect(goalThresholdRepair?.reason).toContain('ignored');
  });

  it('auto-generates constraint from goal_threshold when goal_constraints is empty', async () => {
    // P0-3: When goal_constraints is empty but goal_threshold exists,
    // PLoT synthesises an auto-constraint. The multi-constraint path activates,
    // so constraints_status is present (ISL mock may not return constraint_analysis,
    // yielding 'unavailable').
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const { status, data } = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: VALID_GRAPH,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        goal_threshold: 80,
        goal_constraints: [], // Empty — auto-constraint synthesised from goal_threshold
      }),
    });

    expect(status).toBe(200);

    // Auto-constraint activates multi-constraint path → constraints_status present
    expect(data?.constraints_status).toBeDefined();

    // Verify auto-constraint repair record
    const repairs = data?._meta?.repairs_applied as Array<{ field: string; action: string; reason: string }>;
    const autoRepair = repairs?.find(
      (r) => r.field === 'goal_constraints' && r.action === 'derived'
    );
    expect(autoRepair).toBeDefined();
    expect(autoRepair?.reason).toContain('auto-generated');
  });

  it('auto-generates constraint from goal_threshold when goal_constraints is absent', async () => {
    // P0-3: Same as above but goal_constraints field is absent entirely
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const { status, data } = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: VALID_GRAPH,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        goal_threshold: 80,
        // No goal_constraints field — auto-constraint synthesised
      }),
    });

    expect(status).toBe(200);

    // Auto-constraint activates multi-constraint path → constraints_status present
    expect(data?.constraints_status).toBeDefined();

    // Verify auto-constraint repair record
    const repairs = data?._meta?.repairs_applied as Array<{ field: string; action: string; reason: string }>;
    const autoRepair = repairs?.find(
      (r) => r.field === 'goal_constraints' && r.action === 'derived'
    );
    expect(autoRepair).toBeDefined();
  });

  it('returns 422 with blocker when constraint targets non-existent node', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const { status, data } = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: VALID_GRAPH,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        goal_constraints: [
          { constraint_id: 'bad_target', node_id: 'non_existent_node', operator: '>=', value: 100 },
        ],
      }),
    });

    expect(status).toBe(422);
    expect(data?.critiques).toBeDefined();
    expect(data?.critiques.some((c: any) => c.code === 'CONSTRAINT_TARGET_NOT_FOUND')).toBe(true);
  });

  it('returns 422 with blocker when constraint targets decision node (filtered out)', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    // Note: Decision nodes are filtered out by filterOptionNodes BEFORE constraint validation,
    // so targeting a decision node results in CONSTRAINT_TARGET_NOT_FOUND (not _NOT_IN_INFERENCE)
    const graphWithDecision = {
      ...VALID_GRAPH,
      nodes: [
        ...VALID_GRAPH.nodes,
        { id: 'decision_node', kind: 'decision', label: 'Decision' },
      ],
    };

    const { status, data } = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: graphWithDecision,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        goal_constraints: [
          { constraint_id: 'bad_kind', node_id: 'decision_node', operator: '>=', value: 100 },
        ],
      }),
    });

    expect(status).toBe(422);
    expect(data?.critiques).toBeDefined();
    // Decision nodes are filtered before constraint validation, so we get TARGET_NOT_FOUND
    expect(data?.critiques.some((c: any) => c.code === 'CONSTRAINT_TARGET_NOT_FOUND')).toBe(true);
  });

  it('returns 422 with blocker when constraint has invalid operator', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const { status, data } = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: VALID_GRAPH,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        goal_constraints: [
          { constraint_id: 'bad_op', node_id: 'mrr_factor', operator: '=', value: 100 },
        ],
      }),
    });

    expect(status).toBe(422);
    expect(data?.critiques).toBeDefined();
    expect(data?.critiques.some((c: any) => c.code === 'CONSTRAINT_INVALID_OPERATOR')).toBe(true);
  });
});

// =============================================================================
// Regression: Graph-Only Constraint Flow
// =============================================================================
// This test guards against future regressions where someone might think
// "we need brief parsing" for constraints. Constraints should work from
// graph-only inputs, simulating template or manual edit flows.
//
// Architectural principle:
// - CEE owns natural language understanding
// - PLoT operates on structured graphs
// - The graph is the contract (V3 Platform Contract §10)

describe('Regression: Graph-Only Constraint Flow', () => {
  let server: ServerHandle | null = null;

  const ENV = {
    TEST_ROUTES: '1',
    AUTH_ENABLED: '0',
    RATE_LIMIT_ENABLED: '0',
    ISL_BASE_URL: 'mock',
    ISL_MOCK_ENABLE: '1',
    UI_CANONICAL_META: '1',
  };

  afterEach(async () => {
    await server?.kill();
    server = null;
  });

  it('explicit goal_constraints in request work without brief text', async () => {
    // This test proves constraints work from graph-only inputs (no brief parsing):
    // - Request contains explicit goal_constraints (simulating CEE, template, or UI input)
    // - No brief field is provided
    // - PLoT validates constraints and activates multi-constraint path
    // - goal_threshold is ignored when goal_constraints is present
    //
    // This guards against future regressions where someone might think "we need brief parsing".

    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const simpleGraph = {
      nodes: [
        {
          id: 'revenue',
          kind: 'factor',
          label: 'Revenue',
          observed_state: { value: 100000 },
          state_space: { range: { min: 0, max: 500000 } },
        },
        {
          id: 'costs',
          kind: 'factor',
          label: 'Operating Costs',
          observed_state: { value: 80000 },
          state_space: { range: { min: 0, max: 200000 } },
        },
        { id: 'goal', kind: 'goal', label: 'Profitability' },
      ],
      edges: [
        { from: 'revenue', to: 'goal', exists_probability: 1, strength: { mean: 0.7, std: 0.1 } },
        { from: 'costs', to: 'goal', exists_probability: 1, strength: { mean: -0.5, std: 0.1 } },
      ],
    };

    const options = [
      {
        id: 'expand',
        label: 'Expansion',
        interventions: { revenue: { value: 200000, source: 'user_specified' } },
      },
      {
        id: 'optimize',
        label: 'Cost Optimization',
        interventions: { costs: { value: 60000, source: 'user_specified' } },
      },
    ];

    const { status, data } = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: simpleGraph,
        options,
        goal_node_id: 'goal',
        goal_threshold: 80, // Should be IGNORED when goal_constraints is present
        // NO brief field - constraints come from explicit goal_constraints only
        // Explicit goal_constraints (could come from CEE, template, or UI)
        goal_constraints: [
          { constraint_id: 'revenue_target', node_id: 'revenue', operator: '>=', value: 150000, label: 'Revenue target' },
          { constraint_id: 'cost_cap', node_id: 'costs', operator: '<=', value: 70000, label: 'Cost ceiling' },
        ],
      }),
    });

    // Request should succeed (200 status)
    expect(status).toBe(200);

    // Verify multi-constraint path was activated by checking for repair record showing goal_threshold was ignored
    // This proves the constraint pipeline executed successfully without brief parsing
    expect(data?._meta?.repairs_applied).toBeDefined();
    const repairs = data?._meta?.repairs_applied as Array<{ field: string; action: string; reason: string }>;
    const goalThresholdRepair = repairs?.find(
      (r) => r.field === 'goal_threshold' && r.action === 'inferred'
    );
    expect(goalThresholdRepair).toBeDefined();
    expect(goalThresholdRepair?.reason).toContain('goal_constraints');
    expect(goalThresholdRepair?.reason).toContain('ignored');
  });

  it('rejects invalid goal_constraints targeting non-existent node without brief text', async () => {
    // This test verifies constraint validation works for graph-only inputs.
    // Invalid constraints should be rejected with proper error codes.

    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const simpleGraph = {
      nodes: [
        { id: 'revenue', kind: 'factor', label: 'Revenue', observed_state: { value: 100000 } },
        { id: 'goal', kind: 'goal', label: 'Profitability' },
      ],
      edges: [
        { from: 'revenue', to: 'goal', exists_probability: 1, strength: { mean: 0.7, std: 0.1 } },
      ],
    };

    const options = [
      {
        id: 'grow',
        label: 'Grow Revenue',
        interventions: { revenue: { value: 200000, source: 'user_specified' } },
      },
      {
        id: 'cut',
        label: 'Cut Costs',
        interventions: { revenue: { value: 120000, source: 'user_specified' } },
      },
    ];

    const { status, data } = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: simpleGraph,
        options,
        goal_node_id: 'goal',
        // NO brief field
        // Invalid constraint: targets non-existent node 'non_existent'
        goal_constraints: [
          { constraint_id: 'bad_target', node_id: 'non_existent', operator: '>=', value: 100 },
        ],
      }),
    });

    // Should return 422 with CONSTRAINT_TARGET_NOT_FOUND
    expect(status).toBe(422);
    expect(data?.critiques).toBeDefined();
    expect(data?.critiques.some((c: any) => c.code === 'CONSTRAINT_TARGET_NOT_FOUND')).toBe(true);
  });
});
