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
