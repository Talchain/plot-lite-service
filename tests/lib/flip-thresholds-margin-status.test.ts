/**
 * Tests for the aggregate margin-status classifier and coverage counter.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyFlipThresholdsMarginStatus,
  computeFlipThresholdsMarginCoverage,
} from '../../src/lib/flip-thresholds-margin-status.js';
import type { DenormalisedFlipThreshold } from '../../src/lib/flip-threshold-denormaliser.js';
import type { MarginSensitivity } from '../../src/analysis/margin-sensitivity.js';

function ms(movement: MarginSensitivity['movement']): MarginSensitivity {
  return {
    movement,
    threshold: 0.05,
    baseline_leading_option_id: 'a',
    baseline_runner_up_option_id: 'b',
    baseline_margin: 0.3,
    min_probe_margin: 0.2,
    max_probe_margin: 0.4,
    min_probe_delta: -0.1,
    max_probe_delta: 0.1,
    strongest_direction: movement === 'none' ? 'none' : 'towards_min',
    strongest_probe_value: movement === 'none' ? null : 0,
    value_scale: 'normalised',
  };
}

function entry(overrides: Partial<DenormalisedFlipThreshold> = {}): DenormalisedFlipThreshold {
  return {
    factor_id: 'f1',
    factor_label: 'Factor One',
    current_value: 0.5,
    flip_value: null,
    direction: 'decrease',
    flip_reason: 'no_effect_within_bounds',
    iterations_used: 0,
    alternative_winner_id: null,
    alternative_winner_label: null,
    unit: undefined,
    margin_sensitivity: ms('none'),
    ...overrides,
  };
}

describe('classifyFlipThresholdsMarginStatus()', () => {
  it("returns 'unavailable' for null / undefined / empty array", () => {
    expect(classifyFlipThresholdsMarginStatus(null).status).toBe('unavailable');
    expect(classifyFlipThresholdsMarginStatus(undefined).status).toBe('unavailable');
    expect(classifyFlipThresholdsMarginStatus([]).status).toBe('unavailable');
  });

  it("returns 'unavailable' when no entry carries margin_sensitivity", () => {
    const entries = [
      entry({ margin_sensitivity: undefined }),
      entry({ factor_id: 'f2', margin_sensitivity: undefined }),
    ];
    expect(classifyFlipThresholdsMarginStatus(entries).status).toBe('unavailable');
  });

  it("returns 'computed' when every entry-with-margin has non-none movement", () => {
    const entries = [
      entry({ margin_sensitivity: ms('flipped') }),
      entry({ factor_id: 'f2', margin_sensitivity: ms('weakened') }),
      entry({ factor_id: 'f3', margin_sensitivity: ms('strengthened') }),
    ];
    expect(classifyFlipThresholdsMarginStatus(entries).status).toBe('computed');
  });

  it("returns 'all_none' when every entry-with-margin has movement === 'none'", () => {
    const entries = [
      entry({ margin_sensitivity: ms('none') }),
      entry({ factor_id: 'f2', margin_sensitivity: ms('none') }),
    ];
    expect(classifyFlipThresholdsMarginStatus(entries).status).toBe('all_none');
  });

  it("returns 'partial_movement' on a mix of none and non-none movement", () => {
    const entries = [
      entry({ margin_sensitivity: ms('weakened') }),
      entry({ factor_id: 'f2', margin_sensitivity: ms('none') }),
    ];
    expect(classifyFlipThresholdsMarginStatus(entries).status).toBe('partial_movement');
  });

  it('ignores entries that lack margin_sensitivity (does not count them as none)', () => {
    const entries = [
      entry({ margin_sensitivity: ms('weakened') }),
      entry({ factor_id: 'f2', margin_sensitivity: undefined }),
    ];
    // Only one classified entry, with movement → 'computed', not 'partial_movement'.
    expect(classifyFlipThresholdsMarginStatus(entries).status).toBe('computed');
  });

  it("returns 'all_none' even when some entries lack margin_sensitivity, as long as those that have it are all 'none'", () => {
    const entries = [
      entry({ margin_sensitivity: ms('none') }),
      entry({ factor_id: 'f2', margin_sensitivity: undefined }),
    ];
    expect(classifyFlipThresholdsMarginStatus(entries).status).toBe('all_none');
  });
});

describe('computeFlipThresholdsMarginCoverage()', () => {
  it('returns zeros for null / undefined', () => {
    expect(computeFlipThresholdsMarginCoverage(null)).toEqual({ total: 0, with_margin: 0, without_margin: 0 });
    expect(computeFlipThresholdsMarginCoverage(undefined)).toEqual({ total: 0, with_margin: 0, without_margin: 0 });
  });

  it('returns zeros for empty array', () => {
    expect(computeFlipThresholdsMarginCoverage([])).toEqual({ total: 0, with_margin: 0, without_margin: 0 });
  });

  it('counts entries with and without margin_sensitivity', () => {
    const entries = [
      entry({ margin_sensitivity: ms('weakened') }),
      entry({ factor_id: 'f2', margin_sensitivity: undefined }),
      entry({ factor_id: 'f3', margin_sensitivity: ms('none') }),
    ];
    expect(computeFlipThresholdsMarginCoverage(entries)).toEqual({
      total: 3,
      with_margin: 2,
      without_margin: 1,
    });
  });
});
