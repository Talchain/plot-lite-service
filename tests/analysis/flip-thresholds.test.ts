/**
 * Binary Search Flip Threshold Tests
 *
 * Tests for resolveFlipValues() — binary search over ISL inference.
 * Uses mock ISL inference functions to test all algorithm paths.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  resolveFlipValues,
  createISLInferenceFn,
  type ISLInferenceFn,
  type FlipInferenceResult,
} from '../../src/analysis/flip-thresholds.js';
import type { FlipThresholdInputData } from '../../src/cee/validation/m1-review-types.js';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a mock ISL inference function that flips the winner
 * when the factor's mean crosses a threshold.
 */
function createMonotonicMock(
  flipThreshold: number,
  originalWinner: string = 'opt-a',
  alternativeWinner: string = 'opt-b',
  direction: 'increase' | 'decrease' = 'decrease'
): ISLInferenceFn {
  return async (_factorId: string, overrideMean: number): Promise<FlipInferenceResult> => {
    const flipped =
      direction === 'decrease'
        ? overrideMean <= flipThreshold
        : overrideMean >= flipThreshold;

    return {
      options: [
        {
          option_id: originalWinner,
          win_probability: flipped ? 0.35 : 0.65,
        },
        {
          option_id: alternativeWinner,
          win_probability: flipped ? 0.65 : 0.35,
        },
      ],
    };
  };
}

/**
 * Create a mock ISL inference function where the winner never changes.
 */
function createNeverFlipMock(winner: string = 'opt-a'): ISLInferenceFn {
  return async (): Promise<FlipInferenceResult> => ({
    options: [
      { option_id: winner, win_probability: 0.8 },
      { option_id: 'opt-b', win_probability: 0.2 },
    ],
  });
}

/**
 * Create a mock that oscillates (non-monotonic).
 */
function createOscillatingMock(): ISLInferenceFn {
  let callCount = 0;
  const winners = ['opt-a', 'opt-b', 'opt-a', 'opt-c', 'opt-b', 'opt-a'];
  return async (): Promise<FlipInferenceResult> => {
    const idx = callCount % winners.length;
    callCount++;
    const w = winners[idx];
    return {
      options: [
        { option_id: 'opt-a', win_probability: w === 'opt-a' ? 0.5 : 0.2 },
        { option_id: 'opt-b', win_probability: w === 'opt-b' ? 0.5 : 0.2 },
        { option_id: 'opt-c', win_probability: w === 'opt-c' ? 0.5 : 0.1 },
      ],
    };
  };
}

/**
 * Create a mock that fails with an error.
 */
function createErrorMock(): ISLInferenceFn {
  return async (): Promise<FlipInferenceResult> => {
    throw new Error('ISL service unavailable');
  };
}

/**
 * Create a candidate with standard defaults.
 */
function makeCandidate(overrides?: Partial<FlipThresholdInputData>): FlipThresholdInputData {
  return {
    factor_id: 'factor-market',
    factor_label: 'Market Demand',
    current_value: 0.7,
    flip_value: null,
    direction: 'decrease',
    flip_reason: 'heuristic',
    iterations_used: 0,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('resolveFlipValues()', () => {
  describe('Binary Search — Monotonic Flip', () => {
    it('finds flip_value when flip exists (decreasing direction)', async () => {
      // Flip at 0.35: when factor drops below 0.35, winner flips
      const mock = createMonotonicMock(0.35, 'opt-a', 'opt-b', 'decrease');
      const candidate = makeCandidate({ current_value: 0.7, direction: 'decrease' });

      const { results } = await resolveFlipValues([candidate], mock, 'opt-a');

      expect(results).toHaveLength(1);
      expect(results[0].flip_value).not.toBeNull();
      expect(results[0].flip_value!).toBeCloseTo(0.35, 1);
      expect(results[0].flip_reason).toBe('found');
      expect(results[0].iterations_used).toBeGreaterThan(0);
    });

    it('finds flip_value when flip exists (increasing direction)', async () => {
      // Flip at 0.85: when factor rises above 0.85, winner flips
      const mock = createMonotonicMock(0.85, 'opt-a', 'opt-b', 'increase');
      const candidate = makeCandidate({
        current_value: 0.6,
        direction: 'increase',
      });

      const { results } = await resolveFlipValues([candidate], mock, 'opt-a');

      expect(results).toHaveLength(1);
      expect(results[0].flip_value).not.toBeNull();
      expect(results[0].flip_value!).toBeCloseTo(0.85, 1);
      expect(results[0].flip_reason).toBe('found');
    });

    it('converges within precision-derived iterations (7 for [0,1])', async () => {
      const mock = createMonotonicMock(0.5, 'opt-a', 'opt-b', 'decrease');
      const candidate = makeCandidate({ current_value: 0.9, direction: 'decrease' });

      const { results } = await resolveFlipValues([candidate], mock, 'opt-a');

      // Max iterations = ceil(log2(1/0.01)) = 7
      expect(results[0].iterations_used).toBeLessThanOrEqual(7);
    });

    it('flip_value rounded to 4 decimal places', async () => {
      const mock = createMonotonicMock(0.333333, 'opt-a', 'opt-b', 'decrease');
      const candidate = makeCandidate({ current_value: 0.7, direction: 'decrease' });

      const { results } = await resolveFlipValues([candidate], mock, 'opt-a');

      if (results[0].flip_value !== null) {
        const decimalPlaces = results[0].flip_value.toString().split('.')[1]?.length ?? 0;
        expect(decimalPlaces).toBeLessThanOrEqual(4);
      }
    });
  });

  describe('Bound Probing — No Flip', () => {
    it('returns no_effect_within_bounds when winner is same at baseline and both bounds', async () => {
      const mock = createNeverFlipMock('opt-a');
      const candidate = makeCandidate({ current_value: 0.7, direction: 'decrease' });

      const { results } = await resolveFlipValues([candidate], mock, 'opt-a');

      expect(results).toHaveLength(1);
      expect(results[0].flip_value).toBeNull();
      expect(results[0].flip_reason).toBe('no_effect_within_bounds');
      expect(results[0].iterations_used).toBe(0);
    });

    it('probing saves ISL calls (no unnecessary binary search)', async () => {
      const spy = vi.fn(createNeverFlipMock('opt-a'));
      const candidate = makeCandidate();

      await resolveFlipValues([candidate], spy, 'opt-a');

      // 3 calls for probing (baseline + min bound + max bound)
      expect(spy).toHaveBeenCalledTimes(3);
    });
  });

  describe('Edge Cases', () => {
    it('returns empty results for empty candidates', async () => {
      const mock = createMonotonicMock(0.5);
      const { results } = await resolveFlipValues([], mock, 'opt-a');
      expect(results).toEqual([]);
    });

    it('handles baseline at 0 — searches toward max bound', async () => {
      // Flip at 0.5: when factor rises above 0.5, winner flips
      const mock = createMonotonicMock(0.5, 'opt-a', 'opt-b', 'increase');
      const candidate = makeCandidate({
        current_value: 0,
        direction: 'decrease',  // heuristic says decrease, but only max bound differs
      });

      const { results } = await resolveFlipValues([candidate], mock, 'opt-a');

      // Should find the flip despite baseline=0 (old algorithm failed here with 'boundary')
      expect(results[0].flip_value).not.toBeNull();
      expect(results[0].flip_reason).toBe('found');
      expect(results[0].flip_value!).toBeCloseTo(0.5, 1);
    });

    it('returns error fallback when current_value is not finite', async () => {
      const mock = createMonotonicMock(0.5);
      const nanCandidate = makeCandidate({ current_value: NaN, direction: 'increase' });
      const infCandidate = makeCandidate({ current_value: Infinity, direction: 'decrease' });

      const [nanResult, infResult] = await Promise.all([
        resolveFlipValues([nanCandidate], mock, 'opt-a'),
        resolveFlipValues([infCandidate], mock, 'opt-a'),
      ]);

      expect(nanResult.results[0].flip_reason).toBe('error');
      expect(nanResult.results[0].iterations_used).toBe(0);
      expect(infResult.results[0].flip_reason).toBe('error');
      expect(infResult.results[0].iterations_used).toBe(0);
    });

    it('handles two candidates concurrently', async () => {
      const mock = createMonotonicMock(0.3, 'opt-a', 'opt-b', 'decrease');
      const candidate1 = makeCandidate({ factor_id: 'f1', current_value: 0.7, direction: 'decrease' });
      const candidate2 = makeCandidate({ factor_id: 'f2', current_value: 0.8, direction: 'decrease' });

      const { results } = await resolveFlipValues([candidate1, candidate2], mock, 'opt-a');

      expect(results).toHaveLength(2);
      expect(results[0].flip_reason).toBeDefined();
      expect(results[1].flip_reason).toBeDefined();
    });

    it('preserves original fields (factor_id, factor_label, direction)', async () => {
      const mock = createMonotonicMock(0.4, 'opt-a', 'opt-b', 'decrease');
      const candidate = makeCandidate({
        factor_id: 'my-factor',
        factor_label: 'My Factor',
        current_value: 0.8,
        direction: 'decrease',
      });

      const { results } = await resolveFlipValues([candidate], mock, 'opt-a');

      expect(results[0].factor_id).toBe('my-factor');
      expect(results[0].factor_label).toBe('My Factor');
      expect(results[0].direction).toBe('decrease');
    });
  });

  describe('Non-Monotonicity Guard', () => {
    it('falls back to grid scan when winner oscillates', async () => {
      // The oscillating mock alternates winners in a non-monotonic pattern
      const mock = createOscillatingMock();
      const candidate = makeCandidate({ current_value: 0.9, direction: 'decrease' });

      const { results } = await resolveFlipValues([candidate], mock, 'opt-a');

      // Should complete without error
      expect(results).toHaveLength(1);
      expect(results[0].flip_reason).toBeDefined();
      // Grid fallback or found or no_effect — all acceptable
      expect(['non_monotonic_grid', 'found', 'no_effect_within_bounds']).toContain(results[0].flip_reason);
    });
  });

  describe('Error Handling', () => {
    it('returns error when inference function throws', async () => {
      const mock = createErrorMock();
      const candidate = makeCandidate();

      const { results } = await resolveFlipValues([candidate], mock, 'opt-a');

      expect(results).toHaveLength(1);
      expect(results[0].flip_value).toBeNull();
      expect(results[0].flip_reason).toBe('error');
    });

    it('does not abort other factors when one fails', async () => {
      let callCount = 0;
      const mixedMock: ISLInferenceFn = async (factorId, mean) => {
        callCount++;
        if (factorId === 'f-bad') throw new Error('ISL error');
        // Normal monotonic for good factor
        const flipped = mean <= 0.3;
        return {
          options: [
            { option_id: 'opt-a', win_probability: flipped ? 0.3 : 0.7 },
            { option_id: 'opt-b', win_probability: flipped ? 0.7 : 0.3 },
          ],
        };
      };

      const candidates = [
        makeCandidate({ factor_id: 'f-bad', current_value: 0.8 }),
        makeCandidate({ factor_id: 'f-good', current_value: 0.8 }),
      ];

      const { results } = await resolveFlipValues(candidates, mixedMock, 'opt-a');

      expect(results).toHaveLength(2);
      expect(results[0].flip_reason).toBe('error');
      // Second factor should have completed
      expect(results[1].flip_reason).not.toBe('error');
    });
  });

  describe('Timeout Handling', () => {
    /**
     * Mock that flips the winner ONLY at the lower bound (mean === 0) and sleeps
     * on every probe. The Step-0 probes (baseline, min, max) run in parallel and
     * each sleep `delayMs`, so by the time they resolve the per-factor deadline
     * has already elapsed — driving a genuine wall-clock timeout into the
     * binary-search loop's deadline check. The winner change at the lower bound
     * forces a bracket to be set (strict flip), so the ONLY reachable outcome is
     * the binary-search timeout branch — eliminating the old test's
     * timeout/no_effect/found ambiguity.
     */
    function createSlowLowerBoundFlipMock(delayMs: number): ISLInferenceFn {
      return async (_factorId: string, overrideMean: number): Promise<FlipInferenceResult> => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        const flipped = overrideMean <= 0; // only the min bound (mean=0) flips
        return {
          options: [
            { option_id: 'opt-a', win_probability: flipped ? 0.35 : 0.65 },
            { option_id: 'opt-b', win_probability: flipped ? 0.65 : 0.35 },
          ],
        };
      };
    }

    it('does NOT surface the partial-search midpoint as flip_value on a genuine timeout', async () => {
      // Real-deadline timeout: deadline (20ms) << Step-0 probe time (~100ms), so the
      // loop's `Date.now() >= factorDeadline` check fires before any binary iteration.
      // This is a genuine wall-clock timeout (not an injected flip_reason flag).
      const slowMock = createSlowLowerBoundFlipMock(100);
      const candidate = makeCandidate({ current_value: 0.9, direction: 'decrease' });

      const { results, diagnostics } = await resolveFlipValues([candidate], slowMock, 'opt-a', {
        perFactorTimeoutMs: 20,
        overallTimeoutMs: 20,
      });

      expect(results).toHaveLength(1);
      const r = results[0];

      // Authoritative honesty gate: timeout exposes no usable numeric threshold.
      expect(r.flip_reason).toBe('timeout');
      expect(r.flip_value).toBeNull();
      expect(r.alternative_winner_id).toBeNull();

      // iterations_used preserved (the timeout fired at the top of the loop).
      expect(typeof r.iterations_used).toBe('number');
      expect(r.iterations_used).toBeGreaterThanOrEqual(0);

      // margin_sensitivity is retained — it reflects the COMPLETED Step-0 probes,
      // and movement stays truthful ('flipped', since the lower bound's winner
      // differs from baseline). Its presence also proves this is the binary-search
      // timeout branch, not the pre-probe branch (which carries no margin_sensitivity).
      expect(r.margin_sensitivity).toBeDefined();
      expect(r.margin_sensitivity?.movement).toBe('flipped');

      // Diagnostic-only preservation: the partial-search midpoint and far winner
      // MUST survive in diagnostics (log-only) even though they are suppressed from
      // the public result above. Bracket is [0, baseline=0.9] (only the min bound
      // flips), so the midpoint at timeout is 0.45 and the far winner is 'opt-b'.
      // Asserting both halves locks the full contract: preserved for debugging,
      // never surfaced as a usable threshold.
      const d = diagnostics[0];
      expect(d.flip_reason).toBe('timeout');
      expect(d.flip_value).not.toBeNull();
      expect(d.flip_value).toBeCloseTo(0.45, 4);
      expect(d.alternative_winner_id).toBe('opt-b');
      // The whole point: diagnostics keep the midpoint, the public result nulls it.
      expect(r.flip_value).toBeNull();
      expect(d.flip_value).not.toBe(r.flip_value);
    });
  });

  describe('flip_reason and iterations_used', () => {
    it('every result has flip_reason populated', async () => {
      const mock = createMonotonicMock(0.4, 'opt-a', 'opt-b', 'decrease');
      const candidates = [
        makeCandidate({ factor_id: 'f1', current_value: 0.8, direction: 'decrease' }),
      ];

      const { results } = await resolveFlipValues(candidates, mock, 'opt-a');

      for (const result of results) {
        expect(result.flip_reason).toBeDefined();
        expect(typeof result.flip_reason).toBe('string');
      }
    });

    it('every result has iterations_used populated', async () => {
      const mock = createMonotonicMock(0.4, 'opt-a', 'opt-b', 'decrease');
      const candidates = [
        makeCandidate({ factor_id: 'f1', current_value: 0.8, direction: 'decrease' }),
      ];

      const { results } = await resolveFlipValues(candidates, mock, 'opt-a');

      for (const result of results) {
        expect(result.iterations_used).toBeDefined();
        expect(typeof result.iterations_used).toBe('number');
        expect(result.iterations_used).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Diagnostics', () => {
    it('returns diagnostics for each factor', async () => {
      const mock = createMonotonicMock(0.4, 'opt-a', 'opt-b', 'decrease');
      const candidate = makeCandidate({ current_value: 0.8, direction: 'decrease' });

      const { diagnostics } = await resolveFlipValues([candidate], mock, 'opt-a');

      expect(diagnostics).toHaveLength(1);
      const d = diagnostics[0];
      expect(d.factor_id).toBe('factor-market');
      expect(d.baseline).toBe(0.8);
      expect(d.winner_at_baseline).toBeDefined();
      expect(d.winner_at_min).toBeDefined();
      expect(d.winner_at_max).toBeDefined();
      expect(d.precision_target).toBe(0.01);
      expect(d.precision_achieved).toBeLessThanOrEqual(0.01);
      expect(d.flip_reason).toBe('found');
    });

    it('diagnostics show no_effect_within_bounds when winner never changes', async () => {
      const mock = createNeverFlipMock('opt-a');
      const candidate = makeCandidate({ current_value: 0.5, direction: 'decrease' });

      const { diagnostics } = await resolveFlipValues([candidate], mock, 'opt-a');

      expect(diagnostics[0].winner_at_baseline).toBe('opt-a');
      expect(diagnostics[0].winner_at_min).toBe('opt-a');
      expect(diagnostics[0].winner_at_max).toBe('opt-a');
      expect(diagnostics[0].direction_searched).toBe('none');
      expect(diagnostics[0].flip_reason).toBe('no_effect_within_bounds');
    });
  });

  describe('3-option graph flip (spec test)', () => {
    it('finds flip with 3 options — option A wins at ~54%, option B at ~41%', async () => {
      // 3-option graph where factor F has baseline 0 and edge to goal with strength 0.6.
      // When F is increased, option A's win_probability drops and option B surpasses it.
      const threeOptionMock: ISLInferenceFn = async (_factorId: string, overrideMean: number): Promise<FlipInferenceResult> => {
        // Simulate: as factor increases from 0 toward 1, A drops and B gains
        const shift = overrideMean * 0.6; // strength 0.6
        return {
          options: [
            { option_id: 'opt-a', win_probability: 0.54 - shift * 0.3 },
            { option_id: 'opt-b', win_probability: 0.41 + shift * 0.3 },
            { option_id: 'opt-c', win_probability: 0.05 },
          ],
        };
      };

      const candidate = makeCandidate({
        factor_id: 'factor-f',
        factor_label: 'Factor F',
        current_value: 0,
        direction: 'increase',
      });

      const { results } = await resolveFlipValues([candidate], threeOptionMock, 'opt-a');

      expect(results[0].flip_value).not.toBeNull();
      expect(results[0].flip_reason).toBe('found');
      expect(results[0].alternative_winner_id).toBe('opt-b');

      // Verify the flip_value actually flips the winner (within ±0.02 tolerance)
      const flipVal = results[0].flip_value!;
      const resultAtFlip = await threeOptionMock('factor-f', flipVal);
      const resultSlightlyBefore = await threeOptionMock('factor-f', flipVal - 0.02);
      const resultSlightlyAfter = await threeOptionMock('factor-f', flipVal + 0.02);

      // At least one side should have a different winner than the baseline
      const baselineWinner = 'opt-a';
      const winnerBefore = resultSlightlyBefore.options.sort((a, b) => b.win_probability - a.win_probability)[0].option_id;
      const winnerAfter = resultSlightlyAfter.options.sort((a, b) => b.win_probability - a.win_probability)[0].option_id;
      expect(winnerBefore === baselineWinner || winnerAfter !== baselineWinner).toBe(true);
    });

    it('returns no_effect_within_bounds for factor with no path to goal', async () => {
      // Factor with no path to goal: changing it has no effect on win probabilities
      const noEffectMock: ISLInferenceFn = async (): Promise<FlipInferenceResult> => ({
        options: [
          { option_id: 'opt-a', win_probability: 0.54 },
          { option_id: 'opt-b', win_probability: 0.41 },
          { option_id: 'opt-c', win_probability: 0.05 },
        ],
      });

      const candidate = makeCandidate({
        factor_id: 'factor-orphan',
        factor_label: 'Orphan Factor',
        current_value: 0.5,
        direction: 'increase',
      });

      const { results } = await resolveFlipValues([candidate], noEffectMock, 'opt-a');

      expect(results[0].flip_reason).toBe('no_effect_within_bounds');
      expect(results[0].iterations_used).toBe(0);
      expect(results[0].flip_value).toBeNull();
    });
  });
});

// =============================================================================
// probes_used telemetry — distinguishes "no probes ran" from
// "probes ran but no bisection ran" (iterations_used: 0 is otherwise ambiguous).
// =============================================================================

describe('resolveFlipValues() — probes_used telemetry', () => {
  it('no-bisection three-probe path reports probes_used: 3 with iterations_used: 0', async () => {
    const mock = createNeverFlipMock('opt-a');
    const candidate = makeCandidate({ current_value: 0.7, direction: 'decrease' });

    const { results } = await resolveFlipValues([candidate], mock, 'opt-a');

    expect(results[0].flip_reason).toBe('no_effect_within_bounds');
    expect(results[0].iterations_used).toBe(0);
    expect(results[0].probes_used).toBe(3); // baseline + min bound + max bound, no bisection
  });

  it('iterations_used: 0 no longer implies no probes ran (probes_used disambiguates)', async () => {
    const mock = createNeverFlipMock('opt-a');
    const candidate = makeCandidate({ current_value: 0.5 });

    const { results } = await resolveFlipValues([candidate], mock, 'opt-a');

    expect(results[0].iterations_used).toBe(0);
    expect(results[0].probes_used).toBe(3);
    expect(results[0].probes_used).toBeGreaterThan(0);
  });

  it('bisection path counts initial probes plus midpoint probes (3 + iterations_used)', async () => {
    const mock = createMonotonicMock(0.35, 'opt-a', 'opt-b', 'decrease');
    const candidate = makeCandidate({ current_value: 0.7, direction: 'decrease' });

    const { results } = await resolveFlipValues([candidate], mock, 'opt-a');

    expect(results[0].flip_reason).toBe('found');
    expect(results[0].iterations_used).toBeGreaterThan(0);
    expect(results[0].probes_used).toBe(3 + results[0].iterations_used!);
  });

  it('does not fabricate probes_used when the probe phase never runs (non-finite baseline)', async () => {
    const mock = createNeverFlipMock('opt-a');
    const candidate = makeCandidate({ current_value: NaN });

    const { results } = await resolveFlipValues([candidate], mock, 'opt-a');

    expect(results[0].flip_reason).toBe('error');
    expect(results[0].probes_used).toBe(0); // honest: no probes executed
  });

  it('reports probes_used: 0 when the probe phase throws before any probe completes', async () => {
    const mock = createErrorMock();
    const candidate = makeCandidate({ current_value: 0.5 });

    const { results } = await resolveFlipValues([candidate], mock, 'opt-a');

    expect(results[0].flip_reason).toBe('error');
    expect(results[0].probes_used).toBe(0);
  });

  it('leaves existing free/non-overridden factor behaviour unchanged (flip found, probes_used > 3)', async () => {
    const mock = createMonotonicMock(0.85, 'opt-a', 'opt-b', 'increase');
    const candidate = makeCandidate({ current_value: 0.6, direction: 'increase' });

    const { results } = await resolveFlipValues([candidate], mock, 'opt-a');

    expect(results[0].flip_reason).toBe('found');
    expect(results[0].flip_value!).toBeCloseTo(0.85, 1);
    expect(results[0].probes_used).toBeGreaterThan(3); // 3 Step-0 probes + bisection midpoints
  });

  it('diagnostics carry probes_used alongside iterations_used', async () => {
    const mock = createNeverFlipMock('opt-a');
    const candidate = makeCandidate({ current_value: 0.5 });

    const { diagnostics } = await resolveFlipValues([candidate], mock, 'opt-a');

    expect(diagnostics[0].probes_used).toBe(3);
    expect(diagnostics[0].iterations_used).toBe(0);
  });

  it('counts COMPLETED Step-0 probes on partial failure (failure settles LAST)', async () => {
    // baseline (0.5) and lower bound (0) fulfil immediately; the upper bound (1)
    // rejects after a tick (settles last).
    const failLastMock: ISLInferenceFn = async (_id, mean) => {
      if (mean >= 1) {
        await new Promise((r) => setTimeout(r, 5));
        throw new Error('upper-bound probe failed');
      }
      return {
        options: [
          { option_id: 'opt-a', win_probability: 0.6 },
          { option_id: 'opt-b', win_probability: 0.4 },
        ],
      };
    };
    const candidate = makeCandidate({ current_value: 0.5 });

    const { results } = await resolveFlipValues([candidate], failLastMock, 'opt-a');

    expect(results[0].flip_reason).toBe('error');
    expect(results[0].probes_used).toBe(2); // baseline + lower bound fulfilled
  });

  it('counts COMPLETED Step-0 probes order-independently (failure rejects FIRST)', async () => {
    // The upper-bound probe rejects IMMEDIATELY (first to settle); baseline and lower
    // bound fulfil afterwards. With Promise.all this returns probes_used: 0 (catch
    // reads the count before the siblings resolve, and they complete after emission).
    // allSettled waits for all three to settle, so the honest count is 2 regardless.
    const failFirstMock: ISLInferenceFn = async (_id, mean) => {
      if (mean >= 1) {
        throw new Error('upper-bound probe failed immediately');
      }
      await new Promise((r) => setTimeout(r, 5));
      return {
        options: [
          { option_id: 'opt-a', win_probability: 0.6 },
          { option_id: 'opt-b', win_probability: 0.4 },
        ],
      };
    };
    const candidate = makeCandidate({ current_value: 0.5 });

    const { results } = await resolveFlipValues([candidate], failFirstMock, 'opt-a');

    expect(results[0].flip_reason).toBe('error');
    expect(results[0].probes_used).toBe(2); // both siblings completed; NOT 0
  });

  it('keeps iterations_used bisection-only on the grid-fallback path (grid probes only in probes_used)', async () => {
    // Step-0: baseline(0.5)=a, min(0)=b (differs → search toward_min), max(1)=a.
    // First bisection midpoint (0.25) returns a THIRD option → grid fallback after
    // exactly 1 bisection iteration. Grid probe at 0 returns b → flip found.
    const gridMock: ISLInferenceFn = async (_id, mean) => {
      let leader: string;
      if (mean === 0) leader = 'opt-b';
      else if (mean === 0.5 || mean === 1) leader = 'opt-a';
      else leader = 'opt-c'; // interior midpoint → non-monotonic
      return {
        options: [
          { option_id: 'opt-a', win_probability: leader === 'opt-a' ? 0.6 : 0.2 },
          { option_id: 'opt-b', win_probability: leader === 'opt-b' ? 0.6 : 0.2 },
          { option_id: 'opt-c', win_probability: leader === 'opt-c' ? 0.6 : 0.2 },
        ],
      };
    };
    const candidate = makeCandidate({ current_value: 0.5, direction: 'decrease' });

    const { results } = await resolveFlipValues([candidate], gridMock, 'opt-a');

    expect(results[0].flip_reason).toBe('non_monotonic_grid');
    // 1 bisection midpoint before fallback; grid probes do NOT inflate iterations_used.
    expect(results[0].iterations_used).toBe(1);
    // 3 Step-0 + 1 bisection + 1 grid probe = 5 completed evaluations.
    expect(results[0].probes_used).toBe(5);
  });
});

describe('createISLInferenceFn()', () => {
  it('overrides the target factor mean in parameter_uncertainties', async () => {
    let capturedBody: any = null;

    const mockCallAnalysis = async (_ep: string, body: unknown, _rid: string) => {
      capturedBody = body;
      return {
        data: {
          results: [
            { option_id: 'opt-a', win_probability: 0.6 },
            { option_id: 'opt-b', win_probability: 0.4 },
          ],
        },
      };
    };

    const originalRequest = {
      graph: { nodes: [], edges: [] },
      options: [{ id: 'opt-a' }, { id: 'opt-b' }],
      goal_node_id: 'goal',
      n_samples: 1000,
      parameter_uncertainties: [
        { node_id: 'factor-x', distribution: 'normal', mean: 0.7, std: 0.15 },
        { node_id: 'factor-y', distribution: 'normal', mean: 0.5, std: 0.2 },
      ],
    };

    const fn = createISLInferenceFn(mockCallAnalysis, originalRequest, 'req-1');

    await fn('factor-x', 0.3);

    // Should override factor-x mean to 0.3, leave factor-y unchanged
    const pu = capturedBody.parameter_uncertainties;
    expect(pu.find((p: any) => p.node_id === 'factor-x').mean).toBe(0.3);
    expect(pu.find((p: any) => p.node_id === 'factor-y').mean).toBe(0.5);
  });

  it('uses analysis_types: ["comparison"] for efficiency', async () => {
    let capturedBody: any = null;

    const mockCallAnalysis = async (_ep: string, body: unknown, _rid: string) => {
      capturedBody = body;
      return {
        data: { results: [{ option_id: 'opt-a', win_probability: 1.0 }] },
      };
    };

    const fn = createISLInferenceFn(
      mockCallAnalysis,
      { graph: { nodes: [], edges: [] }, options: [], goal_node_id: 'goal' },
      'req-1'
    );

    await fn('factor-x', 0.5);

    expect(capturedBody.analysis_types).toEqual(['comparison']);
  });

  it('throws when ISL returns null data', async () => {
    const mockCallAnalysis = async () => ({ data: null });

    const fn = createISLInferenceFn(
      mockCallAnalysis,
      { graph: { nodes: [], edges: [] }, options: [], goal_node_id: 'goal' },
      'req-1'
    );

    await expect(fn('factor-x', 0.5)).rejects.toThrow(/ISL inference failed/);
  });

  it('inserts factor into parameter_uncertainties when absent', async () => {
    let capturedBody: any = null;

    const mockCallAnalysis = async (_ep: string, body: unknown, _rid: string) => {
      capturedBody = body;
      return {
        data: { results: [{ option_id: 'opt-a', win_probability: 1.0 }] },
      };
    };

    const originalRequest = {
      graph: { nodes: [], edges: [] },
      options: [],
      goal_node_id: 'goal',
      parameter_uncertainties: [
        { node_id: 'other-factor', distribution: 'normal', mean: 0.5, std: 0.2 },
      ],
    };

    const fn = createISLInferenceFn(mockCallAnalysis, originalRequest, 'req-1');

    await fn('missing-factor', 0.6);

    // Should now have 2 entries: original + inserted
    const pu = capturedBody.parameter_uncertainties;
    expect(pu).toHaveLength(2);

    const inserted = pu.find((p: any) => p.node_id === 'missing-factor');
    expect(inserted).toBeDefined();
    expect(inserted.mean).toBe(0.6);
    expect(inserted.distribution).toBe('normal');
    expect(inserted.std).toBeGreaterThanOrEqual(0.1);

    // Original unchanged
    const other = pu.find((p: any) => p.node_id === 'other-factor');
    expect(other.mean).toBe(0.5);
  });

  it('inserts factor with std floor of 0.1 when mean is near zero', async () => {
    let capturedBody: any = null;

    const mockCallAnalysis = async (_ep: string, body: unknown, _rid: string) => {
      capturedBody = body;
      return {
        data: { results: [{ option_id: 'opt-a', win_probability: 1.0 }] },
      };
    };

    const fn = createISLInferenceFn(
      mockCallAnalysis,
      { graph: { nodes: [], edges: [] }, options: [], goal_node_id: 'goal', parameter_uncertainties: [] },
      'req-1'
    );

    await fn('factor-zero', 0.01);

    const inserted = capturedBody.parameter_uncertainties.find((p: any) => p.node_id === 'factor-zero');
    // 0.01 * 0.15 = 0.0015 → floored to 0.1
    expect(inserted.std).toBe(0.1);
  });

  it('does not mutate original request parameter_uncertainties', async () => {
    const originalPU = [
      { node_id: 'factor-x', distribution: 'normal', mean: 0.7, std: 0.15 },
    ];

    const mockCallAnalysis = async () => ({
      data: { results: [{ option_id: 'opt-a', win_probability: 1.0 }] },
    });

    const originalRequest = {
      graph: { nodes: [], edges: [] },
      options: [],
      goal_node_id: 'goal',
      parameter_uncertainties: originalPU,
    };

    const fn = createISLInferenceFn(mockCallAnalysis, originalRequest, 'req-1');

    await fn('factor-x', 0.1);

    // Original should be unchanged
    expect(originalPU[0].mean).toBe(0.7);
  });

  // ===========================================================================
  // Branch A fix: the probe must mutate the graph node observed_state.value (the
  // field ISL's comparison reads as the sampling mean), not only PU mean.
  // ===========================================================================

  function makeGraphRequest() {
    return {
      graph: {
        nodes: [
          { id: 'factor-x', kind: 'factor', label: 'X', observed_state: { value: 0.7, std: 0.1, raw_value: 70, cap: 100, unit: 'pct', baseline: 0.6 } },
          { id: 'factor-y', kind: 'factor', label: 'Y', observed_state: { value: 0.3, std: 0.1 } },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [],
      },
      options: [
        { id: 'opt-a', interventions: { 'factor-y': 0.5 } },
        { id: 'opt-b', interventions: { 'factor-y': 0.2 } },
      ],
      goal_node_id: 'goal',
      parameter_uncertainties: [
        { node_id: 'factor-x', distribution: 'normal', mean: 0.7, std: 0.1 },
        { node_id: 'factor-y', distribution: 'normal', mean: 0.3, std: 0.1 },
      ],
    };
  }

  it('sets the target graph node observed_state.value to the probe value (and aligns PU mean)', async () => {
    let captured: any = null;
    const mockCallAnalysis = async (_ep: string, body: unknown) => {
      captured = body;
      return { data: { results: [{ option_id: 'opt-a', win_probability: 1.0 }] } };
    };
    const fn = createISLInferenceFn(mockCallAnalysis, makeGraphRequest(), 'req-1');

    await fn('factor-x', 0.25);

    const targetNode = (captured.graph.nodes as any[]).find((n) => n.id === 'factor-x');
    expect(targetNode.observed_state.value).toBe(0.25);              // graph value = probe value
    const puX = (captured.parameter_uncertainties as any[]).find((p) => p.node_id === 'factor-x');
    expect(puX.mean).toBe(0.25);                                     // PU mean aligned
    // Display/denormalisation metadata + uncertainty width preserved
    expect(targetNode.observed_state.std).toBe(0.1);
    expect(targetNode.observed_state.raw_value).toBe(70);
    expect(targetNode.observed_state.cap).toBe(100);
    expect(targetNode.observed_state.unit).toBe('pct');
    expect(targetNode.observed_state.baseline).toBe(0.6);
  });

  it('leaves non-target graph nodes and options unchanged', async () => {
    let captured: any = null;
    const mockCallAnalysis = async (_ep: string, body: unknown) => {
      captured = body;
      return { data: { results: [{ option_id: 'opt-a', win_probability: 1.0 }] } };
    };
    const req = makeGraphRequest();
    const fn = createISLInferenceFn(mockCallAnalysis, req, 'req-1');

    await fn('factor-x', 0.9);

    const otherNode = (captured.graph.nodes as any[]).find((n) => n.id === 'factor-y');
    expect(otherNode.observed_state.value).toBe(0.3);               // untouched
    expect(captured.options).toEqual(req.options);                  // options unchanged
  });

  it('does not mutate the original request graph (probe-local clone)', async () => {
    const mockCallAnalysis = async () => ({ data: { results: [{ option_id: 'opt-a', win_probability: 1.0 }] } });
    const req = makeGraphRequest();
    const fn = createISLInferenceFn(mockCallAnalysis, req, 'req-1');

    await fn('factor-x', 0.0);

    const origTarget = (req.graph.nodes as any[]).find((n) => n.id === 'factor-x');
    expect(origTarget.observed_state.value).toBe(0.7);             // original unchanged
  });

  it('concurrent probes each carry their own observed_state.value (no leakage)', async () => {
    const captured: any[] = [];
    const mockCallAnalysis = async (_ep: string, body: unknown) => {
      captured.push(body);
      return { data: { results: [{ option_id: 'opt-a', win_probability: 1.0 }] } };
    };
    const fn = createISLInferenceFn(mockCallAnalysis, makeGraphRequest(), 'req-1');

    // Run baseline/min/max concurrently, as resolveFlipValues' Step-0 does.
    await Promise.all([fn('factor-x', 0.7), fn('factor-x', 0), fn('factor-x', 1)]);

    const values = captured
      .map((b) => (b.graph.nodes as any[]).find((n) => n.id === 'factor-x').observed_state.value)
      .sort((a: number, b: number) => a - b);
    expect(values).toEqual([0, 0.7, 1]);                           // each probe its own value
  });

  it('handles a target factor absent from the graph (no crash; graph unchanged; PU inserted)', async () => {
    // Defensive only: production selection prevents this (current_value comes from the
    // graph, so a flip candidate is always a graph node).
    let captured: any = null;
    const mockCallAnalysis = async (_ep: string, body: unknown) => {
      captured = body;
      return { data: { results: [{ option_id: 'opt-a', win_probability: 1.0 }] } };
    };
    const req = makeGraphRequest();
    const fn = createISLInferenceFn(mockCallAnalysis, req, 'req-1');

    await fn('factor-missing', 0.42);

    // No spurious node added; existing graph nodes/values intact.
    expect((captured.graph.nodes as any[]).map((n) => n.id)).toEqual(['factor-x', 'factor-y', 'goal']);
    expect((captured.graph.nodes as any[]).find((n) => n.id === 'factor-x').observed_state.value).toBe(0.7);
    // PU still gets the factor inserted (existing fallback behaviour for non-graph factors).
    const puMissing = (captured.parameter_uncertainties as any[]).find((p) => p.node_id === 'factor-missing');
    expect(puMissing.mean).toBe(0.42);
  });

  // ===========================================================================
  // Seed forwarding + intentional common random numbers (CRN)
  //
  // The probe request must carry the SAME resolved seed PLoT forwards to the
  // main ISL analysis call (originalRequest.seed). run.ts sets that field to
  // plotSeedUsed = resolveSeed(providedSeed, graph): the explicit request seed,
  // or the PLoT-derived seed when omitted. Holding it constant across every
  // probe keeps CRN deterministic and aligns the probe world with the base
  // analysis. See createISLInferenceFn doc-comment.
  // ===========================================================================

  it('forwards the resolved analysis seed on the probe request', async () => {
    let captured: any = null;
    const mockCallAnalysis = async (_ep: string, body: unknown) => {
      captured = body;
      return { data: { results: [{ option_id: 'opt-a', win_probability: 1.0 }] } };
    };
    const req = { ...makeGraphRequest(), seed: '4242' };
    const fn = createISLInferenceFn(mockCallAnalysis, req, 'req-1');

    await fn('factor-x', 0.25);

    expect(captured.seed).toBe('4242');
  });

  it('forwards a PLoT-derived (omitted-then-resolved) numeric seed verbatim', async () => {
    // When the request omits seed, run.ts resolves a derived seed from the
    // canonical request/graph (resolveSeed → deriveSeedFromHash) BEFORE building
    // islRequest, so originalRequest.seed is already the resolved derived value.
    // The probe must forward that derived seed unchanged — never re-derive,
    // never fall back to ISL's own graph-hash default.
    let captured: any = null;
    const mockCallAnalysis = async (_ep: string, body: unknown) => {
      captured = body;
      return { data: { results: [{ option_id: 'opt-a', win_probability: 1.0 }] } };
    };
    const derivedSeed = 464372930; // shape of a resolveSeed()-derived value
    const req = { ...makeGraphRequest(), seed: derivedSeed };
    const fn = createISLInferenceFn(mockCallAnalysis, req, 'req-1');

    await fn('factor-x', 0.5);

    expect(captured.seed).toBe(derivedSeed);
  });

  it('uses ONE constant seed across all probe points (intentional CRN, never per-probe)', async () => {
    const seenSeeds: unknown[] = [];
    const mockCallAnalysis = async (_ep: string, body: any) => {
      seenSeeds.push(body.seed);
      return { data: { results: [{ option_id: 'opt-a', win_probability: 1.0 }] } };
    };
    const req = { ...makeGraphRequest(), seed: '777' };
    const fn = createISLInferenceFn(mockCallAnalysis, req, 'req-1');

    // The three Step-0 probe points (baseline / min / max).
    await Promise.all([fn('factor-x', 0.7), fn('factor-x', 0), fn('factor-x', 1)]);

    expect(seenSeeds).toHaveLength(3);
    expect(seenSeeds).toEqual(['777', '777', '777']); // same seed at every probe
  });

  it('omits seed entirely when originalRequest has no seed (preserves seedless-caller default)', async () => {
    let captured: any = null;
    const mockCallAnalysis = async (_ep: string, body: unknown) => {
      captured = body;
      return { data: { results: [{ option_id: 'opt-a', win_probability: 1.0 }] } };
    };
    // makeGraphRequest() carries no seed.
    const fn = createISLInferenceFn(mockCallAnalysis, makeGraphRequest(), 'req-1');

    await fn('factor-x', 0.3);

    expect('seed' in captured).toBe(false); // key omitted → ISL graph-hash default applies
  });

  it('does not mutate the original request when forwarding the seed', async () => {
    const mockCallAnalysis = async () => ({ data: { results: [{ option_id: 'opt-a', win_probability: 1.0 }] } });
    const req = { ...makeGraphRequest(), seed: '4242' };
    const fn = createISLInferenceFn(mockCallAnalysis, req, 'req-1');

    await fn('factor-x', 0.1);

    expect(req.seed).toBe('4242'); // unchanged
  });

  // Boundary values: the probe forwards the resolved seed VERBATIM (no
  // normalisation — resolveSeed does that upstream). The conditional uses
  // explicit !== undefined && !== null, so falsy-but-valid seeds (0, '') are
  // forwarded; a future "simplify to a truthy check" would silently drop them
  // and break determinism for seed 0 — these cases lock that in.
  //
  // NB: '' is asserted as a PRESENT seed (forwarded), which documents this
  // layer's verbatim behaviour only. Whether an empty string is a *valid*
  // product-level seed (vs invalid/seedless) is a route/schema concern decided
  // by the /v2/run contract + resolveSeed(), not here — changing it would be a
  // separate route/schema change.
  it.each([
    { label: 'numeric string', seed: '4242', expected: '4242' },
    { label: 'number', seed: 4242, expected: 4242 },
    { label: 'zero (falsy but valid)', seed: 0, expected: 0 },
    { label: 'empty string (falsy but present)', seed: '', expected: '' },
    { label: 'non-numeric string', seed: 'derived-seed', expected: 'derived-seed' },
  ])('forwards a $label seed verbatim', async ({ seed, expected }) => {
    let captured: any = null;
    const mockCallAnalysis = async (_ep: string, body: unknown) => {
      captured = body;
      return { data: { results: [{ option_id: 'opt-a', win_probability: 1.0 }] } };
    };
    const fn = createISLInferenceFn(mockCallAnalysis, { ...makeGraphRequest(), seed }, 'req-1');

    await fn('factor-x', 0.4);

    expect('seed' in captured).toBe(true);
    expect(captured.seed).toBe(expected);
  });

  it.each([
    { label: 'explicit null', seed: null },
    { label: 'explicit undefined', seed: undefined },
  ])('omits the seed key for $label (preserves ISL graph-hash default)', async ({ seed }) => {
    let captured: any = null;
    const mockCallAnalysis = async (_ep: string, body: unknown) => {
      captured = body;
      return { data: { results: [{ option_id: 'opt-a', win_probability: 1.0 }] } };
    };
    const fn = createISLInferenceFn(mockCallAnalysis, { ...makeGraphRequest(), seed } as any, 'req-1');

    await fn('factor-x', 0.4);

    expect('seed' in captured).toBe(false);
  });
});

// =============================================================================
// Contract-faithful comparison — proves the probe now moves the field ISL reads
// =============================================================================

describe('resolveFlipValues() with a contract-faithful comparison (observed_state.value-driven)', () => {
  /**
   * Mock ISL comparison that derives the winner SOLELY from the target factor's
   * graph observed_state.value — the field ISL's comparison reads as the sampling
   * mean — and IGNORES parameter_uncertainties.mean entirely. This mirrors the
   * staging finding that comparison samples Normal(observed_state.value, PU.std).
   *
   * Under the previous PU-mean-only probe (which left observed_state.value
   * unchanged), this comparison returns the same winner at every probe → no_effect.
   * With the fix (probe mutates observed_state.value), low/high probes produce
   * different winners → a real flip is detected.
   */
  function contractFaithfulMock(factorId: string, flipThreshold: number) {
    return async (_ep: string, body: any) => {
      const node = (body.graph.nodes as any[]).find((n) => n.id === factorId);
      const v = node?.observed_state?.value ?? 0; // comparison reads the GRAPH value, not PU mean
      const aWins = v >= flipThreshold;
      return {
        data: {
          results: [
            { option_id: 'opt-a', win_probability: aWins ? 0.7 : 0.3 },
            { option_id: 'opt-b', win_probability: aWins ? 0.3 : 0.7 },
          ],
        },
      };
    };
  }

  function graphReq(targetValue: number) {
    return {
      graph: {
        nodes: [
          { id: 'delivery_gap', kind: 'factor', observed_state: { value: targetValue, std: 0.1, cap: 10, raw_value: targetValue * 10, unit: 'story_points' } },
          { id: 'cost', kind: 'factor', observed_state: { value: 0.5, std: 0.1, cap: 50000, raw_value: 25000, unit: 'GBP' } },
          { id: 'goal', kind: 'goal' },
        ],
        edges: [],
      },
      // delivery_gap is intervened on by ONLY opt-a (partially overridden), so the
      // PR #183 selection guard would NOT exclude it — i.e. a factor that legitimately
      // reaches probing in production. (The contract-faithful mock ignores options; this
      // is for fixture realism / coherence with the real selection flow.)
      options: [
        { id: 'opt-a', interventions: { 'delivery_gap': 0.1 } },
        { id: 'opt-b', interventions: { 'cost': 0.3 } },
      ],
      goal_node_id: 'goal',
      parameter_uncertainties: [
        { node_id: 'delivery_gap', distribution: 'normal', mean: targetValue, std: 0.1 },
        { node_id: 'cost', distribution: 'normal', mean: 0.5, std: 0.1 },
      ],
    };
  }

  it('detects a flip the comparison reads from observed_state.value (PU mean ignored)', async () => {
    const fn = createISLInferenceFn(contractFaithfulMock('delivery_gap', 0.5), graphReq(0.7), 'req-1');
    const candidate = makeCandidate({ factor_id: 'delivery_gap', current_value: 0.7, direction: 'decrease' });

    const { results } = await resolveFlipValues([candidate], fn, 'opt-a');

    // With the fix, low/high probes set different observed_state.value → winner moves.
    expect(results[0].flip_reason).toBe('found');
    expect(results[0].flip_value).not.toBeNull();
    expect(results[0].flip_value!).toBeCloseTo(0.5, 1);
    expect(results[0].alternative_winner_id).toBe('opt-b');
    expect(results[0].margin_sensitivity?.movement).toBe('flipped');
    // 3 Step-0 probes + bisection midpoints (probes_used > 3, iterations_used > 0).
    expect(results[0].probes_used!).toBeGreaterThan(3);
    expect(results[0].iterations_used!).toBeGreaterThan(0);
  });

  it('confirms the comparison ignores parameter_uncertainties.mean and tracks observed_state.value', async () => {
    const mock = contractFaithfulMock('delivery_gap', 0.5);
    const winner = (r: any) => [...r.data.results].sort((a, b) => b.win_probability - a.win_probability)[0].option_id;

    // Same observed_state.value (0.7), different PU mean → winner UNCHANGED (old probe field).
    const sameValueLowPU = graphReq(0.7); sameValueLowPU.parameter_uncertainties[0].mean = 0;
    const sameValueHighPU = graphReq(0.7); sameValueHighPU.parameter_uncertainties[0].mean = 1;
    expect(winner(await mock('x', sameValueLowPU))).toBe(winner(await mock('x', sameValueHighPU)));

    // Different observed_state.value → winner CHANGES (the field the fix mutates).
    expect(winner(await mock('x', graphReq(0.1)))).not.toBe(winner(await mock('x', graphReq(0.9))));
  });
});

// =============================================================================
// Margin Sensitivity Integration
// =============================================================================

describe('resolveFlipValues() margin_sensitivity integration', () => {
  /**
   * Mock that keeps the same winner at every probe but compresses the lead
   * margin at the lower bound. baseline: a=0.65 b=0.30 c=0.05 (margin 0.35),
   * min (factor=0): a=0.55 b=0.40 c=0.05 (margin 0.15 → delta -0.20),
   * max (factor=1): a=0.66 b=0.29 c=0.05 (margin 0.37 → delta +0.02).
   */
  function createMarginCompressionAtMinMock(): ISLInferenceFn {
    return async (_factorId: string, overrideMean: number): Promise<FlipInferenceResult> => {
      if (overrideMean <= 0) {
        return {
          options: [
            { option_id: 'opt-a', win_probability: 0.55 },
            { option_id: 'opt-b', win_probability: 0.40 },
            { option_id: 'opt-c', win_probability: 0.05 },
          ],
        };
      }
      if (overrideMean >= 1) {
        return {
          options: [
            { option_id: 'opt-a', win_probability: 0.66 },
            { option_id: 'opt-b', win_probability: 0.29 },
            { option_id: 'opt-c', win_probability: 0.05 },
          ],
        };
      }
      return {
        options: [
          { option_id: 'opt-a', win_probability: 0.65 },
          { option_id: 'opt-b', win_probability: 0.30 },
          { option_id: 'opt-c', win_probability: 0.05 },
        ],
      };
    };
  }

  it("emits margin_sensitivity 'weakened' alongside flip_reason 'no_effect_within_bounds' (iterations_used: 0 can coexist with non-none margin movement)", async () => {
    const mock = createMarginCompressionAtMinMock();
    const candidate = makeCandidate({ current_value: 0.5, direction: 'decrease' });

    const { results } = await resolveFlipValues([candidate], mock, 'opt-a');

    expect(results).toHaveLength(1);
    expect(results[0].flip_reason).toBe('no_effect_within_bounds');
    expect(results[0].iterations_used).toBe(0);
    expect(results[0].flip_value).toBeNull();
    expect(results[0].alternative_winner_id).toBeNull();

    expect(results[0].margin_sensitivity).toBeDefined();
    const ms = results[0].margin_sensitivity!;
    expect(ms.movement).toBe('weakened');
    expect(ms.baseline_leading_option_id).toBe('opt-a');
    expect(ms.baseline_runner_up_option_id).toBe('opt-b');
    expect(ms.strongest_direction).toBe('towards_min');
    expect(ms.strongest_probe_value).toBe(0);
    expect(ms.value_scale).toBe('normalised');
  });

  it("emits margin_sensitivity 'flipped' alongside found flip without disturbing existing fields", async () => {
    const mock = createMonotonicMock(0.35, 'opt-a', 'opt-b', 'decrease');
    const candidate = makeCandidate({ current_value: 0.7, direction: 'decrease' });

    const { results } = await resolveFlipValues([candidate], mock, 'opt-a');

    expect(results[0].flip_reason).toBe('found');
    expect(results[0].flip_value).not.toBeNull();
    expect(results[0].alternative_winner_id).toBe('opt-b');
    expect(results[0].margin_sensitivity?.movement).toBe('flipped');
  });

  it("emits margin_sensitivity 'none' for a genuinely flat factor", async () => {
    const mock = createNeverFlipMock('opt-a');
    const candidate = makeCandidate({ current_value: 0.5 });

    const { results } = await resolveFlipValues([candidate], mock, 'opt-a');

    expect(results[0].flip_reason).toBe('no_effect_within_bounds');
    expect(results[0].margin_sensitivity).toBeDefined();
    expect(results[0].margin_sensitivity!.movement).toBe('none');
    expect(results[0].margin_sensitivity!.strongest_direction).toBe('none');
    expect(results[0].margin_sensitivity!.strongest_probe_value).toBeNull();
  });

  it('omits margin_sensitivity when the probe phase fails with an exception', async () => {
    const mock = createErrorMock();
    const candidate = makeCandidate({ current_value: 0.5 });

    const { results } = await resolveFlipValues([candidate], mock, 'opt-a');

    expect(results[0].flip_reason).toBe('error');
    expect(results[0].margin_sensitivity).toBeUndefined();
  });

  it('omits margin_sensitivity when current_value is non-finite (skips probes entirely)', async () => {
    const mock = createNeverFlipMock();
    const candidate = makeCandidate({ current_value: Number.NaN });

    const { results } = await resolveFlipValues([candidate], mock, 'opt-a');

    expect(results[0].flip_reason).toBe('error');
    expect(results[0].margin_sensitivity).toBeUndefined();
  });

  // =========================================================================
  // Argmax tie-handling — must match topTwo()'s lexicographic tie-break so a
  // baseline/bound exact tie cannot produce a spurious 'flipped' movement
  // purely from ISL option-array order.
  // =========================================================================

  describe('exact tie handling in getArgmaxOption (via no-flip-on-tie)', () => {
    /**
     * Mock that returns the same two equal-probability options at every probe,
     * but rotates the *order* of options[] in the returned array. Under a
     * naive first-wins argmax, baseline 'a-first' vs min 'b-first' would
     * register a spurious winner change (W0='a', W_min='b') and trigger
     * strict-flip detection. With deterministic lex tie-break, both probes
     * return 'a' (lexicographically smaller) and no flip is detected.
     */
    function createTieRotatingMock(): ISLInferenceFn {
      let n = 0;
      return async (): Promise<FlipInferenceResult> => {
        const flip = n++ % 2 === 0;
        return {
          options: flip
            ? [
                { option_id: 'a', win_probability: 0.5 },
                { option_id: 'b', win_probability: 0.5 },
              ]
            : [
                { option_id: 'b', win_probability: 0.5 },
                { option_id: 'a', win_probability: 0.5 },
              ],
        };
      };
    }

    it('treats exact ties consistently regardless of ISL options[] order (no spurious flip)', async () => {
      const mock = createTieRotatingMock();
      const candidate = makeCandidate({ current_value: 0.5 });

      const { results } = await resolveFlipValues([candidate], mock, 'a');

      // With tie-broken argmax, W0 === W_min === W_max === 'a' → no_effect.
      expect(results[0].flip_reason).toBe('no_effect_within_bounds');
      expect(results[0].flip_value).toBeNull();
      expect(results[0].iterations_used).toBe(0);
      expect(results[0].alternative_winner_id).toBeNull();
      // Margin-sensitivity should report 'none' — both leader and runner-up
      // are tied, margins are zero, no movement.
      expect(results[0].margin_sensitivity?.movement).toBe('none');
      expect(results[0].margin_sensitivity?.baseline_leading_option_id).toBe('a');
      expect(results[0].margin_sensitivity?.baseline_runner_up_option_id).toBe('b');
    });

    it('picks lexicographically-smaller option_id on exact win_probability ties', async () => {
      // Single-probe sanity check: order does not change the result.
      const mockBFirst: ISLInferenceFn = async () => ({
        options: [
          { option_id: 'b', win_probability: 0.6 },
          { option_id: 'a', win_probability: 0.6 },
        ],
      });
      const candidate = makeCandidate({ current_value: 0.5 });
      const { results } = await resolveFlipValues([candidate], mockBFirst, 'a');
      // Baseline leader from topTwo and strict-flip W0 should both pick 'a'
      // (deterministic lex order), not 'b' (first-in-array under naive argmax).
      expect(results[0].flip_reason).toBe('no_effect_within_bounds');
      expect(results[0].margin_sensitivity?.baseline_leading_option_id).toBe('a');
    });
  });
});

// =============================================================================
// Seed-driven flip determinism (end-to-end through the real createISLInferenceFn)
//
// These exercise the FULL probe path: resolveFlipValues → real
// createISLInferenceFn → ISL request body (with the forwarded seed) → a
// seed-sensitive ISL stub. They prove the forwarded seed actually changes what
// the search converges to, and that the same seed is deterministic.
// =============================================================================

describe('resolveFlipValues() — seed forwarding drives flip determinism', () => {
  /**
   * Seed-sensitive ISL comparison stub: the flip point depends on body.seed.
   * Winner is opt-a when the probed observed_state.value is at/above a
   * seed-derived threshold in (0, baseline). Mirrors ISL's real behaviour
   * (the seed shifts the sampled flip point) without a Monte Carlo sampler.
   * Also records every seed it observed, for CRN/consistency assertions.
   */
  function seedThreshold(seed: unknown): number {
    const n = Number(seed);
    const s = Number.isFinite(n) ? Math.abs(Math.trunc(n)) : 0;
    return 0.3 + (s % 5) * 0.05; // 0.30, 0.35, 0.40, 0.45, 0.50 — all inside (0, 0.7)
  }

  function makeSeedSensitiveCallAnalysis(factorId: string) {
    const seenSeeds: unknown[] = [];
    const callAnalysis = async (_ep: string, body: any) => {
      seenSeeds.push(body.seed);
      const node = (body.graph.nodes as any[]).find((n) => n.id === factorId);
      const v = node?.observed_state?.value ?? 0;
      const aWins = v >= seedThreshold(body.seed); // decrease search: high value → opt-a
      return {
        data: {
          results: [
            { option_id: 'opt-a', win_probability: aWins ? 0.7 : 0.3 },
            { option_id: 'opt-b', win_probability: aWins ? 0.3 : 0.7 },
          ],
        },
      };
    };
    return { callAnalysis, seenSeeds };
  }

  function seedFlipRequest(seed: number) {
    return {
      graph: {
        nodes: [
          { id: 'delivery_gap', kind: 'factor', observed_state: { value: 0.7, std: 0.1, cap: 10, raw_value: 7, unit: 'story_points' } },
          { id: 'goal', kind: 'goal' },
        ],
        edges: [],
      },
      options: [
        { id: 'opt-a', interventions: {} },
        { id: 'opt-b', interventions: {} },
      ],
      goal_node_id: 'goal',
      n_samples: 1000,
      parameter_uncertainties: [
        { node_id: 'delivery_gap', distribution: 'normal', mean: 0.7, std: 0.1 },
      ],
      seed,
    };
  }

  const candidate = () => makeCandidate({ factor_id: 'delivery_gap', current_value: 0.7, direction: 'decrease' });

  it('same seed → identical flip result (deterministic)', async () => {
    const run = async () => {
      const { callAnalysis } = makeSeedSensitiveCallAnalysis('delivery_gap');
      const fn = createISLInferenceFn(callAnalysis, seedFlipRequest(10), 'req-seed');
      const { results } = await resolveFlipValues([candidate()], fn, 'opt-a');
      return results[0];
    };

    const a = await run();
    const b = await run();

    expect(a.flip_reason).toBe('found');
    expect(a.flip_value).not.toBeNull();
    expect(b.flip_value).toBe(a.flip_value); // byte-identical across repeats
    // seed 10 → threshold 0.30
    expect(a.flip_value!).toBeCloseTo(0.3, 1);
  });

  it('different seeds → different flip result (the forwarded seed is consumed)', async () => {
    const runWithSeed = async (seed: number) => {
      const { callAnalysis } = makeSeedSensitiveCallAnalysis('delivery_gap');
      const fn = createISLInferenceFn(callAnalysis, seedFlipRequest(seed), 'req-seed');
      const { results } = await resolveFlipValues([candidate()], fn, 'opt-a');
      return results[0];
    };

    const low = await runWithSeed(10); // threshold 0.30
    const high = await runWithSeed(14); // threshold 0.50

    expect(low.flip_reason).toBe('found');
    expect(high.flip_reason).toBe('found');
    expect(low.flip_value!).toBeCloseTo(0.3, 1);
    expect(high.flip_value!).toBeCloseTo(0.5, 1);
    expect(high.flip_value).not.toBe(low.flip_value); // seed changed the threshold
  });

  it('every probe in one search carries the same forwarded seed (CRN), and different searches carry different seeds', async () => {
    const a = makeSeedSensitiveCallAnalysis('delivery_gap');
    const fnA = createISLInferenceFn(a.callAnalysis, seedFlipRequest(10), 'req-a');
    await resolveFlipValues([candidate()], fnA, 'opt-a');

    const b = makeSeedSensitiveCallAnalysis('delivery_gap');
    const fnB = createISLInferenceFn(b.callAnalysis, seedFlipRequest(14), 'req-b');
    await resolveFlipValues([candidate()], fnB, 'opt-a');

    // Within a single search: every probe used the one resolved seed (CRN).
    expect(a.seenSeeds.length).toBeGreaterThan(3); // Step-0 (3) + bisection midpoints
    expect(new Set(a.seenSeeds)).toEqual(new Set([10]));
    expect(new Set(b.seenSeeds)).toEqual(new Set([14]));
    // Across searches: the probe requests carried different seeds.
    expect(new Set(a.seenSeeds)).not.toEqual(new Set(b.seenSeeds));
  });
});
