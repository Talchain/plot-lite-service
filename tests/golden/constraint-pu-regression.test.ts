/**
 * Constraint PU Regression Lock
 *
 * Golden-style regression tests ensuring the Phase 4b+ safety-net PU injection
 * behaves deterministically across code changes. These lock the exact behaviour:
 *
 * 1. Non-root constrained + observed_state → PU with CONSTRAINT_PINNED_STD
 * 2. Non-root constrained, no observed_state → no PU entry
 * 3. Constrained goal node → no injection (goal has own outcome distribution)
 * 4. Factor node with translator PU → not overridden by Phase 4b+
 *
 * Uses the unit-level injectConstraintParameterUncertainties helper directly
 * (no server needed) for fast, deterministic assertions.
 */

import { describe, it, expect } from 'vitest';
import {
  injectConstraintParameterUncertainties,
  CONSTRAINT_PINNED_STD,
} from '../../src/integrations/isl/constraint-pu-injection.js';
import type { ISLRobustnessRequestV3 } from '../../src/integrations/isl/translator-v3.js';
import type { EngineNodeV3, GoalConstraint } from '../../src/types/engine-v3.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeISLRequest(
  existingPUs?: Array<{ node_id: string; distribution: 'normal'; mean: number; std: number }>,
): ISLRobustnessRequestV3 {
  return {
    request_id: 'test-req',
    graph: { nodes: [], edges: [] },
    options: [],
    goal_node_id: 'goal',
    analysis_types: ['comparison', 'sensitivity', 'robustness'],
    parameter_uncertainties: existingPUs ?? [],
  };
}

function makeGraphNodes(): EngineNodeV3[] {
  return [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'factor-a', kind: 'factor', label: 'Marketing', observed_state: { value: 0.6 } },
    { id: 'outcome-x', kind: 'outcome', label: 'Retention', observed_state: { value: 0.85 } },
    { id: 'factor-no-obs', kind: 'factor', label: 'Unknown Factor' }, // no observed_state
  ];
}

// ---------------------------------------------------------------------------
// Regression Lock
// ---------------------------------------------------------------------------

describe('Constraint PU Regression Lock', () => {
  it('non-root constrained node with observed_state → PU injected with CONSTRAINT_PINNED_STD', () => {
    const request = makeISLRequest();
    const nodes = makeGraphNodes();
    const constraints: GoalConstraint[] = [
      { constraint_id: 'ret-min', node_id: 'outcome-x', operator: '>=', value: 0.7 },
    ];

    const result = injectConstraintParameterUncertainties(request, constraints, nodes, 'goal');

    expect(result.injected).toEqual([
      { node_id: 'outcome-x', mean: 0.85, std: CONSTRAINT_PINNED_STD },
    ]);
    expect(result.skipped).toHaveLength(0);

    const pu = request.parameter_uncertainties!.find((p) => p.node_id === 'outcome-x');
    expect(pu).toBeDefined();
    expect(pu!.distribution).toBe('normal');
    expect(pu!.mean).toBe(0.85);
    expect(pu!.std).toBe(CONSTRAINT_PINNED_STD);
  });

  it('non-root constrained node without observed_state → no PU entry, warning emitted', () => {
    const request = makeISLRequest();
    const nodes = makeGraphNodes();
    const constraints: GoalConstraint[] = [
      { constraint_id: 'unknown-cap', node_id: 'factor-no-obs', operator: '<=', value: 0.5 },
    ];

    const result = injectConstraintParameterUncertainties(request, constraints, nodes, 'goal');

    expect(result.injected).toHaveLength(0);
    expect(result.skipped).toEqual([
      { node_id: 'factor-no-obs', reason: 'missing_observed_state' },
    ]);

    // No PU entry created
    const pu = request.parameter_uncertainties!.find((p) => p.node_id === 'factor-no-obs');
    expect(pu).toBeUndefined();
  });

  it('constrained goal node → no injection (goal has own outcome distribution)', () => {
    const request = makeISLRequest();
    const nodes = makeGraphNodes();
    const constraints: GoalConstraint[] = [
      { constraint_id: 'goal-min', node_id: 'goal', operator: '>=', value: 10000 },
    ];

    const result = injectConstraintParameterUncertainties(request, constraints, nodes, 'goal');

    expect(result.injected).toHaveLength(0);
    expect(result.skipped).toEqual([
      { node_id: 'goal', reason: 'goal_node' },
    ]);

    // Goal node should not appear in parameter_uncertainties
    const pu = request.parameter_uncertainties!.find((p) => p.node_id === 'goal');
    expect(pu).toBeUndefined();
  });

  it('factor node with translator PU (std ≥ 0.1) → not overridden by CONSTRAINT_PINNED_STD', () => {
    // Simulate translator having already created PU for factor-a
    const translatorPU = {
      node_id: 'factor-a',
      distribution: 'normal' as const,
      mean: 0.6,
      std: 0.1, // translator floor
    };
    const request = makeISLRequest([translatorPU]);
    const nodes = makeGraphNodes();
    const constraints: GoalConstraint[] = [
      { constraint_id: 'marketing-min', node_id: 'factor-a', operator: '>=', value: 0.3 },
    ];

    const result = injectConstraintParameterUncertainties(request, constraints, nodes, 'goal');

    // Should skip because PU already exists (inject-only-when-missing)
    expect(result.injected).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);

    // Original translator PU preserved
    const pus = request.parameter_uncertainties!.filter((p) => p.node_id === 'factor-a');
    expect(pus).toHaveLength(1);
    expect(pus[0].std).toBe(0.1); // NOT CONSTRAINT_PINNED_STD
  });

  it('mixed scenario: inject, skip (existing), skip (goal), warn (no obs)', () => {
    const translatorPU = {
      node_id: 'factor-a',
      distribution: 'normal' as const,
      mean: 0.6,
      std: 0.15,
    };
    const request = makeISLRequest([translatorPU]);
    const nodes = makeGraphNodes();
    const constraints: GoalConstraint[] = [
      { constraint_id: 'c1', node_id: 'outcome-x', operator: '>=', value: 0.7 },     // inject
      { constraint_id: 'c2', node_id: 'factor-a', operator: '>=', value: 0.3 },       // skip (existing PU)
      { constraint_id: 'c3', node_id: 'goal', operator: '>=', value: 10000 },         // skip (goal)
      { constraint_id: 'c4', node_id: 'factor-no-obs', operator: '<=', value: 0.5 },  // warn (no obs)
    ];

    const result = injectConstraintParameterUncertainties(request, constraints, nodes, 'goal');

    expect(result.injected).toEqual([
      { node_id: 'outcome-x', mean: 0.85, std: CONSTRAINT_PINNED_STD },
    ]);
    expect(result.skipped).toHaveLength(2); // goal + no-obs

    // Total PUs: 1 (translator) + 1 (injected) = 2
    expect(request.parameter_uncertainties).toHaveLength(2);

    // factor-a preserved at translator std
    const factorA = request.parameter_uncertainties!.find((p) => p.node_id === 'factor-a');
    expect(factorA!.std).toBe(0.15);

    // outcome-x injected at CONSTRAINT_PINNED_STD
    const outcomeX = request.parameter_uncertainties!.find((p) => p.node_id === 'outcome-x');
    expect(outcomeX!.std).toBe(CONSTRAINT_PINNED_STD);
  });
});
