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
