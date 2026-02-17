/**
 * Flip Threshold Denormaliser Tests
 *
 * Tests for denormalising flip threshold data from [0,1] to user units
 * and enriching with human-readable labels.
 */

import { describe, it, expect } from 'vitest';
import {
  denormaliseFlipThresholds,
  type DenormalisedFlipThreshold,
} from '../../src/lib/flip-threshold-denormaliser.js';
import type { FlipThresholdInputData } from '../../src/cee/validation/m1-review-types.js';
import type { NormalisationContext } from '../../src/lib/intervention-normaliser.js';

// =============================================================================
// Test Fixtures
// =============================================================================

const OPTIONS = [
  { id: 'opt-a', label: 'Option Alpha' },
  { id: 'opt-b', label: 'Option Beta' },
];

function makeFlip(overrides: Partial<FlipThresholdInputData> = {}): FlipThresholdInputData {
  return {
    factor_id: 'f1',
    factor_label: 'Factor One',
    current_value: 0.7,
    flip_value: 0.3,
    direction: 'decrease',
    flip_reason: 'found',
    iterations_used: 8,
    alternative_winner_id: 'opt-b',
    unit: 'GBP',
    ...overrides,
  };
}

function makeContext(
  factorId: string,
  min: number,
  max: number
): NormalisationContext {
  return {
    factors: new Map([
      [factorId, { factor_id: factorId, range: { min, max, source: 'explicit' as const }, baseline: min }],
    ]),
    goal_node_id: 'goal-1',
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('denormaliseFlipThresholds()', () => {
  describe('with normalisation context', () => {
    it('denormalises current_value and flip_value using factor range', () => {
      const flip = makeFlip({ current_value: 0.7, flip_value: 0.3 });
      const context = makeContext('f1', 10, 20); // range [10, 20], width = 10

      const result = denormaliseFlipThresholds([flip], context, OPTIONS);

      expect(result).toHaveLength(1);
      // denormalise: 0.7 * 10 + 10 = 17
      expect(result[0].current_value).toBe(17);
      // denormalise: 0.3 * 10 + 10 = 13
      expect(result[0].flip_value).toBe(13);
    });

    it('preserves null flip_value (no flip found)', () => {
      const flip = makeFlip({ flip_value: null, flip_reason: 'no_effect_within_bounds' });
      const context = makeContext('f1', 0, 100);

      const result = denormaliseFlipThresholds([flip], context, OPTIONS);

      expect(result[0].flip_value).toBeNull();
      expect(result[0].flip_reason).toBe('no_effect_within_bounds');
    });

    it('resolves alternative_winner_label from options', () => {
      const flip = makeFlip({ alternative_winner_id: 'opt-b' });
      const context = makeContext('f1', 0, 100);

      const result = denormaliseFlipThresholds([flip], context, OPTIONS);

      expect(result[0].alternative_winner_id).toBe('opt-b');
      expect(result[0].alternative_winner_label).toBe('Option Beta');
    });

    it('falls back to ID when option label not found', () => {
      const flip = makeFlip({ alternative_winner_id: 'opt-unknown' });
      const context = makeContext('f1', 0, 100);

      const result = denormaliseFlipThresholds([flip], context, OPTIONS);

      expect(result[0].alternative_winner_label).toBe('opt-unknown');
    });

    it('sets alternative_winner_label to null when no alternative winner', () => {
      const flip = makeFlip({ alternative_winner_id: null, flip_value: null });
      const context = makeContext('f1', 0, 100);

      const result = denormaliseFlipThresholds([flip], context, OPTIONS);

      expect(result[0].alternative_winner_id).toBeNull();
      expect(result[0].alternative_winner_label).toBeNull();
    });

    it('preserves unit, direction, flip_reason, iterations_used', () => {
      const flip = makeFlip({
        direction: 'increase',
        unit: '%',
        flip_reason: 'found',
        iterations_used: 12,
      });
      const context = makeContext('f1', 0, 100);

      const result = denormaliseFlipThresholds([flip], context, OPTIONS);

      expect(result[0].direction).toBe('increase');
      expect(result[0].unit).toBe('%');
      expect(result[0].flip_reason).toBe('found');
      expect(result[0].iterations_used).toBe(12);
    });
  });

  describe('without normalisation context', () => {
    it('passes through values unchanged when context is undefined', () => {
      const flip = makeFlip({ current_value: 42.5, flip_value: 30.0 });

      const result = denormaliseFlipThresholds([flip], undefined, OPTIONS);

      expect(result[0].current_value).toBe(42.5);
      expect(result[0].flip_value).toBe(30.0);
    });

    it('passes through values when factor not in context', () => {
      const flip = makeFlip({ factor_id: 'f-missing', current_value: 7.7, flip_value: 3.3 });
      const context = makeContext('f-other', 0, 100); // different factor

      const result = denormaliseFlipThresholds([flip], context, OPTIONS);

      expect(result[0].current_value).toBe(7.7);
      expect(result[0].flip_value).toBe(3.3);
    });

    it('still resolves alternative_winner_label without context', () => {
      const flip = makeFlip({ alternative_winner_id: 'opt-a' });

      const result = denormaliseFlipThresholds([flip], undefined, OPTIONS);

      expect(result[0].alternative_winner_label).toBe('Option Alpha');
    });
  });

  describe('edge cases', () => {
    it('returns empty array for empty input', () => {
      const result = denormaliseFlipThresholds([], undefined, OPTIONS);
      expect(result).toHaveLength(0);
    });

    it('handles multiple factors with mixed context availability', () => {
      const flips: FlipThresholdInputData[] = [
        makeFlip({ factor_id: 'f1', current_value: 0.5, flip_value: 0.2 }),
        makeFlip({ factor_id: 'f2', current_value: 99.0, flip_value: 50.0 }),
      ];
      const context = makeContext('f1', 0, 200); // only f1 has context

      const result = denormaliseFlipThresholds(flips, context, OPTIONS);

      expect(result).toHaveLength(2);
      // f1 denormalised: 0.5 * 200 + 0 = 100
      expect(result[0].current_value).toBe(100);
      expect(result[0].flip_value).toBe(40); // 0.2 * 200 + 0
      // f2 passed through (no context)
      expect(result[1].current_value).toBe(99.0);
      expect(result[1].flip_value).toBe(50.0);
    });

    it('defaults flip_reason to "heuristic" when undefined', () => {
      const flip = makeFlip({ flip_reason: undefined });

      const result = denormaliseFlipThresholds([flip], undefined, OPTIONS);

      expect(result[0].flip_reason).toBe('heuristic');
    });

    it('handles undefined alternative_winner_id (defaults to null)', () => {
      const flip = makeFlip({ alternative_winner_id: undefined });

      const result = denormaliseFlipThresholds([flip], undefined, OPTIONS);

      expect(result[0].alternative_winner_id).toBeNull();
      expect(result[0].alternative_winner_label).toBeNull();
    });
  });
});
