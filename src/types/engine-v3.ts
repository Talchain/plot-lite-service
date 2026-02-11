/**
 * Engine V3 Types for /v2/run Endpoint
 *
 * Canonical model: Options are intervention bundles, NOT graph nodes.
 * Option nodes in the graph are UI scaffolding and are filtered before analysis.
 *
 * @see Integration Alignment Implementation Brief v1.1
 */

// CIL Phase 1: Canonical types and constants from shared schema package
import {
  LIMITS,
  NODE_ID_PATTERN as SCHEMA_NODE_ID_PATTERN,
} from '@talchain/schemas';
import type {
  SeedSourceType,
  NodeV3 as SchemaNodeV3,
  EdgeV3 as SchemaEdgeV3,
  GraphV3 as SchemaGraphV3,
  RepairEntry as SchemaRepairEntry,
} from '@talchain/schemas';
import {
  MAX_NODES as LIMITS_MAX_NODES,
  MAX_EDGES as LIMITS_MAX_EDGES,
  MAX_OPTIONS as LIMITS_MAX_OPTIONS,
} from '../constants/limits.js';

// Import CEE types for factor enrichments
import type { FactorEnrichment } from '../cee/types.js';
import type { M1Coaching } from '../coaching/types.js';
import type { M1Review } from '../cee/validation/m1-review-types.js';
import type { ReviewStatus, ReviewSkipReason } from '../cee/validation/m1-review-constants.js';
import type { DenormalisedFlipThreshold } from '../lib/flip-threshold-denormaliser.js';

// -----------------------------------------------------------------------------
// Node Kinds
// -----------------------------------------------------------------------------

/**
 * Valid node kinds for causal graph nodes.
 * Note: 'option' is NOT a valid kind - option nodes are filtered before analysis.
 */
export type EngineNodeKindV3 =
  | 'goal'
  | 'factor'
  | 'outcome'
  | 'decision'
  | 'risk'
  | 'action';

// -----------------------------------------------------------------------------
// Upstream Input Types (what we accept from UI/CEE)
// -----------------------------------------------------------------------------

/**
 * Upstream node format - accepts various field naming conventions.
 * Normalized to EngineNodeV3 before processing.
 */
export interface UpstreamNode {
  id: string;
  kind?: string;
  type?: string; // Some sources use 'type' instead of 'kind'
  label?: string;
  description?: string;
  body?: string; // Legacy field for description
  intercept?: number | null;
  observed_state?: {
    value?: number;
    /** Standard deviation for parameter uncertainty (if known) */
    std?: number;
    baseline?: number;
    unit?: string;
    /** V3 expansion: raw unscaled value for UI display */
    raw_value?: number;
    /** V3 expansion: scale cap for normalization */
    cap?: number;
    /** V3 expansion: factor classification */
    factor_type?: string;
    /** V3 expansion: sources of uncertainty */
    uncertainty_drivers?: string[];
  };
  /** State space bounds for the factor (used for uncertainty calculation) */
  state_space?: {
    range?: { min: number; max: number };
  };
  /** Factor category for M1 coaching classification */
  category?: 'controllable' | 'observable' | 'external';
  /** External factor prior distribution from CEE */
  prior?: {
    distribution: string;
    range_min: number;
    range_max: number;
  };
  data?: {
    // React Flow nesting
    kind?: string;
    type?: string;
    intercept?: number | null;
    value?: number;
    baseline?: number;
    unit?: string;
    /** State space bounds for the factor (used for uncertainty calculation) */
    state_space?: {
      range?: { min: number; max: number };
    };
    /** Factor category for M1 coaching classification (React Flow nesting) */
    category?: 'controllable' | 'observable' | 'external';
  };
}

/**
 * Upstream edge format - accepts various field naming conventions.
 * Normalized to EngineEdgeV3 before processing.
 */
export interface UpstreamEdge {
  from?: string;
  source?: string; // React Flow convention
  to?: string;
  target?: string; // React Flow convention

  // Uncertainty - multiple field names supported
  exists_probability?: number;
  belief_exists?: number;
  belief?: number;

  // Strength - multiple representations
  weight?: number;
  strength?: { mean: number; std: number };
  /** Flat strength mean field (alternative to strength.mean) */
  strength_mean?: number;
  strength_std?: number;
  belief_strength?: number;

  // Direction
  effect_direction?: 'positive' | 'negative';
  direction?: 'positive' | 'negative';

  // Metadata
  label?: string;
  provenance?: string;
}

/**
 * Upstream graph format - accepts nodes/edges in various formats.
 */
export interface UpstreamGraph {
  nodes: UpstreamNode[];
  edges: UpstreamEdge[];
}

// -----------------------------------------------------------------------------
// Internal Canonical Types (EngineGraphV3)
// -----------------------------------------------------------------------------

/**
 * Canonical node format after normalization.
 * All nodes have been validated and normalized.
 */
export interface EngineNodeV3 {
  /** Node ID - must match pattern ^[a-z0-9_:-]+$ */
  id: string;
  /** Node kind - 'option' is NOT valid (filtered before reaching here) */
  kind: EngineNodeKindV3;
  /** Human-readable label */
  label: string;
  /** Optional description */
  description?: string;
  /** Node intercept for baseline effect */
  intercept?: number;
  /** Observed state for factor nodes */
  observed_state?: {
    value: number;
    /** Standard deviation for parameter uncertainty (if known) */
    std?: number;
    baseline?: number;
    unit?: string;
    /** V3 expansion: raw unscaled value for UI display */
    raw_value?: number;
    /** V3 expansion: scale cap for normalization */
    cap?: number;
    /** V3 expansion: factor classification */
    factor_type?: string;
    /** V3 expansion: sources of uncertainty */
    uncertainty_drivers?: string[];
  };
  /** State space bounds for the factor (used for uncertainty calculation) */
  state_space?: {
    range?: { min: number; max: number };
  };
  /** Factor category for M1 coaching classification */
  category?: 'controllable' | 'observable' | 'external';
  /** External factor prior distribution from CEE */
  prior?: {
    distribution: string;
    range_min: number;
    range_max: number;
  };
}

/**
 * Canonical edge format after normalization.
 * All uncertainty fields have been resolved to canonical form.
 */
export interface EngineEdgeV3 {
  /** Source node ID */
  from: string;
  /** Target node ID */
  to: string;
  /** Probability that this edge exists [0, 1] */
  exists_probability: number;
  /** Edge strength with uncertainty */
  strength: {
    /** Mean effect (signed) */
    mean: number;
    /** Standard deviation (> 0) */
    std: number;
  };
  /** Optional label */
  label?: string;
}

/**
 * Canonical graph format after normalization and option filtering.
 */
export interface EngineGraphV3 {
  nodes: EngineNodeV3[];
  edges: EngineEdgeV3[];
}

// -----------------------------------------------------------------------------
// Options & Interventions
// -----------------------------------------------------------------------------

/**
 * Source of an intervention value.
 */
export type InterventionSource =
  | 'brief_extraction'
  | 'user_specified'
  | 'cee_hypothesis';

/**
 * Intervention value with metadata.
 * Phase 1: Just value and source.
 * Phase 2 (future): May add uncertainty.
 */
export interface InterventionValueV3 {
  /** The intervention value to set */
  value: number;
  /** Where this intervention came from */
  source: InterventionSource;
  // Reserved for Phase 2 - do not implement yet
  // uncertainty?: { distribution: 'normal' | 'uniform'; std?: number; range?: [number, number] };
}

/**
 * An option represents a decision path with intervention bundles.
 * Options define what each decision path does to causal variables.
 */
export interface OptionV3 {
  /** Unique option identifier */
  id: string;
  /** Human-readable label */
  label: string;
  /**
   * What this option does causally.
   * Keys are node IDs, values are intervention specs.
   * REQUIRED and must be non-empty.
   */
  interventions: Record<string, InterventionValueV3>;
}

// -----------------------------------------------------------------------------
// Goal Constraints (Multi-Constraint Analysis)
// -----------------------------------------------------------------------------

/**
 * A single goal constraint for multi-constraint analysis.
 *
 * Users can specify multiple success criteria (e.g., "reach £20k MRR while keeping churn under 4%").
 * ISL evaluates joint satisfaction across all constraints.
 *
 * @see Multi-Constraint Analysis Phase 1 Spec
 */
export interface GoalConstraint {
  /** Unique identifier within the request */
  constraint_id: string;
  /** Target node ID - must exist in graph.nodes and participate in inference */
  node_id: string;
  /** Comparison operator - ASCII only (UI renders as ≥/≤) */
  operator: '>=' | '<=';
  /** Threshold value in user units (same convention as goal_threshold) */
  value: number;
  /** Human-readable label for UI display */
  label?: string;
  /** Reserved for post-PoC weighted constraint prioritization */
  weight?: number;
}

/**
 * Result for a single constraint evaluation.
 */
export interface ConstraintResult {
  /** Constraint ID from request */
  constraint_id: string;
  /** Target node ID */
  node_id: string;
  /** Operator used */
  operator: '>=' | '<=';
  /** Threshold value */
  value: number;
  /** Probability of satisfying this constraint [0, 1] */
  probability: number;
}

/**
 * Diagnostic information for constraint analysis.
 */
export interface ConstraintDiagnostic {
  /** Constraint ID */
  constraint_id: string;
  /** Median failure margin (how far failures miss the threshold) */
  failure_margin_median: number;
  /** Fraction of failures within 10% of threshold (near misses) */
  near_miss_fraction: number;
  /** Whether this constraint is the primary limiter of joint probability */
  binding: boolean;
}

/**
 * Conditional probability between constraints.
 * P(target_constraint | given_constraint is satisfied)
 */
export interface ConditionalProbability {
  /** Constraint used as condition */
  given_constraint_id: string;
  /** Constraint whose probability is computed */
  target_constraint_id: string;
  /** Conditional probability [0, 1] */
  probability: number;
  /** Effective sample size for this computation */
  effective_sample_size: number;
}

/**
 * Feature status for constraint analysis.
 */
export type ConstraintFeatureStatus = 'computed' | 'unavailable' | 'skipped' | 'error';

// -----------------------------------------------------------------------------
// Request Schema
// -----------------------------------------------------------------------------

/**
 * V2 Run Request - canonical format for option comparison.
 *
 * Key differences from V1:
 * - `options` array is REQUIRED (not extracted from graph)
 * - `goal_node_id` is REQUIRED (not inferred)
 * - Graph may contain option nodes but they are filtered
 */
export interface RunRequestV3 {
  /**
   * Causal graph - accepts upstream format, normalized internally.
   * Option nodes (kind='option') are filtered before analysis.
   */
  graph: UpstreamGraph;

  /**
   * Decision paths to compare.
   * REQUIRED for option comparison mode (minimum 2 options).
   * Each option must have non-empty interventions.
   */
  options: OptionV3[];

  /**
   * Optimization target node ID.
   * REQUIRED - must exist in the graph after filtering.
   */
  goal_node_id: string;

  /**
   * Random seed for reproducibility.
   * Accept string (canonical) or number (legacy).
   * Normalized to string internally.
   */
  seed?: string | number;

  /** Number of Monte Carlo samples (default: 1000) */
  n_samples?: number;

  /** Detail level for enrichment */
  detail_level?: 'quick' | 'standard' | 'deep';

  /** Client-provided request ID for correlation */
  request_id?: string;

  /** Idempotency key */
  idempotency_key?: string;

  /**
   * User-defined success threshold for goal.
   * When provided, response includes probability_of_goal per option
   * indicating likelihood of outcome meeting or exceeding this value.
   * Null is treated as absent.
   */
  goal_threshold?: number | null;

  /**
   * Original decision description/brief.
   * When provided, CEE can generate contextualised review output
   * (e.g., "Hiring a senior developer is recommended for your goal
   * of increasing productivity" instead of generic "Option A recommended").
   * Max 10000 characters.
   */
  brief?: string;

  /**
   * Multiple success constraints for joint evaluation.
   * When present and non-empty, activates multi-constraint analysis mode.
   * Takes precedence over goal_threshold if both are provided.
   *
   * @example
   * goal_constraints: [
   *   { constraint_id: 'mrr', node_id: 'mrr_node', operator: '>=', value: 20000 },
   *   { constraint_id: 'churn', node_id: 'churn_node', operator: '<=', value: 0.04 }
   * ]
   */
  goal_constraints?: GoalConstraint[];
}

// -----------------------------------------------------------------------------
// Critique Types
// -----------------------------------------------------------------------------

/**
 * Critique severity levels.
 */
export type CritiqueSeverityV3 = 'info' | 'warning' | 'error' | 'blocker';

/**
 * Critique source.
 */
export type CritiqueSourceV3 = 'validation' | 'engine' | 'cee' | 'isl';

/**
 * BLOCKER critique codes for preflight validation.
 */
export type BlockerCode =
  | 'MISSING_GOAL_NODE'
  | 'GOAL_NODE_NOT_IN_GRAPH'  // Canonical code for goal node validation
  | 'GOAL_NODE_NOT_CAUSAL'    // Goal is a non-causal node (option/decision)
  | 'NO_OPTIONS'
  | 'TOO_MANY_OPTIONS'        // Options exceed MAX_OPTIONS limit
  | 'EMPTY_INTERVENTIONS'
  | 'INVALID_INTERVENTION_TARGET'
  | 'INVALID_INTERVENTION_VALUE'
  | 'NO_PATH_TO_GOAL'
  // Constraint validation blockers
  | 'CONSTRAINT_TARGET_NOT_FOUND'      // node_id not in graph.nodes
  | 'CONSTRAINT_TARGET_NOT_IN_INFERENCE' // Target node kind is decision, option, or constraint
  | 'CONSTRAINT_INVALID_OPERATOR'      // Operator not >= or <=
  | 'CONSTRAINT_DUPLICATE_ID'          // Two constraints share the same constraint_id
  | 'IDENTICAL_OPTIONS'
  | 'INVALID_NODE_ID_PATTERN'
  | 'INVALID_EDGE_ENDPOINT'
  | 'DUPLICATE_NODE_IDS'
  | 'GRAPH_TOO_LARGE'
  | 'IDENTIFIABILITY_ISSUE'
  | 'GRAPH_CYCLE_DETECTED'
  | 'ISL_CANNOT_IDENTIFY';

/**
 * WARNING critique codes for constraint validation.
 * These do not block analysis but indicate potential issues.
 */
export type ConstraintWarningCode =
  | 'CONSTRAINT_VALUE_OUTSIDE_RANGE'  // Value outside derivable state_space.range for target node
  | 'CONSTRAINT_MISSING_RANGE'        // Target node has no derivable range (heuristic fallback needed)
  | 'CONSTRAINT_DUPLICATE_TARGET';    // Two constraints target same node with same operator (after dedupe)

/**
 * Actionable critique with structured metadata.
 */
export interface CritiqueV3 {
  /** Unique critique ID */
  id: string;
  /** Critique code for programmatic handling */
  code: BlockerCode | string;
  /** Severity level */
  severity: CritiqueSeverityV3;
  /** User-facing message */
  message: string;
  /** Where this critique originated */
  source: CritiqueSourceV3;
  /** Affected option IDs (for option-specific critiques) */
  affected_option_ids?: string[];
  /** Affected node IDs (for node-specific critiques) */
  affected_node_ids?: string[];
  /** Whether this critique blocks analysis */
  blocks_analysis: boolean;
  /** Suggested remediation action */
  suggestion?: string;
}

// -----------------------------------------------------------------------------
// Response Types
// -----------------------------------------------------------------------------

/**
 * Top-level analysis status.
 * NOT UI vocabulary - specific to overall request outcome.
 */
export type TopLevelAnalysisStatus = 'computed' | 'partial' | 'failed' | 'blocked';

/**
 * Per-feature analysis status.
 * UI vocabulary ONLY - used for option_comparison_status, robustness_status, drivers_status.
 */
export type PerFeatureStatus = 'computed' | 'unavailable' | 'skipped' | 'error';

/**
 * Legacy analysis status (V1 compatibility).
 * @deprecated Use PerFeatureStatus for V2 responses.
 */
export type AnalysisStatus =
  | 'available'
  | 'unavailable'
  | 'unavailable_legacy_contract'
  | 'failed';

/**
 * V2 Run Error response - returned on HTTP 422.
 * NOT wrapped in error.v1 envelope (documented PoC exception).
 */
export interface V2RunError {
  /** Always 'blocked' for 422 responses */
  analysis_status: 'blocked';
  /** Reason for blocking */
  status_reason: string;
  /** Structured critiques explaining the block */
  critiques: CritiqueV3[];
  /** CIL 0.2: Robustness with empty arrays maintained on blocked responses */
  robustness: RobustnessAssessmentV3;
}

/**
 * V2 Run Response with explicit status flags.
 */
export interface RunResponseV3 {
  /** Request schema version */
  request_schema_version: 'v3';
  /** Endpoint version */
  endpoint_version: 'v2/run';
  /** Preflight validation version (date-based) */
  preflight_version: string;

  /** Request ID echo */
  request_id?: string;

  /**
   * Top-level analysis status.
   * NOT UI vocabulary - specific to overall request outcome.
   * - 'computed': All requested analyses completed successfully
   * - 'partial': Some analyses completed, others failed/unavailable
   * - 'failed': Analysis failed (e.g., ISL error, all samples NaN)
   */
  analysis_status: TopLevelAnalysisStatus;

  /**
   * Reason for status (if not 'computed').
   */
  status_reason?: string;

  /**
   * Option comparison status.
   * UI vocabulary: computed | unavailable | skipped | error
   */
  option_comparison_status: PerFeatureStatus;

  /**
   * Robustness analysis status.
   * UI vocabulary: computed | unavailable | skipped | error
   */
  robustness_status: PerFeatureStatus;

  /**
   * Drivers analysis status.
   * UI vocabulary: computed | unavailable | skipped | error
   */
  drivers_status: PerFeatureStatus;

  // ---------------------------------------------------------------------------
  // Multi-Constraint Analysis Fields (Phase 1)
  // Only present when goal_constraints[] is provided in request
  // ---------------------------------------------------------------------------

  /**
   * Multi-constraint analysis status.
   * Only present when goal_constraints provided in request.
   */
  constraints_status?: ConstraintFeatureStatus;

  /**
   * Per-constraint evaluation results.
   * Only present when goal_constraints provided and constraints_status is 'computed'.
   */
  constraint_results?: ConstraintResult[];

  /**
   * Diagnostic information for constraint analysis.
   * Only present when goal_constraints provided and constraints_status is 'computed'.
   */
  constraint_diagnostics?: ConstraintDiagnostic[];

  /**
   * Conditional probabilities between constraints.
   * Only present when goal_constraints provided and constraints_status is 'computed'.
   */
  conditional_probabilities?: ConditionalProbability[];

  /**
   * ISL status echoed for debugging.
   */
  isl_analysis_status?: string;

  /**
   * ISL status reason echoed for debugging.
   */
  isl_status_reason?: string;

  /** All critiques (blockers and non-blockers) */
  critiques: CritiqueV3[];

  /** Option comparison results (if status is 'computed') */
  option_comparison?: OptionComparisonResultV3[];

  /**
   * Edge sensitivity results. Always an array (empty if unavailable).
   * Edge ID format: `from::to` (double-colon separator)
   */
  edge_sensitivity: EdgeSensitivityResultV3[];

  /** Factor sensitivity results (if available) */
  factor_sensitivity?: FactorSensitivityResultV3[];

  /**
   * Factor enrichments from CEE /assist/v1/review.
   * Provides human-readable insights for UI factor cards.
   * Undefined if CEE unavailable, timed out, or failed.
   *
   * NOTE: This field is LLM-derived and non-deterministic.
   * Must be excluded from canonical hash calculations.
   */
  factor_enrichments?: FactorEnrichment[];

  /**
   * M1 Coaching output (Phase 2).
   * Deterministic coaching layer providing story headlines, evidence gaps,
   * model critiques, and next actions.
   * Undefined if ISL data unavailable or coaching generation fails.
   *
   * NOTE: Fully deterministic (no LLM calls) but excluded from response_hash
   * as non-semantic metadata.
   */
  m1_coaching?: M1Coaching;

  /**
   * Flip thresholds (tipping points) for the most sensitive factors.
   * Shows at what value each factor would cause the recommended option to change.
   * Values denormalised to user units (not [0,1] normalised space).
   * Undefined when unavailable (ISL failure, no factor sensitivity data).
   * Max 5 factors (top by |elasticity|).
   *
   * NOTE: Deterministic (no LLM). Excluded from response_hash as non-semantic.
   */
  flip_thresholds?: DenormalisedFlipThreshold[];

  // ---------------------------------------------------------------------------
  // M2 Decision Review Fields (LLM-generated review from CEE)
  // ---------------------------------------------------------------------------

  /**
   * M2 Decision Review from CEE /assist/v1/decision-review endpoint.
   * LLM-generated review validated by PLoT's 9-tier validator.
   * Null if review failed validation, skipped, or disabled.
   *
   * NOTE: LLM-derived, non-deterministic. Excluded from response_hash.
   */
  m1_review?: M1Review | null;

  /**
   * M2 Decision Review status.
   * - 'complete': Review passed validation
   * - 'failed': Review failed validation (see review_failure_codes)
   * - 'skipped': Review skipped (e.g., CEE unavailable)
   * - 'disabled': DECISION_REVIEW_ENABLE flag is false
   */
  review_status?: ReviewStatus;

  /**
   * M2 Decision Review metadata.
   * Contains model info and latency for observability.
   */
  review_meta?: {
    model?: string;
    latency_ms?: number;
    tokens?: number;
  };

  /**
   * M2 Decision Review failure codes.
   * Present when review_status is 'failed'.
   * See M1ReviewFailureCodes for valid codes.
   */
  review_failure_codes?: string[];

  /**
   * M2 Decision Review warnings.
   * Present when review passed with non-critical issues (e.g., UNGROUNDED_NUMBER after correction).
   */
  review_warnings?: string[];

  /**
   * M2 Decision Review skip reason.
   * Present when review_status is 'skipped'. Explains why review was skipped.
   * See ReviewSkipReasons for valid codes.
   */
  review_skip_reason?: ReviewSkipReason;

  /** Overall robustness assessment (if robustness_status is 'computed') */
  robustness?: RobustnessAssessmentV3;

  /**
   * CEE's synthesized explanation of robustness.
   * Null if CEE unavailable or not called.
   */
  robustness_synthesis?: RobustnessSynthesisV3 | null;

  // ---------------------------------------------------------------------------
  // CEE Results Panel Fields (top-level for flat V2 structure)
  // ---------------------------------------------------------------------------

  /**
   * CEE integration status.
   * - 'available': CEE responded successfully
   * - 'unavailable': CEE not configured or endpoint unreachable
   * - 'degraded': CEE responded with partial data or errors
   * - 'skipped': CEE call was skipped (e.g., no robustness data to send)
   */
  cee_status?: CeeStatusV3;

  /**
   * Decision quality assessment from CEE.
   * Null if CEE unavailable.
   */
  decision_quality?: DecisionQualityV3 | null;

  /**
   * Insights from CEE analysis (fragile assumptions, biases, info gaps).
   * Null if CEE unavailable.
   */
  insights?: InsightV3[] | null;

  /**
   * Improvement guidance from CEE.
   * Null if CEE unavailable.
   */
  improvement_guidance?: ImprovementGuidanceV3[] | null;

  /**
   * Rationale explanation from CEE.
   * Null if CEE unavailable.
   */
  rationale?: RationaleV3 | null;

  /**
   * CEE trace for observability.
   * Contains requestId, degraded flag, timestamp, and error reason if applicable.
   */
  ceeTrace?: {
    requestId: string;
    degraded: boolean;
    timestamp: string;
    source?: string;
    reason?: string;
    status?: number;
    plot_request_id?: string;
    cee_sent_request_id?: string | null;
    cee_returned_request_id?: string | null;
    latency_ms?: number | null;
    id_mismatch?: boolean;
  };

  /** Determinism hash of canonical request (semantic fields only) */
  response_hash?: string;

  /**
   * Canonical metadata for UI canonicalisation layer.
   * Only included when UI_CANONICAL_META feature flag is enabled.
   * Contains repair records, source path, and build info.
   */
  _meta?: CanonicalMeta;

  /**
   * Downstream service calls made during request processing.
   * Contains ISL and CEE call details for debugging and tracing.
   */
  downstream_calls?: DownstreamCallsV3;

  /** Processing metadata */
  meta: {
    /** Seed used (always echoed as string) */
    seed_used: string;
    /**
     * CIL Phase 1: Indicates seed origin for deterministic Monte Carlo runs.
     * Canonical type from @talchain/schemas SeedSource enum.
     * - 'client_generated': Client explicitly provided seed in request
     * - 'server_generated': Server derived seed from request graph hash
     */
    seed_source: SeedSourceType;
    n_samples: number;
    detail_level: string;
    latency_ms: number;
    normalization_ms?: number;
    validation_ms?: number;
    isl_ms?: number;
    cee_ms?: number;
    /** Build version for deployment verification */
    build?: string;
    /**
     * ISO 8601 timestamp when analysis computation completed.
     * Captured when ISL response is received (before PLoT processing).
     */
    computed_at?: string;
    /** End-to-end request ID chain for debug tracing */
    request_id_chain?: {
      /** Request ID received from UI (X-Request-Id header or body.request_id) */
      received: string;
      /** Request ID forwarded to ISL */
      forwarded_to_isl: string;
      /** Request ID echoed back by ISL (null if ISL doesn't echo) */
      isl_echoed: string | null;
      /** True when all non-null IDs in the chain match */
      all_match: boolean;
    };
  };
}

/**
 * Outcome statistics from ISL Monte Carlo simulation.
 */
export interface OutcomeStatsV3 {
  /** Mean outcome value */
  mean: number;
  /** Standard deviation */
  std?: number;
  /** 10th percentile (pessimistic) */
  p10: number;
  /** 50th percentile (median/expected) */
  p50: number;
  /** 90th percentile (optimistic) */
  p90: number;
  /** Number of Monte Carlo samples */
  n_samples?: number;
  /** Number of valid (non-NaN) samples */
  n_valid_samples?: number;
  /** Ratio of valid to total samples */
  validity_ratio?: number;
}

/**
 * Per-option comparison result.
 */
export interface OptionComparisonResultV3 {
  option_id: string;
  option_label: string;
  // CIL 0.1: populate id/label from option_id/option_label for UI consumers
  id: string;
  label: string;
  /** @deprecated Use outcome.mean instead */
  expected_outcome?: number;
  /** @deprecated Use [outcome.p10, outcome.p90] instead */
  confidence_interval?: [number, number];
  /** Full outcome statistics from ISL */
  outcome?: OutcomeStatsV3;
  /** Option computation status */
  status?: 'computed' | 'skipped' | 'error';
  /** Reason if status is not 'computed' */
  status_reason?: string;
  /**
   * Probability of outcome meeting or exceeding goal_threshold [0, 1].
   * Only present when goal_threshold provided in request.
   */
  probability_of_goal?: number;
  /**
   * Probability this option outperforms alternatives across simulated scenarios [0, 1].
   */
  win_probability?: number;

  /**
   * Probability of jointly satisfying all goal_constraints [0, 1].
   * Only present when goal_constraints provided in request.
   */
  probability_of_joint_goal?: number;

  /**
   * Per-constraint probabilities for this option.
   * Map of constraint_id to probability [0, 1].
   * Only present when goal_constraints provided in request.
   */
  constraint_probabilities?: Record<string, number>;
}

/**
 * Edge sensitivity result.
 */
export interface EdgeSensitivityResultV3 {
  /** Edge identifier. Format: `from::to` (double-colon separator) */
  edge_id: string;
  /** Source node ID */
  from: string;
  /** Target node ID */
  to: string;
  /** Type of sensitivity analysis */
  sensitivity_type: 'existence' | 'magnitude';
  /** Elasticity score */
  elasticity: number;
  /** Importance ranking (1 = most important) */
  importance_rank: number;
  /** Human-readable interpretation */
  interpretation: string;
}

/**
 * Factor sensitivity result.
 *
 * Note: Numeric fields are optional because ISL may not always provide them.
 * Missing values mean "unavailable" (not "zero influence") — do not default to 0.
 *
 * Sources:
 * - Graph-based (primary): Computed from edge path analysis using computeFactorInfluence()
 * - ISL (fallback): From ISL /api/v1/robustness/analyze/v2 response
 */
export interface FactorSensitivityResultV3 {
  /** Factor identifier (mapped from ISL node_id or graph factor.id) */
  factor_id: string;
  /** Human-readable factor label */
  factor_label?: string;
  /** Influence score (normalized 0-1). From graph or ISL. */
  influence_score?: number;
  /** Influence rank. 1 = most influential. */
  influence_rank?: number;
  /** Sensitivity score (raw total causal effect). From graph influence or ISL. */
  sensitivity_score?: number;
  /** Elasticity measure from ISL */
  elasticity?: number;
  /** Direction of influence on goal */
  direction?: 'positive' | 'negative' | 'mixed' | 'unknown';
  /** Importance ranking (1 = most important) - same as influence_rank for graph-based */
  importance_rank?: number;
  /** Human-readable interpretation from ISL */
  interpretation?: string;
  /** Value of information from ISL */
  value_of_information?: number;
  /**
   * Confidence in the sensitivity score (0-1).
   * Graph-based: derived from edge exists_probability and strength.std along paths
   * ISL: may be provided or derived from value_of_information
   */
  confidence?: number;
  /** Reason why sensitivity is zero. Present when sensitivity_score = 0. */
  zero_reason?: string;
  /** Source of this factor sensitivity data */
  source?: 'graph' | 'isl';
  /**
   * Flip risk category based on fragile edge adjacency.
   * - 'isolated': This factor alone can flip the recommendation (marginal_switch_probability > 0.05)
   * - 'correlated': This factor can flip recommendation in combination with others (switch_probability > 0.05)
   * - 'negligible': Minimal flip risk
   */
  flip_risk_category?: 'isolated' | 'correlated' | 'negligible';
}

/**
 * Normalized edge info for robustness assessment.
 * Consistent object shape regardless of ISL format.
 * Enriched with human-readable labels per Decision Model Schema v2.6.
 */
export interface NormalizedEdgeInfoV3 {
  edge_id: string;
  from_id: string;
  to_id: string;
  /** Human-readable source node label (falls back to from_id if node not found) */
  from_label: string;
  /** Human-readable target node label (falls back to to_id if node not found) */
  to_label: string;
  switch_probability: number;
  /** Marginal probability of recommendation switch for this edge */
  marginal_switch_probability?: number;
  /** Option that would win if this edge changes (from ISL) */
  alternative_winner_id?: string | null;
  /** Human-readable label for the alternative winner option (null when no alternative winner) */
  alternative_winner_label?: string | null;
}

/**
 * CIL Phase 0 canonical fragile edge shape.
 * Alias for NormalizedEdgeInfoV3 — guarantees consistent Array<FragileEdgeV2>
 * in /v2/run responses regardless of ISL code path.
 *
 * @see NormalizedEdgeInfoV3
 */
export type FragileEdgeV2 = NormalizedEdgeInfoV3;

/**
 * Near-tie detection result.
 * Indicates when top options are statistically equivalent and recommendation is uncertain.
 */
export interface NearTieInfoV3 {
  /** Whether a near-tie was detected (gap < threshold) */
  is_tie: boolean;
  /** ID of top-performing option (highest win_probability) */
  top_option_id: string;
  /** ID of second-place option (null if only one computed option) */
  second_option_id: string | null;
  /** IDs of all options within threshold of top performer */
  tied_option_ids: string[];
  /** Gap between top two options (0-1 probability, not percentage) */
  gap: number;
  /** Threshold used for detection (default: 0.10) */
  threshold: number;
}

/**
 * Overall robustness assessment.
 */
export interface RobustnessAssessmentV3 {
  score?: number;
  label?: 'robust' | 'moderate' | 'fragile';
  /** Fragile edges - always Array<FragileEdgeV2>, never undefined/null. Empty array when none. */
  fragile_edges: NormalizedEdgeInfoV3[];
  /** Robust edges - always Array<NormalizedEdgeInfoV3>, never undefined/null. Empty array when none. */
  robust_edges: NormalizedEdgeInfoV3[];
  explanation?: string;
  /** Recommendation stability from ISL (0-1, probability recommendation holds under perturbation) */
  recommendation_stability?: number;
  /** Boolean robustness flag from ISL V2/Option C format */
  is_robust?: boolean;
  /** Robustness level from ISL V2/Option C format */
  level?: 'high' | 'medium' | 'low' | 'very_low';
  /** Robustness confidence from ISL (0-1) V2/Option C format */
  confidence?: number;
  /** Normalization errors if any (for observability) */
  normalization_errors?: Array<{ edge_type: string; error: string; raw_value?: unknown }>;
  /**
   * Recommended option ID derived from argmax(win_probability).
   * Tie-breaker: lexicographic sort on option_id when win_probability within epsilon (1e-9).
   */
  recommended_option_id?: string;
  /**
   * Human-readable label for the recommended option.
   * Fallback chain: graph node label → option_comparison label → option_id.
   */
  recommended_option_label?: string;
  /**
   * Near-tie detection when top options are statistically equivalent.
   * Present when option_comparison is computed with valid win_probability values.
   */
  near_tie?: NearTieInfoV3;
}

/**
 * CEE's synthesized explanation of robustness.
 */
export interface RobustnessSynthesisV3 {
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

// -----------------------------------------------------------------------------
// CEE Results Panel Types
// -----------------------------------------------------------------------------

/**
 * CEE status for V2 response.
 */
export type CeeStatusV3 = 'available' | 'unavailable' | 'degraded' | 'skipped';

/**
 * Decision quality assessment from CEE.
 */
export interface DecisionQualityV3 {
  level: 'incomplete' | 'needs_strengthening' | 'good' | 'solid';
  summary: string;
}

/**
 * Insight types from CEE analysis.
 */
export type InsightTypeV3 = 'fragile_assumption' | 'potential_bias' | 'information_gap';

/**
 * Individual insight from CEE.
 */
export interface InsightV3 {
  type: InsightTypeV3;
  content: string;
  severity?: 'low' | 'medium' | 'high';
}

/**
 * Source of improvement guidance.
 */
export type ImprovementSourceV3 = 'missing_baseline' | 'fragile_edge' | 'bias' | 'structure';

/**
 * Improvement guidance item from CEE.
 */
export interface ImprovementGuidanceV3 {
  priority: number;
  action: string;
  reason: string;
  source: ImprovementSourceV3;
}

/**
 * Rationale explanation from CEE.
 */
export interface RationaleV3 {
  summary: string;
  key_driver?: string;
  goal_alignment?: string;
}

// -----------------------------------------------------------------------------
// Canonical Meta Types (for UI canonicalisation layer)
// -----------------------------------------------------------------------------

/**
 * Repair action type.
 */
export type RepairAction = 'clamped' | 'defaulted' | 'inferred' | 'floored' | 'derived' | 'normalised';

/**
 * Record of a repair applied during normalisation.
 * Captures the before/after state for auditability.
 *
 * @see docs/audits/PLOT_LEDGER_SPEC.md
 */
export interface RepairRecord {
  /** Field that was repaired (e.g., 'edge.exists_probability', 'edge.strength.mean') */
  field: string;
  /** Type of repair action */
  action: RepairAction;
  /** Original value before repair (null if missing) */
  from_value: number | string | null;
  /** Value after repair */
  to_value: number | string;
  /** Human-readable reason for the repair */
  reason: string;
}

/**
 * Source path for analysis results.
 */
export type SourcePath = 'isl' | 'graph_fallback';

/**
 * Canonical metadata for response auditability.
 * Only included when UI_CANONICAL_META feature flag is enabled.
 *
 * @see docs/audits/PLOT_LEDGER_SPEC.md
 */
export interface CanonicalMeta {
  /** Which computation path was used */
  source_path: SourcePath;
  /** All repairs applied during normalisation */
  repairs_applied: RepairRecord[];
  /** Request ID for correlation */
  request_id: string;
  /** PLoT build version */
  plot_build: string;
  /** Build versions for all services in the pipeline */
  builds?: {
    /** UI build version (from request header) */
    ui?: string | null;
    /** CEE build version */
    cee?: string | null;
    /** PLoT build version */
    plot?: string | null;
    /** ISL build version (from ISL response) */
    isl?: string | null;
  };
  /** Debug payloads for downstream service calls */
  payloads?: {
    /** Sanitized ISL request payload */
    isl_request?: unknown;
    /** Sanitized ISL response payload */
    isl_response?: unknown;
  };
}

/**
 * Single downstream service call info.
 */
export interface DownstreamCallInfoV3 {
  /** Service identifier: 'cee' | 'isl' */
  service: string;
  /** API endpoint path */
  endpoint: string;
  /** HTTP response status code */
  status: number;
  /** Call duration in milliseconds */
  elapsed_ms: number;
  /** 12-char payload hash sent to downstream */
  payload_hash: string;
  /** 12-char response hash from downstream (null if unavailable) */
  response_hash: string | null;
  /** X-Request-Id forwarded to downstream */
  request_id: string;
  /** Sanitized request payload for debug (truncated if large, sensitive data redacted) */
  request_payload?: unknown;
  /** Sanitized response payload for debug (truncated if large, sensitive data redacted) */
  response_payload?: unknown;
  /** Error response body for non-200 responses (truncated to 1000 chars) */
  error_body?: string;
}

/**
 * Downstream service calls container for response body.
 */
export interface DownstreamCallsV3 {
  /** ISL calls made during request */
  isl?: DownstreamCallInfoV3[];
  /** CEE calls made during request */
  cee?: DownstreamCallInfoV3[];
}

// -----------------------------------------------------------------------------
// Preflight Types
// -----------------------------------------------------------------------------

/**
 * Result of path-to-goal reachability check.
 */
export interface ReachabilityResult {
  reachable: boolean;
  path?: string[];
  blocked_reason?: string;
}

/**
 * Result of preflight validation.
 */
export interface PreflightResultV3 {
  passed: boolean;
  blockers: CritiqueV3[];
  warnings: CritiqueV3[];

  /** Stats for logging */
  goal_node_exists: boolean;
  options_count: number;
  options_with_interventions: number;
  options_with_path_to_goal: number;
  intervention_targets: string[];
  targets_with_path_to_goal_count: number;
  option_nodes_filtered: number;
  option_edges_filtered: number;
  edges_normalised: number;
  nodes_normalised: number;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Valid node ID pattern — canonical definition from @talchain/schemas */
export const NODE_ID_PATTERN = SCHEMA_NODE_ID_PATTERN;

/** Maximum nodes allowed - re-exported from single source of truth */
export const MAX_NODES = LIMITS_MAX_NODES;

/** Maximum edges allowed - re-exported from single source of truth */
export const MAX_EDGES = LIMITS_MAX_EDGES;

/** Maximum options allowed - re-exported from single source of truth */
export const MAX_OPTIONS = LIMITS_MAX_OPTIONS;

// Also export the LIMITS object for consumers who prefer it
export { LIMITS };

/** Preflight version (date-based) */
export const PREFLIGHT_VERSION = '2025-12-26';

/** Default seed (string format) */
export const DEFAULT_SEED = '42';

/**
 * Non-causal node kinds to filter before ISL translation.
 * Use exclusion-based filtering to avoid dropping new causal kinds.
 */
export const NON_CAUSAL_NODE_KINDS = ['option', 'decision'] as const;

/** Minimum std for edge strength (to avoid division by zero) */
export const MIN_STRENGTH_STD = 1e-6;

// -----------------------------------------------------------------------------
// CIL Phase 1: Re-export schema wire types for API boundary consumers
// Internal engine types (EngineNodeV3, EngineEdgeV3, EngineGraphV3) remain
// PLoT-specific for the richer post-normalization representation.
// -----------------------------------------------------------------------------
export type { SchemaNodeV3, SchemaEdgeV3, SchemaGraphV3, SchemaRepairEntry };
export type { SeedSourceType } from '@talchain/schemas';
