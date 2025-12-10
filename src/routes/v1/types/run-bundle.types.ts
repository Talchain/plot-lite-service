/**
 * Enhanced Run Bundle Types
 *
 * Extended request/response types for option ranking and change attribution.
 */

import type { ChangeAttribution } from '../../../types/change-attribution.js';

/**
 * Sort key for ranking options
 */
export type RankingSortKey = 'p10' | 'p50' | 'p90';

/**
 * Ranking confidence level based on distribution overlap
 */
export type RankingConfidence = 'high' | 'medium' | 'low';

/**
 * Node-level sensitivity aggregation
 */
export interface NodeSensitivity {
  /** Node identifier */
  node_id: string;
  /** Human-readable node label */
  node_label: string;
  /** Percentage contribution to outcome variance (0-100) */
  contribution_pct: number;
  /** Number of edges from this node contributing to sensitivity */
  edge_count: number;
}

/**
 * Delta from baseline for a scenario result
 */
export interface DeltaFromBaseline {
  /** Difference in p10 from baseline */
  p10: number;
  /** Difference in p50 from baseline */
  p50: number;
  /** Difference in p90 from baseline */
  p90: number;
  /** Causal attribution explaining the difference */
  change_attribution: ChangeAttribution;
}

/**
 * Summary of ranking results
 */
export interface RankingSummary {
  /** Label of the winning option (highest by sort_by metric) */
  winner: string;
  /** p50 value of the winner */
  winner_p50: number;
  /** Absolute difference between winner and runner-up */
  margin: number | null;
  /** Margin as percentage of runner-up value */
  margin_pct: number | null;
  /** Confidence in ranking stability based on distribution overlap */
  ranking_confidence: RankingConfidence;
  /** Number of options successfully ranked */
  ranked_count: number;
  /** Labels of options excluded from ranking (due to errors) */
  excluded: string[];
}

/**
 * Enhanced result for a single scenario
 */
export interface EnhancedBundleResult {
  /** Scenario label */
  label: string;
  /** Outcome distribution */
  summary: {
    p10: number;
    p50: number;
    p90: number;
  } | null;
  /** Rank among all scenarios (1 = best) */
  rank?: number;
  /** Alias for summary[sort_by] for convenience */
  success_probability?: number;
  /** Difference from baseline scenario */
  delta_from_baseline?: DeltaFromBaseline;
  /** Node-level sensitivity (top 5 nodes) */
  sensitivity_by_node?: NodeSensitivity[];
  /** Model metadata */
  model_card: {
    seed: number;
    nodes: number;
    edges: number;
    backend: string;
    detail_level: string;
    K?: number;
    response_hash: string;
    duplicate?: boolean;
    inference_error?: string;
  };
  /** Error information if scenario failed */
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Enhanced run_bundle response
 */
export interface EnhancedBundleResponse {
  schema: 'run_bundle.v1';
  results: EnhancedBundleResult[];
  ranking_summary?: RankingSummary;
  model_card: {
    seed: number;
    detail_level: string;
    backend: string;
    response_hash: string;
  };
  meta: {
    seed: number;
    total_scenarios: number;
    unique_results: number;
    inference_mode: 'model_based' | 'mixed';
    all_scenarios_succeeded: boolean;
    fallback_count?: number;
    baseline_label?: string;
    baseline_index?: number;
    evidence_applied?: Array<{ node_id: string; source: string }>;
  };
}
