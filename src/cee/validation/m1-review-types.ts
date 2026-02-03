/**
 * M1 Review Types
 *
 * Type definitions for M2 Decision Review Integration.
 * These types define what CEE returns (M1Review) and what PLoT sends (DecisionReviewRequest).
 *
 * NOTE: The CEE prompt file is the canonical source. These types are based on
 * the brief specification - adjust if the actual prompt differs.
 *
 * @see Brief: M2 Decision Review Integration
 */

import { z } from 'zod';
import { M1_REVIEW_LIMITS, type ReviewStatus } from './m1-review-constants.js';

// =============================================================================
// M1Review — What CEE Returns
// =============================================================================

/**
 * Robustness explanation from CEE.
 * Summarizes model stability and risk factors.
 */
export interface RobustnessExplanation {
  /** Summary of the robustness assessment */
  summary: string;
  /** Primary risk to the recommendation */
  primary_risk: string;
  /** Factors contributing to stability (max 3) */
  stability_factors: string[];
  /** Factors contributing to fragility (max 3) */
  fragility_factors: string[];
}

/**
 * Evidence enhancement suggestion for a factor.
 */
export interface EvidenceEnhancement {
  /** Specific action to gather evidence */
  specific_action: string;
  /** Decision hygiene recommendation */
  decision_hygiene: string;
}

/**
 * Scenario context for a fragile edge.
 * Describes what happens if the edge changes.
 */
export interface ScenarioContext {
  /** Description of what triggers this scenario */
  trigger_description: string;
  /** Consequence description - must reference valid option label/ID */
  consequence: string;
}

/**
 * Bias finding from CEE.
 * Identifies potential cognitive biases in the decision model.
 */
export interface BiasFinding {
  /** Type of bias (e.g., SUNK_COST, DOMINANT_FACTOR) */
  type: string;
  /** Source of the bias finding */
  source: 'structural' | 'semantic';
  /** Description of the bias */
  description: string;
  /** Affected node_ids or edge_ids */
  affected_elements: string[];
  /** Required when source='structural' - links to model critique */
  linked_critique_code?: string;
  /** Required when source='semantic' - exact substring from brief */
  brief_evidence?: string;
}

/**
 * Decision quality prompt.
 * A question to help improve decision quality.
 */
export interface DecisionQualityPrompt {
  /** The principle this prompt addresses */
  principle: string;
  /** Why this principle applies to this decision */
  applies_because: string;
  /** The question to ask (must end with ?) */
  question: string;
}

/**
 * Pre-mortem analysis.
 * Anticipates potential failure scenarios.
 */
export interface PreMortem {
  /** Description of the failure scenario */
  failure_scenario: string;
  /** Early warning signs to watch for */
  warning_signs: string[];
  /** Mitigation strategy */
  mitigation: string;
  /** IDs this is grounded in (fragile_edge or evidence_gap IDs) */
  grounded_in: string[];
  /** Optional trigger for review */
  review_trigger?: string;
}

/**
 * Flip threshold analysis.
 * Shows how much a factor would need to change to flip the recommendation.
 */
export interface FlipThreshold {
  /** Factor ID */
  factor_id: string;
  /** Factor label for display */
  factor_label: string;
  /** Current value of the factor */
  current_value: number;
  /** Value at which recommendation would flip (null for heuristic approach) */
  flip_value: number | null;
  /** Direction of change needed */
  direction: string;
  /** Plain English explanation */
  plain_english: string;
}

/**
 * Framing check result.
 * Evaluates whether the decision framing is appropriate.
 */
export interface FramingCheck {
  /** Whether the framing addresses the goal */
  addresses_goal: boolean;
  /** Concern about the framing (if any) */
  concern?: string;
  /** Suggested reframe (if applicable) */
  suggested_reframe?: string;
}

/**
 * M1 Review - What CEE Returns
 *
 * The complete decision review output from CEE's /assist/v1/decision-review endpoint.
 * This is validated by PLoT's 9-tier validator before being trusted.
 */
export interface M1Review {
  /** 2-4 sentence narrative summary */
  narrative_summary: string;

  /** Story headlines keyed by option ID */
  story_headlines: Record<string, string>;

  /** Robustness explanation */
  robustness_explanation: RobustnessExplanation;

  /** Rationale for the readiness assessment */
  readiness_rationale: string;

  /** Evidence enhancements keyed by factor ID (from evidence_gaps) */
  evidence_enhancements: Record<string, EvidenceEnhancement>;

  /** Scenario contexts keyed by edge ID (from fragile_edges). Optional when no fragile edges. */
  scenario_contexts?: Record<string, ScenarioContext>;

  /** Bias findings (max 3) */
  bias_findings: BiasFinding[];

  /** Key assumptions (max 5) */
  key_assumptions: string[];

  /** Decision quality prompts (max 3) */
  decision_quality_prompts: DecisionQualityPrompt[];

  /** Pre-mortem analysis (optional) */
  pre_mortem?: PreMortem;

  /** Flip thresholds (max 2, optional) */
  flip_thresholds?: FlipThreshold[];

  /** Framing check (optional) */
  framing_check?: FramingCheck;
}

// =============================================================================
// DecisionReviewRequest — What PLoT Sends to CEE
// =============================================================================

/**
 * Graph node for decision review request.
 * Stripped to essential fields only.
 */
export interface DecisionReviewNode {
  id: string;
  label: string;
  kind: string;
}

/**
 * Graph edge for decision review request.
 */
export interface DecisionReviewEdge {
  /** Edge ID (if available) - needed for edge_id validation */
  id?: string;
  from: string;
  to: string;
  strength: { mean: number; std: number };
  exists_probability: number;
}

/**
 * Option comparison data from ISL.
 */
export interface OptionComparisonData {
  option_id: string;
  option_label: string;
  win_probability: number;
  expected_outcome: number;
}

/**
 * Factor sensitivity data from ISL.
 */
export interface FactorSensitivityData {
  factor_id: string;
  factor_label: string;
  elasticity: number;
  confidence: number;
}

/**
 * Fragile edge data from ISL.
 */
export interface FragileEdgeData {
  edge_id: string;
  from: string;
  to: string;
  switch_probability: number;
  marginal_switch_probability?: number;
}

/**
 * Robustness summary from ISL.
 */
export interface RobustnessData {
  recommendation_stability: number;
  flip_risk_category: string;
  is_robust: boolean;
}

/**
 * Deterministic coaching data from M1 coaching.
 */
export interface DeterministicCoachingData {
  readiness: 'ready' | 'close_call' | 'needs_evidence' | 'needs_framing';
  headline_type: string;
  evidence_gaps: Array<{
    factor_id: string;
    factor_label: string;
    confidence: number;
    voi: number;
  }>;
  model_critiques: Array<{
    type: string;
    severity: string;
    message: string;
  }>;
}

/**
 * Winner/runner-up option data.
 * Field names match CEE's /assist/v1/decision-review Zod schema.
 */
export interface WinnerData {
  id: string;
  label: string;
  win_probability: number;
  outcome_mean?: number;
}

/**
 * Flip threshold input data.
 * PLoT computes this from factor sensitivity and margin.
 */
export interface FlipThresholdInputData {
  factor_id: string;
  factor_label: string;
  current_value: number;
  /** Null when using heuristic approach (elasticity ≠ Δwin_probability) */
  flip_value: number | null;
  direction: 'increase' | 'decrease';
}

/**
 * Decision Review Request - What PLoT Sends to CEE
 *
 * Assembled from M1 coaching outputs and ISL results.
 * Used to generate the M1Review via CEE's /assist/v1/decision-review endpoint.
 */
export interface DecisionReviewRequest {
  /** The user's decision brief text */
  brief: string;

  /** SHA-256 hash of brief (first 16 chars) */
  brief_hash: string;

  /** Stripped graph */
  graph: {
    nodes: DecisionReviewNode[];
    edges: DecisionReviewEdge[];
  };

  /** ISL results */
  isl_results: {
    option_comparison: OptionComparisonData[];
    factor_sensitivity: FactorSensitivityData[];
    fragile_edges: FragileEdgeData[];
    robustness: RobustnessData;
  };

  /** Deterministic coaching from M1 */
  deterministic_coaching: DeterministicCoachingData;

  /** Winning option */
  winner: WinnerData;

  /** Second-place option (null if only one option) */
  runner_up: WinnerData | null;

  /** Flip threshold data (computed by PLoT) */
  flip_threshold_data: FlipThresholdInputData[];

  /** Explicit margin: winner.win_probability - runner_up.win_probability */
  margin: number;
}

// =============================================================================
// CEE Response Wrapper
// =============================================================================

/**
 * CEE decision review response wrapper.
 * The response from /assist/v1/decision-review endpoint.
 */
export interface CeeDecisionReviewResponse {
  review: M1Review;
  _meta: {
    model: string;
    latency_ms: number;
    tokens: number;
  };
}

// =============================================================================
// Result Types for PLoT
// =============================================================================

/**
 * Decision review result for merging into run response.
 */
export interface DecisionReviewResult {
  m1_review: M1Review | null;
  review_status: ReviewStatus;
  review_meta?: {
    model?: string;
    latency_ms?: number;
    tokens?: number;
  };
  review_failure_codes?: string[];
}

// =============================================================================
// Zod Schema for M1Review Validation
// =============================================================================

const RobustnessExplanationSchema = z.object({
  summary: z.string(),
  primary_risk: z.string(),
  stability_factors: z.array(z.string()).max(M1_REVIEW_LIMITS.MAX_STABILITY_FACTORS),
  fragility_factors: z.array(z.string()).max(M1_REVIEW_LIMITS.MAX_FRAGILITY_FACTORS),
});

const EvidenceEnhancementSchema = z.object({
  specific_action: z.string(),
  decision_hygiene: z.string(),
});

const ScenarioContextSchema = z.object({
  trigger_description: z.string(),
  consequence: z.string(),
});

const BiasFindingSchema = z.object({
  type: z.string(),
  source: z.enum(['structural', 'semantic']),
  description: z.string(),
  affected_elements: z.array(z.string()),
  linked_critique_code: z.string().optional(),
  brief_evidence: z.string().optional(),
});

const DecisionQualityPromptSchema = z.object({
  principle: z.string(),
  applies_because: z.string(),
  question: z.string(),
});

const PreMortemSchema = z.object({
  failure_scenario: z.string(),
  warning_signs: z.array(z.string()),
  mitigation: z.string(),
  grounded_in: z.array(z.string()),
  review_trigger: z.string().optional(),
});

const FlipThresholdSchema = z.object({
  factor_id: z.string(),
  factor_label: z.string(),
  current_value: z.number(),
  flip_value: z.number().nullable(), // PLoT sends null for heuristic approach
  direction: z.string(),
  plain_english: z.string(),
});

const FramingCheckSchema = z.object({
  addresses_goal: z.boolean(),
  concern: z.string().optional(),
  suggested_reframe: z.string().optional(),
});

/**
 * Zod schema for M1Review.
 * Used for basic shape validation before the 9-tier semantic validator.
 */
export const M1ReviewSchema = z.object({
  narrative_summary: z.string(),
  story_headlines: z.record(z.string(), z.string()),
  robustness_explanation: RobustnessExplanationSchema,
  readiness_rationale: z.string(),
  evidence_enhancements: z.record(z.string(), EvidenceEnhancementSchema),
  scenario_contexts: z.record(z.string(), ScenarioContextSchema).optional(),
  bias_findings: z.array(BiasFindingSchema).max(M1_REVIEW_LIMITS.MAX_BIAS_FINDINGS),
  key_assumptions: z.array(z.string()).max(M1_REVIEW_LIMITS.MAX_KEY_ASSUMPTIONS),
  decision_quality_prompts: z.array(DecisionQualityPromptSchema).max(M1_REVIEW_LIMITS.MAX_DECISION_QUALITY_PROMPTS),
  pre_mortem: PreMortemSchema.optional(),
  flip_thresholds: z.array(FlipThresholdSchema).max(M1_REVIEW_LIMITS.MAX_FLIP_THRESHOLDS).optional(),
  framing_check: FramingCheckSchema.optional(),
});

/**
 * Parse and validate M1Review shape.
 * Returns parsed object or throws ZodError.
 */
export function parseM1Review(data: unknown): M1Review {
  return M1ReviewSchema.parse(data);
}

/**
 * Safe parse M1Review shape.
 * Returns success/error result without throwing.
 */
export function safeParseM1Review(data: unknown): z.SafeParseReturnType<unknown, M1Review> {
  return M1ReviewSchema.safeParse(data);
}
