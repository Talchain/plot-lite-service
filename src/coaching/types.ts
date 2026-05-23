/**
 * M1 Coaching Types
 *
 * Type definitions for Phase 2 deterministic coaching layer.
 */

import type { EngineGraphV3, OptionV3 } from '../types/engine-v3.js';
import type { ReadinessTone, ReadinessToneReason } from './readiness-tone.js';

// =============================================================================
// Input Normalisation
// =============================================================================

export interface NormalisedFactorSensitivity {
  node_id: string;
  label: string;
  elasticity: number | undefined;
  importance_rank: number;
  confidence: number | undefined;
  direction: 'positive' | 'negative' | undefined;
  influence_score: number | undefined;
  zero_reason: string | undefined;
}

export interface NormalisedFragileEdge {
  edgeId: string;              // Collision-safe ID
  fromId: string;
  toId: string;
  fromLabel: string;           // Human-readable
  toLabel: string;             // Human-readable
  displayLabel: string;        // "{fromLabel} → {toLabel}"
  /** Switch probability (prefers switch_probability, falls back to marginal_switch_probability) */
  switchProb: number;
  altWinnerId: string | null;
  altWinnerLabel: string | null;
}

export interface NormalisedOption {
  id: string;
  label: string;
  winProbability: number;
  outcomeMean: number;
  outcomeP10: number | undefined;
  outcomeP90: number | undefined;
}

export interface NormalisedRobustness {
  level: 'high' | 'moderate' | 'low' | 'very_low' | undefined;
  recommendationStability: number | undefined;
  isRobust: boolean | undefined;
}

export interface CoachingInputs {
  factorSensitivity: NormalisedFactorSensitivity[];
  fragileEdges: NormalisedFragileEdge[];
  options: NormalisedOption[];
  graph: EngineGraphV3;
  robustness: NormalisedRobustness;
  /**
   * Factor IDs that are directly set by one or more options' interventions
   * (i.e. decision levers, not background uncertainties). Sourced from
   * `options[i].interventions` keys — NOT from raw ISL `zero_reason`. Used by
   * `computeEvidenceGaps` to exclude levers from the "what to validate next"
   * list. Empty/omitted in unit tests that bypass `normaliseCoachingInputs`.
   *
   * Levers may still surface in a separate "option assumptions" bucket in a
   * future PR — see follow-up note in the PR description.
   */
  interventionTargetIds?: Set<string>;
}

// =============================================================================
// B1: Story Headlines
// =============================================================================

export type HeadlineType =
  | 'clear_winner'
  | 'moderate_winner'
  | 'close_call'
  | 'high_uncertainty'
  | 'needs_evidence';

export interface FragileEdgeContext {
  edgeId: string;
  label: string;                // Human-readable "{fromLabel} → {toLabel}"
  altWinner: string;           // Winner label or ID
  switchProb: number;          // 0-1
  switchProbDisplay: string;   // "23%"
}

export interface StoryHeadlines {
  [optionId: string]: string;  // One headline per option
}

// =============================================================================
// B2: Evidence Gaps
// =============================================================================

export interface EvidenceGap {
  factor_id: string;
  factor_label: string;
  /**
   * Coaching-internal prioritisation score for evidence-gap selection.
   *
   * Formula (see `src/coaching/evidence-gaps.ts`):
   *   `voi_score = normalisedImpact × (1 - confidence)`
   * where `normalisedImpact = |influence_score| / max(|influence_score|)`.
   *
   * **Distinct from `factor_sensitivity[*].value_of_information`.** The
   * coaching score never consults fragile edges, so it can be non-zero
   * even when the same factor's `factor_sensitivity[*].value_of_information`
   * is 0 (e.g. when the factor has no adjacent fragile edge in the graph
   * fallback path). The two surfaces measure related but different
   * quantities — see `tests/voi-surface-divergence.test.ts` for the
   * regression pin and `src/types/engine-v3.ts:FactorSensitivityResultV3.value_of_information`
   * jsdoc for the public-surface formula.
   *
   * Used only for coaching prioritisation (gap selection + ordering),
   * NOT comparable across surfaces. Range: 0-1.
   */
  voi_score: number;
  confidence: number;            // 0-1 (raw)
  confidence_display: string;    // "50%" (formatted)
  confidence_defaulted: boolean; // True if confidence was missing
  influence: number;             // Normalised impact (0-1)
  influence_display: string;     // "73%" (formatted)
  suggestion: string;            // "Gather data on {factor_label} to reduce uncertainty"
  notes: string[];               // ["Confidence defaulted to 50%"] if applicable
  // Observed state from graph node (when available)
  value?: number;                // Normalised factor value (0-1)
  raw_value?: number;            // Original unscaled value for UI display
  unit?: string;                 // Factor unit (e.g. "USD", "users")
  cap?: number;                  // Normalisation scale cap
  /**
   * EVPI heuristic (when win probabilities available).
   * Formula: `voi_score × win_probability_spread × 100`.
   * Inherits the coaching-internal nature of `voi_score` — NOT comparable
   * to `factor_sensitivity[*].evpi_percentage_points`, which is derived
   * from the public-surface VOI (see the latter's jsdoc).
   */
  evpi_percentage_points?: number;
  evpi_method?: 'heuristic' | 'counterfactual';
}

// =============================================================================
// B3: Model Critiques
// =============================================================================

export type CritiqueType =
  | 'DOMINANT_FACTOR'
  | 'MISSING_RISK_PATHWAY'
  | 'INFLUENTIAL_EXTERNALS'
  | 'NARROW_FRAMING'
  | 'ANCHORING_RISK'
  | 'OVERCONFIDENCE'
  | 'GOAL_FEASIBILITY_LOW'
  | 'CONSTRAINT_UNGROUNDED';

export type Severity = 'info' | 'warn' | 'blocker';

export interface Critique {
  type: CritiqueType;
  severity: Severity;
  challenge_question: string;  // Interpolated with specific factors/values
  suggested_action: string;    // Interpolated
  targets?: string[];          // Factor/node IDs involved
  context?: Record<string, any>; // Additional interpolation data
}

// =============================================================================
// B4: Next Actions
// =============================================================================

/**
 * Readiness State — narrow model-readiness / completeness signal.
 *
 * Indicates how ready the decision is to proceed based on model quality and evidence.
 * Drives the legacy `confidence_tier` derivation in `src/routes/v2/run.ts`.
 *
 * NOTE: This is intentionally NARROW — it does not consider robustness level,
 * recommendation stability, fragile-edge switch probability, top-driver
 * confidence, or near-tie margins. For the broader action-readiness tone that
 * does take those signals into account, see `M1Coaching.readiness_tone` and
 * `deriveReadinessTone` in `src/coaching/readiness-tone.ts`.
 *
 * States are evaluated in priority order (first match wins):
 *
 * 1. **needs_framing** (highest priority)
 *    - Trigger: NARROW_FRAMING critique present
 *    - Meaning: Decision structure is flawed; add options or baseline before proceeding
 *
 * 2. **needs_evidence**
 *    - Trigger: High VoI evidence gaps exist (≥2 gaps with top gap VoI > threshold)
 *    - Meaning: Key assumptions lack supporting data; gather evidence before deciding
 *
 * 3. **close_call**
 *    - Trigger: headline_type is 'close_call' or 'high_uncertainty'
 *    - Meaning: Winner margin is within model uncertainty; define tie-breakers
 *
 * 4. **ready** (lowest priority)
 *    - Trigger: headline_type is 'clear_winner' or 'moderate_winner'
 *    - Meaning: Decision is robust enough to proceed confidently
 *
 * Default fallback: needs_evidence (if no conditions match)
 */
export type Readiness = 'ready' | 'close_call' | 'needs_evidence' | 'needs_framing';

export interface NextAction {
  priority: number;
  action: string;              // Interpolated
  rationale: string;           // REQUIRED — explains why this action matters
  related_critique?: CritiqueType;

  // Canvas targeting (for "Focus" CTAs)
  target_type?: 'node' | 'edge' | 'factor' | 'option';
  target_id?: string;          // Canonical ID (node_id, edge_id, option_id)
  target_label?: string;       // Human-readable label (populated by PLoT)
}

// =============================================================================
// M1 Coaching Output (Phase 2 + Phase 3-4)
// =============================================================================

export interface M1Coaching {
  // Phase 2: Core Coaching (B1-B4)
  story_headlines: StoryHeadlines;
  evidence_gaps: EvidenceGap[];
  model_critiques: Critique[];
  next_actions: NextAction[];

  // Decision state
  readiness: Readiness;
  headline_type: HeadlineType;  // For debugging/analytics

  // Fragile edge context (if relevant)
  top_fragile_edge?: {
    edge_id: string;
    label: string;
    alternative_winner: string;
    switch_probability: number;
  };

  // Phase 3: Differentiators (C1-C3)
  assumptions_ledger?: {
    assumptions: Array<{
      dedup_key: string;
      source_service: 'plot_normaliser' | 'isl_engine' | 'cee_review';
      action: 'clamped' | 'defaulted' | 'inferred' | 'floored' | 'derived' | 'flagged' | 'assumed';
      entity_type: 'edge' | 'node' | 'option' | 'global';
      entity_id: string;
      field: string;
      from_value: number | string | null;
      to_value: number | string | null;
      reason: string;
      impact: 'high' | 'medium' | 'low';
      impact_reason_code: 'AFFECTS_WINNER' | 'HIGH_INFLUENCE_FACTOR' | 'FRAGILE_EDGE' | 'OUTCOME_MODIFIER' | 'STRUCTURAL_ONLY' | 'COSMETIC';
    }>;
    total_count: number;
    high_impact_count: number;
    medium_impact_count: number;
    low_impact_count: number;
  };

  thresholds_used?: {
    headline_clear_winner_delta: number;
    headline_clear_winner_stability: number;
    headline_moderate_winner_delta: number;
    headline_moderate_winner_stability: number;
    headline_close_call_delta: number;
    headline_high_uncertainty_voi: number;
    headline_high_uncertainty_fragile: number;
    headline_fragile_edge_min: number;
    evidence_gap_min_voi: number;
    evidence_gap_top_quartile: boolean;
    evidence_gap_floor: number;
    evidence_gap_cap: number;
    critique_dominant_factor_threshold: number;
    critique_influential_external_quartile: number;
    critique_narrow_framing_max_options: number;
    critique_anchoring_baseline_value: number;
    critique_overconfidence_threshold: number;
    action_fragile_edge_threshold: number;
    action_high_voi_threshold: number;
    readiness_high_evidence_gap_count: number;
    readiness_high_voi_threshold: number;
  };

  readiness_signals?: {
    overall: Readiness;
    overall_score: number;
    computed_score_raw: number;  // Raw weighted score before enum alignment (for transparency)
    dimensions: {
      evidence_quality: number;
      model_robustness: number;
      framing_quality: number;
    };
    signals: Array<{
      dimension: 'evidence' | 'robustness' | 'framing';
      signal: string;
      impact: 'positive' | 'negative' | 'neutral';
      weight: number;
    }>;
  };

  // Phase 4: Summary (D1-D2)
  key_drivers?: Array<{
    factor_id: string;
    factor_label: string;
    influence_score: number;
    normalised_impact: number;
    impact_display: string;
    direction: 'positive' | 'negative' | 'neutral' | null;
    rank: number;
  }>;

  executive_summary?: {
    summary: string;
    decision_statement: string;
    key_qualifier: string;
    action_implication: string;
  };

  /**
   * Broader action-readiness tone derived from robustness (`isRobust` + level),
   * recommendation stability, fragile-edge switch probability, evidence-gap
   * count/VOI, top-driver confidence, and near-tie margin. Source of truth is
   * `deriveReadinessTone` (see `src/coaching/readiness-tone.ts`). Recommended
   * source for user-facing readiness tiering once consumers migrate.
   *
   * Distinct from the legacy `readiness` field above, which is a narrower
   * model-readiness / completeness signal and continues to drive the legacy
   * `confidence_tier`.
   *
   * Optional purely for backwards compatibility with consumers built against
   * coaching_version <= 1.1.0 — emitted on every successful M1 coaching run
   * from coaching_version >= 1.2.0.
   */
  readiness_tone?: ReadinessTone;

  /**
   * Deterministic reason codes that produced `readiness_tone`. Empty array
   * when tone is `'confident'`; otherwise contains the triggered hard reasons
   * plus an optional `INSUFFICIENT_SIGNALS` marker. Stable additive
   * vocabulary defined in `src/coaching/readiness-tone.ts`.
   *
   * Optional purely for backwards compatibility with consumers built against
   * coaching_version <= 1.1.0 — emitted on every successful M1 coaching run
   * from coaching_version >= 1.2.0.
   */
  readiness_reasons?: ReadinessToneReason[];

  // Metadata
  coaching_version: string;  // "1.2.0" (adds readiness_tone + readiness_reasons)
  computed_at: string;       // ISO timestamp
}
