/**
 * Unit tests for the extracted constraint PU injection helper.
 *
 * Tests injectConstraintParameterUncertainties() in isolation without
 * any HTTP server or ISL mock — pure function tests.
 *
 * ---------------------------------------------------------------------------
 * ROW 1.236(b), 2026-07-27: `tests/constraint-auto-uncertainty.test.ts` WAS
 * RETIRED INTO THIS FILE. That file did not test the product. It carried its own
 * local `augmentParameterUncertainties()` — a hand-maintained COPY of the Phase
 * 4b+ logic, written when that logic was inline in run.ts. Production moved to
 * `injectConstraintParameterUncertainties` here, the copy was hand-updated twice
 * (most recently by contract step-2 slice 6, removing the `mean` key), and a
 * green run there proved something about the copy, never about the ISL request
 * PLoT sends. Slice 6 disclosed it loudly in the file; a disclosure is not a fix.
 *
 * The copy had also DIVERGED from production in three ways that its own green
 * run could never have shown — which is the argument, not a footnote:
 *   1. NO GOAL-NODE GUARD. Production skips a constraint on the goal node
 *      (`{reason: 'goal_node'}`); the copy had no `goalNodeId` parameter at all
 *      and would have injected a PU for it.
 *   2. WRONG WARNING FOR A MISSING NODE. Production distinguishes
 *      `plot.constraint_missing_node` from `plot.constraint_no_observed_value`;
 *      the copy folded both into the latter.
 *   3. OPPOSITE MUTATION SEMANTICS. The copy returned a new array and mutated
 *      nothing; production REPLACES `islRequest.parameter_uncertainties`.
 *
 * Case-by-case disposition (nothing was dropped without a reason):
 *   - "adds a PU entry for the constrained node"      → duplicate of T1
 *   - "does not create a duplicate entry"             → duplicate of T2
 *   - "multiple constraints on different nodes"       → duplicate of T6 / T7
 *   - "root node constraint still adds PU"            → the real function never
 *     reads edges, so root/non-root is not a production branch; re-pointed to
 *     the true and stronger claim (topology is not an input), below.
 *   - "no observed_state.value → warns"               → the skip is T3; the LOG
 *     DISCLOSURE was unique and is re-pointed below.
 *   - "original array not mutated"                    → re-pointed to what is
 *     actually true of the real function, below.
 *   - "duplicate constraints on the same node"        → unique for the injector;
 *     re-pointed below (it existed only on the selector before).
 * ---------------------------------------------------------------------------
 */

import { describe, it, expect } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
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

interface CapturedLogs {
  info: Array<Record<string, unknown>>;
  warn: Array<Record<string, unknown>>;
}

/** Minimal recorder for the two levels the injector uses. */
function makeLogger(): { logger: FastifyBaseLogger; logs: CapturedLogs } {
  const logs: CapturedLogs = { info: [], warn: [] };
  const logger = {
    info: (obj: Record<string, unknown>) => logs.info.push(obj),
    warn: (obj: Record<string, unknown>) => logs.warn.push(obj),
  } as unknown as FastifyBaseLogger;
  return { logger, logs };
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
    // Slice 6: the WIRE entry carries exactly ISL's declared members. `mean`
    // stays on the InjectedPU record above (PLoT's own /v2/run `repairs[]`
    // disclosure), and is asserted there — the two are now different shapes on
    // purpose, and this pair of assertions is what keeps them from re-merging.
    expect(puArray[0]).toEqual({
      node_id: 'n1',
      distribution: 'normal',
      std: CONSTRAINT_PINNED_STD,
    });
  });

  // T2: Node with constraint + existing PU → no override, original PU preserved
  it('skips node that already has PU entry', () => {
    const existingPU = [
      { node_id: 'n1', distribution: 'normal' as const, std: 0.15 },
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
      { node_id: 'existing', distribution: 'normal' as const, std: 0.12 },
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
    // Slice 6: the WIRE entry carries only ISL-declared members; `mean` stays
    // on the InjectedPU disclosure record asserted above.
    expect(puArray.find(p => p.node_id === 'injectable')).toEqual({
      node_id: 'injectable',
      distribution: 'normal',
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
// Re-pointed from the retired tests/constraint-auto-uncertainty.test.ts.
// Every case below calls the PRODUCTION function; there is no local copy left in
// the tree. See the file header for the case-by-case disposition.
// ---------------------------------------------------------------------------

describe('injectConstraintParameterUncertainties — disclosure log + shape (re-pointed, row 1.236b)', () => {
  it('pins the VALUE of CONSTRAINT_PINNED_STD, not just the wiring to it', () => {
    // Every other assertion in this file compares against the exported constant,
    // so changing the constant moves both sides and nothing goes red — the
    // assertion tests its own input. Mutation-checked: 0.001 → 0.002 left all 17
    // other cases green. The retired constraint-auto-uncertainty.test.ts pinned
    // the literal 0.001, and merging it in must not lose that.
    //
    // The number is not cosmetic: it is what ISL receives as the sampling width
    // for a constrained node, and it is deliberately far below every other std
    // path (user-supplied clamp, DEFAULT_STD_FLOOR, the 0.01 external-prior
    // floor) so a constrained node is effectively pinned to its observed value.
    expect(CONSTRAINT_PINNED_STD).toBe(0.001);
  });

  it('discloses the observed value it keyed on in the LOG, which is the only place it now survives', () => {
    // This is the case the retired file was really carrying. Slice 6 removed
    // `mean` from the wire entry because ISL declares none; the value is still
    // load-bearing evidence, so the injector reports it twice — on the
    // InjectedPU record (which becomes a /v2/run `repairs[]` entry) and in this
    // log line. Assert BOTH, so a later cleanup cannot quietly drop the last
    // trace of what the pinned std was pinned TO.
    const islReq = makeISLRequest();
    const nodes = [makeNode('n1', 0.62)];
    const { logger, logs } = makeLogger();

    const result = injectConstraintParameterUncertainties(
      islReq, [makeConstraint('n1', 'c-obs')], nodes, 'goal', logger,
    );

    expect(result.injected).toEqual([{ node_id: 'n1', mean: 0.62, std: CONSTRAINT_PINNED_STD }]);
    expect(logs.info).toHaveLength(1);
    expect(logs.info[0]).toMatchObject({
      event: 'plot.constraint_auto_uncertainty',
      node_id: 'n1',
      constraint_id: 'c-obs',
      observed_value: 0.62,
      distribution: 'normal',
      std: CONSTRAINT_PINNED_STD,
    });
    // …and it is NOT on the wire entry (ISL's ParameterUncertainty declares no
    // `mean`; contract step-2 slice 6, pinned by isl-request-drift-pairing).
    expect(islReq.parameter_uncertainties![0]).not.toHaveProperty('mean');
  });

  it('warns plot.constraint_no_observed_value when the node has no observed_state.value', () => {
    const islReq = makeISLRequest();
    const { logger, logs } = makeLogger();

    const result = injectConstraintParameterUncertainties(
      islReq, [makeConstraint('n1', 'c-noval')], [makeNode('n1')], 'goal', logger,
    );

    expect(result.skipped).toEqual([{ node_id: 'n1', reason: 'missing_observed_state' }]);
    expect(logs.warn).toHaveLength(1);
    expect(logs.warn[0]).toMatchObject({
      event: 'plot.constraint_no_observed_value',
      node_id: 'n1',
      constraint_id: 'c-noval',
    });
    expect(logs.info).toHaveLength(0);
  });

  it('warns plot.constraint_missing_node — a DIFFERENT event from the value-less case', () => {
    // The retired copy folded these two into one warning. They are different
    // operator-facing conditions: a node absent from the graph is a caller bug;
    // a node without an observed value is a data gap. Pinning both event names
    // is what stops them re-merging.
    const islReq = makeISLRequest();
    const { logger, logs } = makeLogger();

    const result = injectConstraintParameterUncertainties(
      islReq, [makeConstraint('ghost', 'c-ghost')], [], 'goal', logger,
    );

    expect(result.skipped).toEqual([{ node_id: 'ghost', reason: 'missing_node' }]);
    expect(logs.warn).toHaveLength(1);
    expect(logs.warn[0]).toMatchObject({
      event: 'plot.constraint_missing_node',
      node_id: 'ghost',
      constraint_id: 'c-ghost',
    });
  });

  it('skips the goal node — a guard the retired copy did not implement at all', () => {
    const islReq = makeISLRequest();
    const { logger, logs } = makeLogger();

    const result = injectConstraintParameterUncertainties(
      islReq,
      [makeConstraint('goal', 'c-goal')],
      [{ id: 'goal', kind: 'goal', label: 'Goal', observed_state: { value: 0.8 } } as EngineNodeV3],
      'goal',
      logger,
    );

    expect(result.injected).toEqual([]);
    expect(result.skipped).toEqual([{ node_id: 'goal', reason: 'goal_node' }]);
    // A goal-node skip is expected, not exceptional — no operator warning.
    expect(logs.warn).toHaveLength(0);
    expect(islReq.parameter_uncertainties).toHaveLength(0);
  });

  it('injects exactly one entry for duplicate constraints on the same node', () => {
    const islReq = makeISLRequest();
    const { logger, logs } = makeLogger();

    const result = injectConstraintParameterUncertainties(
      islReq,
      [makeConstraint('n1', 'c1'), makeConstraint('n1', 'c2')],
      [makeNode('n1', 0.5)],
      'goal',
      logger,
    );

    expect(result.injected).toHaveLength(1);
    expect(islReq.parameter_uncertainties!.filter((p) => p.node_id === 'n1')).toHaveLength(1);
    // The second constraint takes the `existing` branch: no entry, no skip, no log.
    expect(result.skipped).toEqual([]);
    expect(logs.info).toHaveLength(1);
  });

  it('REPLACES islRequest.parameter_uncertainties and never mutates the caller’s array in place', () => {
    // The retired copy asserted "the original is not mutated" of a function that
    // returned a new array. The production function mutates the REQUEST. Both
    // halves matter: callers that kept a reference to the array they passed in
    // (the /v2/run factor-PU list is reused for the admission plan) must not see
    // it grow underneath them.
    const callerArray: NonNullable<ISLRobustnessRequestV3['parameter_uncertainties']> = [
      { node_id: 'existing', distribution: 'normal', std: 0.1 },
    ];
    const islReq = makeISLRequest(callerArray);

    injectConstraintParameterUncertainties(
      islReq, [makeConstraint('n1')], [makeNode('n1', 0.4)], 'goal',
    );

    expect(callerArray).toHaveLength(1);
    expect(callerArray[0]!.node_id).toBe('existing');
    expect(islReq.parameter_uncertainties).toHaveLength(2);
    expect(islReq.parameter_uncertainties).not.toBe(callerArray);
  });

  it('graph TOPOLOGY is not an input: a root node and a non-root node are treated identically', () => {
    // Re-points the retired "root node constraint still adds PU" case. That test
    // built a two-edge graph to make its node "non-root", but
    // injectConstraintParameterUncertainties never reads edges — it takes
    // `graphNodes`, not a graph. So root/non-root was never a branch of the
    // product, and the old case could only ever have re-tested the copy. The
    // claim that IS true, and is worth pinning, is the independence itself.
    const rootReq = makeISLRequest();
    injectConstraintParameterUncertainties(
      rootReq, [makeConstraint('n1')], [makeNode('n1', 0.3)], 'goal',
    );

    const nonRootReq = makeISLRequest();
    injectConstraintParameterUncertainties(
      nonRootReq,
      [makeConstraint('n1')],
      // Same node, plus an upstream parent — i.e. "non-root" in every sense the
      // retired test meant. The function takes no edges, so it cannot differ.
      [makeNode('parent', 0.9), makeNode('n1', 0.3)],
      'goal',
    );

    expect(nonRootReq.parameter_uncertainties).toEqual(rootReq.parameter_uncertainties);
    expect(rootReq.parameter_uncertainties).toEqual([
      { node_id: 'n1', distribution: 'normal', std: CONSTRAINT_PINNED_STD },
    ]);
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
      [...existingPu].map((id) => ({ node_id: id, distribution: 'normal' as const, std: 0.1 })),
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
