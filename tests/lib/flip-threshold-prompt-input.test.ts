/**
 * Unit suite for `src/lib/flip-threshold-prompt-input.ts` (ROADMAP 2.676).
 *
 * The route-level file (`tests/v2-run.decision-review-flip-scale.contract.test.ts`)
 * proves the WIRING — that `/v2/run` actually hands the denormalised rows over.
 * This file proves the RULE, branch by branch, against the source it was
 * derived from.
 *
 * ⚠ THE ORACLE IS CEE'S OWN PREDICATE, NOT THIS LANE'S READING OF IT (trap
 * 13c). Every expectation below is derived from
 * `flipRowScaleUnsafeForPromptUnits`
 * (`src/orchestrator-v5/context/flip-threshold-rows.ts:269`, CEE `staging`
 * `d5b64246`) and the prompt rule it cites
 * (`Prompts/canonical/decision_review.txt:416` — "The value carries no unit and
 * lies between 0 and 1. It is probability-like"). A mutant kit can only show
 * this suite is SENSITIVE; it cannot show the table is RIGHT, so the table is
 * taken from the producer rather than invented here.
 *
 * `AGREEMENT_CASES` is the completeness check derivation cannot provide (trap
 * 12d): a hand-written corpus that re-implements CEE's rule INDEPENDENTLY of
 * the implementation under test and asserts the two agree on every row. If the
 * implementation drifts to a different band, a different token comparison, or
 * a different null-guard, these rows notice — the per-branch tests above them
 * would not, because each pins only the case it names.
 */

import { describe, it, expect } from 'vitest';
import {
  flipRowUnsafeForPromptUnits,
  toPromptFlipThresholdData,
  MODEL_SCALE_SUSPECT_ABS,
} from '../../src/lib/flip-threshold-prompt-input.js';
import type { DenormalisedFlipThreshold } from '../../src/lib/flip-threshold-denormaliser.js';

/** A denormalised row with the mandatory keys filled in; override what matters. */
function row(over: Partial<DenormalisedFlipThreshold> = {}): DenormalisedFlipThreshold {
  return {
    factor_id: 'fac_x',
    factor_label: 'Factor X',
    current_value: 0.5,
    flip_value: 0.4,
    alternative_winner_id: 'opt_b',
    alternative_winner_label: 'Option B',
    flip_reason: 'found',
    ...over,
  };
}

describe('flipRowUnsafeForPromptUnits · CEE-derived refusal rule', () => {
  it('the band matches CEE MODEL_SCALE_SUSPECT_ABS', () => {
    // Pinned as a value, not just used: the two predicates governing the same
    // question must not drift to different bands.
    expect(MODEL_SCALE_SUSPECT_ABS).toBe(1);
  });

  describe('branch 1 — a positive scale attestation decides it', () => {
    it("value_scale 'display' is SAFE even with an in-band unit-bearing pair", () => {
      // The lifted row. `display` is the only token that licenses user units,
      // and it licenses them unconditionally — the band test never runs.
      expect(
        flipRowUnsafeForPromptUnits(
          row({ value_scale: 'display', unit: 'GBP', current_value: 0.5, flip_value: 0.4 }),
        ),
      ).toBe(false);
    });

    it("value_scale 'normalised' is UNSAFE even with a unit-less out-of-band pair", () => {
      // The mirror image: a positive attestation of NON-user-scale closes the
      // row whatever its digits look like. This is the case a magnitude-only
      // heuristic would wrongly admit.
      expect(
        flipRowUnsafeForPromptUnits(
          row({ value_scale: 'normalised', unit: undefined, current_value: 40, flip_value: 70 }),
        ),
      ).toBe(true);
    });

    it('the token comparison is trimmed and case-insensitive', () => {
      expect(flipRowUnsafeForPromptUnits(row({ value_scale: '  DISPLAY  ' as never, unit: 'GBP' }))).toBe(false);
    });
  });

  describe('branch 2 — absent scale, UNITLESS: the prompt\'s probability-like case', () => {
    it('an in-band unitless pair is ADMITTED', () => {
      // "0.29" for an uncapped rate IS the value. Refusing here would delete
      // the case the prompt documents, and it is the shape the deployed probe
      // shipped honestly.
      expect(
        flipRowUnsafeForPromptUnits(row({ unit: undefined, current_value: 0.29, flip_value: 0.407407 })),
      ).toBe(false);
    });

    it('a whitespace-only unit counts as unitless', () => {
      expect(flipRowUnsafeForPromptUnits(row({ unit: '   ', current_value: 0.29, flip_value: 0.4 }))).toBe(false);
    });
  });

  describe('branch 3 — absent scale, UNIT-BEARING: the band decides', () => {
    it('both values out of band is ADMITTED (a direct caller posting user scale)', () => {
      // A /v2/run caller may legitimately post user-scale values with no cap.
      // The denormaliser stamps no token there, and refusing would close a door
      // that is correctly open.
      expect(
        flipRowUnsafeForPromptUnits(row({ unit: 'GBP', current_value: 16000, flip_value: 12243 })),
      ).toBe(false);
    });

    it('EITHER value in band is enough to REFUSE — current in band', () => {
      expect(flipRowUnsafeForPromptUnits(row({ unit: 'GBP', current_value: 0.9, flip_value: 5000 }))).toBe(true);
    });

    it('EITHER value in band is enough to REFUSE — flip in band', () => {
      // A pair is quoted as TWO numbers, so one uninverted value is one wrong
      // number on the screen. Requiring both to be in band would leave the
      // hazard open whenever the flip value happened to land above 1.
      expect(flipRowUnsafeForPromptUnits(row({ unit: 'GBP', current_value: 5000, flip_value: 0.9 }))).toBe(true);
    });

    it('the band is EXCLUSIVE: exactly 1 is still suspect', () => {
      expect(flipRowUnsafeForPromptUnits(row({ unit: 'GBP', current_value: 1, flip_value: 5000 }))).toBe(true);
    });

    it('the band is on MAGNITUDE: a negative in-band value is suspect too', () => {
      expect(flipRowUnsafeForPromptUnits(row({ unit: 'GBP', current_value: -0.5, flip_value: -5000 }))).toBe(true);
    });

    it('a NULL flip value is not a pair — nothing to judge, so ADMITTED', () => {
      // Matches CEE's own null-guard. An attested no-flip row carries no second
      // number, so the band test has nothing to compare.
      expect(flipRowUnsafeForPromptUnits(row({ unit: 'GBP', current_value: 0.3, flip_value: null }))).toBe(false);
    });
  });
});

describe('toPromptFlipThresholdData · projection', () => {
  const lifted = row({
    factor_id: 'fac_price',
    factor_label: 'Unit price',
    current_value: 16000,
    flip_value: 12243,
    direction: 'decrease',
    unit: 'GBP',
    value_scale: 'display',
    current_display: '16000 GBP',
    flip_display: '12243 GBP',
    alternative_winner_id: 'opt_marketing_push',
    alternative_winner_label: 'Marketing push',
    iterations_used: 0,
    probes_used: 0,
  });
  const unitless = row({
    factor_id: 'fac_retention',
    factor_label: 'Customer retention rate',
    current_value: 0.29,
    flip_value: 0.407407,
    direction: 'increase',
    unit: undefined,
    alternative_winner_id: 'opt_marketing_push',
    alternative_winner_label: 'Marketing push',
  });
  const unliftable = row({
    factor_id: 'fac_headcount',
    factor_label: 'Engineering headcount',
    current_value: 0.3,
    flip_value: 0.62,
    unit: 'engineers',
  });

  it('carries the denormalised pair through unchanged', () => {
    const [out] = toPromptFlipThresholdData([lifted]);
    expect(out.factor_id).toBe('fac_price');
    expect(out.current_value).toBe(16000);
    expect(out.flip_value).toBe(12243);
    expect(out.unit).toBe('GBP');
    expect(out.direction).toBe('decrease');
  });

  it('drops the unsafe row and KEEPS the safe ones, preserving input order', () => {
    const out = toPromptFlipThresholdData([lifted, unliftable, unitless]);
    expect(out.map((r) => r.factor_id)).toEqual(['fac_price', 'fac_retention']);
  });

  it('emits ONLY the FlipThresholdInputData key set — no display/scale keys', () => {
    // The wire shape this path already sent. Forwarding `value_scale` /
    // `current_display` / `flip_display` would be an unmeasured change to what
    // the prompt sees, bundled into a fix for a fabricated number.
    const [out] = toPromptFlipThresholdData([lifted]);
    expect(Object.keys(out).sort()).toEqual(
      [
        'alternative_winner_id',
        'current_value',
        'direction',
        'factor_id',
        'factor_label',
        'flip_reason',
        'flip_value',
        'iterations_used',
        'probes_used',
        'unit',
      ].sort(),
    );
  });

  it('optional keys absent upstream stay ABSENT, never explicit undefined', () => {
    const [out] = toPromptFlipThresholdData([unitless]);
    expect('unit' in out).toBe(false);
    expect('no_flip_in_range' in out).toBe(false);
    expect('margin_sensitivity' in out).toBe(false);
  });

  it('an attested no-flip row keeps its attestation', () => {
    const [out] = toPromptFlipThresholdData([
      row({ flip_value: null, no_flip_in_range: true, direction: undefined, flip_reason: 'no_effect_within_bounds' }),
    ]);
    expect(out.no_flip_in_range).toBe(true);
    expect(out.flip_value).toBeNull();
    expect('direction' in out).toBe(false);
  });

  it('an all-unsafe input yields an EMPTY array, never a fabricated row', () => {
    expect(toPromptFlipThresholdData([unliftable])).toEqual([]);
  });
});

/**
 * The corpus. Each row states its expected verdict INDEPENDENTLY — this table
 * is what would notice the implementation drifting as a whole, which no
 * single-branch test can do.
 */
const AGREEMENT_CASES: Array<{ name: string; row: DenormalisedFlipThreshold; unsafe: boolean }> = [
  { name: 'lifted GBP pair', row: row({ value_scale: 'display', unit: 'GBP', current_value: 16000, flip_value: 12243 }), unsafe: false },
  { name: 'lifted GBP pair, in-band digits', row: row({ value_scale: 'display', unit: 'GBP', current_value: 0.8, flip_value: 0.6 }), unsafe: false },
  { name: 'attested normalised, GBP', row: row({ value_scale: 'normalised', unit: 'GBP', current_value: 0.4, flip_value: 0.7 }), unsafe: true },
  { name: 'attested normalised, unitless', row: row({ value_scale: 'normalised', unit: undefined, current_value: 0.4, flip_value: 0.7 }), unsafe: true },
  { name: 'unrecognised token', row: row({ value_scale: 'model' as never, unit: 'GBP', current_value: 9, flip_value: 9 }), unsafe: true },
  { name: 'absent scale, unitless in band', row: row({ unit: undefined, current_value: 0.29, flip_value: 0.407407 }), unsafe: false },
  { name: 'absent scale, unitless out of band', row: row({ unit: undefined, current_value: 40, flip_value: 70 }), unsafe: false },
  { name: 'absent scale, engineers in band', row: row({ unit: 'engineers', current_value: 0.3, flip_value: 0.62 }), unsafe: true },
  { name: 'absent scale, GBP out of band', row: row({ unit: 'GBP', current_value: 16000, flip_value: 12243 }), unsafe: false },
  { name: 'absent scale, GBP straddling the band', row: row({ unit: 'GBP', current_value: 2, flip_value: 0.5 }), unsafe: true },
  { name: 'absent scale, GBP, null flip', row: row({ unit: 'GBP', current_value: 0.3, flip_value: null }), unsafe: false },
  { name: 'absent scale, GBP, boundary 1', row: row({ unit: 'GBP', current_value: 1, flip_value: 1 }), unsafe: true },
  { name: 'absent scale, GBP, just above boundary', row: row({ unit: 'GBP', current_value: 1.0001, flip_value: 1.0001 }), unsafe: false },
];

describe('AGREEMENT CORPUS · the implementation matches CEE\'s rule on every row', () => {
  it.each(AGREEMENT_CASES)('$name → unsafe=$unsafe', ({ row: r, unsafe }) => {
    expect(flipRowUnsafeForPromptUnits(r)).toBe(unsafe);
  });

  it('the corpus is not one-sided — it contains both verdicts', () => {
    // A corpus that only ever expects one answer proves nothing about the
    // other branch (trap 13b: a guard agreeing with itself).
    expect(AGREEMENT_CASES.some((c) => c.unsafe)).toBe(true);
    expect(AGREEMENT_CASES.some((c) => !c.unsafe)).toBe(true);
  });

  it('the projection agrees with the predicate on the whole corpus', () => {
    // Binds the two exported functions together: a filter that stopped using
    // the predicate would pass every test above and fail this one.
    const kept = toPromptFlipThresholdData(
      AGREEMENT_CASES.map((c, i) => ({ ...c.row, factor_id: `fac_${i}` })),
    );
    const expected = AGREEMENT_CASES
      .map((c, i) => (c.unsafe ? null : `fac_${i}`))
      .filter((id): id is string => id !== null);
    expect(kept.map((r) => r.factor_id)).toEqual(expected);
  });
});
