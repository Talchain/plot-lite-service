/**
 * B1 — Factor dominance detection tests.
 * Thresholds ported from UI useResultsSectionData.ts:1601:
 *   influence_score > 0.5 AND ratio vs. second factor > 2:1
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

  it('handles unsorted input correctly', () => {
    const result = detectDominantFactor([
      { factor_id: 'fac_quality', factor_label: 'Quality', influence_score: 0.1 },
      { factor_id: 'fac_price', factor_label: 'Price', influence_score: 0.7 },
    ]);
    expect(result).toEqual({ factor_id: 'fac_price', factor_label: 'Price' });
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
