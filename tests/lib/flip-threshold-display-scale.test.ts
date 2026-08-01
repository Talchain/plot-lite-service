/**
 * ROADMAP 2.228 F2 — display-safe flip-threshold rows.
 *
 * The defect (diagnosis-2228-enrichment-values.md §2.1/§2.2, re-verified at PLoT
 * staging 11a03b4d): `enrichment.flip_thresholds[]` ships `current_value` as the
 * node's NORMALISED [0,1] number while `unit` comes from `observed_state.unit`,
 * producing the `0.86` + `'£'` pair on the live wire. The node already carries
 * `raw_value: 275000` and `cap: 320000`; the flip path simply never asks for them,
 * because `denormaliseFlipThresholds` only denormalises when Phase 4a happened to
 * build a `normalisationContext` — and on the V5 path it never does.
 *
 * This suite pins the producer half of CEE's flip-threshold card chain: the row
 * must arrive in user units, must SAY so at row level, and its display strings
 * must DESCRIBE the raw values it ships.
 */

import { describe, it, expect } from 'vitest';
import {
  denormaliseFlipThresholds,
  type DenormalisedFlipThreshold,
} from '../../src/lib/flip-threshold-denormaliser.js';
import type { FlipThresholdInputData } from '../../src/cee/validation/m1-review-types.js';
import type { NormalisationContext } from '../../src/lib/intervention-normaliser.js';
import type { EngineGraphV3, EngineNodeV3 } from '../../src/types/engine-v3.js';

// =============================================================================
// CEE CAGE ORACLES — pinned copies of the predicates this output must satisfy
// =============================================================================

/**
 * ⚠ CROSS-REPO MIRROR, PINNED AND DECLARED.
 *
 * These two functions are copied VERBATIM from CEE
 * `src/orchestrator-v5/context/analysis-signals.ts` at CEE staging
 * `b8a38de79cdaa0995d31ce45a52c1f763112ad0e` (the merged PR #776 cages) —
 * `readRowValueScale`/`flipRowScaleIsDisplaySafe` at :323-349 and
 * `licenceAgreesWithRawValue` at :361-365.
 *
 * A copy is a hand-maintained mirror (CLAUDE.md trap 12) and cannot be derived
 * from here — the predicate lives in another repo and cannot be imported. The
 * mitigation is that it is DECLARED as a mirror, pinned to a SHA, and confined
 * to this oracle: nothing in `src/` copies it. **If CEE's predicate changes,
 * this oracle must be re-derived from the new bytes, not trusted.**
 *
 * Its purpose: prove PLoT's row satisfies P4 and P7 as an executable check
 * rather than by reading the target JSON and believing it.
 */
const MODEL_SCALE_SUSPECT_ABS = 1;

function ceeReadRowValueScale(row: Record<string, unknown>): string | null {
  if (typeof row.value_scale === 'string') return row.value_scale;
  const ms = row.margin_sensitivity;
  if (ms !== null && typeof ms === 'object' && !Array.isArray(ms)) {
    const nested = (ms as Record<string, unknown>).value_scale;
    if (typeof nested === 'string') return nested;
  }
  return null;
}

/** CEE rung P4. */
function ceeFlipRowScaleIsDisplaySafe(
  row: Record<string, unknown>,
  currentValue: number,
  flipValue: number,
): boolean {
  const raw = ceeReadRowValueScale(row);
  const scale = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (scale === 'display') return true;
  if (scale.length > 0) return false;
  return Math.abs(currentValue) > MODEL_SCALE_SUSPECT_ABS &&
    Math.abs(flipValue) > MODEL_SCALE_SUSPECT_ABS;
}

/** CEE rung P7. */
function ceeLicenceAgreesWithRawValue(display: string, rawValue: number): boolean {
  const tokens = display.replace(/(?<=\d),(?=\d{3}\b)/g, '').match(/-?\d+(?:\.\d+)?/g);
  if (tokens === null) return false;
  return tokens.some((t) => Number(t) === rawValue);
}

// =============================================================================
// Fixtures — the live a7 factor from the 2026-07-31 wire capture
// =============================================================================

const OPTIONS = [
  { id: 'opt_status_quo', label: 'Status quo' },
  { id: 'opt_locum', label: 'Locum cover' },
];

/** The real node shape from the GRAPH_READY frame of attempt a7 (diagnosis §2.1). */
function makeNode(overrides: Partial<EngineNodeV3['observed_state']> = {}): EngineNodeV3 {
  return {
    id: 'fac_annual_staffing_cost',
    kind: 'factor',
    label: 'Annual Staffing Cost',
    observed_state: {
      value: 0.86,
      unit: '£',
      raw_value: 275000,
      cap: 320000,
      ...overrides,
    },
  } as EngineNodeV3;
}

function makeGraph(nodes: EngineNodeV3[]): EngineGraphV3 {
  return { nodes, edges: [] };
}

function makeFlip(overrides: Partial<FlipThresholdInputData> = {}): FlipThresholdInputData {
  return {
    factor_id: 'fac_annual_staffing_cost',
    factor_label: 'Annual Staffing Cost',
    current_value: 0.86,
    flip_value: null,
    direction: 'increase',
    flip_reason: 'no_effect_within_bounds',
    iterations_used: 0,
    probes_used: 3,
    alternative_winner_id: null,
    unit: '£',
    ...overrides,
  };
}

/** Convenience: run the denormaliser over one row with a graph and return it. */
function denormOne(
  flip: FlipThresholdInputData,
  graph: EngineGraphV3 | undefined,
  context?: NormalisationContext,
): DenormalisedFlipThreshold {
  const rows = denormaliseFlipThresholds([flip], context, OPTIONS, graph);
  expect(rows).toHaveLength(1);
  return rows[0];
}

// =============================================================================
// POSITIVES — RED before the fix
// =============================================================================

describe('F2 POSITIVE: a node carrying raw_value + cap yields a display-scale row', () => {
  it('lifts current_value out of [0,1] into user units using observed_state.raw_value', () => {
    const row = denormOne(makeFlip(), makeGraph([makeNode()]));
    // 275000 is the number the USER gave; 0.86 x 320000 = 275200 is the
    // round-trip of the already-rounded normalised value. The authoritative
    // raw_value wins, so the card never shows £275,200 for a £275,000 input.
    expect(row.current_value).toBe(275000);
  });

  it('stamps row-level value_scale "display" — the token CEE reads FIRST', () => {
    const row = denormOne(makeFlip(), makeGraph([makeNode()]));
    expect(row.value_scale).toBe('display');
  });

  it('emits current_display describing the raw value with its unit', () => {
    const row = denormOne(makeFlip(), makeGraph([makeNode()]));
    expect(row.current_display).toBe('275000 £');
  });

  it('denormalises a real flip_value against the cap and emits flip_display', () => {
    // A flip found at normalised 0.7546875 == 241500 / 320000.
    const row = denormOne(
      makeFlip({ flip_value: 241500 / 320000, flip_reason: 'found', alternative_winner_id: 'opt_locum' }),
      makeGraph([makeNode()]),
    );
    // Literal expectations, not `agrees(ourString, ourValue)` — that comparison
    // is self-referential and can only fail via the exponential guard.
    expect(row.flip_value).toBe(241500);
    expect(row.flip_display).toBe('241500 £');
  });

  it('falls back to value x cap when the node carries a cap but no raw_value', () => {
    const node = makeNode();
    delete (node.observed_state as Record<string, unknown>).raw_value;
    const row = denormOne(makeFlip(), makeGraph([node]));
    expect(row.current_value).toBe(275200);
    expect(row.value_scale).toBe('display');
    expect(row.current_display).toBe('275200 £');
  });
});

describe('F2 POSITIVE: the row satisfies CEE #776 cage rungs P4 and P7', () => {
  const flip = makeFlip({ flip_value: 241500 / 320000, flip_reason: 'found', alternative_winner_id: 'opt_locum' });

  it('P4 flipRowScaleIsDisplaySafe accepts the row', () => {
    const row = denormOne(flip, makeGraph([makeNode()]));
    expect(
      ceeFlipRowScaleIsDisplaySafe(
        row as unknown as Record<string, unknown>,
        row.current_value,
        row.flip_value!,
      ),
    ).toBe(true);
  });

  it('P4 is satisfied by the ROW-LEVEL token, overriding a nested normalised one', () => {
    // The live wire's margin_sensitivity says 'normalised'. Row level is read
    // first, so the row-level stamp must be what decides.
    const withMargin = { ...flip, margin_sensitivity: { value_scale: 'normalised' } as never };
    const row = denormOne(withMargin, makeGraph([makeNode()]));
    expect(ceeReadRowValueScale(row as unknown as Record<string, unknown>)).toBe('display');
  });

  it('P7 both display strings DESCRIBE the raw values the row ships', () => {
    const row = denormOne(flip, makeGraph([makeNode()]));
    // Independently-written expectations. `agrees(row.current_display,
    // row.current_value)` would be self-referential: the string is built from
    // String(value), and Number(String(x)) === x for every finite
    // non-exponential double, so it could only ever fail via the exponential
    // guard — it would pass even if both were the wrong number together.
    expect(row.current_display).toBe('275000 £');
    expect(row.flip_display).toBe('241500 £');
    expect(ceeLicenceAgreesWithRawValue('275000 £', row.current_value)).toBe(true);
    expect(ceeLicenceAgreesWithRawValue('241500 £', row.flip_value!)).toBe(true);
  });

  it('P7 CONTROL: the pre-fix pair (0.86 + "£") would FAIL agreement', () => {
    // Proves the oracle can see a failure — an agreement assertion that cannot
    // fail proves nothing (trap 13).
    expect(ceeLicenceAgreesWithRawValue('275000 £', 0.86)).toBe(false);
  });
});

// =============================================================================
// NEGATIVES / FAIL-CLOSED PINS
// =============================================================================

describe('F2 fail-closed: rows we cannot lift stay honest', () => {
  it('no cap and no raw_value → values untouched, no display strings, no display stamp', () => {
    const node = makeNode();
    node.observed_state = { value: 0.86, unit: '£' };
    const row = denormOne(makeFlip(), makeGraph([node]));
    expect(row.current_value).toBe(0.86);
    expect(row.current_display).toBeUndefined();
    expect(row.flip_display).toBeUndefined();
    expect(row.value_scale).not.toBe('display');
  });

  it('a cap of 0 is not a scale → fail closed, never a 1:1 "display" claim', () => {
    const row = denormOne(makeFlip(), makeGraph([makeNode({ cap: 0, raw_value: undefined })]));
    expect(row.current_value).toBe(0.86);
    expect(row.value_scale).not.toBe('display');
    expect(row.current_display).toBeUndefined();
  });

  it('the factor is absent from the graph → row untouched', () => {
    const row = denormOne(makeFlip(), makeGraph([]));
    expect(row.current_value).toBe(0.86);
    expect(row.value_scale).not.toBe('display');
    expect(row.current_display).toBeUndefined();
  });

  it('no graph supplied at all → pre-fix behaviour preserved exactly', () => {
    const row = denormOne(makeFlip(), undefined);
    expect(row.current_value).toBe(0.86);
    expect(row.value_scale).toBeUndefined();
    expect(row.current_display).toBeUndefined();
  });

  it('a raw_value inconsistent with value x cap beyond its own rounding error is REFUSED', () => {
    // value 0.86 has 2 dp ⇒ implied rounding error 0.005 ⇒ 1600 in user units.
    // A raw_value 50000 away cannot be this node's number; taking it would put
    // current_value and flip_value on different footings.
    const row = denormOne(makeFlip(), makeGraph([makeNode({ raw_value: 225000 })]));
    expect(row.current_value).toBeCloseTo(275200, 6);
    expect(row.value_scale).toBe('display');
  });

  // ===========================================================================
  // A1 (review #298) — the precision-implied tolerance must not run off a cliff
  // ===========================================================================
  //
  // The implied-precision term is `0.5 x 10^-decimals x width`, which widens as
  // the producer writes FEWER decimals: 2dp = 0.5% of range, 1dp = 5%, 0dp = 50%.
  // The widest cases are exactly the values most likely to be written exactly
  // (0, 1, x.5), so without an absolute ceiling the guard is loosest where it
  // most needs to bite — and a divergent raw_value ships as `display` while
  // `flip_value` was computed from a different baseline. That is the "two
  // numbers, one factor" hazard the function exists to prevent.

  it('A1 0dp: value=0 does NOT license a raw_value of 100000 (model baseline is 0)', () => {
    const row = denormOne(
      makeFlip({ current_value: 0 }),
      makeGraph([makeNode({ value: 0, raw_value: 100000 })]),
    );
    expect(row.current_value).toBe(0);
  });

  it('A1 0dp: value=1 does NOT license a raw_value of 200000 (model baseline is 320000)', () => {
    const row = denormOne(
      makeFlip({ current_value: 1 }),
      makeGraph([makeNode({ value: 1, raw_value: 200000 })]),
    );
    expect(row.current_value).toBe(320000);
  });

  it('A1 1dp: value=0.9 does NOT license a raw_value 8000 off the 288000 baseline', () => {
    const row = denormOne(
      makeFlip({ current_value: 0.9 }),
      makeGraph([makeNode({ value: 0.9, raw_value: 280000 })]),
    );
    expect(row.current_value).toBe(288000);
  });

  it('A1 x.5: value=0.5 does NOT license a raw_value of 50000 (baseline 160000)', () => {
    const row = denormOne(
      makeFlip({ current_value: 0.5 }),
      makeGraph([makeNode({ value: 0.5, raw_value: 50000 })]),
    );
    expect(row.current_value).toBe(160000);
  });

  it('A1 CONTROL: the ceiling still admits the genuine live case (0.86 / 275000 / 320000)', () => {
    // Without this, "reject everything" would pass every A1 pin above while
    // silently removing the feature.
    const row = denormOne(makeFlip(), makeGraph([makeNode()]));
    expect(row.current_value).toBe(275000);
    expect(row.value_scale).toBe('display');
  });
});

// =============================================================================
// A2 (review #298) — no float tail may reach current_value / flip_value
// =============================================================================
//
// `flip_value` is roundTo4'd and then multiplied by the cap, so the product
// carries IEEE dust: 0.29 x 100 = 28.999999999999996. CEE's agreement rung is an
// EXACT equality, so an LLM writing the obvious "29" is DENIED — and once F1
// reads the producer string, the user is shown the tail itself. Rounding a
// display-scale value to the precision the model can actually resolve is MORE
// honest than shipping sixteen digits of float noise, not less.

describe('F2/A2 emitted values carry no float tail', () => {
  function capNode(value: number, cap: number, unit = '%'): EngineNodeV3 {
    return {
      id: 'fac_annual_staffing_cost',
      kind: 'factor',
      label: 'Annual Staffing Cost',
      observed_state: { value, unit, cap },
    } as EngineNodeV3;
  }

  it('0.29 of a cap of 100 is 29, not 28.999999999999996', () => {
    const row = denormOne(
      makeFlip({ current_value: 0.29, unit: '%' }),
      makeGraph([capNode(0.29, 100)]),
    );
    expect(row.current_value).toBe(29);
    expect(row.current_display).toBe('29 %');
  });

  it('0.29 of a cap of 3000 is 870, not 869.9999999999999', () => {
    const row = denormOne(
      makeFlip({ current_value: 0.29, unit: '%' }),
      makeGraph([capNode(0.29, 3000)]),
    );
    expect(row.current_value).toBe(870);
    expect(row.current_display).toBe('870 %');
  });

  it('a flip_value is cleaned on the same grid as current_value', () => {
    const row = denormOne(
      makeFlip({ current_value: 0.29, flip_value: 0.83, unit: '%', flip_reason: 'found' }),
      makeGraph([capNode(0.29, 100)]),
    );
    expect(row.flip_value).toBe(83);
    expect(row.flip_display).toBe('83 %');
  });

  it('⭐ P7 against an INDEPENDENTLY-written string — the non-self-referential check', () => {
    // Comparing our own string to our own value can only fail via the
    // exponential guard, because Number(String(x)) === x for every finite
    // non-exponential double. The real question is whether a string written by
    // SOMEONE ELSE — CEE's decision_review LLM, told to emit the value "as-is"
    // with its unit — agrees with the number we ship. That is what P7 actually
    // evaluates, and it is what the float tail breaks.
    const row = denormOne(
      makeFlip({ current_value: 0.29, flip_value: 0.83, unit: '%', flip_reason: 'found' }),
      makeGraph([capNode(0.29, 100)]),
    );
    expect(ceeLicenceAgreesWithRawValue('29 %', row.current_value)).toBe(true);
    expect(ceeLicenceAgreesWithRawValue('83 %', row.flip_value!)).toBe(true);
    // And the separator-bearing form an LLM might write for a large number.
    const big = denormOne(makeFlip(), makeGraph([makeNode()]));
    expect(ceeLicenceAgreesWithRawValue('275,000 GBP', big.current_value)).toBe(true);
  });

  it('SWEEP: no emitted value carries dust, and every one stays faithful to value x cap', () => {
    const caps = [100, 500, 1000, 3000, 12000, 16000, 320000];
    let checked = 0;
    for (const cap of caps) {
      for (let i = 1; i <= 99; i++) {
        const value = i / 100;
        const row = denormOne(
          makeFlip({ current_value: value, unit: '%' }),
          makeGraph([capNode(value, cap)]),
        );
        const decimals = (String(row.current_value).split('.')[1] ?? '').length;
        // Dust shows up as 12-17 decimals; a legitimately fractional user value
        // needs at most the 4 the normalised grid can resolve.
        expect(decimals, `cap=${cap} value=${value} -> ${row.current_value}`).toBeLessThanOrEqual(4);
        // Cleaning must not move the number meaningfully.
        expect(Math.abs(row.current_value - value * cap)).toBeLessThanOrEqual(
          Math.abs(value * cap) * 1e-6 + 1e-9,
        );
        checked++;
      }
    }
    // Anti-vacuity: the loop really ran.
    expect(checked).toBe(caps.length * 99);
  });

  it('a null flip_value keeps flip_display absent while current is still lifted', () => {
    const row = denormOne(makeFlip({ flip_value: null }), makeGraph([makeNode()]));
    expect(row.flip_value).toBeNull();
    expect(row.flip_display).toBeUndefined();
    expect(row.current_value).toBe(275000);
    expect(row.value_scale).toBe('display');
  });

  it('attested-normalised: raw_value present but the cap is unusable → value_scale "normalised"', () => {
    // The node bears the marks of normalisation (raw_value) but we cannot lift
    // it. Saying so beats leaving the scale absent for a magnitude heuristic.
    const row = denormOne(makeFlip(), makeGraph([makeNode({ cap: undefined })]));
    expect(row.current_value).toBe(0.86);
    expect(row.value_scale).toBe('normalised');
    expect(row.current_display).toBeUndefined();
  });
});

describe('F2 does not disturb the pre-existing Phase 4a path', () => {
  const ctx = (source: 'explicit' | 'explicit_cap'): NormalisationContext => ({
    factors: new Map([
      [
        'fac_annual_staffing_cost',
        { factor_id: 'fac_annual_staffing_cost', range: { min: 0, max: 320000, source }, baseline: 0 },
      ],
    ]),
    goal_node_id: 'goal',
  });

  it('an explicit (state_space) range still denormalises and gains no row-level stamp', () => {
    const row = denormOne(makeFlip({ flip_value: 0.5 }), undefined, ctx('explicit'));
    expect(row.current_value).toBeCloseTo(275200, 6);
    expect(row.flip_value).toBeCloseTo(160000, 6);
    expect(row.value_scale).toBeUndefined();
  });

  it('an explicit_cap context range DOES stamp display', () => {
    const row = denormOne(makeFlip({ flip_value: 0.5 }), makeGraph([makeNode()]), ctx('explicit_cap'));
    expect(row.value_scale).toBe('display');
    expect(row.flip_display).toBeDefined();
  });
});

describe('F2 display strings are lossless — P7 is an EXACT equality test', () => {
  it('never uses exponential notation; a value JS would render as 1e+21 gets no string', () => {
    // String(1e21) === '1e+21' tokenises to [1, 21]; Number('1') !== 1e21, so a
    // string we cannot guarantee is not authored at all.
    const row = denormOne(
      makeFlip({ current_value: 1 }),
      makeGraph([makeNode({ cap: 1e21, raw_value: undefined, value: 1 })]),
    );
    expect(row.current_display).toBeUndefined();
  });

  it('keeps genuine fractional precision on a small-range factor', () => {
    // Range width 2 ⇒ the normalised grid resolves 2e-4 ⇒ 4 decimals are kept.
    // Cleaning must remove float noise WITHOUT flattening a real fraction.
    const node = makeNode({ cap: 2, raw_value: undefined, value: 0.1235 });
    const row = denormOne(makeFlip({ current_value: 0.1235 }), makeGraph([node]));
    expect(row.current_value).toBe(0.247);
    expect(row.current_display).toBe('0.247 £');
    expect(ceeLicenceAgreesWithRawValue('0.247 £', row.current_value)).toBe(true);
  });
});
