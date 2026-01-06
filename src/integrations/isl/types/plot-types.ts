/**
 * PLoT Types for ISL Integration
 *
 * These types represent the format PLoT expects after ISL responses
 * are transformed by the adapters.
 */

/**
 * PLoT validation result (transformed from ISL)
 */
export interface PLoTValidationResult {
  /** Identifiability status */
  status: 'identifiable' | 'uncertain' | 'cannot_identify';
  /** Confidence in the validation */
  confidence: 'high' | 'medium' | 'low';
  /** Valid adjustment sets */
  adjustment_sets?: string[][];
  /** Minimal sufficient adjustment set */
  minimal_set?: string[];
  /** Detected backdoor paths */
  backdoor_paths?: string[];
  /** Issues that may affect identifiability */
  issues?: Array<{
    type: string;
    description: string;
    affected_nodes: string[];
    suggested_action: string;
  }>;
  /** Human-readable explanation */
  explanation?: {
    summary: string;
    reasoning: string;
  };
  /** Source of the result */
  source: 'isl' | 'engine_fallback';
}

/**
 * PLoT sensitivity result (transformed from ISL)
 */
export interface PLoTSensitivityResult {
  /** Overall model robustness */
  overall_robustness: 'robust' | 'moderate' | 'fragile';
  /** Parameters sorted by sensitivity */
  sensitive_parameters: Array<{
    parameter: string;
    sensitivity: number;
    impact_direction: 'positive' | 'negative';
  }>;
  /** Actionable recommendations */
  recommendations: string[];
  /** Source of the result */
  source: 'isl' | 'engine_fallback';
}

/**
 * PLoT counterfactual result (transformed from ISL)
 */
export interface PLoTCounterfactualResult {
  /** Point estimate */
  estimate: number;
  /** Confidence interval as percentiles */
  confidence_interval: {
    p10: number;
    p50: number;
    p90: number;
  };
  /** Uncertainty breakdown */
  uncertainty: {
    total: number;
    breakdown: {
      parametric: number;
      structural: number;
      stochastic: number;
    };
  };
  /** Source of the result */
  source: 'isl' | 'engine_fallback';
}

/**
 * Decision readiness assessment
 */
export interface DecisionReadiness {
  ready: boolean;
  confidence: 'high' | 'medium' | 'low';
  blockers: string[];
  warnings: string[];
  passed: string[];
}

/**
 * Individual factor sensitivity entry
 */
export interface FactorSensitivityEntry {
  /** Factor node ID */
  factor_id: string;
  /** Sensitivity score (elasticity) */
  sensitivity_score: number;
  /** Direction of impact on outcome */
  direction: 'positive' | 'negative' | 'mixed';
}

/**
 * Individual value of information entry
 */
export interface VOIEntry {
  /** Factor node ID */
  factor_id: string;
  /** Value of information score */
  voi: number;
  /** Optional interpretation */
  interpretation?: string;
}

/**
 * Individual edge sensitivity entry
 * From ISL /api/v1/robustness/analyze/v2 with 'sensitivity' in analysis_types
 */
export interface EdgeSensitivityEntry {
  /** Edge ID in format "from::to" */
  edge_id: string;
  /** Source node ID */
  from: string;
  /** Target node ID */
  to: string;
  /** Elasticity score */
  elasticity: number;
  /** Type of sensitivity */
  sensitivity_type?: 'existence' | 'magnitude';
  /** Rank by importance (1 = most important) */
  importance_rank?: number;
  /** Human-readable interpretation - USE THIS for direction */
  interpretation: string;
}

/**
 * Pre-flight validation result for ISL calls
 */
export interface ISLPreflightResult {
  /** Whether ISL can be called at all */
  canCallISL: boolean;
  /** Status of edge sensitivity analysis */
  edge_sensitivity_status: 'available' | 'skipped_no_edges' | 'skipped_missing_uncertainty';
  /** Status of factor sensitivity analysis */
  factor_sensitivity_status: 'available' | 'skipped_no_factor_values' | 'skipped_no_parameter_uncertainties';
  /** Reasons for skipping analyses */
  skipReasons: string[];
}

/**
 * PLoT robustness analysis result (transformed from ISL /robustness/analyze/v2)
 *
 * Contains both edge and factor sensitivity when available.
 */
export interface PLoTRobustnessAnalysisResult {
  // ============ Edge Sensitivity ============
  /** Combined edge sensitivity (highest impact from existence or magnitude) */
  edges: EdgeSensitivityEntry[];
  /** Edge existence sensitivity separately */
  edges_existence?: EdgeSensitivityEntry[];
  /** Edge magnitude sensitivity separately */
  edges_magnitude?: EdgeSensitivityEntry[];
  /** Provenance for edge sensitivity */
  edges_provenance: 'isl:/api/v1/robustness/analyze/v2' | 'plot:computeSensitivityAll';
  /** Edge sensitivity status */
  edge_sensitivity_status: 'available' | 'fallback_local_heuristic' | 'skipped_no_edges' | 'skipped_missing_uncertainty' | 'failed';

  // ============ Factor Sensitivity ============
  /** Factor-level sensitivity scores */
  factors: FactorSensitivityEntry[];
  /** Value of information for each factor */
  value_of_information: VOIEntry[];
  /** Provenance for factor sensitivity */
  factors_provenance: 'isl:/api/v1/robustness/analyze/v2' | 'unavailable';
  /** Factor sensitivity status */
  factor_sensitivity_status: 'available' | 'skipped_no_factor_values' | 'skipped_no_parameter_uncertainties' | 'failed';

  // ============ Robustness ============
  /** Overall robustness assessment */
  overall_robustness: 'robust' | 'moderate' | 'fragile';
  /** Robustness score (0-1) */
  robustness_score: number;
  /** Edges identified as fragile */
  fragile_edges: string[];
  /** Edges identified as robust */
  robust_edges: string[];

  // ============ Metadata ============
  /** ISL latency in milliseconds */
  latency_ms: number;
  /** Source of the result */
  source: 'isl' | 'unavailable';
}

/**
 * PLoT factor sensitivity result (transformed from ISL /robustness/analyze/v2)
 * @deprecated Use PLoTRobustnessAnalysisResult for full edge + factor sensitivity
 */
export interface PLoTFactorSensitivityResult {
  /** Factor-level sensitivity scores */
  factors: FactorSensitivityEntry[];
  /** Value of information for each factor */
  value_of_information: VOIEntry[];
  /** Overall robustness assessment from factor analysis */
  robustness_label: 'robust' | 'moderate' | 'fragile';
  /** Robustness score (0-1) */
  robustness_score: number;
  /** ISL latency in milliseconds */
  latency_ms: number;
  /** Source of the result */
  source: 'isl' | 'unavailable';
}

// =============================================================================
// Robustness Data Enrichment Types (CEE Integration)
// =============================================================================

/**
 * Enriched fragile edge with human-readable labels.
 * Maps ISL IDs to labels from the graph for CEE synthesis.
 */
export interface EnrichedFragileEdge {
  /** Edge ID in format "from_id->to_id" */
  edge_id: string;
  /** Source node ID */
  from_id: string;
  /** Target node ID */
  to_id: string;
  /** Human-readable source node label */
  from_label: string;
  /** Human-readable target node label */
  to_label: string;
  /** Option ID that would win if this edge changes */
  alternative_winner_id?: string;
  /** Human-readable label for alternative winner option */
  alternative_winner_label?: string;
  /** Probability of switching recommendation (0-1) */
  switch_probability?: number;
}

/**
 * Enriched robust edge with human-readable labels.
 */
export interface EnrichedRobustEdge {
  /** Edge ID */
  edge_id: string;
  /** Human-readable source node label */
  from_label: string;
  /** Human-readable target node label */
  to_label: string;
}

/**
 * Enriched factor sensitivity with human-readable label.
 */
export interface EnrichedFactorSensitivity {
  /** Factor node ID */
  factor_id: string;
  /** Human-readable factor label */
  factor_label: string;
  /** Sensitivity score */
  sensitivity: number;
  /** Value of information */
  value_of_information?: number;
  /** Direction of impact */
  direction?: 'positive' | 'negative' | 'mixed';
}

/**
 * Robustness data payload for CEE /review request.
 * Contains ISL robustness data enriched with human-readable labels.
 */
export interface RobustnessDataForCee {
  /** Recommendation stability score (0-1) */
  recommendation_stability?: number;
  /** Recommended option with label */
  recommended_option?: {
    id: string;
    label: string;
  };
  /** Fragile edges with enriched labels */
  fragile_edges: EnrichedFragileEdge[];
  /** Robust edges with enriched labels */
  robust_edges: EnrichedRobustEdge[];
  /** Factor sensitivity with enriched labels */
  factor_sensitivity?: EnrichedFactorSensitivity[];
}

/**
 * CEE's synthesized robustness explanation.
 * Returned by CEE after processing robustness data.
 */
export interface RobustnessSynthesis {
  /** One-line summary of robustness assessment */
  headline: string;
  /** Detailed explanations for each assumption/edge */
  assumption_explanations?: Array<{
    edge_id: string;
    explanation: string;
    severity: 'fragile' | 'moderate' | 'robust';
  }>;
  /** Suggestions for what to investigate next */
  investigation_suggestions?: Array<{
    factor_id: string;
    suggestion: string;
    potential_value: number;
  }>;
}
