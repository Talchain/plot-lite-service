/**
 * Task 2: Sensitivity Filter — exclude intervention_override factors
 *
 * Tests the production filter utility (filterInterventionOverrides) used by both:
 * - transformFactorSensitivity (API response assembly in routes/v2/run.ts)
 * - extractFactorSensitivity (CEE review prompt input in decision-review-request.ts)
 */

import { describe, it, expect } from 'vitest';
import { filterInterventionOverrides } from '../../src/coaching/sensitivity-filter.js';

// =============================================================================
// filterInterventionOverrides — shared production filter
// =============================================================================

describe('filterInterventionOverrides', () => {
  it('filters out factor with zero_reason "intervention_override"', () => {
    const factors = [
      { factor_id: 'f1', sensitivity_score: 0.5, zero_reason: undefined },
      { factor_id: 'f2', sensitivity_score: 0.0, zero_reason: 'intervention_override' },
      { factor_id: 'f3', sensitivity_score: 0.3, zero_reason: 'no_path_to_goal' },
    ];

    const result = filterInterventionOverrides(factors);
    expect(result).toHaveLength(2);
    expect(result.map(f => f.factor_id)).toEqual(['f1', 'f3']);
  });

  it('returns empty array when all factors are intervention_override', () => {
    const factors = [
      { factor_id: 'f1', sensitivity_score: 0.0, zero_reason: 'intervention_override' },
      { factor_id: 'f2', sensitivity_score: 0.0, zero_reason: 'intervention_override' },
    ];

    const result = filterInterventionOverrides(factors);
    expect(result).toHaveLength(0);
  });

  it('returns all factors when none have zero_reason', () => {
    const factors = [
      { factor_id: 'f1', sensitivity_score: 0.5 },
      { factor_id: 'f2', sensitivity_score: 0.3 },
    ];

    const result = filterInterventionOverrides(factors);
    expect(result).toHaveLength(2);
    expect(result).toEqual(factors);
  });

  it('does not filter factors with other zero_reason values', () => {
    const factors = [
      { factor_id: 'f1', zero_reason: 'no_path_to_goal' },
      { factor_id: 'f2', zero_reason: 'zero_elasticity' },
      { factor_id: 'f3', zero_reason: null },
    ];

    const result = filterInterventionOverrides(factors);
    expect(result).toHaveLength(3);
  });

  it('handles factors with zero_reason explicitly set to undefined', () => {
    const factors = [
      { factor_id: 'f1', zero_reason: undefined },
      { factor_id: 'f2', zero_reason: 'intervention_override' },
    ];

    const result = filterInterventionOverrides(factors);
    expect(result).toHaveLength(1);
    expect(result[0].factor_id).toBe('f1');
  });

  it('handles empty array', () => {
    const result = filterInterventionOverrides([]);
    expect(result).toHaveLength(0);
  });

  // Simulate the shapes used by both production call sites
  it('works with ISL factor_sensitivity shape (run.ts path)', () => {
    const islFactors = [
      { node_id: 'f1', sensitivity_score: 0.5, elasticity: 0.3, direction: 'positive', zero_reason: null },
      { node_id: 'f2', sensitivity_score: 0.0, elasticity: 0, direction: 'positive', zero_reason: 'intervention_override' },
      { node_id: 'f3', sensitivity_score: 0.2, elasticity: -0.1, direction: 'negative' },
    ];

    const result = filterInterventionOverrides(islFactors);
    expect(result).toHaveLength(2);
    expect(result.map(f => f.node_id)).toEqual(['f1', 'f3']);
  });

  it('works with ISLResultInput factor_sensitivity shape (decision-review-request.ts path)', () => {
    const factors = [
      { factor_id: 'f1', factor_label: 'Cost', elasticity: 0.5, confidence: 0.8 },
      { factor_id: 'f2', factor_label: 'Speed', elasticity: 0.0, confidence: 0.5, zero_reason: 'intervention_override' },
    ];

    const result = filterInterventionOverrides(factors);
    expect(result).toHaveLength(1);
    expect(result[0].factor_id).toBe('f1');
  });
});
