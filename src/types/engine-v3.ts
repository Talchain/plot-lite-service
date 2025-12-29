/**
 * Engine V3 Types for /v2/run Endpoint
 *
 * Canonical model: Options are intervention bundles, NOT graph nodes.
 * Option nodes in the graph are UI scaffolding and are filtered before analysis.
 *
 * @see Integration Alignment Implementation Brief v1.1
 */

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
  observed_state?: {
    value?: number;
    baseline?: number;
    unit?: string;
  };
  data?: {
    // React Flow nesting
    kind?: string;
    type?: string;
    value?: number;
    baseline?: number;
    unit?: string;
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
  /** Observed state for factor nodes */
  observed_state?: {
    value: number;
    baseline?: number;
    unit?: string;
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
  | 'EMPTY_INTERVENTIONS'
  | 'INVALID_INTERVENTION_TARGET'
  | 'INVALID_INTERVENTION_VALUE'
  | 'NO_PATH_TO_GOAL'
  | 'IDENTICAL_OPTIONS'
  | 'INVALID_NODE_ID_PATTERN'
  | 'INVALID_EDGE_ENDPOINT'
  | 'DUPLICATE_NODE_IDS'
  | 'GRAPH_TOO_LARGE'
  | 'IDENTIFIABILITY_ISSUE'
  | 'GRAPH_CYCLE_DETECTED'
  | 'ISL_CANNOT_IDENTIFY';

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

  /** Edge sensitivity results (if drivers_status is 'computed') */
  edge_sensitivity?: EdgeSensitivityResultV3[];

  /** Factor sensitivity results (if available) */
  factor_sensitivity?: FactorSensitivityResultV3[];

  /** Overall robustness assessment (if robustness_status is 'computed') */
  robustness?: RobustnessAssessmentV3;

  /** Determinism hash of canonical request (semantic fields only) */
  response_hash?: string;

  /** Processing metadata */
  meta: {
    /** Seed used (always echoed as string) */
    seed_used: string;
    n_samples: number;
    detail_level: string;
    latency_ms: number;
    normalization_ms?: number;
    validation_ms?: number;
    isl_ms?: number;
  };
}

/**
 * Per-option comparison result.
 */
export interface OptionComparisonResultV3 {
  option_id: string;
  option_label: string;
  expected_outcome: number;
  confidence_interval: [number, number];
  probability_of_goal?: number;
}

/**
 * Edge sensitivity result.
 */
export interface EdgeSensitivityResultV3 {
  edge_id: string;
  from: string;
  to: string;
  sensitivity_type: 'existence' | 'magnitude';
  elasticity: number;
  importance_rank: number;
  interpretation: string;
}

/**
 * Factor sensitivity result.
 */
export interface FactorSensitivityResultV3 {
  factor_id: string;
  sensitivity_score: number;
  value_of_information: number;
  direction?: 'positive' | 'negative' | 'mixed';
}

/**
 * Overall robustness assessment.
 */
export interface RobustnessAssessmentV3 {
  score: number;
  label: 'robust' | 'moderate' | 'fragile';
  fragile_edges?: string[];
  robust_edges?: string[];
  explanation: string;
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

/** Valid node ID pattern */
export const NODE_ID_PATTERN = /^[a-z0-9_:-]+$/;

/** Maximum nodes allowed */
export const MAX_NODES = 50;

/** Maximum edges allowed */
export const MAX_EDGES = 100;

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
