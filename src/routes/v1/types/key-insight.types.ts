/**
 * Key Insight Proxy Types
 *
 * Types for the /v1/assist/key-insight endpoint that proxies to CEE
 * after enriching with PLoT inference context.
 */

import type { GraphNode, GraphEdge, NodeKind } from '../../../trust/types.js';
import type { RankingConfidence } from './run-bundle.types.js';

/**
 * Goal type classification for CEE insight generation
 */
export type GoalType = 'binary' | 'continuous' | 'compound';

/**
 * Goal context for CEE key insight requests
 */
export interface Goal {
  /** Goal node ID */
  id: string;
  /** Goal text/label */
  text: string;
  /** Goal type classification */
  type: GoalType;
  /** Whether this is the primary goal */
  is_primary: boolean;
}

/**
 * Ranked action result from PLoT inference
 */
export interface RankedAction {
  /** Option/action label */
  label: string;
  /** Rank (1 = best) */
  rank: number;
  /** Expected outcome p50 value */
  expected_outcome: number;
  /** Outcome quality indicator for CEE insight generation */
  outcome_quality: 'negative' | 'positive' | 'neutral';
  /** Distribution bounds */
  distribution: {
    p10: number;
    p50: number;
    p90: number;
  };
  /** Success probability (normalized 0-1) */
  success_probability: number;
}

/**
 * Request to /v1/assist/key-insight
 */
export interface KeyInsightRequest {
  /** Graph structure */
  graph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
  /** Optional seed for reproducibility */
  seed?: number;
  /** Optional primary outcome node */
  outcome_node?: string;
  /** Optional context for CEE */
  context?: {
    /** Decision question being evaluated */
    question?: string;
    /** Additional context */
    notes?: string;
  };
}

/**
 * CEE Key Insight response structure
 */
export interface CeeKeyInsight {
  /** Primary insight message */
  insight: string;
  /** Confidence in the insight */
  confidence: 'high' | 'medium' | 'low';
  /** Supporting evidence */
  evidence?: string[];
  /** Suggested next steps */
  next_steps?: string[];
  /** Risk highlights */
  risks?: string[];
}

/**
 * Warning for an inferred or unusual configuration
 */
export interface ResponseWarning {
  code: 'EDGE_TYPE_INFERRED' | 'PRIMARY_OUTCOME_INFERRED' | 'BELIEF_DEFAULTED';
  message: string;
  severity: 'info' | 'warning';
  /** Affected entity ID */
  affected_id?: string;
}

/**
 * Response from /v1/assist/key-insight
 */
export interface KeyInsightResponse {
  schema: 'key_insight.v1';
  /** CEE-generated insight */
  insight: CeeKeyInsight | null;
  /** Ranked actions from PLoT inference */
  ranked_actions: RankedAction[];
  /** Ranking confidence */
  ranking_confidence: RankingConfidence;
  /** Source of the insight */
  provenance: 'cee' | 'plot_fallback';
  /** Model metadata */
  model_card: {
    seed: number;
    nodes: number;
    edges: number;
    backend: string;
    response_hash: string;
  };
  /** Warnings about inferred values or unusual configurations */
  warnings?: ResponseWarning[];
  /** Error information if CEE call failed */
  cee_error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

/**
 * CEE Key Insight request body (sent to CEE /assist/v1/key-insight)
 */
export interface CeeKeyInsightRequestBody {
  /** PLoT request ID for correlation */
  plot_request_id: string;
  /** Graph summary */
  graph_summary: {
    nodes: number;
    edges: number;
    node_kinds: NodeKind[];
  };
  /** Ranked actions from inference */
  ranked_actions: RankedAction[];
  /** Ranking confidence */
  ranking_confidence: RankingConfidence;
  /** Optional decision context */
  context?: {
    question?: string;
    notes?: string;
  };
  /** Primary goal text (null if no goal node in graph) */
  goal_text: string | null;
  /** Primary goal type classification */
  goal_type: GoalType | null;
  /** Primary goal node ID */
  goal_id: string | null;
  /** All goals when multiple goal nodes exist */
  goals?: Goal[];
  /** ID of the primary goal when multiple goals exist */
  primary_goal_id?: string;
}
