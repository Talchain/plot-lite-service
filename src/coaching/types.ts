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
  marginalSwitchProb: number;
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
  | 'OVERCONFIDENCE';

export type Severity = 'info' | 'warning' | 'concern';

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

export type Readiness = 'ready' | 'close_call' | 'needs_evidence' | 'needs_framing';

export interface NextAction {
  priority: number;
  action: string;              // Interpolated
  rationale: string;           // REQUIRED — explains why this action matters
  related_critique?: CritiqueType;
}

// =============================================================================
// M1 Coaching Output
// =============================================================================

export interface M1Coaching {
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

  // Metadata
  coaching_version: string;  // "1.0.0"
  computed_at: string;       // ISO timestamp
}
