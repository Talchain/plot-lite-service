/**
 * Decision Review Validator Tests
 *
 * Tests for the 9-tier M1Review validator.
 * Covers happy paths, negative cases, and edge conditions.
 *
 * @see Brief: M2 Decision Review Integration, Task 9
 */

import { describe, it, expect } from 'vitest';
import {
  validateM1Review,
  buildValidationContext,
  extractNumbers,
  isGroundedNumber,
  capScenarioContexts,
} from '../../../src/cee/validation/m1-review-validator.js';
import { M1ReviewFailureCodes, M1_REVIEW_LIMITS } from '../../../src/cee/validation/m1-review-constants.js';
import {
  BASE_BRIEF,
  BASE_ISL_RESULTS,
  BASE_FLIP_THRESHOLD_DATA,
  BASE_GRAPH,
  VALID_READY_REVIEW,
  VALID_CLOSE_CALL_REVIEW,
  VALID_NEEDS_EVIDENCE_REVIEW,
  VALID_SINGLE_OPTION_REVIEW,
  INVALID_INVENTED_NUMBER,
  INVALID_READINESS_CONTRADICTION,
  INVALID_MISSING_HEADLINE,
  INVALID_SCENARIO_EDGE,
  INVALID_CONSEQUENCE_OPTION,
  INVALID_MISSING_CRITIQUE_CODE,
  INVALID_MISSING_BRIEF_EVIDENCE,
  INVALID_BRIEF_EVIDENCE_SHORT,
  INVALID_BRIEF_EVIDENCE_NOT_SUBSTRING,
  INVALID_PREMORTEM_NOT_GROUNDED,
  INVALID_PREMORTEM_GROUNDING_ID,
  INVALID_MODIFIED_FLIP_VALUES,
  INVALID_STRUCTURAL_LIMITS,
  INVALID_PROMPT_STRUCTURE,
  REVIEW_WITH_EXCESS_SCENARIO_CONTEXTS,
  buildTestRequest,
  buildNeedsEvidenceRequest,
  buildSingleOptionRequest,
} from './fixtures.js';

// =============================================================================
// Helper: Build context from test request
// =============================================================================

function buildTestContext(readiness: string = 'ready') {
  const request = buildTestRequest({
    deterministic_coaching: {
      readiness,
      headline_type: readiness === 'ready' ? 'clear_winner' : readiness,
      evidence_gaps: [
        { factor_id: 'factor-market', factor_label: 'Market Demand', confidence: 0.7, voi: 0.3 },
        { factor_id: 'factor-price', factor_label: 'Pricing Strategy', confidence: 0.5, voi: 0.2 },
      ],
      model_critiques: [],
    },
  });
  return buildValidationContext(request);
}

// =============================================================================
// Happy Path Tests
// =============================================================================

describe('Decision Review Validator - Happy Paths', () => {
  describe('Valid "ready" state review', () => {
    it('passes all 9 validation tiers', () => {
      const context = buildTestContext('ready');
      const result = validateM1Review(VALID_READY_REVIEW, context);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.failure_codes).toHaveLength(0);
    });
  });

  describe('Valid "close_call" state review', () => {
    it('passes all validation tiers', () => {
      const context = buildTestContext('close_call');
      const result = validateM1Review(VALID_CLOSE_CALL_REVIEW, context);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Valid "needs_evidence" state review', () => {
    it('passes all validation tiers when properly aligned', () => {
      const context = buildTestContext('needs_evidence');
      const result = validateM1Review(VALID_NEEDS_EVIDENCE_REVIEW, context);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Single option review', () => {
    it('passes validation with single option', () => {
      const request = buildSingleOptionRequest();
      const context = buildValidationContext(request);
      const result = validateM1Review(VALID_SINGLE_OPTION_REVIEW, context);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});

// =============================================================================
// Tier 1: Option Coverage Tests
// =============================================================================

describe('Tier 1: Option Coverage', () => {
  it('fails with MISSING_OPTION_HEADLINE when option missing', () => {
    const context = buildTestContext();
    const result = validateM1Review(INVALID_MISSING_HEADLINE, context);

    expect(result.valid).toBe(false);
    expect(result.failure_codes).toContain(M1ReviewFailureCodes.MISSING_OPTION_HEADLINE);
    expect(result.errors.some(e => e.field.includes('option-b'))).toBe(true);
  });

  it('passes when all options have headlines', () => {
    const context = buildTestContext();
    const result = validateM1Review(VALID_READY_REVIEW, context);

    expect(result.failure_codes).not.toContain(M1ReviewFailureCodes.MISSING_OPTION_HEADLINE);
  });
});

// =============================================================================
// Tier 2: Scenario Context References Tests
// =============================================================================

describe('Tier 2: Scenario Context References', () => {
  it('fails with INVALID_SCENARIO_EDGE for non-fragile edge', () => {
    const context = buildTestContext();
    const result = validateM1Review(INVALID_SCENARIO_EDGE, context);

    expect(result.valid).toBe(false);
    expect(result.failure_codes).toContain(M1ReviewFailureCodes.INVALID_SCENARIO_EDGE);
  });

  it('fails with CONSEQUENCE_INVALID_OPTION for invalid option reference', () => {
    const context = buildTestContext();
    const result = validateM1Review(INVALID_CONSEQUENCE_OPTION, context);

    expect(result.valid).toBe(false);
    expect(result.failure_codes).toContain(M1ReviewFailureCodes.CONSEQUENCE_INVALID_OPTION);
  });

  it('passes when scenario contexts reference valid fragile edges', () => {
    const context = buildTestContext();
    const result = validateM1Review(VALID_READY_REVIEW, context);

    expect(result.failure_codes).not.toContain(M1ReviewFailureCodes.INVALID_SCENARIO_EDGE);
    expect(result.failure_codes).not.toContain(M1ReviewFailureCodes.CONSEQUENCE_INVALID_OPTION);
  });

  it('allows review without scenario_contexts', () => {
    const context = buildTestContext();
    const reviewNoScenarios = { ...VALID_READY_REVIEW, scenario_contexts: undefined };
    const result = validateM1Review(reviewNoScenarios, context);

    expect(result.failure_codes).not.toContain(M1ReviewFailureCodes.INVALID_SCENARIO_EDGE);
  });
});

// =============================================================================
// Tier 3: Readiness Alignment Tests
// =============================================================================

describe('Tier 3: Readiness Alignment', () => {
  it('fails with READINESS_CONTRADICTION for forbidden phrases', () => {
    const context = buildTestContext('needs_evidence');
    const result = validateM1Review(INVALID_READINESS_CONTRADICTION, context);

    expect(result.valid).toBe(false);
    expect(result.failure_codes).toContain(M1ReviewFailureCodes.READINESS_CONTRADICTION);
  });

  it('detects "confident" as forbidden in needs_evidence', () => {
    const context = buildTestContext('needs_evidence');
    const review = {
      ...VALID_NEEDS_EVIDENCE_REVIEW,
      narrative_summary: 'We are confident about Option A.',
    };
    const result = validateM1Review(review, context);

    expect(result.failure_codes).toContain(M1ReviewFailureCodes.READINESS_CONTRADICTION);
  });

  it('detects "ready to proceed" as forbidden in needs_evidence', () => {
    const context = buildTestContext('needs_evidence');
    const review = {
      ...VALID_NEEDS_EVIDENCE_REVIEW,
      readiness_rationale: 'We are ready to proceed with the decision.',
    };
    const result = validateM1Review(review, context);

    expect(result.failure_codes).toContain(M1ReviewFailureCodes.READINESS_CONTRADICTION);
  });

  it('allows "confident" in ready state', () => {
    const context = buildTestContext('ready');
    const review = {
      ...VALID_READY_REVIEW,
      narrative_summary: 'We are confident about Option A with 77% win probability.',
    };
    const result = validateM1Review(review, context);

    expect(result.failure_codes).not.toContain(M1ReviewFailureCodes.READINESS_CONTRADICTION);
  });

  it('fails with READINESS_MISALIGNMENT for needs_framing without required phrase', () => {
    const context = buildTestContext('needs_framing');
    const review = {
      ...VALID_READY_REVIEW,
      narrative_summary: 'Option A has 77% win probability.',
      readiness_rationale: 'The decision needs more analysis.', // Missing framing/structure/missing
    };
    const result = validateM1Review(review, context);

    expect(result.failure_codes).toContain(M1ReviewFailureCodes.READINESS_MISALIGNMENT);
  });

  it('passes needs_framing when "framing" is mentioned', () => {
    const context = buildTestContext('needs_framing');
    const review = {
      ...VALID_READY_REVIEW,
      narrative_summary: 'The framing of this decision needs work.',
      readiness_rationale: 'Decision framing should be reconsidered.',
    };
    const result = validateM1Review(review, context);

    expect(result.failure_codes).not.toContain(M1ReviewFailureCodes.READINESS_MISALIGNMENT);
  });
});

// =============================================================================
// Tier 4: Number Grounding Tests
// =============================================================================

describe('Tier 4: Number Grounding', () => {
  it('fails with UNGROUNDED_NUMBER for invented numbers', () => {
    const context = buildTestContext();
    const result = validateM1Review(INVALID_INVENTED_NUMBER, context);

    expect(result.valid).toBe(false);
    expect(result.failure_codes).toContain(M1ReviewFailureCodes.UNGROUNDED_NUMBER);
  });

  it('accepts numbers from input data', () => {
    const context = buildTestContext();
    const result = validateM1Review(VALID_READY_REVIEW, context);

    expect(result.failure_codes).not.toContain(M1ReviewFailureCodes.UNGROUNDED_NUMBER);
  });

  it('accepts percentage format of decimal values', () => {
    const context = buildTestContext();
    // 77% should be accepted because 0.77 is in the data
    const review = {
      ...VALID_READY_REVIEW,
      narrative_summary: 'Option A has a 77% chance of success.',
    };
    const result = validateM1Review(review, context);

    expect(result.failure_codes).not.toContain(M1ReviewFailureCodes.UNGROUNDED_NUMBER);
  });
});

// =============================================================================
// Tier 5: Bias Evidence Tests
// =============================================================================

describe('Tier 5: Bias Evidence', () => {
  it('fails with MISSING_CRITIQUE_CODE for structural bias', () => {
    const context = buildTestContext();
    const result = validateM1Review(INVALID_MISSING_CRITIQUE_CODE, context);

    expect(result.valid).toBe(false);
    expect(result.failure_codes).toContain(M1ReviewFailureCodes.MISSING_CRITIQUE_CODE);
  });

  it('fails with MISSING_BRIEF_EVIDENCE for semantic bias', () => {
    const context = buildTestContext();
    const result = validateM1Review(INVALID_MISSING_BRIEF_EVIDENCE, context);

    expect(result.valid).toBe(false);
    expect(result.failure_codes).toContain(M1ReviewFailureCodes.MISSING_BRIEF_EVIDENCE);
  });

  it('fails with BRIEF_EVIDENCE_TOO_SHORT for short evidence', () => {
    const context = buildTestContext();
    const result = validateM1Review(INVALID_BRIEF_EVIDENCE_SHORT, context);

    expect(result.valid).toBe(false);
    expect(result.failure_codes).toContain(M1ReviewFailureCodes.BRIEF_EVIDENCE_TOO_SHORT);
  });

  it('fails with BRIEF_EVIDENCE_NOT_SUBSTRING for non-matching evidence', () => {
    const context = buildTestContext();
    const result = validateM1Review(INVALID_BRIEF_EVIDENCE_NOT_SUBSTRING, context);

    expect(result.valid).toBe(false);
    expect(result.failure_codes).toContain(M1ReviewFailureCodes.BRIEF_EVIDENCE_NOT_SUBSTRING);
  });

  it('accepts valid brief evidence substring', () => {
    const context = buildTestContext();
    const review = {
      ...VALID_READY_REVIEW,
      bias_findings: [
        {
          type: 'ANCHORING',
          source: 'semantic' as const,
          description: 'Price anchoring detected.',
          affected_elements: ['factor-price'],
          brief_evidence: 'pricing strategy for premium products',
        },
      ],
    };
    const result = validateM1Review(review, context);

    expect(result.failure_codes).not.toContain(M1ReviewFailureCodes.BRIEF_EVIDENCE_NOT_SUBSTRING);
  });
});

// =============================================================================
// Tier 6: Pre-mortem Grounding Tests
// =============================================================================

describe('Tier 6: Pre-mortem Grounding', () => {
  it('fails with PREMORTEM_NOT_GROUNDED for empty grounded_in', () => {
    const context = buildTestContext();
    const result = validateM1Review(INVALID_PREMORTEM_NOT_GROUNDED, context);

    expect(result.valid).toBe(false);
    expect(result.failure_codes).toContain(M1ReviewFailureCodes.PREMORTEM_NOT_GROUNDED);
  });

  it('fails with INVALID_GROUNDING_ID for non-existent ID', () => {
    const context = buildTestContext();
    const result = validateM1Review(INVALID_PREMORTEM_GROUNDING_ID, context);

    expect(result.valid).toBe(false);
    expect(result.failure_codes).toContain(M1ReviewFailureCodes.INVALID_GROUNDING_ID);
  });

  it('accepts valid fragile edge ID in grounded_in', () => {
    const context = buildTestContext();
    const review = {
      ...VALID_READY_REVIEW,
      pre_mortem: {
        failure_scenario: 'Market collapse',
        warning_signs: ['Market signals'],
        mitigation: 'Pivot plan',
        grounded_in: ['edge-3'], // Valid fragile edge
      },
    };
    const result = validateM1Review(review, context);

    expect(result.failure_codes).not.toContain(M1ReviewFailureCodes.INVALID_GROUNDING_ID);
  });

  it('accepts valid evidence gap factor ID in grounded_in', () => {
    const context = buildTestContext();
    const review = {
      ...VALID_READY_REVIEW,
      pre_mortem: {
        failure_scenario: 'Market collapse',
        warning_signs: ['Market signals'],
        mitigation: 'Pivot plan',
        grounded_in: ['factor-market'], // Valid evidence gap factor
      },
    };
    const result = validateM1Review(review, context);

    expect(result.failure_codes).not.toContain(M1ReviewFailureCodes.INVALID_GROUNDING_ID);
  });

  it('allows review without pre_mortem', () => {
    const context = buildTestContext();
    const review = { ...VALID_READY_REVIEW, pre_mortem: undefined };
    const result = validateM1Review(review, context);

    expect(result.failure_codes).not.toContain(M1ReviewFailureCodes.PREMORTEM_NOT_GROUNDED);
  });
});

// =============================================================================
// Tier 7: Flip Threshold Integrity Tests
// =============================================================================

describe('Tier 7: Flip Threshold Integrity', () => {
  it('fails with MODIFIED_VALUES for changed current_value', () => {
    const context = buildTestContext();
    const result = validateM1Review(INVALID_MODIFIED_FLIP_VALUES, context);

    expect(result.valid).toBe(false);
    expect(result.failure_codes).toContain(M1ReviewFailureCodes.MODIFIED_VALUES);
  });

  it('accepts matching flip threshold values', () => {
    const context = buildTestContext();
    const result = validateM1Review(VALID_READY_REVIEW, context);

    expect(result.failure_codes).not.toContain(M1ReviewFailureCodes.MODIFIED_VALUES);
  });

  it('allows review without flip_thresholds', () => {
    const context = buildTestContext();
    const review = { ...VALID_READY_REVIEW, flip_thresholds: undefined };
    const result = validateM1Review(review, context);

    expect(result.failure_codes).not.toContain(M1ReviewFailureCodes.MODIFIED_VALUES);
  });
});

// =============================================================================
// Tier 8: Structural Limits Tests
// =============================================================================

describe('Tier 8: Structural Limits', () => {
  it('fails with STRUCTURAL_LIMIT_EXCEEDED for too many items', () => {
    const context = buildTestContext();
    const result = validateM1Review(INVALID_STRUCTURAL_LIMITS, context);

    expect(result.valid).toBe(false);
    expect(result.failure_codes).toContain(M1ReviewFailureCodes.STRUCTURAL_LIMIT_EXCEEDED);
    // Should have multiple errors (bias_findings and key_assumptions both exceed)
    const limitErrors = result.errors.filter(
      e => e.code === M1ReviewFailureCodes.STRUCTURAL_LIMIT_EXCEEDED
    );
    expect(limitErrors.length).toBeGreaterThanOrEqual(2);
  });

  it('accepts arrays at limit', () => {
    const context = buildTestContext();
    const review = {
      ...VALID_READY_REVIEW,
      bias_findings: [
        { type: 'A', source: 'structural' as const, description: 'One', affected_elements: [], linked_critique_code: 'A' },
        { type: 'B', source: 'structural' as const, description: 'Two', affected_elements: [], linked_critique_code: 'B' },
        { type: 'C', source: 'structural' as const, description: 'Three - at limit', affected_elements: [], linked_critique_code: 'C' },
      ],
    };
    const result = validateM1Review(review, context);

    expect(result.failure_codes).not.toContain(M1ReviewFailureCodes.STRUCTURAL_LIMIT_EXCEEDED);
  });
});

// =============================================================================
// Tier 9: Decision Quality Prompt Structure Tests
// =============================================================================

describe('Tier 9: Decision Quality Prompt Structure', () => {
  it('fails with INVALID_PROMPT_STRUCTURE for empty principle', () => {
    const context = buildTestContext();
    const result = validateM1Review(INVALID_PROMPT_STRUCTURE, context);

    expect(result.valid).toBe(false);
    expect(result.failure_codes).toContain(M1ReviewFailureCodes.INVALID_PROMPT_STRUCTURE);
  });

  it('fails with INVALID_PROMPT_STRUCTURE for question without ?', () => {
    const context = buildTestContext();
    const review = {
      ...VALID_READY_REVIEW,
      decision_quality_prompts: [
        {
          principle: 'Valid Principle',
          applies_because: 'Valid reason',
          question: 'This is not a question',
        },
      ],
    };
    const result = validateM1Review(review, context);

    expect(result.failure_codes).toContain(M1ReviewFailureCodes.INVALID_PROMPT_STRUCTURE);
  });

  it('accepts valid prompt structure', () => {
    const context = buildTestContext();
    const result = validateM1Review(VALID_READY_REVIEW, context);

    expect(result.failure_codes).not.toContain(M1ReviewFailureCodes.INVALID_PROMPT_STRUCTURE);
  });
});

// =============================================================================
// extractNumbers() Unit Tests
// =============================================================================

describe('extractNumbers()', () => {
  it('extracts integers', () => {
    expect(extractNumbers('The value is 42')).toContain(42);
  });

  it('extracts decimals', () => {
    expect(extractNumbers('Probability is 0.77')).toContain(0.77);
  });

  it('extracts percentages (strips %)', () => {
    expect(extractNumbers('Success rate is 77%')).toContain(77);
  });

  it('extracts negative numbers', () => {
    expect(extractNumbers('Change of -12.5%')).toContain(-12.5);
  });

  it('extracts multiple numbers', () => {
    const nums = extractNumbers('From 0.65 to 0.85, a gain of 30%');
    expect(nums).toContain(0.65);
    expect(nums).toContain(0.85);
    expect(nums).toContain(30);
  });

  it('ignores ordinals (1st, 2nd, 3rd, 4th)', () => {
    const nums = extractNumbers('The 1st option is 2nd best, 3rd in line, 4th overall');
    expect(nums).not.toContain(1);
    expect(nums).not.toContain(2);
    expect(nums).not.toContain(3);
    expect(nums).not.toContain(4);
  });

  it('returns empty array for text without numbers', () => {
    expect(extractNumbers('No numbers here')).toHaveLength(0);
  });
});

// =============================================================================
// isGroundedNumber() Unit Tests
// =============================================================================

describe('isGroundedNumber()', () => {
  const allowed = [0.77, 0.23, 0.85, 0.42, 0.88, 0.12, 0.7, 0.5];

  it('matches exact values', () => {
    expect(isGroundedNumber(0.77, allowed)).toBe(true);
    expect(isGroundedNumber(0.42, allowed)).toBe(true);
  });

  it('matches percentage equivalents', () => {
    expect(isGroundedNumber(77, allowed)).toBe(true); // 77 = 0.77 * 100
    expect(isGroundedNumber(88, allowed)).toBe(true); // 88 = 0.88 * 100
  });

  it('allows tolerance for near matches', () => {
    expect(isGroundedNumber(0.78, allowed)).toBe(true); // Close to 0.77
    expect(isGroundedNumber(78, allowed)).toBe(true); // Close to 77%
  });

  it('rejects ungrounded numbers', () => {
    // With 5% tolerance, use numbers clearly outside all allowed ranges
    // Allowed: [0.77, 0.23, 0.85, 0.42, 0.88, 0.12, 0.7, 0.5]
    expect(isGroundedNumber(0.99, allowed)).toBe(false); // Not within 5% of 0.88 (max would be 0.924)
    expect(isGroundedNumber(150, allowed)).toBe(false);  // Not close to any percentage equivalent
    expect(isGroundedNumber(2.0, allowed)).toBe(false);  // Way outside all ranges
  });

  it('handles zero correctly', () => {
    const withZero = [0, 0.5, 1];
    expect(isGroundedNumber(0, withZero)).toBe(true);
    expect(isGroundedNumber(0.001, withZero)).toBe(true);
  });
});

// =============================================================================
// buildValidationContext() Tests
// =============================================================================

describe('buildValidationContext()', () => {
  it('extracts all option IDs', () => {
    const request = buildTestRequest();
    const context = buildValidationContext(request);

    expect(context.optionIds).toContain('option-a');
    expect(context.optionIds).toContain('option-b');
  });

  it('extracts all option labels', () => {
    const request = buildTestRequest();
    const context = buildValidationContext(request);

    expect(context.optionLabels).toContain('Option A');
    expect(context.optionLabels).toContain('Option B');
  });

  it('extracts fragile edge IDs', () => {
    const request = buildTestRequest();
    const context = buildValidationContext(request);

    expect(context.fragileEdgeIds).toContain('edge-3');
    expect(context.fragileEdgeIds).toContain('edge-4');
  });

  it('extracts top 3 evidence gap factor IDs by VoI', () => {
    const request = buildTestRequest();
    const context = buildValidationContext(request);

    expect(context.evidenceGapFactorIds).toContain('factor-market');
    expect(context.evidenceGapFactorIds).toContain('factor-price');
  });

  it('includes readiness state', () => {
    const request = buildTestRequest();
    const context = buildValidationContext(request);

    expect(context.readiness).toBe('ready');
  });

  it('collects allowed numbers from all sources', () => {
    const request = buildTestRequest();
    const context = buildValidationContext(request);

    // Win probabilities
    expect(context.allowedNumbers).toContain(0.77);
    expect(context.allowedNumbers).toContain(0.23);

    // Stability
    expect(context.allowedNumbers).toContain(0.88);

    // Elasticity
    expect(context.allowedNumbers).toContain(0.42);

    // Margin
    expect(context.allowedNumbers).toContain(0.54);
  });

  it('deduplicates allowed numbers', () => {
    const request = buildTestRequest();
    const context = buildValidationContext(request);

    const counts = new Map<number, number>();
    for (const n of context.allowedNumbers) {
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }

    // All counts should be 1
    for (const count of counts.values()) {
      expect(count).toBe(1);
    }
  });

  it('includes brief text for substring matching', () => {
    const request = buildTestRequest();
    const context = buildValidationContext(request);

    expect(context.briefText).toContain('Option A');
    expect(context.briefText).toContain('77%');
  });
});

// =============================================================================
// capScenarioContexts() Tests
// =============================================================================

describe('capScenarioContexts()', () => {
  const fragileEdges = [
    { edge_id: 'edge-3', switch_probability: 0.12 },
    { edge_id: 'edge-4', switch_probability: 0.05 },
    { edge_id: 'edge-extra-1', switch_probability: 0.03 },
    { edge_id: 'edge-extra-2', switch_probability: 0.02 },
    { edge_id: 'edge-extra-3', switch_probability: 0.01 },
  ];

  it('returns review unchanged when scenario_contexts is undefined', () => {
    const review = { ...VALID_READY_REVIEW, scenario_contexts: undefined };
    const result = capScenarioContexts(review, fragileEdges);

    expect(result.truncated).toBe(false);
    expect(result.removedKeys).toHaveLength(0);
    expect(result.warning).toBe('');
    expect(result.review.scenario_contexts).toBeUndefined();
  });

  it('returns review unchanged when at or below limit', () => {
    const result = capScenarioContexts(VALID_READY_REVIEW, fragileEdges);

    expect(result.truncated).toBe(false);
    expect(result.removedKeys).toHaveLength(0);
    expect(result.review).toBe(VALID_READY_REVIEW); // Same reference = no copy
  });

  it('truncates to MAX_SCENARIO_CONTEXTS when exceeded', () => {
    const result = capScenarioContexts(REVIEW_WITH_EXCESS_SCENARIO_CONTEXTS, fragileEdges);

    expect(result.truncated).toBe(true);
    const keptKeys = Object.keys(result.review.scenario_contexts!);
    expect(keptKeys).toHaveLength(M1_REVIEW_LIMITS.MAX_SCENARIO_CONTEXTS);
  });

  it('keeps highest switch_probability edges (relevance ranking)', () => {
    const result = capScenarioContexts(REVIEW_WITH_EXCESS_SCENARIO_CONTEXTS, fragileEdges);

    const keptKeys = Object.keys(result.review.scenario_contexts!);
    // edge-3 (0.12), edge-4 (0.05), edge-extra-1 (0.03) should be kept
    expect(keptKeys).toContain('edge-3');
    expect(keptKeys).toContain('edge-4');
    expect(keptKeys).toContain('edge-extra-1');
  });

  it('removes lowest switch_probability edges', () => {
    const result = capScenarioContexts(REVIEW_WITH_EXCESS_SCENARIO_CONTEXTS, fragileEdges);

    // edge-extra-2 (0.02) and edge-extra-3 (0.01) should be removed
    expect(result.removedKeys).toContain('edge-extra-2');
    expect(result.removedKeys).toContain('edge-extra-3');
    expect(result.removedKeys).toHaveLength(2);
  });

  it('emits warning with removed keys and counts', () => {
    const result = capScenarioContexts(REVIEW_WITH_EXCESS_SCENARIO_CONTEXTS, fragileEdges);

    expect(result.warning).toContain('capped at 3');
    expect(result.warning).toContain('had 5');
    expect(result.warning).toContain('edge-extra-2');
    expect(result.warning).toContain('edge-extra-3');
  });

  it('falls back to insertion order when no fragile edge data', () => {
    const result = capScenarioContexts(REVIEW_WITH_EXCESS_SCENARIO_CONTEXTS, []);

    expect(result.truncated).toBe(true);
    const keptKeys = Object.keys(result.review.scenario_contexts!);
    expect(keptKeys).toHaveLength(M1_REVIEW_LIMITS.MAX_SCENARIO_CONTEXTS);
    expect(result.removedKeys).toHaveLength(2);
    // Insertion order preserved: first 3 keys kept
    expect(keptKeys).toEqual(['edge-3', 'edge-4', 'edge-extra-1']);
  });

  it('ranks known edges by switch_probability and demotes unknown edges', () => {
    // Only 2 of 5 edges have fragile edge data — the 3 without data should
    // sort after the 2 with data, and among themselves keep insertion order.
    const partialEdges = [
      { edge_id: 'edge-extra-2', switch_probability: 0.20 },
      { edge_id: 'edge-3', switch_probability: 0.12 },
    ];
    const result = capScenarioContexts(REVIEW_WITH_EXCESS_SCENARIO_CONTEXTS, partialEdges);

    expect(result.truncated).toBe(true);
    const keptKeys = Object.keys(result.review.scenario_contexts!);
    // edge-extra-2 (0.20) and edge-3 (0.12) ranked first by probability,
    // then edge-4 is first among the no-data group by insertion order
    expect(keptKeys).toEqual(['edge-extra-2', 'edge-3', 'edge-4']);
    expect(result.removedKeys).toContain('edge-extra-1');
    expect(result.removedKeys).toContain('edge-extra-3');
  });

  it('does not mutate original review', () => {
    const original = { ...REVIEW_WITH_EXCESS_SCENARIO_CONTEXTS };
    const originalKeys = Object.keys(original.scenario_contexts!);
    capScenarioContexts(REVIEW_WITH_EXCESS_SCENARIO_CONTEXTS, fragileEdges);

    expect(Object.keys(REVIEW_WITH_EXCESS_SCENARIO_CONTEXTS.scenario_contexts!)).toEqual(originalKeys);
  });
});

// =============================================================================
// Tier 8: scenario_contexts limit (defensive)
// =============================================================================

describe('Tier 8: scenario_contexts structural limit', () => {
  it('fails with STRUCTURAL_LIMIT_EXCEEDED when scenario_contexts exceeds cap (uncapped input)', () => {
    const context = buildTestContext();
    // Pass the excess review directly to the validator (bypassing cap step)
    const result = validateM1Review(REVIEW_WITH_EXCESS_SCENARIO_CONTEXTS, context);

    expect(result.valid).toBe(false);
    expect(result.failure_codes).toContain(M1ReviewFailureCodes.STRUCTURAL_LIMIT_EXCEEDED);
    const scError = result.errors.find(e => e.field === 'scenario_contexts');
    expect(scError).toBeDefined();
    expect(scError!.message).toContain('scenario_contexts exceeds limit');
  });

  it('passes when scenario_contexts is at limit after capping', () => {
    const fragileEdges = [
      { edge_id: 'edge-3', switch_probability: 0.12 },
      { edge_id: 'edge-4', switch_probability: 0.05 },
    ];
    const { review: capped } = capScenarioContexts(REVIEW_WITH_EXCESS_SCENARIO_CONTEXTS, fragileEdges);
    const context = buildTestContext();
    const result = validateM1Review(capped, context);

    expect(result.failure_codes).not.toContain(M1ReviewFailureCodes.STRUCTURAL_LIMIT_EXCEEDED);
  });
});
