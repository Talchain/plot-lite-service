/**
 * R4 — deriveMarginPrecision truth-table unit tests.
 *
 * Behavior-preserving extraction of the inline margin_precision derivation from
 * routes/v2/run.ts. This file is the direct seam the route logic never had:
 * the full truth table over
 *   operator            ∈ {'<=', '>='}
 *   interventionClamp    ∈ {undefined, 'low', 'high'}
 *   thresholdClamp       ∈ {undefined, 'low', 'high'}
 *   diagnosed            ∈ {true, false}
 * = 36 cases, with a hand-written expected column (an oracle independent of the
 * implementation, so a mutated helper is caught).
 *
 * Precedence encoded by the oracle:
 *   1. ANY possible OVERSTATE (interventionOverstates OR thresholdOverstates)
 *      ⇒ undefined (caller OMITS — cannot claim a bound).
 *   2. else ANY UNDERSTATE (interventionUnderstates OR thresholdUnderstates)
 *      ⇒ 'lower_bound'.
 *   3. else diagnosed ⇒ 'exact'; else undefined.
 * Direction rules:
 *   interventionUnderstates: (clamp 'high' && '<=') OR (clamp 'low' && '>=').
 *   thresholdUnderstates:    (clamp 'low'  && '<=') OR (clamp 'high' && '>=').
 *   overstates = clamp present AND not the understate direction.
 */

import { describe, it, expect } from 'vitest';
import { deriveMarginPrecision } from '../../src/trust/margin-precision.js';

type Operator = '<=' | '>=';
type Clamp = 'low' | 'high' | undefined;
type Expected = 'exact' | 'lower_bound' | undefined;

interface Row {
  operator: Operator;
  interventionClamp: Clamp;
  thresholdClamp: Clamp;
  diagnosed: boolean;
  expected: Expected;
}

// Hand-derived oracle — 36 rows. Expected values reasoned from the precedence
// above, NOT re-computed from the helper's code (that would be tautological).
const TRUTH_TABLE: Row[] = [
  // ---- operator '<=' ----
  { operator: '<=', interventionClamp: undefined, thresholdClamp: undefined, diagnosed: true,  expected: 'exact' },
  { operator: '<=', interventionClamp: undefined, thresholdClamp: undefined, diagnosed: false, expected: undefined },
  { operator: '<=', interventionClamp: undefined, thresholdClamp: 'low',     diagnosed: true,  expected: 'lower_bound' },
  { operator: '<=', interventionClamp: undefined, thresholdClamp: 'low',     diagnosed: false, expected: 'lower_bound' },
  { operator: '<=', interventionClamp: undefined, thresholdClamp: 'high',    diagnosed: true,  expected: undefined },
  { operator: '<=', interventionClamp: undefined, thresholdClamp: 'high',    diagnosed: false, expected: undefined },
  { operator: '<=', interventionClamp: 'low',     thresholdClamp: undefined, diagnosed: true,  expected: undefined },
  { operator: '<=', interventionClamp: 'low',     thresholdClamp: undefined, diagnosed: false, expected: undefined },
  { operator: '<=', interventionClamp: 'low',     thresholdClamp: 'low',     diagnosed: true,  expected: undefined },
  { operator: '<=', interventionClamp: 'low',     thresholdClamp: 'low',     diagnosed: false, expected: undefined },
  { operator: '<=', interventionClamp: 'low',     thresholdClamp: 'high',    diagnosed: true,  expected: undefined },
  { operator: '<=', interventionClamp: 'low',     thresholdClamp: 'high',    diagnosed: false, expected: undefined },
  { operator: '<=', interventionClamp: 'high',    thresholdClamp: undefined, diagnosed: true,  expected: 'lower_bound' },
  { operator: '<=', interventionClamp: 'high',    thresholdClamp: undefined, diagnosed: false, expected: 'lower_bound' },
  { operator: '<=', interventionClamp: 'high',    thresholdClamp: 'low',     diagnosed: true,  expected: 'lower_bound' },
  { operator: '<=', interventionClamp: 'high',    thresholdClamp: 'low',     diagnosed: false, expected: 'lower_bound' },
  { operator: '<=', interventionClamp: 'high',    thresholdClamp: 'high',    diagnosed: true,  expected: undefined },
  { operator: '<=', interventionClamp: 'high',    thresholdClamp: 'high',    diagnosed: false, expected: undefined },
  // ---- operator '>=' ----
  { operator: '>=', interventionClamp: undefined, thresholdClamp: undefined, diagnosed: true,  expected: 'exact' },
  { operator: '>=', interventionClamp: undefined, thresholdClamp: undefined, diagnosed: false, expected: undefined },
  { operator: '>=', interventionClamp: undefined, thresholdClamp: 'low',     diagnosed: true,  expected: undefined },
  { operator: '>=', interventionClamp: undefined, thresholdClamp: 'low',     diagnosed: false, expected: undefined },
  { operator: '>=', interventionClamp: undefined, thresholdClamp: 'high',    diagnosed: true,  expected: 'lower_bound' },
  { operator: '>=', interventionClamp: undefined, thresholdClamp: 'high',    diagnosed: false, expected: 'lower_bound' },
  { operator: '>=', interventionClamp: 'low',     thresholdClamp: undefined, diagnosed: true,  expected: 'lower_bound' },
  { operator: '>=', interventionClamp: 'low',     thresholdClamp: undefined, diagnosed: false, expected: 'lower_bound' },
  { operator: '>=', interventionClamp: 'low',     thresholdClamp: 'low',     diagnosed: true,  expected: undefined },
  { operator: '>=', interventionClamp: 'low',     thresholdClamp: 'low',     diagnosed: false, expected: undefined },
  { operator: '>=', interventionClamp: 'low',     thresholdClamp: 'high',    diagnosed: true,  expected: 'lower_bound' },
  { operator: '>=', interventionClamp: 'low',     thresholdClamp: 'high',    diagnosed: false, expected: 'lower_bound' },
  { operator: '>=', interventionClamp: 'high',    thresholdClamp: undefined, diagnosed: true,  expected: undefined },
  { operator: '>=', interventionClamp: 'high',    thresholdClamp: undefined, diagnosed: false, expected: undefined },
  { operator: '>=', interventionClamp: 'high',    thresholdClamp: 'low',     diagnosed: true,  expected: undefined },
  { operator: '>=', interventionClamp: 'high',    thresholdClamp: 'low',     diagnosed: false, expected: undefined },
  { operator: '>=', interventionClamp: 'high',    thresholdClamp: 'high',    diagnosed: true,  expected: undefined },
  { operator: '>=', interventionClamp: 'high',    thresholdClamp: 'high',    diagnosed: false, expected: undefined },
];

const label = (r: Row) =>
  `${r.operator} · iClamp=${String(r.interventionClamp)} · tClamp=${String(r.thresholdClamp)} · diagnosed=${r.diagnosed} ⇒ ${String(r.expected)}`;

describe('deriveMarginPrecision — 36-case truth table', () => {
  it('covers exactly 36 cases (2 × 3 × 3 × 2)', () => {
    expect(TRUTH_TABLE).toHaveLength(36);
    // No duplicate input rows.
    const keys = new Set(
      TRUTH_TABLE.map(
        r => `${r.operator}|${r.interventionClamp}|${r.thresholdClamp}|${r.diagnosed}`,
      ),
    );
    expect(keys.size).toBe(36);
  });

  for (const row of TRUTH_TABLE) {
    it(label(row), () => {
      expect(
        deriveMarginPrecision({
          operator: row.operator,
          interventionClamp: row.interventionClamp,
          thresholdClamp: row.thresholdClamp,
          diagnosed: row.diagnosed,
        }),
      ).toBe(row.expected);
    });
  }

  it('output distribution matches the precedence: 2 exact, 12 lower_bound, 22 undefined', () => {
    const counts = { exact: 0, lower_bound: 0, undefined: 0 };
    for (const row of TRUTH_TABLE) {
      const out = deriveMarginPrecision({
        operator: row.operator,
        interventionClamp: row.interventionClamp,
        thresholdClamp: row.thresholdClamp,
        diagnosed: row.diagnosed,
      });
      if (out === 'exact') counts.exact += 1;
      else if (out === 'lower_bound') counts.lower_bound += 1;
      else counts.undefined += 1;
    }
    expect(counts).toEqual({ exact: 2, lower_bound: 12, undefined: 22 });
  });
});

describe('deriveMarginPrecision — named real cases', () => {
  it("'<=' + thresholdClamp 'low' (response-1 scenario) ⇒ 'lower_bound'", () => {
    expect(
      deriveMarginPrecision({
        operator: '<=',
        interventionClamp: undefined,
        thresholdClamp: 'low',
        diagnosed: true,
      }),
    ).toBe('lower_bound');
    // Also holds when the target is NOT diagnosed — the understatement claim
    // does not depend on the diagnostic flag.
    expect(
      deriveMarginPrecision({
        operator: '<=',
        interventionClamp: undefined,
        thresholdClamp: 'low',
        diagnosed: false,
      }),
    ).toBe('lower_bound');
  });

  it("no clamp + diagnosed ⇒ 'exact'", () => {
    expect(
      deriveMarginPrecision({
        operator: '<=',
        interventionClamp: undefined,
        thresholdClamp: undefined,
        diagnosed: true,
      }),
    ).toBe('exact');
    expect(
      deriveMarginPrecision({
        operator: '>=',
        interventionClamp: undefined,
        thresholdClamp: undefined,
        diagnosed: true,
      }),
    ).toBe('exact');
  });

  it('no clamp + not diagnosed ⇒ undefined', () => {
    expect(
      deriveMarginPrecision({
        operator: '<=',
        interventionClamp: undefined,
        thresholdClamp: undefined,
        diagnosed: false,
      }),
    ).toBeUndefined();
  });

  it("'<=' + interventionClamp 'low' (overstate) ⇒ undefined even when diagnosed", () => {
    // Overstatement wins over the diagnostic — the emitted margin could exceed
    // the true breach, so no bound can be claimed.
    expect(
      deriveMarginPrecision({
        operator: '<=',
        interventionClamp: 'low',
        thresholdClamp: undefined,
        diagnosed: true,
      }),
    ).toBeUndefined();
  });

  it('overstatement takes precedence over a co-present understatement', () => {
    // '<=' with interventionClamp 'high' (understates) BUT thresholdClamp 'high'
    // (overstates) ⇒ OMIT: any possible overstatement wins.
    expect(
      deriveMarginPrecision({
        operator: '<=',
        interventionClamp: 'high',
        thresholdClamp: 'high',
        diagnosed: true,
      }),
    ).toBeUndefined();
  });
});
