/**
 * FactObjectV1 Schema — Structured facts from ISL/inference for UI rendering.
 *
 * Design principles:
 * - Raw data, not formatted strings — UI renders templates
 * - Content-addressable fact keys — not rank-based IDs that churn
 * - Explicit lineage — graph_hash, seed, config_version, isl_request_id
 * - Deterministic ordering — sort by fact_key before hashing
 *
 * @see Stream D — FactObjectV1 Schema + ISL→FactObject Assembly
 */

export const FACTS_SCHEMA_VERSION = 1;

/**
 * Structured key for content-addressable fact identification.
 * Stable across re-runs with same inputs.
 */
export interface FactKey {
  type: FactType;
  node_id?: string;
  /** For edge-related facts: "{from}_{to}" */
  edge_id?: string;
  option_id?: string;
  /** e.g., 'sensitivity_score', 'importance_rank' */
  metric?: string;
}

export type FactType =
  | 'probability'        // OptionResultV2.outcome_distribution
  | 'factor_sensitivity' // FactorSensitivityV2 (align with ISL naming)
  | 'critique'           // CritiqueV2 (align with ISL naming)
  | 'robustness';        // RobustnessResultV2
  // Future: 'fragile_edge', 'constraint' — add when UI needs them

export interface FactObjectV1 {
  /**
   * Deterministic ID: hash(fact_key + lineage).
   * Stable for same content + same analysis run.
   */
  fact_id: string;

  /** Structured key for identification. Content-addressable. */
  fact_key: FactKey;

  fact_type: FactType;

  /**
   * Raw data from ISL/inference. UI renders display format.
   * Shape varies by fact_type — see FactData union.
   */
  data: FactData;

  /** Lineage for reproducibility. */
  lineage: FactLineage;

  /** Hash of canonical JSON of this fact's data payload. */
  content_hash: string;
}

/**
 * Union of data shapes by fact_type. Raw fields, no formatting.
 */
export type FactData =
  | ProbabilityFactData
  | FactorSensitivityFactData
  | CritiqueFactData
  | RobustnessFactData;

export interface ProbabilityFactData {
  type: 'probability';
  option_id: string;
  option_label: string;
  p10: number;
  p50: number;
  p90: number;
  mean: number;
}

export interface FactorSensitivityFactData {
  type: 'factor_sensitivity';
  node_id: string;
  label: string;
  sensitivity_score: number;      // 0-1
  importance_score: number;       // 0-1
  importance_rank: number;
  elasticity: number;
  direction: 'positive' | 'negative';
  confidence: number;             // 0-1
  attribution_stability: 'high' | 'moderate' | 'low' | 'negligible';
}

export interface CritiqueFactData {
  type: 'critique';
  /** Original critique ID */
  id: string;
  /** Original critique code */
  code: string;
  severity: 'info' | 'warning' | 'error' | 'blocker';
  message: string;
  suggestion?: string;
  affected_option_ids?: string[];
  affected_node_ids?: string[];
}

export interface RobustnessFactData {
  type: 'robustness';
  robustness_level: 'robust' | 'moderate' | 'fragile';
  robustness_score: number;
}

export interface FactLineage {
  graph_hash: string;
  seed: number;
  config_version: string;
  isl_request_id: string;
  /** From CEE checkpoint, if available */
  plan_id?: string;
  plan_hash?: string;
}

export interface FactsEnvelope {
  /** Always FACTS_SCHEMA_VERSION */
  facts_schema_version: number;
  facts: FactObjectV1[];
  analysis_status: 'computed' | 'partial' | 'failed';
}
