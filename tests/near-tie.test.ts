/**
 * Near-Tie Detection Tests
 *
 * Tests for near-tie detection between top options based on win_probability gap.
 * Threshold: 10% (NEAR_TIE_THRESHOLD = 0.10)
 *
 * Note: This is a UX threshold distinct from close_race_threshold (2%).
 */

import { describe, it, expect } from 'vitest';
import { computeNearTie } from '../src/routes/v2/run.js';
import { NEAR_TIE_THRESHOLD } from '../src/trust/result-coherence.js';

describe('Near-Tie Detection', () => {
  describe('Threshold constant', () => {
    it('NEAR_TIE_THRESHOLD is 0.10', () => {
      expect(NEAR_TIE_THRESHOLD).toBe(0.10);
    });
  });

  describe('computeNearTie function', () => {
    it('returns undefined for empty option_comparison', () => {
      expect(computeNearTie([])).toBeUndefined();
      expect(computeNearTie(undefined)).toBeUndefined();
    });

    it('returns undefined when all options have invalid status', () => {
      const options = [
        { option_id: 'a', win_probability: 0.6, status: 'failed' },
        { option_id: 'b', win_probability: 0.4, status: 'partial' },
      ];
      expect(computeNearTie(options)).toBeUndefined();
    });

    it('returns undefined when all win_probability are null/undefined', () => {
      const options = [
        { option_id: 'a', win_probability: undefined, status: 'computed' },
        { option_id: 'b', win_probability: undefined, status: 'computed' },
      ];
      expect(computeNearTie(options)).toBeUndefined();
    });

    it('detects near-tie when gap < 10%', () => {
      const options = [
        { option_id: 'opt_b', win_probability: 0.52, status: 'computed' },
        { option_id: 'opt_a', win_probability: 0.48, status: 'computed' },
      ];
      const result = computeNearTie(options);

      expect(result).toBeDefined();
      expect(result!.is_tie).toBe(true);
      expect(result!.top_option_id).toBe('opt_b');
      expect(result!.second_option_id).toBe('opt_a');
      expect(result!.gap).toBeCloseTo(0.04, 10);
      expect(result!.tied_option_ids).toContain('opt_b');
      expect(result!.tied_option_ids).toContain('opt_a');
      expect(result!.threshold).toBe(0.10);
    });

    it('detects no near-tie when gap >= 10%', () => {
      const options = [
        { option_id: 'opt_a', win_probability: 0.70, status: 'computed' },
        { option_id: 'opt_b', win_probability: 0.30, status: 'computed' },
      ];
      const result = computeNearTie(options);

      expect(result).toBeDefined();
      expect(result!.is_tie).toBe(false);
      expect(result!.top_option_id).toBe('opt_a');
      expect(result!.second_option_id).toBe('opt_b');
      expect(result!.gap).toBeCloseTo(0.40, 10);
      expect(result!.tied_option_ids).toHaveLength(1);
      expect(result!.tied_option_ids[0]).toBe('opt_a');
    });

    it('detects exact tie (gap = 0)', () => {
      const options = [
        { option_id: 'opt_a', win_probability: 0.50, status: 'computed' },
        { option_id: 'opt_b', win_probability: 0.50, status: 'computed' },
      ];
      const result = computeNearTie(options);

      expect(result).toBeDefined();
      expect(result!.is_tie).toBe(true);
      expect(result!.gap).toBe(0);
      expect(result!.tied_option_ids).toHaveLength(2);
    });

    it('handles boundary case: gap exactly at threshold', () => {
      const options = [
        { option_id: 'opt_a', win_probability: 0.55, status: 'computed' },
        { option_id: 'opt_b', win_probability: 0.45, status: 'computed' },
      ];
      const result = computeNearTie(options);

      expect(result).toBeDefined();
      // gap = 0.10, threshold = 0.10, gap >= threshold → not a tie
      expect(result!.is_tie).toBe(false);
      expect(result!.gap).toBeCloseTo(0.10, 10);
    });

    it('handles single valid option', () => {
      const options = [
        { option_id: 'opt_a', win_probability: 0.80, status: 'computed' },
        { option_id: 'opt_b', win_probability: undefined, status: 'failed' },
      ];
      const result = computeNearTie(options);

      expect(result).toBeDefined();
      expect(result!.is_tie).toBe(false);
      expect(result!.top_option_id).toBe('opt_a');
      expect(result!.second_option_id).toBeNull();
      expect(result!.gap).toBe(1.0);
      expect(result!.tied_option_ids).toHaveLength(0);
    });

    it('handles 3+ options with multiple ties', () => {
      const options = [
        { option_id: 'opt_a', win_probability: 0.35, status: 'computed' },
        { option_id: 'opt_b', win_probability: 0.33, status: 'computed' },
        { option_id: 'opt_c', win_probability: 0.32, status: 'computed' },
      ];
      const result = computeNearTie(options);

      expect(result).toBeDefined();
      expect(result!.is_tie).toBe(true);
      expect(result!.top_option_id).toBe('opt_a');
      expect(result!.second_option_id).toBe('opt_b');
      expect(result!.gap).toBeCloseTo(0.02, 10);
      // All three within 10% of top
      expect(result!.tied_option_ids).toHaveLength(3);
      expect(result!.tied_option_ids).toContain('opt_a');
      expect(result!.tied_option_ids).toContain('opt_b');
      expect(result!.tied_option_ids).toContain('opt_c');
    });

    it('treats undefined status as computed', () => {
      const options = [
        { option_id: 'opt_a', win_probability: 0.60 },
        { option_id: 'opt_b', win_probability: 0.40 },
      ];
      const result = computeNearTie(options);

      expect(result).toBeDefined();
      expect(result!.top_option_id).toBe('opt_a');
    });

    it('excludes options with non-computed status', () => {
      const options = [
        { option_id: 'opt_a', win_probability: 0.50, status: 'computed' },
        { option_id: 'opt_b', win_probability: 0.49, status: 'failed' },
        { option_id: 'opt_c', win_probability: 0.01, status: 'computed' },
      ];
      const result = computeNearTie(options);

      expect(result).toBeDefined();
      // opt_b excluded due to error status
      expect(result!.is_tie).toBe(false);
      expect(result!.top_option_id).toBe('opt_a');
      expect(result!.second_option_id).toBe('opt_c');
      expect(result!.gap).toBeCloseTo(0.49, 10);
    });

    it('handles NaN win_probability', () => {
      const options = [
        { option_id: 'opt_a', win_probability: NaN, status: 'computed' },
        { option_id: 'opt_b', win_probability: 0.50, status: 'computed' },
      ];
      const result = computeNearTie(options);

      expect(result).toBeDefined();
      // opt_a excluded due to NaN
      expect(result!.top_option_id).toBe('opt_b');
      expect(result!.second_option_id).toBeNull();
    });
  });

  describe('Golden fixture alignment', () => {
    it('pricing-canary: gap = 0.455 → is_tie: false', () => {
      // Matches contracts/examples/pricing-canary/plot-response.json
      const options = [
        { option_id: 'raise_to_59', win_probability: 0.7275 },
        { option_id: 'keep_49', win_probability: 0.2725 },
      ];
      const result = computeNearTie(options);

      expect(result!.is_tie).toBe(false);
      expect(result!.gap).toBeCloseTo(0.455, 10);
    });

    it('near-tie-canary: gap = 0.04 → is_tie: true', () => {
      // Matches contracts/examples/near-tie-canary/plot-response.json
      const options = [
        { option_id: 'opt_b', win_probability: 0.52 },
        { option_id: 'opt_a', win_probability: 0.48 },
      ];
      const result = computeNearTie(options);

      expect(result!.is_tie).toBe(true);
      expect(result!.gap).toBeCloseTo(0.04, 10);
    });
  });
});
