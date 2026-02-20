/**
 * Expanded Validation Downgrade Tests
 *
 * Tests for warning-grade failure code downgrade eligibility.
 *
 * WARNING_GRADE_CODES (14 codes) — imported from m1-review-constants.ts:
 *   T1: MISSING_OPTION_HEADLINE (B1.2: downgraded — review still actionable)
 *   T2: CONSEQUENCE_INVALID_OPTION, INVALID_SCENARIO_EDGE
 *   T3: READINESS_CONTRADICTION, READINESS_MISALIGNMENT
 *   T4: UNGROUNDED_NUMBER
 *   T5: MISSING_CRITIQUE_CODE (B1.2: downgraded), MISSING_BRIEF_EVIDENCE, BRIEF_EVIDENCE_TOO_SHORT, BRIEF_EVIDENCE_NOT_SUBSTRING
 *   T6: PREMORTEM_NOT_GROUNDED, INVALID_GROUNDING_ID
 *   T8: STRUCTURAL_LIMIT_EXCEEDED
 *   T9: INVALID_PROMPT_STRUCTURE
 *
 * Blocking codes (1 code — hard failure):
 *   T7: MODIFIED_VALUES
 */

import { describe, it, expect } from 'vitest';
import { validateM1Review } from '../src/cee/validation/m1-review-validator.js';
import { M1ReviewFailureCodes, WARNING_GRADE_CODES } from '../src/cee/validation/m1-review-constants.js';
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
      grounded_in: ['factor_a'],
    },
    flip_thresholds: [],
    decision_quality_prompts: [],
  };
}

function createContext(overrides?: {
  readiness?: string;
  allowedNumbers?: number[];
  briefText?: string;
}) {
  return {
    optionIds: ['opt_a', 'opt_b'],
    optionLabels: ['Option A', 'Option B'],
    optionIdToLabel: { opt_a: 'Option A', opt_b: 'Option B' },
    nodeIds: ['goal', 'factor_a', 'factor_b'],
    edgeIds: ['edge_1', 'edge_2'],
    fragileEdgeIds: [],
    evidenceGapFactorIds: ['factor_a'],
    readiness: overrides?.readiness ?? 'ready',
    allowedNumbers: overrides?.allowedNumbers ?? [0.74, 0.78, 0.26],
    briefText: overrides?.briefText ?? 'Which option should we choose for revenue growth?',
    flipThresholdData: [],
  };
}

// Simulates the orchestrator's downgrade logic
function isDowngradeEligible(failureCodes: string[]): boolean {
  return (
    failureCodes.length > 0 &&
    failureCodes.every((code) => WARNING_GRADE_CODES.has(code))
  );
}

// =============================================================================
// READINESS_CONTRADICTION downgrade tests
// =============================================================================

describe('Validation Downgrade: READINESS_CONTRADICTION', () => {
  it('READINESS_CONTRADICTION only → valid=false from validator, but downgrade-eligible', () => {
    const review = createValidReview();
    // "ready to proceed" is a forbidden phrase for needs_evidence readiness
    review.narrative_summary = 'Option A wins with 74% probability. This is ready to proceed.';
    review.readiness_rationale = 'We are confident in this decision. Stability at 78%.';

    const context = createContext({
      readiness: 'needs_evidence',
      allowedNumbers: [0.74, 0.78, 0.26],
    });
    const result = validateM1Review(review, context);

    expect(result.valid).toBe(false);
    expect(result.failure_codes).toContain(M1ReviewFailureCodes.READINESS_CONTRADICTION);

    // Filter to only READINESS_CONTRADICTION and READINESS_MISALIGNMENT (both warning-grade)
    const nonWarningCodes = result.failure_codes.filter(
      (code) => !WARNING_GRADE_CODES.has(code)
    );
    expect(nonWarningCodes).toHaveLength(0);
    expect(isDowngradeEligible(result.failure_codes)).toBe(true);
  });

  it('READINESS_CONTRADICTION + blocking failure (MODIFIED_VALUES) → NOT downgrade-eligible', () => {
    const review = createValidReview();
    review.narrative_summary = 'This is ready to proceed with 74% certainty.';
    review.readiness_rationale = 'We are confident. Stability at 78%.';
    // Trigger MODIFIED_VALUES: tamper with flip threshold current_value
    review.flip_thresholds = [
      { factor_id: 'factor_a', current_value: 999, flip_value: 0.5, label: 'Factor A' },
    ];

    const context = createContext({ readiness: 'needs_evidence' });
    context.flipThresholdData = [
      { factor_id: 'factor_a', factor_label: 'Factor A', current_value: 0.5, flip_value: 0.8, direction: 'decrease' as const, flip_reason: 'found' as const, iterations_used: 5 },
    ];
    const result = validateM1Review(review, context);

    expect(result.failure_codes).toContain(M1ReviewFailureCodes.READINESS_CONTRADICTION);
    expect(result.failure_codes).toContain(M1ReviewFailureCodes.MODIFIED_VALUES);
    expect(isDowngradeEligible(result.failure_codes)).toBe(false);
  });
});

// =============================================================================
// UNGROUNDED_NUMBER downgrade tests
// =============================================================================

describe('Validation Downgrade: UNGROUNDED_NUMBER (expanded)', () => {
  it('UNGROUNDED_NUMBER only → downgrade-eligible', () => {
    const review = createValidReview();
    review.narrative_summary = 'Option A wins with 99% probability.'; // 99 not in allowed

    const context = createContext({ allowedNumbers: [0.74, 0.78, 0.26] });
    const result = validateM1Review(review, context);

    expect(result.failure_codes).toContain(M1ReviewFailureCodes.UNGROUNDED_NUMBER);
    expect(isDowngradeEligible(result.failure_codes)).toBe(true);
  });

  it('UNGROUNDED_NUMBER + READINESS_CONTRADICTION → still downgrade-eligible (both warning-grade)', () => {
    const review = createValidReview();
    review.narrative_summary = 'This is ready to proceed with 99% confidence.';
    review.readiness_rationale = 'We are confident in this.';

    const context = createContext({
      readiness: 'needs_evidence',
      allowedNumbers: [0.74, 0.78, 0.26],
    });
    const result = validateM1Review(review, context);

    expect(result.failure_codes).toContain(M1ReviewFailureCodes.UNGROUNDED_NUMBER);
    expect(result.failure_codes).toContain(M1ReviewFailureCodes.READINESS_CONTRADICTION);
    expect(isDowngradeEligible(result.failure_codes)).toBe(true);
  });
});

// =============================================================================
// MISSING_BRIEF_EVIDENCE downgrade tests
// =============================================================================

describe('Validation Downgrade: MISSING_BRIEF_EVIDENCE', () => {
  it('MISSING_BRIEF_EVIDENCE only → downgrade-eligible', () => {
    const review = createValidReview();
    review.bias_findings = [
      {
        type: 'CONFIRMATION_BIAS',
        source: 'semantic',
        description: 'Semantic bias found.',
        // missing brief_evidence → MISSING_BRIEF_EVIDENCE
      },
    ];

    const context = createContext();
    const result = validateM1Review(review, context);

    expect(result.failure_codes).toContain(M1ReviewFailureCodes.MISSING_BRIEF_EVIDENCE);
    expect(isDowngradeEligible(result.failure_codes)).toBe(true);
  });
});

// =============================================================================
// BRIEF_EVIDENCE_TOO_SHORT downgrade tests
// =============================================================================

describe('Validation Downgrade: BRIEF_EVIDENCE_TOO_SHORT', () => {
  it('BRIEF_EVIDENCE_TOO_SHORT only → downgrade-eligible', () => {
    const review = createValidReview();
    review.bias_findings = [
      {
        type: 'CONFIRMATION_BIAS',
        source: 'semantic',
        description: 'Semantic bias found.',
        brief_evidence: 'Too short', // < 12 chars → BRIEF_EVIDENCE_TOO_SHORT
      },
    ];

    const context = createContext();
    const result = validateM1Review(review, context);

    expect(result.failure_codes).toContain(M1ReviewFailureCodes.BRIEF_EVIDENCE_TOO_SHORT);
    expect(isDowngradeEligible(result.failure_codes)).toBe(true);
  });
});

// =============================================================================
// BRIEF_EVIDENCE_NOT_SUBSTRING downgrade tests
// =============================================================================

describe('Validation Downgrade: BRIEF_EVIDENCE_NOT_SUBSTRING', () => {
  it('BRIEF_EVIDENCE_NOT_SUBSTRING only → downgrade-eligible', () => {
    const review = createValidReview();
    review.bias_findings = [
      {
        type: 'CONFIRMATION_BIAS',
        source: 'semantic',
        description: 'Semantic bias found.',
        brief_evidence: 'This text is not in the original brief at all', // not a substring
      },
    ];

    const context = createContext({ briefText: 'Which option should we choose for revenue growth?' });
    const result = validateM1Review(review, context);

    expect(result.failure_codes).toContain(M1ReviewFailureCodes.BRIEF_EVIDENCE_NOT_SUBSTRING);
    expect(isDowngradeEligible(result.failure_codes)).toBe(true);
  });
});

// =============================================================================
// Blocking codes remain hard failures
// =============================================================================

describe('Blocking codes remain hard failures', () => {
  it('MISSING_OPTION_HEADLINE → valid=false, IS downgrade-eligible (B1.2)', () => {
    const review = createValidReview();
    review.story_headlines = { opt_a: 'Only A' }; // Missing opt_b

    const context = createContext();
    const result = validateM1Review(review, context);

    expect(result.valid).toBe(false);
    expect(result.failure_codes).toContain(M1ReviewFailureCodes.MISSING_OPTION_HEADLINE);
    expect(isDowngradeEligible(result.failure_codes)).toBe(true);
  });

  it('MODIFIED_VALUES → valid=false, NOT downgrade-eligible', () => {
    const review = createValidReview();
    review.flip_thresholds = [
      { factor_id: 'factor_a', current_value: 999, flip_value: 0.5, label: 'Test' },
    ];

    const context = createContext();
    context.flipThresholdData = [
      { factor_id: 'factor_a', factor_label: 'Factor A', current_value: 0.5, flip_value: 0.8, direction: 'decrease' as const, flip_reason: 'found' as const, iterations_used: 5 },
    ];
    const result = validateM1Review(review, context);

    expect(result.valid).toBe(false);
    expect(result.failure_codes).toContain(M1ReviewFailureCodes.MODIFIED_VALUES);
    expect(isDowngradeEligible(result.failure_codes)).toBe(false);
  });

  it('UNGROUNDED_NUMBER (warning) + MODIFIED_VALUES (blocking) → NOT downgrade-eligible', () => {
    const review = createValidReview();
    review.narrative_summary = 'Option A wins with 99% probability.'; // Ungrounded
    review.flip_thresholds = [
      { factor_id: 'factor_a', current_value: 999, flip_value: 0.5, label: 'Test' },
    ];

    const context = createContext();
    context.flipThresholdData = [
      { factor_id: 'factor_a', factor_label: 'Factor A', current_value: 0.5, flip_value: 0.8, direction: 'decrease' as const, flip_reason: 'found' as const, iterations_used: 5 },
    ];
    const result = validateM1Review(review, context);

    expect(result.failure_codes).toContain(M1ReviewFailureCodes.UNGROUNDED_NUMBER);
    expect(result.failure_codes).toContain(M1ReviewFailureCodes.MODIFIED_VALUES);
    expect(isDowngradeEligible(result.failure_codes)).toBe(false);
  });
});

// =============================================================================
// Clean review passes
// =============================================================================

describe('Clean review', () => {
  it('valid=true, zero warnings, zero errors', () => {
    const review = createValidReview();
    const context = createContext({ allowedNumbers: [0.74, 0.78, 0.26] });

    const result = validateM1Review(review, context);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.failure_codes).toHaveLength(0);
  });
});

// =============================================================================
// review_warnings in response schema
// =============================================================================

describe('review_warnings response inclusion', () => {
  it('review_warnings is populated when warning-grade codes are downgraded', () => {
    // Simulate orchestrator behavior
    const failureCodes = [
      M1ReviewFailureCodes.READINESS_CONTRADICTION,
      M1ReviewFailureCodes.UNGROUNDED_NUMBER,
    ];

    const allWarningGrade = isDowngradeEligible(failureCodes);
    expect(allWarningGrade).toBe(true);

    // Orchestrator merges failure codes into review_warnings
    const review_warnings = [...new Set([...failureCodes])];
    expect(review_warnings).toContain(M1ReviewFailureCodes.READINESS_CONTRADICTION);
    expect(review_warnings).toContain(M1ReviewFailureCodes.UNGROUNDED_NUMBER);

    // Response assembly includes review_warnings
    const m2DecisionReview = {
      m1_review: createValidReview(),
      review_status: 'complete' as const,
      review_warnings,
    };

    // review_warnings appears in response when present
    const responseFragment = {
      ...(m2DecisionReview.review_warnings && m2DecisionReview.review_warnings.length > 0 && {
        review_warnings: m2DecisionReview.review_warnings,
      }),
    };
    expect(responseFragment.review_warnings).toBeDefined();
    expect(responseFragment.review_warnings).toHaveLength(2);
  });

  it('review_warnings is omitted from response when empty', () => {
    const m2DecisionReview = {
      m1_review: createValidReview(),
      review_status: 'complete' as const,
      review_warnings: [] as string[],
    };

    const responseFragment = {
      ...(m2DecisionReview.review_warnings && m2DecisionReview.review_warnings.length > 0 && {
        review_warnings: m2DecisionReview.review_warnings,
      }),
    };
    expect(responseFragment.review_warnings).toBeUndefined();
  });
});
