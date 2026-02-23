/**
 * Enhanced Run Bundle Types
 *
 * Extended request/response types for option ranking and change attribution.
 * Phase 1: Simple mode ranking without utility function requirement.
 * Phase 2: Edge type inference and response warnings.
 * Phase 1 Critical Fixes: Constraint status, coherence warnings, baseline identification.
 */

import type { ChangeAttribution } from '../../../types/change-attribution.js';
import type { EdgeType } from '../../../trust/types.js';
import type {
  ConstraintStatus,
  CoherenceWarning,
  ConstraintViolation,
} from '../../../trust/result-coherence.js';
import type { FactsEnvelope } from '../../../facts/types.js';
import type { ReviewPassEnvelopeV1 } from '../../../review-pass/types.js';

// Re-export for convenience
export type { ConstraintStatus, CoherenceWarning, ConstraintViolation };

/**
 * Sort key for ranking options
 */
export type RankingSortKey = 'p10' | 'p50' | 'p90';

/**
 * Ranking mode for option comparison
 * - simple: Rank by primary outcome p50 (default, no utility required)
 * - utility: Rank by expected utility (requires utility_function)
 */
export type RankingMode = 'simple' | 'utility';

/**
 * Risk attitude for utility calculations
 */
export type RiskAttitude = 'risk_averse' | 'risk_neutral' | 'risk_seeking';

/**
 * Utility function for multi-outcome ranking
 */
export interface UtilityFunction {
  /** Weights per outcome node (must sum to 1.0) */
  weights: Record<string, number>;
  /** Risk attitude affects how uncertainty is valued */
  risk_attitude?: RiskAttitude;
}

/**
 * Validation issue for utility function
 */
export interface UtilityValidationIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  field?: string;
}

/**
 * Result of utility function validation
 */
export interface UtilityValidationResult {
  valid: boolean;
  issues: UtilityValidationIssue[];
}

/**
 * Suggestion to use utility mode
 */
export interface UtilitySuggestion {
  message: string;
  applicable: boolean;
  outcome_nodes: string[];
}

/**
 * Warning code for response warnings
 */
export type ResponseWarningCode =
  | 'EDGE_TYPE_INFERRED'
  | 'PRIMARY_OUTCOME_INFERRED'
  | 'BELIEF_DEFAULTED'
  | 'UTILITY_MODE_EXPERIMENTAL';

/**
 * Warning about inferred or defaulted values in the request
 */
export interface ResponseWarning {
  /** Machine-readable warning code */
  code: ResponseWarningCode;
  /** Human-readable warning message */
  message: string;
  /** Affected entity IDs (edge IDs, node IDs, etc.) */
  affected_ids?: string[];
  /** Severity level */
  severity: 'info' | 'warning';
}

/**
 * Summary of edge type inference for observability
 */
export interface EdgeTypeInferenceSummary {
  /** Count of edges with explicit types */
  explicit_count: number;
  /** Count of edges with inferred types */
  inferred_count: number;
  /** Inferred edge type details by edge */
  inferred_edges?: Array<{
    edge_id: string;
    inferred_type: EdgeType;
  }>;
}

/**
 * Ranking confidence level based on distribution overlap
 */
export type RankingConfidence = 'high' | 'medium' | 'low';

/**
 * Node-level sensitivity aggregation
 */
export interface NodeSensitivity {
  /** Node identifier */
  node_id: string;
  /** Human-readable node label */
  node_label: string;
  /** Percentage contribution to outcome variance (0-100) */
  contribution_pct: number;
  /** Number of edges from this node contributing to sensitivity */
  edge_count: number;
}

/**
 * Delta from baseline for a scenario result
 */
export interface DeltaFromBaseline {
  /** Difference in p10 from baseline */
  p10: number;
  /** Difference in p50 from baseline */
  p50: number;
  /** Difference in p90 from baseline */
  p90: number;
  /** Causal attribution explaining the difference */
  change_attribution: ChangeAttribution;
}

/**
 * Summary of ranking results
 */
export interface RankingSummary {
  /** Label of the winning option (highest by sort_by metric) */
  winner: string;
  /** p50 value of the winner */
  winner_p50: number;
  /** Absolute difference between winner and runner-up */
  margin: number | null;
  /** Margin as percentage of runner-up value */
  margin_pct: number | null;
  /** Confidence in ranking stability based on distribution overlap */
  ranking_confidence: RankingConfidence;
  /** Number of options successfully ranked */
  ranked_count: number;
  /** Labels of options excluded from ranking (due to errors) */
  excluded: string[];
  /** True if winner dominates all others (p10, p50, p90 all better) */
  winner_dominant?: boolean;
}

/**
 * Delta from baseline including vs baseline comparison
 */
export interface DeltaVsBaseline {
  /** Difference in p10 from baseline */
  p10: number;
  /** Difference in p50 from baseline */
  p50: number;
  /** Difference in p90 from baseline */
  p90: number;
}

/**
 * Enhanced result for a single scenario
 */
export interface EnhancedBundleResult {
  /** Scenario label */
  label: string;
  /** Outcome distribution */
  summary: {
    p10: number;
    p50: number;
    p90: number;
  } | null;
  /** Rank among all scenarios (1 = best) */
  rank?: number;
  /** Alias for summary[sort_by] for convenience */
  success_probability?: number;
  /** Difference from baseline scenario */
  delta_from_baseline?: DeltaFromBaseline;
  /** Delta vs identified baseline option (Task 1.7) */
  delta_vs_baseline?: DeltaVsBaseline;
  /** Node-level sensitivity (top 5 nodes) */
  sensitivity_by_node?: NodeSensitivity[];
  /** Constraint violations for this option (Task 1.3) */
  constraint_violations?: ConstraintViolation[];
  /** Is this option infeasible due to constraint violations? (Task 1.3) */
  infeasible?: boolean;
  /** Model metadata */
  model_card: {
    seed: number;
    nodes: number;
    edges: number;
    backend: string;
    detail_level: string;
    K?: number;
    response_hash: string;
    duplicate?: boolean;
    inference_error?: string;
  };
  /** Error information if scenario failed */
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Enhanced run_bundle response
 */
export interface EnhancedBundleResponse {
  schema: 'run_bundle.v1';
  results: EnhancedBundleResult[];
  ranking_summary?: RankingSummary;
  /** Ranking mode that was used */
  ranking_mode_used?: RankingMode;
  /** Primary outcome node used for ranking */
  primary_outcome_used?: string;
  /** True if primary outcome was auto-detected */
  primary_outcome_detected?: boolean;
  /** Suggestion to use utility mode (when applicable) */
  utility_suggestion?: UtilitySuggestion;
  /** Response warnings for inferred/defaulted values (Phase 2) */
  warnings?: ResponseWarning[];
  /** Edge type inference summary for observability (Phase 2) */
  edge_type_inference?: EdgeTypeInferenceSummary;
  /** Constraint status with violations and active constraints (Task 1.3) */
  constraint_status?: ConstraintStatus;
  /** Coherence warnings about inference results (Task 1.6) */
  coherence_warnings?: CoherenceWarning[];
  /** Edge function sensitivity warnings (Phase 3, Task 4.3) - separate from coherence for schema clarity */
  edge_function_warnings?: CoherenceWarning[];
  /** Stream D: FactObjectV1 envelope (backward-compatible, feature-flagged) */
  facts?: FactsEnvelope;
  /** Stream D: Pre-analysis review pass (backward-compatible, feature-flagged) */
  pre_analysis_review?: ReviewPassEnvelopeV1;
  /** Stream D: Post-analysis review pass (backward-compatible, feature-flagged) */
  post_analysis_review?: ReviewPassEnvelopeV1;
  // baseline_label moved to meta (single source of truth)
  model_card: {
    seed: number;
    detail_level: string;
    backend: string;
    response_hash: string;
  };
  meta: {
    seed: number;
    total_scenarios: number;
    unique_results: number;
    inference_mode: 'model_based' | 'mixed';
    all_scenarios_succeeded: boolean;
    fallback_count?: number;
    baseline_label?: string;
    baseline_index?: number;
    evidence_applied?: Array<{ node_id: string; source: string }>;
  };
}
