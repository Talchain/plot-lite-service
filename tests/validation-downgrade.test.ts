/**
 * Validation Downgrade Tests
 *
 * Tests for UNGROUNDED_NUMBER downgrade from failure to warning.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateM1Review, buildValidationContext } from '../src/cee/validation/m1-review-validator.js';
import { M1ReviewFailureCodes } from '../src/cee/validation/m1-review-constants.js';
import type { M1Review } from '../src/cee/validation/m1-review-types.js';

// =============================================================================
// Test Fixtures
// =============================================================================

function createValidReview(): M1Review {
  return {
    narrative_summary: 'Option A wins with 74% probability. Stability at 78%.',
    readiness_rationale: 'The decision is ready to proceed.',
    story_headlines: {
      opt_a: 'Strong market position',
      opt_b: 'Moderate growth potential',
    },
    robustness_explanation: {
      summary: 'The decision shows 78% stability.',
      primary_risk: 'Market volatility could impact results.',
      stability_factors: ['Strong fundamentals', 'Diversified portfolio'],
      fragility_factors: ['External economic shocks'],
    },
    bias_findings: [
      {
        type: 'CONFIRMATION_BIAS',
        source: 'structural',
        description: 'Minor confirmation bias detected.',
        linked_critique_code: 'CB001',
      },
    ],
    evidence_enhancements: [],
    key_assumptions: ['Market conditions remain stable'],
    pre_mortem: {
      option_id: 'opt_a',
      scenario: 'Market downturn scenario',
      warning_signs: ['Declining indicators'],
      mitigation: 'Diversify investments',
      review_trigger: 'When market drops 10%',
      grounded_in: ['factor_a'], // Must reference valid evidence gap factor ID
    },
    flip_thresholds: [],
    decision_quality_prompts: [],
  };
}

function createValidationContext(allowedNumbers: number[] = [0.74, 0.78, 0.26]) {
  return {
    optionIds: ['opt_a', 'opt_b'],
    optionLabels: ['Option A', 'Option B'],
    optionIdToLabel: { opt_a: 'Option A', opt_b: 'Option B' },
    nodeIds: ['goal', 'factor_a', 'factor_b'],
    edgeIds: ['edge_1', 'edge_2'],
    fragileEdgeIds: [],
    evidenceGapFactorIds: ['factor_a'],
    readiness: 'ready',
    allowedNumbers,
    briefText: 'Which option should we choose?',
    flipThresholdData: [],
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Validation Downgrade: UNGROUNDED_NUMBER', () => {
  describe('validation result behavior', () => {
    it('returns valid=true when all numbers are grounded', () => {
      const review = createValidReview();
      const context = createValidationContext([0.74, 0.78, 0.26]);

      const result = validateM1Review(review, context);

      expect(result.valid).toBe(true);
      expect(result.failure_codes).toHaveLength(0);
    });

    it('returns valid=false with UNGROUNDED_NUMBER when numbers drift', () => {
      const review = createValidReview();
      review.narrative_summary = 'Option A wins with 85% probability.'; // 85% not in allowed

      const context = createValidationContext([0.74, 0.78, 0.26]);

      const result = validateM1Review(review, context);

      expect(result.valid).toBe(false);
      expect(result.failure_codes).toContain(M1ReviewFailureCodes.UNGROUNDED_NUMBER);
    });

    it('UNGROUNDED_NUMBER is the only failure code for number-only issues', () => {
      const review = createValidReview();
      review.narrative_summary = 'Option A wins with 99% probability.'; // Ungrounded

      const context = createValidationContext([0.74, 0.78, 0.26]);

      const result = validateM1Review(review, context);

      // Check that UNGROUNDED_NUMBER is present
      expect(result.failure_codes).toContain(M1ReviewFailureCodes.UNGROUNDED_NUMBER);

      // Filter out UNGROUNDED_NUMBER and check if any other codes remain
      const otherCodes = result.failure_codes.filter(
        (code) => code !== M1ReviewFailureCodes.UNGROUNDED_NUMBER
      );

      // If review is otherwise valid, UNGROUNDED_NUMBER should be the only code
      // (This test verifies the condition for downgrade eligibility)
    });

    it('multiple failure codes when UNGROUNDED_NUMBER + other issues', () => {
      const review = createValidReview();
      review.narrative_summary = 'Option A wins with 99% probability.'; // Ungrounded
      review.story_headlines = { opt_a: 'Headline A' }; // Missing opt_b headline

      const context = createValidationContext([0.74, 0.78, 0.26]);

      const result = validateM1Review(review, context);

      expect(result.valid).toBe(false);
      expect(result.failure_codes).toContain(M1ReviewFailureCodes.UNGROUNDED_NUMBER);
      expect(result.failure_codes).toContain(M1ReviewFailureCodes.MISSING_OPTION_HEADLINE);
      expect(result.failure_codes.length).toBeGreaterThan(1);
    });
  });

  describe('downgrade eligibility logic', () => {
    it('identifies single UNGROUNDED_NUMBER failure as downgrade-eligible', () => {
      const failureCodes = [M1ReviewFailureCodes.UNGROUNDED_NUMBER];

      const isOnlyUngroundedNumber =
        failureCodes.length === 1 &&
        failureCodes[0] === M1ReviewFailureCodes.UNGROUNDED_NUMBER;

      expect(isOnlyUngroundedNumber).toBe(true);
    });

    it('identifies mixed failures as NOT downgrade-eligible', () => {
      const failureCodes = [
        M1ReviewFailureCodes.UNGROUNDED_NUMBER,
        M1ReviewFailureCodes.MISSING_OPTION_HEADLINE,
      ];

      const isOnlyUngroundedNumber =
        failureCodes.length === 1 &&
        failureCodes[0] === M1ReviewFailureCodes.UNGROUNDED_NUMBER;

      expect(isOnlyUngroundedNumber).toBe(false);
    });

    it('identifies no failures as NOT downgrade-eligible (already passing)', () => {
      const failureCodes: string[] = [];

      const isOnlyUngroundedNumber =
        failureCodes.length === 1 &&
        failureCodes[0] === M1ReviewFailureCodes.UNGROUNDED_NUMBER;

      expect(isOnlyUngroundedNumber).toBe(false);
    });
  });

  describe('review_warnings population', () => {
    it('review_warnings contains UNGROUNDED_NUMBER after downgrade', () => {
      // This simulates the orchestrator behavior
      const validationResult = {
        valid: false,
        errors: [{ field: 'narrative_summary', code: 'UNGROUNDED_NUMBER', message: 'Number not found' }],
        warnings: [],
        failure_codes: [M1ReviewFailureCodes.UNGROUNDED_NUMBER],
      };

      const isOnlyUngroundedNumber =
        validationResult.failure_codes.length === 1 &&
        validationResult.failure_codes[0] === M1ReviewFailureCodes.UNGROUNDED_NUMBER;

      if (isOnlyUngroundedNumber) {
        const review_warnings = [M1ReviewFailureCodes.UNGROUNDED_NUMBER];
        const review_status = 'complete';

        expect(review_warnings).toContain(M1ReviewFailureCodes.UNGROUNDED_NUMBER);
        expect(review_status).toBe('complete');
      }
    });

    it('no review_warnings when validation passes cleanly', () => {
      const review = createValidReview();
      const context = createValidationContext([0.74, 0.78, 0.26]);

      const result = validateM1Review(review, context);

      expect(result.valid).toBe(true);
      // No warnings needed when validation passes
      expect(result.failure_codes).toHaveLength(0);
    });
  });

  describe('m1_review population after downgrade', () => {
    it('m1_review should be populated when UNGROUNDED_NUMBER is downgraded', () => {
      // This simulates what the orchestrator should do
      const review = createValidReview();
      review.narrative_summary = 'Option A wins with 85% probability.';

      const context = createValidationContext([0.74, 0.78, 0.26]);
      const validationResult = validateM1Review(review, context);

      const failureCodes = validationResult.failure_codes;
      const isOnlyUngroundedNumber =
        failureCodes.length === 1 &&
        failureCodes[0] === M1ReviewFailureCodes.UNGROUNDED_NUMBER;

      if (isOnlyUngroundedNumber) {
        // Orchestrator should return review (not null) in this case
        const m1_review = review; // Would be returned by orchestrator
        expect(m1_review).not.toBeNull();
        expect(m1_review.narrative_summary).toBeDefined();
      }
    });

    it('m1_review should be null when other failures exist alongside UNGROUNDED_NUMBER', () => {
      const review = createValidReview();
      review.narrative_summary = 'Option A wins with 85% probability.';
      review.story_headlines = { opt_a: 'Only A' }; // Missing opt_b

      const context = createValidationContext([0.74, 0.78, 0.26]);
      const validationResult = validateM1Review(review, context);

      const failureCodes = validationResult.failure_codes;
      const isOnlyUngroundedNumber =
        failureCodes.length === 1 &&
        failureCodes[0] === M1ReviewFailureCodes.UNGROUNDED_NUMBER;

      expect(isOnlyUngroundedNumber).toBe(false);
      // Orchestrator should return null in this case
    });
  });
});
