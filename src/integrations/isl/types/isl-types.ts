import type { EnrichmentObjectiveRanking } from '@talchain/schemas/boundary';
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
 * ISL health check response from /health.
 *
 * NOTE: `status` is typed narrowly for legacy consumers, but the live ISL
 * `/health` actually returns `"healthy"`; PLoT's capability read does not depend
 * on `status`. The Codex F8 handshake fields (`compute_admission` + build
 * identity) are OPTIONAL — a pre-F8 ISL or a partial outage may omit them, and
 * their absence is treated as a version-skew signal (see compute-admission.ts).
 */
export interface ISLHealthResponse {
  status?: 'ok' | 'degraded' | 'unhealthy' | 'healthy' | string;
  version?: string;
  latency_ms?: number;
  build?: string;
  build_full?: string;
  config_fingerprint?: string;
  /** ISL-advertised live request-admission cost model (Codex F8). */
  compute_admission?: ISLComputeAdmission;
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
  /**
   * NO `mean` MEMBER. ISL's `ParameterUncertainty`
   * (isl/src/models/robustness_v2.py:254-267 @ 7d144c7f) declares
   * {node_id, distribution, std, range_min, range_max} and nothing else; the
   * sampling centre comes from the node's `observed_state.value`
   * (robustness_analyzer_v2.py:852-855, 891-892, 3490-3494). A `mean` sent here
   * was dropped by `extra: "ignore"`. Removed in contract step-2 slice 6.
   */
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
 * Seed-sweep stability band for one edge's flip threshold (ISL Track S
 * Phase 1, ISL PR #71). DEFAULT-ON in ISL since PR #76 (the
 * `ISL_FLIP_STABILITY_BANDS` env gate was removed) — present on every
 * edge_e_values entry ISL computed a band for. PLoT carries it through when
 * present and emits nothing when absent (an entry ISL had nothing to sweep,
 * or an older pre-#76 ISL build) — dark carry-through, A3 lane 3; units
 * alignment, A3 lane 4 — see the UNITS invariant below.
 *
 * Shape derived from ISL `FlipStabilityBandV2`
 * (src/models/response_v2.py:368-415 at ISL tip 5745154e) serialised with
 * `model_dump(by_alias=True, exclude_none=True)`:
 * - `n_seeds` / `n_seeds_flipped` / `seed_flip_means` are always present when
 *   the band is present;
 * - `band_min`/`band_median`/`band_max`/`band_width` are OMITTED (absent
 *   keys, never null) when `n_seeds_flipped == 0` — exclude_none drops None
 *   model fields;
 * - in-array nulls inside `seed_flip_means` DO survive exclude_none
 *   (pydantic drops None fields, not None list elements).
 *
 * ⚠ INTERPRETATION TRAP (ISL's own doc, carried verbatim): when
 * `n_seeds_flipped == 1`, `band_width` is 0.0 BY CONSTRUCTION (a single
 * value has zero range) — a naive width rubric would read maximal stability
 * from a single flipped background. Any consumer confidence rubric MUST
 * condition on `n_seeds_flipped`, never on `band_width` alone.
 *
 * ⚠ UNITS INVARIANT (A3 lane 4, Paul's 17 Jul ruling): on the /v2/run wire,
 * band values are ALWAYS in the same space as `flip_mean` on the same entry.
 * When PLoT denormalises the entry's `current_mean`/`flip_mean` into goal
 * units (active normalisation + resolvable goal range), `band_min`/
 * `band_median`/`band_max` and every non-null `seed_flip_means` cell receive
 * the IDENTICAL affine map, and `band_width` is RECOMPUTED from the mapped
 * endpoints (a width is a difference — it never receives the affine offset).
 * On the paths where `flip_mean` stays verbatim (no normalisation context;
 * `_normalised: true`), the band stays verbatim too. Consumers may therefore
 * compare band values with the sibling `flip_mean` directly, on every path.
 * NOTE: whether mapping a flip mean (an EDGE-STRENGTH-space quantity at the
 * ISL producer) through the GOAL-NODE outcome range is semantically right is
 * an open question logged for Neil covering flip_mean AND bands together —
 * this invariant guarantees internal consistency, not that semantics.
 */
export interface ISLFlipStabilityBandV2 {
  /**
   * Number of child seeds swept — ISL constant `FLIP_STABILITY_N_SEEDS`
   * (10 since ISL PR #76; the former env-select + [2, 20] clamp was removed
   * when bands went default-on).
   */
  n_seeds: number;
  /** Seeds whose sampled background admits a flip within [-1, 1]. When 0, the band_* fields are omitted. */
  n_seeds_flipped: number;
  /** Minimum flip mean across flipped seeds. Omitted when nothing flips. */
  band_min?: number;
  /** Median flip mean across flipped seeds. Omitted when nothing flips. */
  band_median?: number;
  /** Maximum flip mean across flipped seeds. Omitted when nothing flips. */
  band_max?: number;
  /**
   * band_max - band_min. Omitted when nothing flips. 0.0 BY CONSTRUCTION
   * when n_seeds_flipped == 1 — see the interpretation trap on the interface
   * doc; condition any width rubric on n_seeds_flipped.
   */
  band_width?: number;
  /** Per-child-seed flip mean, in child-seed order; null where that seed's background admits no flip. */
  seed_flip_means: Array<number | null>;
}

/**
 * Seed-sweep stability band for ONE FACTOR's flip value (ROADMAP 2.228-F3,
 * ISL `FactorFlipStabilityBandV2` at `src/models/response_v2.py:628` @ `35149dd1`).
 *
 * ⚠ NOT interchangeable with {@link ISLFlipStabilityBandV2}. Same shape, one
 * deliberate difference that ISL's own doc calls out: the list field is
 * `seed_flip_values` (FACTOR values in the normalised [0,1] domain of
 * `observed_state.value`), not `seed_flip_means` (EDGE strength means). Sharing
 * one name across two different quantities is the conflation class that has
 * cost this platform diagnoses before — hence two interfaces, not a union.
 *
 * ⚠ MEMBERSHIP: the base `flip_value` is NOT a member of this sweep — it is
 * derived against the expected-value background, which is never one of the
 * sampled backgrounds. `flip_value` MAY lie outside [band_min, band_max].
 *
 * ⚠ INTERPRETATION TRAP (identical to the edge band): when
 * `n_seeds_flipped === 1`, `band_width` is 0.0 BY CONSTRUCTION, so a naive
 * width rubric reads maximal stability from a single flipped background. Any
 * confidence rubric MUST condition on `n_seeds_flipped`.
 *
 * ⚠ NOT EMITTED ON THE PLoT WIRE TODAY — deliberately, not by oversight. Typed
 * here so the ISL boundary is complete and fail-loud, but `DenormalisedFlipThreshold`
 * carries no `stability` key: emitting a band in the normalised [0,1] factor
 * domain beside a `value_scale: 'display'` `flip_value` would break the units
 * invariant that `ISLFlipStabilityBandV2` establishes for the edge band ("band
 * values are ALWAYS in the same space as the sibling value"). Carrying it
 * correctly means threading the same affine map plus a RECOMPUTED `band_width`
 * — a separate, reviewable piece. Rowed, not dropped.
 */
export interface ISLFactorFlipStabilityBandV2 {
  /** Number of child seeds swept. */
  n_seeds: number;
  /** Seeds whose sampled background admits a flip inside [0,1]. When 0, band_* are omitted. */
  n_seeds_flipped: number;
  /** Minimum flip VALUE across flipped seeds. Omitted when nothing flips. */
  band_min?: number;
  /** Median flip VALUE across flipped seeds. Omitted when nothing flips. */
  band_median?: number;
  /** Maximum flip VALUE across flipped seeds. Omitted when nothing flips. */
  band_max?: number;
  /** band_max - band_min. Omitted when nothing flips. 0.0 by construction at n_seeds_flipped === 1. */
  band_width?: number;
  /** Per-child-seed flip VALUE, in child-seed order; null where that seed admits no flip. */
  seed_flip_values: Array<number | null>;
}

/**
 * Value at which changing ONE root factor changes the winning option
 * (ROADMAP 2.228-F3, ISL `FactorFlipValueV2` at `src/models/response_v2.py:690`
 * @ `35149dd1`, serialised `model_dump(by_alias=True, exclude_none=True)`).
 *
 * WHY THIS REPLACES PLoT'S OWN PROBE. PLoT's bisection probe
 * (`src/analysis/flip-thresholds.ts`) re-ran a full Monte Carlo per probe value
 * and selected candidates by |elasticity| AFTER lever suppression. The ROADMAP
 * 2.228 diagnosis proved with a live control that those candidates are
 * mathematically incapable of flipping the winner: for a factor no option
 * intervenes on and that is not upstream of differential severing, every
 * option's outcome moves by the IDENTICAL amount, so the argmax is invariant.
 * 43 live rows, zero `found` — every row shipped `flip_value: null` under a
 * `no_effect_within_bounds` label the probe had never actually established.
 *
 * ISL instead disables epsilon noise before post-MC structural analysis, which
 * makes the SCM exactly affine in a ROOT factor's value
 * (`goal_o(F) = A_o + T_o*F`); two deterministic evaluations per option measure
 * `(A_o, T_o)` exactly and the leader/rival crossing is closed form,
 * `F* = (A_i - A_j)/(T_j - T_i)`. No Monte Carlo ⇒ no sampling error, so no
 * noise floor is quoted; the honest uncertainty statement is `stability` alone.
 *
 * ⚠ NORMALISED DOMAIN. `current_value` and `flip_value` are in the normalised
 * [0,1] domain of `observed_state.value`. Denormalisation to user units is
 * PLoT's job — ISL never mixes a normalised number with a display unit. On the
 * PLoT wire they go through `denormaliseFlipThresholds`, which stamps
 * `value_scale: 'display'` ONLY when it genuinely denormalised against an
 * `explicit_cap` range.
 */
/**
 * The distribution ISL fitted to a user-stated range (ROADMAP 2.720).
 *
 * Mirrors ISL's `FittedDistribution` (isl/src/models/range_fit.py @ 686fcb7f).
 * The FAMILY PARAMETERS are the source of truth; `mean`/`std`/`q25`/`q75` are
 * derived read-only disclosure conveniences recomputed from them. The raw
 * `(lower, upper)` stay the stored source of truth UPSTREAM — this object is
 * derived at ISL's resolver and must never be persisted as if it were elicited.
 */
export interface ISLFittedDistribution {
  /** Fitted family — `unit_interval` domains fit beta, `unbounded` fit normal. */
  family: 'normal' | 'beta';
  /** Normal location μ (absent for a beta fit). */
  mu?: number;
  /** Normal scale σ > 0 (absent for a beta fit). */
  sigma?: number;
  /** Beta shape α > 0 (absent for a normal fit). */
  alpha?: number;
  /** Beta shape β > 0 (absent for a normal fit). */
  beta?: number;
  /** Distribution mean (derived). */
  mean: number;
  /** Distribution std (derived). */
  std: number;
  /** First quartile (derived; equals the stated lower bound). */
  q25: number;
  /** Third quartile (derived; equals the stated upper bound). */
  q75: number;
  /**
   * Credible-interval coverage the fit TARGETED. Ratified 0.5: the user's
   * stated bounds are treated as the fitted QUARTILES, with equal 25% tails.
   * Carried on the wire so a consumer never has to assume the convention.
   */
  coverage: number;
  /** FIT method provenance, e.g. `range-iq-fit-v1`. */
  method_version: string;
}

/**
 * ISL's TYPED refusal to fit a stated range (ROADMAP 2.720).
 *
 * ⚠ A REFUSAL IS NEVER A FALLBACK. It means: the value stays disclosed as
 * stated, NO distribution is produced, compute is untouched. PLoT must forward
 * it intact rather than flattening it into an absence or substituting a default
 * — ISL's own model comment names the alternative for what it is, *"a Beta(1,1)
 * minted on solver failure is a fabricated value wearing real provenance, this
 * estate's dominant defect"*.
 */
export interface ISLRangeFitRefusalPayload {
  /** Closed refusal vocabulary — ISL is the single source of truth for it. */
  code:
    | 'RANGE_ZERO_WIDTH'
    | 'RANGE_INVALID_ORDER'
    | 'RANGE_NON_FINITE'
    | 'RANGE_OUT_OF_DOMAIN'
    | 'RANGE_AT_DOMAIN_EDGE'
    | 'RANGE_OPEN_ENDED'
    | 'RANGE_FIT_NONCONVERGENT';
  /** Human-readable reason (sanitised by ISL). */
  message: string;
  /** The stated lower bound, echoed raw. */
  lower?: number | null;
  /** The stated upper bound, echoed raw. */
  upper?: number | null;
  /** The declared domain the fit was asked for. */
  domain: 'unit_interval' | 'unbounded';
  /** For RANGE_FIT_NONCONVERGENT: how many solver starts were tried. */
  starts_tried?: number | null;
}

/**
 * One disclosure row for one user-stated range (ROADMAP 2.720).
 *
 * Raw bounds AS SAID, plus EITHER `fitted` OR `refusal` — exactly one, enforced
 * both ways ISL-side. A consumer that reads only `fitted` will silently show
 * nothing for every refused range, which is precisely the state the typed
 * vocabulary exists to make visible.
 */
export interface ISLRangeFitDisclosure {
  /** The factor node the range was stated for. */
  node_id: string;
  /** Stated lower bound, echoed raw (null/absent = open-ended below). */
  lower?: number | null;
  /** Stated upper bound, echoed raw (null/absent = open-ended above). */
  upper?: number | null;
  /** The declared domain the family came from. */
  domain: 'unit_interval' | 'unbounded';
  /** The fitted distribution — present IFF the fit was accepted. */
  fitted?: ISLFittedDistribution;
  /** The typed refusal — present IFF the fit was refused. */
  refusal?: ISLRangeFitRefusalPayload;
}

export interface ISLFactorFlipValueV2 {
  /** Root factor node id. */
  factor_id: string;
  /**
   * The factor's current value in the NORMALISED [0,1] domain of
   * `observed_state.value` (0.0 when the factor carries only a
   * `parameter_uncertainties` entry).
   */
  current_value: number;
  /**
   * Normalised [0,1] value at which the winning option changes.
   *
   * ⚠ ABSENT-NOT-ZERO. Null whenever `flip_reason !== 'found'` — ISL never
   * fabricates an in-range number for a factor whose crossing lies outside the
   * domain, and PLoT must never clamp that null to 0. `exclude_none` means the
   * key may be ABSENT rather than explicitly null; both mean "no flip".
   */
  flip_value?: number | null;
  /**
   * Direction the factor must move from `current_value` to reach `flip_value`.
   *
   * ⚠ Null/absent exactly when `flip_value` is — ISL's own doc: "a direction
   * for a flip that does not exist would be a fabricated claim."
   */
  direction?: 'increase' | 'decrease' | null;
  /**
   * Attested reason. OPEN VOCABULARY per ISL — consumers must not exhaustively
   * switch on it. Known members at `35149dd1`:
   *
   * - `'found'` — a confirmed argmax change inside [0,1].
   * - `'no_effect_within_bounds'` — per-option transmission slopes genuinely
   *   differ, but no crossing lies inside [0,1].
   * - `'structurally_invariant'` — per-option transmission slopes are identical
   *   (spread <= 1e-9), so NO value of this factor can move the argmax. This is
   *   a MATHEMATICAL ATTESTATION, not a failed or timed-out probe — it is the
   *   honest wire statement for exactly the class PLoT's probe used to
   *   mislabel `no_effect_within_bounds`.
   * - `'candidate_cap_exceeded'` — a genuine candidate that ranked below
   *   `FACTOR_FLIP_MAX_CANDIDATES` by slope spread and was NOT evaluated;
   *   emitted rather than dropped so the omission is never silent. This is an
   *   UNRESOLVED row, not a no-effect row.
   */
  flip_reason: string;
  /** Option that becomes the argmax just past `flip_value`. Null unless `flip_reason === 'found'`. */
  alternative_winner_id?: string | null;
  /**
   * Argmax option at the expected-value baseline — the winner this flip is
   * measured AGAINST. ISL emits it per-row so a consumer can fail closed when
   * it disagrees with the MC-recommended option (ISL design R3): the E-value
   * search runs in the expected-value world, which is not guaranteed to agree
   * with the sampled recommendation.
   */
  baseline_winner_id: string;
  /**
   * Seed-sweep stability band. Present only for EVALUATED candidates — a
   * `'structurally_invariant'` row has no band because its no-flip is proven
   * rather than sampled. See {@link ISLFactorFlipStabilityBandV2} for why PLoT
   * does not yet re-emit this.
   */
  stability?: ISLFactorFlipStabilityBandV2;
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
  /**
   * Seed-sweep flip-threshold stability band (ISL PR #71). DEFAULT-ON since ISL
   * PR #76 — present when ISL computed a band for this entry; absent (key
   * omitted, never null) when it had nothing to sweep or on older pre-#76 ISL
   * builds. Carried through to the /v2/run response in the SAME space as the
   * entry's flip_mean (A3 lane 3 carry-through + lane 4 units alignment); see
   * ISLFlipStabilityBandV2 for the band_width/n_seeds_flipped interpretation
   * trap and the units invariant.
   */
  stability?: ISLFlipStabilityBandV2;
}

// REMOVED (F3, ISL #103 / D-23.15): `ISLFactorEvpiEntry` — the per-factor
// win-probability EVPI entry from the now-deleted top-level `factor_evpi[]`
// wire field. Its only consumer, `mapIslFactorEvpi` in ../v2-envelope.ts,
// read a name ISL no longer emits and silently fell back to the VOI×spread
// heuristic. Both are removed. The successors (`p_win_sensitivity`,
// `factor_evppi`) ride the raw top-level passthrough in routes/v2/run.ts;
// their firm shapes land with @talchain/schemas 0.23 / the S5 typed surface.

/**
 * ISL conditional winner analysis per factor.
 * Shows how the winning option changes conditional on factor value buckets.
 */
export interface ISLConditionalWinner {
  // NOTE: this describes UNVALIDATED wire JSON (`as`-cast, no runtime check).
  // `parseIslConditionalWinners` (src/routes/v2/run.ts) is what establishes the
  // guarantees these annotations only claim — see ISLConditionalBucket below for
  // what it cost to trust an annotation on this seam.
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
 *
 * ⚠ FIELD NAMES ARE ISL'S, DERIVED AT ISL'S BYTES — NOT PLoT's outbound names.
 * This interface previously declared `win_probability: number`. ISL has never
 * emitted that name: its own models call it **`winner_probability`**
 * (`BucketResultV2`, ISL `src/models/response_v2.py:1222-1232` @ `28fe0c95`;
 * `BucketResult`, `src/models/robustness_v2.py:1819-1831`; corroborated by the
 * pinned OpenAPI in this repo, `tests/fixtures/isl-pinned/isl-openapi.json`
 * @ ISL `686fcb7f`, which lists `winner_probability` as REQUIRED). Because the
 * wire is `as`-cast with no runtime validation
 * (`JSON.parse(text) as T`, src/integrations/isl/client.ts), the wrong name read
 * `undefined` forever and the numeric-egress guard dropped EVERY row —
 * `conditional_winners: []` on 1,270 consecutive live runs from 14 Jun 2026.
 * Renaming the outbound field would be the wrong repair: PLoT's public
 * `ConditionalBucket` name `win_probability` is what the shared contract and the
 * UI consumer read. The MAPPING is what was missing.
 *
 * Every member is optional here on purpose: this describes untrusted wire JSON,
 * and `parseIslConditionalWinners` (src/routes/v2/run.ts) is what turns it into
 * something PLoT may rely on. A required member on an unvalidated cast is the
 * defect class that produced this bug.
 */
export interface ISLConditionalBucket {
  /** MC samples in this bucket (ISL `n_samples`). Not forwarded — count, not science. */
  n_samples?: number;
  /** Winning option ID in this bucket */
  winner_id?: string;
  /** ISL's own label for the winner. PLoT resolves labels from its option map instead. */
  winner_label?: string;
  /** Runner-up option ID in this bucket */
  runner_up_id?: string;
  /** ISL's name for the bucket winner's win probability (ISL: required, [0,1]). */
  winner_probability?: number;
  /** ISL's name for the runner-up's win probability (ISL: optional, [0,1]). */
  runner_up_probability?: number;
  /**
   * ⚠ NOT EMITTED BY ISL at the pinned sha — zero occurrences of `mean_outcome`
   * anywhere in ISL `src/` @ `28fe0c95`, and absent from both `BucketResult` and
   * `BucketResultV2` in the pinned OpenAPI. Kept because the outbound contract
   * has an optional `mean_outcome` and the denormalisation path is already
   * guarded; it is forward-compatibility, not a field in flight today.
   */
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
  /**
   * CIL 0.2 provenance marker for p10/p50/p90, read at the bytes from ISL's
   * `OutcomeDistributionV2` (src/models/response_v2.py @ staging c25836f7):
   *
   *   percentiles_source: Literal["samples", "unavailable"] = Field(default="samples", ...)
   *
   * NOT `Optional` at the producer, so `exclude_none=True` never drops it and a
   * V2 wire always carries it. Declared optional HERE because a compile-time ISL
   * type is a fiction over untrusted wire data (an older build, or the V1 flat
   * path, sends nothing) — and because PLoT must be able to tell "not sent"
   * apart from either literal rather than defaulting.
   *
   * 'unavailable' co-occurs with absent `mean`/`std` and null p10/p50/p90 BY
   * PRODUCER INVARIANT (`_summary_stats_absent_only_without_samples` raises
   * otherwise), and `downside` may only ride when this is 'samples'
   * (`OptionResultV2._downside_requires_samples`).
   */
  percentiles_source?: 'samples' | 'unavailable';
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
  /**
   * Contract step-2 slice 6b: ISL echoes back, verbatim, the constraint_id PLoT
   * sent on the matching `goal_constraints[]` entry (ISL @0316098b onwards).
   *
   * Optional AND nullable, both deliberate — but ⚠ the SCOPE of the measurement
   * behind the `null` arm was wrong and is corrected here:
   *  - `undefined` — a pre-6b ISL that dropped the field at parse, AND the
   *    PINNED V2 PATH PLoT ACTUALLY USES. `client.ts:98` appends
   *    `?response_version=2` and `:180` sends `X-ISL-Response-Version: 2` on
   *    every call; ISL's V2 handler serialises fully-typed models with
   *    `model_dump(by_alias=True, exclude_none=True)`, and pydantic-v2's
   *    `exclude_none` IS recursive across nested models. So on PLoT's path the
   *    field is OMITTED when unsupplied.
   *  - `null` — the LEGACY v1 format, i.e. a request without the version pin.
   *    The capture that produced the earlier note here ("the deployed ISL sends
   *    null"; "exclude_none does not reach inside this object") was a hand-curl
   *    WITHOUT the pin, so it measured v1 and was generalised to a path PLoT
   *    never takes. A capture proves what it was pointed at.
   *
   * KEEP BOTH ARMS ANYWAY. Do NOT narrow to `string | undefined`, and do not
   * write a reader that tests for key-absence: the union costs nothing, it is
   * correct for a pre-6b ISL and for any un-pinned or re-versioned path, and it
   * is what forces the validate-before-compute discipline below.
   *
   * Read it via resolveConstraintIds (routes/v2/constraint-identity.ts), never
   * directly — the positional fallback beneath it is still load-bearing during
   * the overlap window.
   */
  constraint_id?: string | null;
  node_id: string;
  operator: string;
  threshold: number;
  value?: number;
  prob_satisfied: number;
  /**
   * Median failure margin, NORMALISED, as ISL sends it.
   *
   * `| null` is DEFENCE-IN-DEPTH, not a measurement of PLoT's path — ⚠ scope
   * corrected, same error as `constraint_id` above. The null was captured on
   * the LEGACY v1 format (a hand-curl without the version pin); on the pinned
   * V2 path PLoT actually uses, `exclude_none=True` is recursive and this key
   * is OMITTED, not null.
   *
   * The defect it documents was real as a TYPE defect, and the fix stands:
   * declaring it `number | undefined` was a compile-time fiction, both
   * denormalisation sites guarded with `!== undefined`, so a `null` would pass,
   * `null * rangeWidth` would evaluate to 0, and a FABRICATED MEASURED ZERO
   * breach margin would ship to egress — while the comment above that code
   * claimed the zero-fabrication had already been killed. What is NOT
   * established is that arm's live REACHABILITY at the current ISL pin: the
   * retro-proof went red on the null arm only, so #277's Instance-B
   * live-reachability premise inherits the same mis-scoping and should not be
   * cited as evidence of a shipping defect at this pin.
   *
   * Keep the `| null`. It is what makes `fmm * rangeWidth` a type error, so the
   * only way to compute with this value is to validate it first (nonNeg()).
   */
  failure_margin_median?: number | null;
  /** Near-miss rate in [0,1]. Nullable on the wire for the same reason. */
  near_miss_fraction?: number | null;
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
 * The per-option `status` vocabulary ISL actually emits.
 *
 * DERIVED, NOT COPIED. These are the three members of ISL's
 * `OptionResultV2.status` — `Literal["computed", "partial", "failed"]`
 * (`src/models/response_v2.py`). The pairing is ENFORCED, not asserted in
 * prose: `tests/isl-option-status-contract.test.ts` reads the enum out of the
 * vendored, Pydantic-generated `tests/fixtures/isl-pinned/isl-openapi.json`
 * (`components.schemas.OptionResultV2.properties.status.enum`) and fails the
 * day EITHER side drifts. Exported as a runtime tuple precisely so that test
 * can compare values rather than a type that erases at compile time.
 *
 * ⚠ WHAT THESE VALUES MEAN — read before branching on them. Derived from the
 * producer, `determine_option_status(n_valid, n_total)` in ISL's
 * `src/utils/response_builder.py`:
 *   - `failed`   — n_valid === 0. NO finite Monte Carlo samples. The option has
 *                  no usable distribution at all. This is the genuine failure.
 *   - `partial`  — 0 < valid/total < MIN_VALID_RATIO (0.8). A DISCLOSURE, not a
 *                  failure: ISL still emits a full `outcome` block and raises a
 *                  LOW_EFFECTIVE_SAMPLES critique. Do NOT treat as an error.
 *   - `computed` — valid/total >= 0.8.
 *
 * ⚠ `'skipped'` and `'error'` ARE NOT MEMBERS OF THIS SET. They belong to
 * PLoT's OWN EGRESS vocabulary, `PerFeatureStatus` in `src/types/engine-v3.ts`
 * ('computed' | 'unavailable' | 'skipped' | 'error'), and to ISL's
 * ENVELOPE-level `robustness_status` — both a level ABOVE a single option.
 * They were mirrored onto this per-option field by mistake (ROADMAP 2.744),
 * which made `hasOptionError` in routes/v2/run.ts permanently false and caused
 * one failed option to degrade a whole run. Do not reintroduce them here.
 */
export const ISL_OPTION_STATUS_VALUES = ['computed', 'partial', 'failed'] as const;

/** Per-option computation status as emitted by ISL. See ISL_OPTION_STATUS_VALUES. */
export type ISLOptionStatus = (typeof ISL_OPTION_STATUS_VALUES)[number];

/**
 * Option comparison result from ISL /api/v1/robustness/analyze/v2 response
 * Returned when analysis_types includes 'comparison'
 *
 * Supports both V1 (flat) and V2 (nested outcome) formats.
 */
export interface ISLOptionComparisonResult {
  /**
   * Option identifier — V1 (`OptionResult.option_id`, robustness_v2.py).
   *
   * ⚠ This comment said "V2 format uses option_id, V1 uses id" until ROADMAP
   * 2.744. That was INVERTED at the bytes, and it is what taught fixtures to
   * put `option_id` on an otherwise-V2 option shape. V2 uses `id` (below).
   */
  option_id?: string;
  /** Option identifier — V2 (`OptionResultV2.id`, response_v2.py; REQUIRED there). */
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
  /**
   * Per-option computation status.
   *
   * OPTIONAL here for exactly one reason: ISL's **V1** `OptionResult`
   * (`robustness_v2.py`) has NO `status` field at all, and this interface spans
   * both wire versions. On the **V2** wire it is REQUIRED
   * (`OptionResultV2.required` includes `status`), so `undefined` means
   * "legacy V1 shape", never "V2 declined to say". Consumers treat absent as
   * computed for that reason.
   */
  status?: ISLOptionStatus;
  /** Reason if status is not 'computed' */
  status_reason?: string;
  /** Per-option constraint analysis (present when goal_constraints sent) */
  constraint_analysis?: ISLConstraintAnalysis;
  /**
   * Per-option downside / tail-risk block (ISL `DownsideV2`, B2 — #91/#92,
   * hardened by #124/#125). ABSENT (key omitted, never `null`) when ISL could
   * not compute all three components honestly.
   *
   * ⚠ COMPILE-TIME TYPES ARE A FICTION OVER UNTRUSTED WIRE DATA. Declared here
   * as required numbers because that is what the producer declares — the
   * runtime validation that a wire value really is a finite number lives in
   * `buildDownside` (routes/v2/numeric-egress-guards.ts), which is the ONLY
   * path by which this reaches the public response.
   */
  downside?: ISLDownside;
}

/**
 * ISL per-option downside / tail-risk statistics (`DownsideV2`).
 *
 * The three fields ride TWO DIFFERENT sample populations by design:
 * `cvar_10`/`p05` are marginal tail metrics on the POST-noise samples (the same
 * population as `outcome.p10/p50/p90/mean`), while `expected_regret` is a JOINT
 * cross-option metric on the PRE-noise Common-Random-Numbers samples (the same
 * population as `win_probability`). All are in `outcome.mean`'s units.
 */
export interface ISLDownside {
  /**
   * Mean of the worst 10% of outcome samples (expected shortfall).
   * ⚠ The 0.10 tail mass is `DOCTRINE-PENDING(Neil)` at the producer — a
   * working default, not a ratified convention.
   */
  cvar_10: number;
  /** 5th-percentile outcome, same convention as p10/p50/p90. */
  p05: number;
  /** Joint expected regret vs the per-draw best option. `>= 0` by construction. */
  expected_regret: number;
}

/**
 * ISL robustness analysis response from /api/v1/robustness/analyze/v2
 *
 * Full response schema when all analysis_types are requested.
 */
export interface ISLRobustnessAnalyzeV2Response {
  /** Objective-aware ordered producer comparison; no legacy fallback. */
  objective_ranking?: EnrichmentObjectiveRanking;
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

  /**
   * Per-root-factor flip thresholds (ROADMAP 2.228-F3, ISL PR #117).
   *
   * REQUEST-GATED by `include_factor_flips` on the ISL request — PLoT sends
   * that flag unconditionally from `toISLRobustnessRequest`, so on the /v2/run
   * path presence is the normal case and ABSENCE means ISL's factor-flip phase
   * tripped its budget (ISL then discloses `FACTOR_FLIPS_UNAVAILABLE` on
   * `inference_warnings`, which run.ts already merges into the PLoT array — no
   * separate PLoT-side disclosure is minted for it).
   *
   * TOP-LEVEL on the envelope (beside `factor_sensitivity`), NOT nested under
   * `robustness` — verified against ISL `ISLResponseV2.factor_flip_values`
   * (`src/models/response_v2.py:1781` at ISL `35149dd1`).
   */
  factor_flip_values?: ISLFactorFlipValueV2[];

  /**
   * Per-range interquartile-fit disclosures for the request's
   * `user_stated_ranges` (ROADMAP 2.720 / ISL 2.521 Q1).
   *
   * REQUEST-GATED at the SOURCE: ISL emits the key only when ranges were
   * stated, so ABSENCE means "no ranges were sent", not "the fit failed" — a
   * failed fit arrives as a TYPED REFUSAL inside a present row. That
   * distinction is the whole point of the design and consumers must preserve
   * it; see the refusal payload's own note that a Beta(1,1) minted on solver
   * failure would be a fabricated value wearing real provenance.
   *
   * TOP-LEVEL on the envelope (beside `factor_sensitivity` /
   * `factor_flip_values`), NOT nested under `robustness` — verified against
   * DEPLOYED ISL build 686fcb7, whose live captures are frozen at
   * `tests/fixtures/isl-range-fit-live-20260807/`, and against
   * `ISLResponseV2.range_fit_disclosures` in the pinned OpenAPI.
   *
   * CARRIED, NOT APPLIED (S3): ISL's compute is byte-identical whether or not
   * the request carried ranges. This is a disclosure surface, not an input to
   * the maths.
   */
  range_fit_disclosures?: ISLRangeFitDisclosure[];

  /** Overall robustness assessment (when 'robustness' in analysis_types)
   *
   * Supports both V1 and V2 (Option C) formats:
   * - V1: { score, label: 'robust'|'moderate'|'fragile', explanation }
   * - V2: { confidence, level: 'high'|'medium'|'low'|'very_low', is_robust, recommendation_stability }
   */
  robustness?: {
    /** Robustness score (0-1) - V1 format */
    score?: number;
    /**
     * V2/Option C `confidence` slot (0-1).
     *
     * NOT a confidence level. Since ISL PR #114 (2026-07-26) this carries the
     * UNCALIBRATED recommendation-stability fraction — the share of sampled
     * scenarios the recommended option won — served under a legacy field name.
     * It was min(0.99, stability * (1 - 1/sqrt(n_samples))); the shrinkage and
     * the cap are withdrawn, so the value is strictly higher and can now reach
     * exactly 1.0.
     *
     * Read `confidence_basis` before interpreting this. See
     * src/integrations/isl/confidence-basis.ts.
     */
    confidence?: number;
    /**
     * Machine-readable semantics marker for `confidence`, added by ISL PR #114
     * so consumers branch rather than infer. Absent on pre-#114 payloads,
     * which is why PLoT resolves it through an allow-list rather than casting.
     */
    confidence_basis?: string;
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

  // REMOVED (F3, ISL #103 / D-23.15): the top-level `factor_evpi[]`
  // (per-factor win-probability EVPI) field. ISL renamed it — the
  // win-probability successor is `p_win_sensitivity` and the outcome-unit
  // value of partial perfect information is `factor_evppi` (both typed on the
  // PLoT response as `unknown` passthrough in engine-v3.ts, firm shapes
  // pending @talchain/schemas 0.23 / S5). PLoT no longer consumes the old
  // name; re-adding it here is blocked by `src/types/isl-no-factor-evpi.type-pin.ts`.

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
   * Inference warnings from ISL, forwarded into PLoT's inference_warnings array.
   *
   * F4 (Codex deep review): the REAL ISL `InferenceWarning` wire shape (LIVE
   * from ISL #79) is `{code, field, detail:{reason, elapsed_ms, message, ...},
   * severity}` — `severity` is now producer-supplied (default 'info'; the four
   * budget-degradation codes are 'warning'), and the human copy + timing live
   * under `detail`. Top-level `message`/`severity`/`elapsed_ms`/`node_id` are
   * kept OPTIONAL for back-compat with older fixtures/captures that used the
   * flat shape; PLoT's merge reads detail-first, then the flat fallbacks.
   */
  inference_warnings?: Array<{
    code: string;
    /** Field path the warning is about (e.g. 'factor_evppi', 'path_decomposition'). */
    field?: string;
    severity?: 'info' | 'warning';
    /** Flat human copy (older captures); real shape carries it under `detail`. */
    message?: string;
    /** Flat timing (older captures); real shape carries it under `detail`. */
    elapsed_ms?: number;
    /** Flat node id (older per-node captures). */
    node_id?: string;
    /** The real nested payload. */
    detail?: {
      reason?: string;
      message?: string;
      elapsed_ms?: number;
      node_id?: string;
      field?: string;
      [key: string]: unknown;
    };
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

// ===========================================================================
// ISL /health compute-admission capability (Codex F8 handshake, Option B)
// ===========================================================================
//
// ISL advertises its LIVE request-admission cost model on `/health` under
// `compute_admission` (Inference-Service-Layer src/services/robustness_analyzer_v2.py
// `build_compute_admission()`; single source of truth for BOTH the ISL admission
// gate and this advertisement). PLoT READS this block and derives its
// sample-reduction planning from it — it does NOT hand-copy the coefficients
// (that would re-introduce the drift trap). See src/config/sampling.ts
// (planSampleDepth / estimateWeightedCostV2) and src/integrations/isl/compute-admission.ts.
//
// The `weights` object carries the ISL-derived coefficients that PLoT feeds to
// the version-keyed cost estimator at runtime; the FORMULA SHAPE is keyed by
// `complexity_formula_version` so PLoT fails loud on an unknown future shape
// rather than silently mis-planning against a formula it does not understand.

/**
 * ISL-advertised per-phase cost coefficients.
 *
 * ⚠ THIS INTERFACE IS A CONVENIENCE VIEW, NOT THE CONTRACT. The authoritative
 * per-version key set lives in `src/config/sampling.ts`
 * (`COMPLEXITY_FORMULA_SPECS`), is validated at runtime against the LIVE
 * advertisement, and is what the estimators are checked against. The fields
 * below are the union across the formula shapes PLoT implements, so a v2-only
 * block does not carry the v5-only ones — never read a coefficient here without
 * going through a version's declared key set.
 */
export interface ISLComputeAdmissionWeights {
  /** base MC term: units per sample × option × (nodes+edges) evaluate(). */
  base_per_sample_per_option_per_struct: number;
  /** EVPI samples are capped at this value in the EVPI cost term. */
  evpi_sample_cap: number;
  /** edge-sensitivity coefficient. */
  sensitivity_coef: number;
  /** e-values coefficient. */
  evalue_coef: number;
  /** stability-bands coefficient (bands ride on e-values). */
  bands_coef: number;
  /** path-decomposition coefficient. */
  path_coef: number;
  /** path-decomposition is bounded by this many decomposition paths. */
  max_decomposition_paths: number;
  /** v5+: value-of-control (EVPC) grid coefficient. */
  evpc_coef?: number;
  /** v5+: full-population EVPPI (S2 regression) coefficient. */
  evppi_full_coef?: number;
  /** v5+: null-permutation count K in the full-population EVPPI term. */
  evppi_null_permutations?: number;
  /** v5+: factor-flip coefficient. */
  factor_flip_coef?: number;
  /** v5+: structural-influence walk pool (a FLAT charge, not a coefficient). */
  influence_walk_pool?: number;
}

/**
 * ISL-advertised per-TERM structural parameters — the numbers a term's own loop
 * bounds itself by, as opposed to the per-phase coefficients in `weights`.
 * Advertised at `compute_admission.formula_parameters`, keyed BY TERM NAME (the
 * same strings ISL's `WeightedCost.terms` uses).
 *
 * ⚠ A SIBLING OF `weights`, DELIBERATELY (ISL `build_compute_admission.__doc__`,
 * PR #119). PLoT couples the `weights` KEY SET exactly to the formula version,
 * so growing `weights` would force a lockstep release or drop PLoT to its
 * conservative fallback. Parameters landing here are additive at the seam.
 *
 * PLoT treats these as REQUIRED for any version whose estimator reads them —
 * see `COMPLEXITY_FORMULA_SPECS`. An absent or incomplete `formula_parameters`
 * leaves that version UNADMITTED (fail-closed), never priced with a guessed
 * constant.
 */
export interface ISLComputeAdmissionFormulaParameters {
  /** `factor_flips` term: O·W·(1 + 2N + 2·C·(max(O−1,0) + B)). */
  factor_flips?: {
    /** C — the candidate cap the flip phase truncates to. */
    max_candidates: number;
    /** B — the number of stability-band background seeds. */
    stability_seeds: number;
  };
  /** `sensitivity` term: coef·E·min(cap, ⌊S/divisor⌋)·W. */
  sensitivity?: {
    /** The sub-sweep sample cap (ISL `SENSITIVITY_SUBSAMPLE_CAP`). */
    subsample_cap: number;
    /** The sub-sweep sample divisor (ISL `SENSITIVITY_SUBSAMPLE_DIVISOR`). */
    subsample_divisor: number;
  };
  /**
   * v6+ `alternative_winners` term: coef·O·(1 + min(E, max_edges)·k)·W.
   * ROADMAP 2.356 — before v6 this phase's marginal-switch sweep was uncapped
   * and unpriced, so neither number existed to advertise.
   */
  alternative_winners?: {
    /** The fragile-edge cap the marginal sweep truncates to (ISL `MARGINAL_MAX_EDGES`). */
    max_edges: number;
    /** Isolated re-draws per priced edge (ISL `MARGINAL_K_SAMPLES`). */
    marginal_k_samples: number;
  };
}

/**
 * ISL-advertised structural caps (a SEPARATE gate from the cost ceiling).
 *
 * Same convenience-view caveat as the weights: the authoritative per-version
 * cap-key set is declared in `COMPLEXITY_FORMULA_SPECS` and validated against
 * the live block.
 */
export interface ISLComputeAdmissionCaps {
  max_options: number;
  max_nodes: number;
  max_edges: number;
  max_parameter_uncertainties: number;
  /** v5+: cap on the number of value-of-control candidates. */
  max_control_candidates?: number;
  /** v5+: cap on the number of values per control candidate. */
  max_control_values?: number;
}

/**
 * The `compute_admission` block advertised on ISL `/health`. `max_cost_units`
 * is the LIVE enforced cost ceiling (env-resolved on ISL); `weights` are the
 * live coefficients PLoT feeds to its version-keyed estimator.
 */
export interface ISLComputeAdmission {
  /** Live enforced ceiling, in ISL "cost units" (NOT the old scalar units). */
  max_cost_units: number;
  /** Formula-shape version. PLoT plans only for versions it knows. */
  complexity_formula_version: string;
  weights: ISLComputeAdmissionWeights;
  caps: ISLComputeAdmissionCaps;
  /**
   * Per-term structural parameters. OPTIONAL on the wire (ISL added it in
   * PR #119 and older deployments do not carry it) — which is precisely why a
   * version that needs it must fail closed rather than assume a default.
   */
  formula_parameters?: ISLComputeAdmissionFormulaParameters;
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
