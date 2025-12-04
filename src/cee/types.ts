import type { CeeSeverity } from './severity.js';
import type { GraphPatchV1 as SdkGraphPatchV1 } from '@olumi/assistants-sdk';

export type CeeErrorSuggestedAction = 'retry' | 'fix_input' | 'fail';

export interface CeeTrace {
  requestId: string;
  degraded: boolean;
  timestamp: string;        // ISO 8601
  featureVersion?: string;  // optional
  /** Human-readable degradation reason for observability */
  reason?: string;
  /** Data source identifier (e.g. 'cee-client', 'orchestrator', 'fixture') */
  source?: string;
  /** HTTP status code when degraded due to upstream failure */
  status?: number;
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

// Graph patch type used for actionable alternatives and model improvements.
// This is a thin alias over the Assistants SDK GraphPatchV1 type to keep
// contracts aligned without re-defining the patch structure here.
export type GraphPatchV1 = SdkGraphPatchV1;

/**
 * Warning about a fragile or assumption-heavy part of the model.
 * Typically derived from ISL validation and sensitivity analysis.
 */
export interface AssumptionWarning {
  /** Stable identifier for deduping/analytics. */
  id: string;
  /** Human-readable message describing the assumption risk. */
  message: string;
  /** Optional node identifier primarily affected by this assumption. */
  node_id?: string;
  /** Optional edge identifier primarily affected by this assumption. */
  edge_id?: string;
  /** Sensitivity score in [0,1]; higher means more impact. */
  sensitivity: number;
  /** Source of the signal. */
  source?: 'isl' | 'engine' | 'mixed';
}

/**
 * Concrete alternative configuration or intervention the user could try.
 * May optionally carry a graph patch describing the suggested change.
 */
export interface ActionableAlternative {
  id: string;
  /** Short description of the alternative. */
  description: string;
  /** Feasibility score in [0,1]; used for ranking/filtering. */
  feasibility: number;
  /** Expected change in outcome relative to current scenario, if known. */
  expected_outcome_delta?: number;
  /** Optional graph patch implementing the alternative. */
  graph_patch?: GraphPatchV1 | null;
}

/**
 * Normalised confidence statement summarising model reliability.
 */
export interface ConfidenceStatement {
  id: string;
  /** Plain-English statement about confidence. */
  message: string;
  /** Discrete confidence band. */
  level: 'low' | 'medium' | 'high';
  /** Optional numeric score in [0,1] for UI ordering. */
  score?: number;
  /** Optional machine-readable factors contributing to this statement. */
  factors?: string[];
}

export type ModelImprovementPriority = 'high' | 'medium' | 'low';

/**
 * Targeted improvement opportunity for the model or decision process.
 */
export interface ModelImprovement {
  id: string;
  /** Area of the system the improvement relates to. */
  area: 'graph' | 'evidence' | 'inference' | 'monitoring' | 'other';
  priority: ModelImprovementPriority;
  /** Human-readable description of the improvement. */
  message: string;
  /** Optional, more explicit suggested action. */
  suggested_action?: string;
}

/**
 * Enhanced CEE review that can include ISL-powered insights.
 *
 * This extends the base CeeReview envelope with structured insight
 * collections used by trust/UI layers. All fields are optional and
 * additive; existing consumers that only understand the base CeeReview
 * shape can safely ignore these.
 */
export interface EnhancedCeeReview extends CeeReview {
  assumption_warnings?: AssumptionWarning[];
  actionable_alternatives?: ActionableAlternative[];
  confidence_statements?: ConfidenceStatement[];
  model_improvements?: ModelImprovement[];
  graph_patches?: GraphPatchV1[];
  /** Where these enhancements originated from. */
  enhancement_source?: 'isl' | 'engine' | 'mixed';
}
