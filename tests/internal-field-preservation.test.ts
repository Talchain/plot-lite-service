/**
 * Internal Field Preservation Tests
 *
 * Verifies that the _internal namespace survives all PLoT constraint transforms:
 *  - filterTemporalConstraints (reconstructs constraint objects)
 *  - compileConstraintNodes + mergeConstraints (merge via Map — object references)
 *  - validateGoalConstraints (read-only validation)
 *  - toISLRobustnessRequest (wire boundary — must strip _internal)
 *
 * Convention: PLoT-internal metadata lives in `constraint._internal` (InternalMetadata).
 * This namespace is set during auto-constraint synthesis (Phase 1c+) and is
 * consumed in buildResponse to populate _meta.constraint_sources.
 */

import { describe, it, expect } from 'vitest';
import type { EngineNodeV3, EngineGraphV3, GoalConstraint, RawGoalConstraint, InternalMetadata } from '../src/types/engine-v3.js';
import type { OptionV3 } from '../src/types/engine-v3.js';
import { filterTemporalConstraints } from '../src/normalisation/constraint-filter.js';
import { compileConstraintNodes } from '../src/normalisation/constraint-compiler.js';
import { validateGoalConstraints } from '../src/validation/preflight-v2.js';
import { toISLRobustnessRequest } from '../src/integrations/isl/translator-v3.js';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const GOAL_NODE: EngineNodeV3 = {
  id: 'goal',
  kind: 'goal', goal_direction: 'maximise',
  label: 'Revenue Growth',
} as EngineNodeV3;

const FACTOR_NODE: EngineNodeV3 = {
  id: 'factor_a',
  kind: 'factor',
  label: 'Market Size',
  observed_state: { value: 0.5 },
} as EngineNodeV3;

const NODES: EngineNodeV3[] = [GOAL_NODE, FACTOR_NODE];

function makeConstraintWithInternal(overrides?: Partial<GoalConstraint>): GoalConstraint & { _internal: InternalMetadata } {
  return {
    constraint_id: 'auto_goal_threshold',
    node_id: 'goal',
    operator: '>=',
    value: 0.7,
    label: 'Goal target',
    _internal: { source: 'auto_from_goal_threshold' },
    ...overrides,
  } as GoalConstraint & { _internal: InternalMetadata };
}

const GRAPH: EngineGraphV3 = {
  nodes: NODES,
  edges: [
    { from: 'factor_a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
  ],
} as EngineGraphV3;

const OPTIONS: OptionV3[] = [
  { id: 'opt1', label: 'Option 1', interventions: { factor_a: { value: 0.8, source: 'user_specified' } } },
];

// =============================================================================
// filterTemporalConstraints — reconstructs objects, must preserve _internal
// =============================================================================

describe('filterTemporalConstraints preserves _internal', () => {
  it('passes through _internal on a non-temporal constraint', () => {
    const input = makeConstraintWithInternal();
    const result = filterTemporalConstraints([input as unknown as RawGoalConstraint], NODES);

    expect(result.passed).toHaveLength(1);
    expect((result.passed[0] as any)._internal).toEqual({ source: 'auto_from_goal_threshold' });
  });

  it('preserves _internal alongside standard GoalConstraint fields', () => {
    const input = makeConstraintWithInternal({ label: 'Custom Label', weight: 0.8 });
    const result = filterTemporalConstraints([input as unknown as RawGoalConstraint], NODES);

    const passed = result.passed[0];
    expect(passed.constraint_id).toBe('auto_goal_threshold');
    expect(passed.label).toBe('Custom Label');
    expect(passed.weight).toBe(0.8);
    expect((passed as any)._internal).toEqual({ source: 'auto_from_goal_threshold' });
  });

  it('does not inject _internal when absent on input', () => {
    const input: RawGoalConstraint = {
      constraint_id: 'user_constraint',
      node_id: 'goal',
      operator: '>=',
      value: 0.5,
    };
    const result = filterTemporalConstraints([input], NODES);

    expect(result.passed).toHaveLength(1);
    expect((result.passed[0] as any)._internal).toBeUndefined();
  });

  it('preserves _internal on multiple constraints independently', () => {
    const auto = makeConstraintWithInternal();
    const user: RawGoalConstraint = {
      constraint_id: 'user_mrr',
      node_id: 'factor_a',
      operator: '>=',
      value: 0.6,
    };
    const result = filterTemporalConstraints(
      [auto as unknown as RawGoalConstraint, user],
      NODES
    );

    expect(result.passed).toHaveLength(2);
    expect((result.passed[0] as any)._internal).toEqual({ source: 'auto_from_goal_threshold' });
    expect((result.passed[1] as any)._internal).toBeUndefined();
  });

  it('drops _internal when constraint is filtered (temporal)', () => {
    const temporalConstraint: RawGoalConstraint & { _internal: InternalMetadata } = {
      constraint_id: 'temporal_goal',
      node_id: 'goal',
      operator: '>=',
      value: 12,
      unit: 'months',
      deadline_metadata: { deadline: '12 months' },
      _internal: { source: 'auto_from_goal_threshold' },
    };
    const result = filterTemporalConstraints(
      [temporalConstraint as unknown as RawGoalConstraint],
      NODES
    );

    // Temporal constraint is filtered — _internal goes away with it
    expect(result.passed).toHaveLength(0);
    expect(result.filtered).toHaveLength(1);
  });
});

// =============================================================================
// compileConstraintNodes + mergeConstraints — uses Map, preserves references
// =============================================================================

describe('compileConstraintNodes preserves _internal on explicit constraints', () => {
  it('explicit constraint with _internal survives merge with compiled constraints', () => {
    // Graph has a constraint node (compiled) AND we pass an explicit constraint with _internal
    const graphWithConstraintNode: EngineGraphV3 = {
      nodes: [
        GOAL_NODE,
        FACTOR_NODE,
        {
          id: 'constraint_node',
          kind: 'constraint',
          label: 'MRR Target',
          observed_state: { value: 0.5, metadata: { target_node_id: 'factor_a', operator: '>=' } },
        } as EngineNodeV3,
      ],
      edges: [
        { from: 'factor_a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
        { from: 'constraint_node', to: 'factor_a', strength: { mean: 1, std: 0 } },
      ],
    } as EngineGraphV3;

    const explicitWithInternal = makeConstraintWithInternal({ node_id: 'goal' });

    const result = compileConstraintNodes(
      graphWithConstraintNode,
      [explicitWithInternal as GoalConstraint]
    );

    // The explicit constraint should be in the result (explicit wins on conflict)
    const autoConstraint = result.constraints.find(c => c.constraint_id === 'auto_goal_threshold');
    expect(autoConstraint).toBeDefined();
    expect((autoConstraint as any)._internal).toEqual({ source: 'auto_from_goal_threshold' });
  });
});

// =============================================================================
// validateGoalConstraints — read-only, must NOT strip _internal
// =============================================================================

describe('validateGoalConstraints does not strip _internal', () => {
  it('constraint with _internal passes validation unchanged', () => {
    const constraint = makeConstraintWithInternal();
    const result = validateGoalConstraints([constraint as GoalConstraint], GRAPH);

    // No blockers for a valid constraint targeting a real node
    expect(result.blockers).toHaveLength(0);

    // The original constraint object is unchanged (not cloned)
    expect((constraint as any)._internal).toEqual({ source: 'auto_from_goal_threshold' });
  });
});

// =============================================================================
// toISLRobustnessRequest — wire boundary, MUST strip _internal
// =============================================================================

describe('toISLRobustnessRequest strips _internal at wire boundary', () => {
  it('_internal does not appear in ISL goal_constraints', () => {
    const constraint = makeConstraintWithInternal();
    const islRequest = toISLRobustnessRequest(
      GRAPH,
      OPTIONS,
      'goal',
      'test-req-id',
      1000,
      undefined,
      [constraint as GoalConstraint]
    );

    expect(islRequest.goal_constraints).toHaveLength(1);
    expect(islRequest.goal_constraints![0]).not.toHaveProperty('_internal');
    // Corrected in contract step-2 slice 6. The previous comment here read
    // "Only ISL-known fields", which was FALSE: ISL's `GoalConstraint`
    // (isl/src/models/robustness_v2.py:622-681 @ 7d144c7f) declares exactly
    // {node_id, operator, value, label} — `constraint_id` is NOT an ISL field
    // and was being dropped by `extra: "ignore"`. This assertion is therefore
    // a PLoT-side key-set pin, not a statement about ISL's contract.
    //
    // `constraint_id` is retained deliberately: Codex adjudicated OQ-5 as
    // ADOPT-into-ISL (reader-first — ISL accepts and echoes it optional
    // first), not delete, because `constraint_verdict`'s `identity_unresolved`
    // state needs a stable constraint identity to cite. Do NOT remove it here
    // as part of undeclared-key cleanup; the ISL lane declares it first.
    expect(Object.keys(islRequest.goal_constraints![0]).sort()).toEqual(
      ['constraint_id', 'label', 'node_id', 'operator', 'value'].sort()
    );
  });
});
