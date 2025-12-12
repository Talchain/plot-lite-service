/**
 * Trust Signal Types for PLoT Engine v1
 * British English in user-facing strings
 */

import type { EvidenceFreshnessSummary } from './evidence-freshness.js';

/**
 * Confidence level classification (lowercase for cross-workstream alignment)
 * Matches ISL/CEE conventions: high | medium | low
 */
export type ConfidenceLevel = 'low' | 'medium' | 'high';

/**
 * Provenance confidence level with unknown fallback
 */
export type ProvenanceConfidenceLevel = 'low' | 'medium' | 'high' | 'unknown';

export type DetailLevel = 'quick' | 'standard' | 'deep';

/**
 * Detail level configuration - controls compute budget and feature enablement
 * quick: fast iteration, minimal analysis (K=16)
 * standard: normal runs, default (K=32)
 * deep: thorough analysis, audit/export (K=64)
 */
export interface DetailLevelConfig {
  k_samples: number;
  run_critique: boolean;
  run_sensitivity: boolean;
  run_cee: boolean;
}

export const DETAIL_LEVEL_CONFIG: Record<DetailLevel, DetailLevelConfig> = {
  quick: { k_samples: 16, run_critique: false, run_sensitivity: false, run_cee: false },
  standard: { k_samples: 32, run_critique: true, run_sensitivity: true, run_cee: true },
  deep: { k_samples: 64, run_critique: true, run_sensitivity: true, run_cee: true },
};

export interface ModelCard {
  seed: number;
  assumptions_summary: string[];
  compute_budget: {
    k_samples?: number;
    downgraded?: boolean;
    downgrade_reason?: string;
  };
  flags_on: string[];
  determinism_note: string;
  response_hash?: string; // SHA-256 of normalised payload (added for auditability)
  warnings?: string[]; // Optional warnings (e.g., zero baseline)
  identifiability_tag?: string; // Plain-English identifiability summary (IDENT_TAG_ENABLE=1)
  detail_level?: DetailLevel; // P1: quick | standard | deep
  // P1: Adaptive K early-stopping parameters
  parameters?: {
    K: number;
    K_requested?: number;
    K_converged?: boolean;
  };
  evidence_freshness?: EvidenceFreshnessSummary;
  provenance_summary?: ProvenanceSummary;
}

export interface ProvenanceSummary {
  sources: string[];
  source_count: number;
  edges_with_provenance: number;
  edges_total: number;
  coverage_ratio: number; // 0-1 proportion of edges with external provenance
  confidence_level: ProvenanceConfidenceLevel;
  confidence_score: number; // 0-1 summary score for provenance quality
  collected_at: string; // ISO 8601 timestamp when summary was computed
}

export interface ConfidenceBadge {
  level: ConfidenceLevel;
  reason: string;
  score: number; // 0-1
  factors: {
    identifiability: number; // 0-1
    linearity_distance: number; // 0-1 (1 = in range)
    k_coverage: number; // 0-1
    calibration: number; // 0-1
  };
}

export interface LinearityWarning {
  outside_range: boolean;
  distance_from_center: number; // percentage
  recommendation: string;
}

export interface SensitivitySummary {
  concentration: 'high' | 'medium' | 'diffuse';
  top_n_explain_pct: number;
  top_n: number;
  interpretation: string;
}

export interface GraphQuality {
  score: number; // 0.00–1.00
  completeness: number;
  evidence_coverage: number;
  balance: number;
  issues_count: number;
  recommendation?: string;
}

/**
 * Graph health assessment for variance potential
 * Detects conditions that cause flat/collapsed analysis results
 */
export type GraphHealthIssue = 'uniform_weights' | 'uniform_beliefs' | 'single_path';

export interface GraphHealth {
  /** Variance potential status */
  variance_status: 'limited' | 'healthy' | 'unknown';
  /** Specific issues detected (only present if variance_status='limited') */
  issues?: GraphHealthIssue[];
  /** Actionable suggestion for improving the graph */
  suggestion?: string;
  /** Source of the assessment */
  source: 'engine' | 'isl';
}

export interface Insights {
  summary: string; // ≤200 chars
  risks: string[]; // max 5, each ≤100 chars
  next_steps: string[]; // max 3, each ≤150 chars
}

export interface ThresholdCrossing {
  metric: string;
  from_value: number;
  to_value: number;
  threshold: number;
  crossed: boolean;
  direction: 'up' | 'down';
}

export interface ForkSuggestion {
  reason: string;
  scenarios: Array<{
    name: string;
    key_change: string;
    outcome_headline: string;
  }>;
}

export type CritiqueSeverity = 'BLOCKER' | 'IMPROVEMENT' | 'OBSERVATION';

/** Source of a critique item */
export type CritiqueSource = 'engine' | 'isl' | 'cee';

export interface CritiqueItem {
  /** Standardized code for filtering/analytics (optional for backwards compatibility) */
  code?: string;
  severity: CritiqueSeverity;
  /** Semantic severity for UI display */
  semantic_severity?: 'ERROR' | 'WARNING' | 'INFO';
  message: string;
  suggested_action?: string;
  auto_fixable?: boolean;
  /** Source that generated this critique */
  source?: CritiqueSource;
  /** Edge ID for edge-specific issues */
  edge_id?: string;
}

export interface ExplainDelta {
  top_drivers: Array<{
    node_id: string;
    node_label: string;
    contribution: number; // percentage
    sign: '+' | '-';
    explanation: string;
  }>;
  summary: string;
}

export interface TrustedResponse {
  model_card: ModelCard;
  confidence: ConfidenceBadge;
  linearity_warning?: LinearityWarning;
  threshold_crossings?: ThresholdCrossing[];
  fork_suggestions?: ForkSuggestion[];
  explain_delta?: ExplainDelta;
  critique?: CritiqueItem[];
  sensitivity_summary?: SensitivitySummary;
  graph_quality?: GraphQuality;
  insights?: Insights;
}

/**
 * Node classification kind - aligned with CEE/ISL workstreams
 * See Platform Architecture Contract v1.4 §4.2
 *
 * - goal: Strategic objective being pursued
 * - decision: Choice point under decision-maker's control
 * - option: Alternative within a decision
 * - outcome: Result or consequence node
 * - risk: Potential negative outcome or hazard
 * - action: Executable step within an option
 * - factor: External uncertainty or chance node (not controllable)
 */
export type NodeKind = 'goal' | 'decision' | 'option' | 'outcome' | 'risk' | 'action' | 'factor';

/** All valid node kind values for validation */
export const VALID_NODE_KINDS: readonly NodeKind[] = ['goal', 'decision', 'option', 'outcome', 'risk', 'action', 'factor'];

/**
 * Edge type classification for inference semantics
 * - functional: Direct causal relationship (goal → decision)
 * - structural: Hierarchical/containment relationship (decision → option)
 * - probabilistic: Stochastic outcome relationship (option → outcome)
 */
export type EdgeType = 'functional' | 'structural' | 'probabilistic';

/** All valid edge type values for validation */
export const VALID_EDGE_TYPES: readonly EdgeType[] = ['functional', 'structural', 'probabilistic'];

/**
 * Edge function type for non-linear relationships (FunctionalForm)
 *
 * EdgeV1 types:
 * - linear: y = x (default)
 * - diminishing_returns: y = 1 - e^(-k*x) — saturates at high input values
 * - threshold: y = 0 if x < t, else slope * (x - t) — step with optional slope
 * - s_curve: y = 1 / (1 + e^(-k*(x - m))) — logistic/sigmoid transition
 *
 * EdgeV2 additions (flag-gated):
 * - noisy_or: P(Y=1) = 1 - ∏(1 - w_i * X_i) — for binary nodes with multiple binary parents
 * - logistic: P(Y=1) = 1 / (1 + e^(-k*(X - threshold))) — continuous→binary transitions
 */
export type EdgeFunctionType = 'linear' | 'diminishing_returns' | 'threshold' | 's_curve' | 'noisy_or' | 'logistic';

/** Alias for EdgeFunctionType - used in EdgeV2 schema */
export type FunctionalForm = EdgeFunctionType;

/** All valid edge function type values for validation */
export const VALID_EDGE_FUNCTION_TYPES: readonly EdgeFunctionType[] = [
  'linear',
  'diminishing_returns',
  'threshold',
  's_curve',
  'noisy_or',
  'logistic',
];

/**
 * Parameters for non-linear edge functions
 */
export interface EdgeFunctionParams {
  /** Rate parameter for diminishing_returns, s_curve, and logistic (must be > 0) */
  k?: number;
  /** Threshold value for threshold and logistic functions */
  threshold?: number;
  /** S-curve midpoint value */
  midpoint?: number;
  /** Post-threshold slope for threshold function (default: 1) */
  slope?: number;
}

/**
 * Provenance tag for edge source attribution
 * Used in EdgeV2 to track origin of edges
 */
export type ProvenanceTag =
  | 'template'      // From graph template
  | 'user'          // User-created
  | 'cee'           // CEE-suggested
  | 'isl'           // ISL-inferred
  | 'assumption'    // Assumed relationship
  | 'expert'        // Domain expert input
  | 'data'          // Data-derived
  | string;         // Custom provenance

/**
 * Edge schema version for migration tracking
 * - v1: Legacy single belief (EdgeV1)
 * - v2: Dual beliefs (EdgeV2) with belief_exists + belief_strength
 */
export type EdgeSchemaVersion = 'v1' | 'v2';

/**
 * EdgeV2 Schema - Enhanced edge with dual beliefs and functional forms
 *
 * Key differences from EdgeV1:
 * - belief_exists: Confidence that the edge exists at all (0-1)
 * - belief_strength: Confidence in weight precision (0-1)
 * - functional_form: How effect propagates (defaults to 'linear')
 * - provenance: Origin of this edge
 *
 * Sampling behaviour:
 * 1. Edge inclusion: Include with probability belief_exists (Bernoulli)
 * 2. Weight variation: If included, sample weight from distribution centered
 *    on weight with variance inversely proportional to belief_strength
 */
export interface EdgeV2 {
  /** Unique edge identifier (optional, generated if not provided) */
  id?: string;
  /** Source node ID */
  source: string;
  /** Target node ID */
  target: string;
  /** Causal strength coefficient (current: [-1,1], future: [-3,3]) */
  weight: number;
  /** Confidence that this edge exists at all (0-1) */
  belief_exists: number;
  /** Confidence in weight precision (0-1) */
  belief_strength: number;
  /** How effect propagates through this edge */
  functional_form: FunctionalForm;
  /** Origin of this edge for attribution */
  provenance: ProvenanceTag;
  /** Optional label for display */
  label?: string;
  /** Edge type classification */
  edge_type?: EdgeType;
  /** Parameters for non-linear edge functions */
  function_params?: EdgeFunctionParams;
}

export interface GraphNode {
  id: string;
  label: string;
  kind?: NodeKind;
  /** @deprecated Use `kind` instead. Maintained for backward compatibility. */
  type?: string;
  value?: number;

  // Sequential/multi-stage support (Phase 4)
  /** 0-indexed stage number for multi-stage decisions */
  stage?: number;
  /** Human-readable stage label (e.g., "Launch Decision", "Pricing Decision") */
  stage_label?: string;
  /** ISO 8601 timestamp or relative time when uncertainty resolves */
  resolves_at?: string;
  /** ISO 8601 timestamp or relative time when decision must be made */
  decision_timing?: string;
}

/**
 * GraphEdge - Unified edge interface supporting both EdgeV1 and EdgeV2 schemas
 *
 * EdgeV1 (legacy): Uses single 'belief' field
 * EdgeV2 (dual beliefs): Uses 'belief_exists' + 'belief_strength'
 *
 * Migration: When EdgeV2 fields are absent, they are derived from EdgeV1:
 * - belief_exists = belief (or 1.0 if missing)
 * - belief_strength = belief (or 0.8 if missing)
 * - functional_form = function_type (or 'linear' if missing)
 */
export interface GraphEdge {
  /** Unique edge identifier (optional) */
  id?: string;
  /** Source node ID (EdgeV1 naming) */
  from: string;
  /** Target node ID (EdgeV1 naming) */
  to: string;
  /** Optional label for display */
  label?: string;
  /** Causal strength coefficient */
  weight?: number;

  // EdgeV1 fields (legacy, maintained for backward compatibility)
  /** @deprecated Use belief_exists instead. Edge existence probability (0-1) */
  belief?: number;
  /** Source attribution, max 100 chars */
  provenance?: string;
  /** Edge type classification */
  edge_type?: EdgeType;
  /** @deprecated Use functional_form instead. Non-linear function type */
  function_type?: EdgeFunctionType;
  /** Parameters for non-linear edge functions */
  function_params?: EdgeFunctionParams;

  // EdgeV2 fields (dual beliefs)
  /** Confidence that this edge exists at all (0-1). EdgeV2 schema. */
  belief_exists?: number;
  /** Confidence in weight precision (0-1). EdgeV2 schema. */
  belief_strength?: number;
  /** How effect propagates through this edge. EdgeV2 schema. */
  functional_form?: FunctionalForm;
}

/**
 * Stage definition for multi-stage/sequential decisions
 * Describes a single temporal stage in a decision sequence
 *
 * P1: Scope and Usage
 * - Each stage represents a distinct time point in a multi-stage decision
 * - Nodes assigned to a stage via stage/stage_label fields must have decisions[] or resolved_uncertainties[]
 * - Stages must be ordered (index 0 = earliest, index n-1 = final)
 * - All decisions in a stage must be made before moving to the next stage
 * - Uncertainties resolve after their stage's decisions are made
 *
 * Example timeline: Launch Decision (stage 0) → Market Response (stage 1) → Scale Decision (stage 2)
 */
export interface StageDefinition {
  /** 0-indexed stage number */
  index: number;
  /** Human-readable stage name */
  label: string;
  /** Optional time horizon description (e.g., "Q1 2025", "+6 months") */
  time_horizon?: string;
  /** Node IDs of decisions to be made at this stage */
  decisions: string[];
  /** Node IDs of uncertainties that resolve at this stage */
  resolved_uncertainties: string[];
}

/**
 * Sequential metadata for multi-stage decision graphs (Phase 4)
 *
 * P1: Scope and Contract
 * - When is_sequential=true, the graph represents a temporal decision problem
 * - stages[] must be non-empty and ordered by index
 * - All stage-assigned nodes must exist in the graph
 * - Discount factor applies to outcomes at later stages (default 1.0 = no discounting)
 *
 * Inference behaviour:
 * - Stage 0 decisions are evaluated first (current state)
 * - Later stages are conditional on earlier decisions
 * - Expected value calculations use default_discount_factor^stage for future outcomes
 *
 * Validation:
 * - Missing stage definitions → falls back to single-stage (non-sequential) inference
 * - Invalid stage indices → warning logged, treated as non-sequential
 * - Empty stages[] with is_sequential=true → validation error
 */
export interface SequentialMetadata {
  /** Whether this graph represents a sequential decision problem */
  is_sequential: boolean;
  /** Ordered list of stage definitions */
  stages: StageDefinition[];
  /** Default discount factor for future outcomes (0-1, default: 1.0) */
  default_discount_factor?: number;
}

/**
 * Weight schema version for edge weight interpretation
 * - v1: Legacy bounded weights [-1, +1]
 * - v2: Extended bounded weights [-3, +3] (default)
 * - v3: Unbounded weights (-∞, +∞)
 */
export type WeightSchemaVersion = 'v1' | 'v2' | 'v3';

/**
 * Correlation group for jointly sampled factor nodes
 *
 * ISL integration: Defines groups of factor nodes whose values should be
 * sampled together using a correlation matrix.
 *
 * Phase 3: Model Enhancements - Consume ISL Correlation Groups
 */
export interface CorrelationGroup {
  /** Unique identifier for the correlation group */
  group_id: string;
  /** Node IDs of factors in this correlation group */
  node_ids: string[];
  /**
   * Correlation matrix (row-major, symmetric, positive semi-definite)
   * Size: n × n where n = node_ids.length
   * Diagonal elements should be 1.0
   */
  correlation_matrix: number[][];
  /** Optional label for display */
  label?: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Metadata for sequential/multi-stage decision graphs (Phase 4) */
  sequential_metadata?: SequentialMetadata;
  /** Weight schema version for edge weight interpretation (Phase 2, Task 2.1) */
  weight_schema_version?: WeightSchemaVersion;
  /** Edge schema version for dual beliefs (Phase 1, EdgeV2) */
  edge_schema_version?: EdgeSchemaVersion;
  /** Correlation groups for jointly sampling factor nodes (Phase 3, ISL integration) */
  correlation_groups?: CorrelationGroup[];
}
