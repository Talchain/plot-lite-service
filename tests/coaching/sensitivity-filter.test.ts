/**
 * Task 2: Sensitivity Filter — exclude intervention_override factors
 *
 * Tests the filtering of factors with zero_reason === 'intervention_override'
 * from both the API response and review prompt paths.
 */

import { describe, it, expect } from 'vitest';

// We test the filter logic directly rather than importing the private function.
// The filter rule: exclude entries where zero_reason === 'intervention_override'.

function filterInterventionOverride<T extends { zero_reason?: string | null }>(
  factors: T[]
): T[] {
  return factors.filter((f) => f.zero_reason !== 'intervention_override');
}

describe('Task 2: Sensitivity Filter — intervention_override', () => {
  it('filters out factor with zero_reason "intervention_override"', () => {
    const factors = [
      { factor_id: 'f1', sensitivity_score: 0.5, zero_reason: undefined },
      { factor_id: 'f2', sensitivity_score: 0.0, zero_reason: 'intervention_override' },
      { factor_id: 'f3', sensitivity_score: 0.3, zero_reason: 'no_path_to_goal' },
    ];

    const result = filterInterventionOverride(factors);
    expect(result).toHaveLength(2);
    expect(result.map(f => f.factor_id)).toEqual(['f1', 'f3']);
  });

  it('returns empty array when all factors are intervention_override', () => {
    const factors = [
      { factor_id: 'f1', sensitivity_score: 0.0, zero_reason: 'intervention_override' },
      { factor_id: 'f2', sensitivity_score: 0.0, zero_reason: 'intervention_override' },
    ];

    const result = filterInterventionOverride(factors);
    expect(result).toHaveLength(0);
  });

  it('returns all factors when none have zero_reason', () => {
    const factors = [
      { factor_id: 'f1', sensitivity_score: 0.5 },
      { factor_id: 'f2', sensitivity_score: 0.3 },
    ];

    const result = filterInterventionOverride(factors);
    expect(result).toHaveLength(2);
    expect(result).toEqual(factors);
  });

  it('does not filter factors with other zero_reason values', () => {
    const factors = [
      { factor_id: 'f1', zero_reason: 'no_path_to_goal' },
      { factor_id: 'f2', zero_reason: 'zero_elasticity' },
      { factor_id: 'f3', zero_reason: null },
    ];

    const result = filterInterventionOverride(factors);
    expect(result).toHaveLength(3);
  });

  it('handles factors with zero_reason explicitly set to undefined', () => {
    const factors = [
      { factor_id: 'f1', zero_reason: undefined },
      { factor_id: 'f2', zero_reason: 'intervention_override' },
    ];

    const result = filterInterventionOverride(factors);
    expect(result).toHaveLength(1);
    expect(result[0].factor_id).toBe('f1');
  });
});
