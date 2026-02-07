/**
 * CEE Integration Helper for /v1/run
 *
 * Extracted from run.ts to reduce complexity.
 * Handles CEE decision review orchestration with circuit breaker pattern.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { normalizeCeeCode, isFlagOn } from '../../../cee/codes.js';
import { shouldAllowCeeCall, recordCeeSuccess, recordCeeFailure } from '../../../cee/circuit-breaker.js';
import { callDecisionReviewFromEngine } from '../../../cee/client.js';
import type { CeeTrace } from '../../../cee/types.js';
import {
  recordCeeAttempted,
  recordCeeOk,
  recordCeeDegraded,
  recordCeeSkipped,
} from '../../../metrics/registry.js';
import { CRITIQUE_CODES } from '../../../trust/critique-codes.js';
import type { DetailLevelConfig } from '../../../trust/types.js';
import { CEE_TIMEOUT_MS } from '../../../config/timeouts.js';

export interface CeeIntegrationConfig {
  /** Idempotency key from request header */
  idempotencyKey: string;
  /** CEE flag enabled from env */
  ceeEnabled: boolean;
  /** Base URL for CEE service */
  baseUrl: string;
  /** API key for CEE service */
  apiKey: string;
  /** Detail level config for gating */
  detailConfig: DetailLevelConfig;
  /** Route path for metrics */
  route: string;
}

export interface CeeIntegrationContext {
  /** Request ID for tracing */
  requestId: string;
  /** Response hash for CEE context */
  responseHash?: string;
  /** Seed for reproducibility */
  seed: number;
  /** Inference mode used */
  inferenceMode: string;
  /** Graph summary for CEE context */
  graphSummary: { nodes: number; edges: number };
  /** Evidence array from request */
  evidence?: Array<{ node_id: string; source: string; note?: string; weight?: number }>;
  /** ISL enrichment flag */
  enhanced: boolean;
}

export interface CeeIntegrationResult {
  /** CEE status: 'skipped' | 'ok' | 'degraded' | 'error' */
  status: string;
  /** CEE code for debugging */
  code: string;
  /** CEE review result (if successful) */
  review?: unknown;
  /** CEE trace (if available) */
  trace?: CeeTrace;
  /** CEE error (if failed) */
  error?: { code?: string; message?: string };
  /** Weight-based critique items to add */
  weightCritiques: Array<{
    code: string;
    severity: 'IMPROVEMENT';
    semantic_severity: 'WARNING';
    message: string;
    source: 'cee';
    edge_id?: string;
    suggested_action?: string;
  }>;
  /** CEE degraded flag for meta */
  ceeDegraded: boolean;
}

/**
 * Execute CEE integration with circuit breaker pattern
 *
 * Returns structured result for easy integration into response.
 */
export async function executeCeeIntegration(
  config: CeeIntegrationConfig,
  context: CeeIntegrationContext,
  req: FastifyRequest
): Promise<CeeIntegrationResult> {
  const { idempotencyKey, ceeEnabled, baseUrl, apiKey, detailConfig, route } = config;
  const hasConfig = baseUrl.length > 0 && apiKey.length > 0;

  let status = 'skipped';
  let code = '';
  const weightCritiques: CeeIntegrationResult['weightCritiques'] = [];
  let review: unknown = undefined;
  let trace: CeeTrace | undefined = undefined;
  let error: { code?: string; message?: string } | undefined = undefined;
  let ceeDegraded = false;

  // Gate checks in order
  if (!idempotencyKey) {
    status = 'skipped';
    code = 'no_idk';
    recordCeeSkipped(route, 'no_idk');
  } else if (!ceeEnabled) {
    status = 'skipped';
    code = 'flag_off';
    recordCeeSkipped(route, 'flag_off');
  } else if (!hasConfig) {
    status = 'skipped';
    code = 'no_config';
    recordCeeSkipped(route, 'no_config');
  } else if (!detailConfig.run_cee) {
    // Quick mode skips CEE for speed
    status = 'skipped';
    code = 'quick_mode';
    recordCeeSkipped(route, 'quick_mode');
  } else if (!shouldAllowCeeCall()) {
    // Circuit breaker is open
    status = 'skipped';
    code = 'circuit_open';
    recordCeeSkipped(route, 'circuit_open');
  } else {
    // Attempt CEE call
    recordCeeAttempted(route);
    try {
      const cee = await callDecisionReviewFromEngine({
        requestId: context.requestId,
        context: {
          response_hash: context.responseHash ?? '',
          seed: context.seed,
          inference_mode: context.inferenceMode,
          graph_summary: context.graphSummary,
        },
        env: {
          enable: ceeEnabled,
          baseUrl,
          apiKey,
          timeoutMs: CEE_TIMEOUT_MS,
        },
        evidence: context.evidence,
        enhanced: context.enhanced,
      });

      if (cee.error) {
        status = 'degraded';
        code = cee.error.code || 'unknown';
        error = cee.error;
        recordCeeDegraded(route, normalizeCeeCode(code));
        recordCeeFailure();
      } else {
        status = 'ok';
        code = '';
        recordCeeOk(route);
        recordCeeSuccess();
      }

      if (cee.review !== null) {
        review = cee.review;
        // Extract weight_suggestions from CEE review
        const weightSuggestions = (cee.review as any)?.weight_suggestions;
        if (Array.isArray(weightSuggestions) && weightSuggestions.length > 0) {
          for (const ws of weightSuggestions) {
            const critique = buildWeightCritique(ws);
            if (critique) {
              weightCritiques.push(critique);
            }
          }
        }
      }

      if (cee.trace) {
        trace = cee.trace;
        ceeDegraded = cee.trace.degraded ?? false;
      }

      if (cee.error) {
        error = cee.error;
      }
    } catch (err: any) {
      status = 'error';
      code = err?.code || 'client_error';
      recordCeeDegraded(route, normalizeCeeCode(code));
      recordCeeFailure();
      ceeDegraded = true;

      const errorMeta = {
        evt: 'cee_integration_error',
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        requestId: context.requestId,
        ceeBaseUrl: baseUrl,
        hasEvidence: !!context.evidence,
      };

      try {
        req.log?.error?.(errorMeta, 'CEE integration failed; continuing without CEE');
      } catch (logErr) {
        console.error('[CEE] Integration and logging failed', {
          originalError: errorMeta,
          loggingError: logErr instanceof Error ? logErr.message : String(logErr),
        });
      }
    }
  }

  return {
    status,
    code,
    review,
    trace,
    error,
    weightCritiques,
    ceeDegraded,
  };
}

/**
 * Build a weight-based critique from CEE suggestion
 */
function buildWeightCritique(ws: any): CeeIntegrationResult['weightCritiques'][0] | null {
  let message = ws.rationale;
  if (!message) {
    switch (ws.reason) {
      case 'uniform_weights':
        message = `Edge ${ws.from_node_id}→${ws.to_node_id} has uniform weight (same as other edges) (current: ${ws.current_weight})`;
        break;
      case 'weight_too_low':
        message = `Edge ${ws.from_node_id}→${ws.to_node_id} has unusually low weight (current: ${ws.current_weight})`;
        break;
      case 'weight_too_high':
        message = `Edge ${ws.from_node_id}→${ws.to_node_id} has unusually high weight (current: ${ws.current_weight})`;
        break;
      case 'near_zero':
        message = `Edge ${ws.from_node_id}→${ws.to_node_id} has very low probability (${ws.current_belief}). Consider if this outcome is truly unlikely.`;
        break;
      case 'near_one':
        message = `Edge ${ws.from_node_id}→${ws.to_node_id} has near-certain probability (${ws.current_belief}). Verify this confidence is justified.`;
        break;
      case 'uniform_distribution':
        message = `Decision branches have equal probability. Differentiate based on available evidence.`;
        break;
      default:
        message = `Edge ${ws.from_node_id}→${ws.to_node_id} has problematic configuration`;
    }

    if (ws.suggested_weight !== undefined) {
      message += `. Consider adjusting weight to ${ws.suggested_weight}`;
    }
    if (ws.suggested_belief !== undefined) {
      message += `. Consider adjusting belief to ${ws.suggested_belief}`;
    }
  }

  if (ws.auto_applied) {
    message += ' (auto-applied by CEE)';
  }

  const ceeReasonToCode: Record<string, string> = {
    'uniform_weights': CRITIQUE_CODES.CEE_UNIFORM_WEIGHTS,
    'weight_too_low': CRITIQUE_CODES.CEE_WEIGHT_ISSUE,
    'weight_too_high': CRITIQUE_CODES.CEE_WEIGHT_ISSUE,
    'near_zero': CRITIQUE_CODES.CEE_BELIEF_ISSUE,
    'near_one': CRITIQUE_CODES.CEE_BELIEF_ISSUE,
    'uniform_distribution': CRITIQUE_CODES.CEE_BELIEF_ISSUE,
  };

  const critique: CeeIntegrationResult['weightCritiques'][0] = {
    code: ceeReasonToCode[ws.reason] ?? CRITIQUE_CODES.CEE_WEIGHT_ISSUE,
    severity: 'IMPROVEMENT',
    semantic_severity: 'WARNING',
    message,
    source: 'cee',
    edge_id: ws.edge_id,
  };

  if (ws.suggested_weight !== undefined) {
    critique.suggested_action = `Adjust weight to ${ws.suggested_weight}`;
  } else if (ws.suggested_belief !== undefined) {
    critique.suggested_action = `Adjust belief to ${ws.suggested_belief}`;
  }

  return critique;
}

/**
 * Set X-CEE-Debug header if enabled
 */
export function setCeeDebugHeader(
  reply: FastifyReply,
  idempotencyKey: string,
  ceeEnabled: boolean,
  status: string,
  code: string
): void {
  if (process.env.NODE_ENV !== 'production' || process.env.CEE_DEBUG_ENABLE === '1') {
    try {
      const hdr = [
        idempotencyKey ? '1' : '0',
        ceeEnabled ? '1' : '0',
        status,
        code,
      ].join(':');
      reply.header('X-CEE-Debug', hdr);
    } catch { /* ignore */ }
  }
}

/**
 * Log CEE debug info
 */
export function logCeeDebug(
  req: FastifyRequest,
  idempotencyKey: string,
  ceeEnabled: boolean,
  hasConfig: boolean,
  status: string,
  code: string
): void {
  try {
    req.log?.info?.({
      evt: 'cee_debug',
      idk_seen: !!idempotencyKey,
      cee_enabled: ceeEnabled,
      has_config: hasConfig,
      status,
      code,
    }, 'CEE debug');
  } catch { /* ignore */ }
}
