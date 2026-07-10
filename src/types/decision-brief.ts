/**
 * Decision Brief V1
 *
 * Shareable artefact assembled from completed analysis runs.
 * Pure assembly from existing computed fields — no new service calls, no LLM.
 * Persistence is UI/Supabase's responsibility; PLoT computes and returns.
 */

// =============================================================================
// Core Brief Types
// =============================================================================

export interface DecisionBriefV1 {
  /** Deterministic brief identifier: SHA-256 of graph_hash:seed:config_version formatted as UUID v4 */
  brief_id: string;
  /** Schema version for migration */
  version: '1';

  // Snapshot identity — immutable binding to the analysis that produced this
  /** Canonical response hash (same as response_hash) */
  graph_hash: string;
  /** Seed used for Monte Carlo simulation */
  seed: number;
  /** ISO-8601 timestamp when brief was assembled */
  created_at: string;

  // Content
  /** Top-level narrative summary */
  headline: string;

  /** Options ranked by win_probability descending */
  options: BriefOption[];

  /** Top factors by absolute elasticity (max 5) */
  top_drivers: BriefDriver[];

  /** Key assumptions from evidence gaps (max 10) */
  key_assumptions: string[];
  /** What would need to change to flip the recommendation (max 10) */
  what_would_change: string[];

  /**
   * Graph perturbation stability — a direct projection of ISL
   * `robustness.level` via `mapRobustnessLevel` in `src/assembly/decision-brief.ts`.
   *
   * **This field is NOT an action-readiness assessment.** It does not
   * consult fragile edges, evidence gaps, low driver confidence, or
   * `recommendation_stability`. A brief can carry `robustness: 'robust'`
   * while simultaneously containing material fragile edges and high-VoI
   * evidence gaps — in that case the underlying decision surface is
   * structurally stable to small perturbations, but the wider scientific
   * picture is more cautious.
   *
   * Consumers wanting action-readiness signals should also check:
   *   - `warnings` (PARTIAL_ANALYSIS, model critiques);
   *   - `key_assumptions` (high-VoI evidence gaps);
   *   - `what_would_change` (fragile edges and top drivers);
   *   - `headline` (which is tone-gated by PR #174 `deriveReadinessTone` in
   *     `src/coaching/readiness-tone.ts` against the broader signal set —
   *     fragile edges, robustness level, recommendation stability, evidence
   *     gaps, low driver confidence, near-tie status).
   */
  robustness: 'robust' | 'moderate' | 'fragile';

  /** Merged warnings from critiques and model critiques (max 10) */
  warnings: BriefWarning[];

  // Provenance
  /** Lineage information for audit trail */
  lineage: BriefLineage;

  // ===========================================================================
  // Lane PLoT-R3 (roadmap 2.7 producer leg) — ADDITIVE claim-safe surfaces.
  // All optional: absent on pre-R3 briefs and when
  // BRIEF_CLAIM_SAFE_SURFACES_ENABLE is '0'/'false' (golden-fixture
  // byte-identity gate). All wording is provisional_doctrine_v0.
  // ===========================================================================

  /**
   * Deterministic leader claim banded by win-probability gap (the producer
   * leg of the UI's UI-SEM-060 leader-claim banding debt — "Remove when PLoT
   * provides a leader-confidence band / close-call signal").
   * Absent when fewer than two ranked options exist (no comparative claim
   * is made without a comparison).
   */
  headline_banded?: BriefBandedHeadline;

  /**
   * Defaulted-input disclosures: factors ISL substituted a default value for
   * (`value_defaulted: true`, intervention-pinned levers excluded) plus
   * run-level default disclosures echoed from DEFAULT-coded inference
   * warnings. Max 10, deterministic order.
   */
  defaulted_assumptions?: BriefDefaultedAssumption[];

  /** Honest robustness wording derived from is_robust / level (never invented). */
  robustness_caveat?: BriefRobustnessCaveat;

  /**
   * Echo of warning-severity inference-warning codes from the run response
   * (codes only — no numbers, no prose). Sorted, deduplicated. [] when the
   * run carried no warning-severity inference warnings.
   */
  warning_codes?: string[];

  // ===========================================================================
  // Platform lane (roadmap 3.1) — decision-record capture surface. ADDITIVE,
  // optional, flag-gated DEFAULT-OFF (BRIEF_DECISION_RECORD_SUMMARY_ENABLE).
  // ===========================================================================

  /**
   * Display-safe analysis summary for decision-record capture, shaped
   * EXACTLY like @talchain/schemas 0.15.0 DecisionRecordAnalysisSummarySchema
   * (`.strict()`) so the CEE capture hook copies it verbatim into
   * `DecisionRecordDecision.analysis_summary` — zero mapping (seam ratified
   * 2026-07-10): leading_option = rank-1 option label · win_probability =
   * rank-1 win probability · goal_fit = leader's probability_of_joint_goal
   * (OMITTED when absent — never invented) · robustness_band =
   * `robustness.display_verdict` verbatim incl. 'not_assessed' (OMITTED when
   * the verdict is absent — never derived from another signal).
   *
   * Optional-forward by design: absent when the flag is off, and a decision
   * record is valid without it (the brief itself is also null when
   * robustness/options are missing — consumers must tolerate absence).
   */
  analysis_summary?: BriefAnalysisSummary;
}

/**
 * Mirror of DecisionRecordAnalysisSummarySchema (0.15.0). Kept structurally
 * identical — tests/decision-brief.analysis-summary.test.ts pins the emitted
 * value against the schema's `.strict()` parse, so drift fails CI.
 */
export interface BriefAnalysisSummary {
  leading_option?: string;
  win_probability?: number;
  goal_fit?: number;
  robustness_band?: string;
}

// =============================================================================
// Lane PLoT-R3 claim-safe surface types (all wording provisional_doctrine_v0)
// =============================================================================

/**
 * Gap bands for the leader claim. 'clearly_ahead' is ONLY emitted when the
 * run's robustness is established (is_robust === true, or level 'high' with
 * no explicit is_robust === false) — a large gap without robustness is
 * downgraded to 'slightly_ahead' with robustness_gated: true.
 */
export type BriefHeadlineBand = 'very_close' | 'slightly_ahead' | 'clearly_ahead';

export interface BriefBandedHeadline {
  /** provisional_doctrine_v0 wording — claim-safe leader sentence */
  text: string;
  band: BriefHeadlineBand;
  leader_option_id: string;
  leader_label: string;
  runner_up_option_id: string | null;
  runner_up_label: string | null;
  /** win_probability(leader) − win_probability(runner-up), [0,1] */
  win_probability_gap: number;
  /**
   * True when the gap alone qualified for 'clearly_ahead' but robustness was
   * not established, so the claim was downgraded to 'slightly_ahead'.
   */
  robustness_gated: boolean;
  doctrine: 'provisional_doctrine_v0';
}

export interface BriefDefaultedAssumption {
  /** Factor label when the disclosure is factor-scoped; null for run-level disclosures */
  factor_label: string | null;
  /** provisional_doctrine_v0 wording (factor-scoped) or verbatim warning echo (run-level) */
  note: string;
  /**
   * 'value_defaulted'     — factor_sensitivity[*].value_defaulted === true
   * 'default_disclosure'  — inference warning whose code names a default
   */
  source: 'value_defaulted' | 'default_disclosure';
  /** Inference-warning code for 'default_disclosure' entries */
  code?: string;
  doctrine: 'provisional_doctrine_v0';
}

export interface BriefRobustnessCaveat {
  /** provisional_doctrine_v0 wording — honest, no invented certainty */
  text: string;
  /**
   * Which upstream signal the wording was derived from:
   * 'is_robust' — ISL boolean flag; 'level' — ISL robustness level;
   * 'absent' — neither present (wording says robustness was not assessed).
   */
  basis: 'is_robust' | 'level' | 'absent';
  doctrine: 'provisional_doctrine_v0';
}

export interface BriefOption {
  option_id: string;
  label: string;
  /** Win probability [0, 1] */
  win_probability: number;
  /** 1-indexed rank by win_probability desc */
  rank: number;
}

export interface BriefDriver {
  factor_label: string;
  /** Absolute elasticity value */
  sensitivity: number;
  direction: 'positive' | 'negative';
}

export interface BriefWarning {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

export interface BriefLineage {
  plan_id?: string;
  prompt_version?: string;
  model_id?: string;
  config_version: string;
  response_hash: string;
  /** Track S: resolved Monte Carlo sample depth the brief was computed at (additive, optional) */
  n_samples?: number;
}

// =============================================================================
// Schema Version Constant
// =============================================================================

export const DECISION_BRIEF_VERSION = '1' as const;
