/**
 * Trust Signal Types for PLoT Engine v1
 * British English in user-facing strings
 */

export type ConfidenceLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ModelCard {
  seed: number;
  assumptions_summary: string[];
  compute_budget: {
    k_samples?: number;
    downgraded?: boolean;
    downgrade_reason?: string;
  };
  flags_on: string[];
  determinism_note: string;
  response_hash?: string; // SHA-256 of normalised payload (added for auditability)
  warnings?: string[]; // Optional warnings (e.g., zero baseline)
  identifiability_tag?: string; // Plain-English identifiability summary (IDENT_TAG_ENABLE=1)
}

export interface ConfidenceBadge {
  level: ConfidenceLevel;
  reason: string;
  score: number; // 0-1
  factors: {
    identifiability: number; // 0-1
    linearity_distance: number; // 0-1 (1 = in range)
    k_coverage: number; // 0-1
    calibration: number; // 0-1
  };
}

export interface LinearityWarning {
  outside_range: boolean;
  distance_from_center: number; // percentage
  recommendation: string;
}

export interface ThresholdCrossing {
  metric: string;
  from_value: number;
  to_value: number;
  threshold: number;
  crossed: boolean;
  direction: 'up' | 'down';
}

export interface ForkSuggestion {
  reason: string;
  scenarios: Array<{
    name: string;
    key_change: string;
    outcome_headline: string;
  }>;
}

export type CritiqueSeverity = 'BLOCKER' | 'IMPROVEMENT' | 'OBSERVATION';

export interface CritiqueItem {
  severity: CritiqueSeverity;
  message: string;
  suggested_action?: string;
  auto_fixable?: boolean;
}

export interface ExplainDelta {
  top_drivers: Array<{
    node_id: string;
    node_label: string;
    contribution: number; // percentage
    sign: '+' | '-';
    explanation: string;
  }>;
  summary: string;
}

export interface TrustedResponse {
  model_card: ModelCard;
  confidence: ConfidenceBadge;
  linearity_warning?: LinearityWarning;
  threshold_crossings?: ThresholdCrossing[];
  fork_suggestions?: ForkSuggestion[];
  explain_delta?: ExplainDelta;
  critique?: CritiqueItem[];
}

export interface GraphNode {
  id: string;
  label: string;
  type?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  weight?: number;
  belief?: number;      // 0-1, probability edge exists
  provenance?: string;  // Source attribution, max 100 chars
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
