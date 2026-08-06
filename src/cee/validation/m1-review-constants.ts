/**
 * M1 Review Constants
 *
 * Single source of truth for validation constants, failure codes, and grounding classification.
 * Used by the 9-tier validator and type documentation.
 *
 * @see Brief: M2 Decision Review Integration
 */

// =============================================================================
// Failure Codes (used by validator tiers)
// =============================================================================

export const M1ReviewFailureCodes = {
  // Tier 1: Option Coverage
  MISSING_OPTION_HEADLINE: 'MISSING_OPTION_HEADLINE',

  // Tier 2: Scenario Context References
  CONSEQUENCE_INVALID_OPTION: 'CONSEQUENCE_INVALID_OPTION',
  INVALID_SCENARIO_EDGE: 'INVALID_SCENARIO_EDGE',

  // Tier 3: Readiness Alignment
  READINESS_CONTRADICTION: 'READINESS_CONTRADICTION',
  READINESS_MISALIGNMENT: 'READINESS_MISALIGNMENT',

  // Tier 4: Number Grounding
  UNGROUNDED_NUMBER: 'UNGROUNDED_NUMBER',

  // Tier 5: Bias Evidence
  MISSING_CRITIQUE_CODE: 'MISSING_CRITIQUE_CODE',
  MISSING_BRIEF_EVIDENCE: 'MISSING_BRIEF_EVIDENCE',
  BRIEF_EVIDENCE_TOO_SHORT: 'BRIEF_EVIDENCE_TOO_SHORT',
  BRIEF_EVIDENCE_NOT_SUBSTRING: 'BRIEF_EVIDENCE_NOT_SUBSTRING',

  // Tier 6: Pre-mortem Grounding
  PREMORTEM_NOT_GROUNDED: 'PREMORTEM_NOT_GROUNDED',
  INVALID_GROUNDING_ID: 'INVALID_GROUNDING_ID',

  // Tier 7: Flip Threshold Integrity
  MODIFIED_VALUES: 'MODIFIED_VALUES',

  // Tier 8: Structural Limits
  STRUCTURAL_LIMIT_EXCEEDED: 'STRUCTURAL_LIMIT_EXCEEDED',

  // Tier 9: Decision Quality Prompt Structure
  INVALID_PROMPT_STRUCTURE: 'INVALID_PROMPT_STRUCTURE',
} as const;

export type M1ReviewFailureCode = typeof M1ReviewFailureCodes[keyof typeof M1ReviewFailureCodes];

/**
 * Warning-grade failure codes that don't block the review.
 *
 * When ALL failure codes in a validation result belong to this set, the review
 * is downgraded from 'failed' to 'complete' with `review_warnings`. If any
 * code outside this set is present, the entire result stays 'failed'.
 *
 * Rationale per code documented inline. Only MODIFIED_VALUES (data integrity
 * violation — flip threshold tampering) remains blocking.
 *
 * Classification rule: blocking ONLY for structural invalidity or data corruption
 * (missing required fields, schema mismatch, unparseable response). Everything
 * else is warning-grade if the review still provides actionable guidance.
 */
export const WARNING_GRADE_CODES: Set<string> = new Set([
  // Existing warning-grade codes
  M1ReviewFailureCodes.UNGROUNDED_NUMBER,
  M1ReviewFailureCodes.READINESS_MISALIGNMENT,
  M1ReviewFailureCodes.READINESS_CONTRADICTION,
  M1ReviewFailureCodes.MISSING_BRIEF_EVIDENCE,
  M1ReviewFailureCodes.BRIEF_EVIDENCE_TOO_SHORT,
  M1ReviewFailureCodes.BRIEF_EVIDENCE_NOT_SUBSTRING,
  // Phase 3b warning-grade codes
  M1ReviewFailureCodes.CONSEQUENCE_INVALID_OPTION,    // T2: LLM paraphrases option references
  M1ReviewFailureCodes.INVALID_SCENARIO_EDGE,          // T2: LLM references valid edges outside top-N fragile set
  M1ReviewFailureCodes.PREMORTEM_NOT_GROUNDED,          // T6: Pre-mortem narrative useful without perfect ID grounding
  M1ReviewFailureCodes.INVALID_GROUNDING_ID,            // T6: ID mismatch doesn't invalidate pre-mortem insight
  M1ReviewFailureCodes.STRUCTURAL_LIMIT_EXCEEDED,       // T8: Excess items can be truncated; not data corruption
  M1ReviewFailureCodes.INVALID_PROMPT_STRUCTURE,        // T9: Minor formatting; coaching intent still communicates
  // B1.2: Downgraded — review still provides actionable guidance despite these issues
  M1ReviewFailureCodes.MISSING_OPTION_HEADLINE,        // T1: Other option stories + narrative/robustness still useful
  M1ReviewFailureCodes.MISSING_CRITIQUE_CODE,          // T5: Bias description still actionable without linked critique code
]);

// =============================================================================
// Warning Codes (non-blocking diagnostics)
// =============================================================================

export const M1ReviewWarningCodes = {
  /** scenario_contexts exceeded MAX_SCENARIO_CONTEXTS and was truncated */
  SCENARIO_CONTEXTS_CAPPED: 'SCENARIO_CONTEXTS_CAPPED',
} as const;

// =============================================================================
// Structural Limits (used by validator Tier 8)
// =============================================================================

export const M1_REVIEW_LIMITS = {
  /** Maximum number of bias findings allowed */
  MAX_BIAS_FINDINGS: 3,
  /** Maximum number of key assumptions allowed */
  MAX_KEY_ASSUMPTIONS: 5,
  /** Maximum number of decision quality prompts allowed */
  MAX_DECISION_QUALITY_PROMPTS: 3,
  /** Maximum number of flip thresholds allowed */
  MAX_FLIP_THRESHOLDS: 2,
  /** Maximum number of stability factors allowed */
  MAX_STABILITY_FACTORS: 3,
  /** Maximum number of fragility factors allowed */
  MAX_FRAGILITY_FACTORS: 3,
  /** Maximum number of scenario contexts allowed */
  MAX_SCENARIO_CONTEXTS: 3,
} as const;

// =============================================================================
// Grounding Field Classification (used by validator Tier 4)
// =============================================================================

/**
 * Grounding classification for M1 review fields.
 * - 'grounded': Field is scanned for number validity (must match allowed numbers)
 * - 'prescriptive': Field is NOT scanned (contains recommendations, not facts)
 */
export type GroundingType = 'grounded' | 'prescriptive';

/**
 * Map of field paths to their grounding classification.
 * Grounded fields are scanned for numbers that must match input data.
 * Prescriptive fields contain recommendations and are not scanned.
 */
export const M1_REVIEW_GROUNDING_MAP: Record<string, GroundingType> = {
  // Grounded fields (scanned for numbers)
  'narrative_summary': 'grounded',
  'robustness_explanation.summary': 'grounded',
  'robustness_explanation.primary_risk': 'grounded',
  'robustness_explanation.stability_factors': 'grounded',
  'robustness_explanation.fragility_factors': 'grounded',
  'readiness_rationale': 'grounded',
  'bias_findings.description': 'grounded',
  'scenario_contexts.trigger_description': 'grounded',
  'scenario_contexts.consequence': 'grounded',

  // Prescriptive fields (NOT scanned)
  'evidence_enhancements.specific_action': 'prescriptive',
  'evidence_enhancements.decision_hygiene': 'prescriptive',
  'pre_mortem.warning_signs': 'prescriptive',
  'pre_mortem.mitigation': 'prescriptive',
  'pre_mortem.review_trigger': 'prescriptive',
  // 2.670: renamed with the field. The producer calls this `narrative`; the old
  // key named a field CEE has never emitted, so this entry classified nothing.
  'flip_thresholds.narrative': 'prescriptive',
  'decision_quality_prompts.question': 'prescriptive',
  'decision_quality_prompts.applies_because': 'prescriptive',
  'framing_check.concern': 'prescriptive',
  'framing_check.suggested_reframe': 'prescriptive',
};

// =============================================================================
// Readiness Rules (used by validator Tier 3)
// =============================================================================

/**
 * Readiness-specific validation rules.
 * - forbidden: Phrases that MUST NOT appear in grounded fields
 * - required_any: At least one of these phrases MUST appear (if defined)
 */
export const READINESS_RULES: Record<string, { forbidden: string[]; required_any?: string[] }> = {
  needs_evidence: {
    forbidden: ['ready to proceed', 'confident', 'clear choice', 'definitely'],
  },
  needs_framing: {
    forbidden: ['ready to proceed', 'confident', 'clear choice'],
    required_any: ['framing', 'structure', 'missing'],
  },
  ready: {
    forbidden: [],
  },
  close_call: {
    forbidden: [],
  },
};

// =============================================================================
// Telemetry Events (used by observability Task 8)
// =============================================================================

export const DecisionReviewEvents = {
  REQUESTED: 'decision_review.requested',
  COMPLETED: 'decision_review.completed',
  VALIDATION_FAILED: 'decision_review.validation_failed',
  SKIPPED: 'decision_review.skipped',
  DISABLED: 'decision_review.disabled',
  CACHE_HIT: 'decision_review.cache_hit',
} as const;

// =============================================================================
// Bias Types (from CEE prompt - verify against actual prompt if available)
// =============================================================================

export const BiasTypes = {
  SUNK_COST: 'SUNK_COST',
  DOMINANT_FACTOR: 'DOMINANT_FACTOR',
  CONFIRMATION_BIAS: 'CONFIRMATION_BIAS',
  ANCHORING: 'ANCHORING',
  OVERCONFIDENCE: 'OVERCONFIDENCE',
  AVAILABILITY: 'AVAILABILITY',
} as const;

export type BiasType = typeof BiasTypes[keyof typeof BiasTypes] | string;

// =============================================================================
// Review Status
// =============================================================================

export type ReviewStatus = 'complete' | 'failed' | 'skipped' | 'disabled';

// =============================================================================
// Skip Reason Codes (used when review_status = 'skipped')
// =============================================================================

/**
 * Reason codes for why M2 decision review was skipped.
 * Helps diagnose issues without exposing internal details.
 */
export const ReviewSkipReasons = {
  /** ISL service is not enabled/available */
  ISL_NOT_ENABLED: 'ISL_NOT_ENABLED',
  /** ISL request failed with error */
  ISL_ERROR: 'ISL_ERROR',
  /** ISL analysis returned status='failed' */
  ISL_ANALYSIS_FAILED: 'ISL_ANALYSIS_FAILED',
  /** CEE service not configured (missing CEE_BASE_URL) */
  CEE_NOT_CONFIGURED: 'CEE_NOT_CONFIGURED',
  /** CEE request failed with error or returned null review */
  CEE_ERROR: 'CEE_ERROR',
  /** M1 coaching data not available (prerequisite for M2 review) */
  NO_M1_COACHING: 'NO_M1_COACHING',
  /** User's decision brief text not provided — review requires context */
  BRIEF_MISSING: 'BRIEF_MISSING',
} as const;

export type ReviewSkipReason = typeof ReviewSkipReasons[keyof typeof ReviewSkipReasons];
