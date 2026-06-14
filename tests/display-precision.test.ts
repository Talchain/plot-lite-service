/**
 * Track S — Display-precision helper (H4). Helper-only; not wired into responses.
 */

import { describe, it, expect } from 'vitest';
import {
  roundWinProbabilityForDisplay,
  formatWinProbability,
  recommendedDisplayBandPp,
  shouldSuppressPointClaim,
  WIN_PROBABILITY_DISPLAY_PRECISION_PP,
  FRAGILE_SPREAD_PP,
} from '../src/util/display-precision.js';

describe('display precision', () => {
  it('rounds to whole percentage points', () => {
    expect(WIN_PROBABILITY_DISPLAY_PRECISION_PP).toBe(1);
    expect(roundWinProbabilityForDisplay(0.842)).toBe(0.84);
    expect(roundWinProbabilityForDisplay(0.846)).toBe(0.85);
    expect(formatWinProbability(0.842)).toBe('84%');
    expect(formatWinProbability(0.5)).toBe('50%');
  });

  it('recommends a tighter band as depth increases', () => {
    expect(recommendedDisplayBandPp(1000)).toBe(7);
    expect(recommendedDisplayBandPp(2000)).toBe(5);
    expect(recommendedDisplayBandPp(4000)).toBe(3);
    expect(recommendedDisplayBandPp(8000)).toBe(2);
    // between-table depths snap to the next-lower tabulated depth (more conservative)
    expect(recommendedDisplayBandPp(3000)).toBe(5);
    expect(recommendedDisplayBandPp(500)).toBe(7);
  });

  it('suppresses point claims for fragile spreads', () => {
    expect(shouldSuppressPointClaim({ observedSpreadPp: FRAGILE_SPREAD_PP + 0.1 })).toBe(true);
    expect(shouldSuppressPointClaim({ observedSpreadPp: 2 })).toBe(false);
  });

  it('suppresses point claims when the option margin is within the depth band', () => {
    // near-tie at 1.2pp margin, 4000 samples (band 3pp) → too close to call
    expect(shouldSuppressPointClaim({ marginPp: 1.2, nSamples: 4000 })).toBe(true);
    // clear winner at 68pp margin → fine
    expect(shouldSuppressPointClaim({ marginPp: 68, nSamples: 4000 })).toBe(false);
  });
});
