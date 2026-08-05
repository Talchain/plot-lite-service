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

// S5 (lane L45): the VOI family's row type comes from the SHARED contract, not
// from a PLoT-local restatement. `@talchain/schemas` 0.31.0 owns this shape and
// the egress guard validates against the same schema at runtime, so importing
// the type is agreement with the contract rather than an invented one.
import type { EnrichmentFactorEvppiEntry } from '@talchain/schemas/boundary';

// Import CEE types for factor enrichments
import type { FactorEnrichment } from '../cee/types.js';
import type { RangeSource } from '../lib/intervention-normaliser.js';
import type { M1Coaching } from '../coaching/types.js';
import type { M1Review } from '../cee/validation/m1-review-types.js';
import type { ReviewStatus, ReviewSkipReason } from '../cee/validation/m1-review-constants.js';
import type { DenormalisedFlipThreshold } from '../lib/flip-threshold-denormaliser.js';
import type { DriverOrderV1 } from '../lib/driver-order.js';
import type { DecisionBriefV1 } from './decision-brief.js';
import type { ISLFlipStabilityBandV2, ISLPathDecompositionV2 } from '../integrations/isl/types/isl-types.js';

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
  epsilon_std?: number | null;
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
    /**
     * ROADMAP 2.520 S1 — value PROVENANCE, carried from CEE to the engine.
     *
     * `source` carries an upstream CLAIM about where this number came from
     * (e.g. `'user_set'`, a brief extraction, a model inference) and
     * `extractionType` a claim about how it was obtained. ISL declares both on
     * its `ObservedState` and echoes them back on `FactorSensitivityV2` as
     * `value_source` / `value_extraction_type`.
     *
     * ⚠ THESE ARE UNVALIDATED FREE-TEXT STRINGS, NOT AN ATTESTATION — say so
     * here, because the tempting one-line gloss ("`source` says a human set
     * this value") is false and would be read as a guarantee by whoever wires
     * the next slice. PLoT copies the value VERBATIM: no enum, no schema
     * membership check, no server-side re-derivation, and — since PLoT does not
     * Zod-parse the incoming graph at all — no place where one could happen
     * today. `string` (not a union) is deliberate and matches ISL's own
     * `Optional[str]`.
     *
     * So a `user_*` value reaching the engine means THE FIELD ARRIVED. It does
     * not mean a human set the number, and nothing on this path can tell a
     * genuine stamp from a forged one. Forgeability upstream is ROADMAP 2.525;
     * any slice that makes provenance WEIGH in the maths depends on it, and
     * must not treat this field as trusted until it is closed.
     *
     * Declared here because PLoT's normaliser must be ABLE to carry what CEE
     * sends: until 2.520 these were absent from this type, so the ingress copy
     * could not name them and dropped every such claim on the floor.
     */
    source?: string;
    extractionType?: string;
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
    epsilon_std?: number | null;
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

  // Directionality (3A-trust)
  /** 'directed' (default) = A→B causal edge. 'bidirected' = A↔B unmeasured confounding. */
  edge_type?: 'directed' | 'bidirected';
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
  /** Per-node stochastic noise parameter for ISL simulation */
  epsilon_std?: number;
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
    /**
     * ROADMAP 2.520 S1 — value provenance (see `UpstreamNode.observed_state`).
     *
     * ⚠ THIS TYPE IS LOAD-BEARING FOR THE WHOLE PATH, in a way the egress side
     * cannot see. `ISL_DECLARED_OBSERVED_STATE_FIELDS` promises to forward ten
     * fields to ISL, but it can only ever forward what the CANONICAL graph is
     * able to carry — so a field declared there and missing HERE is forwarded in
     * name only, silently, for every request. That is exactly how `source` and
     * `extractionType` were lost. A compile-time union pin in `translator-v3.ts`
     * now forbids that divergence in both directions.
     */
    source?: string;
    extractionType?: string;
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
  /** Edge directionality. 'directed' (default) = A→B causal edge. 'bidirected' = A↔B unmeasured confounding. */
  edge_type?: 'directed' | 'bidirected';
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
 * PLoT-internal metadata carried on constraint objects through the pipeline.
 * Survives all PLoT transforms (filter, validation, merge) but is stripped
 * at wire boundaries (ISL translator). Not part of the GoalConstraint schema.
 */
export interface InternalMetadata {
  /** How this constraint was created: auto-generated, from request, or from model */
  source?: 'auto_from_goal_threshold' | 'request' | 'model';
}

/**
 * Raw goal constraint as received from CEE.
 * May carry CEE-specific fields that are not forwarded to ISL.
 * The temporal constraint filter uses deadline_metadata/unit to detect
 * non-evaluable constraints; the remaining fields are preserved for
 * diagnostics and audit trails.
 */
export interface RawGoalConstraint extends GoalConstraint {
  /** CEE deadline metadata — presence indicates a temporal constraint */
  deadline_metadata?: Record<string, unknown>;
  /** Unit of the constraint value (e.g., "months", "days", "%", "currency") */
  unit?: string;
  /** Original brief text that produced this constraint */
  source_quote?: string;
  /** CEE confidence in the extraction (0–1) */
  confidence?: number;
  /** How the constraint was derived: "explicit", "inferred", etc. */
  provenance?: string;
}

/**
 * Record of a constraint that was filtered (not forwarded to ISL).
 * Stored in _meta.filtered_constraints[] for observability.
 */
export interface FilteredConstraintRecord {
  constraint_id: string;
  node_id: string;
  reason: string;
}

/**
 * Result for a single constraint evaluation.
 */
/**
 * Producer-owned trust marker for a single constraint's threshold scale
 * (A3, ruling A3-DOCTRINE-DECISIONS-2026-07-21 D-2/D-5). Discloses HOW the
 * threshold's [0,1] normalisation range was resolved so a downstream consumer
 * can gate on trust rather than PLoT hiding results. Additive; absence of the
 * whole marker is fail-closed by contract.
 *
 * FIELD NAMES/SHAPES ARE FROZEN CROSS-LANE — do not rename.
 */
export interface ConstraintScaleProvenance {
  /**
   * The range source actually used for this constraint's threshold — one of the
   * `NormalisationRange.source` vocabulary strings (`inferred_spread`,
   * `goal_threshold_cap`, `unit_percent`, `explicit_cap`, `explicit`,
   * `inferred_value`, `default`, …). `'default'` also denotes a forwarded-raw
   * constraint that underwent no normalisation (already in [0,1], no diagnostic).
   */
  source: RangeSource;
  /**
   * True when the threshold's range is the SAME scale as the range this node's
   * interventions used or would use — TRUE for a shared intervention scale AND for
   * never-intervened nodes resolving through the same chain. FALSE precisely when
   * the resolution DIVERGED: a producer-declared cap/'%' on the node was overridden
   * by a MEASURED intervention spread ON A NUMERICALLY DIFFERENT SCALE (ruling D-2
   * disclosing itself). Equal bounds are the same scale — an intervention spread
   * `[0,cap]` matching a producer cap `[0,cap]` is unified, not diverged (A3 R1
   * false-divergence fix).
   */
  range_unified: boolean;
  /**
   * Present ONLY when the threshold itself clamped onto [0,1] during
   * normalisation ('low' = clamped at the range floor, 'high' = at the ceiling).
   * Sourced from the #239 F2a threshold-clamp map. Absent ⇒ the threshold sat
   * inside the range.
   */
  threshold_clamped?: 'low' | 'high';
  /**
   * Producer-owned trust marker. See `DECISION_GRADE_SOURCES` +
   * `buildConstraintScaleProvenance` in `routes/v2/run.ts` for the authoritative
   * derivation (whitelist form; the OR-disjunct was removed in the F-A1
   * amendment). Conservative / fail-closed (ruling D-5). This is a marker only;
   * no new suppression rides on it.
   */
  decision_grade: boolean;
}

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
  /**
   * F5 disclosure (ruling D-4): the id of the option this top-level constraint
   * result was DERIVED FROM. The top-level constraint block reuses the FIRST
   * option carrying a non-empty constraint_analysis as its canonical source
   * (probability = that option's prob_satisfied), which was previously silent.
   * Additive, honest, non-breaking — names the first-option derivation rather
   * than restructuring it. Same value across every entry in one response.
   */
  option_id?: string;
  /**
   * Producer-owned trust marker for this constraint's threshold scale (A3). See
   * ConstraintScaleProvenance. Additive; present for every active constraint.
   */
  scale_provenance?: ConstraintScaleProvenance;
}

/**
 * Diagnostic information for constraint analysis.
 */
export interface ConstraintDiagnostic {
  /** Constraint ID */
  constraint_id: string;
  /**
   * Median failure margin (how far failures miss the threshold).
   * OPTIONAL: omitted (never fabricated as 0) when ISL did not compute it —
   * a satisfying constraint carries no margin. Absent ≠ zero.
   */
  failure_margin_median?: number;
  /**
   * Fraction of failures within 10% of threshold (near misses).
   * OPTIONAL for the same reason as failure_margin_median — absent ≠ zero.
   */
  near_miss_fraction?: number;
  /** Whether this constraint is the primary limiter of joint probability */
  binding: boolean;
}

/**
 * Per-option, per-constraint graded breach margin (additive, PoC plumbing).
 * Carries ISL's per-option failure_margin_median / near_miss_fraction to
 * egress so breaching options are ORDERABLE by how far over they are.
 * Absent margin fields are OMITTED (missing ≠ zero); `margin_precision`
 * flags when the denormalised magnitude is a lower bound because the
 * option's intervention saturated (clamped) its normalisation range.
 */
export interface ConstraintMargin {
  /** Constraint ID (resolved by ISL response ordinal → input constraint_id). */
  constraint_id: string;
  /**
   * Median failure margin in USER UNITS (denormalised by the constraint's
   * range width). Omitted when ISL sent none for this option.
   */
  failure_margin_median?: number;
  /** Fraction of failures within 10% of threshold. Omitted when absent or outside [0,1]. */
  near_miss_fraction?: number;
  /**
   * Precision of failure_margin_median (Codex F1 semantics). Only present
   * when failure_margin_median is present, and only when the recorded
   * normalisation diagnostics SUPPORT the claim:
   * - 'lower_bound': the option's intervention on the constraint's target
   *   factor clamped in the operator-COMPATIBLE direction (high-clamp with a
   *   '<=' constraint, or low-clamp with a '>='), so the reported magnitude
   *   understates the true breach.
   * - 'exact': the option carries a normalisation diagnostic for the target
   *   factor and it did NOT clamp.
   * - OMITTED: the clamp direction is incompatible with the operator (a
   *   clamp that says nothing about this breach), or the target factor has
   *   no diagnostic at all (clamp state unknown — e.g. the constraint
   *   targets a node no option intervenes on). Absence is honest "no
   *   precision claim", never an implicit 'exact'.
   */
  margin_precision?: 'exact' | 'lower_bound';
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
 * A single client-supplied pairwise factor correlation (capability #100).
 *
 * Activates ISL's correlated-factors sampling for the named pair (Gaussian
 * copula over factor marginals — doctrine D-23.4). Independence stays the
 * DEFAULT; correlation is inert unless supplied (no invented rho).
 *
 * PLoT applies LIGHT STRUCTURAL validation only (shape: two factor ids + a
 * numeric rho) and forwards verbatim. DEEP SEMANTIC validation is ISL's
 * single source of truth — unknown-factor / |rho|>1 / self-pair / duplicate
 * are rejected ISL-side with a 422 that surfaces through PLoT unchanged.
 */
export interface FactorCorrelation {
  /** Node id of the first factor in the correlated pair. */
  factor_a: string;
  /** Node id of the second factor in the correlated pair. */
  factor_b: string;
  /** Pairwise correlation coefficient. Range/PSD validity is enforced ISL-side. */
  rho: number;
}

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

  /**
   * When true, PLoT calls ISL's threshold analysis endpoint after the main
   * robustness analysis completes. Budget-aware: skipped if insufficient
   * remaining request budget. Default: false.
   */
  include_thresholds?: boolean;

  /**
   * Accepted from upstream callers. PLoT always sends include_e_values: true
   * and include_voi: true to ISL regardless of these flags — they are
   * unconditionally enabled in the translator to ensure E-value and EVPI
   * analysis is always available in the response.
   */
  include_e_values?: boolean;
  include_voi?: boolean;

  /**
   * When true, PLoT forwards include_path_decomposition to ISL and passes
   * the resulting `path_decomposition` envelope section through additively
   * (lane PLoT-W4; ISL build 9a22a1a+). REQUEST-GATED OPT-IN — unlike
   * include_e_values/include_voi this flag is NOT defaulted on, so there is
   * no default payload growth on either boundary. Default: false.
   */
  include_path_decomposition?: boolean;

  /**
   * Client-supplied pairwise factor correlations (capability #100, doctrine
   * D-23.4). When present and non-empty, PLoT forwards them verbatim into the
   * ISL robustness request, activating correlated-factors sampling. INERT WHEN
   * ABSENT — independence stays the default and no correlation is invented.
   * PLoT does LIGHT STRUCTURAL validation only; ISL owns deep semantics
   * (unknown-factor / |rho|>1 / self-pair / duplicate → 422, surfaced through
   * PLoT). Request-gated: the ISL payload does not grow for callers who omit it.
   */
  factor_correlations?: FactorCorrelation[];
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
 * The array is the single source of truth; the union type is derived from it.
 */
export const BLOCKER_CODES = [
  'MISSING_GOAL_NODE',
  'GOAL_NODE_NOT_IN_GRAPH',   // Canonical code for goal node validation
  'GOAL_NODE_NOT_CAUSAL',     // Goal is a non-causal node (option/decision)
  'NO_OPTIONS',
  'TOO_MANY_OPTIONS',         // Options exceed MAX_OPTIONS limit
  'EMPTY_INTERVENTIONS',
  'INVALID_INTERVENTION_TARGET',
  'INVALID_INTERVENTION_VALUE',
  'NO_PATH_TO_GOAL',
  // Constraint validation blockers
  'CONSTRAINT_TARGET_NOT_FOUND',        // node_id not in graph.nodes
  'CONSTRAINT_TARGET_NOT_IN_INFERENCE',  // Target node kind is decision, option, or constraint
  'CONSTRAINT_INVALID_OPERATOR',        // Operator not >= or <=
  'CONSTRAINT_DUPLICATE_ID',            // Two constraints share the same constraint_id
  'IDENTICAL_OPTIONS',
  'INVALID_NODE_ID_PATTERN',
  'INVALID_EDGE_ENDPOINT',
  'DUPLICATE_NODE_IDS',
  'GRAPH_TOO_LARGE',
  'IDENTIFIABILITY_ISSUE',
  'GRAPH_CYCLE_DETECTED',
  'ISL_CANNOT_IDENTIFY',
  // Categorical integrity blockers (audit C1-A; see categorical-detector.ts)
  'NOMINAL_INTERVENTION_NOT_SUPPORTED',  // unordered categorical factor cannot be encoded as a single numeric scale
  'ONE_HOT_MUTEX_VIOLATION',             // explicitly grouped one-hot indicators violate "exactly one set to 1"
  'ONE_HOT_GROUPING_INCONSISTENT',       // categorical_group_id metadata is conflicting or partial across options
] as const;

export type BlockerCode = (typeof BLOCKER_CODES)[number];

/**
 * WARNING critique codes for constraint validation.
 * These do not block analysis but indicate potential issues.
 * The array is the single source of truth; the union type is derived from it.
 */
export const CONSTRAINT_WARNING_CODES = [
  'CONSTRAINT_VALUE_OUTSIDE_RANGE',        // Value outside derivable state_space.range for target node
  'CONSTRAINT_MISSING_RANGE',              // Target node has no derivable range (heuristic fallback needed)
  'CONSTRAINT_DUPLICATE_TARGET',           // Two constraints target same node with same operator (after dedupe)
  'CONSTRAINT_TARGET_NO_OBSERVED_VALUE',   // Factor node targeted by constraint has no observed_state.value
] as const;

export type ConstraintWarningCode = (typeof CONSTRAINT_WARNING_CODES)[number];

/**
 * Critique codes emitted inline in v2/run.ts and preflight-v2.ts
 * (not covered by BlockerCode or ConstraintWarningCode).
 * Used by template-coverage tests to detect drift.
 */
export const INLINE_CRITIQUE_CODES = [
  // v2/run.ts
  'NORMALIZATION_ERROR',
  'NORMALIZATION_WARNING',
  'IDENTIFIABILITY_WARNING',
  'UNMEASURED_CONFOUNDING_WARNING',
  'TOO_MANY_CONSTRAINTS',         // goal_constraints.length > MAX_CONSTRAINTS (P.8 DoS guard)
  'INVALID_CONSTRAINT_SHAPE',     // ingress-shape guard: id/node_id trimmed non-empty, operator >=|<=, value finite (Codex F4)
  'ISL_NOT_ENABLED',
  'CONSTRAINT_OUT_OF_DOMAIN',
  'CONSTRAINT_FILTERED_TEMPORAL',
  'ISL_REQUEST_INVALID',
  'ISL_CALL_FAILED',
  'ISL_EMPTY_RESULTS',
  'ISL_ERROR',
  // Typed failure envelope (fragility pair 2026-07-10): discriminating ISL
  // failure classes + typed internal-exception critique.
  'ISL_TIMEOUT',                      // ISL request timed out
  'ISL_NETWORK_ERROR',                // ISL unreachable
  'ISL_REJECTED',                     // ISL HTTP 422 (with critiques → 422 blocked; without → failed)
  'PLOT_INTERNAL_ERROR',              // outermost /v2/run catch — never an empty critiques[]
  // Registered late (both already emitted via buildBlockedResponse):
  'GRAPH_TOO_COMPLEX',                // complexity refusal at the ISL cap (ROADMAP 1.54)
  'DUPLICATE_EDGE_CONFLICT',          // same-relationship edges with divergent values
  'MIXED_RANGE_DERIVATION',           // factors use 2+ different derivation tiers
  // preflight-v2.ts
  'SCALE_MISMATCH_WARNING',
  'INVALID_BIDIRECTED_EDGE',
  'IDENTICAL_OPTIONS_DEDUPED',
  'INBOUND_STRENGTH_SUM_EXCEEDED',    // inbound |strength.mean| sum > 1.0
  // critique-builder.ts advisories (IMPROVEMENT severity — never blocks)
  'GRAPH_DENSE',
  // Categorical integrity (audit C1-A; see categorical-detector.ts)
  'CATEGORICAL_DECOMPOSED',           // info: a one-hot indicator group was validated as safe
  'STRIPPED_FIELD_WARNING',           // warning: scientifically-meaningful field was stripped on a passed-through factor
] as const;

export type InlineCritiqueCode = (typeof INLINE_CRITIQUE_CODES)[number];

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
  /** Internal/debug message — not for UI display */
  message: string;
  /** Human-readable message for UI display — no internal IDs or field paths */
  user_message?: string;
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
 * Threshold analysis status.
 * Separate vocabulary from PerFeatureStatus to capture budget/timeout semantics.
 */
export type ThresholdsStatus =
  | 'not_requested'    // include_thresholds absent or false
  | 'skipped_budget'   // insufficient remaining budget
  | 'timeout'          // ISL threshold call timed out
  | 'error'            // ISL threshold call failed
  | 'computed';        // success

/**
 * Per-pair identifiability status (B1.5 / B1.5a contracted interface).
 */
export type IdentifiabilityPairStatus =
  | 'identifiable'
  | 'not_backdoor_identifiable'
  | 'unknown';

/**
 * Detail for a single (treatment, outcome) identifiability pair.
 * Contracted interface for UI / schema v2.9 consumption.
 */
export interface IdentifiabilityPairDetail {
  /** Intervention node ID (treatment) */
  treatment_node_id: string;
  /** Goal node ID (outcome) */
  outcome_node_id: string;
  /** Per-pair identifiability status */
  status: IdentifiabilityPairStatus;
  /** Common ancestors that create backdoor paths (sorted alphabetically) */
  confounders?: string[];
  /** Variables to condition on to block backdoor paths (sorted alphabetically) */
  adjustment_set?: string[];
}

/**
 * Top-level identifiability status (B1.5a contracted interface).
 */
export type IdentifiabilityStatus =
  | 'identifiable'
  | 'partially_identifiable'
  | 'not_backdoor_identifiable'
  | 'unknown';

/**
 * Causal identifiability assessment for the V2 pipeline (B1.5 / B1.5a).
 * Contracted interface for UI / schema v2.9 / debug panel consumption.
 */
export interface IdentifiabilityAssessment {
  /** Aggregate status across all pairs */
  status: IdentifiabilityStatus;
  /** Method used for identifiability check */
  method: 'backdoor';
  /** Number of (treatment, outcome) pairs assessed */
  pairs_checked: number;
  /** Number of pairs that ARE identifiable */
  pairs_identifiable: number;
  /** Per-pair details. Present only when at least one pair is not identifiable. */
  details?: IdentifiabilityPairDetail[];
  /** True when details array was truncated (capped at 20) */
  details_truncated?: boolean;
}

/**
 * A single threshold crossing where factor change causes recommendation flip.
 */
export interface ThresholdResult {
  /** Factor node ID */
  factor_id: string;
  /** Human-readable factor label (fallback: factor_id) */
  factor_label: string;
  /** Factor value at which recommendation changes */
  threshold_value: number;
  /** Current observed value (undefined if no observed_state) */
  current_value?: number;
  /** Direction relative to current value: factor must go above/below threshold */
  crossing_direction: 'above' | 'below';
  /** Options affected by this threshold crossing */
  affected_options: Array<{
    option_id: string;
    option_label: string;
    /** True if this option becomes the winner when threshold is crossed */
    becomes_winner: boolean;
  }>;
  /** Absolute distance from current_value to threshold_value (omitted when current_value missing) */
  margin?: number;
}

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
 * V2 Run Error response - returned for blocked (HTTP 422) and failed responses.
 * NOT wrapped in error.v1 envelope.
 * V3 Platform Contract v3.4.2a: ResponseMetaMinimal included for all error shapes.
 */
export interface V2RunError {
  /** 'blocked' for 422 preflight failures; 'failed' for ISL/internal failures */
  analysis_status: 'blocked' | 'failed';
  /** Reason for blocking or failure */
  status_reason: string;
  /** Structured critiques explaining the block */
  critiques: CritiqueV3[];
  /** CIL 0.2: Robustness with empty arrays maintained on blocked responses */
  robustness: RobustnessAssessmentV3;
  /** V3 Platform Contract v3.4.2a: Whether the client should retry */
  retryable: boolean;
  /** V3 Platform Contract v3.4.2a: ResponseMetaMinimal */
  meta: {
    request_id: string;
    computed_at: string;
  };
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
   * True when the run produced USABLE results that are degraded/rough —
   * analysis_status === 'partial' (options usable, some secondary feature
   * degraded). Single-sourced from analysis_status (derive-don't-mirror); NOT
   * a hand-maintained second flag. Named `approximate` to avoid colliding with
   * the CEE-trace `degraded` semantic. Deliberately FALSE for 'failed'/'blocked'
   * (no usable answer) — an 'approximate results' signal must not cover them.
   */
  approximate?: boolean;

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
   * Whether ISL applied auto-noise to outcome/risk distributions on this run
   * (`auto_scaled_noise` heuristic at `robustness_analyzer_v2.py:1113`).
   *
   * Present on `analysis_status` ∈ {'computed', 'partial'}; absent on
   * 'blocked' / 'failed'. `null` when ISL omitted the field. See
   * `auto_noise_provenance` for the structured disclosure metadata.
   *
   * @see truth-table row B3 (P0 disclosure).
   */
  auto_noise_applied?: boolean | null;

  /**
   * Auto-noise disclosure metadata (audit B3). Always carries full formula
   * provenance, including when `applied: false`. Absent on 'blocked' /
   * 'failed' analysis states. UI surfaces only `applied && is_provisional`.
   *
   * @see AutoNoiseProvenance JSDoc.
   */
  auto_noise_provenance?: AutoNoiseProvenance;

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
   *
   * Populated from the nested V2 wire location `robustness.edge_sensitivity`
   * (ISL build 9a22a1a+, lane PLoT-W4). Empty on older deployed ISL builds —
   * then explicitly marked via the EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE
   * inference warning (populated OR marked, never both absent on a computed
   * analysis).
   */
  edge_sensitivity: EdgeSensitivityResultV3[];

  /**
   * Reference-option disclosure (additive, lane PLoT-W4; ISL build
   * 9a22a1a+): the option ID that edge sensitivity, factor sensitivity, and
   * the fragile-edge classification were computed against (ISL currently
   * uses the first option in the request). Passed through verbatim from the
   * ISL envelope's `sensitivity_reference_option_id`. Absent when the
   * deployed ISL did not disclose it (older builds) or no sensitivity was
   * computed. Disclosure only — consumers should surface that sensitivity
   * results are relative to this option instead of inventing a baseline.
   * NOT in response_hash (response_hash canonicalises the request).
   */
  sensitivity_reference_option_id?: string;

  /**
   * Structural pathway decomposition (additive, lane PLoT-W4; ISL build
   * 9a22a1a+). Request-gated: present ONLY when the /v2/run request set
   * `include_path_decomposition: true` (PLoT forwards the flag to ISL; ISL
   * emits the section only when requested). Passed through verbatim —
   * structural path effects are dimensionless edge-coefficient products, so
   * no outcome-space denormalisation applies. `mechanism` wording is
   * ISL-owned and provisional (provisional_doctrine_v0).
   * NOT in response_hash.
   */
  path_decomposition?: ISLPathDecompositionV2;

  /**
   * Correlated-factors capability outputs (capability #100 + VOI slices
   * D-23.8), passed through VERBATIM from the ISL top-level envelope when
   * present (additive, omit-when-absent). PLoT does the raw passthrough only —
   * "PLoT passthrough-forwards meanwhile" (D-23.4); the richer outcome-unit
   * reconciliation + method-tagging to the UI is a separate gated lane
   * (D-23.8 S5) and firm wire typing rides the @talchain/schemas batch.
   * NOT in response_hash (response_hash canonicalises the request; these are
   * computed enrichment).
   *
   * ⭐ S5 (lane L45) — EACH FIELD IS TYPED EXACTLY AS THE SHARED CONTRACT TYPES
   * IT, AND NO TIGHTER. `@talchain/schemas` 0.31.0 adopted this family
   * (`AnalysisEnrichmentSchema`), so the shape is no longer PLoT's to guess:
   * mirroring the contract here is the opposite of inventing one. Two of the
   * four stay `unknown` because the CONTRACT types them open — `p_win_sensitivity`
   * as `z.array(z.record(z.string(), z.unknown()))` and `correlation_model` as
   * `z.object({}).passthrough()` — and claiming more than the contract does is
   * how a type becomes a promise nothing checks.
   *
   * ⚠ THE TYPES ARE BACKED BY A RUNTIME CHECK, WHICH IS WHY THEY ARE SAFE TO
   * NARROW. These values are forwarded VERBATIM (`islEnrichmentPassthrough`) —
   * a declared type alone would assert a shape nothing validates. The egress
   * guard parses the outgoing body against the SAME schema, and
   * `tests/gates/voi-family-wire-conformance.test.ts` pins that its verdict is
   * `true` on the real `/v2/run` route, WITH a positive control proving the
   * verdict can still say no. Before that pin existed, the repo's own
   * passthrough fixture carried `decision_evpi` as an OBJECT: the contract
   * rejected it, the guard said so inside the same response, and every test was
   * green. Narrow the types only as far as something executes.
   */
  /**
   * Correlation model disclosure (Gaussian copula, PSD/tail-independence status).
   * OPEN by contract. Also THE DISCRIMINATOR for an absent `p_win_sensitivity`:
   * `suppressed_attributions` naming it means suppressed-under-correlation, not
   * never-computed.
   */
  correlation_model?: unknown;
  /**
   * Decision-EVPI on the joint samples (E[max]−max E), OUTCOME units.
   *
   * ⚠ ABSENT ≠ 0. Key-absent means NOT COMPUTED; a `0` is a real measurement
   * ("nothing about this decision is worth learning"). The wire carries no
   * discriminator beyond key presence, so `?? 0` at any consumer converts one
   * into the other. `number | null` mirrors the contract exactly — `null` is
   * admitted because the contract admits it, not because PLoT emits it.
   */
  decision_evpi?: number | null;
  /**
   * Per-factor Strong-Oakley EVPPI (outcome-unit value of perfect partial
   * information), rows sorted by `evppi` DESCENDING by the producer — that
   * ORDER is the contract, and a consumer renders it verbatim.
   *
   * ⚠ A factor ABSENT from a present array was NOT ASSESSED (a lever an option
   * intervenes on, or a row whose estimator failed — disclosed as
   * `FACTOR_EVPPI_PARTIAL`). Absent is never zero and must not be imputed.
   */
  factor_evppi?: EnrichmentFactorEvppiEntry[] | null;
  /**
   * Per-factor win-probability sensitivity (honestly-named successor to
   * factor_evpi). OPEN by contract — ISL declares `List[dict]`.
   *
   * ABSENT UNDER ACTIVE CORRELATION BY DESIGN: ISL suppresses it and names it in
   * `correlation_model.suppressed_attributions`, so absence here is a
   * suppression VERDICT. It is also the only VOI quantity in CHANCE units
   * (`current_metric` → `perfect_metric`); a consumer may not render those
   * members until the contract types the row.
   */
  p_win_sensitivity?: unknown;

  /** Factor sensitivity results (if available) */
  factor_sensitivity?: FactorSensitivityResultV3[];

  /**
   * ⭐ THE canonical driver ordering + its attestation (family 4, slice S1).
   *
   * PLoT owns EXACTLY ONE ordering over the factor set and attests how it was
   * made — basis, lever policy, row species, separability, rank stability. See
   * `src/lib/driver-order.ts` for the ordering rule stated at the bytes.
   *
   * `ranked_factor_ids` is parallel to `factor_sensitivity[]`: the array IS the
   * order. Emitted whenever `factor_sensitivity` is emitted, including when the
   * array is empty (`basis: 'none'`) — present-empty and absent are different
   * claims, and a consumer must fail closed on absence.
   *
   * ⚠ ADDITIVE. Emitted ALONGSIDE the existing crown/rank surfaces
   * (`driver_label`, `dominant_factor`, `m1_coaching.key_drivers[].rank`,
   * `decision_brief.top_drivers[0]`, the facts-path `importance_rank`), none of
   * which changed in this slice and three of which still disagree with it.
   *
   * NOTE: Deterministic producer enrichment. `response_hash` canonicalises the
   * REQUEST (`hashRequest`), so this field does not enter it.
   */
  driver_order?: DriverOrderV1;

  /**
   * ISL stability assessment per factor.
   * Populated from ISL's 3C bootstrap analysis — independent of factor_sensitivity source.
   * Empty array when ISL does not provide stability data.
   *
   * NOTE: Deterministic ISL output. Excluded from response_hash since v6
   * (was included in v5; removed because ISL bootstrap internals can change).
   */
  factor_stability?: FactorStabilityEntry[];

  /**
   * ISL stability threshold configuration (boundaries for attribution_stability categories).
   * Present only when ISL provides bootstrap stability analysis.
   *
   * NOTE: Configuration metadata, NOT included in response_hash.
   * The categorical labels it influences (attribution_stability in factor_stability)
   * are already captured in the hash.
   */
  stability_thresholds?: StabilityThresholds;

  /**
   * Edge E-values measuring evidence strength for each edge's causal direction.
   * Enriched with human-readable labels from graph nodes.
   * Present when ISL provides E-value analysis. Excluded from response_hash.
   */
  edge_e_values?: EnrichedEdgeEValue[];

  /**
   * Conditional winner analysis per factor.
   * Shows how the winning option changes conditional on factor value buckets.
   * Enriched with labels from graph nodes and options.
   * Present when ISL provides conditional winner analysis. Excluded from response_hash.
   */
  conditional_winners?: ConditionalWinner[];

  /**
   * Diagnostic warnings about inference metadata inconsistencies.
   * Info-level only — never blocks the response.
   * NOT included in response_hash (diagnostic metadata).
   *
   * Sentinel contract: ALWAYS present as [] (never absent).
   * Consumers can distinguish "not assessed" (field absent on old builds)
   * from "assessed, none found" (empty array).
   */
  inference_warnings: InferenceWarning[];

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
   * Confidence tier derived from M1 coaching readiness (B1).
   * Maps readiness to UI-facing vocabulary:
   *   ready → 'strong', close_call → 'fair',
   *   needs_evidence | needs_framing → 'needs_work'.
   * Absent when M1 coaching is unavailable.
   *
   * NOTE: Deterministic. Excluded from response_hash (derived from coaching).
   */
  confidence_tier?: 'strong' | 'fair' | 'needs_work';

  /**
   * Dominant factor detection (B1).
   * Present when one factor has disproportionate influence (>50% influence AND >2:1 ratio
   * vs. second factor). Absent when no dominance detected or factor sensitivity unavailable.
   *
   * NOTE: Deterministic. Excluded from response_hash.
   */
  dominant_factor?: {
    factor_id: string;
    factor_label: string;
  };

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

  /**
   * High-level classification of `flip_thresholds[]`, computed at the
   * post-denormalised response-assembly boundary so consumers can render
   * the all-no-effect / partial / unresolved cases honestly without
   * re-deriving the picture from individual `flip_reason` strings.
   *
   * - 'computed'         : every entry has a flip_value (or only computed +
   *                        unresolved entries — actionable insight present)
   * - 'all_no_effect'    : every entry is no_effect_within_bounds
   * - 'partial_no_effect': mix of computed and no_effect_within_bounds
   * - 'unresolved'       : no entry has a flip_value, and at least one entry
   *                        is timeout/error/insufficient_precision/etc.
   * - 'unavailable'      : flip_thresholds[] empty or absent
   *
   * NOTE: Deterministic. Excluded from response_hash as non-semantic.
   * @see classifyFlipThresholdsStatus in src/lib/flip-threshold-status.ts
   */
  flip_thresholds_status?:
    | 'computed'
    | 'all_no_effect'
    | 'partial_no_effect'
    | 'unresolved'
    | 'unavailable';

  /**
   * First-seen unresolved `flip_reason` string (e.g. `timeout`, `error`,
   * `insufficient_precision`).
   *
   * Emitted in TWO cases:
   *  - `flip_thresholds_status === 'unresolved'` — no computed flip and
   *    at least one unresolved entry. `no_effect_within_bounds` entries
   *    may also be present in this case (a pure mix of no_effect +
   *    unresolved still classifies as `'unresolved'` because the
   *    unresolved signal is the actionable one).
   *  - `flip_thresholds_status === 'partial_no_effect'` AND at least one
   *    unresolved entry is present alongside computed + no_effect ones.
   *    Lets UI consumers soften copy that would otherwise imply every
   *    non-computed factor was a harmless no_effect_within_bounds case.
   *
   * Payload-only debug metadata; never user-facing copy.
   * @see classifyFlipThresholdsStatus in src/lib/flip-threshold-status.ts
   */
  flip_thresholds_status_reason?: string;

  /**
   * Aggregate margin-sensitivity classification across `flip_thresholds[]`.
   * Additive diagnostic, separate from `flip_thresholds_status`.
   *
   * - 'computed'         : at least one entry has movement ∈
   *                        {flipped, weakened, strengthened}
   * - 'partial_movement' : at least one entry has movement, at least one
   *                        entry has movement === 'none'
   * - 'all_none'         : every entry that carries margin_sensitivity has
   *                        movement === 'none'
   * - 'unavailable'      : no entry carries margin_sensitivity (or array
   *                        empty/absent)
   *
   * Entries missing `margin_sensitivity` do NOT count toward `all_none`;
   * they are excluded from classification.
   *
   * NOTE: Deterministic. Excluded from `response_hash` as non-semantic.
   * @see classifyFlipThresholdsMarginStatus in src/lib/flip-thresholds-margin-status.ts
   */
  flip_thresholds_margin_status?:
    | 'computed'
    | 'partial_movement'
    | 'all_none'
    | 'unavailable';

  /**
   * Per-array coverage counters for margin-sensitivity. Honest counter so
   * downstream consumers can tell when only a subset of flip-threshold
   * entries carry margin evidence.
   *
   *  - total          : total entries in `flip_thresholds[]`
   *  - with_margin    : entries that carry `margin_sensitivity`
   *  - without_margin : total - with_margin
   *
   * Excluded from `response_hash`. Additive diagnostic.
   */
  flip_thresholds_margin_coverage?: {
    total: number;
    with_margin: number;
    without_margin: number;
  };

  // ---------------------------------------------------------------------------
  // Threshold Analysis Fields (B10.3)
  // Only present when include_thresholds is true in request
  // ---------------------------------------------------------------------------

  /**
   * Threshold analysis status.
   * - 'not_requested': include_thresholds absent or false
   * - 'skipped_budget': insufficient remaining budget after main ISL call
   * - 'timeout': ISL threshold call timed out
   * - 'error': ISL threshold call failed
   * - 'computed': success
   *
   * NOTE: Never affects analysis_status (non-blocking).
   */
  thresholds_status?: ThresholdsStatus;

  /** Threshold analysis metadata for observability */
  thresholds_meta?: { reason?: string; duration_ms?: number };

  /**
   * Threshold analysis results from ISL.
   * Each entry describes a factor value at which the recommendation changes.
   * Labels enriched from graph nodes and options with deterministic fallbacks.
   * Sorted by factor_id for stability.
   *
   * NOTE: Excluded from response_hash (non-semantic post-analysis enrichment).
   */
  threshold_analysis?: ThresholdResult[];

  // ---------------------------------------------------------------------------
  // Identifiability Assessment (B1.5)
  // ---------------------------------------------------------------------------

  /**
   * Causal identifiability assessment via backdoor criterion.
   * Always present (uses status='unknown' when check could not run).
   * WARNING only — never blocks analysis.
   *
   * NOTE: Deterministic function of graph structure. Excluded from response_hash since v6
   * (was included in v3–v5; removed because ISL bootstrap internals can change).
   */
  identifiability: IdentifiabilityAssessment;

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

  /** Total request processing time in milliseconds (contract-compliant alias for meta.latency_ms) */
  processing_time_ms?: number;

  /** Determinism hash of canonical request (semantic fields only) */
  response_hash?: string;

  /**
   * Decision Brief assembled from analysis results.
   * Shareable artefact for stakeholders. Null when analysis is blocked or failed.
   *
   * NOTE: Contains non-deterministic fields (brief_id, created_at).
   * Excluded from response_hash by design (hash is computed from request inputs only).
   */
  decision_brief?: DecisionBriefV1 | null;

  /**
   * Review cards assembled from analysis results (evidence priority, etc.).
   * Excluded from response_hash. Required field — always [] when ENABLE_REVIEW_PASS is OFF.
   * Semantics: [] + meta.feature_flags.review_pass === false → feature was off
   *            [] + meta.feature_flags.review_pass === true  → feature ran, nothing to emit
   *            [...] + meta.feature_flags.review_pass === true → cards produced
   *
   * @see src/review-pass/evidence-priority.ts — Evidence Priority card (R.1)
   */
  review_cards: import('../review-pass/types.js').ProposalCardV1[];

  /**
   * Stream D: Structured facts derived from analysis results.
   * Excluded from response_hash. Required field — always [] when ENABLE_FACTS_ASSEMBLY is OFF.
   * UI uses meta.feature_flags.facts_assembly to gate FactCard rendering.
   */
  fact_objects: import('../facts/types.js').FactObjectV1[];

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
    /** End-to-end request ID chain (Brief 4 spec — 6 fields) */
    request_id_chain?: {
      /** Request ID from incoming request (null if auto-generated) */
      ui: string | null;
      /** PLoT's own request ID */
      plot: string | null;
      /** Request ID PLoT sent to ISL (null if ISL not called) */
      isl: string | null;
      /** Request ID ISL echoed back (null if ISL didn't echo) */
      isl_echoed: string | null;
      /** true ONLY when all four are non-null AND identical */
      all_match: boolean;
      /** true ONLY when all four are non-null */
      chain_complete: boolean;
    };
    /**
     * V3 Platform Contract §3.3.6: active feature flags.
     * Configuration metadata — excluded from response_hash.
     * Named booleans (facts_assembly, review_pass) are included for UI consumers.
     */
    feature_flags?: Record<string, string | boolean>;
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
  /**
   * @deprecated V1 legacy — removed from V2 /run response output (P.5).
   * Still present in ISL raw response and V1 endpoints.
   * V2 consumers: use outcome.mean instead.
   */
  expected_outcome?: number;
  /**
   * @deprecated V1 legacy — removed from V2 /run response output (P.5).
   * Still present in ISL raw response and V1 endpoints.
   * V2 consumers: use [outcome.p10, outcome.p90] instead.
   */
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
   * SUPPRESSED (absent) when any constraint target is unreliable
   * (CONSTRAINT_TARGET_UNRELIABLE inference warning present) — the raw
   * computed value would be meaningless and lives in diagnostics logs only.
   * Doctrine B (P0-C2): a target whose ONLY unreliability reason is a
   * defaulted base (no observed value) but whose samples are
   * forward-propagated is DELIVERED with a `goal_fit_basis` annotation
   * instead of suppressed — see src/lib/constraint-reliability.ts.
   */
  probability_of_joint_goal?: number;

  /**
   * Per-constraint probabilities for this option.
   * Map of constraint_id to probability [0, 1].
   * Only present when goal_constraints provided in request.
   * SUPPRESSED (absent) when any constraint target is unreliable
   * (CONSTRAINT_TARGET_UNRELIABLE inference warning present); delivered with
   * `goal_fit_basis` under doctrine B (see probability_of_joint_goal).
   */
  constraint_probabilities?: Record<string, number>;

  /**
   * Provenance annotation for delivered goal-fit probabilities (doctrine B,
   * P0-C2). Present ONLY when probability_of_joint_goal /
   * constraint_probabilities were scored from the target node's
   * forward-propagated Monte Carlo outcome distribution because the node has
   * no observed baseline value (ISL defaulted its base to 0.0). Absent on
   * fully-reliable runs — additive, never fabricated.
   * Accompanied by the info-severity CONSTRAINT_GOALFIT_MODELLED_BASIS
   * inference warning.
   */
  goal_fit_basis?: {
    /** How the delivered probabilities were scored. */
    scored_from: 'modelled_outcome_distribution';
    /** Constraint-target node ids scored this way (sorted, deduplicated). */
    node_ids: string[];
  };

  /**
   * Per-constraint graded breach margins for THIS option (additive plumbing).
   * One entry per constraint ISL evaluated for the option; margin fields are
   * OMITTED (never fabricated as 0) when ISL sent none — so a satisfying
   * option carries a bare entry while a breaching option carries its margin.
   * Only present when goal_constraints provided and delivered (same honesty
   * gate as constraint_probabilities).
   */
  constraint_margins?: ConstraintMargin[];

  /**
   * Producer-owned trust marker (A3): AND over the `decision_grade` of the
   * constraints that ACTUALLY PARTICIPATE for this option (those present in
   * `constraint_probabilities`). Present ONLY when ≥1 constraint participates;
   * an option with zero participating constraints OMITS the field entirely
   * (absence = fail-closed by contract — never a vacuous `true`). A participating
   * constraint whose provenance is missing is treated as non-decision-grade.
   */
  constraints_decision_grade?: boolean;
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
  /** Human-readable source node label (falls back to from if node not found) */
  from_label: string;
  /** Human-readable target node label (falls back to to if node not found) */
  to_label: string;
  /** Type of sensitivity analysis */
  sensitivity_type: 'existence' | 'magnitude';
  /** Elasticity score */
  elasticity: number;
  /** Importance ranking (1 = most important) */
  importance_rank: number;
  /** Human-readable interpretation */
  interpretation: string;
  /** True when normalisation was active but denormalisation ranges were unavailable */
  _normalised?: boolean;
}

/**
 * Enriched edge E-value with human-readable labels.
 * Measures evidence strength for each edge's causal effect direction.
 * Label enrichment follows the same pattern as fragile edge enrichment.
 */
export interface EnrichedEdgeEValue {
  /** Edge identifier. Format: `from::to` (double-colon separator) */
  edge_id: string;
  /** Source node ID */
  from_id: string;
  /** Target node ID */
  to_id: string;
  /** Human-readable source node label (falls back to from_id) */
  from_label: string;
  /** Human-readable target node label (falls back to to_id) */
  to_label: string;
  /** E-value (evidence strength) */
  e_value: number;
  /**
   * Direction the edge would need to flip to change the recommendation.
   * ISL owns this vocabulary and PLoT passes it through verbatim: the live V2
   * wire emits 'increase' | 'decrease' (verified 2026-07-06, build f3f5d92);
   * legacy documented values were 'positive_to_negative' |
   * 'negative_to_positive' | 'removal'. Typed open to match the wire.
   */
  flip_direction: string;
  /** Current mean effect of this edge */
  current_mean: number;
  /** Mean effect at the flip point */
  flip_mean: number;
  /**
   * Seed-sweep flip-threshold stability band, carried VERBATIM from ISL
   * (ISL PR #71; single ISL type, no mirrored shape — trap-12 discipline).
   * DEFAULT-ON since ISL PR #76 — present when ISL computed a band for this
   * entry; the key is absent (never null) when it had nothing to sweep or on
   * older pre-#76 ISL builds.
   * ⚠ band_width is 0.0 BY CONSTRUCTION when n_seeds_flipped == 1 (single
   * flipped seed has zero range) — consumers must condition any width-based
   * confidence rubric on n_seeds_flipped. ⚠ Band values stay in ISL
   * flip-mean space even when the sibling current_mean/flip_mean were
   * denormalised into outcome units — see ISLFlipStabilityBandV2.
   */
  stability?: ISLFlipStabilityBandV2;
  /** True when normalisation was active but denormalisation ranges were unavailable */
  _normalised?: boolean;
}

/**
 * Enriched conditional winner analysis per factor.
 * Shows how the winning option changes conditional on factor value buckets.
 * Option IDs in buckets are enriched with human-readable labels.
 */
export interface ConditionalWinner {
  /** Factor node ID */
  factor_id: string;
  /** Factor label */
  factor_label: string;
  /** Value at which the split occurs */
  split_value: number;
  /** Unit for the split value */
  split_unit?: string;
  /** Low bucket: option outcomes below the split */
  low_bucket: ConditionalBucket;
  /** High bucket: option outcomes above the split */
  high_bucket: ConditionalBucket;
  /** Whether the winning option flips between buckets */
  winner_flips: boolean;
  /** True when normalisation was active but denormalisation ranges were unavailable */
  _normalised?: boolean;
}

/**
 * A bucket in the conditional winner analysis with enriched labels.
 */
export interface ConditionalBucket {
  /** Winning option ID in this bucket */
  winner_id: string;
  /** Human-readable label for the winning option */
  winner_label: string;
  /** Runner-up option ID in this bucket */
  runner_up_id?: string;
  /** Human-readable label for the runner-up option */
  runner_up_label?: string;
  /** Win probability of the winner in this bucket */
  win_probability: number;
  /** Mean outcome for the winner in this bucket */
  mean_outcome?: number;
}

/**
 * Honest provenance for the user-visible confidence value.
 * @see truth-table row A1-PRIMARY (audit 2026-05-truth-table)
 *
 * - `'plot_unified_from_isl_bootstrap'` — PLoT's unified formula computed from
 *   ISL's bootstrap stability inputs.
 * - `'plot_unified_from_graph'` — PLoT's unified formula computed from graph
 *   structure (no ISL bootstrap available).
 */
export type ConfidenceSource =
  | 'plot_unified_from_isl_bootstrap'
  | 'plot_unified_from_graph';

/**
 * Formula-version tag for the unified confidence computation.
 *
 * - `'plot_unified_v2'` — 0.5 × attribution_stability_band_score + 0.5 × mean(exists_probability).
 *   The band score is a 4-bucket map of ISL's `attribution_stability` category.
 * - `'plot_unified_v3'` — 0.5 × ISL_continuous_bootstrap_confidence + 0.5 × mean(exists_probability).
 *   Replaces the 4-bucket band with ISL's already-continuous bootstrap-derived
 *   confidence value (rounded to 4 decimals on the ISL side). Used when ISL
 *   emits a finite confidence in [0, 1] alongside a non-null
 *   `attribution_stability`. Falls back to v2 when ISL confidence is absent
 *   or invalid. Preserves `confidence_source` and the 50/50 blend; the
 *   only material difference is the granularity of the stability term.
 *
 * Future Jinghui-led calibration may extend further. DGAI's debug hook
 * validates this field with `/^plot_unified_v\d+$/` — extensions must keep
 * to that family.
 */
export type ConfidenceFormulaVersion = 'plot_unified_v2' | 'plot_unified_v3';

/**
 * Calibration status for the confidence formula. Single-valued at this tranche
 * because the formula's coefficients and band table are operational defaults
 * pending pilot calibration (Neil gate 1, Jinghui calibration brief).
 */
export type ConfidenceCalibrationStatus = 'provisional_pending_pilot_calibration';

/**
 * Quality of inputs that produced the confidence value. Preserves the audit
 * trail of the legacy `confidence_source: 'fallback_degenerate'` tag without
 * polluting the source-of-computation enum.
 *
 * - `'standard'` — bootstrap or rich-edge inputs available.
 * - `'degenerate_fallback'` — neither ISL bootstrap nor rich edge strength
 *   data was usable; the uniform-default branch fired. The numeric confidence
 *   value is not differentiating in this case.
 */
export type ConfidenceInputQuality = 'standard' | 'degenerate_fallback';

/**
 * Confidence provenance — additive disclosure metadata, payload-only.
 * The UI surfaces only `is_provisional` (as a single column-header marker);
 * `formula_version` and `calibration_status` are debug fields.
 *
 * @see truth-table rows A1-PRIMARY, A1-SECONDARY, A1-CONFIDENCE-PROVENANCE-LOST
 */
export interface ConfidenceProvenance {
  computation_source: ConfidenceSource;
  formula_version: ConfidenceFormulaVersion;
  is_provisional: boolean;
  calibration_status: ConfidenceCalibrationStatus;
  input_quality: ConfidenceInputQuality;
}

// ─── Auto-noise provenance (audit B3) ───────────────────────────────────────
//
// Disclosure metadata for the operational variance adjustment ISL applies in
// `_apply_auto_scaled_noise` (robustness_analyzer_v2.py:1113). Per Monte Carlo
// sample ISL adds N(0, outcome_std) to outcome and risk node draws, which
// roughly doubles outcome variance (~√2 on SD). Magnitude is fixed at
// `multiplier: 1.0` per Neil-approved heuristic; Jinghui calibration pending.
//
// Mirrors the A1 ConfidenceProvenance pattern but is analysis-level
// (per-run), not per factor: auto-noise affects every outcome/risk
// distribution globally for the run.
//
// @see truth-table rows B3 (P0), F2-AUTO-NOISE-SILENCE (P1), U-015.

/** Effect of auto-noise on the outcome and risk distributions. */
export type AutoNoiseEffect = 'widens_outcome_and_risk_uncertainty';

/**
 * Formula version for the auto-noise computation. Single-valued at this
 * tranche; future Jinghui calibration may extend.
 */
export type AutoNoiseFormulaVersion = 'plot_auto_v1';

/** Distribution shape applied per Monte Carlo sample (mirrors ISL `rng.normal(0, outcome_std)`). */
export type AutoNoiseDistribution = 'normal_zero_mean_outcome_std';

/** Node-kind filter that gates which distributions receive noise (ISL: `node_kind in {"outcome","risk"}`). */
export type AutoNoiseFilterScope = 'outcome_and_risk_nodes';

/**
 * Calibration status. Single-valued at this tranche because the multiplier
 * is a Neil-approved PoC heuristic pending pilot calibration.
 */
export type AutoNoiseCalibrationStatus = 'provisional_pending_pilot_calibration';

/**
 * Auto-noise provenance — additive, payload-only disclosure metadata.
 *
 * Present on the V3 response when analysis ran (`analysis_status` is
 * `'computed'` or `'partial'`); absent on `'blocked'` / `'failed'`.
 * Always carries full formula metadata even when `applied: false`.
 *
 * The UI surfaces a single inline marker conditional on
 * `applied && is_provisional`; all other fields are payload-only debug
 * metadata and must NEVER be rendered as user-facing text.
 */
export interface AutoNoiseProvenance {
  /**
   * Whether ISL applied auto-noise on this run.
   *
   * Equals the top-level `auto_noise_applied` boolean **when ISL emitted
   * the flag**. The two diverge on the missing-flag path: when ISL omits
   * `_metadata.auto_noise_applied` on a computed/partial response, the
   * top-level field is `null` (preserving the "engine didn't tell us"
   * signal) while this nested `applied` defaults to `false` so the
   * provenance object remains a complete boolean shape. Always pair
   * `auto_noise_applied === null` with the
   * `auto_noise_flag_missing_from_isl` log to disambiguate.
   */
  applied: boolean;
  effect: AutoNoiseEffect;
  formula_version: AutoNoiseFormulaVersion;
  /** Magnitude factor on outcome std. Fixed at 1.0 (Neil heuristic) — calibration pending. */
  multiplier: number;
  noise_distribution: AutoNoiseDistribution;
  filter_scope: AutoNoiseFilterScope;
  is_provisional: boolean;
  calibration_status: AutoNoiseCalibrationStatus;
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
  /**
   * Importance ranking (1 = most important) — the producer's answer to "what
   * matters most".
   *
   * ⚠ This is NOT ISL's `importance_rank` passed through. On the primary path it
   * orders PLoT's graph path-analysis influence; ISL's own value is not
   * published. The basis is disclosed per row on `importance_basis` — read that
   * before interpreting this number.
   *
   * Option-controlled levers (ISL `zero_reason: 'intervention_override'` OR D-U
   * structural union members) are ordered LAST on both paths: a lever is a
   * decision lever, not a background uncertainty, so it never consumes a top
   * importance slot (the same doctrine `evidence_gaps` and
   * `decision_brief.top_drivers` apply). A lever still tops `influence_rank` —
   * that field is the ungated structural measurement.
   *
   * The emitted array order follows this rank, so `factor_sensitivity[0]` and
   * `importance_rank === 1` agree. See `src/lib/importance-authority.ts`.
   */
  importance_rank?: number;
  /**
   * Producer disclosure: WHICH authority produced `importance_rank` (and the
   * quantity `influence_score`/`sensitivity_score`/`elasticity` are computed
   * from) on this response.
   *
   * - `'graph_structural'` — PLoT's own graph path analysis
   *   (`computeFactorSensitivityFromGraph`), the live primary path. ISL's
   *   `importance_score` / `importance_rank` / `sensitivity_score` /
   *   `elasticity` / `direction` are NOT on the wire in this case; only its
   *   bootstrap stability diagnostics are merged in.
   * - `'isl_uncertainty'` — the graph path returned nothing, so ISL's own
   *   Monte-Carlo uncertainty-importance ordering is what is published.
   *
   * Exists because the two quantities share ISL's field NAMES and are otherwise
   * indistinguishable to a consumer. Declared in
   * `src/contracts/isl-to-ui.contract.ts`.
   */
  importance_basis?: 'graph_structural' | 'isl_uncertainty';
  /** Human-readable interpretation from ISL */
  interpretation?: string;
  /**
   * Doctrine 039 (D-7) — producer-owned categorical driver-strength label.
   * 4-valued, matching the shape of the UI's `getSemanticLabel`.
   *
   * ⚠ THE TWO BANDS ANSWER DIFFERENT QUESTIONS, and read different fields:
   *
   * - `'strong' | 'moderate' | 'minor'` — MAGNITUDE, a pure function of this
   *   row's own `influence_score` (normalised influence): >=
   *   DRIVER_LABEL_STRONG_MIN 'strong', >= DRIVER_LABEL_MODERATE_MIN
   *   'moderate', else 'minor'. Cut-points DOCTRINE-PENDING (Neil). ABSENT when
   *   `influence_score` is absent/non-finite — never fabricated from a missing
   *   measurement.
   * - `'biggest'` — RANK. Exactly one factor per response carries it, and it is
   *   **`driver_order.ranked_factor_ids[0]`** — PLoT's ONE canonical,
   *   lever-aware order (family-4 S1b). Unconditional of magnitude, and applied
   *   even when the row has no `influence_score`, because it answers "which
   *   factor does this producer rank first?" — a question with an answer at any
   *   magnitude.
   *
   * ⚠ It used to be the argmax over `influence_score`, which is NOT lever-aware
   * and on the live wire crowned an option-pinned lever the same response
   * publishes at `sensitivity_score: 0` / `elasticity: 0`. The raw structural
   * argmax is still published, under its own honest name, as `influence_rank
   * === 1`.
   *
   * Basis flip (elasticity vs influence) for the MAGNITUDE bands + UI adoption
   * remain UI-confirmation-gated. See `src/lib/driver-label.ts`.
   */
  driver_label?: 'biggest' | 'strong' | 'moderate' | 'minor';
  /**
   * Value of information for this factor on the public response surface.
   *
   * Provenance is path-dependent:
   *   - **ISL path:** sourced from ISL's Monte Carlo VOI estimator and
   *     sanitised non-negative via `sanitiseIslVoi`
   *     (`src/lib/evpi-emission.ts`) per the Howard 1966 EVPI contract.
   *   - **Graph fallback path:** computed by `computeValueOfInformation` in
   *     `src/lib/factor-influence.ts` as
   *     `|sensitivity| × (1 - confidence) × decision_fragility`, where
   *     `decision_fragility` is the max `marginal_switch_probability`
   *     across adjacent fragile edges.
   *
   * **May legitimately be 0** when:
   *   - the factor has no adjacent fragile edge in the graph-fallback path
   *     (decision_fragility = 0 → product = 0); or
   *   - ISL emitted a non-positive VOI value (sampling artefact) which the
   *     non-negativity sanitiser collapsed.
   *
   * This is a **different quantity** from
   * `m1_coaching.evidence_gaps[*].voi_score`, which is a coaching-internal
   * impact × uncertainty score that does not consult fragile edges. The
   * two surfaces can legitimately disagree on the same factor — see
   * `tests/voi-surface-divergence.test.ts` for a regression pin and
   * `src/coaching/types.ts:EvidenceGap.voi_score` for the coaching formula.
   */
  value_of_information?: number;
  /**
   * Estimated EVPI in percentage points of win probability.
   *
   * Currently emitted ONLY via the `'heuristic'` method:
   * `value_of_information × win_probability_spread × 100`, clamped ≥ 0.
   *
   * F3 (ISL #103 / D-23.15): the former `'counterfactual'` source consumed
   * ISL's removed top-level `factor_evpi[]` and has been withdrawn. ISL's
   * honest outcome-unit successor `factor_evppi` is NOT substituted here — it
   * is in outcome units, not win-probability points, so it rides the raw
   * top-level passthrough only and is reconciled onto this surface by the S5
   * typed-surface batch (D-23.8). The `'counterfactual'` enum member is
   * RESERVED for that batch; the current build never emits it.
   *
   * Present only when the heuristic yields an emittable value.
   *
   * **Derived from this field's own `value_of_information`** — inherits its
   * public-surface provenance (ISL Monte Carlo or graph fallback with
   * fragile-edge dependency). **NOT comparable to
   * `m1_coaching.evidence_gaps[*].evpi_percentage_points`**, which is
   * derived from the coaching-internal `voi_score`. The two EVPI fields
   * legitimately diverge wherever the underlying VOI fields do — see
   * `tests/voi-surface-divergence.test.ts` for the regression pin and
   * `src/coaching/types.ts:EvidenceGap` for the coaching formula.
   */
  evpi_percentage_points?: number;
  /**
   * Method used to compute evpi_percentage_points. The current build emits
   * only `'heuristic'`; `'counterfactual'` is RESERVED for the S5 typed
   * outcome-unit surface (F3 / D-23.8) and is not produced today.
   */
  evpi_method?: 'heuristic' | 'counterfactual';
  /**
   * RESERVED for the S5 typed counterfactual surface (F3 / D-23.8) — NOT
   * emitted by the current build. It was previously set when ISL's removed
   * `factor_evpi[].evpi_status` reported a per-factor estimate too small to
   * measure at the run's sampling depth. `'below_resolution'` means "too small
   * to measure", NOT "measured as zero" — when re-wired, `evpi_percentage_points`
   * is deliberately absent in that case rather than a clamped 0.
   */
  evpi_status?: 'below_resolution';
  /**
   * Doctrine 014 — producer-owned "gather evidence" gate. With the
   * counterfactual EVPI withheld (F3), the gate reads the heuristic VOI
   * (value_of_information > VOI_HINT_MIN); when the S5 typed surface re-wires a
   * real per-factor EVPI it will gate on that instead (evpi_percentage_points
   * with evpi_method 'counterfactual', >= EVPI_HINT_MIN_PP). Both
   * thresholds DOCTRINE-PENDING (Neil). ABSENT when there is no basis (no real
   * EVPI and no finite VOI) and on option-controlled levers (not evidence-gap
   * candidates). See `src/lib/evpi-emission.ts` (`deriveEvidenceHint`).
   */
  evidence_hint?: boolean;
  /**
   * Confidence in the sensitivity score (0-1).
   *
   * Always PLoT-recomputed; never a raw passthrough of ISL's own `confidence`
   * label. The merge step writes one of:
   *
   * - `plot_unified_v3` (when ISL emits a finite continuous `confidence` and a
   *   non-null `attribution_stability`):
   *     0.5 × ISL_continuous_bootstrap_confidence + 0.5 × mean(exists_probability)
   *   ISL's continuous value is consumed as the stability input; the public
   *   value remains PLoT-computed (the 50/50 blend + clamp is the PLoT step).
   *
   * - `plot_unified_v2` (fallback when ISL continuous confidence is absent or
   *   invalid):
   *     0.5 × band_score(attribution_stability) + 0.5 × mean(exists_probability)
   *   The 4-bucket band collapses ISL's stability category to {0, 0.25, 0.5, 1.0}.
   *
   * The active formula is disclosed via `confidence_provenance.formula_version`.
   * @see truth-table row A1-PRIMARY (audit 2026-05-truth-table)
   */
  confidence?: number;
  /** Reason why sensitivity is zero. Present when sensitivity_score = 0. */
  zero_reason?: string;
  /** Source of this factor sensitivity data */
  source?: 'graph' | 'isl';
  /**
   * Honest provenance label for the confidence value above.
   * Replaces the legacy `'isl' | 'graph' | 'fallback_degenerate'` union, which
   * misleadingly tagged PLoT-recomputed values as `'isl'` even though ISL's own
   * confidence was discarded. See truth-table row A1-PRIMARY.
   *
   * - `'plot_unified_from_isl_bootstrap'` — PLoT's unified formula computed from
   *   ISL's bootstrap stability inputs (attribution_stability supplied).
   * - `'plot_unified_from_graph'` — PLoT's unified formula computed from graph
   *   structure (no ISL bootstrap; uses incoming edge data, possibly the uniform
   *   default — see `confidence_provenance.input_quality` for that signal).
   *
   * REQUIRED on every entry the public `factor_sensitivity[]` response emits
   * (audit A1-PRIMARY: the public contract is "no factor without honest source
   * provenance"). Pinned by the `mergeIslConfidenceIntoGraphFactors` step,
   * `computeFactorSensitivityFromGraph`, and the placeholder in
   * `mapIslFactorEntry` (which the merge always overrides). Regression-pinned
   * by tests T11/T11b in tests/isl-confidence-merge.test.ts.
   */
  confidence_source: ConfidenceSource;
  /**
   * Additive provenance metadata for the confidence value (audit A1-PRIMARY fix).
   * Carries computation source, formula version, provisional flag, and input
   * quality. Single coherent disclosure object — sets the M2 disclosure pattern
   * for follow-ups B3 (auto-noise) and C4 (prior-synthesis).
   *
   * REQUIRED — see `confidence_source` above for the same provenance invariant.
   */
  confidence_provenance: ConfidenceProvenance;
  /**
   * Flip risk category based on fragile edge adjacency.
   * - 'isolated': This factor alone can flip the recommendation (marginal_switch_probability > 0.05)
   * - 'correlated': This factor can flip recommendation in combination with others (switch_probability > 0.05)
   * - 'negligible': Minimal flip risk
   */
  flip_risk_category?: 'isolated' | 'correlated' | 'negligible';

  // 3C stability fields — valid for ISL-sourced entries only.
  // Graph-derived and ISL elasticity use different scales; do not cross-attach.
  /** Bootstrap standard deviation of the elasticity estimate (from ISL) */
  elasticity_std?: number;
  /** Attribution stability category (from ISL) */
  attribution_stability?: 'high' | 'moderate' | 'low' | 'negligible';
  /** Rate at which this factor's rank flips across bootstrap samples (from ISL) */
  rank_flip_rate?: number;
  /** Method used by ISL to compute stability metrics */
  stability_method?: string;

  // Track S: ISL factor value provenance (additive passthrough from ISL
  // FactorSensitivityV2). Distinct from `source` above: `source` records which
  // engine produced the row (graph vs ISL); these record where the factor's
  // *input value* came from. Carried verbatim from ISL when present; absent on
  // older ISL responses.
  /** Provenance of the factor's input value (where the value came from). */
  value_source?: string;
  /** How the factor value was extracted/derived. */
  value_extraction_type?: string;
  /**
   * True when ISL substituted a default for the factor value.
   * Absent ≠ false: absent means "older ISL response or not reported" and is
   * never coerced to false — see mapIslFactorEntry and
   * mergeIslConfidenceIntoGraphFactors.
   */
  value_defaulted?: boolean;

  /**
   * Progressive disclosure: raw components of the unified confidence formula.
   * Allows UI to expose what drives the confidence score.
   */
  confidence_components?: {
    /** mean(exists_probability of incoming edges), or 0.5 if no edges */
    structural_certainty: number;
    /** attribution_stability_band_score, or null if no ISL data */
    sampling_stability: number | null;
  };

  /**
   * Range derivation source tier for this factor's intervention range.
   * Indicates which priority tier was used to derive the normalisation range.
   * Surfaced from _meta.range_derivation_sources for per-factor UI display.
   *
   * Values: 'explicit_cap' | 'explicit' | 'extracted' | 'inferred_spread' | 'inferred_baseline' | 'inferred_value' | 'default'
   */
  range_derivation_source?: string;
  /** True when normalisation was active but denormalisation ranges were unavailable */
  _normalised?: boolean;
}

/**
 * ISL stability assessment for a single factor.
 * Populated from ISL's 3C bootstrap analysis.
 * All four fields are required — entries with partial data are skipped.
 */
export interface FactorStabilityEntry {
  /** Factor node ID */
  factor_id: string;
  /** Factor label for display */
  factor_label: string;
  /** Bootstrap standard deviation of the elasticity estimate */
  elasticity_std: number;
  /** Attribution stability category */
  attribution_stability: 'high' | 'moderate' | 'low' | 'negligible';
  /** Rate at which this factor's rank flips across bootstrap samples */
  rank_flip_rate: number;
  /** Method used by ISL to compute stability metrics */
  stability_method: string;
}

/**
 * ISL stability threshold configuration.
 * Defines the boundaries used by ISL to categorise attribution_stability.
 * Passthrough from ISL response — configuration metadata, NOT included in response_hash.
 */
export interface StabilityThresholds {
  /** Boundary between 'high' and 'moderate' stability (elasticity_std threshold) */
  high_moderate_boundary: number;
  /** Boundary between 'moderate' and 'low' stability (elasticity_std threshold) */
  moderate_low_boundary: number;
  /** Threshold configuration version */
  version: string;
  /** True when thresholds are provisional (pending scientific review) */
  provisional: boolean;
}

// ---------------------------------------------------------------------------
// Inference Warnings (diagnostic metadata — NOT in response_hash)
// ---------------------------------------------------------------------------

/** Valid inference warning codes (PLoT-originated) */
export const INFERENCE_WARNING_CODES = {
  /** ISL returned factor-level 3C fields but stability_thresholds was absent or malformed */
  STABILITY_THRESHOLDS_MISSING: 'STABILITY_THRESHOLDS_MISSING',
  /**
   * Edge-level sensitivity was requested (analysis_types includes
   * 'sensitivity') but the deployed ISL's V2 response did not carry it.
   * ISL builds 9a22a1a+ (lane 11 / ISL PR #65, 2026-07-07) emit it nested at
   * `robustness.edge_sensitivity` and PLoT consumes it (lane PLoT-W4) — this
   * warning then no longer fires. It remains for OLDER deployed ISL builds
   * (e.g. f3f5d92) whose wire omits the field entirely: edge_sensitivity is
   * empty because the wire omitted it, NOT by computation failure.
   * Invariant: edge_sensitivity populated OR this marker present — never
   * both absent on a computed analysis. Factor-level sensitivity is
   * unaffected. PLoT does not invent a substitute.
   */
  EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE: 'EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE',
  /**
   * Edge E-values were requested (include_e_values: true on every ISL call)
   * but the response's `robustness` object carries NO
   * `robustness.edge_e_values` location at all — the canonical V2 wire
   * location (emitted since ISL build f3f5d92) is absent, i.e. the deployed
   * ISL is an older/rolled-back wire generation (lane 29, spec §2.1
   * wire-location probe). edge_e_values is then empty because the wire
   * omitted the LOCATION, not by computation: an empty array AT the
   * location is computed-empty (honest — no warning). Invariant mirrors
   * EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE: location present OR this marker
   * present — never a silent [] from a missing location on a computed
   * analysis. Pairs with `_meta.evidence.isl_wire_generation_ok: false`
   * and the `isl_wire_generation_unverified` log event.
   */
  EDGE_E_VALUES_UNAVAILABLE_V2_WIRE: 'EDGE_E_VALUES_UNAVAILABLE_V2_WIRE',
  /**
   * A goal constraint's target is not decision-grade: its threshold
   * normalisation fell back to the default [0,1] range and/or ISL defaulted
   * the target node's base to 0.0 (no observed value / no parameter
   * uncertainty). `probability_of_joint_goal` and `constraint_probabilities`
   * are SUPPRESSED for the run (absence is honest; raw computed values stay
   * in diagnostics logs only). Severity: warning.
   * Doctrine B (P0-C2): the base-defaulted-only forward-propagated case no
   * longer suppresses — it emits CONSTRAINT_GOALFIT_MODELLED_BASIS instead.
   * @see src/lib/constraint-reliability.ts
   */
  CONSTRAINT_TARGET_UNRELIABLE: 'CONSTRAINT_TARGET_UNRELIABLE',
  /**
   * Doctrine B (P0-C2, ratified 2026-07-07): goal-fit probabilities WERE
   * delivered, scored from the constraint-target node's forward-propagated
   * Monte Carlo outcome distribution against the normalised threshold —
   * because the node has no observed baseline value (ISL defaulted its base
   * to 0.0), they reflect modelled change driven by upstream factors, not
   * distance from a measured starting point. Pairs with the per-option
   * `goal_fit_basis` annotation. Severity: info.
   * @see src/lib/constraint-reliability.ts
   */
  CONSTRAINT_GOALFIT_MODELLED_BASIS: 'CONSTRAINT_GOALFIT_MODELLED_BASIS',
  /**
   * Defensive sign-check on the auto-constraint fallback (Phase 1c+, run.ts
   * ~line 3696): goal_constraints was empty so PLoT synthesised a single
   * `>= goal_threshold` constraint from a bare number, with no visibility
   * into the goal-framing text CEE extracted it from — the fallback cannot
   * tell "at least X" from "at most X". When the guessed threshold is
   * positive AND the modelled outcome distribution for that same target node
   * never reaches non-negative territory even at its most favourable sampled
   * percentile (p90 < 0), the constraint is structurally unsatisfiable: every
   * option is guaranteed a ~0% `probability_of_joint_goal` by construction of
   * the sign mismatch, not by the graph. That fabricated-looking near-zero is
   * SUPPRESSED for the affected option(s) (absence is honest) in favour of
   * this warning. Severity: warning.
   * @see src/lib/constraint-reliability.ts
   */
  CONSTRAINT_DIRECTION_SUSPECT: 'CONSTRAINT_DIRECTION_SUSPECT',
  /**
   * ROADMAP 1.54 (density wall): the Monte Carlo sample depth for this run
   * was reduced before the ISL call so that the request fits ISL's
   * complexity budget (`n_samples × nodes × edges ≤ ISL_MAX_COMPUTE_COMPLEXITY`,
   * default 10,000,000) — previously such graphs failed outright with a raw
   * ISL 422. The message names BOTH the originally requested/default depth
   * and the reduced depth actually used; `meta.n_samples` (and brief/fact
   * lineage) always report the TRUE reduced depth. Reductions never go below
   * ADAPTIVE_N_SAMPLES_FLOOR (1,000) — graphs that cannot fit even at the
   * floor are refused with a GRAPH_TOO_COMPLEX blocker instead (422, before
   * ISL). Displayed probabilities may be less stable than at the standard
   * depth (Track S ±3pp target was calibrated at 4,000). Severity: warning.
   * @see src/config/sampling.ts applyComplexityBudget
   */
  SAMPLES_REDUCED_FOR_COMPLEXITY: 'SAMPLES_REDUCED_FOR_COMPLEXITY',
  /**
   * A3 lane 1 (enrichment producer guard): the outgoing /v2/run success body
   * failed producer-side validation against the typed PLoT→CEE enrichment
   * envelope (`AnalysisEnrichmentSchema`, vendored @talchain/schemas) at the
   * egress boundary. FAIL-OPEN: delivery is never blocked or mutated — the
   * message names the offending zod issue paths + codes (never values) so
   * the defect is attributable at the producer instead of surfacing only in
   * CEE's shadow-validation telemetry. The envelope is passthrough with all
   * root keys optional, so this fires ONLY on type/enum corruption of typed
   * keys — never because PLoT emits fields the schema does not know.
   * Pairs with `_meta.evidence.enrichment_contract_ok: false` and the
   * `enrichment_contract_mismatch` log event. Severity: warning.
   * @see src/routes/v2/enrichment-egress-guard.ts
   */
  ENRICHMENT_CONTRACT_MISMATCH: 'ENRICHMENT_CONTRACT_MISMATCH',
  /**
   * A3 lane 2 (ROADMAP 2.31 adjacency — whole-block flip honesty): the
   * flip-threshold computation was ATTEMPTED for this analysis but the ENTIRE
   * block threw, so `flip_thresholds` is empty (`flip_thresholds_status:
   * 'unavailable'`) because computation failed — not because no factor could
   * flip the leading option and not because nothing was probed. Without this
   * marker the whole-block case degraded to an absent field + a server-side
   * `flip_thresholds_error` WARN only, indistinguishable on the wire from
   * "no candidates". Per-factor failures are NOT this case — they remain
   * disclosed per entry via `flip_reason` ('timeout'/'error'/...). The
   * message carries the thrown error's NAME only, never its message or any
   * value. Non-blocking: all other analyses are unaffected.
   * Severity: warning.
   */
  FLIP_THRESHOLDS_UNAVAILABLE: 'FLIP_THRESHOLDS_UNAVAILABLE',
  /**
   * A3 remediation (ALTITUDE Hunt 2, 2026-07-18): ISL-ORIGINATED degrade
   * disclosure. ISL computes seed-sweep flip-stability bands under a wall-clock
   * budget; on a budget trip it degrades all-or-nothing (no bands attached to
   * ANY edge_e_values entry) and — post ISL-lane — emits this code in its
   * `inference_warnings` so the absence is attributable on the wire instead of
   * ISL-log-only. PLoT forwards it verbatim through the ISL-warning merge (the
   * same passthrough ROOT_NODE_DEFAULT_VALUE rides), exactly mirroring how
   * FLIP_THRESHOLDS_UNAVAILABLE discloses PLoT's own whole-block flip failure.
   * Bands are additive enrichment — non-blocking; all other analyses unaffected.
   * Severity: warning.
   */
  STABILITY_BANDS_UNAVAILABLE: 'STABILITY_BANDS_UNAVAILABLE',
  /**
   * A3 remediation (ALTITUDE Hunt 2, 2026-07-18): ISL-ORIGINATED degrade
   * disclosure, sibling of STABILITY_BANDS_UNAVAILABLE. ISL computes edge
   * E-values under their own budget; on a trip the E-value phase degrades and
   * ISL emits this code in `inference_warnings` so the empty/partial
   * edge_e_values are attributable on the wire, not ISL-log-only. PLoT forwards
   * it verbatim. Non-blocking; other analyses unaffected. Severity: warning.
   */
  E_VALUES_UNAVAILABLE: 'E_VALUES_UNAVAILABLE',
  /**
   * A3 remediation (ALTITUDE Hunt 2, 2026-07-18): ISL-ORIGINATED degrade
   * disclosure, sibling of STABILITY_BANDS_UNAVAILABLE / E_VALUES_UNAVAILABLE.
   * ISL's per-factor EVPI (value-of-information) phase runs under its own
   * wall-clock budget; on a trip it degrades and ISL emits this code (with
   * elapsed_ms) in `inference_warnings` so the absent/partial EVPI is
   * attributable on the wire, not ISL-log-only. PLoT forwards it verbatim.
   * Non-blocking; other analyses unaffected. Severity: warning.
   */
  EVPI_UNAVAILABLE: 'EVPI_UNAVAILABLE',
  /**
   * A3 remediation (ALTITUDE Hunt 2, 2026-07-18): ISL-ORIGINATED degrade
   * disclosure, sibling of the budget-degradation family. ISL's structural
   * path decomposition (request-gated) runs under its own budget; on a trip it
   * degrades and ISL emits this code (with elapsed_ms) in `inference_warnings`
   * so the absent path_decomposition is attributable on the wire, not
   * ISL-log-only. PLoT forwards it verbatim. Non-blocking; other analyses
   * unaffected. Severity: warning.
   */
  PATH_DECOMPOSITION_UNAVAILABLE: 'PATH_DECOMPOSITION_UNAVAILABLE',
  /**
   * F13 (Codex deep review, A3 r2): one or more ISL factor-sensitivity entries
   * carried BOTH a `node_id` AND a `factor_id` that DIFFER — an ambiguous twin
   * whose canonical identity cannot be trusted. Rather than resolve it to a
   * guessed id (and risk mapping it as a lever on one surface while it escapes
   * lever-suppression on another), PLoT DROPS such entries from the public
   * factor_sensitivity / factor_stability / CEE-review surfaces and discloses
   * the drop here. The pinned ISL producer emits only canonical `node_id`, so
   * this cannot fire on the current wire — it is schema-evolution hardening.
   * Non-blocking; all other analyses unaffected. Severity: warning.
   * @see src/lib/intervention-override.ts factorIdOf / hasFactorIdConflict
   */
  FACTOR_ID_CONFLICT: 'FACTOR_ID_CONFLICT',
  /**
   * F14 (Codex deep review, A3 r2): one or more edge E-value entries were
   * dropped from the public `edge_e_values` array because a required numeric
   * (e_value / current_mean / flip_mean) was non-finite after transformation
   * (e.g. a range-width overflow denormalised a valid value to ±Infinity, which
   * would serialise to a fabricated `null`). Without this marker the drop was
   * SILENT — an empty/short `edge_e_values` was indistinguishable from a
   * genuinely computed-empty result. Non-blocking; other analyses unaffected.
   * Severity: info (ISL routinely emits null e_value for unflippable edges —
   * expected non-representability, not an alarm; mirrors
   * EDGE_E_VALUES_UNAVAILABLE_V2_WIRE).
   * @see src/routes/v2/run.ts transformEdgeEValues
   */
  EDGE_E_VALUE_NON_FINITE_DROPPED: 'EDGE_E_VALUE_NON_FINITE_DROPPED',
} as const;

export type InferenceWarningCode = (typeof INFERENCE_WARNING_CODES)[keyof typeof INFERENCE_WARNING_CODES];

/**
 * Diagnostic warning emitted when inference metadata is inconsistent.
 * Code is typed as string to accept both PLoT-originated and ISL-forwarded codes.
 */
export interface InferenceWarning {
  code: InferenceWarningCode | string;
  message: string;
  severity: 'info' | 'warning';
  /**
   * F4 (Codex deep review): the field path the warning is about, preserved
   * verbatim from ISL's real `InferenceWarning.field` (e.g. `factor_evpi`,
   * `path_decomposition`). Present only when the source warning carried one.
   * The egress enrichment envelope's inference_warnings element is passthrough,
   * so this additive field never fails the contract.
   */
  field?: string;
  /**
   * Optional wall-clock ms the underlying phase ran before degrading. Carried
   * through from ISL's budget-degradation disclosures (STABILITY_BANDS_UNAVAILABLE,
   * E_VALUES_UNAVAILABLE, EVPI_UNAVAILABLE, PATH_DECOMPOSITION_UNAVAILABLE) so a
   * slow degrade is diagnosable on the wire, not only in the ISL log. Present
   * only when the source warning carried a finite elapsed_ms. The egress
   * enrichment envelope's inference_warnings element is passthrough, so this
   * additive field never fails the contract.
   */
  elapsed_ms?: number;
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
  /**
   * OPTIONAL: omitted when the source edge carries no switch_probability
   * (absent ≠ 0). When omitted, `severity` and `visible` are omitted too.
   */
  switch_probability?: number;
  /**
   * Severity classification derived from switch_probability.
   * Thresholds: >0.7 → 'critical', >0.5 → 'error', 0–0.5 → 'warning'.
   * Present on fragile_edges with a finite switch_probability; ABSENT when
   * switch_probability is absent/non-finite (never fabricated 'warning') and on
   * robust_edges.
   */
  severity?: 'critical' | 'error' | 'warning';
  /**
   * Doctrine 013 — producer-DISCLOSED visibility gate over `switch_probability`.
   * `visible = switch_probability > FRAGILE_EDGE_VISIBLE_MIN` (ratified
   * from the UI's THRESHOLDS.FRAGILE_EDGE_FILTER; DOCTRINE-PENDING, Neil). PLoT
   * DISCLOSES the gate but does NOT filter the array — the UI decides render.
   * ABSENT when switch_probability is absent/non-finite (never fabricated). See
   * `src/trust/edge-severity.ts`.
   */
  visible?: boolean;
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
  /**
   * @deprecated NO LONGER EMITTED by PLoT (lane PLoT-H item B, 2026-07-07).
   * ISL derives this as `option_wins[winner] / n_samples` (see ISL
   * `robustness_analyzer_v2.py:_compute_robustness`) — i.e. it is the
   * leader's win_probability relabelled, carrying zero independent
   * information. Verified byte-identical to the leader's win_probability in
   * both live manual tests (0.59025 and 0.8541875) and in the live capture
   * fixture (tests/fixtures/isl-v2-live-20260706). Consumers must use the
   * absence path (the UI already suppresses "N% stability" on absence).
   * Field kept on the type for inbound tolerance of old payloads only.
   */
  recommendation_stability?: number;
  /** Boolean robustness flag from ISL V2/Option C format */
  is_robust?: boolean;
  /**
   * Robustness level from ISL V2/Option C format.
   * Optional — only present when ISL returns a level. When absent, consumers
   * should derive from `recommendation_stability` or fall back to `label`
   * with vocabulary mapping (robust→high, moderate→moderate, fragile→low).
   * Note: ISL sends `'medium'`; the UI normalises this to `'moderate'`.
   */
  level?: 'high' | 'medium' | 'low' | 'very_low';
  /**
   * ISL's `confidence` slot (0-1) — NOT a confidence level.
   *
   * Since ISL PR #114 this is the uncalibrated recommendation-stability
   * fraction. Always read `confidence_basis` alongside it; a bare value is
   * ambiguous between the pre- and post-#114 quantities.
   */
  confidence?: number;
  /**
   * Declared basis for `confidence`.
   *
   * `'recommendation_stability_uncalibrated'` — the share of sampled scenarios
   * the recommended option won, with no calibration and no coverage guarantee.
   * `'unknown_legacy'` — the producer declared no basis, so the value must not
   * be read as either quantity.
   */
  confidence_basis?: 'recommendation_stability_uncalibrated' | 'unknown_legacy';
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
  /**
   * ADDITIVE (lane PLoT-W5, roadmap Tier 1.6): display-safe robustness verdict,
   * derived by PLoT honestly and ONLY from the producer facts is_robust/level
   * (confidence is NEVER an input — it can never upgrade a verdict). Mapping
   * is provisional_doctrine_v0 — see src/routes/v2/robustness-display-verdict.ts.
   * 'not_assessed' whenever robustness was not computed (absent/failed/blocked)
   * or the verdict-bearing facts are missing — NEVER a determinate-looking
   * verdict without computed robustness. Emitted on every /v2/run response
   * (success shapes via buildResponse, blocked/failed shapes via
   * buildV2RunError); optional on the type for inbound tolerance of payloads
   * from older builds.
   */
  display_verdict?: 'robust' | 'moderate' | 'fragile' | 'not_assessed';
  /**
   * ADDITIVE (lane PLoT-W5): producer-owned claim-safe phrase matching
   * display_verdict (e.g. fragile → 'small changes could flip this result').
   * No numbers, wording provisional_doctrine_v0 — the UI renders it verbatim
   * and must not re-derive meaning.
   */
  display_verdict_reason?: string;
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
export type RepairAction = 'clamped' | 'defaulted' | 'inferred' | 'floored' | 'derived' | 'normalised' | 'removed';

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
  // F.5 canonical fields — present on new-style repair entries (F.6 compliance)
  /** Canonical repair code (F.5) */
  code?: string;
  /** Originating layer (F.5) */
  layer?: 'plot' | 'cee' | 'isl';
  /** JSONPath-style field path (F.5) — preferred over `field` for new entries */
  field_path?: string;
  /** Value before repair (F.5) — preferred over `from_value` for new entries */
  before?: unknown;
  /** Value after repair (F.5) — preferred over `to_value` for new entries */
  after?: unknown;
  /** Severity (F.5) */
  severity?: 'info' | 'warn';
}

/**
 * Source path for analysis results.
 */
export type SourcePath = 'isl' | 'graph_fallback';

/**
 * Canonical metadata for response auditability.
 * Base fields (source_path, repairs_applied, request_id, plot_build, hash_version)
 * are always included. Extended fields (builds, payloads) are gated behind
 * the UI_CANONICAL_META feature flag.
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
  /** End-to-end request ID chain (Brief 4 spec — 6 fields) */
  request_id_chain?: {
    /** Request ID from incoming request (null if auto-generated) */
    ui: string | null;
    /** PLoT's own request ID (null if not set) */
    plot: string | null;
    /** Request ID PLoT sent to ISL (null if ISL not called) */
    isl: string | null;
    /** Request ID ISL echoed back (null if ISL didn't echo) */
    isl_echoed: string | null;
    /** true ONLY when all four are non-null AND identical */
    all_match: boolean;
    /** true ONLY when all four are non-null */
    chain_complete: boolean;
  };
  /** Constraints filtered before ISL (non-evaluable temporal constraints) */
  filtered_constraints?: FilteredConstraintRecord[];
  /** Source of each constraint (e.g., 'auto_from_goal_threshold') */
  constraint_sources?: Record<string, string>;
  /** Hash version used for response_hash computation (audit trail) */
  hash_version?: number;
  /** Determinism hash of canonical request (semantic fields only) */
  response_hash?: string;
  /**
   * 2.13 gap A: deterministic hash of the response CONTENT ("rch_v1:<16 hex>")
   * — the public semantic surface minus the volatile set (see
   * util/response-content-hash.ts). Complements response_hash, which is
   * request-canonical by design and must not change meaning. Success
   * responses only; attached after the body is fully built.
   */
  response_content_hash?: string;
  /** Per-factor range derivation source (maps factor_id → derivation tier) */
  range_derivation_sources?: Record<string, string>;
  /** Snapshot of all feature flags for this run (diagnostic only) */
  feature_flags_snapshot?: Record<string, string>;
  /** Whether assembleBrief() returned a non-null brief (diagnostic only) */
  decision_brief_assembled?: boolean;
  /** Number of review cards assembled before any truncation (diagnostic only) */
  review_cards_count?: number;
  /** Whether the R.1 evidence_priority card was emitted (diagnostic only) */
  evidence_priority_card_present?: boolean;
  /**
   * Lane PLoT-R3 (roadmap 2.13): diligence-grade evidence capture — ALWAYS
   * present (not gated behind UI_CANONICAL_META). Closes the debug-bundle
   * "plot: null / isl: null" gap without shipping full ISL payloads:
   * digests (sha256 + byte length + key manifest) of the primary ISL
   * exchange plus the deployed PLoT and ISL builds. Diagnostic only;
   * excluded from response_hash like all _meta fields.
   */
  evidence?: EvidenceCaptureV1;
}

/**
 * Lane PLoT-R3 (2.13): content digest of an exact wire payload —
 * sha256 over the exact bytes, UTF-8 byte length, sorted top-level key
 * manifest ([] for non-object payloads). Never carries the body itself.
 */
export interface PayloadDigestV3 {
  sha256: string;
  bytes: number;
  key_manifest: string[];
}

/**
 * Lane PLoT-R3 (2.13): always-present diligence evidence for the primary
 * ISL exchange (the first robustness/analyze call; flip probes and other
 * follow-up calls remain visible in downstream_calls).
 */
export interface EvidenceCaptureV1 {
  /** Deployed PLoT build SHA (BUILD_ID / GITHUB_SHA / git fallback) */
  plot_build: string;
  /** ISL build identifier from the ISL response `build` field; null when unavailable */
  isl_build: string | null;
  /** Digest of the exact request bytes PLoT sent to ISL; null when ISL was not called */
  isl_request_digest: PayloadDigestV3 | null;
  /** Digest of the exact response bytes ISL returned; null when unavailable */
  isl_response_digest: PayloadDigestV3 | null;
  /**
   * Lane 29 (spec §2.1): result of the ISL wire-generation assertion —
   * true when the primary ISL response declared its version markers
   * (build / engine_version / version=2.x / timestamp) AND every applicable
   * nested wire-location probe resolved (robustness.edge_e_values,
   * robustness.edge_sensitivity). False = generation UNVERIFIED (mismatch,
   * rollback, or no successful ISL exchange at all) — enrichment may be
   * honestly degraded; the run itself never hard-fails on this. Details in
   * the `isl_wire_generation_unverified` log event.
   * @see src/integrations/isl/wire-generation.ts
   */
  isl_wire_generation_ok: boolean;
  /**
   * A3 lane 1 (enrichment producer guard): result of validating this very
   * response body against the typed PLoT→CEE enrichment envelope
   * (`AnalysisEnrichmentSchema`, vendored @talchain/schemas) at the egress
   * boundary. True = the body parsed clean; false = type/enum corruption on
   * a typed envelope key — see the paired ENRICHMENT_CONTRACT_MISMATCH
   * inference warning (issue paths) and `enrichment_contract_mismatch` log
   * event. ABSENT (never a boolean) when the guard itself errored — absence
   * means unassessed, not ok. FAIL-OPEN: the run never hard-fails on this.
   * @see src/routes/v2/enrichment-egress-guard.ts
   */
  enrichment_contract_ok?: boolean;
  /**
   * Which arms of the egress guard actually ran for THIS response
   * (ROADMAP 1.210).
   *
   * The guard has two arms, sampled independently because they fail
   * differently. The stability-band sweep — per-response ISL DATA validation —
   * runs on EVERY response. The full-envelope schema parse is sampled 1-in-N in
   * production, because its faults are deterministic properties of the code.
   *
   * True  = both arms ran; `enrichment_contract_ok` covers the whole envelope.
   * False = only the band sweep ran; `enrichment_contract_ok: true` then means
   *         "no malformed stability band", NOT "the envelope parsed clean".
   *
   * Present whenever the guard ran at all, so a reader never has to guess which
   * claim an `ok: true` is making.
   * @see src/routes/v2/enrichment-egress-guard.ts
   */
  enrichment_contract_schema_parsed?: boolean;
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
  /** Lane PLoT-R3 (2.13): digest of the exact request bytes sent (additive) */
  request_digest?: PayloadDigestV3;
  /** Lane PLoT-R3 (2.13): digest of the exact response bytes received (additive) */
  response_digest?: PayloadDigestV3;
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
  /** Deduplicated options (when IDENTICAL_OPTIONS_DEDUPED warnings emitted) */
  deduplicated_options?: OptionV3[];

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
// Pre-Analysis Sensitivity & EVOI
// -----------------------------------------------------------------------------

/**
 * Pre-analysis factor and edge influence computed via linear path approximation.
 * Used by the UI to rank factors before full MC analysis.
 */
export interface PreAnalysisSensitivity {
  /** Factor influence: factor_id → normalised influence [0, 1] */
  factor_influence: Record<string, number>;
  /** Edge influence: edge_id ("from::to") → normalised influence [0, 1] */
  edge_influence: Record<string, number>;
  /** Method used for computation */
  method: 'linear' | 'reduced_mc';
  /** Wall-clock computation time in milliseconds */
  computation_ms: number;
}

/**
 * A contested edge with divergent strength estimates from two CEE passes.
 */
export interface ContestedEdgeInput {
  /** Edge ID in "from::to" format */
  edge_id: string;
  /** Strength from first pass */
  pass1_strength: number;
  /** Strength from second pass */
  pass2_strength: number;
}

/**
 * EVOI result for a single contested edge.
 */
export interface EVOIEdgeResult {
  /** Edge ID in "from::to" format */
  edge_id: string;
  /** Expected value of information impact (percentage points of goal probability) */
  evoi_impact: number;
  /** Rank: 1 = highest EVOI impact */
  evoi_rank: number;
}

/**
 * EVOI computation result for all contested edges.
 */
export interface EVOIResult {
  /** Per-edge EVOI results, sorted by evoi_rank */
  edges: EVOIEdgeResult[];
  /** Wall-clock computation time in milliseconds */
  computation_ms: number;
}

// -----------------------------------------------------------------------------
// CIL Phase 1: Re-export schema wire types for API boundary consumers
// Internal engine types (EngineNodeV3, EngineEdgeV3, EngineGraphV3) remain
// PLoT-specific for the richer post-normalization representation.
// -----------------------------------------------------------------------------
export type { SchemaNodeV3, SchemaEdgeV3, SchemaGraphV3, SchemaRepairEntry };
export type { SeedSourceType } from '@talchain/schemas';
