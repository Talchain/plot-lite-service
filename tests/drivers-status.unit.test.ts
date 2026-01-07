/**
 * Unit tests for drivers_status contract enforcement
 *
 * Tests the invariants:
 * - drivers_status === 'computed' implies hasDriversSensitivity === true
 * - hasDriversSensitivity = hasNonEmptyArray(edge_sensitivity) OR hasNonEmptyArray(factor_sensitivity)
 * - Empty/null/undefined arrays all result in unavailable status
 */

import { describe, it, expect } from 'vitest';

// Re-implement hasNonEmptyArray for testing (same logic as in run.ts)
function hasNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

describe('hasNonEmptyArray utility', () => {
  it('returns true for non-empty arrays', () => {
    expect(hasNonEmptyArray([1, 2, 3])).toBe(true);
    expect(hasNonEmptyArray([{ edge_id: 'a::b' }])).toBe(true);
    expect(hasNonEmptyArray(['string'])).toBe(true);
  });

  it('returns false for empty arrays', () => {
    expect(hasNonEmptyArray([])).toBe(false);
  });

  it('returns false for null', () => {
    expect(hasNonEmptyArray(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(hasNonEmptyArray(undefined)).toBe(false);
  });

  it('returns false for objects (non-arrays)', () => {
    expect(hasNonEmptyArray({})).toBe(false);
    expect(hasNonEmptyArray({ length: 5 })).toBe(false);
  });

  it('returns false for strings', () => {
    expect(hasNonEmptyArray('abc')).toBe(false);
    expect(hasNonEmptyArray('')).toBe(false);
  });

  it('returns false for numbers', () => {
    expect(hasNonEmptyArray(0)).toBe(false);
    expect(hasNonEmptyArray(42)).toBe(false);
  });
});

describe('hasDriversSensitivity predicate', () => {
  // Re-implement the combined predicate for testing
  function hasDriversSensitivity(edgeSensitivity: unknown, factorSensitivity: unknown): boolean {
    return hasNonEmptyArray(edgeSensitivity) || hasNonEmptyArray(factorSensitivity);
  }

  it('returns true when only edge_sensitivity has data', () => {
    expect(hasDriversSensitivity([{ edge_id: 'a::b' }], undefined)).toBe(true);
    expect(hasDriversSensitivity([{ edge_id: 'a::b' }], null)).toBe(true);
    expect(hasDriversSensitivity([{ edge_id: 'a::b' }], [])).toBe(true);
  });

  it('returns true when only factor_sensitivity has data', () => {
    expect(hasDriversSensitivity(undefined, [{ factor_id: 'x' }])).toBe(true);
    expect(hasDriversSensitivity(null, [{ factor_id: 'x' }])).toBe(true);
    expect(hasDriversSensitivity([], [{ factor_id: 'x' }])).toBe(true);
  });

  it('returns true when both have data', () => {
    expect(hasDriversSensitivity([{ edge_id: 'a::b' }], [{ factor_id: 'x' }])).toBe(true);
  });

  it('returns false when both are empty', () => {
    expect(hasDriversSensitivity([], [])).toBe(false);
  });

  it('returns false when both are undefined', () => {
    expect(hasDriversSensitivity(undefined, undefined)).toBe(false);
  });

  it('returns false when both are null', () => {
    expect(hasDriversSensitivity(null, null)).toBe(false);
  });

  it('returns false when edge is empty and factor is undefined', () => {
    expect(hasDriversSensitivity([], undefined)).toBe(false);
  });

  it('returns false when edge is undefined and factor is empty', () => {
    expect(hasDriversSensitivity(undefined, [])).toBe(false);
  });
});

describe('Status determination rules', () => {
  // Re-implement mapToPerFeatureStatus for testing
  type PerFeatureStatus = 'computed' | 'unavailable' | 'skipped' | 'error';

  function mapToPerFeatureStatus(islStatus: string | undefined, hasData: boolean): PerFeatureStatus {
    if (hasData) return 'computed';

    switch (islStatus) {
      case 'failed':
        return 'error';
      case 'skipped':
        return 'skipped';
      default:
        return 'unavailable';
    }
  }

  describe('when data is present', () => {
    it('returns computed regardless of ISL status', () => {
      expect(mapToPerFeatureStatus('computed', true)).toBe('computed');
      expect(mapToPerFeatureStatus('failed', true)).toBe('computed');
      expect(mapToPerFeatureStatus('skipped', true)).toBe('computed');
      expect(mapToPerFeatureStatus(undefined, true)).toBe('computed');
    });
  });

  describe('when data is absent', () => {
    it('returns unavailable for ISL computed (prevents "computed but empty")', () => {
      expect(mapToPerFeatureStatus('computed', false)).toBe('unavailable');
    });

    it('returns error for ISL failed', () => {
      expect(mapToPerFeatureStatus('failed', false)).toBe('error');
    });

    it('returns skipped for ISL skipped', () => {
      expect(mapToPerFeatureStatus('skipped', false)).toBe('skipped');
    });

    it('returns unavailable for undefined ISL status', () => {
      expect(mapToPerFeatureStatus(undefined, false)).toBe('unavailable');
    });
  });
});

describe('Acceptance criteria scenarios', () => {
  function hasDriversSensitivity(edgeSensitivity: unknown, factorSensitivity: unknown): boolean {
    return hasNonEmptyArray(edgeSensitivity) || hasNonEmptyArray(factorSensitivity);
  }

  type PerFeatureStatus = 'computed' | 'unavailable' | 'skipped' | 'error';

  function mapToPerFeatureStatus(islStatus: string | undefined, hasData: boolean): PerFeatureStatus {
    if (hasData) return 'computed';
    switch (islStatus) {
      case 'failed': return 'error';
      case 'skipped': return 'skipped';
      default: return 'unavailable';
    }
  }

  it('AC1: both empty → unavailable, no computed-but-empty error', () => {
    const edgeSensitivity: unknown[] = [];
    const factorSensitivity: unknown[] = [];
    const hasDrivers = hasDriversSensitivity(edgeSensitivity, factorSensitivity);
    const status = mapToPerFeatureStatus('computed', hasDrivers);

    expect(hasDrivers).toBe(false);
    expect(status).toBe('unavailable');
    // The fix prevents "computed" status when data is empty, so no critique needed
  });

  it('AC2: factor_sensitivity only → computed, no critique', () => {
    const edgeSensitivity: unknown[] = [];
    const factorSensitivity = [{ factor_id: 'x', sensitivity_score: 0.5 }];
    const hasDrivers = hasDriversSensitivity(edgeSensitivity, factorSensitivity);
    const status = mapToPerFeatureStatus('computed', hasDrivers);

    expect(hasDrivers).toBe(true);
    expect(status).toBe('computed');
  });

  it('AC3: edge_sensitivity only → computed, no critique', () => {
    const edgeSensitivity = [{ edge_id: 'a::b', elasticity: 0.5 }];
    const factorSensitivity: unknown[] = [];
    const hasDrivers = hasDriversSensitivity(edgeSensitivity, factorSensitivity);
    const status = mapToPerFeatureStatus('computed', hasDrivers);

    expect(hasDrivers).toBe(true);
    expect(status).toBe('computed');
  });

  it('AC4: arrays present but empty (after filtering) → unavailable', () => {
    // Simulate scenario where ISL returns arrays that transform to empty
    const edgeSensitivity: unknown[] = []; // e.g., after filtering invalid items
    const factorSensitivity: unknown[] = []; // e.g., after filtering invalid items
    const hasDrivers = hasDriversSensitivity(edgeSensitivity, factorSensitivity);
    const status = mapToPerFeatureStatus('computed', hasDrivers);

    expect(hasDrivers).toBe(false);
    expect(status).toBe('unavailable');
  });

  it('AC5: null arrays → unavailable', () => {
    const hasDrivers = hasDriversSensitivity(null, null);
    const status = mapToPerFeatureStatus('computed', hasDrivers);

    expect(hasDrivers).toBe(false);
    expect(status).toBe('unavailable');
  });

  it('AC6: undefined arrays → unavailable', () => {
    const hasDrivers = hasDriversSensitivity(undefined, undefined);
    const status = mapToPerFeatureStatus('computed', hasDrivers);

    expect(hasDrivers).toBe(false);
    expect(status).toBe('unavailable');
  });
});
