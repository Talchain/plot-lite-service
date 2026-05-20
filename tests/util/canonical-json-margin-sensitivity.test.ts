/**
 * Hash-stability invariant for additive margin-sensitivity diagnostic.
 *
 * Adding `flip_thresholds_margin_status`, `flip_thresholds_margin_coverage`,
 * or per-entry `flip_thresholds[].margin_sensitivity` MUST NOT change a
 * report's `sha256Stable()` hash. They are diagnostic-only and stripped
 * inside `normaliseReport()`.
 */

import { describe, it, expect } from 'vitest';
import { sha256Stable, normaliseReport } from '../../src/util/canonical-json.js';

function baseReport() {
  return {
    schema_version: '3.0.0',
    meta: { seed: 42 },
    model_card: { name: 'plot' },
    flip_thresholds: [
      {
        factor_id: 'f1',
        factor_label: 'Factor One',
        current_value: 0.5,
        flip_value: null,
        direction: 'decrease' as const,
        flip_reason: 'no_effect_within_bounds',
        iterations_used: 0,
        alternative_winner_id: null,
        alternative_winner_label: null,
      },
    ],
    flip_thresholds_status: 'all_no_effect' as const,
  };
}

function reportWithMargin() {
  const r = baseReport();
  return {
    ...r,
    flip_thresholds: [
      {
        ...r.flip_thresholds[0],
        margin_sensitivity: {
          movement: 'weakened',
          threshold: 0.05,
          baseline_leading_option_id: 'a',
          baseline_runner_up_option_id: 'b',
          baseline_margin: 0.3,
          min_probe_margin: 0.1,
          max_probe_margin: 0.32,
          min_probe_delta: -0.2,
          max_probe_delta: 0.02,
          strongest_direction: 'towards_min',
          strongest_probe_value: 0,
          value_scale: 'normalised',
          // Display-ready fields — also must be excluded from response_hash.
          strongest_delta: -0.2,
          strongest_delta_abs: 0.2,
          strongest_delta_percentage_points: 20,
          display_value_available: false,
        },
      },
    ],
    flip_thresholds_margin_status: 'computed',
    flip_thresholds_margin_coverage: { total: 1, with_margin: 1, without_margin: 0 },
  };
}

describe('canonical-json: margin-sensitivity hash exclusion', () => {
  it('sha256Stable is identical with and without the additive diagnostic fields', () => {
    const hashWithout = sha256Stable(baseReport());
    const hashWith = sha256Stable(reportWithMargin());
    expect(hashWith).toBe(hashWithout);
  });

  it('normaliseReport strips top-level flip_thresholds_margin_status', () => {
    const out = normaliseReport(reportWithMargin()) as Record<string, unknown>;
    expect(out.flip_thresholds_margin_status).toBeUndefined();
  });

  it('normaliseReport strips top-level flip_thresholds_margin_coverage', () => {
    const out = normaliseReport(reportWithMargin()) as Record<string, unknown>;
    expect(out.flip_thresholds_margin_coverage).toBeUndefined();
  });

  it('normaliseReport strips per-entry margin_sensitivity', () => {
    const out = normaliseReport(reportWithMargin()) as Record<string, unknown>;
    const arr = out.flip_thresholds as Array<Record<string, unknown>>;
    expect(arr).toHaveLength(1);
    expect(arr[0].margin_sensitivity).toBeUndefined();
  });

  it('normaliseReport preserves non-margin entry fields', () => {
    const out = normaliseReport(reportWithMargin()) as Record<string, unknown>;
    const arr = out.flip_thresholds as Array<Record<string, unknown>>;
    expect(arr[0].factor_id).toBe('f1');
    expect(arr[0].flip_reason).toBe('no_effect_within_bounds');
  });
});
