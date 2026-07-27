/**
 * ROADMAP 1.278 — `normaliseValue`: absence in ⇒ absence out (the INGRESS half
 * of the fabricate-on-absence class ROADMAP 1.277 closed on `denormaliseValue`).
 *
 * ============================================================================
 * THE MECHANISM
 * ============================================================================
 * `normaliseValue(value: number, range)` declared a `number` parameter. That
 * `number` was a compile-time fiction: `options[].interventions` arrives through
 * an Ajv body schema that types the CONTAINER only (`interventions: { type:
 * 'object' }`), so the VALUES were never validated against it.
 *
 *     normaliseValue(null, { min: 10, max: 20 })
 *       === (null - 10) / 10  →  clamp
 *       === { normalised: 0, clamped: true }      // the RANGE MINIMUM
 *
 *     normaliseValue(null, { min: 0, max: 200 })
 *       === { normalised: 0, clamped: false }     // ← and SILENT
 *
 * An unspecified intervention became "intervene at the range minimum" — a
 * different question, answered confidently. On a min-0 range it was not even
 * flagged as clamped, so `clamped` (the struct's only suspicion signal) said
 * nothing. And a numeric STRING was silently coerced: `'15'` on [10,20] returned
 * a confident 0.5.
 *
 * ============================================================================
 * TEST LABELS — assigned by what the MUTATION RUN PROVED, not by intent
 * ============================================================================
 *   DEFECT:           went RED when the primitive hardening was reverted alone.
 *                     These discriminate — they are the reason this file exists.
 *   POSITIVE CONTROL: green both ways BY DESIGN. A control that went red on the
 *                     pristine source would be a broken control, not evidence.
 *
 * The mutation arm for this file was `normaliseValue` reverted to its pristine
 * `(value: number)` body in a throwaway clone OUTSIDE the repo root, with the
 * Phase 1a++ ingress guard left in place — so these results are attributable to
 * the primitive alone.
 */

import { describe, it, expect } from 'vitest';
import {
  normaliseValue,
  normaliseOptions,
  normaliseGoalConstraints,
  buildNormalisationContext,
  type NormalisationRange,
} from '../src/lib/intervention-normaliser.js';
import type { EngineNodeV3, OptionV3 } from '../src/types/engine-v3.js';

const R = (min: number, max: number): NormalisationRange => ({ min, max, source: 'default' });

// Every shape that carries no finite number. `undefined` and a missing key are
// NOT wire-reachable (JSON has neither) but ARE reachable for in-process
// callers, so they are exercised and not claimed as wire cases.
const ABSENT_SHAPES: Array<[string, unknown]> = [
  ['null (the wire shape)', null],
  ['undefined', undefined],
  ['NaN', Number.NaN],
  ['+Infinity', Number.POSITIVE_INFINITY],
  ['-Infinity', Number.NEGATIVE_INFINITY],
  ['non-numeric string', 'abc'],
  ['NUMERIC string', '15'],
  ['empty string', ''],
  ['boolean true', true],
  ['boolean false', false],
  ['empty object', {}],
  ['array', [1, 2]],
];

describe('ROADMAP 1.278 · normaliseValue — absence in ⇒ absence out', () => {
  it('DEFECT: null no longer becomes the range MINIMUM', () => {
    // Pristine: { normalised: 0, clamped: true } — i.e. "intervene at 10".
    expect(normaliseValue(null, R(10, 20))).toBeUndefined();
  });

  it('DEFECT: the SILENT case — null on a min-0 range was not even flagged as clamped', () => {
    // Pristine: { normalised: 0, clamped: false }. This is the sharpest arm:
    // the ONE signal a caller could have inspected said "nothing to see here".
    expect(normaliseValue(null, R(0, 200))).toBeUndefined();
  });

  it('DEFECT: absence beats the zero-width-range shortcut', () => {
    // Pristine, min===max===5: `value / max` → 0/5 → { normalised: 0, clamped: true }.
    // The zero-width branch has its own arithmetic, so it needed its own arm.
    expect(normaliseValue(null, R(5, 5))).toBeUndefined();
    // …and the max<=0 zero-width branch, which returns a flat 0.5 midpoint.
    expect(normaliseValue(null, R(0, 0))).toBeUndefined();
  });

  it('DEFECT: a NUMERIC STRING is no longer silently coerced to a confident value', () => {
    // Pristine: '15' on [10,20] → { normalised: 0.5, clamped: false }. JS string
    // arithmetic made a wire string indistinguishable from a measured number.
    expect(normaliseValue('15', R(10, 20))).toBeUndefined();
  });

  it('DEFECT: every absence shape maps to undefined, on every range branch', () => {
    for (const [label, shape] of ABSENT_SHAPES) {
      for (const range of [R(10, 20), R(0, 200), R(5, 5), R(0, 0), R(-100, 100)]) {
        expect(normaliseValue(shape, range), `${label} @ [${range.min},${range.max}]`).toBeUndefined();
      }
    }
  });

  it('POSITIVE CONTROL: a real value normalises byte-identically, and 0 is a REAL value', () => {
    // The over-suppression trap: a genuine 0 maps to the SAME normalised 0 the
    // null defect fabricated. If the guard over-reached, this is what would break.
    expect(normaliseValue(0, R(0, 200))).toEqual({ normalised: 0, clamped: false });
    expect(normaliseValue(0, R(0, 0))).toEqual({ normalised: 0.5, clamped: false });
    expect(normaliseValue(10, R(10, 20))).toEqual({ normalised: 0, clamped: false });
    expect(normaliseValue(15, R(10, 20))).toEqual({ normalised: 0.5, clamped: false });
    expect(normaliseValue(20, R(10, 20))).toEqual({ normalised: 1, clamped: false });
    expect(normaliseValue(250000, R(0, 500000))).toEqual({ normalised: 0.5, clamped: false });
    // Negative values, and the sign-preserving range
    expect(normaliseValue(-50, R(-100, 100))).toEqual({ normalised: 0.25, clamped: false });
    // Clamping still reports itself
    expect(normaliseValue(-10, R(0, 100))).toEqual({ normalised: 0, clamped: true });
    expect(normaliseValue(150, R(0, 100))).toEqual({ normalised: 1, clamped: true });
    // Zero-width range, value on the point
    expect(normaliseValue(5, R(5, 5))).toEqual({ normalised: 1, clamped: false });
  });
});

// ---------------------------------------------------------------------------
// The two production callers — explicit absence handling
// ---------------------------------------------------------------------------

const NODES: EngineNodeV3[] = [
  { id: 'goal', kind: 'goal', label: 'G' } as EngineNodeV3,
  { id: 'f', kind: 'factor', label: 'F', observed_state: { value: 100 } } as EngineNodeV3,
];

describe('ROADMAP 1.278 · callers handle absence explicitly (never fabricate, never silently drop)', () => {
  it('DEFECT: normaliseOptions REFUSES a non-finite intervention value, naming option and factor', () => {
    // Pristine: no throw — the option was normalised to the range minimum and
    // the analysis proceeded on an intervention the caller never specified.
    const options = [
      { id: 'opt1', label: 'O1', interventions: { f: { value: null as unknown as number, source: 'user_specified' } } },
      { id: 'opt2', label: 'O2', interventions: { f: { value: 80, source: 'user_specified' } } },
    ] as unknown as OptionV3[];
    const context = buildNormalisationContext(NODES, 'goal', undefined, options);

    expect(() => normaliseOptions(options, context)).toThrow(/non-finite intervention value/);
    // The message must name BOTH the option id and the factor key precisely.
    expect(() => normaliseOptions(options, context)).toThrow(/option 'opt1'/);
    expect(() => normaliseOptions(options, context)).toThrow(/factor 'f'/);
  });

  it('POSITIVE CONTROL: a fully valid option set normalises to exactly the same bytes', () => {
    const options = [
      { id: 'opt1', label: 'O1', interventions: { f: { value: 120, source: 'user_specified' } } },
      { id: 'opt2', label: 'O2', interventions: { f: { value: 80, source: 'user_specified' } } },
    ] as unknown as OptionV3[];
    const context = buildNormalisationContext(NODES, 'goal', undefined, options);
    const result = normaliseOptions(options, context);

    // Byte-exact. These are the PRISTINE values (range [72,128] source
    // 'inferred_spread', derived from observed_state 100 and the {120,80}
    // intervention spread) — the range-derivation chain is untouched by this
    // slice and must stay so. This control earned its keep on the first run: it
    // caught a wrong expectation of mine (I had assumed a [80,120] range giving
    // 1 and 0).
    expect(JSON.stringify(result.options)).toBe(JSON.stringify([
      { id: 'opt1', label: 'O1', interventions: { f: { value: 0.8571428571428571, source: 'user_specified' } } },
      { id: 'opt2', label: 'O2', interventions: { f: { value: 0.14285714285714285, source: 'user_specified' } } },
    ]));
    expect(result.diagnostics.map(d => [d.option_id, d.factor_id, d.original_value, d.normalised_value, d.clamped, d.range.min, d.range.max, d.range.source]))
      .toEqual([
        ['opt1', 'f', 120, 0.8571428571428571, false, 72, 128, 'inferred_spread'],
        ['opt2', 'f', 80, 0.14285714285714285, false, 72, 128, 'inferred_spread'],
      ]);
  });

  it('DEFECT: normaliseGoalConstraints REFUSES a non-finite constraint value, naming constraint and node', () => {
    // Pristine: no throw — the constraint threshold silently became the range
    // minimum, so the margin/satisfaction verdict answered a threshold nobody set.
    //
    // REACHABILITY (stated, not assumed): NONE from the wire. All three
    // GoalConstraint producers are already finiteness-guarded — the Phase 1b++
    // ingress-shape guard (client goal_constraints), constraint-compiler.ts
    // (graph constraint nodes), and the Number.isFinite(autoThreshold) branch
    // (auto-synthesis from goal_threshold). This is defence-in-depth.
    const constraints = [
      { constraint_id: 'c1', node_id: 'goal', operator: '>=', value: null as unknown as number, label: 'L' },
    ] as never;

    expect(() => normaliseGoalConstraints(constraints, NODES)).toThrow(/non-finite value for constraint/);
    expect(() => normaliseGoalConstraints(constraints, NODES)).toThrow(/constraint 'c1'/);
    expect(() => normaliseGoalConstraints(constraints, NODES)).toThrow(/node 'goal'/);
  });

  it('POSITIVE CONTROL: a valid constraint normalises unchanged', () => {
    const constraints = [
      { constraint_id: 'c1', node_id: 'f', operator: '>=', value: 100, label: 'L' },
    ] as never;
    const result = normaliseGoalConstraints(constraints, NODES);
    // Byte-exact. `NormalisedGoalConstraint` OVERWRITES `value` with the
    // normalised number and preserves the user-unit input in `original_value`
    // (this control caught a second wrong expectation of mine — I had asserted a
    // `normalised_value` field, which exists only on the diagnostics).
    expect(JSON.stringify(result.constraints)).toBe(JSON.stringify([
      { constraint_id: 'c1', node_id: 'f', operator: '>=', value: 0.5, original_value: 100, label: 'L' },
    ]));
  });
});
