/**
 * M1 Coaching Types
 *
 * Type definitions for Phase 2 deterministic coaching layer.
 */

import type { EngineGraphV3, OptionV3 } from '../types/engine-v3.js';

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
  voi_score: number;             // Normalised VoI (0-1)
  confidence: number;            // 0-1 (raw)
  confidence_display: string;    // "50%" (formatted)
  confidence_defaulted: boolean; // True if confidence was missing
  influence: number;             // Normalised impact (0-1)
  influence_display: string;     // "73%" (formatted)
  suggestion: string;            // "Gather data on {factor_label} to reduce uncertainty"
  notes: string[];               // ["Confidence defaulted to 50%"] if applicable
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
 * Readiness State
 *
 * Indicates how ready the decision is to proceed based on model quality and evidence.
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

  // Metadata
  coaching_version: string;  // "1.1.0" (Phase 3-4)
  computed_at: string;       // ISO timestamp
}
