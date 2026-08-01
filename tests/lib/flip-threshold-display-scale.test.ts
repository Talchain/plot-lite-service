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
    expect(row.flip_value).toBeCloseTo(241500, 6);
    expect(row.flip_display).toBeDefined();
    expect(ceeLicenceAgreesWithRawValue(row.flip_display!, row.flip_value!)).toBe(true);
  });

  it('falls back to value x cap when the node carries a cap but no raw_value', () => {
    const node = makeNode();
    delete (node.observed_state as Record<string, unknown>).raw_value;
    const row = denormOne(makeFlip(), makeGraph([node]));
    expect(row.current_value).toBeCloseTo(275200, 6);
    expect(row.value_scale).toBe('display');
    expect(ceeLicenceAgreesWithRawValue(row.current_display!, row.current_value)).toBe(true);
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
    expect(ceeLicenceAgreesWithRawValue(row.current_display!, row.current_value)).toBe(true);
    expect(ceeLicenceAgreesWithRawValue(row.flip_display!, row.flip_value!)).toBe(true);
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

  it('never rounds — a fractional user value round-trips through the agreement check', () => {
    const node = makeNode({ cap: 3, raw_value: undefined, value: 1 / 3 });
    const row = denormOne(makeFlip({ current_value: 1 / 3 }), makeGraph([node]));
    expect(row.current_display).toBeDefined();
    expect(ceeLicenceAgreesWithRawValue(row.current_display!, row.current_value)).toBe(true);
  });
});
