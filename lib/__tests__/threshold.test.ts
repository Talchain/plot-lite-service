import { describe, it, expect } from 'vitest';
import { computeThresholdCrossings } from '../threshold';

describe('computeThresholdCrossings', () => {
  it('detects upward 99 → 114 crossing at 99', () => {
    const out = computeThresholdCrossings('n_dec', 99, 114);
    expect(out.some(o => o.threshold === 99)).toBe(true);
  });

  it('no crossing for 101 → 103', () => {
    const out = computeThresholdCrossings('n_dec', 101, 103);
    expect(out.length).toBe(0);
  });

  it('detects downward 114 → 99 crossing at 99', () => {
    const out = computeThresholdCrossings('n_dec', 114, 99);
    expect(out.some(o => o.threshold === 99)).toBe(true);
  });
});