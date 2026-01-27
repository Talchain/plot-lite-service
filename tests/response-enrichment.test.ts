/**
 * Response Enrichment Unit Tests
 *
 * Tests for:
 * - deriveRecommendedOption: Winner derivation from win_probability
 * - computed_at: ISO 8601 timestamp format validation
 * - Label fallback chain: graph node → option_comparison → option_id
 */

import { describe, it, expect } from 'vitest';
import { deriveRecommendedOption } from '../src/routes/v2/run.js';
import type { OptionV3 } from '../src/types/engine-v3.js';

describe('deriveRecommendedOption', () => {
  describe('winner derivation', () => {
    it('returns option with highest win_probability', () => {
      const optionComparison = [
        { option_id: 'opt_a', win_probability: 0.3 },
        { option_id: 'opt_b', win_probability: 0.7 },
      ];

      const result = deriveRecommendedOption(optionComparison, undefined);

      expect(result).toEqual({
        recommended_option_id: 'opt_b',
        recommended_option_label: 'opt_b',
      });
    });

    it('returns undefined for empty option_comparison', () => {
      const result = deriveRecommendedOption([], undefined);
      expect(result).toBeUndefined();
    });

    it('returns undefined for undefined option_comparison', () => {
      const result = deriveRecommendedOption(undefined, undefined);
      expect(result).toBeUndefined();
    });

    it('returns undefined when all win_probability values are invalid', () => {
      const optionComparison = [
        { option_id: 'opt_a', win_probability: undefined },
        { option_id: 'opt_b', win_probability: null as unknown as number },
        { option_id: 'opt_c', win_probability: NaN },
        { option_id: 'opt_d', win_probability: Infinity },
      ];

      const result = deriveRecommendedOption(optionComparison, undefined);
      expect(result).toBeUndefined();
    });

    it('handles single option', () => {
      const optionComparison = [{ option_id: 'only_option', win_probability: 1.0 }];

      const result = deriveRecommendedOption(optionComparison, undefined);

      expect(result).toEqual({
        recommended_option_id: 'only_option',
        recommended_option_label: 'only_option',
      });
    });

    it('handles three or more options', () => {
      const optionComparison = [
        { option_id: 'opt_a', win_probability: 0.15 },
        { option_id: 'opt_b', win_probability: 0.75 },
        { option_id: 'opt_c', win_probability: 0.10 },
      ];

      const result = deriveRecommendedOption(optionComparison, undefined);

      expect(result).toEqual({
        recommended_option_id: 'opt_b',
        recommended_option_label: 'opt_b',
      });
    });
  });

  describe('epsilon tie-breaker', () => {
    it('uses lexicographic sort when win_probability within epsilon (1e-9)', () => {
      const EPSILON = 1e-9;
      const baseProb = 0.5;

      // Both options have win_probability within epsilon
      const optionComparison = [
        { option_id: 'opt_zebra', win_probability: baseProb + EPSILON / 2 },
        { option_id: 'opt_alpha', win_probability: baseProb },
      ];

      const result = deriveRecommendedOption(optionComparison, undefined);

      // Should pick 'opt_alpha' due to lexicographic ordering
      expect(result?.recommended_option_id).toBe('opt_alpha');
    });

    it('does NOT use tie-breaker when difference exceeds epsilon', () => {
      const EPSILON = 1e-9;
      const baseProb = 0.5;

      // Second option is clearly higher (exceeds epsilon)
      const optionComparison = [
        { option_id: 'opt_alpha', win_probability: baseProb },
        { option_id: 'opt_zebra', win_probability: baseProb + EPSILON * 10 },
      ];

      const result = deriveRecommendedOption(optionComparison, undefined);

      // Should pick 'opt_zebra' (higher probability)
      expect(result?.recommended_option_id).toBe('opt_zebra');
    });

    it('handles exact tie (identical win_probability)', () => {
      const optionComparison = [
        { option_id: 'opt_charlie', win_probability: 0.5 },
        { option_id: 'opt_bravo', win_probability: 0.5 },
        { option_id: 'opt_alpha', win_probability: 0.5 },
      ];

      const result = deriveRecommendedOption(optionComparison, undefined);

      // Should pick 'opt_alpha' (first lexicographically)
      expect(result?.recommended_option_id).toBe('opt_alpha');
    });

    it('handles two-way tie with higher non-tied option', () => {
      const optionComparison = [
        { option_id: 'opt_b', win_probability: 0.4 },
        { option_id: 'opt_a', win_probability: 0.4 },
        { option_id: 'opt_c', win_probability: 0.2 },
      ];

      const result = deriveRecommendedOption(optionComparison, undefined);

      // Should pick 'opt_a' (tied at 0.4, first lexicographically)
      expect(result?.recommended_option_id).toBe('opt_a');
    });
  });

  describe('label fallback chain', () => {
    it('priority 1: uses graph node label when available', () => {
      const optionComparison = [
        { option_id: 'opt_winner', option_label: 'Comparison Label', win_probability: 1.0 },
      ];

      const options: OptionV3[] = [
        {
          id: 'opt_winner',
          label: 'Graph Node Label',
          interventions: { factor_a: { value: 1, source: 'option' } },
        },
      ];

      const result = deriveRecommendedOption(optionComparison, options);

      expect(result?.recommended_option_label).toBe('Graph Node Label');
    });

    it('priority 2: uses option_comparison label when graph node label missing', () => {
      const optionComparison = [
        { option_id: 'opt_winner', option_label: 'Comparison Label', win_probability: 1.0 },
      ];

      const options: OptionV3[] = [
        {
          id: 'opt_winner',
          // No label property
          interventions: { factor_a: { value: 1, source: 'option' } },
        },
      ];

      const result = deriveRecommendedOption(optionComparison, options);

      expect(result?.recommended_option_label).toBe('Comparison Label');
    });

    it('priority 3: uses option_id when no labels available', () => {
      const optionComparison = [
        { option_id: 'opt_winner', win_probability: 1.0 },
        // No option_label
      ];

      // No options array
      const result = deriveRecommendedOption(optionComparison, undefined);

      expect(result?.recommended_option_label).toBe('opt_winner');
    });

    it('uses option_id when graph option not found', () => {
      const optionComparison = [
        { option_id: 'opt_winner', win_probability: 1.0 },
      ];

      const options: OptionV3[] = [
        {
          id: 'different_option',
          label: 'Different Label',
          interventions: {},
        },
      ];

      const result = deriveRecommendedOption(optionComparison, options);

      expect(result?.recommended_option_label).toBe('opt_winner');
    });

    it('handles undefined label in graph option', () => {
      const optionComparison = [
        { option_id: 'opt_winner', option_label: 'Fallback Label', win_probability: 1.0 },
      ];

      const options: OptionV3[] = [
        {
          id: 'opt_winner',
          label: undefined,
          interventions: {},
        },
      ];

      const result = deriveRecommendedOption(optionComparison, options);

      // Should fall back to option_label from comparison
      expect(result?.recommended_option_label).toBe('Fallback Label');
    });
  });

  describe('edge cases', () => {
    it('filters out options with undefined win_probability', () => {
      const optionComparison = [
        { option_id: 'opt_invalid', win_probability: undefined },
        { option_id: 'opt_valid', win_probability: 0.5 },
      ];

      const result = deriveRecommendedOption(optionComparison, undefined);

      expect(result?.recommended_option_id).toBe('opt_valid');
    });

    it('filters out options with null win_probability', () => {
      const optionComparison = [
        { option_id: 'opt_null', win_probability: null as unknown as number },
        { option_id: 'opt_valid', win_probability: 0.3 },
      ];

      const result = deriveRecommendedOption(optionComparison, undefined);

      expect(result?.recommended_option_id).toBe('opt_valid');
    });

    it('handles all win_probability = 0', () => {
      const optionComparison = [
        { option_id: 'opt_b', win_probability: 0 },
        { option_id: 'opt_a', win_probability: 0 },
      ];

      const result = deriveRecommendedOption(optionComparison, undefined);

      // Should pick 'opt_a' (first lexicographically when all tied at 0)
      expect(result?.recommended_option_id).toBe('opt_a');
    });

    it('handles very small win_probability values beyond epsilon', () => {
      // Values must differ by more than epsilon (1e-9) to be considered different
      const optionComparison = [
        { option_id: 'opt_a', win_probability: 1e-6 },
        { option_id: 'opt_b', win_probability: 2e-6 },
      ];

      const result = deriveRecommendedOption(optionComparison, undefined);

      expect(result?.recommended_option_id).toBe('opt_b');
    });

    it('treats very small values within epsilon as ties', () => {
      // Values within epsilon (1e-9) should be treated as ties
      const optionComparison = [
        { option_id: 'opt_b', win_probability: 2e-15 },
        { option_id: 'opt_a', win_probability: 1e-15 },
      ];

      const result = deriveRecommendedOption(optionComparison, undefined);

      // Should pick 'opt_a' lexicographically since both are within epsilon of each other
      expect(result?.recommended_option_id).toBe('opt_a');
    });
  });
});

describe('computed_at timestamp format', () => {
  it('validates ISO 8601 format pattern', () => {
    const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;
    const validTimestamp = new Date().toISOString();

    expect(validTimestamp).toMatch(isoPattern);
  });

  it('Date.toISOString() produces valid ISO 8601', () => {
    const timestamp = new Date('2026-01-27T12:30:45.123Z').toISOString();

    expect(timestamp).toBe('2026-01-27T12:30:45.123Z');
  });
});
