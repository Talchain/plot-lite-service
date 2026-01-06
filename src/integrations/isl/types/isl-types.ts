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
 */
export interface ISLFactorSensitivityItem {
  /** Node ID of the factor */
  node_id: string;
  /** Elasticity/sensitivity score */
  sensitivity: number;
  /** Value of information for this factor */
  value_of_information: number;
  /** Optional direction of impact */
  direction?: 'positive' | 'negative' | 'mixed';
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
 * Option comparison result from ISL /api/v1/robustness/analyze/v2 response
 * Returned when analysis_types includes 'comparison'
 */
export interface ISLOptionComparisonResult {
  option_id: string;
  expected_outcome: number;
  confidence_interval: [number, number];
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
    /** Edges identified as fragile (sensitive to changes) */
    fragile_edges?: string[];
    /** Edges identified as robust */
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

  /** Analysis metadata */
  metadata?: {
    /** Number of samples used */
    n_samples?: number;
    /** Analysis duration in milliseconds */
    duration_ms?: number;
  };
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
