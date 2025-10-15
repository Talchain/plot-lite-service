import { describe, it, expect } from 'vitest';
import { calculateCalibratedConfidence } from '../src/trust/confidence-calibrated.js';

describe('Calibrated Confidence (CONFIDENCE_CALIBRATED=1)', () => {
  it('HIGH: calibration≥0.6, identifiability≥0.8, linearity≤0.2', () => {
    const result = calculateCalibratedConfidence({
      calibration: 0.7,
      identifiability: 0.85,
      linearity_distance: 0.15,
    });
    expect(result.level).toBe('HIGH');
    expect(result.score).toBeGreaterThan(0.7);
  });

  it('MEDIUM: calibration≥0.3, identifiability≥0.5', () => {
    const result = calculateCalibratedConfidence({
      calibration: 0.4,
      identifiability: 0.6,
      linearity_distance: 0.3,
    });
    expect(result.level).toBe('MEDIUM');
  });

  it('LOW: below thresholds', () => {
    const result = calculateCalibratedConfidence({
      calibration: 0.2,
      identifiability: 0.4,
      linearity_distance: 0.5,
    });
    expect(result.level).toBe('LOW');
  });

  it('deterministic: same inputs produce same hash', () => {
    const inputs = { calibration: 0.65, identifiability: 0.82, linearity_distance: 0.18 };
    const r1 = calculateCalibratedConfidence(inputs);
    const r2 = calculateCalibratedConfidence(inputs);
    expect(r1).toEqual(r2);
  });
});
