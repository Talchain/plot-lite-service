/**
 * Golden Fixtures - Near-Tie Detection Tests
 *
 * Purpose: Validate near-tie detection when top options are statistically equivalent.
 *
 * Scenario: near-tie-canary
 * Options: opt_a (0.48) vs opt_b (0.52)
 * Gap: 0.04 < threshold (0.10) → is_tie: true
 */

import { describe, it, expect } from 'vitest';
import { loadScenario } from './fixtures.js';
import { NEAR_TIE_THRESHOLD } from '../../src/trust/result-coherence.js';

// Load fixtures from contracts/examples/
const { islResponse, plotResponse } = loadScenario('near-tie-canary');

// Type definitions for fixture data
interface NearTieInfo {
  is_tie: boolean;
  top_option_id: string;
  second_option_id: string | null;
  tied_option_ids: string[];
  gap: number;
  threshold: number;
}

interface Robustness {
  recommendation_stability: number;
  recommended_option_id?: string;
  recommended_option_label?: string;
  fragile_edges: unknown[];
  robust_edges: unknown[];
  near_tie?: NearTieInfo;
}

interface OptionResult {
  option_id?: string;
  id?: string;
  win_probability: number;
}

describe('Golden Fixtures - Near-Tie Canary', () => {
  describe('Near-Tie Detection', () => {
    const robustness = plotResponse.robustness as Robustness;
    const nearTie = robustness.near_tie;

    it('near_tie object is present in robustness', () => {
      expect(nearTie).toBeDefined();
    });

    it('near_tie.is_tie is true for gap < threshold', () => {
      expect(nearTie!.is_tie).toBe(true);
    });

    it('near_tie.gap matches computed value from win_probability', () => {
      const options = plotResponse.option_comparison as OptionResult[];
      const winProbs = options.map((o) => o.win_probability);
      const sortedWinProbs = [...winProbs].sort((a, b) => b - a);
      const expectedGap = sortedWinProbs[0] - sortedWinProbs[1];

      // Use toBeCloseTo for floating point comparison
      expect(nearTie!.gap).toBeCloseTo(expectedGap, 10);
    });

    it('near_tie.gap = 0.04 (0.52 - 0.48)', () => {
      expect(nearTie!.gap).toBe(0.04);
    });

    it('near_tie.threshold matches NEAR_TIE_THRESHOLD constant', () => {
      expect(nearTie!.threshold).toBe(NEAR_TIE_THRESHOLD);
      expect(nearTie!.threshold).toBe(0.10);
    });

    it('near_tie.top_option_id is option with highest win_probability', () => {
      const options = plotResponse.option_comparison as OptionResult[];
      const maxWinProb = Math.max(...options.map((o) => o.win_probability));
      const winner = options.find((o) => o.win_probability === maxWinProb);

      expect(nearTie!.top_option_id).toBe(winner?.option_id ?? winner?.id);
    });

    it('near_tie.top_option_id = opt_b', () => {
      expect(nearTie!.top_option_id).toBe('opt_b');
    });

    it('near_tie.second_option_id = opt_a', () => {
      expect(nearTie!.second_option_id).toBe('opt_a');
    });

    it('near_tie.tied_option_ids contains both options', () => {
      expect(nearTie!.tied_option_ids).toContain('opt_b');
      expect(nearTie!.tied_option_ids).toContain('opt_a');
      expect(nearTie!.tied_option_ids).toHaveLength(2);
    });
  });

  describe('Recommended Option Alignment', () => {
    const robustness = plotResponse.robustness as Robustness;
    const nearTie = robustness.near_tie;

    it('recommended_option_id matches near_tie.top_option_id', () => {
      expect(robustness.recommended_option_id).toBe(nearTie!.top_option_id);
    });

    it('recommended_option_id = opt_b', () => {
      expect(robustness.recommended_option_id).toBe('opt_b');
    });

    it('recommended_option_label is present', () => {
      expect(robustness.recommended_option_label).toBeDefined();
      expect(typeof robustness.recommended_option_label).toBe('string');
    });
  });

  describe('ISL -> PLoT Passthrough', () => {
    it('recommendation_stability passes through unchanged', () => {
      expect((plotResponse.robustness as Robustness).recommendation_stability).toBe(
        (islResponse.robustness as Robustness).recommendation_stability
      );
    });

    it('win_probability values match ISL response', () => {
      const plotOptions = plotResponse.option_comparison as OptionResult[];
      const islOptions = islResponse.options as OptionResult[];

      const plotMap = new Map(plotOptions.map((o) => [o.option_id ?? o.id, o.win_probability]));
      const islMap = new Map(islOptions.map((o) => [o.id ?? o.option_id, o.win_probability]));

      plotMap.forEach((plotWinProb, optionId) => {
        expect(plotWinProb).toBe(islMap.get(optionId));
      });
    });
  });

  describe('Semantic Validity', () => {
    it('win_probability sums to ~1', () => {
      const options = plotResponse.option_comparison as OptionResult[];
      const sum = options.reduce((s, o) => s + o.win_probability, 0);
      expect(sum).toBeGreaterThanOrEqual(0.98);
      expect(sum).toBeLessThanOrEqual(1.02);
    });

    it('near_tie.gap is in [0, 1]', () => {
      const nearTie = (plotResponse.robustness as Robustness).near_tie;
      expect(nearTie!.gap).toBeGreaterThanOrEqual(0);
      expect(nearTie!.gap).toBeLessThanOrEqual(1);
    });

    it('near_tie.threshold is in [0, 1]', () => {
      const nearTie = (plotResponse.robustness as Robustness).near_tie;
      expect(nearTie!.threshold).toBeGreaterThanOrEqual(0);
      expect(nearTie!.threshold).toBeLessThanOrEqual(1);
    });
  });

  describe('Canary Qualification', () => {
    it('is a valid near-tie case (gap < threshold)', () => {
      const nearTie = (plotResponse.robustness as Robustness).near_tie;
      expect(nearTie!.gap).toBeLessThan(nearTie!.threshold);
    });

    it('options have distinct but close win_probability', () => {
      const options = plotResponse.option_comparison as OptionResult[];
      expect(options).toHaveLength(2);

      const winProbs = options.map((o) => o.win_probability);
      expect(winProbs[0]).not.toBe(winProbs[1]); // Not exact tie
      expect(Math.abs(winProbs[0] - winProbs[1])).toBeLessThan(0.10); // Within threshold
    });
  });
});
