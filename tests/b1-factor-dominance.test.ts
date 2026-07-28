/**
 * B1 — Factor dominance detection tests.
 * Thresholds ported from UI useResultsSectionData.ts:1601, UNCHANGED by S1b:
 *   influence_score > 0.5 AND ratio vs. the strongest rival > 2:1
 *
 * ⭐ Family-4 S1b changed the CANDIDATE, not the gates: `factors[0]` (rank 1 of
 * the canonical driver order) is the only crownable row. See
 * `tests/driver-surface-projection.unit.test.ts` for the F-D3 leg that proves
 * the lever can no longer be crowned.
 */

import { describe, it, expect } from 'vitest';
import { detectDominantFactor } from '../src/trust/factor-dominance.js';

describe('detectDominantFactor', () => {
  it('detects dominance when top driver >0.5 and ratio >2:1', () => {
    const result = detectDominantFactor([
      { factor_id: 'fac_price', factor_label: 'Price', influence_score: 0.6 },
      { factor_id: 'fac_quality', factor_label: 'Quality', influence_score: 0.2 },
    ]);
    expect(result).toEqual({ factor_id: 'fac_price', factor_label: 'Price' });
  });

  it('returns undefined when ratio ≤ 2:1', () => {
    const result = detectDominantFactor([
      { factor_id: 'fac_price', factor_label: 'Price', influence_score: 0.6 },
      { factor_id: 'fac_quality', factor_label: 'Quality', influence_score: 0.4 },
    ]);
    expect(result).toBeUndefined();
  });

  it('returns undefined when top influence ≤ 0.5', () => {
    const result = detectDominantFactor([
      { factor_id: 'fac_price', factor_label: 'Price', influence_score: 0.4 },
      { factor_id: 'fac_quality', factor_label: 'Quality', influence_score: 0.1 },
    ]);
    expect(result).toBeUndefined();
  });

  it('detects dominance with single non-zero factor', () => {
    const result = detectDominantFactor([
      { factor_id: 'fac_price', factor_label: 'Price', influence_score: 0.8 },
    ]);
    expect(result).toEqual({ factor_id: 'fac_price', factor_label: 'Price' });
  });

  it('returns undefined with no drivers', () => {
    expect(detectDominantFactor([])).toBeUndefined();
    expect(detectDominantFactor(undefined)).toBeUndefined();
  });

  it('returns undefined when single factor influence ≤ 0.5', () => {
    const result = detectDominantFactor([
      { factor_id: 'fac_price', factor_label: 'Price', influence_score: 0.3 },
    ]);
    expect(result).toBeUndefined();
  });

  it('falls back to factor_id when factor_label missing', () => {
    const result = detectDominantFactor([
      { factor_id: 'fac_price', influence_score: 0.8 },
      { factor_id: 'fac_quality', influence_score: 0.1 },
    ]);
    expect(result).toEqual({ factor_id: 'fac_price', factor_label: 'fac_price' });
  });

  /**
   * ⭐ PIN FLIPPED — this asserted *"handles unsorted input correctly"*, i.e.
   * that the function re-sorted its input and crowned the influence argmax
   * wherever it sat. That internal sort WAS the defect: it made this a sixth
   * independent argmax, lever-blind, one number away from crowning a
   * producer-zeroed lever (family-4 design §4.3 F-D3).
   *
   * The candidate is now `factors[0]` — `driver_order.ranked_factor_ids[0]` by
   * Rule S3 — so input order is LOAD-BEARING and the old behaviour is exactly
   * what must not happen.
   */
  it('input order is LOAD-BEARING: only rank 1 of the canonical order is crownable', () => {
    // `fac_price` has the larger influence but is NOT rank 1. Under the old
    // internal sort it was crowned; it must not be now.
    const result = detectDominantFactor([
      { factor_id: 'fac_quality', factor_label: 'Quality', influence_score: 0.1 },
      { factor_id: 'fac_price', factor_label: 'Price', influence_score: 0.7 },
    ]);
    expect(result).toBeUndefined();

    // …and the SAME two rows, with the canonical order supplied, still crown
    // correctly — so this is a projection, not a suppression.
    expect(
      detectDominantFactor([
        { factor_id: 'fac_price', factor_label: 'Price', influence_score: 0.7 },
        { factor_id: 'fac_quality', factor_label: 'Quality', influence_score: 0.1 },
      ]),
    ).toEqual({ factor_id: 'fac_price', factor_label: 'Price' });
  });

  it('ignores zero-influence factors for ratio check', () => {
    const result = detectDominantFactor([
      { factor_id: 'fac_price', factor_label: 'Price', influence_score: 0.6 },
      { factor_id: 'fac_quality', factor_label: 'Quality', influence_score: 0 },
      { factor_id: 'fac_speed', factor_label: 'Speed', influence_score: 0 },
    ]);
    // Only one non-zero factor → dominant
    expect(result).toEqual({ factor_id: 'fac_price', factor_label: 'Price' });
  });

  // Boundary: exactly 0.5 influence → not dominant (> 0.5, not >=)
  it('boundary: influence exactly 0.5 → not dominant', () => {
    const result = detectDominantFactor([
      { factor_id: 'fac_price', factor_label: 'Price', influence_score: 0.5 },
      { factor_id: 'fac_quality', factor_label: 'Quality', influence_score: 0.1 },
    ]);
    expect(result).toBeUndefined();
  });

  // Boundary: ratio exactly 2:1 → not dominant (> 2, not >=)
  it('boundary: ratio exactly 2:1 → not dominant', () => {
    const result = detectDominantFactor([
      { factor_id: 'fac_price', factor_label: 'Price', influence_score: 0.6 },
      { factor_id: 'fac_quality', factor_label: 'Quality', influence_score: 0.3 },
    ]);
    expect(result).toBeUndefined();
  });
});
