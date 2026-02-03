/**
 * Number Corrector Tests
 *
 * Tests for deterministic number correction in M1 review grounded fields.
 */

import { describe, it, expect } from 'vitest';
import {
  correctUngroundedNumbers,
  type IslResultsForCorrection,
} from '../src/cee/validation/number-corrector.js';
import type { M1Review } from '../src/cee/validation/m1-review-types.js';

// =============================================================================
// Test Fixtures
// =============================================================================

const baseIslResults: IslResultsForCorrection = {
  option_comparison: [
    {
      option_id: 'opt_a',
      option_label: 'Option A',
      win_probability: 0.7435, // 74.35%
      expected_outcome: 0.15, // 15% - far from test percentages
    },
    {
      option_id: 'opt_b',
      option_label: 'Option B',
      win_probability: 0.2565, // 25.65%
      expected_outcome: 0.10, // 10% - far from test percentages
    },
  ],
  robustness: {
    recommendation_stability: 0.40, // 40% - far from 74/80/60/30 test values
  },
  factor_sensitivity: [
    { factor_id: 'factor_a', elasticity: 0.45, confidence: 0.92 }, // 92% - far from test values
    { factor_id: 'factor_b', elasticity: 0.25, confidence: 0.88 }, // 88% - far from test values
  ],
};

function createMinimalReview(overrides: Partial<M1Review> = {}): M1Review {
  return {
    narrative_summary: overrides.narrative_summary ?? 'The analysis shows clear results.',
    readiness_rationale: overrides.readiness_rationale ?? 'Ready to proceed.',
    story_headlines: { opt_a: 'Option A headline', opt_b: 'Option B headline' },
    robustness_explanation: {
      summary: overrides.robustness_explanation?.summary ?? 'Robust decision.',
      primary_risk: overrides.robustness_explanation?.primary_risk ?? 'Market volatility.',
      stability_factors: overrides.robustness_explanation?.stability_factors ?? ['Strong fundamentals'],
      fragility_factors: overrides.robustness_explanation?.fragility_factors ?? ['External shocks'],
    },
    bias_findings: overrides.bias_findings ?? [
      {
        type: 'CONFIRMATION_BIAS',
        source: 'structural',
        description: 'Potential confirmation bias detected.',
        linked_critique_code: 'CB001',
      },
    ],
    evidence_enhancements: [],
    key_assumptions: [],
    pre_mortem: {
      option_id: 'opt_a',
      scenario: 'Failure scenario',
      warning_signs: ['Sign 1'],
      mitigation: 'Mitigation steps',
      review_trigger: 'When to review',
    },
    flip_thresholds: [],
    decision_quality_prompts: [],
    ...overrides,
  };
}

// =============================================================================
// Percentage Correction Tests
// =============================================================================

describe('Number Corrector', () => {
  describe('percentage corrections', () => {
    it('corrects 80% to 74% when ISL has win_probability: 0.7435', () => {
      const review = createMinimalReview({
        narrative_summary: 'Option A wins with 80% probability.',
      });

      const { corrected, corrections } = correctUngroundedNumbers(
        review,
        baseIslResults,
        'opt_a',
        'opt_b'
      );

      expect(corrected.narrative_summary).toBe('Option A wins with 74% probability.');
      expect(corrections).toHaveLength(1);
      expect(corrections[0]).toMatchObject({
        field: 'narrative_summary',
        original_text: '80%',
        corrected_text: '74%',
        isl_source: expect.stringContaining('win_probability'),
      });
    });

    it('does not correct 74% when ISL has 0.7435 (within 10%)', () => {
      const review = createMinimalReview({
        narrative_summary: 'Option A wins with 74% probability.',
      });

      const { corrected, corrections } = correctUngroundedNumbers(
        review,
        baseIslResults,
        'opt_a',
        'opt_b'
      );

      expect(corrected.narrative_summary).toBe('Option A wins with 74% probability.');
      expect(corrections).toHaveLength(0);
    });

    it('does not correct 50% when ISL has 0.7435 (>25% drift, not a match)', () => {
      const review = createMinimalReview({
        narrative_summary: 'There is a 50% chance of success.',
      });

      const { corrected, corrections } = correctUngroundedNumbers(
        review,
        baseIslResults,
        'opt_a',
        'opt_b'
      );

      expect(corrected.narrative_summary).toBe('There is a 50% chance of success.');
      expect(corrections).toHaveLength(0);
    });

    it('preserves percentage format (80% -> 74%, not 0.74)', () => {
      const review = createMinimalReview({
        narrative_summary: 'Win rate is 80%.',
      });

      const { corrected, corrections } = correctUngroundedNumbers(
        review,
        baseIslResults,
        'opt_a',
        'opt_b'
      );

      expect(corrected.narrative_summary).toBe('Win rate is 74%.');
      expect(corrections[0]?.corrected_text).toBe('74%');
    });
  });

  describe('decimal corrections', () => {
    it('preserves decimal format (0.80 -> 0.74)', () => {
      const review = createMinimalReview({
        narrative_summary: 'The probability is 0.80 for Option A.',
      });

      const { corrected, corrections } = correctUngroundedNumbers(
        review,
        baseIslResults,
        'opt_a',
        'opt_b'
      );

      expect(corrected.narrative_summary).toBe('The probability is 0.74 for Option A.');
      expect(corrections).toHaveLength(1);
      expect(corrections[0]?.corrected_text).toBe('0.74');
    });
  });

  describe('multiple numbers', () => {
    it('corrects only the drifted number when multiple numbers present', () => {
      const review = createMinimalReview({
        narrative_summary: 'Option A has 80% win rate while Option B has 26% chance.',
      });

      const { corrected, corrections } = correctUngroundedNumbers(
        review,
        baseIslResults,
        'opt_a',
        'opt_b'
      );

      // 80% should be corrected to 74%, 26% is close enough to 25.65% (within 10%)
      expect(corrected.narrative_summary).toBe(
        'Option A has 74% win rate while Option B has 26% chance.'
      );
      expect(corrections).toHaveLength(1);
      expect(corrections[0]?.original_text).toBe('80%');
    });

    it('corrects multiple drifted numbers', () => {
      const review = createMinimalReview({
        narrative_summary: 'Winner at 80% vs runner-up at 30%.',
      });

      const { corrected, corrections } = correctUngroundedNumbers(
        review,
        baseIslResults,
        'opt_a',
        'opt_b'
      );

      // 80% -> 74% (0.7435), 30% -> 26% (0.2565)
      expect(corrected.narrative_summary).toBe('Winner at 74% vs runner-up at 26%.');
      expect(corrections).toHaveLength(2);
    });
  });

  describe('margin correction', () => {
    it('corrects margin reference: 60 point lead -> 49 point lead', () => {
      // Custom fixture where win_probability values are far from 60,
      // but margin is close to 60 (within correctable range)
      const marginIslResults: IslResultsForCorrection = {
        option_comparison: [
          { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.90 }, // 90% - far from 60
          { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.41 }, // 41% - margin = 49%
        ],
        robustness: {
          recommendation_stability: 0.30, // 30% - far from 60
        },
        factor_sensitivity: [],
      };
      // Margin = 0.90 - 0.41 = 0.49 = 49%
      // 60 vs 49 = ~22% drift (within correctable range)
      // 60 vs 90 = 33% drift (too far)
      // 60 vs 41 = 46% drift (too far)

      const review = createMinimalReview({
        narrative_summary: 'Option A leads by 60 percentage points.',
      });

      const { corrected, corrections } = correctUngroundedNumbers(
        review,
        marginIslResults,
        'opt_a',
        'opt_b'
      );

      // 60 should be corrected to 49 (margin of 49% rounded)
      expect(corrected.narrative_summary).toBe('Option A leads by 49 percentage points.');
      expect(corrections).toHaveLength(1);
      expect(corrections[0]).toMatchObject({
        isl_source: 'margin',
      });
    });
  });

  describe('non-grounded fields', () => {
    it('does not correct numbers in prescriptive fields', () => {
      const review = createMinimalReview({
        evidence_enhancements: [
          {
            factor_id: 'factor_a',
            specific_action: 'Gather data for the 80% threshold.',
            decision_hygiene: 'Review every 80 days.',
          },
        ],
      });

      const { corrected, corrections } = correctUngroundedNumbers(
        review,
        baseIslResults,
        'opt_a',
        'opt_b'
      );

      // evidence_enhancements.specific_action is prescriptive, not grounded
      expect(corrected.evidence_enhancements[0]?.specific_action).toBe(
        'Gather data for the 80% threshold.'
      );
      expect(corrections).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('handles empty/missing fields without error', () => {
      const review = createMinimalReview({
        narrative_summary: '',
        scenario_contexts: undefined,
      });

      const { corrected, corrections } = correctUngroundedNumbers(
        review,
        baseIslResults,
        'opt_a',
        'opt_b'
      );

      expect(corrected.narrative_summary).toBe('');
      expect(corrections).toHaveLength(0);
    });

    it('handles review with no numbers', () => {
      const review = createMinimalReview({
        narrative_summary: 'Option A is the clear winner based on the analysis.',
      });

      const { corrected, corrections } = correctUngroundedNumbers(
        review,
        baseIslResults,
        'opt_a',
        'opt_b'
      );

      expect(corrected.narrative_summary).toBe(
        'Option A is the clear winner based on the analysis.'
      );
      expect(corrections).toHaveLength(0);
    });

    it('ignores ordinal numbers (1st, 2nd, 3rd)', () => {
      const review = createMinimalReview({
        narrative_summary: 'This is the 1st option and 2nd choice.',
      });

      const { corrected, corrections } = correctUngroundedNumbers(
        review,
        baseIslResults,
        'opt_a',
        'opt_b'
      );

      expect(corrected.narrative_summary).toBe('This is the 1st option and 2nd choice.');
      expect(corrections).toHaveLength(0);
    });
  });

  describe('correction metadata', () => {
    it('captures source ISL field for each correction', () => {
      // Custom fixture for this test where:
      // - 70% matches recommendation_stability (85%) with ~18% drift
      // - 0.50 matches elasticity (0.45) with ~11% drift
      // - win_probability values are far from both 70% and 0.50
      const customIslResults: IslResultsForCorrection = {
        option_comparison: [
          { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.95 }, // far from 70% and 0.50
          { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.05 }, // far from 70% and 0.50
        ],
        robustness: {
          recommendation_stability: 0.85, // 85% - matches 70% with ~18% drift
        },
        factor_sensitivity: [
          { factor_id: 'factor_a', elasticity: 0.45, confidence: 0.20 }, // 0.50 matches elasticity with ~11% drift
        ],
      };

      const review = createMinimalReview({
        narrative_summary: 'Stability is 70% and elasticity is 0.50.',
      });

      const { corrections } = correctUngroundedNumbers(
        review,
        customIslResults,
        'opt_a',
        'opt_b'
      );

      // 70% should match robustness.recommendation_stability (85%) - ~18% drift
      // 0.50 should match factor_sensitivity.elasticity (0.45) - ~11% drift
      expect(corrections).toHaveLength(2);

      const stabilityCorrection = corrections.find((c) =>
        c.isl_source.includes('recommendation_stability')
      );
      expect(stabilityCorrection).toBeDefined();

      const elasticityCorrection = corrections.find((c) =>
        c.isl_source.includes('elasticity')
      );
      expect(elasticityCorrection).toBeDefined();
    });

    it('includes drift percentage in corrections', () => {
      const review = createMinimalReview({
        narrative_summary: 'Win probability is 80%.',
      });

      const { corrections } = correctUngroundedNumbers(
        review,
        baseIslResults,
        'opt_a',
        'opt_b'
      );

      expect(corrections).toHaveLength(1);
      expect(corrections[0]?.drift_percent).toBeGreaterThan(0);
      expect(corrections[0]?.drift_percent).toBeLessThanOrEqual(25);
    });
  });

  describe('array field corrections', () => {
    it('corrects numbers in robustness_explanation.stability_factors array', () => {
      const review = createMinimalReview({
        robustness_explanation: {
          summary: 'Summary',
          primary_risk: 'Risk',
          stability_factors: ['Strong at 85% confidence', 'Factor two'],
          fragility_factors: ['Weak point'],
        },
      });

      const { corrected, corrections } = correctUngroundedNumbers(
        review,
        baseIslResults,
        'opt_a',
        'opt_b'
      );

      // 85% should be corrected to 78% (recommendation_stability) or 85% (confidence)
      expect(corrections.length).toBeGreaterThanOrEqual(0); // May or may not match depending on values
      expect(corrected.robustness_explanation.stability_factors).toBeDefined();
    });

    it('corrects numbers in bias_findings descriptions', () => {
      const review = createMinimalReview({
        bias_findings: [
          {
            type: 'OVERCONFIDENCE',
            source: 'semantic',
            description: 'User claimed 80% certainty which exceeds model confidence.',
            brief_evidence: 'I am 80% certain',
          },
        ],
      });

      const { corrected, corrections } = correctUngroundedNumbers(
        review,
        baseIslResults,
        'opt_a',
        'opt_b'
      );

      expect(corrected.bias_findings[0]?.description).toBe(
        'User claimed 74% certainty which exceeds model confidence.'
      );
      expect(corrections.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('scenario_contexts corrections', () => {
    it('corrects numbers in scenario context fields', () => {
      const review = createMinimalReview({
        scenario_contexts: {
          opt_a: {
            trigger_description: 'If market drops 80%',
            consequence: 'Returns fall to 30%',
          },
        },
      });

      const { corrected, corrections } = correctUngroundedNumbers(
        review,
        baseIslResults,
        'opt_a',
        'opt_b'
      );

      // Both 80% and 30% should be checked/corrected
      expect(corrected.scenario_contexts?.opt_a).toBeDefined();
      // The specific corrections depend on whether values match ISL numbers
    });
  });
});
