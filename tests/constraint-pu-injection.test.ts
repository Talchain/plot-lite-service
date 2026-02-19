/**
 * Unit tests for the extracted constraint PU injection helper.
 *
 * Tests injectConstraintParameterUncertainties() in isolation without
 * any HTTP server or ISL mock — pure function tests.
 */

import { describe, it, expect } from 'vitest';
import {
  injectConstraintParameterUncertainties,
  CONSTRAINT_PINNED_STD,
} from '../src/integrations/isl/constraint-pu-injection.js';
import type { ISLRobustnessRequestV3 } from '../src/integrations/isl/translator-v3.js';
import type { GoalConstraint, EngineNodeV3 } from '../src/types/engine-v3.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeISLRequest(
  pus?: ISLRobustnessRequestV3['parameter_uncertainties'],
): ISLRobustnessRequestV3 {
  return {
    request_id: 'test-req',
    graph: { nodes: [], edges: [] },
    options: [],
    goal_node_id: 'goal',
    analysis_types: ['robustness'],
    parameter_uncertainties: pus,
  };
}

function makeNode(id: string, observedValue?: number): EngineNodeV3 {
  return {
    id,
    kind: 'factor',
    label: `Node ${id}`,
    ...(observedValue !== undefined
      ? { observed_state: { value: observedValue } }
      : {}),
  };
}

function makeConstraint(nodeId: string, constraintId?: string): GoalConstraint {
  return {
    constraint_id: constraintId ?? `c-${nodeId}`,
    node_id: nodeId,
    operator: '>=',
    value: 0.5,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('injectConstraintParameterUncertainties', () => {
  it('injects PU for node with observed_state.value and no existing PU', () => {
    const islReq = makeISLRequest();
    const nodes = [makeNode('n1', 0.6)];
    const constraints = [makeConstraint('n1')];

    const result = injectConstraintParameterUncertainties(
      islReq, constraints, nodes, 'goal',
    );

    expect(result.injected).toEqual(['n1']);
    expect(result.warnings).toHaveLength(0);

    const puArray = islReq.parameter_uncertainties ?? [];
    expect(puArray).toHaveLength(1);
    expect(puArray[0]).toEqual({
      node_id: 'n1',
      distribution: 'normal',
      mean: 0.6,
      std: CONSTRAINT_PINNED_STD,
    });
  });

  it('skips node that already has PU entry', () => {
    const existingPU = [
      { node_id: 'n1', distribution: 'normal' as const, mean: 0.6, std: 0.15 },
    ];
    const islReq = makeISLRequest(existingPU);
    const nodes = [makeNode('n1', 0.6)];
    const constraints = [makeConstraint('n1')];

    const result = injectConstraintParameterUncertainties(
      islReq, constraints, nodes, 'goal',
    );

    expect(result.injected).toEqual([]);
    expect(result.warnings).toHaveLength(0);

    // PU array should be unchanged (just the existing entry)
    const puArray = islReq.parameter_uncertainties ?? [];
    expect(puArray).toHaveLength(1);
    expect(puArray[0].std).toBe(0.15); // Not overridden
  });

  it('returns warning for node without observed_state.value', () => {
    const islReq = makeISLRequest();
    const nodes = [makeNode('n1')]; // no observed_state
    const constraints = [makeConstraint('n1')];

    const result = injectConstraintParameterUncertainties(
      islReq, constraints, nodes, 'goal',
    );

    expect(result.injected).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('n1');
    expect(result.warnings[0]).toContain('no observed_state.value');

    // No PU injected
    const puArray = islReq.parameter_uncertainties ?? [];
    expect(puArray).toHaveLength(0);
  });

  it('skips goal node even with observed_state.value', () => {
    const islReq = makeISLRequest();
    const nodes = [
      { id: 'goal', kind: 'goal' as const, label: 'Goal', observed_state: { value: 0.8 } },
    ];
    const constraints = [makeConstraint('goal')];

    const result = injectConstraintParameterUncertainties(
      islReq, constraints, nodes, 'goal',
    );

    expect(result.injected).toEqual([]);
    expect(result.warnings).toHaveLength(0);

    // No PU injected for goal node
    const puArray = islReq.parameter_uncertainties ?? [];
    expect(puArray).toHaveLength(0);
  });

  it('handles mix of injectable, existing, missing, and goal nodes', () => {
    const existingPU = [
      { node_id: 'existing', distribution: 'normal' as const, mean: 0.4, std: 0.12 },
    ];
    const islReq = makeISLRequest(existingPU);
    const nodes = [
      makeNode('injectable', 0.7),     // should be injected
      makeNode('existing', 0.4),        // already has PU — skip
      makeNode('no-observed'),           // no observed_state — warning
      { id: 'goal', kind: 'goal' as const, label: 'Goal', observed_state: { value: 0.9 } },
    ];
    const constraints = [
      makeConstraint('injectable'),
      makeConstraint('existing'),
      makeConstraint('no-observed'),
      makeConstraint('goal'),
    ];

    const result = injectConstraintParameterUncertainties(
      islReq, constraints, nodes, 'goal',
    );

    expect(result.injected).toEqual(['injectable']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('no-observed');

    const puArray = islReq.parameter_uncertainties ?? [];
    expect(puArray).toHaveLength(2); // existing + injectable
    expect(puArray.find(p => p.node_id === 'injectable')).toEqual({
      node_id: 'injectable',
      distribution: 'normal',
      mean: 0.7,
      std: CONSTRAINT_PINNED_STD,
    });
    expect(puArray.find(p => p.node_id === 'existing')?.std).toBe(0.12); // preserved
  });

  it('returns empty arrays when no constraints', () => {
    const islReq = makeISLRequest();
    const result = injectConstraintParameterUncertainties(
      islReq, [], [], 'goal',
    );
    expect(result.injected).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
