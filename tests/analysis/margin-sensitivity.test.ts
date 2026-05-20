/**
 * Pure-helper tests for margin-sensitivity classification.
 */

import { describe, it, expect } from 'vitest';
import {
  computeMarginSensitivity,
  MARGIN_MOVEMENT_THRESHOLD,
} from '../../src/analysis/margin-sensitivity.js';
import type { FlipInferenceResult } from '../../src/analysis/flip-thresholds.js';

function probe(...pairs: Array<[string, number]>): FlipInferenceResult {
  return { options: pairs.map(([option_id, win_probability]) => ({ option_id, win_probability })) };
}

describe('computeMarginSensitivity()', () => {
  describe('strict flip precedence', () => {
    it("returns 'flipped' when caller signals a strict flip", () => {
      const baseline = probe(['a', 0.6], ['b', 0.3], ['c', 0.1]);
      const min = probe(['a', 0.55], ['b', 0.35], ['c', 0.1]); // still leader
      const max = probe(['a', 0.5], ['b', 0.4], ['c', 0.1]); // still leader
      const out = computeMarginSensitivity({ baseline, min, max, strictFlipDetected: true });
      expect(out.movement).toBe('flipped');
      expect(out.baseline_leading_option_id).toBe('a');
      expect(out.baseline_runner_up_option_id).toBe('b');
    });

    it("treats bound-level flip (probe margin negative) as 'flipped' even without strictFlipDetected", () => {
      const baseline = probe(['a', 0.55], ['b', 0.35], ['c', 0.1]);
      const min = probe(['a', 0.3], ['b', 0.6], ['c', 0.1]); // 'a' lost the lead at min
      const max = probe(['a', 0.55], ['b', 0.35], ['c', 0.1]);
      const out = computeMarginSensitivity({ baseline, min, max, strictFlipDetected: false });
      expect(out.movement).toBe('flipped');
      expect(out.strongest_direction).toBe('towards_min');
      expect(out.strongest_probe_value).toBe(0);
      expect(out.min_probe_margin).toBeLessThan(0);
    });
  });

  describe('weakened lead', () => {
    it("classifies a 10pp lead-margin compression at min bound as 'weakened'", () => {
      // baseline margin 0.6 - 0.3 = 0.3. min: 0.5 - 0.4 = 0.1 → delta = -0.2 (≥ 0.05).
      const baseline = probe(['a', 0.6], ['b', 0.3], ['c', 0.1]);
      const min = probe(['a', 0.5], ['b', 0.4], ['c', 0.1]);
      const max = probe(['a', 0.61], ['b', 0.29], ['c', 0.1]); // ~unchanged
      const out = computeMarginSensitivity({ baseline, min, max, strictFlipDetected: false });
      expect(out.movement).toBe('weakened');
      expect(out.strongest_direction).toBe('towards_min');
      expect(out.strongest_probe_value).toBe(0);
      expect(out.baseline_margin).toBeCloseTo(0.3, 10);
      expect(out.min_probe_delta).toBeLessThan(0);
    });
  });

  describe('strengthened lead', () => {
    it("classifies a 7pp lead-margin growth at max bound as 'strengthened'", () => {
      const baseline = probe(['a', 0.5], ['b', 0.4], ['c', 0.1]);
      const min = probe(['a', 0.5], ['b', 0.4], ['c', 0.1]); // unchanged
      const max = probe(['a', 0.6], ['b', 0.3], ['c', 0.1]); // margin 0.1 → 0.3 ; delta +0.2
      const out = computeMarginSensitivity({ baseline, min, max, strictFlipDetected: false });
      expect(out.movement).toBe('strengthened');
      expect(out.strongest_direction).toBe('towards_max');
      expect(out.strongest_probe_value).toBe(1);
      expect(out.max_probe_delta).toBeGreaterThan(0);
    });
  });

  describe('no movement below threshold', () => {
    it("returns 'none' and direction 'none' when both deltas are sub-threshold", () => {
      const baseline = probe(['a', 0.6], ['b', 0.3], ['c', 0.1]);
      const min = probe(['a', 0.59], ['b', 0.31], ['c', 0.1]); // delta ~-0.02
      const max = probe(['a', 0.62], ['b', 0.29], ['c', 0.09]); // delta ~+0.03
      const out = computeMarginSensitivity({ baseline, min, max, strictFlipDetected: false });
      expect(out.movement).toBe('none');
      expect(out.strongest_direction).toBe('none');
      expect(out.strongest_probe_value).toBeNull();
    });
  });

  describe('threshold boundary', () => {
    it('classifies movement at exactly the threshold (>= behaviour, not strictly >)', () => {
      // Engineer min delta = exactly -MARGIN_MOVEMENT_THRESHOLD
      // baseline 0.6 - 0.3 = 0.3 ; min: a=0.575, b=0.325, c=0.1 → margin 0.25 → delta -0.05
      const baseline = probe(['a', 0.6], ['b', 0.3], ['c', 0.1]);
      const min = probe(['a', 0.575], ['b', 0.325], ['c', 0.1]);
      const max = probe(['a', 0.6], ['b', 0.3], ['c', 0.1]);
      const out = computeMarginSensitivity({ baseline, min, max, strictFlipDetected: false });
      expect(out.threshold).toBe(MARGIN_MOVEMENT_THRESHOLD);
      expect(Math.abs(out.min_probe_delta as number)).toBeCloseTo(MARGIN_MOVEMENT_THRESHOLD, 10);
      expect(out.movement).toBe('weakened');
    });
  });

  describe('both directions material', () => {
    it("picks larger |delta| sign for movement and sets strongest_direction to 'both' on opposite signs", () => {
      // baseline 0.55 - 0.4 = 0.15
      // min compresses by 0.08 (delta -0.08), max grows by 0.06 (delta +0.06).
      const baseline = probe(['a', 0.55], ['b', 0.4], ['c', 0.05]);
      const min = probe(['a', 0.51], ['b', 0.44], ['c', 0.05]); // margin 0.07 → delta -0.08
      const max = probe(['a', 0.58], ['b', 0.37], ['c', 0.05]); // margin 0.21 → delta +0.06
      const out = computeMarginSensitivity({ baseline, min, max, strictFlipDetected: false });
      expect(out.movement).toBe('weakened');
      expect(out.strongest_direction).toBe('both');
      expect(out.strongest_probe_value).toBe(0);
    });

    it("uses larger |delta| side for strongest_direction when both same-sign material", () => {
      // both deltas negative; max is larger
      const baseline = probe(['a', 0.55], ['b', 0.4], ['c', 0.05]);
      const min = probe(['a', 0.51], ['b', 0.44], ['c', 0.05]); // delta -0.08
      const max = probe(['a', 0.48], ['b', 0.47], ['c', 0.05]); // margin 0.01 → delta -0.14
      const out = computeMarginSensitivity({ baseline, min, max, strictFlipDetected: false });
      expect(out.movement).toBe('weakened');
      expect(out.strongest_direction).toBe('towards_max');
      expect(out.strongest_probe_value).toBe(1);
    });
  });

  describe('runner-up tie handling', () => {
    it('deterministically picks lexicographically-smallest option_id for the runner-up tie', () => {
      const baseline = probe(['a', 0.6], ['c', 0.2], ['b', 0.2]); // b and c tie for runner-up
      const min = probe(['a', 0.6], ['b', 0.2], ['c', 0.2]);
      const max = probe(['a', 0.6], ['b', 0.2], ['c', 0.2]);
      const out = computeMarginSensitivity({ baseline, min, max, strictFlipDetected: false });
      expect(out.baseline_leading_option_id).toBe('a');
      expect(out.baseline_runner_up_option_id).toBe('b'); // 'b' < 'c'
    });
  });

  describe('numeric safety', () => {
    it('returns all-null and movement none when probe has <2 valid options', () => {
      const baseline = probe(['a', 0.9]); // only one option
      const min = probe(['a', 0.9]);
      const max = probe(['a', 0.9]);
      const out = computeMarginSensitivity({ baseline, min, max, strictFlipDetected: false });
      expect(out.movement).toBe('none');
      expect(out.baseline_leading_option_id).toBeNull();
      expect(out.baseline_runner_up_option_id).toBeNull();
      expect(out.baseline_margin).toBeNull();
      expect(out.min_probe_margin).toBeNull();
      expect(out.max_probe_margin).toBeNull();
    });

    it('still surfaces flipped for strictFlipDetected even when baseline lacks 2 valid options', () => {
      const baseline = probe(['a', 0.9]);
      const min = probe(['a', 0.9]);
      const max = probe(['a', 0.9]);
      const out = computeMarginSensitivity({ baseline, min, max, strictFlipDetected: true });
      expect(out.movement).toBe('flipped');
    });

    it('filters NaN/Infinity win_probability and treats probe as missing those options', () => {
      const baseline = probe(['a', 0.6], ['b', 0.3], ['c', 0.1]);
      const minBad: FlipInferenceResult = {
        options: [
          { option_id: 'a', win_probability: NaN },
          { option_id: 'b', win_probability: 0.5 },
          { option_id: 'c', win_probability: Number.POSITIVE_INFINITY },
        ],
      };
      const max = probe(['a', 0.61], ['b', 0.29], ['c', 0.1]);
      const out = computeMarginSensitivity({ baseline, min: minBad, max, strictFlipDetected: false });
      // The leader 'a' has no finite probe at min → min_probe_margin is null
      expect(out.min_probe_margin).toBeNull();
      expect(out.min_probe_delta).toBeNull();
      // All remaining numeric outputs are finite or null — never NaN/Infinity.
      const numerics: Array<number | null> = [
        out.baseline_margin,
        out.min_probe_margin,
        out.max_probe_margin,
        out.min_probe_delta,
        out.max_probe_delta,
        out.strongest_probe_value,
      ];
      for (const v of numerics) {
        if (v !== null) expect(Number.isFinite(v)).toBe(true);
      }
    });

    it('stamps value_scale "normalised" by default', () => {
      const baseline = probe(['a', 0.6], ['b', 0.3]);
      const min = probe(['a', 0.6], ['b', 0.3]);
      const max = probe(['a', 0.6], ['b', 0.3]);
      const out = computeMarginSensitivity({ baseline, min, max, strictFlipDetected: false });
      expect(out.value_scale).toBe('normalised');
    });
  });

  // ===========================================================================
  // Display-ready fields — PLoT emits them so DGAI stays a thin display layer.
  // DGAI must NOT compute these from raw min_probe_delta / max_probe_delta.
  // ===========================================================================

  describe('display-ready fields (strongest_delta family)', () => {
    it('weakened by -20pp at min: strongest_delta = -0.20, abs = 0.20, pp = 20', () => {
      const baseline = probe(['a', 0.6], ['b', 0.3], ['c', 0.1]);
      const min = probe(['a', 0.5], ['b', 0.4], ['c', 0.1]); // margin 0.1 → delta -0.20
      const max = probe(['a', 0.61], ['b', 0.29], ['c', 0.1]); // ~unchanged
      const out = computeMarginSensitivity({ baseline, min, max, strictFlipDetected: false });

      expect(out.movement).toBe('weakened');
      expect(out.strongest_direction).toBe('towards_min');
      expect(out.strongest_delta).toBeCloseTo(-0.20, 10);
      expect(out.strongest_delta_abs).toBeCloseTo(0.20, 10);
      expect(out.strongest_delta_percentage_points).toBeCloseTo(20, 6);
    });

    it('strengthened by +7pp at max: strongest_delta = +0.07, pp = 7', () => {
      // baseline margin 0.10 → max margin 0.17 → delta +0.07
      const baseline = probe(['a', 0.55], ['b', 0.45]);
      const min = probe(['a', 0.55], ['b', 0.45]); // unchanged
      const max = probe(['a', 0.585], ['b', 0.415]); // margin 0.17, delta +0.07
      const out = computeMarginSensitivity({ baseline, min, max, strictFlipDetected: false });

      expect(out.movement).toBe('strengthened');
      expect(out.strongest_direction).toBe('towards_max');
      expect(out.strongest_delta).toBeCloseTo(0.07, 10);
      expect(out.strongest_delta_abs).toBeCloseTo(0.07, 10);
      expect(out.strongest_delta_percentage_points).toBeCloseTo(7, 6);
    });

    it("'both' opposite signs (min -8pp, max +6pp): strongest_delta = -0.08, pp = 8, direction = 'both'", () => {
      // baseline margin 0.15
      // min: a=0.51, b=0.44, c=0.05 → margin 0.07 → delta -0.08
      // max: a=0.58, b=0.37, c=0.05 → margin 0.21 → delta +0.06
      const baseline = probe(['a', 0.55], ['b', 0.40], ['c', 0.05]);
      const min = probe(['a', 0.51], ['b', 0.44], ['c', 0.05]);
      const max = probe(['a', 0.58], ['b', 0.37], ['c', 0.05]);
      const out = computeMarginSensitivity({ baseline, min, max, strictFlipDetected: false });

      expect(out.movement).toBe('weakened');
      expect(out.strongest_direction).toBe('both');
      expect(out.strongest_delta).toBeCloseTo(-0.08, 10);
      expect(out.strongest_delta_abs).toBeCloseTo(0.08, 10);
      expect(out.strongest_delta_percentage_points).toBeCloseTo(8, 6);
    });

    it("'none' movement: all three new delta fields null, display_value_available false", () => {
      const baseline = probe(['a', 0.6], ['b', 0.3]);
      const min = probe(['a', 0.59], ['b', 0.31]); // sub-threshold
      const max = probe(['a', 0.62], ['b', 0.29]); // sub-threshold
      const out = computeMarginSensitivity({ baseline, min, max, strictFlipDetected: false });

      expect(out.movement).toBe('none');
      expect(out.strongest_delta).toBeNull();
      expect(out.strongest_delta_abs).toBeNull();
      expect(out.strongest_delta_percentage_points).toBeNull();
      expect(out.display_value_available).toBe(false);
    });

    it("'flipped' (bound-level): strongest_delta populated from bound-level evidence", () => {
      const baseline = probe(['a', 0.55], ['b', 0.35], ['c', 0.10]);
      const min = probe(['a', 0.30], ['b', 0.60], ['c', 0.10]); // bound flip
      const max = probe(['a', 0.56], ['b', 0.34], ['c', 0.10]); // unchanged
      const out = computeMarginSensitivity({ baseline, min, max, strictFlipDetected: false });

      expect(out.movement).toBe('flipped');
      expect(out.strongest_direction).toBe('towards_min');
      // baseline margin 0.20; min margin = 0.30 - 0.60 = -0.30; delta = -0.50.
      expect(out.strongest_delta).toBeCloseTo(-0.50, 10);
      expect(out.strongest_delta_abs).toBeCloseTo(0.50, 10);
      expect(out.strongest_delta_percentage_points).toBeCloseTo(50, 6);
    });

    it("'flipped' via interior strict flip (no bound flip): strongest_delta still populated from larger-|delta| bound", () => {
      // Both bounds keep the baseline winner; the binary search caller signals
      // strictFlipDetected. Use larger-|delta| bound for strongest_delta even
      // though strongest_direction stays 'none'.
      const baseline = probe(['a', 0.55], ['b', 0.40], ['c', 0.05]); // margin 0.15
      const min = probe(['a', 0.52], ['b', 0.43], ['c', 0.05]); // margin 0.09 → delta -0.06
      const max = probe(['a', 0.50], ['b', 0.45], ['c', 0.05]); // margin 0.05 → delta -0.10
      const out = computeMarginSensitivity({ baseline, min, max, strictFlipDetected: true });

      expect(out.movement).toBe('flipped');
      expect(out.strongest_direction).toBe('none'); // not a bound-level flip
      expect(out.strongest_probe_value).toBeNull(); // not the exact flip threshold
      // Larger |delta| is max's -0.10
      expect(out.strongest_delta).toBeCloseTo(-0.10, 10);
      expect(out.strongest_delta_abs).toBeCloseTo(0.10, 10);
      expect(out.strongest_delta_percentage_points).toBeCloseTo(10, 6);
    });

    it("'flipped' preserves the diagnostic: strongest_probe_value is NOT the exact flip threshold", () => {
      // Documented invariant: flip_value (on the surrounding flip_thresholds[]
      // entry) is the exact threshold from binary search. strongest_probe_value
      // is the tested BOUND that drove margin movement, not the same thing.
      const baseline = probe(['a', 0.55], ['b', 0.35], ['c', 0.10]);
      const min = probe(['a', 0.30], ['b', 0.60], ['c', 0.10]);
      const max = probe(['a', 0.56], ['b', 0.34], ['c', 0.10]);
      const out = computeMarginSensitivity({ baseline, min, max, strictFlipDetected: false });
      // strongest_probe_value = 0 (the min bound), NOT a precise flip point.
      expect(out.strongest_probe_value).toBe(0);
    });

    it('display_value_available is false by default (helper always emits normalised)', () => {
      const baseline = probe(['a', 0.6], ['b', 0.3]);
      const min = probe(['a', 0.5], ['b', 0.4]);
      const max = probe(['a', 0.6], ['b', 0.3]);
      const out = computeMarginSensitivity({ baseline, min, max, strictFlipDetected: false });
      expect(out.value_scale).toBe('normalised');
      expect(out.display_value_available).toBe(false);
    });

    it('NaN/Infinity inputs → new fields remain finite-or-null only', () => {
      const baseline = probe(['a', 0.6], ['b', 0.3], ['c', 0.1]);
      const minBad: FlipInferenceResult = {
        options: [
          { option_id: 'a', win_probability: NaN },
          { option_id: 'b', win_probability: 0.5 },
          { option_id: 'c', win_probability: Number.POSITIVE_INFINITY },
        ],
      };
      const max = probe(['a', 0.61], ['b', 0.29], ['c', 0.1]);
      const out = computeMarginSensitivity({ baseline, min: minBad, max, strictFlipDetected: false });

      for (const v of [out.strongest_delta, out.strongest_delta_abs, out.strongest_delta_percentage_points]) {
        if (v !== null) expect(Number.isFinite(v)).toBe(true);
      }
      expect(out.display_value_available).toBe(false);
    });

    it('threshold dampening: 0.20 decimal delta → exactly 20 percentage points (no aggressive rounding)', () => {
      const baseline = probe(['a', 0.6], ['b', 0.3]);
      const min = probe(['a', 0.5], ['b', 0.4]); // delta = -0.20
      const max = probe(['a', 0.6], ['b', 0.3]);
      const out = computeMarginSensitivity({ baseline, min, max, strictFlipDetected: false });
      // Allow for the IEEE-754 floating-point representation of 0.2 * 100.
      expect(out.strongest_delta_percentage_points).toBeCloseTo(20, 9);
    });
  });
});
