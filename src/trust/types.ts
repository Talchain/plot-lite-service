/**
 * Trust Signal Types for PLoT Engine v1
 * British English in user-facing strings
 */

import type { EvidenceFreshnessSummary } from './evidence-freshness.js';

export type ConfidenceLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type ProvenanceConfidenceLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';

export type DetailLevel = 'quick' | 'standard' | 'deep';

/**
 * Detail level configuration - controls compute budget and feature enablement
 * quick: fast iteration, minimal analysis (K=16)
 * standard: normal runs, default (K=32)
 * deep: thorough analysis, audit/export (K=64)
 */
export interface DetailLevelConfig {
  k_samples: number;
  run_critique: boolean;
  run_sensitivity: boolean;
  run_cee: boolean;
}

export const DETAIL_LEVEL_CONFIG: Record<DetailLevel, DetailLevelConfig> = {
  quick: { k_samples: 16, run_critique: false, run_sensitivity: false, run_cee: false },
  standard: { k_samples: 32, run_critique: true, run_sensitivity: true, run_cee: true },
  deep: { k_samples: 64, run_critique: true, run_sensitivity: true, run_cee: true },
};

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
  detail_level?: DetailLevel; // P1: quick | standard | deep
  // P1: Adaptive K early-stopping parameters
  parameters?: {
    K: number;
    K_requested?: number;
    K_converged?: boolean;
  };
  evidence_freshness?: EvidenceFreshnessSummary;
  provenance_summary?: ProvenanceSummary;
}

export interface ProvenanceSummary {
  sources: string[];
  source_count: number;
  edges_with_provenance: number;
  edges_total: number;
  coverage_ratio: number; // 0-1 proportion of edges with external provenance
  confidence_level: ProvenanceConfidenceLevel;
  confidence_score: number; // 0-1 summary score for provenance quality
  collected_at: string; // ISO 8601 timestamp when summary was computed
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

export interface SensitivitySummary {
  concentration: 'high' | 'medium' | 'diffuse';
  top_n_explain_pct: number;
  top_n: number;
  interpretation: string;
}

export interface GraphQuality {
  score: number; // 0.00–1.00
  completeness: number;
  evidence_coverage: number;
  balance: number;
  issues_count: number;
  recommendation?: string;
}

export interface Insights {
  summary: string; // ≤200 chars
  risks: string[]; // max 5, each ≤100 chars
  next_steps: string[]; // max 3, each ≤150 chars
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
  sensitivity_summary?: SensitivitySummary;
  graph_quality?: GraphQuality;
  insights?: Insights;
}

export interface GraphNode {
  id: string;
  label: string;
  type?: string;
  value?: number;
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
