/**
 * ROADMAP 1.277 — close the fabricate-on-absence class at the PRIMITIVE.
 *
 * `denormaliseValue(normalised, range)` used to declare `normalised: number` and
 * return `number`. That `number` was a compile-time fiction over `as`-cast wire
 * data: PLoT parses every ISL response with `JSON.parse(text) as T`
 * (src/integrations/isl/client.ts:245 — no runtime validation), and ISL emits
 * `null` for an absent nested numeric. So `null` reached the arithmetic:
 *
 *     denormaliseValue(null, { min: 10, max: 20 }) === null * 10 + 10 === 10
 *
 * — the RANGE FLOOR, and `Number.isFinite(10)` is **true**. An outcome ISL never
 * computed was published as a precise, confident measurement pinned to the worst
 * possible result, and no post-hoc finiteness check could see it: a fabricated
 * finite number is indistinguishable from a measured one AFTER the fact. The only
 * place the distinction still exists is BEFORE the multiply.
 *
 * ── MUTATION VERDICT (measured, not asserted) ────────────────────────────────
 * This whole file was run against the PRISTINE pre-fix source at f8e4df10 in a
 * throwaway clone. Result: **6 failed | 10 passed**. Every failure reported the
 * fabrication verbatim — `expected 10 to be undefined`, `expected 5 to be
 * undefined`, `expected { winner_id: 'opt1' } to not have property
 * "mean_outcome"`.
 *
 * The tests are labelled by what that run actually proved, NOT by what they were
 * intended to prove:
 *
 *   `DEFECT:`    — RED on pristine. These discriminate; they are the real pins.
 *   `PIN:`       — GREEN on pristine too. An existing caller-side guard already
 *                  covered that path, so the test does NOT prove this lane's fix.
 *                  It is a regression pin protecting behaviour that must survive
 *                  the primitive change (several of these cover guards this lane
 *                  DELETED as now-redundant, which is exactly where equivalence
 *                  needs pinning). Calling them DEFECT tests would be the
 *                  "passes before the fix" theatre this programme hunts.
 *   `POSITIVE CONTROL:` — GREEN both ways BY DESIGN. Proves the fix does not
 *                  over-suppress or drift real values. A control that went red on
 *                  pristine would be a broken control.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from 'vitest';
import {
  buildNormalisationContext,
  denormaliseValue,
  type NormalisationContext,
  type NormalisationRange,
} from '../src/lib/intervention-normaliser.js';
import { denormaliseFlipThresholds } from '../src/lib/flip-threshold-denormaliser.js';
import { transformConditionalWinners, transformEdgeEValues, type EdgeEValueDropSink } from '../src/routes/v2/run.js';
import type { EngineNodeV3 } from '../src/types/engine-v3.js';
import type { MarginSensitivity } from '../src/analysis/margin-sensitivity.js';

/**
 * Goal range [10, 20], factor range [0, 200]. Deliberately chosen so the
 * fabricated value is UNMISTAKABLE: the goal floor is 10, which is nowhere near
 * any legitimate denormalised outcome in these fixtures, and is not 0 (a 0 would
 * be ambiguous with a genuine zero measurement).
 */
const GOAL_RANGE: NormalisationRange = { min: 10, max: 20, source: 'explicit' };
const NODES: EngineNodeV3[] = [
  { id: 'goal', kind: 'goal', label: 'Revenue', state_space: { range: { min: 10, max: 20 } } },
  { id: 'f', kind: 'factor', label: 'Spend', state_space: { range: { min: 0, max: 200 } }, observed_state: { value: 0.6 } },
];
function ctx(): NormalisationContext {
  return buildNormalisationContext(NODES, 'goal');
}

// ---------------------------------------------------------------------------
// 1. The primitive
// ---------------------------------------------------------------------------

describe('ROADMAP 1.277 · denormaliseValue — absence in ⇒ absence out', () => {
  it('DEFECT: null no longer becomes the range FLOOR disguised as a measurement', () => {
    const out = denormaliseValue(null, GOAL_RANGE);
    // Pre-fix this was 10 — the range floor — and Number.isFinite(10) passed it
    // through every downstream guard as a confident measured outcome.
    expect(out).toBeUndefined();
    expect(out).not.toBe(GOAL_RANGE.min);
  });

  it('DEFECT: the fabricated floor was FINITE — which is why post-hoc checks were blind', () => {
    // This is the whole reason the fix had to move BEFORE the arithmetic. Pin the
    // pre-fix arithmetic explicitly so the reason survives in the record.
    const preFixArithmetic = (null as unknown as number) * (GOAL_RANGE.max - GOAL_RANGE.min) + GOAL_RANGE.min;
    expect(preFixArithmetic).toBe(10);
    expect(Number.isFinite(preFixArithmetic)).toBe(true); // a finiteness check CANNOT catch this
    expect(denormaliseValue(null, GOAL_RANGE)).toBeUndefined(); // the primitive can
  });

  it('DEFECT: every absence shape maps to undefined — not just the two that used to yield NaN', () => {
    for (const v of [null, undefined, NaN, Infinity, -Infinity, '0.5', {}, [], true]) {
      expect(denormaliseValue(v, GOAL_RANGE)).toBeUndefined();
    }
  });

  it('DEFECT: absence beats the zero-width shortcut (a degenerate range must not manufacture max)', () => {
    const zeroWidth: NormalisationRange = { min: 5, max: 5, source: 'explicit' };
    expect(denormaliseValue(null, zeroWidth)).toBeUndefined(); // pre-fix: 5
    expect(denormaliseValue(0.5, zeroWidth)).toBe(5); // positive control: still the single point
  });

  it('POSITIVE CONTROL: every genuine measurement maps exactly as before', () => {
    expect(denormaliseValue(0, GOAL_RANGE)).toBe(10);
    expect(denormaliseValue(0.5, GOAL_RANGE)).toBe(15);
    expect(denormaliseValue(1, GOAL_RANGE)).toBe(20);
    expect(denormaliseValue(0.5, { min: 10, max: 60, source: 'explicit' })).toBe(35);
    expect(denormaliseValue(0.25, { min: 0, max: 500000, source: 'explicit' })).toBe(125000);
    // Negative and out-of-[0,1] inputs are still mapped verbatim (no clamping).
    expect(denormaliseValue(-1, GOAL_RANGE)).toBe(0);
    expect(denormaliseValue(2, GOAL_RANGE)).toBe(30);
    // Exact zero is a MEASUREMENT, never an absence.
    expect(denormaliseValue(0, { min: 0, max: 1, source: 'default' })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. conditional_winners — the LIVE fabrication site (run.ts denormMeanOutcome)
// ---------------------------------------------------------------------------

const WINNER_BASE = {
  factor_id: 'f',
  factor_label: 'Spend',
  split_value: 0.6,
  winner_flips: true,
};

function makeWinner(lowMean: unknown, highMean: unknown) {
  return {
    ...WINNER_BASE,
    low_bucket: { winner_id: 'opt1', win_probability: 0.7, mean_outcome: lowMean },
    high_bucket: { winner_id: 'opt2', win_probability: 0.8, mean_outcome: highMean },
  };
}

describe('ROADMAP 1.277 · transformConditionalWinners — mean_outcome absence', () => {
  it('DEFECT: a null mean_outcome is OMITTED, not published as the goal-range floor', () => {
    const out = transformConditionalWinners([makeWinner(null, null)] as never, undefined, undefined, ctx());
    expect(out).toHaveLength(1);

    // Pre-fix: `null === undefined` is false, so null reached the arithmetic and
    // both buckets carried mean_outcome: 10 — a confident "worst possible result".
    expect(out[0].low_bucket).not.toHaveProperty('mean_outcome');
    expect(out[0].high_bucket).not.toHaveProperty('mean_outcome');

    // Assert on the SERIALISED BYTES too: the floor must not appear at all, and
    // the omission must be an absent key, never a fabricated null.
    const json = JSON.stringify(out);
    expect(json).not.toContain('"mean_outcome":10');
    expect(json).not.toContain('"mean_outcome":null');
    expect(json).not.toContain('mean_outcome');
  });

  it('DEFECT: one null bucket is omitted while the sibling MEASURED bucket survives', () => {
    // Guards against a fix that over-suppresses: absence is per-field, not per-entry.
    const out = transformConditionalWinners([makeWinner(null, 0.75)] as never, undefined, undefined, ctx());
    expect(out[0].low_bucket).not.toHaveProperty('mean_outcome');
    expect(out[0].high_bucket.mean_outcome).toBe(17.5); // 0.75 × 10 + 10
  });

  it('PIN: a null mean_outcome does NOT drop the whole entry (the rest is still measured)', () => {
    const out = transformConditionalWinners([makeWinner(null, null)] as never, undefined, undefined, ctx());
    expect(out[0].split_value).toBe(120); // 0.6 × 200 + 0 — factor range, still mapped
    expect(out[0].low_bucket.win_probability).toBe(0.7);
    expect(out[0].winner_flips).toBe(true);
  });

  it('POSITIVE CONTROL: a fully-present entry serialises to the exact same bytes', () => {
    const out = transformConditionalWinners([makeWinner(0.25, 0.75)] as never, undefined, undefined, ctx());
    expect(JSON.stringify(out)).toBe(JSON.stringify([{
      factor_id: 'f',
      factor_label: 'Spend',     // from the ISL entry, not the node-label map
      split_value: 120,          // 0.6 × 200 + 0
      low_bucket: {
        winner_id: 'opt1',
        winner_label: 'opt1',
        win_probability: 0.7,
        mean_outcome: 12.5,      // 0.25 × 10 + 10
      },
      high_bucket: {
        winner_id: 'opt2',
        winner_label: 'opt2',
        win_probability: 0.8,
        mean_outcome: 17.5,      // 0.75 × 10 + 10
      },
      winner_flips: true,
    }]));
  });

  it('POSITIVE CONTROL: mean_outcome 0 (a real zero) is PRESERVED, never mistaken for absence', () => {
    // The sharpest over-suppression trap: 0 is falsy, and 0 normalised maps to the
    // same goal floor (10) the null defect fabricated. It must still be emitted.
    const out = transformConditionalWinners([makeWinner(0, 0)] as never, undefined, undefined, ctx());
    expect(out[0].low_bucket.mean_outcome).toBe(10);
    expect(out[0].high_bucket.mean_outcome).toBe(10);
  });

  it('PIN: no goal range — values stay normalised and are flagged, absence still omitted', () => {
    const noGoal = buildNormalisationContext(
      [{ id: 'f', kind: 'factor', label: 'Spend', state_space: { range: { min: 0, max: 200 } } }] as EngineNodeV3[],
      'missing-goal',
    );
    const out = transformConditionalWinners([makeWinner(null, 0.75)] as never, undefined, undefined, noGoal);
    expect(out[0]._normalised).toBe(true);
    expect(out[0].low_bucket).not.toHaveProperty('mean_outcome');
    expect(out[0].high_bucket.mean_outcome).toBe(0.75); // verbatim, unmapped
  });
});

// ---------------------------------------------------------------------------
// 3. edge_e_values — absence must DROP the entry, never fabricate a mean
// ---------------------------------------------------------------------------

/**
 * NOTE — these are PINs, not defect tests, and the mutation run is why.
 *
 * Every denormaliseValue call in transformEdgeEValues was ALREADY preceded by a
 * `typeof x === 'number'` guard, and `typeof null === 'object'`, so null could
 * never reach the arithmetic on this route. The brief for this lane predicted
 * these sites (run.ts:549/551/553/576) were the blind ones; the mutation run
 * refuted that — all three assertions below pass on the pristine source.
 *
 * They stay because the primitive change widened `currentMean`/`flipMean` to
 * `number | undefined` and rewrote the egress guard to bind-and-re-emit the
 * checked values. That rewrite is exactly the kind of "equivalent refactor" that
 * ships regressions under green CI, so the behaviour it must preserve is pinned.
 */
describe('ROADMAP 1.277 · transformEdgeEValues — null means drop, never fabricate', () => {
  it('PIN: a null current_mean drops the entry instead of publishing the goal floor', () => {
    const sink: EdgeEValueDropSink = { inputNull: 0, overflow: 0 };
    const isl = [{ edge_id: 'f->goal', e_value: 0.4, current_mean: null, flip_mean: 0.5, flip_direction: 'increase' }];
    const out = transformEdgeEValues(isl as never, undefined, ctx(), sink);
    expect(out).toHaveLength(0);
    expect(JSON.stringify(out)).not.toContain('10');
    // Attributed to the INPUT, not to a transform overflow.
    expect(sink).toEqual({ inputNull: 1, overflow: 0 });
  });

  it('PIN: a null band endpoint is omitted and cannot manufacture a band_width', () => {
    const isl = [{
      edge_id: 'f->goal', e_value: 0.4, current_mean: 0.5, flip_mean: 0.6, flip_direction: 'increase',
      stability: { band_min: null, band_max: null, band_median: null, n_seeds: 8, n_seeds_flipped: 0 },
    }];
    const out = transformEdgeEValues(isl as never, undefined, ctx());
    expect(out).toHaveLength(1);
    const stability = out[0].stability as Record<string, unknown>;
    expect(stability.band_min).toBeNull();     // preserved as the ISL-sent null, never 10
    expect(stability).not.toHaveProperty('band_width');
    expect(JSON.stringify(out)).not.toContain('"band_min":10');
  });

  it('POSITIVE CONTROL: a fully-present edge maps exactly and is retained', () => {
    const out = transformEdgeEValues(
      [{ edge_id: 'f->goal', e_value: 0.4, current_mean: 0.5, flip_mean: 0.6, flip_direction: 'increase' }] as never,
      new Map([['f', 'Spend'], ['goal', 'Revenue']]),
      ctx(),
    );
    expect(JSON.stringify(out)).toBe(JSON.stringify([{
      edge_id: 'f::goal',
      from_id: 'f',
      to_id: 'goal',
      from_label: 'Spend',
      to_label: 'Revenue',
      e_value: 0.4,
      flip_direction: 'increase',
      current_mean: 15,  // 0.5 × 10 + 10
      flip_mean: 16,     // 0.6 × 10 + 10
    }]));
  });
});

// ---------------------------------------------------------------------------
// 4. flip thresholds — margin_sensitivity probe value
// ---------------------------------------------------------------------------

const MARGIN_BASE: MarginSensitivity = {
  movement: 'weakens',
  threshold: 0.05,
  baseline_leading_option_id: 'opt1',
  baseline_runner_up_option_id: 'opt2',
  baseline_margin: 0.2,
  min_probe_margin: 0.1,
  max_probe_margin: 0.3,
  min_probe_delta: -0.1,
  max_probe_delta: 0.1,
  strongest_direction: 'min',
  strongest_probe_value: 0.25,
  value_scale: 'normalised',
  strongest_delta: -0.1,
  strongest_delta_abs: 0.1,
} as MarginSensitivity;

function flipInput(probe: number | null) {
  return [{
    factor_id: 'f',
    factor_label: 'Spend',
    current_value: 0.6,
    flip_value: 0.8,
    direction: 'increase' as const,
    flip_reason: 'found' as const,
    margin_sensitivity: { ...MARGIN_BASE, strongest_probe_value: probe },
  }];
}

/**
 * EQUIVALENCE PINS for a guard this lane DELETED.
 *
 * `denormaliseMarginSensitivity` used to read:
 *
 *     const probeIsFinite = margin.strongest_probe_value !== null &&
 *                           Number.isFinite(margin.strongest_probe_value);
 *     const denormProbe = probeIsFinite
 *       ? denormaliseValue(margin.strongest_probe_value as number, range) : null;
 *
 * — a hand-written pre-check plus an `as number` cast to launder the type past a
 * `number` parameter. The primitive now performs that check itself, so both were
 * removed. Both assertions below pass on the PRISTINE source as well; they are
 * not evidence of a fix, they are the proof that REMOVING the guard changed
 * nothing observable. That is the claim that actually needed a test here.
 */
describe('ROADMAP 1.277 · denormaliseFlipThresholds — probe value absence', () => {
  it('PIN: a null strongest_probe_value stays null and is DISCLOSED as unavailable', () => {
    const out = denormaliseFlipThresholds(flipInput(null) as never, ctx(), []);
    const margin = out[0].margin_sensitivity!;
    expect(margin.strongest_probe_value).toBeNull();
    expect(margin.display_value_available).toBe(false);
    expect(margin.value_scale).toBe('display');
    expect(JSON.stringify(out)).not.toContain('"strongest_probe_value":0');
  });

  it('POSITIVE CONTROL: a present probe value denormalises exactly and is flagged available', () => {
    const out = denormaliseFlipThresholds(flipInput(0.25) as never, ctx(), []);
    const margin = out[0].margin_sensitivity!;
    expect(margin.strongest_probe_value).toBe(50); // 0.25 × 200 + 0 — factor range
    expect(margin.display_value_available).toBe(true);
    expect(margin.value_scale).toBe('display');
    // The surrounding entry is untouched by this lane.
    expect(out[0].current_value).toBe(120); // 0.6 × 200
    expect(out[0].flip_value).toBe(160);    // 0.8 × 200
    expect(out[0].flip_reason).toBe('found');
  });
});
