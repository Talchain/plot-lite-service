import { describe, it, expect } from 'vitest';
import { computeAdaptiveK, determineK, validateK } from '../src/kernel/adaptive-k.js';

describe('Adaptive K (recovered)', () => {
  it('computes K from graph size', () => {
    const result = computeAdaptiveK(3, 2); // 3 nodes, 2 edges
    expect(result.k_samples).toBe(250 + 25*2 + 10*3); // 330
    expect(result.clamped).toBe(false);
  });

  it('clamps to minimum', () => {
    const result = computeAdaptiveK(0, 0); // empty graph
    expect(result.k_samples).toBe(250);
    expect(result.clamped).toBe(false);
  });

  it('clamps to maximum', () => {
    const result = computeAdaptiveK(100, 100); // huge graph
    expect(result.k_samples).toBe(1000);
    expect(result.clamped).toBe(true);
  });

  it('respects user override', () => {
    const result = determineK(10, 10, 500);
    expect(result.k_samples).toBe(500);
    expect(result.reason).toContain('User-specified');
  });

  it('validates K bounds', () => {
    expect(validateK(500).valid).toBe(true);
    expect(validateK(100).valid).toBe(false);
    expect(validateK(2000).valid).toBe(false);
  });
});
