/**
 * Unit tests for the extracted constraint PU injection helper.
 *
 * Tests injectConstraintParameterUncertainties() in isolation without
 * any HTTP server or ISL mock — pure function tests.
 */

import { describe, it, expect } from 'vitest';
import {
  injectConstraintParameterUncertainties,
  selectConstraintInjectedPuNodeIds,
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
  // T1: Node with constraint + observed_state.value + no existing PU → PU injected
  it('injects PU for node with observed_state.value and no existing PU', () => {
    const islReq = makeISLRequest();
    const nodes = [makeNode('n1', 0.6)];
    const constraints = [makeConstraint('n1')];

    const result = injectConstraintParameterUncertainties(
      islReq, constraints, nodes, 'goal',
    );

    expect(result.injected).toEqual([
      { node_id: 'n1', mean: 0.6, std: CONSTRAINT_PINNED_STD },
    ]);
    expect(result.skipped).toHaveLength(0);

    const puArray = islReq.parameter_uncertainties ?? [];
    expect(puArray).toHaveLength(1);
    expect(puArray[0]).toEqual({
      node_id: 'n1',
      distribution: 'normal',
      mean: 0.6,
      std: CONSTRAINT_PINNED_STD,
    });
  });

  // T2: Node with constraint + existing PU → no override, original PU preserved
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
    expect(result.skipped).toHaveLength(0); // existing PU is silently skipped, not in skipped array

    // PU array should be unchanged (just the existing entry)
    const puArray = islReq.parameter_uncertainties ?? [];
    expect(puArray).toHaveLength(1);
    expect(puArray[0].std).toBe(0.15); // Not overridden
  });

  // T3: Node with constraint + no observed_state.value → in skipped with reason
  it('skips node without observed_state.value with reason "missing_observed_state"', () => {
    const islReq = makeISLRequest();
    const nodes = [makeNode('n1')]; // no observed_state
    const constraints = [makeConstraint('n1')];

    const result = injectConstraintParameterUncertainties(
      islReq, constraints, nodes, 'goal',
    );

    expect(result.injected).toEqual([]);
    expect(result.skipped).toEqual([
      { node_id: 'n1', reason: 'missing_observed_state' },
    ]);

    // No PU injected
    const puArray = islReq.parameter_uncertainties ?? [];
    expect(puArray).toHaveLength(0);
  });

  // T4: Goal node with constraint → in skipped with reason "goal_node"
  it('skips goal node with reason "goal_node"', () => {
    const islReq = makeISLRequest();
    const nodes = [
      { id: 'goal', kind: 'goal' as const, label: 'Goal', observed_state: { value: 0.8 } },
    ];
    const constraints = [makeConstraint('goal')];

    const result = injectConstraintParameterUncertainties(
      islReq, constraints, nodes, 'goal',
    );

    expect(result.injected).toEqual([]);
    expect(result.skipped).toEqual([
      { node_id: 'goal', reason: 'goal_node' },
    ]);

    // No PU injected for goal node
    const puArray = islReq.parameter_uncertainties ?? [];
    expect(puArray).toHaveLength(0);
  });

  // T5: Constraint references node_id not in graph → in skipped with reason "missing_node"
  it('skips node not in graph with reason "missing_node"', () => {
    const islReq = makeISLRequest();
    const nodes: EngineNodeV3[] = []; // empty graph
    const constraints = [makeConstraint('nonexistent')];

    const result = injectConstraintParameterUncertainties(
      islReq, constraints, nodes, 'goal',
    );

    expect(result.injected).toEqual([]);
    expect(result.skipped).toEqual([
      { node_id: 'nonexistent', reason: 'missing_node' },
    ]);

    const puArray = islReq.parameter_uncertainties ?? [];
    expect(puArray).toHaveLength(0);
  });

  // T6: Multiple constraints on different nodes → each handled independently
  it('handles mix of injectable, existing, missing, goal, and no-value nodes', () => {
    const existingPU = [
      { node_id: 'existing', distribution: 'normal' as const, mean: 0.4, std: 0.12 },
    ];
    const islReq = makeISLRequest(existingPU);
    const nodes = [
      makeNode('injectable', 0.7),     // should be injected
      makeNode('existing', 0.4),        // already has PU — silently skipped
      makeNode('no-observed'),           // no observed_state → skipped
      { id: 'goal', kind: 'goal' as const, label: 'Goal', observed_state: { value: 0.9 } },
    ];
    const constraints = [
      makeConstraint('injectable'),
      makeConstraint('existing'),
      makeConstraint('no-observed'),
      makeConstraint('goal'),
      makeConstraint('phantom'),         // not in graph
    ];

    const result = injectConstraintParameterUncertainties(
      islReq, constraints, nodes, 'goal',
    );

    expect(result.injected).toEqual([
      { node_id: 'injectable', mean: 0.7, std: CONSTRAINT_PINNED_STD },
    ]);
    expect(result.skipped).toEqual([
      { node_id: 'no-observed', reason: 'missing_observed_state' },
      { node_id: 'goal', reason: 'goal_node' },
      { node_id: 'phantom', reason: 'missing_node' },
    ]);

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

  // T7: Injected entries contain full shape for repair record creation
  it('injected entries contain node_id, mean, std for repair record creation', () => {
    const islReq = makeISLRequest();
    const nodes = [makeNode('n1', 0.75), makeNode('n2', 0.3)];
    const constraints = [makeConstraint('n1'), makeConstraint('n2')];

    const result = injectConstraintParameterUncertainties(
      islReq, constraints, nodes, 'goal',
    );

    expect(result.injected).toHaveLength(2);
    for (const entry of result.injected) {
      expect(entry).toHaveProperty('node_id');
      expect(entry).toHaveProperty('mean');
      expect(entry).toHaveProperty('std');
      expect(entry.std).toBe(CONSTRAINT_PINNED_STD);
    }
    expect(result.injected[0]).toEqual({ node_id: 'n1', mean: 0.75, std: CONSTRAINT_PINNED_STD });
    expect(result.injected[1]).toEqual({ node_id: 'n2', mean: 0.3, std: CONSTRAINT_PINNED_STD });
  });

  it('returns empty arrays when no constraints', () => {
    const islReq = makeISLRequest();
    const result = injectConstraintParameterUncertainties(
      islReq, [], [], 'goal',
    );
    expect(result.injected).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// selectConstraintInjectedPuNodeIds — the planner's PU-count derivation MUST
// match the injector exactly (single source of truth: classifyConstraintPu).
// ---------------------------------------------------------------------------

describe('selectConstraintInjectedPuNodeIds (planner ↔ injector parity)', () => {
  // Mixed graph: an injectable node, the goal, a missing node, a value-less node,
  // and a node that already has a PU (factor PU) — the selector must return only
  // the genuinely-injectable one, identical to what the injector adds.
  const nodes = [
    makeNode('inject_me', 0.6),      // non-goal, has value, no existing PU → inject
    makeNode('already_pu', 0.4),     // has value but is an existing PU → skip
    makeNode('no_value'),            // no observed_state.value → skip
    // 'missing' is intentionally NOT in the graph
    makeNode('goal', 0.9),           // goal → skip
  ];
  const constraints = [
    makeConstraint('inject_me'),
    makeConstraint('already_pu'),
    makeConstraint('no_value'),
    makeConstraint('missing'),
    makeConstraint('goal'),
    makeConstraint('inject_me', 'dup'), // duplicate on same node → counted once
  ];
  const existingPu = new Set(['already_pu']);

  it('selects exactly the node_ids the injector would add (deduped, minus existing)', () => {
    const selected = selectConstraintInjectedPuNodeIds(constraints, nodes, 'goal', existingPu);
    expect([...selected]).toEqual(['inject_me']);
  });

  it('is BYTE-parity with the injector: |select| === injector.injected count', () => {
    const islReq = makeISLRequest(
      [...existingPu].map((id) => ({ node_id: id, distribution: 'normal' as const, mean: 0.4, std: 0.1 })),
    );
    const { injected } = injectConstraintParameterUncertainties(islReq, constraints, nodes, 'goal');
    const selected = selectConstraintInjectedPuNodeIds(constraints, nodes, 'goal', existingPu);
    // Same node_ids, same count — one source of truth (classifyConstraintPu).
    expect(new Set(selected)).toEqual(new Set(injected.map((i) => i.node_id)));
    // And the UNION size the planner uses matches ISL's `u` = |all PUs sent|.
    const islU = new Set((islReq.parameter_uncertainties ?? []).map((p) => p.node_id)).size;
    expect(existingPu.size + selected.size).toBe(islU);
  });

  it('returns empty for a no-constraint request (common case unchanged)', () => {
    expect(selectConstraintInjectedPuNodeIds(undefined, nodes, 'goal', existingPu).size).toBe(0);
    expect(selectConstraintInjectedPuNodeIds([], nodes, 'goal', existingPu).size).toBe(0);
  });
});
