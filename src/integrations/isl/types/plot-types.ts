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
  /**
   * Identifiability status.
   *
   * `identifiable` / `uncertain` / `cannot_identify` are SCIENTIFIC VERDICTS —
   * each asserts something substantive about the user's graph, and each may be
   * set ONLY from a validation ISL actually computed.
   *
   * `unavailable` is NOT a verdict. It is the typed refusal PLoT degrades to
   * when no validation was obtained (ISL disabled, unmounted route → 404,
   * timeout, 5xx, circuit-breaker trip). It exists precisely so a non-result
   * cannot be mistaken for `uncertain`: the fallback previously returned
   * `uncertain`, which routes/v1/run.ts rendered as "ISL validation reports
   * partial identifiability" tagged `source: 'isl'` — a claim about the user's
   * graph attributed to a service that returned 404 (ROADMAP 1.240).
   *
   * Consumers MUST NOT collapse `unavailable` into any verdict branch — not
   * into `uncertain`, and not into "not identifiable" via a
   * `status === 'identifiable'` boolean.
   */
  status: 'identifiable' | 'uncertain' | 'cannot_identify' | 'unavailable';
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
  /**
   * Overall model robustness — a VERDICT.
   *
   * OPTIONAL (ROADMAP 1.240, sibling 2): absent when nothing was assessed.
   * The `/v1/run` builder populates it from
   * `PLoTRobustnessAnalysisResult.overall_robustness`, which is itself now
   * omitted rather than defaulted to 'moderate'.
   */
  overall_robustness?: 'robust' | 'moderate' | 'fragile';
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
 * Normalized edge info for fragile/robust edges.
 * Provides consistent object shape regardless of ISL format variations.
 */
export interface NormalizedEdgeInfo {
  /** Edge ID in "from->to" or "from::to" format */
  edge_id: string;
  /** Source node ID */
  from_id: string;
  /** Target node ID */
  to_id: string;
  /**
   * Probability that flipping this edge switches the recommended option.
   *
   * ⚠ SCALE — HIGHER MEANS MORE FRAGILE. Corrected 2026-07-30: this comment
   * previously read "(0=fragile, 1=robust)", which is the scale INVERTED, and
   * that inverted reading is exactly how a fabricated `1` came to be described
   * as "full stability" when it is in fact the maximum of the fragility scale.
   * `classifyEdgeSeverity` (>0.7 critical, >0.5 error) and the doctrine-013
   * `visible` gate are both monotonically INCREASING in this field, which is
   * the authority for the direction. Matches `NormalizedEdgeInfoV3` in
   * types/engine-v3.ts and `EnrichmentRobustnessEdgeSchema` in @talchain/schemas.
   *
   * OPTIONAL: omitted when the source (an ISL fragile edge, or a legacy
   * "from->to" string edge) carries no switch_probability. Absent means NOT
   * COMPUTED — never 0 and never 1. A fabricated 0 fabricates the safest
   * possible verdict; a fabricated 1 the most alarming; either also fabricates
   * severity and the doctrine-013 `visible` flag downstream. Branch on presence
   * (`typeof x === 'number'`), never coalesce.
   */
  switch_probability?: number;
  /** Marginal probability of recommendation switch for this edge */
  marginal_switch_probability?: number;
  /** Option that would win if this edge changes (from ISL) */
  alternative_winner_id?: string;
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
  /**
   * Overall robustness assessment — a VERDICT about the user's graph.
   *
   * OPTIONAL (ROADMAP 1.240, sibling 2). Emitted only when ISL supplied
   * `robustness.label`, or a `robustness.level` this adapter can map. It was
   * required, and `adaptRobustnessAnalysisResponse` met that requirement by
   * falling through `mapLevelToLabel(undefined)` → 'moderate', so an ISL
   * response carrying neither field published a moderate-robustness verdict
   * PLoT had invented. Absent means "not assessed"; it must never be widened
   * back to a required field, and consumers must not default it.
   */
  overall_robustness?: 'robust' | 'moderate' | 'fragile';
  /**
   * Robustness score (0-1).
   *
   * OPTIONAL for the same reason — it used to end `?? 0.5`, publishing a
   * precise-looking midpoint for a quantity ISL never measured.
   */
  robustness_score?: number;
  /**
   * Edges identified as fragile - normalized to consistent object shape.
   * Contains edge_id, from_id, to_id, and optional switch_probability.
   */
  fragile_edges: NormalizedEdgeInfo[];
  /**
   * Edges identified as robust - normalized to consistent object shape.
   * Contains edge_id, from_id, to_id, and `switch_probability` ONLY when ISL
   * measured one. It formerly "defaulted to 1.0"; ISL sends robust_edges as
   * bare `"from->to"` strings that carry no measurement, and 1.0 is the
   * maximum of an INVERTED scale (switch_probability high = fragile), so the
   * default was both fabricated and backwards. See normalizeRobustEdge.
   */
  robust_edges: NormalizedEdgeInfo[];

  // ============ Metadata ============
  /** ISL latency in milliseconds */
  latency_ms: number;
  /** Source of the result */
  source: 'isl' | 'unavailable';
  /**
   * Errors encountered during edge normalization.
   * Present only if ISL returned malformed edge data.
   */
  normalization_errors?: EdgeNormalizationError[];
}

/**
 * Error encountered during edge normalization.
 */
export interface EdgeNormalizationError {
  /** Type of edge that failed normalization */
  edge_type: 'fragile' | 'robust';
  /** Error description */
  error: string;
  /** Original malformed value (for debugging) */
  raw_value?: unknown;
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
  /**
   * Overall robustness assessment from factor analysis — a VERDICT.
   * OPTIONAL (ROADMAP 1.240, sibling 2); omitted when ISL assessed nothing.
   * This object IS emitted on the `/v1/run` response (`isl_factor_sensitivity`),
   * so a fabricated label here was user-visible.
   */
  robustness_label?: 'robust' | 'moderate' | 'fragile';
  /** Robustness score (0-1). OPTIONAL for the same reason. */
  robustness_score?: number;
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
  /** Marginal probability of recommendation switch for this edge */
  marginal_switch_probability?: number;
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
  /**
   * Sensitivity score, as ISL measured it.
   *
   * OPTIONAL — omitted when ISL supplied neither `sensitivity_score` nor the
   * legacy `sensitivity`, or supplied a non-finite one. It was REQUIRED, and
   * that requirement was the entire justification for `enrichFactorSensitivity`
   * ending `?? 0`: a factor ISL said nothing about was published as a factor
   * measured to have zero influence (ROADMAP 1.240, sibling 1). A required
   * numeric field on data that can legitimately be absent is a standing
   * instruction to fabricate, so the field moved rather than the honesty.
   *
   * Consumers must treat absence as "not measured", never as 0.
   */
  sensitivity?: number;
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
  /**
   * @deprecated NO LONGER POPULATED (lane PLoT-H item B, 2026-07-07):
   * ISL's recommendation_stability is the leader's win_probability relabelled
   * (option_wins[winner]/n_samples) — zero independent information. Kept on
   * the type for inbound tolerance only; buildRobustnessDataForCee omits it.
   */
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
