import type { CeeSeverity } from './severity.js';
import type { GraphPatchV1 as SdkGraphPatchV1 } from '@olumi/assistants-sdk';

export type CeeErrorSuggestedAction = 'retry' | 'fix_input' | 'fail';

export interface CeeTrace {
  requestId: string;
  degraded: boolean;
  timestamp: string;        // ISO 8601
  featureVersion?: string;  // optional
  /** Human-readable degradation reason for observability */
  reason?: string;
  /** Data source identifier (e.g. 'cee-client', 'orchestrator', 'fixture') */
  source?: string;
  /** HTTP status code when degraded due to upstream failure */
  status?: number;
  // M1 CEE Orchestrator spec v1.1: Three-ID tracing
  /** Original request ID from PLoT client */
  plot_request_id?: string;
  /** Request ID sent to CEE service */
  cee_sent_request_id?: string | null;
  /** Request ID returned from CEE service response */
  cee_returned_request_id?: string | null;
  /** CEE call latency in milliseconds */
  latency_ms?: number | null;
  /** CEE model/version used (if returned by service) */
  model?: string;
  /** True if sent request ID differs from returned request ID */
  id_mismatch?: boolean;
}

export interface CeeError {
  code?: string;
  message?: string;
  traceId?: string;
  retryable?: boolean;
  suggestedAction: CeeErrorSuggestedAction;
}

export interface CeeDecisionReviewPayloadV1 {
  schema: 'cee.decision-review.v1';
  response_hash: string;
  seed: number | string;
  inference_mode: string;
  graph_summary: { nodes: number; edges: number };
  scenario_kind?: string;
}

export interface CeeReviewResult {
  review: CeeDecisionReviewPayloadV1 | null;
  trace: CeeTrace;
  error?: CeeError | null;
}

/**
 * Structured CEE issue with explicit severity classification.
 */
export interface CeeIssue {
  /** Machine-readable issue code (e.g. LIMIT_EXCEEDED, MISSING_EVIDENCE). */
  code: string;
  /** Optional CEE severity classification; defaults applied by helpers when absent. */
  severity?: CeeSeverity;
  /** Human-readable message explaining the issue. */
  message: string;
  /** Optional high-level category (e.g. 'graph', 'evidence', 'confidence'). */
  category?: string;
  /** Optional hint describing how to address the issue. */
  hint?: string;
  /** Derived flag indicating whether this issue is blocking. */
  blocking?: boolean;
}

/**
 * Normalised CEE review view used by UI/trust layers.
 *
 * This is intentionally flexible and can wrap the raw CEE payload plus
 * enriched issue metadata.
 */
export interface CeeReview {
  issues?: CeeIssue[];
  // Allow additional fields from upstream CEE payloads without strict typing.
  // This keeps the adapter resilient to CEE schema evolution.
  [key: string]: unknown;
}

// Graph patch type used for actionable alternatives and model improvements.
// This is a thin alias over the Assistants SDK GraphPatchV1 type to keep
// contracts aligned without re-defining the patch structure here.
export type GraphPatchV1 = SdkGraphPatchV1;

/**
 * Warning about a fragile or assumption-heavy part of the model.
 * Typically derived from ISL validation and sensitivity analysis.
 */
export interface AssumptionWarning {
  /** Stable identifier for deduping/analytics. */
  id: string;
  /** Human-readable message describing the assumption risk. */
  message: string;
  /** Optional node identifier primarily affected by this assumption. */
  node_id?: string;
  /** Optional edge identifier primarily affected by this assumption. */
  edge_id?: string;
  /** Sensitivity score in [0,1]; higher means more impact. */
  sensitivity: number;
  /** Source of the signal. */
  source?: 'isl' | 'engine' | 'mixed';
}

/**
 * Concrete alternative configuration or intervention the user could try.
 * May optionally carry a graph patch describing the suggested change.
 */
export interface ActionableAlternative {
  id: string;
  /** Short description of the alternative. */
  description: string;
  /** Feasibility score in [0,1]; used for ranking/filtering. */
  feasibility: number;
  /** Expected change in outcome relative to current scenario, if known. */
  expected_outcome_delta?: number;
  /** Optional graph patch implementing the alternative. */
  graph_patch?: GraphPatchV1 | null;
}

/**
 * Normalised confidence statement summarising model reliability.
 */
export interface ConfidenceStatement {
  id: string;
  /** Plain-English statement about confidence. */
  message: string;
  /** Discrete confidence band. */
  level: 'low' | 'medium' | 'high';
  /** Optional numeric score in [0,1] for UI ordering. */
  score?: number;
  /** Optional machine-readable factors contributing to this statement. */
  factors?: string[];
}

export type ModelImprovementPriority = 'high' | 'medium' | 'low';

/**
 * CEE weight suggestion for edges with problematic weights or beliefs.
 * Generated when CEE detects issues with edge parameters.
 *
 * Weight-based reasons:
 * - uniform_weights: All edges have same weight
 * - weight_too_low: Weight below reasonable threshold
 * - weight_too_high: Weight above reasonable threshold
 *
 * Belief-based reasons (v1.3.5+):
 * - near_zero: Belief < 0.05 (very low probability)
 * - near_one: Belief > 0.95 (near-certain probability)
 * - uniform_distribution: All decision→option edges have equal belief
 */
export type WeightSuggestionReason =
  | 'uniform_weights' | 'weight_too_low' | 'weight_too_high'
  | 'near_zero' | 'near_one' | 'uniform_distribution';

export interface WeightSuggestion {
  /** Edge identifier in format "{from}->{to}" */
  edge_id: string;
  /** Source node ID */
  from_node_id: string;
  /** Target node ID */
  to_node_id: string;
  /** Current belief value on the edge */
  current_belief?: number;
  /** Current weight value on the edge */
  current_weight: number;
  /** Reason for the suggestion */
  reason: WeightSuggestionReason;
  /** Suggested weight value (undefined for uniform_weights or low confidence) */
  suggested_weight?: number;
  /** Suggested belief value for belief-based reasons (v1.3.5+) */
  suggested_belief?: number;
  /** Confidence in the suggestion (0-1). Suggestions only made when ≥0.7 */
  confidence?: number;
  /** Human-readable explanation of the issue and suggestion */
  rationale?: string;
  /** Whether CEE auto-applied this suggestion */
  auto_applied?: boolean;
}

/**
 * Targeted improvement opportunity for the model or decision process.
 */
export interface ModelImprovement {
  id: string;
  /** Area of the system the improvement relates to. */
  area: 'graph' | 'evidence' | 'inference' | 'monitoring' | 'other';
  priority: ModelImprovementPriority;
  /** Human-readable description of the improvement. */
  message: string;
  /** Optional, more explicit suggested action. */
  suggested_action?: string;
}

/**
 * Enhanced CEE review that can include ISL-powered insights.
 *
 * This extends the base CeeReview envelope with structured insight
 * collections used by trust/UI layers. All fields are optional and
 * additive; existing consumers that only understand the base CeeReview
 * shape can safely ignore these.
 */
export interface EnhancedCeeReview extends CeeReview {
  assumption_warnings?: AssumptionWarning[];
  actionable_alternatives?: ActionableAlternative[];
  confidence_statements?: ConfidenceStatement[];
  model_improvements?: ModelImprovement[];
  graph_patches?: GraphPatchV1[];
  /** Weight suggestions for edges with problematic values */
  weight_suggestions?: WeightSuggestion[];
  /** Where these enhancements originated from. */
  enhancement_source?: 'isl' | 'engine' | 'mixed';
}

// =============================================================================
// M1 CEE review() Contract Types (SDK v1.12.0+)
// =============================================================================

/**
 * Request payload for CeeClient.review() - M1 unified endpoint
 * Replaces the compose pattern of individual endpoint calls
 */
export interface CeeReviewRequest {
  /** Scenario identifier - prefer body.scenario_id, fallback to response_hash */
  scenario_id: string;
  /** Full graph snapshot (actual arrays, not counts) */
  graph_snapshot: {
    nodes: unknown[];
    edges: unknown[];
  };
  /** Graph schema version - must be '2.2' */
  graph_schema_version: '2.2';
  /**
   * Original decision brief/description.
   * When provided, CEE generates contextualised output.
   */
  brief?: string;
  /** Inference results to review */
  inference_results: {
    quantiles: { p10: number; p50: number; p90: number };
    /** Per-option outcome quantiles for comparative analysis */
    per_option_outcomes?: Array<{
      option_id: string;
      p10: number;
      p50: number;
      p90: number;
    }>;
    top_edge_drivers?: Array<{ id: string; sensitivity?: number }>;
    ranked_actions?: Array<{ id: string; rank: number }>;
  };
  /** User intent - must be 'selection' | 'prediction' | 'validation' */
  intent: 'selection' | 'prediction' | 'validation';
  /** Market context metadata */
  market_context?: Record<string, unknown>;
  /**
   * ISL robustness output (optional)
   * When provided, CEE synthesizes this into ceeReview.blocks
   */
  isl_robustness?: {
    /** Overall model robustness from ISL sensitivity analysis */
    overall_robustness: 'robust' | 'moderate' | 'fragile';
    // validation_status / validation_confidence RETIRED (lane 29, spec
    // docs/enrichment-v1/PLOT-V2-READ-FIX-SPEC.md §2.2): the live V2 wire
    // never emits validation_status and the /v2/run producer never set
    // either field on /v2, so the orchestrator reads could never fire there
    // (legacy /v1 still supplies them — declared behaviour change, orchestrator.ts).
    /** Top sensitive parameters (max 5) */
    sensitive_parameters?: Array<{
      parameter: string;
      sensitivity: number;
      impact_direction: 'positive' | 'negative';
    }>;
    /** Actionable recommendations from ISL */
    recommendations?: string[];
    /** ISL-detected issues (max 3) */
    issues?: Array<{
      type: string;
      description: string;
      suggested_action?: string;
    }>;
  };
}

/**
 * Block status in CEE review response
 */
export interface CeeReviewBlock {
  id: string;
  status: 'ok' | 'warning' | 'error' | 'skipped';
  headline?: string;
  details?: string;
  factors?: string[];
}

/**
 * Readiness assessment in CEE review response
 */
export interface CeeReviewReadiness {
  level: 'ready' | 'needs_attention' | 'not_ready';
  headline: string;
  factors: string[];
}

/**
 * M1 CEE review response payload
 * This is what CeeClient.review() returns
 */
export interface CeeReviewResponse {
  intent: string;
  analysis_state: 'ran' | 'skipped' | 'failed';
  /**
   * Readiness verdict — OPTIONAL, and present only when CEE actually computed one.
   *
   * It used to be required, and `orchestrateCeeReview` satisfied that requirement by
   * hardcoding `{ level: 'ready', headline: 'Analysis complete', factors: [] }` on
   * every successful turn: a constant dressed as a computed verdict. CEE's compose
   * endpoints (/assist/v1/draft-graph, /options, /bias-check) carry no readiness
   * field, so on the current live path the honest value is ABSENCE, not 'ready'.
   *
   * Consumers must treat an absent readiness as "no verdict available" and render
   * nothing, rather than defaulting to a positive one.
   */
  readiness?: CeeReviewReadiness;
  blocks: CeeReviewBlock[];
  trace: {
    request_id?: string;
    latency_ms?: number;
    model?: string;
  };
}

/**
 * Normalized error with both retriable (canonical) and retryable (alias) fields
 */
export interface CeeErrorNormalized {
  code: string;
  message?: string;
  /** Canonical field name per M1 spec */
  retriable: boolean;
  /** Alias for UI tolerance */
  retryable: boolean;
}

// -----------------------------------------------------------------------------
// Factor Enrichments (CEE /assist/v1/review)
// -----------------------------------------------------------------------------

/**
 * Factor enrichment from CEE /assist/v1/review endpoint.
 * Provides human-readable insights for UI display on factor cards.
 */
export interface FactorEnrichment {
  /** Factor ID matching factor_sensitivity[].factor_id */
  factor_id: string;
  /** Human-readable factor label */
  factor_label: string;
  /** Key observations about this factor's influence */
  observations: string[];
  /** Alternative perspectives to consider */
  perspectives: string[];
  /** Optional question to prompt user confidence calibration */
  confidence_question?: string;
}

/**
 * Request payload for CEE /assist/v1/review endpoint.
 *
 * CEE uses the brief + graph to generate factor enrichments via LLM.
 * The graph is stripped to essential fields only.
 */
export interface CeeFactorReviewRequest {
  /** User's decision brief text */
  brief: string;
  /** Stripped graph with essential node/edge fields */
  graph: {
    nodes: Array<{ id: string; label: string; kind: string }>;
    edges: Array<{ from: string; to: string }>;
  };
}

/**
 * Response from CEE /assist/v1/review endpoint
 */
export interface CeeFactorReviewResponse {
  factor_enrichments: FactorEnrichment[];
}
