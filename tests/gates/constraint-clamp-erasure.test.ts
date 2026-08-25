/**
 * CLAMP ERASURE VIA GOAL-THRESHOLD CORRESPONDENCE.
 *
 * `normaliseGoalConstraints` clamps an out-of-range threshold onto [0,1] and
 * records `clamped: true`. That flag is the ONLY input that keeps a clamped
 * threshold out of `decision_grade` (`buildConstraintScaleProvenance` requires
 * `thresholdClamp === undefined`).
 *
 * The node-goal-threshold preference then compares the node's CEE-stamped
 * already-normalised `goal_threshold` against the POST-CLAMP normalised value
 * and, on correspondence, does `normalised = stamp; clamped = false`.
 *
 * AT A BOUNDARY STAMP (0 or 1) THAT TEST CANNOT DISCRIMINATE. A producer that
 * also clamped emits exactly 0 or 1, so the two numbers agree BECAUSE BOTH HIT
 * THE SAME WALL, not because they describe the same target. The clamp flag is
 * erased, `threshold_clamped` is omitted, and a threshold the service pinned to
 * a range endpoint is certified `decision_grade: true` — a compliance claim
 * over a number the user never stated.
 *
 * THE FIX PRESERVES `clamped` ACROSS THE PREFERENCE. It changes NO forwarded
 * number: the value adopted is the stamp either way. Only the honesty flag
 * moves, which is the whole point — the doctrine clause is not "never clamp",
 * it is that a value must never arrive as a different number WEARING THE SAME
 * LABEL.
 *
 * The three existing pins on this preference
 * (tests/goal-threshold-normalisation.unit.test.ts) all use INTERIOR values
 * (0.2, 0.25) — the boundary class is exactly what that corpus EXCLUDES, which
 * is why the branch shipped unpinned.
 */

import { describe, it, expect } from 'vitest';

import {
  normaliseGoalConstraints,
  deriveClampDirection,
} from '../../src/lib/intervention-normaliser.js';
import { buildConstraintScaleProvenance } from '../../src/routes/v2/run.js';
import type { GoalConstraint, EngineNodeV3 } from '../../src/types/engine-v3.js';

const NODE = [{ id: 'cost', kind: 'factor', label: 'Cost' }] as unknown as EngineNodeV3[];

function constraint(value: number, operator: '<=' | '>=' = '<='): GoalConstraint {
  return { constraint_id: 'c_cap', node_id: 'cost', operator, value };
}

function extras(meta: { goal_threshold?: number; goal_threshold_cap?: number }, unit?: string) {
  return {
    goalThresholdMetaByNodeId: new Map([['cost', meta]]),
    ...(unit !== undefined && { unitsByConstraintId: new Map([['c_cap', unit]]) }),
  };
}

/** Run the real chain: normalise, then build the provenance the wire carries. */
function chain(c: GoalConstraint, e: ReturnType<typeof extras>) {
  const res = normaliseGoalConstraints([c], NODE, e);
  const diag = res.diagnostics.find((d) => d.constraint_id === 'c_cap');
  expect(diag, 'diagnostic for c_cap must exist').toBeDefined();
  const provenance = buildConstraintScaleProvenance(
    [c],
    new Map(res.diagnostics.map((d) => [d.constraint_id, d.range])),
    // ⚠ USES THE PRODUCTION DERIVATION, and must never re-implement it. An
    // earlier version of this helper wrote its own ternary that collapsed the
    // INDETERMINATE case into 'high', which made the test oracle MORE
    // protective than production: a near-boundary stamp read
    // `decision_grade: false` here while the route shipped `true`. A
    // self-authored oracle certifying a cell it does not exercise is the
    // defect this whole file exists to catch, one level up.
    new Map(
      res.diagnostics
        .filter((d) => d.clamped)
        .flatMap((d) => {
          const direction = deriveClampDirection(d.normalised_value);
          return direction === undefined
            ? []
            : [[d.constraint_id, direction] as [string, 'low' | 'high']];
        }),
    ),
    new Map(res.diagnostics.map((d) => [d.constraint_id, d.range_unified])),
    undefined,
  ).get('c_cap');
  expect(provenance, 'scale_provenance for c_cap must exist').toBeDefined();
  return { diag: diag!, provenance: provenance!, forwarded: res.constraints[0] };
}

describe('clamp erasure via goal-threshold correspondence', () => {
  // ---------------------------------------------------------------------
  // THE DEFECT — both directions. Sign-symmetric by construction: the clamp
  // predicate is `raw < 0 || raw > 1`, so a guard written for one direction
  // only would fire backwards on the other.
  // ---------------------------------------------------------------------

  it('HIGH clamp: a stated 50000 pinned to a 20000 cap is NOT decision-grade, even with a corresponding 1.0 stamp', () => {
    // 50000 / 20000 = 2.5 -> clamped to 1.0. A producer that also clamped
    // stamps exactly 1.0, so the correspondence test agrees at the wall.
    const c = constraint(50000);
    const { diag, provenance, forwarded } = chain(
      c,
      extras({ goal_threshold_cap: 20000, goal_threshold: 1.0 }),
    );

    // Bind by IDENTITY, not by a value another object could satisfy.
    expect(diag.constraint_id).toBe('c_cap');
    expect(diag.node_id).toBe('cost');
    expect(forwarded.constraint_id).toBe('c_cap');
    expect(forwarded.operator).toBe('<=');
    expect(diag.range).toMatchObject({ min: 0, max: 20000, source: 'goal_threshold_cap' });

    // The user's number is on the record, unaltered.
    expect(diag.original_value).toBe(50000);

    // THE PIN: the clamp survives the preference.
    expect(diag.clamped).toBe(true);
    expect(provenance.threshold_clamped).toBe('high');
    expect(provenance.decision_grade).toBe(false);

    // AND THE VALUE IS UNCHANGED BY THE FIX — no new number is invented.
    expect(diag.normalised_value).toBe(1.0);
    expect(forwarded.value).toBe(1.0);
  });

  it('LOW clamp (OPPOSITE DIRECTION): a stated -15000 pinned to the range floor is NOT decision-grade, even with a corresponding 0 stamp', () => {
    // -15000 / 100000 = -0.15 -> clamped to 0. Stamp 0 agrees at the floor.
    const c = constraint(-15000, '>=');
    const { diag, provenance, forwarded } = chain(
      c,
      extras({ goal_threshold_cap: 100000, goal_threshold: 0 }),
    );

    expect(diag.constraint_id).toBe('c_cap');
    expect(forwarded.operator).toBe('>=');
    expect(diag.range).toMatchObject({ min: 0, max: 100000, source: 'goal_threshold_cap' });
    expect(diag.original_value).toBe(-15000);

    // THE PIN, mirrored.
    expect(diag.clamped).toBe(true);
    expect(provenance.threshold_clamped).toBe('low');
    expect(provenance.decision_grade).toBe(false);

    expect(diag.normalised_value).toBe(0);
    expect(forwarded.value).toBe(0);
  });

  it("PERCENT RUNG: 500% pinned to the '%' ceiling is NOT decision-grade, even with a corresponding 1.0 stamp", () => {
    // The erasure is a property of the preference, not of one range source.
    // `unit_percent` is the other whitelisted producer rung, so it must hold here too.
    const c = constraint(500);
    const { diag, provenance } = chain(c, extras({ goal_threshold: 1.0 }, '%'));

    expect(diag.constraint_id).toBe('c_cap');
    expect(diag.range).toMatchObject({ min: 0, max: 100, source: 'unit_percent' });
    expect(diag.original_value).toBe(500);

    expect(diag.clamped).toBe(true);
    expect(provenance.threshold_clamped).toBe('high');
    expect(provenance.decision_grade).toBe(false);
  });

  // ---------------------------------------------------------------------
  // DOES-NO-HARM — and these CAN fire. Each asserts
  // `used_node_goal_threshold === true`, which is only reachable THROUGH the
  // preference branch the fix touches, so a fix that disabled the preference
  // would RED here rather than pass vacuously.
  // ---------------------------------------------------------------------

  it('INTERIOR correspondence still adopts the stamp and stays decision-grade (the preference is not disabled)', () => {
    // 20000 / 100000 = 0.2, in range, unclamped. Stamp 0.2 corresponds.
    const c = constraint(20000);
    const { diag, provenance, forwarded } = chain(
      c,
      extras({ goal_threshold_cap: 100000, goal_threshold: 0.2 }),
    );

    // POSITIVE CONTROL: the preference branch actually executed.
    expect(diag.used_node_goal_threshold).toBe(true);

    expect(diag.clamped).toBe(false);
    expect('threshold_clamped' in provenance).toBe(false);
    expect(provenance.decision_grade).toBe(true);
    // Exactly the stamp — no re-derivation drift.
    expect(forwarded.value).toBe(0.2);
  });

  it('INTERIOR correspondence at a value the clamp cannot reach stays decision-grade (second, independent does-no-harm case)', () => {
    const c = constraint(75000);
    const { diag, provenance, forwarded } = chain(
      c,
      extras({ goal_threshold_cap: 100000, goal_threshold: 0.75 }),
    );

    expect(diag.used_node_goal_threshold).toBe(true);
    expect(diag.clamped).toBe(false);
    expect(provenance.decision_grade).toBe(true);
    expect(forwarded.value).toBe(0.75);
  });

  it('a STALE non-corresponding stamp is still ignored (unchanged)', () => {
    // 25000/100000 = 0.25 vs a stale 0.2 stamp -> stamp ignored, no clamp.
    const c = constraint(25000);
    const { diag, provenance } = chain(
      c,
      extras({ goal_threshold_cap: 100000, goal_threshold: 0.2 }),
    );

    expect(diag.used_node_goal_threshold).toBeUndefined();
    expect(diag.clamped).toBe(false);
    expect(provenance.decision_grade).toBe(true);
    expect(diag.normalised_value).toBeCloseTo(0.25, 12);
  });

  // ---------------------------------------------------------------------
  // BOUNDARY THAT IS NOT A CLAMP — the discriminating twin of case 1. A value
  // that lands EXACTLY on the ceiling is representable, not pinned, so it must
  // KEEP its decision grade. A fix written as "boundary stamp => not
  // decision-grade" would wrongly RED this; a fix written against the CLAMP
  // passes it.
  // ---------------------------------------------------------------------

  // -------------------------------------------------------------------
  // THE LEDGE BESIDE THE WALL. Preserving `clamped` is not enough on its own:
  // production derives the clamp DIRECTION from `normalised_value`, so a stamp
  // that overwrites that value with something strictly inside (0,1) leaves
  // `clamped: true` carrying a value that is NOT at an endpoint. The direction
  // then reads INDETERMINATE, `threshold_clamped` is omitted, and
  // `decision_grade` goes true — the pre-fix outcome, reached by a different
  // road.
  //
  // ⭐ REACHABLE BY ORDINARY PHRASING, not contrived: CEE performs no rounding
  // or quantisation on this path, so "reach 99.95% retention" against a cap of
  // 100 mints `goal_threshold: 0.9995`, and even "99.9%" lands strictly inside
  // the interval as 0.9990000000000001 through float. The correspondence
  // tolerance is 1e-3, so 0.9995 sits inside it.
  // -------------------------------------------------------------------

  it('NEAR-BOUNDARY stamp (0.9995) must NOT launder a clamp — the ledge beside the wall', () => {
    const c = constraint(50000);
    const { diag, provenance } = chain(
      c,
      extras({ goal_threshold_cap: 20000, goal_threshold: 0.9995 }),
    );

    expect(diag.constraint_id).toBe('c_cap');
    expect(diag.original_value).toBe(50000);
    // PRECONDITION PINNED IN-TEST: the raw value really does clamp here, and
    // the stamp really is inside the correspondence tolerance of the clamped
    // value — so this exercises the adoption branch, not some other path.
    expect(diag.clamped).toBe(true);
    expect(Math.abs(1.0 - 0.9995)).toBeLessThanOrEqual(1e-3);

    // THE PIN: a clamped threshold discloses its direction and is never graded.
    expect(provenance.threshold_clamped).toBe('high');
    expect(provenance.decision_grade).toBe(false);
  });

  it('NEAR-BOUNDARY stamp at the FLOOR (0.0005) — same rule, opposite direction', () => {
    const c = constraint(-15000, '>=');
    const { diag, provenance } = chain(
      c,
      extras({ goal_threshold_cap: 100000, goal_threshold: 0.0005 }),
    );
    expect(diag.clamped).toBe(true);
    expect(provenance.threshold_clamped).toBe('low');
    expect(provenance.decision_grade).toBe(false);
  });

  it('EXACT-CEILING value (representable, NOT clamped) with a 1.0 stamp REMAINS decision-grade', () => {
    // 50000 / 50000 = 1.0 exactly. raw === 1, so `raw > 1` is false: no clamp.
    const c = constraint(50000);
    const { diag, provenance, forwarded } = chain(
      c,
      extras({ goal_threshold_cap: 50000, goal_threshold: 1.0 }),
    );

    expect(diag.original_value).toBe(50000);
    expect(diag.normalised_value).toBe(1.0);
    expect(diag.clamped).toBe(false);
    expect('threshold_clamped' in provenance).toBe(false);
    expect(provenance.decision_grade).toBe(true);
    expect(forwarded.value).toBe(1.0);
  });
});
