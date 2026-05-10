/**
 * ISL (Inference Service Layer) Response Types
 *
 * These types represent the raw responses from the ISL service.
 * They are transformed by adapters before use in PLoT.
 */

/**
 * ISL validation response from /api/v1/causal/validate
 */
export interface ISLValidationResponse {
  /** ISL-native vocabulary — intentionally not renamed to PLoT's 'not_backdoor_identifiable' */
  status: 'identifiable' | 'partially_identifiable' | 'not_identifiable';
  adjustment_sets: string[][];
  minimal_adjustment_set: string[];
  suggestions: Array<{
    type: string;
    description: string;
    affected_variables: string[];
    suggested_action: string;
  }>;
  robustness: 'high' | 'medium' | 'low';
}

/**
 * ISL sensitivity response from /api/v1/causal/sensitivity/detailed
 */
export interface ISLSensitivityResponse {
  sensitivities: Array<{
    parameter: string;
    sensitivity_score: number;
    direction: 'positive' | 'negative' | 'mixed';
    confidence_interval: [number, number];
  }>;
  overall_robustness: 'robust' | 'moderate' | 'fragile';
  recommendations: string[];
  analysis_metadata: {
    method: string;
    samples: number;
  };
}

/**
 * ISL counterfactual response from /api/v1/causal/counterfactual
 */
export interface ISLCounterfactualResponse {
  estimate: number;
  confidence_interval: {
    lower: number;
    upper: number;
    level: number;  // e.g., 0.95
  };
  uncertainty_decomposition: {
    parametric: number;
    structural: number;
    stochastic: number;
  };
  sensitivity_range: {
    min: number;
    max: number;
  };
}

/**
 * ISL health check response from /health
 */
export interface ISLHealthResponse {
  status: 'ok' | 'degraded' | 'unhealthy';
  version?: string;
  latency_ms?: number;
}

/**
 * ISL DAG structure for requests
 */
export interface ISLDAGStructure {
  nodes: string[];
  edges: [string, string][];  // Array of [from, to] tuples
}

/**
 * ISL validation request
 */
export interface ISLValidationRequest {
  dag: ISLDAGStructure;
  treatment: string;
  outcome: string;
}

/**
 * ISL sensitivity request
 */
export interface ISLSensitivityRequest {
  dag: ISLDAGStructure;
  treatment: string;
  outcome: string;
}

/**
 * ISL counterfactual request
 */
export interface ISLCounterfactualRequest {
  dag: ISLDAGStructure;
  intervention: Record<string, number>;
  target: string;
}

/**
 * Parameter uncertainty specification for factor sensitivity analysis
 * Used in /api/v1/robustness/analyze/v2 requests
 */
export interface ISLParameterUncertainty {
  /** Node ID of the factor */
  node_id: string;
  /** Distribution type for uncertainty */
  distribution: 'normal' | 'uniform';
  /** Mean value (for normal distribution) */
  mean?: number;
  /** Standard deviation (for normal distribution) */
  std?: number;
  /** Minimum value (for uniform distribution) */
  range_min?: number;
  /** Maximum value (for uniform distribution) */
  range_max?: number;
}

/**
 * ISL robustness analysis request for /api/v1/robustness/analyze/v2
 *
 * When analysis_types includes 'sensitivity', returns edge sensitivity data.
 * When analysis_types includes 'comparison', returns option comparison results.
 * When analysis_types includes 'robustness', returns overall robustness assessment.
 */
export interface ISLRobustnessAnalyzeV2Request {
  request_id: string;
  graph: {
    nodes: Array<{
      id: string;
      kind?: 'decision' | 'option' | 'factor' | 'outcome' | 'goal';
      label?: string;
      observed_state?: {
        value?: number;
        baseline?: number;
        unit?: string;
      };
    }>;
    edges: Array<{
      from: string;
      to: string;
      /** Probability that this edge exists (0-1) */
      exists_probability?: number;
      /** Edge strength with uncertainty */
      strength?: {
        mean: number;
        std: number;
      };
      // Legacy fields for backwards compatibility
      weight?: number;
      belief_exists?: number;
      belief_strength?: number;
    }>;
  };
  options: Array<{
    id: string;
    label?: string;
    interventions?: Record<string, number>;
  }>;
  goal_node_id: string;
  n_samples?: number;
  /** Analysis types to run - 'sensitivity' returns edge sensitivity data */
  analysis_types: Array<'comparison' | 'sensitivity' | 'robustness'>;
  /** Optional parameter uncertainties for factor sensitivity */
  parameter_uncertainties?: ISLParameterUncertainty[];
}

/** @deprecated Use ISLRobustnessAnalyzeV2Request instead */
export type ISLFactorSensitivityRequest = ISLRobustnessAnalyzeV2Request;

/**
 * Factor sensitivity item from ISL /api/v1/robustness/analyze/v2 response
 *
 * Field name evolution:
 * - Schema v2.6 canonical: sensitivity_score
 * - Legacy: sensitivity
 *
 * PLoT supports both for backward compatibility.
 */
export interface ISLFactorSensitivityItem {
  /** Node ID of the factor */
  node_id: string;
  /** Sensitivity score (Schema v2.6 canonical) */
  sensitivity_score?: number;
  /** Legacy: Sensitivity score (pre-v2.6) */
  sensitivity?: number;
  /** Value of information for this factor */
  value_of_information?: number;
  /** Direction of impact */
  direction?: 'positive' | 'negative' | 'mixed';

  // 3C stability fields (ISL bootstrap analysis)
  /** Bootstrap standard deviation of the elasticity estimate */
  elasticity_std?: number;
  /** Attribution stability category */
  attribution_stability?: 'high' | 'moderate' | 'low' | 'negligible';
  /** Rate at which this factor's rank flips across bootstrap samples */
  rank_flip_rate?: number;
  /** Method used to compute stability metrics */
  stability_method?: string;
  /** ISL-computed confidence from bootstrap stability (0-1) */
  confidence?: number;
}

/**
 * Edge sensitivity item from ISL /api/v1/robustness/analyze/v2 response
 * Returned when analysis_types includes 'sensitivity'
 */
export interface ISLEdgeSensitivityItem {
  /** Source node ID */
  edge_from: string;
  /** Target node ID */
  edge_to: string;
  /** Type of sensitivity: whether edge exists vs magnitude of effect */
  sensitivity_type: 'existence' | 'magnitude';
  /** Elasticity score - how much outcome changes per unit change */
  elasticity: number;
  /** Rank by importance (1 = most important) */
  importance_rank: number;
  /** Human-readable interpretation - USE THIS for direction, not elasticity sign */
  interpretation: string;
}

/**
 * ISL edge E-value from robustness analysis.
 * Measures evidence strength for each edge's causal effect direction.
 */
export interface ISLEdgeEValue {
  /** Edge ID in ISL format (e.g., "from->to") */
  edge_id: string;
  /** E-value (evidence strength) */
  e_value: number;
  /** Direction the edge would need to flip to change the recommendation */
  flip_direction: 'positive_to_negative' | 'negative_to_positive' | 'removal';
  /** Current mean effect of this edge */
  current_mean: number;
  /** Mean effect at the flip point */
  flip_mean: number;
}

/**
 * ISL conditional winner analysis per factor.
 * Shows how the winning option changes conditional on factor value buckets.
 */
export interface ISLConditionalWinner {
  /** Factor node ID */
  factor_id: string;
  /** Factor label */
  factor_label?: string;
  /** Value at which the split occurs */
  split_value: number;
  /** Unit for the split value */
  split_unit?: string;
  /** Low bucket: option outcomes below the split */
  low_bucket: ISLConditionalBucket;
  /** High bucket: option outcomes above the split */
  high_bucket: ISLConditionalBucket;
  /** Whether the winning option flips between buckets */
  winner_flips: boolean;
}

/**
 * A bucket in the conditional winner analysis.
 */
export interface ISLConditionalBucket {
  /** Winning option ID in this bucket */
  winner_id: string;
  /** Runner-up option ID in this bucket */
  runner_up_id?: string;
  /** Win probability of the winner in this bucket */
  win_probability: number;
  /** Mean outcome for the winner in this bucket */
  mean_outcome?: number;
}

/**
 * ISL fragile edge info from robustness analysis.
 * Returned in robustness.fragile_edges array.
 */
export interface ISLFragileEdgeInfo {
  /** Edge ID in "from->to" format */
  edge_id: string;
  /** Source node ID (may be parsed from edge_id) */
  from_id?: string;
  /** Target node ID (may be parsed from edge_id) */
  to_id?: string;
  /** Probability this edge causes recommendation to switch (0-1) */
  switch_probability?: number;
  /** Marginal probability of recommendation switch for this edge */
  marginal_switch_probability?: number;
  /** Option that would win if this edge changes */
  alternative_winner_id?: string;
}

/**
 * ISL V2 nested outcome object
 */
export interface ISLOutcomeStats {
  /** Mean outcome value */
  mean?: number;
  /** Standard deviation */
  std?: number;
  /** 10th percentile */
  p10?: number;
  /** 50th percentile (median) */
  p50?: number;
  /** 90th percentile */
  p90?: number;
  /** Number of samples used */
  n_samples?: number;
  /** Number of valid (non-NaN) samples */
  n_valid_samples?: number;
  /** Ratio of valid to total samples */
  validity_ratio?: number;
}

// -----------------------------------------------------------------------------
// Constraint Analysis Types (per-option, nested under option results)
// -----------------------------------------------------------------------------

/**
 * Single constraint evaluation result from ISL.
 * ISL returns both "threshold" (primary) and "value" (computed).
 * PLoT reads value ?? threshold.
 */
export interface ISLConstraintResult {
  node_id: string;
  operator: string;
  threshold: number;
  value?: number;
  prob_satisfied: number;
  failure_margin_median?: number;
  near_miss_fraction?: number;
  binding?: boolean;
}

/**
 * Conditional probability between constraints from ISL.
 * Uses index-based references into the constraints array.
 */
export interface ISLConditionalProbability {
  given_constraint_index: number;
  target_constraint_index: number;
  probability: number;
}

/**
 * Constraint analysis block returned per-option by ISL.
 * Present when goal_constraints were sent in the request.
 */
export interface ISLConstraintAnalysis {
  constraints: ISLConstraintResult[];
  joint_probability: number;
  conditional_probabilities?: ISLConditionalProbability[];
}

/**
 * Option comparison result from ISL /api/v1/robustness/analyze/v2 response
 * Returned when analysis_types includes 'comparison'
 *
 * Supports both V1 (flat) and V2 (nested outcome) formats.
 */
export interface ISLOptionComparisonResult {
  /** Option identifier (V2 format uses option_id, V1 uses id) */
  option_id?: string;
  /** Legacy option identifier (V1 format) */
  id?: string;
  /** Option label for display */
  label?: string;
  /** Expected outcome value (V1 format, deprecated - use outcome.mean) */
  expected_outcome?: number;
  /** Confidence interval [p10, p90] (V1 format, deprecated - use outcome.p10/p90) */
  confidence_interval?: [number, number];
  /** Full outcome statistics (V2 format) */
  outcome?: ISLOutcomeStats;
  /** Probability that this option achieves the goal */
  probability_of_goal?: number;
  /** Win probability vs other options */
  win_probability?: number;
  /** Computation status for this option */
  status?: 'computed' | 'skipped' | 'error';
  /** Reason if status is not 'computed' */
  status_reason?: string;
  /** Per-option constraint analysis (present when goal_constraints sent) */
  constraint_analysis?: ISLConstraintAnalysis;
}

/**
 * ISL robustness analysis response from /api/v1/robustness/analyze/v2
 *
 * Full response schema when all analysis_types are requested.
 */
export interface ISLRobustnessAnalyzeV2Response {
  /** Request ID echo */
  request_id?: string;

  /** Edge sensitivity (when 'sensitivity' in analysis_types) */
  sensitivity?: ISLEdgeSensitivityItem[];

  /** Factor-level sensitivity scores */
  factor_sensitivity?: ISLFactorSensitivityItem[];

  /** Overall robustness assessment (when 'robustness' in analysis_types)
   *
   * Supports both V1 and V2 (Option C) formats:
   * - V1: { score, label: 'robust'|'moderate'|'fragile', explanation }
   * - V2: { confidence, level: 'high'|'medium'|'low'|'very_low', is_robust, recommendation_stability }
   */
  robustness?: {
    /** Robustness score (0-1) - V1 format */
    score?: number;
    /** Robustness confidence (0-1) - V2/Option C format */
    confidence?: number;
    /** Human-readable label - V1 format */
    label?: 'robust' | 'moderate' | 'fragile';
    /** Robustness level - V2/Option C format */
    level?: 'high' | 'medium' | 'low' | 'very_low';
    /** Boolean robustness flag - V2/Option C format */
    is_robust?: boolean;
    /** Recommendation stability score (0-1) - V2/Option C format */
    recommendation_stability?: number;
    /**
     * Edges identified as fragile (sensitive to changes).
     * ISL returns objects with edge_id, from_id, to_id, switch_probability.
     */
    fragile_edges?: ISLFragileEdgeInfo[];
    /**
     * Edges identified as robust.
     * ISL returns strings in "from->to" format.
     */
    robust_edges?: string[];
    /** Explanation of robustness assessment - V1 format (optional in V2) */
    explanation?: string;
  };

  /**
   * Option comparison results (when 'comparison' in analysis_types)
   *
   * ISL Response Version handling:
   * - V1 format: uses 'results' field
   * - V2 format: uses 'options' field with p10/p50/p90 bands
   *
   * PLoT sends X-ISL-Response-Version: 2 header, so prefer 'options'.
   * Keep 'results' for backward compatibility during transition.
   */
  options?: ISLOptionComparisonResult[];

  /** @deprecated V1 format - use 'options' for V2 responses */
  results?: ISLOptionComparisonResult[];

  /** Recommended option ID */
  recommended_option_id?: string;

  /** Confidence in the recommendation */
  recommendation_confidence?: number;

  /** Validation status from causal graph analysis */
  validation_status?: 'identifiable' | 'uncertain' | 'cannot_identify';

  /** Confidence in the validation assessment */
  validation_confidence?: 'high' | 'medium' | 'low';

  /**
   * Edge E-values measuring evidence strength for each edge's causal direction.
   * Present when ISL provides E-value analysis.
   */
  edge_e_values?: ISLEdgeEValue[];

  /**
   * Conditional winner analysis per factor.
   * Shows how the winning option changes conditional on factor value buckets.
   */
  conditional_winners?: ISLConditionalWinner[];

  /**
   * Inference warnings from ISL.
   * Forwarded into PLoT's inference_warnings array in the response.
   */
  inference_warnings?: Array<{
    code: string;
    message: string;
    severity?: 'info' | 'warning';
  }>;

  /**
   * Analysis metadata. ISL serialises this as `_metadata` on the wire
   * (Pydantic `alias="_metadata"`, `by_alias=True`) but accepts both keys
   * inbound (`populate_by_name=True`). We type both defensively because
   * fixtures and older captures may use either; the read site
   * `extractIslAutoNoiseApplied` coalesces the two.
   *
   * Carries `auto_noise_applied` (audit B3) — the operational flag
   * indicating whether ISL applied auto-scaled noise to outcome/risk
   * distributions on this run.
   *
   * @see ISL `RobustnessResponseV2.metadata` (alias `_metadata`) and
   *      `ResponseMetadataV2.auto_noise_applied`.
   */
  _metadata?: ISLResponseMetadataV2;
  metadata?: ISLResponseMetadataV2;
}

/**
 * Subset of ISL's `ResponseMetadataV2` that PLoT consumes today. Other
 * fields (clamp_metrics, config_fingerprint, tie_count, tie_rate,
 * seed_hash_version, n_defaulted_root_nodes, n_samples, duration_ms)
 * exist on the wire but are not currently propagated through PLoT.
 */
export interface ISLResponseMetadataV2 {
  /**
   * Whether ISL applied its operational auto-noise heuristic
   * (`_apply_auto_scaled_noise` at `robustness_analyzer_v2.py:1113`)
   * to outcome/risk distributions on this run. `false` when the goal
   * node kind is not in {outcome, risk} or when sample std is 0.
   *
   * @see truth-table row B3 (P0 disclosure).
   */
  auto_noise_applied?: boolean;
  /** Number of Monte Carlo samples (legacy field, kept for compat). */
  n_samples?: number;
  /** Analysis duration in milliseconds (legacy field, kept for compat). */
  duration_ms?: number;
}

/** @deprecated Use ISLRobustnessAnalyzeV2Response instead */
export interface ISLFactorSensitivityResponse {
  /** Factor-level sensitivity scores */
  factor_sensitivity: ISLFactorSensitivityItem[];
  /** Overall robustness assessment */
  robustness: {
    /** Robustness score (0-1) */
    score: number;
    /** Human-readable label */
    label: 'robust' | 'moderate' | 'fragile';
    /** Explanation of robustness assessment */
    explanation: string;
  };
  /** Analysis metadata */
  metadata?: {
    /** Number of samples used */
    n_samples?: number;
    /** Analysis duration in milliseconds */
    duration_ms?: number;
  };
}
