/**
 * Standardized critique codes for filtering and analytics
 *
 * Categories:
 * - GRAPH_*: Graph structure issues
 * - INPUT_*: Input validation issues
 * - ISL_*: ISL validation/sensitivity issues
 * - CEE_*: CEE weight/belief issues
 * - EVIDENCE_*: Evidence freshness/coverage issues
 */

export const CRITIQUE_CODES = {
  // Graph structure issues
  GRAPH_TOO_LARGE: 'GRAPH_TOO_LARGE',
  GRAPH_CYCLE_DETECTED: 'GRAPH_CYCLE_DETECTED',
  GRAPH_DISCONNECTED: 'GRAPH_DISCONNECTED',
  GRAPH_MISSING_EDGES: 'GRAPH_MISSING_EDGES',

  // Input validation issues
  INVALID_NODE_KIND: 'INVALID_NODE_KIND',
  MISSING_BASELINE: 'MISSING_BASELINE',
  IDENTIFIABILITY_ISSUE: 'IDENTIFIABILITY_ISSUE',

  // ISL validation issues
  ISL_CANNOT_IDENTIFY: 'ISL_CANNOT_IDENTIFY',
  ISL_UNCERTAIN: 'ISL_UNCERTAIN',
  ISL_ISSUE: 'ISL_ISSUE',
  ISL_FRAGILE: 'ISL_FRAGILE',

  // CEE weight/belief issues
  CEE_UNIFORM_WEIGHTS: 'CEE_UNIFORM_WEIGHTS',
  CEE_WEIGHT_ISSUE: 'CEE_WEIGHT_ISSUE',
  CEE_BELIEF_ISSUE: 'CEE_BELIEF_ISSUE',

  // Evidence issues
  EVIDENCE_STALE: 'EVIDENCE_STALE',
  EVIDENCE_MISSING: 'EVIDENCE_MISSING',
  EVIDENCE_LOW_COVERAGE: 'EVIDENCE_LOW_COVERAGE',
} as const;

export type CritiqueCode = (typeof CRITIQUE_CODES)[keyof typeof CRITIQUE_CODES];

/**
 * Extended critique item with optional code field
 * Backwards compatible - code is optional
 */
export interface CritiqueItemWithCode {
  /** Standardized code for filtering (optional for backwards compatibility) */
  code?: CritiqueCode;
  /** Severity level */
  severity: 'BLOCKER' | 'IMPROVEMENT' | 'OBSERVATION';
  /** Semantic severity for UI display */
  semantic_severity?: 'ERROR' | 'WARNING' | 'INFO';
  /** Human-readable message */
  message: string;
  /** Source of the critique */
  source?: 'engine' | 'isl' | 'cee';
  /** Suggested action to resolve */
  suggested_action?: string;
  /** Whether this can be auto-fixed */
  auto_fixable?: boolean;
  /** Edge ID for edge-specific issues */
  edge_id?: string;
}
