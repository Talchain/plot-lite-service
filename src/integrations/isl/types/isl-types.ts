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

  // Track S: factor value provenance (additive fields on ISL FactorSensitivityV2).
  // Optional — absent on older ISL responses. PLoT preserves these verbatim.
  /** Provenance of the factor's input value (where the value came from). */
  value_source?: string;
  /** How the factor value was extracted/derived. */
  value_extraction_type?: string;
  /** True when ISL substituted a default for the factor value. Absent ≠ false. */
  value_defaulted?: boolean;
}

/**
 * Edge sensitivity item from ISL /api/v1/robustness/analyze/v2 response
 * Returned when analysis_types includes 'sensitivity'
 *
 * @deprecated V1-era TOP-LEVEL shape (`sensitivity[]` with `edge_from`/
 * `edge_to`) — the live V2 wire never emits it. As of ISL build 9a22a1a
 * (lane 11, 2026-07-07) edge sensitivity is emitted NESTED at
 * `robustness.edge_sensitivity` in the `ISLEdgeSensitivityV2` shape. Kept
 * only for legacy fixture tolerance.
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
 * Edge sensitivity entry on the live V2 wire — CANONICAL location is NESTED
 * at `robustness.edge_sensitivity` (additive optional; first emitted by ISL
 * build 9a22a1a, lane 11 / ISL PR #65, verified against the live staging
 * capture `tests/fixtures/isl-v2-live-20260707/isl-staging-capture.json`).
 * Absent on older deployed ISL builds (e.g. f3f5d92) — PLoT then emits the
 * EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE inference warning.
 *
 * Computed against the reference option disclosed in the envelope's
 * top-level `sensitivity_reference_option_id`. Read via
 * `getIslEdgeSensitivity()` in `../v2-envelope.js`, never directly.
 */
export interface ISLEdgeSensitivityV2 {
  /** Edge identifier in ISL "from->to" format */
  edge_id: string;
  /** Source node ID */
  from_id: string;
  /** Target node ID */
  to_id: string;
  /** Contrast type: 'existence' (edge forced on vs off) or 'magnitude' */
  sensitivity_type: 'existence' | 'magnitude';
  /**
   * Normalized sensitivity score (0-1): |elasticity| relative to the max
   * |elasticity| in the analysis (same normalization as factor
   * sensitivity_score). Not currently emitted outward by PLoT.
   */
  sensitivity_score?: number;
  /** Sign of the raw elasticity. Not currently emitted outward by PLoT. */
  direction?: 'positive' | 'negative';
  /** Raw elasticity: % change in outcome per % change in parameter */
  elasticity: number;
  /** Rank by |elasticity| across all edge contrasts (1 = most important) */
  importance_rank: number;
  /**
   * Human-readable explanation. Wording is provisional
   * (provisional_doctrine_v0 — ISL-owned analyzer output, passed through).
   */
  interpretation: string;
}

/**
 * One modelled pathway's signed structural contribution to the goal, from
 * the V2 wire `path_decomposition.paths[]` (ISL `PathContributionV2`).
 * Structural decomposition of the modelled effect, NOT a causal claim.
 * `mechanism` wording is provisional (provisional_doctrine_v0, ISL-owned).
 */
export interface ISLPathContributionV2 {
  /** Node IDs from the retained intervention target to the goal, in path order */
  path: string[];
  /** Signed product of per-edge coefficients along this path (structural only) */
  path_effect: number;
  /** Signed sum of path_effect across all enumerated paths (identical on every entry) */
  total_effect: number;
  /** path_effect / total_effect; omitted when indeterminate */
  signed_contribution?: number;
  /** 'computed' | 'indeterminate' (near-zero net modelled effect) */
  status: 'computed' | 'indeterminate';
  /** Human-readable modelled-pathway statement (provisional_doctrine_v0) */
  mechanism: string;
}

/**
 * Structural pathway decomposition on the V2 wire (top-level
 * `path_decomposition`, ISL `PathDecompositionV2`). Request-gated by
 * `include_path_decomposition` — absent unless explicitly requested.
 * First emitted by ISL build 9a22a1a (lane 11 / ISL PR #65); verified
 * against `tests/fixtures/isl-v2-live-20260707/isl-staging-capture-pathdecomp.json`.
 */
export interface ISLPathDecompositionV2 {
  /** The recommended option this decomposition explains (context/metadata) */
  recommended_option_id: string;
  /** Retained intervention target node IDs the paths start from */
  entry_nodes: string[];
  /** True when path enumeration exceeded the safety budget (paths suppressed) */
  truncated: boolean;
  /** Number of simple paths enumerated (== budget cap when truncated) */
  path_count: number;
  /** Top-3 paths ranked by |path_effect| */
  paths: ISLPathContributionV2[];
}

/**
 * ISL edge E-value from robustness analysis.
 * Measures evidence strength for each edge's causal effect direction.
 *
 * V2 wire location: NESTED at `robustness.edge_e_values` (verified against the
 * live staging capture `tests/fixtures/isl-v2-live-20260706/isl-staging-capture.json`,
 * ISL build f3f5d92). The top-level `edge_e_values` field is a V1-era location the
 * live V2 envelope never emits — read via `getIslEdgeEValues()` in
 * `../v2-envelope.js`, never directly.
 */
export interface ISLEdgeEValue {
  /** Edge ID in ISL format (e.g., "from->to") */
  edge_id: string;
  /** Source node ID (present on V2 nested entries; absent on legacy shapes) */
  from_id?: string;
  /** Target node ID (present on V2 nested entries; absent on legacy shapes) */
  to_id?: string;
  /** E-value (evidence strength) */
  e_value: number;
  /**
   * Direction the edge would need to flip to change the recommendation.
   * Live V2 wire emits 'increase' | 'decrease'; legacy documented values were
   * 'positive_to_negative' | 'negative_to_positive' | 'removal'. Typed open
   * because ISL owns this vocabulary and PLoT passes it through verbatim.
   */
  flip_direction: string;
  /** Current mean effect of this edge */
  current_mean: number;
  /** Mean effect at the flip point */
  flip_mean: number;
  /**
   * True when no finite change to this edge can flip the recommendation
   * (V2 nested entries only). NOT emitted outward by PLoT — contracts frozen;
   * recorded as a followup for contract work.
   */
  is_unflippable?: boolean;
}

/**
 * ISL per-factor EVPI entry from the V2 wire (top-level `factor_evpi`).
 *
 * Verified live (staging capture 2026-07-06, build f3f5d92): entries carry
 * true counterfactual EVPI per factor. NOT wired into any user-facing VOI/EVPI
 * surface yet (decision P-5 pending) — consumed only by the guarded internal
 * mapping in `../v2-envelope.js`.
 *
 * Raw `evpi` / `evpi_percentage_points` can drift slightly negative from Monte
 * Carlo sampling noise (observed live: -0.0015 / -0.15pp). Negative values are
 * sampling artefacts, never real signals — see `src/lib/evpi-emission.ts`.
 */
export interface ISLFactorEvpiEntry {
  /** Factor node ID */
  factor_id: string;
  /** EVPI as a fraction of the decision metric (can be MC-noise negative) */
  evpi: number;
  /** EVPI in percentage points of the decision metric (can be MC-noise negative) */
  evpi_percentage_points: number;
  /** Current value of the decision metric */
  current_metric: number;
  /** Decision metric under perfect information about this factor */
  perfect_metric: number;
  /** Which metric EVPI is measured on (e.g., 'p_win_recommended') */
  metric_type: string;
  /** Number of Monte Carlo samples used for the EVPI estimate */
  n_evpi_samples: number;
  /**
   * ISL's own emission classification for this estimate (newer ISL builds;
   * the 2026-07-06 live capture predates it). When present and
   * 'below_resolution', PLoT honours it: the entry is labelled
   * below-resolution regardless of PLoT's local threshold classification.
   */
  evpi_status?: 'ok' | 'below_resolution' | string;
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

  /**
   * Edge sensitivity (when 'sensitivity' in analysis_types).
   *
   * @deprecated DEAD ON THE LIVE V2 WIRE — the V2 envelope never emits
   * TOP-LEVEL edge sensitivity (verified 2026-07-06, build f3f5d92). As of
   * ISL build 9a22a1a (lane 11 / ISL PR #65, 2026-07-07) the wire carries a
   * NESTED replacement at `robustness.edge_sensitivity`
   * (`ISLEdgeSensitivityV2` shape) — read via `getIslEdgeSensitivity()` in
   * `../v2-envelope.js`. This top-level field is kept for fixture/legacy
   * tolerance only.
   */
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
    /**
     * Edge E-values — CANONICAL V2 wire location (verified live 2026-07-06,
     * build f3f5d92). The top-level `edge_e_values` sibling is a V1-era
     * location the live V2 envelope never emits. Read via
     * `getIslEdgeEValues()` in `../v2-envelope.js`.
     */
    edge_e_values?: ISLEdgeEValue[];
    /**
     * Edge-level sensitivity — CANONICAL V2 wire location (additive
     * optional; first emitted by ISL build 9a22a1a, lane 11 / ISL PR #65).
     * Absent on older deployed ISL builds — PLoT then emits the
     * EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE inference warning. Read via
     * `getIslEdgeSensitivity()` in `../v2-envelope.js`.
     */
    edge_sensitivity?: ISLEdgeSensitivityV2[];
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

  /**
   * Validation status from causal graph analysis.
   *
   * @deprecated DEAD ON THE LIVE V2 WIRE (verified 2026-07-06, build f3f5d92):
   * the V2 envelope never emits this field. All reads removed; kept for
   * fixture/legacy tolerance only.
   */
  validation_status?: 'identifiable' | 'uncertain' | 'cannot_identify';

  /**
   * Confidence in the validation assessment.
   *
   * @deprecated DEAD ON THE LIVE V2 WIRE — see `validation_status`.
   */
  validation_confidence?: 'high' | 'medium' | 'low';

  /**
   * Edge E-values measuring evidence strength for each edge's causal direction.
   *
   * @deprecated V1-era TOP-LEVEL location — the live V2 wire nests E-values at
   * `robustness.edge_e_values` (verified 2026-07-06, build f3f5d92). Read via
   * `getIslEdgeEValues()` which prefers the nested location.
   */
  edge_e_values?: ISLEdgeEValue[];

  /**
   * Per-factor counterfactual EVPI (V2 wire, top-level; verified live
   * 2026-07-06). P-5 PROMOTED (provisional_doctrine_v0, 2026-07-07): feeds
   * the factor_sensitivity "worth checking next" surface behind
   * `FLAGS.ISL_FACTOR_EVPI_INTERNAL` (staging/test ON, prod OFF), sanitised
   * via `mapIslFactorEvpi`. See `ISLFactorEvpiEntry`.
   */
  factor_evpi?: ISLFactorEvpiEntry[];

  /**
   * Response timestamp (ISO 8601) — the V2 wire's equivalent of the V1-era
   * `computed_at` field (which V2 never emits; verified live 2026-07-06).
   */
  timestamp?: string;

  /**
   * Reference-option disclosure (T1-5, additive optional; ISL build
   * 9a22a1a+): the option ID edge sensitivity, factor sensitivity, and the
   * fragile-edge classification were computed against (currently the first
   * option in the request). Disclosure only — PLoT passes it through
   * verbatim so consumers can surface the baseline instead of inventing one.
   */
  sensitivity_reference_option_id?: string;

  /**
   * Structural pathway decomposition (additive optional; ISL build
   * 9a22a1a+). Request-gated by `include_path_decomposition` — ISL only
   * emits it when explicitly requested, so presence implies opt-in.
   * PLoT passes it through verbatim (structural values are dimensionless
   * edge-coefficient products — no outcome-space denormalisation applies).
   */
  path_decomposition?: ISLPathDecompositionV2;

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
