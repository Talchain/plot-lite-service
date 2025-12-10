/**
 * CEE/ISL Proxy Endpoint Types
 *
 * Phase 2 Week 2: Types for belief elicitation, utility suggestions, and dominance analysis.
 */

import type { NodeKind } from '../../../trust/types.js';

// ============================================================================
// Belief Elicitation Types
// ============================================================================

/**
 * Request to /v1/elicit/belief
 */
export interface BeliefElicitationRequest {
  /** Node ID to elicit belief for */
  node_id: string;
  /** Optional node label (enriched from graph if not provided) */
  node_label?: string;
  /** Optional graph context for enrichment */
  graph?: {
    nodes: Array<{ id: string; label?: string; kind?: NodeKind }>;
    edges: Array<{ from: string; to: string }>;
  };
  /** Optional current belief value */
  current_belief?: number;
  /** Optional context about the decision */
  context?: {
    question?: string;
    notes?: string;
  };
}

/**
 * CEE belief elicitation response
 */
export interface CeeBeliefElicitationResponse {
  /** Suggested belief value (0-1) */
  suggested_belief: number;
  /** Confidence in the suggestion */
  confidence: 'high' | 'medium' | 'low';
  /** Reasoning for the suggestion */
  rationale?: string;
  /** Follow-up questions for refinement */
  follow_up_questions?: string[];
}

/**
 * Response from /v1/elicit/belief
 */
export interface BeliefElicitationResponse {
  schema: 'belief_elicitation.v1';
  /** CEE elicitation result */
  elicitation: CeeBeliefElicitationResponse | null;
  /** Node context used */
  node_context: {
    node_id: string;
    node_label: string;
    node_kind?: NodeKind;
  };
  /** Source of the response */
  provenance: 'cee' | 'plot_fallback';
  /** Error if CEE call failed */
  cee_error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

// ============================================================================
// Utility Weight Suggestions Types
// ============================================================================

/**
 * Request to /v1/suggest/utility-weights
 */
export interface UtilityWeightSuggestionsRequest {
  /** Graph with nodes and edges */
  graph: {
    nodes: Array<{ id: string; label?: string; kind?: NodeKind; value?: number }>;
    edges: Array<{ from: string; to: string; weight?: number }>;
  };
  /** Optional seed for reproducibility */
  seed?: number;
  /** Optional context */
  context?: {
    question?: string;
    notes?: string;
  };
}

/**
 * Suggested weight for an outcome node
 */
export interface OutcomeWeightSuggestion {
  /** Node ID */
  node_id: string;
  /** Node label */
  node_label: string;
  /** Suggested weight (0-1, all weights sum to 1) */
  suggested_weight: number;
  /** Rationale for this weight */
  rationale?: string;
}

/**
 * CEE utility weight suggestions response
 */
export interface CeeUtilityWeightSuggestionsResponse {
  /** Suggested weights per outcome */
  suggestions: OutcomeWeightSuggestion[];
  /** Overall confidence */
  confidence: 'high' | 'medium' | 'low';
  /** Follow-up questions */
  follow_up_questions?: string[];
}

/**
 * Response from /v1/suggest/utility-weights
 */
export interface UtilityWeightSuggestionsResponse {
  schema: 'utility_weights.v1';
  /** CEE suggestions */
  suggestions: CeeUtilityWeightSuggestionsResponse | null;
  /** Detected outcome nodes */
  outcome_nodes: Array<{
    node_id: string;
    node_label: string;
  }>;
  /** Source of the response */
  provenance: 'cee' | 'plot_fallback';
  /** Model metadata */
  model_card: {
    seed: number;
    nodes: number;
    edges: number;
  };
  /** Error if CEE call failed */
  cee_error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

// ============================================================================
// Dominance Analysis Types
// ============================================================================

/**
 * Option with inference result for dominance analysis
 */
export interface OptionResult {
  /** Option identifier */
  option_id: string;
  /** Option label */
  label: string;
  /** Normalized score (0-1) */
  score: number;
  /** Distribution percentiles */
  distribution: {
    p10: number;
    p50: number;
    p90: number;
  };
}

/**
 * Request to /v1/analysis/dominance
 */
export interface DominanceAnalysisRequest {
  /** Graph with options to analyze */
  graph: {
    nodes: Array<{ id: string; label?: string; kind?: NodeKind; value?: number }>;
    edges: Array<{ from: string; to: string; weight?: number; belief?: number }>;
  };
  /** Optional seed */
  seed?: number;
  /** Optional outcome node (auto-detected if not provided) */
  outcome_node?: string;
}

/**
 * Dominance relationship between options
 */
export interface DominanceRelationship {
  /** Dominating option ID */
  dominant: string;
  /** Dominated option ID */
  dominated: string;
  /** Strength of dominance (how much better) */
  strength: number;
}

/**
 * ISL dominance detection response
 */
export interface IslDominanceResponse {
  /** List of dominance relationships */
  dominance_relationships: DominanceRelationship[];
  /** Options that are not dominated (Pareto-optimal) */
  pareto_optimal: string[];
  /** Options that are dominated by others */
  dominated: string[];
}

/**
 * Response from /v1/analysis/dominance
 */
export interface DominanceAnalysisResponse {
  schema: 'dominance.v1';
  /** ISL dominance analysis */
  analysis: IslDominanceResponse | null;
  /** Option results used for analysis */
  option_results: OptionResult[];
  /** Source of the response */
  provenance: 'isl' | 'plot_fallback';
  /** Model metadata */
  model_card: {
    seed: number;
    nodes: number;
    edges: number;
    options_analyzed: number;
  };
  /** Error if ISL call failed */
  isl_error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

// ============================================================================
// Pareto Analysis Types
// ============================================================================

/**
 * Request to /v1/analysis/pareto
 */
export interface ParetoAnalysisRequest {
  /** Graph with options to analyze */
  graph: {
    nodes: Array<{ id: string; label?: string; kind?: NodeKind; value?: number }>;
    edges: Array<{ from: string; to: string; weight?: number; belief?: number }>;
  };
  /** Optional seed */
  seed?: number;
  /** Optional outcome node (auto-detected if not provided) */
  outcome_node?: string;
}

/**
 * ISL Pareto analysis response
 */
export interface IslParetoResponse {
  /** Options on the Pareto frontier (non-dominated) */
  frontier: string[];
  /** Options dominated by frontier options */
  dominated: string[];
  /** Size of the Pareto frontier */
  frontier_size: number;
  /** Trade-off information between frontier options */
  trade_offs?: Array<{
    option_a: string;
    option_b: string;
    description: string;
  }>;
}

/**
 * Response from /v1/analysis/pareto
 */
export interface ParetoAnalysisResponse {
  schema: 'pareto.v1';
  /** ISL Pareto analysis */
  analysis: IslParetoResponse | null;
  /** Option results used for analysis */
  option_results: OptionResult[];
  /** Source of the response */
  provenance: 'isl' | 'plot_fallback';
  /** Model metadata */
  model_card: {
    seed: number;
    nodes: number;
    edges: number;
    options_analyzed: number;
  };
  /** Error if ISL call failed */
  isl_error?: ProxyError;
}

// ============================================================================
// Multi-Criteria Aggregation Types
// ============================================================================

/**
 * Criterion definition for multi-criteria analysis
 */
export interface CriterionDefinition {
  /** Unique criterion identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Outcome node to evaluate for this criterion */
  outcome_node: string;
  /** Weight for this criterion (all weights should sum to 1) */
  weight: number;
  /** Whether higher is better (default: true) */
  maximize?: boolean;
}

/**
 * Result for a single criterion
 */
export interface CriterionResult {
  /** Criterion ID */
  criterion_id: string;
  /** Option results for this criterion */
  option_scores: Array<{
    option_id: string;
    score: number;
    distribution: {
      p10: number;
      p50: number;
      p90: number;
    };
  }>;
  /** Whether inference succeeded for this criterion */
  success: boolean;
  /** Error message if inference failed */
  error?: string;
}

/**
 * Request to /v1/analysis/multi-criteria
 */
export interface MultiCriteriaRequest {
  /** Graph with options to analyze */
  graph: {
    nodes: Array<{ id: string; label?: string; kind?: NodeKind; value?: number }>;
    edges: Array<{ from: string; to: string; weight?: number; belief?: number }>;
  };
  /** Criteria definitions */
  criteria: CriterionDefinition[];
  /** Optional seed */
  seed?: number;
  /** Aggregation method */
  aggregation_method?: 'weighted_sum' | 'weighted_product' | 'topsis';
  /** Percentile to use for aggregation (default: p50) */
  percentile?: 'p10' | 'p50' | 'p90';
}

/**
 * Aggregated ranking for an option
 */
export interface AggregatedRanking {
  /** Option ID */
  option_id: string;
  /** Option label */
  label: string;
  /** Aggregated score (0-1) */
  aggregated_score: number;
  /** Rank (1 = best) */
  rank: number;
  /** Per-criterion scores */
  criterion_scores: Record<string, number>;
}

/**
 * Trade-off between options
 */
export interface TradeOff {
  /** First option */
  option_a: string;
  /** Second option */
  option_b: string;
  /** Criteria where option_a is better */
  a_better_on: string[];
  /** Criteria where option_b is better */
  b_better_on: string[];
  /** Description of the trade-off */
  description: string;
}

/**
 * ISL multi-criteria aggregation response
 */
export interface IslMultiCriteriaResponse {
  /** Aggregated rankings */
  aggregated_rankings: AggregatedRanking[];
  /** Trade-offs between top options */
  trade_offs: TradeOff[];
  /** Aggregation confidence */
  aggregation_confidence: 'high' | 'medium' | 'low';
  /** Warnings about the analysis */
  warnings?: string[];
}

/**
 * Response from /v1/analysis/multi-criteria
 */
export interface MultiCriteriaResponse {
  schema: 'multi_criteria.v1';
  /** ISL aggregation result */
  aggregation: IslMultiCriteriaResponse | null;
  /** Per-criterion results */
  criterion_results: CriterionResult[];
  /** Number of criteria that succeeded */
  criteria_succeeded: number;
  /** Number of criteria that failed */
  criteria_failed: number;
  /** Source of the response */
  provenance: 'isl' | 'plot_fallback';
  /** Model metadata */
  model_card: {
    seed: number;
    nodes: number;
    edges: number;
    options_analyzed: number;
    criteria_count: number;
    aggregation_method: string;
    percentile: string;
  };
  /** Timing information */
  timing?: {
    inference_ms: number;
    isl_ms?: number;
    total_ms: number;
  };
  /** Error if ISL call failed */
  isl_error?: ProxyError;
}

// ============================================================================
// Risk Tolerance Elicitation Types
// ============================================================================

/**
 * Request to /v1/elicit/risk-tolerance
 */
export interface RiskToleranceRequest {
  /** Mode of operation */
  mode: 'get_questions' | 'process_responses';
  /** Context for risk assessment */
  context?: 'product' | 'business';
  /** User responses when mode is 'process_responses' */
  responses?: Array<{
    question_id: string;
    answer: string | number;
  }>;
  /** Optional graph context */
  graph?: {
    nodes: Array<{ id: string; label?: string; kind?: NodeKind; value?: number }>;
    edges: Array<{ from: string; to: string; weight?: number }>;
  };
}

/**
 * Risk tolerance question from CEE
 */
export interface RiskToleranceQuestion {
  question_id: string;
  question_text: string;
  question_type: 'scale' | 'choice' | 'scenario';
  options?: Array<{ value: string | number; label: string }>;
  scale_min?: number;
  scale_max?: number;
}

/**
 * Risk profile from CEE
 */
export interface RiskProfile {
  risk_attitude: 'risk_averse' | 'risk_neutral' | 'risk_seeking';
  risk_coefficient: number;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
}

/**
 * CEE risk tolerance response
 */
export interface CeeRiskToleranceResponse {
  /** Questions when mode is 'get_questions' */
  questions?: RiskToleranceQuestion[];
  /** Risk profile when mode is 'process_responses' */
  risk_profile?: RiskProfile;
  /** Follow-up questions if more info needed */
  follow_up_questions?: string[];
}

/**
 * Response from /v1/elicit/risk-tolerance
 */
export interface RiskToleranceResponse {
  schema: 'risk_tolerance.v1';
  mode: 'get_questions' | 'process_responses';
  elicitation: CeeRiskToleranceResponse;
  provenance: 'cee' | 'plot_fallback';
  cee_error?: ProxyError;
}

// ============================================================================
// Risk Adjustment Types
// ============================================================================

/**
 * Request to /v1/analysis/risk-adjust
 */
export interface RiskAdjustRequest {
  /** Graph with options to analyze */
  graph: {
    nodes: Array<{ id: string; label?: string; kind?: NodeKind; value?: number }>;
    edges: Array<{ from: string; to: string; weight?: number; belief?: number }>;
  };
  /** Risk coefficient (0 = risk neutral, <0 = risk averse, >0 = risk seeking) */
  risk_coefficient: number;
  /** Type of risk adjustment */
  risk_type?: 'exponential' | 'power' | 'linear';
  /** Optional seed */
  seed?: number;
  /** Optional outcome node */
  outcome_node?: string;
}

/**
 * Adjusted option score
 */
export interface AdjustedOptionScore {
  option_id: string;
  label: string;
  original_score: number;
  adjusted_score: number;
  original_rank: number;
  adjusted_rank: number;
  distribution: {
    p10: number;
    p50: number;
    p90: number;
  };
}

/**
 * ISL risk adjustment response
 */
export interface IslRiskAdjustResponse {
  adjusted_scores: AdjustedOptionScore[];
  rankings_changed: boolean;
  rank_changes: Array<{
    option_id: string;
    original_rank: number;
    adjusted_rank: number;
    change: number;
  }>;
  interpretation: string;
}

/**
 * Response from /v1/analysis/risk-adjust
 */
export interface RiskAdjustResponse {
  schema: 'risk_adjust.v1';
  analysis: IslRiskAdjustResponse | null;
  risk_parameters: {
    risk_coefficient: number;
    risk_type: string;
  };
  provenance: 'isl' | 'plot_fallback';
  model_card: {
    seed: number;
    nodes: number;
    edges: number;
    options_analyzed: number;
  };
  isl_error?: ProxyError;
}

// ============================================================================
// Threshold Identification Types
// ============================================================================

/**
 * Sweep configuration for threshold analysis
 */
export interface SweepConfig {
  /** Node ID to sweep */
  node_id: string;
  /** Parameter to vary */
  parameter: 'value' | 'belief' | 'weight';
  /** Values to sweep through */
  values: number[];
}

/**
 * Request to /v1/analysis/thresholds
 */
export interface ThresholdRequest {
  /** Graph with options to analyze */
  graph: {
    nodes: Array<{ id: string; label?: string; kind?: NodeKind; value?: number }>;
    edges: Array<{ from: string; to: string; weight?: number; belief?: number }>;
  };
  /** Sweep configurations */
  sweeps: SweepConfig[];
  /** Optional seed */
  seed?: number;
  /** Optional outcome node */
  outcome_node?: string;
}

/**
 * Threshold point where ranking changes
 */
export interface ThresholdPoint {
  sweep_id: string;
  node_id: string;
  parameter: string;
  threshold_value: number;
  crossing_type: 'rising' | 'falling';
  options_affected: string[];
  description: string;
}

/**
 * Sensitivity ranking for a parameter
 */
export interface SensitivityRanking {
  sweep_id: string;
  node_id: string;
  parameter: string;
  sensitivity_score: number;
  rank: number;
}

/**
 * ISL threshold identification response
 */
export interface IslThresholdResponse {
  thresholds: ThresholdPoint[];
  sensitivity_ranking: SensitivityRanking[];
  summary: string;
}

/**
 * Sweep result with scores at each value
 */
export interface SweepResult {
  sweep_id: string;
  node_id: string;
  parameter: string;
  scores: Array<{
    value: number;
    option_scores: Array<{
      option_id: string;
      score: number;
    }>;
  }>;
}

/**
 * Response from /v1/analysis/thresholds
 */
export interface ThresholdResponse {
  schema: 'thresholds.v1';
  analysis: IslThresholdResponse | null;
  sweep_results: SweepResult[];
  provenance: 'isl' | 'plot_fallback';
  model_card: {
    seed: number;
    nodes: number;
    edges: number;
    sweeps_count: number;
    total_evaluations: number;
  };
  timing?: {
    inference_ms: number;
    isl_ms?: number;
    total_ms: number;
  };
  isl_error?: ProxyError;
}

// ============================================================================
// Shared Types
// ============================================================================

/**
 * Common error structure for proxy responses
 */
export interface ProxyError {
  code: string;
  message: string;
  retryable: boolean;
}

/**
 * CEE/ISL request context for correlation
 */
export interface ProxyRequestContext {
  plot_request_id: string;
  timestamp: string;
}

// ============================================================================
// Edge Function Suggestion Types
// ============================================================================

import type { EdgeFunctionType, EdgeFunctionParams } from '../../../trust/types.js';

/**
 * Node context for edge function suggestion
 */
export interface EdgeNodeContext {
  id: string;
  label?: string;
  kind?: NodeKind;
}

/**
 * Request to /v1/suggest/edge-function
 */
export interface EdgeFunctionSuggestionRequest {
  /** Edge identifier (from->to) */
  edge_id: string;
  /** Source node context */
  source_node: EdgeNodeContext;
  /** Target node context */
  target_node: EdgeNodeContext;
  /** Optional description of the relationship */
  relationship_description?: string;
  /** Optional graph context for node enrichment */
  graph?: {
    nodes: Array<{ id: string; label?: string; kind?: NodeKind; value?: number }>;
    edges: Array<{ from: string; to: string; weight?: number; belief?: number }>;
  };
}

/**
 * Alternative function suggestion from CEE
 */
export interface AlternativeFunctionSuggestion {
  function_type: EdgeFunctionType;
  params: EdgeFunctionParams;
  reasoning: string;
}

/**
 * CEE edge function suggestion response
 */
export interface CeeEdgeFunctionSuggestionResponse {
  /** Suggested function type */
  suggested_function: EdgeFunctionType;
  /** Suggested parameters for the function */
  suggested_params: EdgeFunctionParams;
  /** Reasoning for the suggestion */
  reasoning: string;
  /** Alternative suggestions if applicable */
  alternatives?: AlternativeFunctionSuggestion[];
  /** Confidence in the suggestion */
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Response from /v1/suggest/edge-function
 */
export interface EdgeFunctionSuggestionResponse {
  schema: 'edge_function_suggestion.v1';
  /** CEE suggestion result */
  suggestion: CeeEdgeFunctionSuggestionResponse;
  /** Edge context used */
  edge_context: {
    edge_id: string;
    source_node: EdgeNodeContext;
    target_node: EdgeNodeContext;
  };
  /** Source of the response */
  provenance: 'cee' | 'plot_fallback';
  /** Error if CEE call failed */
  cee_error?: ProxyError;
}
