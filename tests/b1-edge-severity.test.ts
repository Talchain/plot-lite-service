/**
 * B1 — Fragile edge severity classification tests.
 * Thresholds ported from UI useResultsSectionData.ts:
 *   switch_probability > 0.7 → 'critical'
 *   switch_probability > 0.5 → 'error'
 *   switch_probability ≤ 0.5 → 'warning'
 */

import { describe, it, expect } from 'vitest';
import { classifyEdgeSeverity } from '../src/trust/edge-severity.js';

describe('classifyEdgeSeverity', () => {
  it('returns critical when switch_probability > 0.7', () => {
    expect(classifyEdgeSeverity(0.8)).toBe('critical');
    expect(classifyEdgeSeverity(0.95)).toBe('critical');
    expect(classifyEdgeSeverity(1.0)).toBe('critical');
  });

  it('returns error when switch_probability > 0.5 and ≤ 0.7', () => {
    expect(classifyEdgeSeverity(0.6)).toBe('error');
    expect(classifyEdgeSeverity(0.65)).toBe('error');
  });

  it('returns warning when switch_probability ≤ 0.5', () => {
    expect(classifyEdgeSeverity(0.4)).toBe('warning');
    expect(classifyEdgeSeverity(0.3)).toBe('warning');
    expect(classifyEdgeSeverity(0.0)).toBe('warning');
  });

  // Boundary tests
  it('boundary: 0.71 → critical', () => {
    expect(classifyEdgeSeverity(0.71)).toBe('critical');
  });

  it('boundary: 0.7 → error (> 0.7, not ≥)', () => {
    expect(classifyEdgeSeverity(0.7)).toBe('error');
  });

  it('boundary: 0.51 → error', () => {
    expect(classifyEdgeSeverity(0.51)).toBe('error');
  });

  it('boundary: 0.5 → warning (> 0.5, not ≥)', () => {
    expect(classifyEdgeSeverity(0.5)).toBe('warning');
  });

  // Absent / non-finite → undefined (field omitted, not fabricated 'warning').
  // Mirrors deriveFragileEdgeVisible: absent ≠ a real low measurement.
  it('absent / non-finite switch_probability → undefined (severity omitted)', () => {
    expect(classifyEdgeSeverity(undefined)).toBeUndefined();
    expect(classifyEdgeSeverity(null)).toBeUndefined();
    expect(classifyEdgeSeverity(NaN)).toBeUndefined();
    expect(classifyEdgeSeverity(Infinity)).toBeUndefined();
    expect(classifyEdgeSeverity(-Infinity)).toBeUndefined();
  });
});

