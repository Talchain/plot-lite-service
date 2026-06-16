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
