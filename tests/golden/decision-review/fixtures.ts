/**
 * Decision Review Golden Test Fixtures
 *
 * Provides test data for M2 Decision Review Integration tests.
 * Includes happy path scenarios, negative test cases, and integration scenarios.
 *
 * @see Brief: M2 Decision Review Integration, Task 9
 */

import type { M1Review, DecisionReviewRequest } from '../../../src/cee/validation/m1-review-types.js';

// =============================================================================
// Base Context (used by all fixtures)
// =============================================================================

/**
 * Base brief text for testing.
 * Contains specific phrases and numbers that tests validate against.
 */
export const BASE_BRIEF = `
We need to decide between Option A and Option B for our product launch.
Option A has a 77% chance of success based on market research.
The expected outcome is approximately 0.85 on our success metric.
Key factors include market demand, pricing strategy, and competition.
Our budget is constrained to $500,000 and we need clarity on ROI.
The pricing strategy for premium products has historically shown strong returns.
`;

/**
 * Base graph for testing.
 */
export const BASE_GRAPH = {
  nodes: [
    { id: 'decision-1', label: 'Product Launch Decision', kind: 'decision' },
    { id: 'option-a', label: 'Option A', kind: 'option' },
    { id: 'option-b', label: 'Option B', kind: 'option' },
    { id: 'factor-market', label: 'Market Demand', kind: 'factor' },
    { id: 'factor-price', label: 'Pricing Strategy', kind: 'factor' },
    { id: 'factor-compete', label: 'Competition', kind: 'factor' },
    { id: 'goal-1', label: 'Success', kind: 'goal' },
  ],
  edges: [
    { id: 'edge-1', from: 'decision-1', to: 'option-a', strength: { mean: 1, std: 0.1 }, exists_probability: 1 },
    { id: 'edge-2', from: 'decision-1', to: 'option-b', strength: { mean: 1, std: 0.1 }, exists_probability: 1 },
    { id: 'edge-3', from: 'factor-market', to: 'goal-1', strength: { mean: 0.7, std: 0.15 }, exists_probability: 0.85 },
    { id: 'edge-4', from: 'factor-price', to: 'goal-1', strength: { mean: 0.5, std: 0.2 }, exists_probability: 0.75 },
    { id: 'edge-5', from: 'factor-compete', to: 'goal-1', strength: { mean: -0.3, std: 0.1 }, exists_probability: 0.9 },
  ],
};

/**
 * Base ISL results for testing.
 */
export const BASE_ISL_RESULTS = {
  option_comparison: [
    { option_id: 'option-a', option_label: 'Option A', win_probability: 0.77, expected_outcome: 0.85 },
    { option_id: 'option-b', option_label: 'Option B', win_probability: 0.23, expected_outcome: 0.65 },
  ],
  factor_sensitivity: [
    { factor_id: 'factor-market', factor_label: 'Market Demand', elasticity: 0.42, confidence: 0.7 },
    { factor_id: 'factor-price', factor_label: 'Pricing Strategy', elasticity: 0.28, confidence: 0.5 },
    { factor_id: 'factor-compete', factor_label: 'Competition', elasticity: -0.15, confidence: 0.8 },
  ],
  fragile_edges: [
    { edge_id: 'edge-3', from: 'factor-market', to: 'goal-1', switch_probability: 0.12, marginal_switch_probability: 0.08 },
    { edge_id: 'edge-4', from: 'factor-price', to: 'goal-1', switch_probability: 0.05, marginal_switch_probability: 0.03 },
  ],
  robustness: {
    recommendation_stability: 0.88,
    flip_risk_category: 'low',
    is_robust: true,
  },
};

/**
 * Base flip threshold data.
 */
export const BASE_FLIP_THRESHOLD_DATA = [
  { factor_id: 'factor-market', factor_label: 'Market Demand', current_value: 0.7, flip_value: null, direction: 'decrease' as const },
  { factor_id: 'factor-price', factor_label: 'Pricing Strategy', current_value: 0.5, flip_value: null, direction: 'decrease' as const },
];

// =============================================================================
// Happy Path Fixtures
// =============================================================================

/**
 * Valid M1 Review for "ready" readiness state with clear winner.
 * NOTE: All numbers in GROUNDED fields must match allowed numbers from input.
 * Grounded fields: narrative_summary, robustness_explanation.*, readiness_rationale,
 *                  bias_findings.description, scenario_contexts.*.trigger_description/consequence
 * Prescriptive fields (NOT scanned): evidence_enhancements, pre_mortem.*, flip_thresholds.plain_english,
 *                                    decision_quality_prompts.*
 *
 * Allowed numbers from buildTestRequest():
 *   win_probability: 0.77, 0.23
 *   recommendation_stability: 0.88
 *   elasticity: 0.42, 0.28, -0.15
 *   confidence: 0.7, 0.5, 0.8
 *   switch_probability: 0.12, 0.05
 *   marginal_switch_probability: 0.08, 0.03
 *   voi: 0.3, 0.2
 *   flip_threshold current_value: 0.7, 0.5
 *   margin: 0.54
 */
export const VALID_READY_REVIEW: M1Review = {
  // Grounded: uses 77%, 88%
  narrative_summary: 'Option A is the clear choice with 77% win probability. The recommendation stability of 88% indicates a robust decision.',
  story_headlines: {
    'option-a': 'Strong market positioning for success',
    'option-b': 'Viable alternative option',
  },
  robustness_explanation: {
    // Grounded: uses 88%, 42%, 12%
    summary: 'The decision is robust with 88% stability.',
    primary_risk: 'Market assumptions may need validation due to 12% switch probability.',
    stability_factors: ['High stability', 'Clear winner'],
    fragility_factors: ['Some edge fragility observed'],
  },
  // Grounded: uses 77%
  readiness_rationale: 'The decision is well-structured with 77% win probability support.',
  // Prescriptive - NOT scanned
  evidence_enhancements: {
    'factor-market': {
      specific_action: 'Conduct targeted market survey to validate demand assumptions',
      decision_hygiene: 'Document key market assumptions for future review',
    },
  },
  scenario_contexts: {
    'edge-3': {
      // Grounded: uses 70% (which is 0.7 confidence)
      trigger_description: 'If confidence drops below 70%, the recommendation may flip.',
      // Grounded: must reference option
      consequence: 'Option B becomes competitive if conditions deteriorate.',
    },
  },
  bias_findings: [
    {
      type: 'DOMINANT_FACTOR',
      source: 'structural',
      // Grounded: uses 42%
      description: 'Market demand factor shows 42% elasticity contribution.',
      affected_elements: ['factor-market'],
      linked_critique_code: 'SINGLE_DRIVER_DOMINANCE',
    },
  ],
  key_assumptions: [
    'Market demand remains stable at current levels',
    'Pricing strategy execution follows plan',
    'Competitive landscape unchanged',
  ],
  // Prescriptive - NOT scanned
  decision_quality_prompts: [
    {
      principle: 'Base Rate Consideration',
      applies_because: 'The success rate should be compared to industry benchmarks',
      question: 'Have you validated this against similar launches?',
    },
  ],
  // Prescriptive - NOT scanned
  pre_mortem: {
    failure_scenario: 'Option A fails due to unexpected market shift',
    warning_signs: ['Declining pre-orders', 'Competitor announcements'],
    mitigation: 'Establish early warning system and pivot criteria',
    grounded_in: ['edge-3', 'factor-market'],
    review_trigger: 'Review if trends decline',
  },
  flip_thresholds: [
    {
      factor_id: 'factor-market',
      factor_label: 'Market Demand',
      current_value: 0.7,  // Must match BASE_FLIP_THRESHOLD_DATA
      flip_value: 0.5,     // Prescriptive value, NOT validated against input
      direction: 'decrease',
      // Prescriptive - NOT scanned
      plain_english: 'Market demand would need to drop significantly to flip the recommendation.',
    },
  ],
};

/**
 * Valid M1 Review for "close_call" readiness state.
 */
export const VALID_CLOSE_CALL_REVIEW: M1Review = {
  ...VALID_READY_REVIEW,
  narrative_summary: 'This is a close call between Option A and Option B. The 77% win probability has moderate uncertainty with only 88% stability.',
  readiness_rationale: 'While the model favors Option A, the margin is sensitive to market assumptions. Additional evidence would strengthen confidence.',
};

/**
 * Valid M1 Review for "needs_evidence" readiness state.
 */
export const VALID_NEEDS_EVIDENCE_REVIEW: M1Review = {
  ...VALID_READY_REVIEW,
  narrative_summary: 'More evidence is needed before making this decision. The current 77% win probability has uncertainty that requires investigation.',
  readiness_rationale: 'Key factors lack sufficient data. The market demand assumptions need validation before proceeding.',
  key_assumptions: [
    'Market demand estimates are preliminary',
    'Pricing assumptions need market testing',
    'Competition analysis is incomplete',
  ],
};

// =============================================================================
// Negative Test Fixtures (one per failure code)
// =============================================================================

/**
 * Review with invented number (not in input data).
 * Should fail: UNGROUNDED_NUMBER
 *
 * Note: 95% is outside the 5% tolerance of all allowed values.
 * - 95 vs 88 (closest): |95-88|/88 = 7.9% > 5%, so NOT grounded
 */
export const INVALID_INVENTED_NUMBER: M1Review = {
  ...VALID_READY_REVIEW,
  narrative_summary: 'Option A has a 95% chance of success, far exceeding the 77% baseline.',
  // 95% is not in the input data and is outside 5% tolerance of all allowed values
};

/**
 * Review with readiness contradiction.
 * Should fail: READINESS_CONTRADICTION when readiness='needs_evidence'
 */
export const INVALID_READINESS_CONTRADICTION: M1Review = {
  ...VALID_READY_REVIEW,
  narrative_summary: 'We are confident and ready to proceed with Option A immediately.',
  readiness_rationale: 'The decision is clear choice - definitely go with Option A.',
  // "confident", "ready to proceed", "clear choice", "definitely" are forbidden for needs_evidence
};

/**
 * Review with missing option headline.
 * Should fail: MISSING_OPTION_HEADLINE
 */
export const INVALID_MISSING_HEADLINE: M1Review = {
  ...VALID_READY_REVIEW,
  story_headlines: {
    'option-a': 'Strong market positioning with 77% success probability',
    // Missing 'option-b'
  },
};

/**
 * Review with invalid edge in scenario_contexts.
 * Should fail: INVALID_SCENARIO_EDGE
 */
export const INVALID_SCENARIO_EDGE: M1Review = {
  ...VALID_READY_REVIEW,
  scenario_contexts: {
    'edge-999': {
      // Invalid edge ID (not a fragile edge)
      trigger_description: 'If this edge changes...',
      consequence: 'Option B becomes better.',
    },
  },
};

/**
 * Review with consequence not referencing valid option.
 * Should fail: CONSEQUENCE_INVALID_OPTION
 */
export const INVALID_CONSEQUENCE_OPTION: M1Review = {
  ...VALID_READY_REVIEW,
  scenario_contexts: {
    'edge-3': {
      trigger_description: 'If market demand drops...',
      consequence: 'Option C becomes the best choice.', // Option C doesn't exist
    },
  },
};

/**
 * Review with structural bias missing critique code.
 * Should fail: MISSING_CRITIQUE_CODE
 */
export const INVALID_MISSING_CRITIQUE_CODE: M1Review = {
  ...VALID_READY_REVIEW,
  bias_findings: [
    {
      type: 'DOMINANT_FACTOR',
      source: 'structural',
      description: 'Market demand accounts for 42% of outcome variation.',
      affected_elements: ['factor-market'],
      // Missing linked_critique_code
    },
  ],
};

/**
 * Review with semantic bias missing brief evidence.
 * Should fail: MISSING_BRIEF_EVIDENCE
 */
export const INVALID_MISSING_BRIEF_EVIDENCE: M1Review = {
  ...VALID_READY_REVIEW,
  bias_findings: [
    {
      type: 'SUNK_COST',
      source: 'semantic',
      description: 'Prior investment may be influencing this decision.',
      affected_elements: ['factor-price'],
      // Missing brief_evidence
    },
  ],
};

/**
 * Review with brief evidence too short.
 * Should fail: BRIEF_EVIDENCE_TOO_SHORT
 */
export const INVALID_BRIEF_EVIDENCE_SHORT: M1Review = {
  ...VALID_READY_REVIEW,
  bias_findings: [
    {
      type: 'ANCHORING',
      source: 'semantic',
      description: 'Price anchoring detected.',
      affected_elements: ['factor-price'],
      brief_evidence: 'price', // Too short (< 12 chars)
    },
  ],
};

/**
 * Review with brief evidence not a substring.
 * Should fail: BRIEF_EVIDENCE_NOT_SUBSTRING
 */
export const INVALID_BRIEF_EVIDENCE_NOT_SUBSTRING: M1Review = {
  ...VALID_READY_REVIEW,
  bias_findings: [
    {
      type: 'CONFIRMATION_BIAS',
      source: 'semantic',
      description: 'Confirmation bias in market analysis.',
      affected_elements: ['factor-market'],
      brief_evidence: 'This exact phrase is not in the brief at all', // Not in BASE_BRIEF
    },
  ],
};

/**
 * Review with pre-mortem not grounded.
 * Should fail: PREMORTEM_NOT_GROUNDED
 */
export const INVALID_PREMORTEM_NOT_GROUNDED: M1Review = {
  ...VALID_READY_REVIEW,
  pre_mortem: {
    failure_scenario: 'Everything fails',
    warning_signs: ['Bad signs'],
    mitigation: 'Do something',
    grounded_in: [], // Empty - not grounded
  },
};

/**
 * Review with invalid pre-mortem grounding ID.
 * Should fail: INVALID_GROUNDING_ID
 */
export const INVALID_PREMORTEM_GROUNDING_ID: M1Review = {
  ...VALID_READY_REVIEW,
  pre_mortem: {
    failure_scenario: 'Market collapse',
    warning_signs: ['Market signals'],
    mitigation: 'Pivot plan',
    grounded_in: ['invalid-id-999'], // Invalid ID
  },
};

/**
 * Review with modified flip threshold values.
 * Should fail: MODIFIED_VALUES
 */
export const INVALID_MODIFIED_FLIP_VALUES: M1Review = {
  ...VALID_READY_REVIEW,
  flip_thresholds: [
    {
      factor_id: 'factor-market',
      factor_label: 'Market Demand',
      current_value: 0.9, // Modified from 0.7
      flip_value: 0.35,
      direction: 'decrease',
      plain_english: 'Flip threshold description',
    },
  ],
};

/**
 * Review exceeding structural limits.
 * Should fail: STRUCTURAL_LIMIT_EXCEEDED
 */
export const INVALID_STRUCTURAL_LIMITS: M1Review = {
  ...VALID_READY_REVIEW,
  bias_findings: [
    { type: 'A', source: 'structural', description: 'One', affected_elements: [], linked_critique_code: 'A' },
    { type: 'B', source: 'structural', description: 'Two', affected_elements: [], linked_critique_code: 'B' },
    { type: 'C', source: 'structural', description: 'Three', affected_elements: [], linked_critique_code: 'C' },
    { type: 'D', source: 'structural', description: 'Four - exceeds limit', affected_elements: [], linked_critique_code: 'D' },
  ],
  key_assumptions: [
    'Assumption 1',
    'Assumption 2',
    'Assumption 3',
    'Assumption 4',
    'Assumption 5',
    'Assumption 6 - exceeds limit',
  ],
};

/**
 * Review with invalid decision quality prompt.
 * Should fail: INVALID_PROMPT_STRUCTURE
 */
export const INVALID_PROMPT_STRUCTURE: M1Review = {
  ...VALID_READY_REVIEW,
  decision_quality_prompts: [
    {
      principle: '', // Empty principle
      applies_because: 'Some reason',
      question: 'No question mark', // Missing ?
    },
  ],
};

// =============================================================================
// Request Builders
// =============================================================================

/**
 * Build a DecisionReviewRequest for testing.
 */
export function buildTestRequest(overrides: Partial<DecisionReviewRequest> = {}): DecisionReviewRequest {
  return {
    brief: BASE_BRIEF,
    brief_hash: 'abc123def456',
    graph: BASE_GRAPH,
    isl_results: BASE_ISL_RESULTS,
    deterministic_coaching: {
      readiness: 'ready',
      headline_type: 'clear_winner',
      evidence_gaps: [
        { factor_id: 'factor-market', factor_label: 'Market Demand', confidence: 0.7, voi: 0.3 },
        { factor_id: 'factor-price', factor_label: 'Pricing Strategy', confidence: 0.5, voi: 0.2 },
      ],
      model_critiques: [],
    },
    winner: {
      option_id: 'option-a',
      option_label: 'Option A',
      win_probability: 0.77,
    },
    runner_up: {
      option_id: 'option-b',
      option_label: 'Option B',
      win_probability: 0.23,
    },
    flip_threshold_data: BASE_FLIP_THRESHOLD_DATA,
    margin: 0.54,
    ...overrides,
  };
}

/**
 * Build a needs_evidence request.
 */
export function buildNeedsEvidenceRequest(): DecisionReviewRequest {
  return buildTestRequest({
    deterministic_coaching: {
      readiness: 'needs_evidence',
      headline_type: 'needs_evidence',
      evidence_gaps: [
        { factor_id: 'factor-market', factor_label: 'Market Demand', confidence: 0.4, voi: 0.6 },
        { factor_id: 'factor-price', factor_label: 'Pricing Strategy', confidence: 0.3, voi: 0.5 },
      ],
      model_critiques: [{ type: 'LOW_CONFIDENCE', severity: 'high', message: 'Key factors lack evidence' }],
    },
  });
}

/**
 * Build a single-option request (no runner-up).
 */
export function buildSingleOptionRequest(): DecisionReviewRequest {
  const request = buildTestRequest();
  return {
    ...request,
    isl_results: {
      ...request.isl_results,
      option_comparison: [
        { option_id: 'option-a', option_label: 'Option A', win_probability: 1.0, expected_outcome: 0.85 },
      ],
    },
    runner_up: null,
    margin: 1.0,
  };
}

// =============================================================================
// Single Option Review Fixture
// =============================================================================

/**
 * Valid review for single-option scenario.
 */
export const VALID_SINGLE_OPTION_REVIEW: M1Review = {
  narrative_summary: 'With only one option available, Option A is the default choice with 85% expected outcome.',
  story_headlines: {
    'option-a': 'The only option with solid expected outcomes',
  },
  robustness_explanation: {
    summary: 'Single option analysis shows 88% model stability.',
    primary_risk: 'No alternative options to fall back on.',
    stability_factors: ['Clear outcome expectations'],
    fragility_factors: ['No alternatives available'],
  },
  readiness_rationale: 'Single option scenario - proceeding with Option A.',
  evidence_enhancements: {},
  bias_findings: [],
  key_assumptions: ['Option A is the only viable path'],
  decision_quality_prompts: [
    {
      principle: 'Option Expansion',
      applies_because: 'Single option limits decision quality',
      question: 'Are there other options that should be considered?',
    },
  ],
};
