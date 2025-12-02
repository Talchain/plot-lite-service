import type { CeeSeverity } from './severity.js';

export type CeeErrorSuggestedAction = 'retry' | 'fix_input' | 'fail';

export interface CeeTrace {
  requestId: string;
  degraded: boolean;
  timestamp: string;        // ISO 8601
  featureVersion?: string;  // optional
}

export interface CeeError {
  code?: string;
  message?: string;
  traceId?: string;
  retryable?: boolean;
  suggestedAction: CeeErrorSuggestedAction;
}

export interface CeeDecisionReviewPayloadV1 {
  schema: 'cee.decision-review.v1';
  response_hash: string;
  seed: number | string;
  inference_mode: string;
  graph_summary: { nodes: number; edges: number };
  scenario_kind?: string;
}

export interface CeeReviewResult {
  review: CeeDecisionReviewPayloadV1 | null;
  trace: CeeTrace;
  error?: CeeError | null;
}

/**
 * Structured CEE issue with explicit severity classification.
 */
export interface CeeIssue {
  /** Machine-readable issue code (e.g. LIMIT_EXCEEDED, MISSING_EVIDENCE). */
  code: string;
  /** Optional CEE severity classification; defaults applied by helpers when absent. */
  severity?: CeeSeverity;
  /** Human-readable message explaining the issue. */
  message: string;
  /** Optional high-level category (e.g. 'graph', 'evidence', 'confidence'). */
  category?: string;
  /** Optional hint describing how to address the issue. */
  hint?: string;
  /** Derived flag indicating whether this issue is blocking. */
  blocking?: boolean;
}

/**
 * Normalised CEE review view used by UI/trust layers.
 *
 * This is intentionally flexible and can wrap the raw CEE payload plus
 * enriched issue metadata.
 */
export interface CeeReview {
  issues?: CeeIssue[];
  // Allow additional fields from upstream CEE payloads without strict typing.
  // This keeps the adapter resilient to CEE schema evolution.
  [key: string]: unknown;
}
