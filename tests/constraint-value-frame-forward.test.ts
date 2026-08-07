/**
 * ROADMAP 2.855 — PLoT FORWARDS `value_frame`, at every rebuild on the path.
 *
 * The companion `isl-constraint-value-frame.contract.test.ts` proves ISL
 * CONSUMES the field. This file proves PLoT EMITS it — and specifically that it
 * survives all THREE explicit object rebuilds between ingress and the ISL wire.
 * That is the whole risk here: each rebuild is a by-presence literal that keeps
 * only the keys it names, so a field can be declared on the type, typecheck
 * clean, pass the build, and still be dropped one hop in with no error anywhere.
 * A test that only checked the translator would have shipped exactly that.
 *
 * Every assertion binds its constraint by `constraint_id` IDENTITY, never by a
 * value predicate another constraint could satisfy (trap 19).
 */

import { describe, it, expect } from 'vitest';

import { filterTemporalConstraints } from '../src/normalisation/constraint-filter.js';
import { toISLRobustnessRequest } from '../src/integrations/isl/translator-v3.js';
import type { EngineNodeV3, GoalConstraint } from '../src/types/engine-v3.js';

type RawGoalConstraint = GoalConstraint & Record<string, unknown>;

const NODES: EngineNodeV3[] = [
  { id: 'fac_spend', kind: 'factor', label: 'Spend' } as EngineNodeV3,
  { id: 'out_throughput', kind: 'outcome', label: 'Throughput' } as EngineNodeV3,
  { id: 'goal_productivity', kind: 'goal', label: 'Productivity' } as EngineNodeV3,
];

const constraint = (over: Partial<RawGoalConstraint> = {}): RawGoalConstraint =>
  ({
    constraint_id: 'c_throughput_floor',
    node_id: 'out_throughput',
    operator: '>=',
    value: 0.05,
    label: 'Throughput floor',
    ...over,
  }) as RawGoalConstraint;

describe('2.855 — hop 1: filterTemporalConstraints (runs on EVERY request; its output REPLACES the list)', () => {
  it("carries 'delta' through the CEE-field strip", () => {
    const { passed } = filterTemporalConstraints(
      [constraint({ value_frame: 'delta' })],
      NODES,
    );
    const row = passed.find((c) => c.constraint_id === 'c_throughput_floor');
    expect(row).toBeDefined();
    expect(row!.value_frame).toBe('delta');
  });

  it("carries 'level' through unchanged (the strip must not privilege one member)", () => {
    const { passed } = filterTemporalConstraints(
      [constraint({ value_frame: 'level' })],
      NODES,
    );
    expect(passed.find((c) => c.constraint_id === 'c_throughput_floor')!.value_frame).toBe('level');
  });

  it('ABSENT STAYS ABSENT — the key is not defaulted or materialised as undefined', () => {
    // A defaulted frame is a manufactured attestation. `'value_frame' in row`
    // is the assertion that matters: an explicit `undefined` would serialise
    // to JSON as an absent key here but is still a different object, and the
    // next rebuild could turn it into `null` on the wire.
    const { passed } = filterTemporalConstraints([constraint()], NODES);
    const row = passed.find((c) => c.constraint_id === 'c_throughput_floor')!;
    expect('value_frame' in row).toBe(false);
  });

  it('a CEE-only field is still stripped (the strip still strips)', () => {
    // Positive control for the arm above: proves the rebuild is genuinely
    // discarding unnamed keys, so "value_frame survived" is a real result and
    // not the rebuild having quietly become a passthrough.
    const { passed } = filterTemporalConstraints(
      [constraint({ value_frame: 'delta', source_quote: 'reduce spend by 15%', confidence: 0.85 })],
      NODES,
    );
    const row = passed.find((c) => c.constraint_id === 'c_throughput_floor')! as RawGoalConstraint;
    expect(row.value_frame).toBe('delta');
    expect('source_quote' in row).toBe(false);
    expect('confidence' in row).toBe(false);
  });
});

describe('2.855 — hop 3: toISLRobustnessRequest (the ISL wire)', () => {
  // Positional signature (66 call sites pass these positionally — see the
  // translator's own note); goalConstraints is the 7th parameter.
  const build = (constraints: RawGoalConstraint[]) =>
    toISLRobustnessRequest(
      { nodes: NODES, edges: [] } as never,
      [{ id: 'opt_a', label: 'A', interventions: { fac_spend: { value: 0.5 } } }] as never,
      'goal_productivity',
      'req-2855',
      undefined,
      undefined,
      constraints,
    );

  it("emits value_frame on the wire object, keyed to its own constraint", () => {
    const req = build([constraint({ value_frame: 'delta' })]);
    const row = req.goal_constraints!.find((c) => c.constraint_id === 'c_throughput_floor');
    expect(row).toBeDefined();
    expect(row!.value_frame).toBe('delta');
  });

  it('the wire key is spelled EXACTLY as ISL declares it', () => {
    // ISL's model is `extra: "ignore"`, so a misspelling here is invisible:
    // no 4xx, no warning, a clean 200 and silently no constraint result. The
    // captured D-arm in `isl-constraint-value-frame.contract.test.ts` is what
    // that failure looks like. Assert the literal key, not just a value.
    const req = build([constraint({ value_frame: 'level' })]);
    const row = req.goal_constraints![0] as Record<string, unknown>;
    expect(Object.keys(row)).toContain('value_frame');
  });

  it('ABSENT STAYS ABSENT on the wire (ISL fails closed; a default would fabricate)', () => {
    const req = build([constraint()]);
    expect('value_frame' in (req.goal_constraints![0] as object)).toBe(false);
  });

  it('per-constraint, not per-request: two constraints keep their OWN frames', () => {
    // The discriminating case a single-constraint test cannot see — a
    // per-request stamp would pass every assertion above and corrupt this one.
    const req = build([
      constraint({ constraint_id: 'c_delta', value_frame: 'delta' }),
      constraint({ constraint_id: 'c_level', node_id: 'fac_spend', operator: '<=', value_frame: 'level' }),
      constraint({ constraint_id: 'c_bare', node_id: 'fac_spend', operator: '>=' }),
    ]);
    const by = (id: string) => req.goal_constraints!.find((c) => c.constraint_id === id)!;
    expect(by('c_delta').value_frame).toBe('delta');
    expect(by('c_level').value_frame).toBe('level');
    expect('value_frame' in (by('c_bare') as object)).toBe(false);
  });
});
