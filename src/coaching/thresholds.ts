/**
 * C2: Decision Thresholds
 *
 * Centralized threshold configuration for M1 coaching components.
 * Internal-only (NOT API-exposed), reads from environment/config.
 * Always emits thresholds_used for auditability.
 */

export interface CoachingThresholds {
  // B1: Headlines
  headline_clear_winner_delta: number;
  headline_clear_winner_stability: number;
  headline_moderate_winner_delta: number;
  headline_moderate_winner_stability: number;
  headline_close_call_delta: number;
  headline_high_uncertainty_voi: number;
  headline_high_uncertainty_fragile: number;
  headline_fragile_edge_min: number;

  // B2: Evidence Gaps
  evidence_gap_min_voi: number;
  evidence_gap_top_quartile: boolean;
  evidence_gap_floor: number;
  evidence_gap_cap: number;

  // B3: Critiques
  critique_dominant_factor_threshold: number;
  critique_influential_external_quartile: number;
  critique_narrow_framing_max_options: number;
  critique_anchoring_baseline_value: number;
  critique_overconfidence_threshold: number;

  // B4: Next Actions
  action_fragile_edge_threshold: number;
  action_high_voi_threshold: number;

  // C3: Readiness Signals
  readiness_high_evidence_gap_count: number;
  readiness_high_voi_threshold: number;

  // C4: Joint Probability Gate (Task 1)
  readiness_joint_prob_floor: number;
  readiness_joint_prob_close_call: number;
}

/**
 * Default thresholds used across all M1 coaching components.
 * These values are tuned based on ISL response distributions and
 * decision quality requirements.
 */
export const DEFAULT_THRESHOLDS: CoachingThresholds = {
  // B1: Headlines
  headline_clear_winner_delta: 0.20,
  headline_clear_winner_stability: 0.70,
  headline_moderate_winner_delta: 0.10,
  headline_moderate_winner_stability: 0.50,
  headline_close_call_delta: 0.10,
  headline_high_uncertainty_voi: 0.30,
  headline_high_uncertainty_fragile: 0.25,
  headline_fragile_edge_min: 0.15,

  // B2: Evidence Gaps
  evidence_gap_min_voi: 0.0,
  evidence_gap_top_quartile: true,
  evidence_gap_floor: 3,
  evidence_gap_cap: 3,

  // B3: Critiques
  critique_dominant_factor_threshold: 0.50,
  critique_influential_external_quartile: 0.25,
  critique_narrow_framing_max_options: 2,
  critique_anchoring_baseline_value: 0.5,
  critique_overconfidence_threshold: 0.85,

  // B4: Next Actions
  action_fragile_edge_threshold: 0.20,
  action_high_voi_threshold: 0.40,

  // C3: Readiness Signals
  readiness_high_evidence_gap_count: 2,
  readiness_high_voi_threshold: 0.40,

  // C4: Joint Probability Gate
  readiness_joint_prob_floor: 0.05,
  readiness_joint_prob_close_call: 0.30,
};

/**
 * Get coaching thresholds from environment/config with fallback to defaults.
 *
 * Environment variable mapping (all optional):
 * - M1_THRESHOLD_CLEAR_WINNER_DELTA
 * - M1_THRESHOLD_CLEAR_WINNER_STABILITY
 * - M1_THRESHOLD_MODERATE_WINNER_DELTA
 * - M1_THRESHOLD_MODERATE_WINNER_STABILITY
 * - M1_THRESHOLD_CLOSE_CALL_DELTA
 * - M1_THRESHOLD_HIGH_UNCERTAINTY_VOI
 * - M1_THRESHOLD_HIGH_UNCERTAINTY_FRAGILE
 * - M1_THRESHOLD_FRAGILE_EDGE_MIN
 * - M1_THRESHOLD_EVIDENCE_GAP_MIN_VOI
 * - M1_THRESHOLD_EVIDENCE_GAP_TOP_QUARTILE (boolean: true/false/1/0/yes/no)
 * - M1_THRESHOLD_EVIDENCE_GAP_FLOOR
 * - M1_THRESHOLD_EVIDENCE_GAP_CAP
 * - M1_THRESHOLD_DOMINANT_FACTOR
 * - M1_THRESHOLD_INFLUENTIAL_EXTERNAL_QUARTILE
 * - M1_THRESHOLD_NARROW_FRAMING_MAX_OPTIONS
 * - M1_THRESHOLD_ANCHORING_BASELINE
 * - M1_THRESHOLD_OVERCONFIDENCE
 * - M1_THRESHOLD_ACTION_FRAGILE_EDGE
 * - M1_THRESHOLD_ACTION_HIGH_VOI
 * - M1_THRESHOLD_READINESS_HIGH_GAP_COUNT
 * - M1_THRESHOLD_READINESS_HIGH_VOI
 * - READINESS_JOINT_PROB_FLOOR (default: 0.05 — joint probability below this caps readiness at needs_evidence)
 * - READINESS_JOINT_PROB_CLOSE_CALL (default: 0.30 — joint probability below this caps readiness at close_call)
 *
 * @returns CoachingThresholds object with resolved values
 */
export function getThresholds(): CoachingThresholds {
  return {
    // B1: Headlines
    headline_clear_winner_delta: parseEnvFloat(
      'M1_THRESHOLD_CLEAR_WINNER_DELTA',
      DEFAULT_THRESHOLDS.headline_clear_winner_delta
    ),
    headline_clear_winner_stability: parseEnvFloat(
      'M1_THRESHOLD_CLEAR_WINNER_STABILITY',
      DEFAULT_THRESHOLDS.headline_clear_winner_stability
    ),
    headline_moderate_winner_delta: parseEnvFloat(
      'M1_THRESHOLD_MODERATE_WINNER_DELTA',
      DEFAULT_THRESHOLDS.headline_moderate_winner_delta
    ),
    headline_moderate_winner_stability: parseEnvFloat(
      'M1_THRESHOLD_MODERATE_WINNER_STABILITY',
      DEFAULT_THRESHOLDS.headline_moderate_winner_stability
    ),
    headline_close_call_delta: parseEnvFloat(
      'M1_THRESHOLD_CLOSE_CALL_DELTA',
      DEFAULT_THRESHOLDS.headline_close_call_delta
    ),
    headline_high_uncertainty_voi: parseEnvFloat(
      'M1_THRESHOLD_HIGH_UNCERTAINTY_VOI',
      DEFAULT_THRESHOLDS.headline_high_uncertainty_voi
    ),
    headline_high_uncertainty_fragile: parseEnvFloat(
      'M1_THRESHOLD_HIGH_UNCERTAINTY_FRAGILE',
      DEFAULT_THRESHOLDS.headline_high_uncertainty_fragile
    ),
    headline_fragile_edge_min: parseEnvFloat(
      'M1_THRESHOLD_FRAGILE_EDGE_MIN',
      DEFAULT_THRESHOLDS.headline_fragile_edge_min
    ),

    // B2: Evidence Gaps
    evidence_gap_min_voi: parseEnvFloat(
      'M1_THRESHOLD_EVIDENCE_GAP_MIN_VOI',
      DEFAULT_THRESHOLDS.evidence_gap_min_voi
    ),
    evidence_gap_top_quartile: parseEnvBool(
      'M1_THRESHOLD_EVIDENCE_GAP_TOP_QUARTILE',
      DEFAULT_THRESHOLDS.evidence_gap_top_quartile
    ),
    evidence_gap_floor: parseEnvInt(
      'M1_THRESHOLD_EVIDENCE_GAP_FLOOR',
      DEFAULT_THRESHOLDS.evidence_gap_floor
    ),
    evidence_gap_cap: parseEnvInt(
      'M1_THRESHOLD_EVIDENCE_GAP_CAP',
      DEFAULT_THRESHOLDS.evidence_gap_cap
    ),

    // B3: Critiques
    critique_dominant_factor_threshold: parseEnvFloat(
      'M1_THRESHOLD_DOMINANT_FACTOR',
      DEFAULT_THRESHOLDS.critique_dominant_factor_threshold
    ),
    critique_influential_external_quartile: parseEnvFloat(
      'M1_THRESHOLD_INFLUENTIAL_EXTERNAL_QUARTILE',
      DEFAULT_THRESHOLDS.critique_influential_external_quartile
    ),
    critique_narrow_framing_max_options: parseEnvInt(
      'M1_THRESHOLD_NARROW_FRAMING_MAX_OPTIONS',
      DEFAULT_THRESHOLDS.critique_narrow_framing_max_options
    ),
    critique_anchoring_baseline_value: parseEnvFloat(
      'M1_THRESHOLD_ANCHORING_BASELINE',
      DEFAULT_THRESHOLDS.critique_anchoring_baseline_value
    ),
    critique_overconfidence_threshold: parseEnvFloat(
      'M1_THRESHOLD_OVERCONFIDENCE',
      DEFAULT_THRESHOLDS.critique_overconfidence_threshold
    ),

    // B4: Next Actions
    action_fragile_edge_threshold: parseEnvFloat(
      'M1_THRESHOLD_ACTION_FRAGILE_EDGE',
      DEFAULT_THRESHOLDS.action_fragile_edge_threshold
    ),
    action_high_voi_threshold: parseEnvFloat(
      'M1_THRESHOLD_ACTION_HIGH_VOI',
      DEFAULT_THRESHOLDS.action_high_voi_threshold
    ),

    // C3: Readiness Signals
    readiness_high_evidence_gap_count: parseEnvInt(
      'M1_THRESHOLD_READINESS_HIGH_GAP_COUNT',
      DEFAULT_THRESHOLDS.readiness_high_evidence_gap_count
    ),
    readiness_high_voi_threshold: parseEnvFloat(
      'M1_THRESHOLD_READINESS_HIGH_VOI',
      DEFAULT_THRESHOLDS.readiness_high_voi_threshold
    ),

    // C4: Joint Probability Gate
    readiness_joint_prob_floor: parseEnvFloat(
      'READINESS_JOINT_PROB_FLOOR',
      DEFAULT_THRESHOLDS.readiness_joint_prob_floor
    ),
    readiness_joint_prob_close_call: parseEnvFloat(
      'READINESS_JOINT_PROB_CLOSE_CALL',
      DEFAULT_THRESHOLDS.readiness_joint_prob_close_call
    ),
  };
}

/**
 * Parse environment variable as float with fallback.
 */
function parseEnvFloat(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  const parsed = parseFloat(value);
  if (isNaN(parsed)) {
    return defaultValue;
  }
  return parsed;
}

/**
 * Parse environment variable as integer with fallback.
 */
function parseEnvInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    return defaultValue;
  }
  return parsed;
}

/**
 * Parse environment variable as boolean with fallback.
 * Accepts: "true", "1", "yes" (case-insensitive) as true.
 */
function parseEnvBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  const normalized = value.toLowerCase().trim();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  return defaultValue;
}
