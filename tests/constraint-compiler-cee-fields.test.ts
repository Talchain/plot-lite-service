/**
 * Constraint Compiler — CEE Field Preservation
 *
 * Verifies that CEE-specific fields (deadline_metadata, unit, source_quote,
 * confidence, provenance) on graph constraint nodes survive compilation into
 * GoalConstraint entries. Without these fields, the temporal filter cannot
 * detect and drop non-evaluable constraints.
 *
 * Root cause of B1-8: normaliseNode() creates clean EngineNodeV3 objects,
 * and compileConstraintNodes() creates clean GoalConstraint objects — both
 * strip CEE-specific fields, preventing the temporal filter from catching
 * constraints that arrive via graph nodes.
 */

import { describe, it, expect } from 'vitest';
import { compileConstraintNodes } from '../src/normalisation/constraint-compiler.js';
import type { EngineGraphV3 } from '../src/types/engine-v3.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGraphWithConstraintNode(extraFields: Record<string, unknown> = {}): EngineGraphV3 {
  return {
    nodes: [
      { id: 'goal_mrr', kind: 'goal', label: 'MRR' },
      { id: 'factor_churn', kind: 'factor', label: 'Churn Rate', observed_state: { value: 0.04 } },
      // Constraint node with CEE-specific extra fields (runtime)
      {
        id: 'deadline_constraint',
        kind: 'constraint' as any, // 'constraint' not in EngineNodeKindV3 but valid at runtime
        label: 'Delivery deadline',
        observed_state: { value: 12 },
        ...extraFields,
      } as any,
    ],
    edges: [
      { from: 'factor_churn', to: 'goal_mrr', exists_probability: 1, strength: { mean: -0.7, std: 0.15 } },
      // Edge from goal to constraint node (constraint targets goal_mrr)
      { from: 'goal_mrr', to: 'deadline_constraint', exists_probability: 1, strength: { mean: 1, std: 0 } },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Constraint Compiler — CEE Field Preservation', () => {
  it('compiled constraint preserves deadline_metadata from source node', () => {
    const graph = makeGraphWithConstraintNode({
      deadline_metadata: { deadline_date: '2027-02-19' },
    });

    // Add operator metadata so the constraint compiles successfully
    (graph.nodes[2] as any).observed_state = {
      value: 12,
      metadata: { operator: '<=' },
    };

    const result = compileConstraintNodes(graph, undefined);

    // Constraint should compile (not be skipped)
    expect(result.constraints.length).toBeGreaterThanOrEqual(1);

    const compiled = result.constraints.find(c => c.constraint_id === 'compiled:deadline_constraint');
    expect(compiled).toBeDefined();

    // CEE field should be preserved
    expect((compiled as any).deadline_metadata).toEqual({ deadline_date: '2027-02-19' });
  });

  it('compiled constraint preserves unit from source node', () => {
    const graph = makeGraphWithConstraintNode({
      unit: 'months',
    });

    (graph.nodes[2] as any).observed_state = {
      value: 12,
      metadata: { operator: '<=' },
    };

    const result = compileConstraintNodes(graph, undefined);
    const compiled = result.constraints.find(c => c.constraint_id === 'compiled:deadline_constraint');
    expect(compiled).toBeDefined();
    expect((compiled as any).unit).toBe('months');
  });

  it('compiled constraint preserves source_quote and provenance from source node', () => {
    const graph = makeGraphWithConstraintNode({
      source_quote: 'within 12 months',
      provenance: 'inferred',
    });

    (graph.nodes[2] as any).observed_state = {
      value: 12,
      metadata: { operator: '<=' },
    };

    const result = compileConstraintNodes(graph, undefined);
    const compiled = result.constraints.find(c => c.constraint_id === 'compiled:deadline_constraint');
    expect(compiled).toBeDefined();
    expect((compiled as any).source_quote).toBe('within 12 months');
    expect((compiled as any).provenance).toBe('inferred');
  });

  it('compiled constraint without CEE fields → no extra fields present', () => {
    const graph = makeGraphWithConstraintNode(); // no extra fields

    (graph.nodes[2] as any).observed_state = {
      value: 12,
      metadata: { operator: '<=' },
    };

    const result = compileConstraintNodes(graph, undefined);
    const compiled = result.constraints.find(c => c.constraint_id === 'compiled:deadline_constraint');
    expect(compiled).toBeDefined();

    // Should NOT have CEE fields
    expect((compiled as any).deadline_metadata).toBeUndefined();
    expect((compiled as any).unit).toBeUndefined();
    expect((compiled as any).source_quote).toBeUndefined();
    expect((compiled as any).provenance).toBeUndefined();
  });

  it('CEE fields from graph node do not override explicit constraint fields', () => {
    const graph = makeGraphWithConstraintNode({
      deadline_metadata: { deadline_date: '2027-02-19' },
      unit: 'months',
    });

    (graph.nodes[2] as any).observed_state = {
      value: 12,
      metadata: { operator: '<=' },
    };

    // Explicit constraint for the same (node_id, operator) — should win over compiled
    const explicitConstraints = [
      {
        constraint_id: 'explicit_goal_mrr',
        node_id: 'goal_mrr',
        operator: '<=' as const,
        value: 15,
        label: 'Explicit constraint',
      },
    ];

    const result = compileConstraintNodes(graph, explicitConstraints);

    // Explicit should win
    const goalConstraint = result.constraints.find(c => c.node_id === 'goal_mrr');
    expect(goalConstraint).toBeDefined();
    expect(goalConstraint!.constraint_id).toBe('explicit_goal_mrr');

    // Explicit constraint should NOT have deadline_metadata from the graph node
    expect((goalConstraint as any).deadline_metadata).toBeUndefined();
  });
});
