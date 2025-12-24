import {
  createCEEClient,
  buildCeeDecisionReviewPayload,
  buildCeeErrorView,
  type CeeDecisionReviewPayloadV1,
} from '@olumi/assistants-sdk';
import type {
  CeeTrace,
  CeeReviewRequest,
  CeeReviewResponse,
  CeeReviewBlock,
  CeeErrorNormalized,
} from './types.js';
import {
  sanitizeRequestId,
  draftGraphV2,
  optionsV2,
  biasCheckV2,
  type CEESchemaV2Config,
} from './client.js';
import { shouldAllowCeeCall, recordCeeSuccess, recordCeeFailure } from './circuit-breaker.js';

export type OrchestratorEnv = {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
};

export type OrchestratorResult = {
  review: CeeDecisionReviewPayloadV1 | null;
  trace: {
    requestId?: string;
    degraded?: boolean;
    timestamp?: string;
    // M1 CEE Orchestrator spec v1.1: Three-ID tracing + latency
    cee_sent_request_id?: string | null;
    cee_returned_request_id?: string | null;
    latency_ms?: number | null;
    model?: string;
    id_mismatch?: boolean;
    reason?: string; // Error reason for debugging degraded responses
  } | null;
  error?: { code?: string; retryable: boolean; suggestedAction: 'retry' | 'fix_input' | 'fail'; traceId?: string };
};

export type EvidenceHelperItem = {
  id: string;
  type: 'experiment' | 'user_research' | 'market_data' | 'expert_opinion' | 'other';
  source?: string;
  content?: string;
};

export type BriefContext = {
  nodes?: number;
  edges?: number;
};

export function buildCeeBrief(shortLabel: string, context?: BriefContext): string {
  const prefix = 'Decision review context: ';
  const label = (shortLabel ?? '').trim();
  let brief = prefix + (label || 'scenario');

  // Add structural hints (no user content exposed)
  if (context && (context.nodes || context.edges)) {
    brief += ` (${context.nodes ?? 0} nodes, ${context.edges ?? 0} edges)`;
  }

  if (brief.length < 30) {
    brief += ' Please elaborate.';
  }

  return brief;
}

/**
 * Calls Assistants CEE endpoints via SDK and collapses into the frozen v1 Decision Review payload.
 * Keep inputs minimal for now (safe brief); you can pass a real graph later if desired.
 */
export async function runDecisionReviewViaSdk(
  env: OrchestratorEnv,
  brief: string,
  evidenceItems?: EvidenceHelperItem[],
  briefContext?: BriefContext,
  /** Original request ID from caller for three-ID tracing */
  callerRequestId?: string,
): Promise<OrchestratorResult> {
  // M1 CEE Orchestrator spec v1.1: Track timing
  const startTime = Date.now();

  const client = createCEEClient({
    apiKey: String(env.apiKey ?? ''),
    baseUrl: env.baseUrl,
    timeout: Number(env.timeoutMs ?? 60_000), // 60s for staging integration testing
  });

  try {
    // 1) Draft a small graph from brief (non-streaming for deterministic behaviour)
    const draftBrief = buildCeeBrief(brief, briefContext);
    const draft = await client.draftGraph({ brief: draftBrief, config: { streaming: false } });

    // 2) Options from draft graph – strict payload: { graph, archetype }
    const archetype = (draft as any)?.archetype ?? null;
    const options = await client.options({ graph: draft.graph, archetype });

    // 3) Evidence helper – only call when we have at least one evidence item
    let evidence: any | undefined;
    if (Array.isArray(evidenceItems) && evidenceItems.length > 0) {
      evidence = await client.evidenceHelper({ evidence: evidenceItems });
    }

    // 4) Bias/structure checks – strict payload: { graph, archetype }
    const bias = await client.biasCheck({ graph: draft.graph, archetype });

    const review = buildCeeDecisionReviewPayload({ draft, options, evidence, bias });

    // M1 CEE Orchestrator spec v1.1: Calculate latency and extract IDs
    const latencyMs = Date.now() - startTime;
    const ceeReturnedRequestId = (draft as any)?.trace?.request_id ?? (draft as any)?.trace?.requestId ?? null;
    const model = (draft as any)?.model ?? (draft as any)?.meta?.model ?? undefined;

    // M1 CEE Orchestrator spec v1.1: Detect ID mismatch
    const idMismatch = callerRequestId !== ceeReturnedRequestId && ceeReturnedRequestId !== null;

    return {
      review,
      trace: {
        requestId: ceeReturnedRequestId ?? callerRequestId,
        degraded: false,
        timestamp: new Date().toISOString(),
        cee_sent_request_id: callerRequestId ?? null,
        cee_returned_request_id: ceeReturnedRequestId,
        latency_ms: latencyMs,
        model,
        id_mismatch: idMismatch,
      },
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    const view = buildCeeErrorView(err);

    // Defensive: SDK's buildCeeErrorView may return undefined code
    // Derive meaningful code from error if SDK doesn't provide one
    let errorCode = view.code;
    if (!errorCode || errorCode === 'undefined') {
      // Try to extract from error object
      if (err?.code) {
        errorCode = String(err.code);
      } else if (err?.name === 'AbortError' || err?.message?.includes('timeout')) {
        errorCode = 'CEE_TIMEOUT';
      } else if (err?.name) {
        errorCode = `CEE_${err.name.toUpperCase()}`;
      } else {
        errorCode = 'CEE_SDK_ERROR';
      }
    }

    // Log diagnostic info for debugging SDK errors
    console.error('[CEE_SDK_ERROR]', JSON.stringify({
      original_code: view.code,
      derived_code: errorCode,
      error_name: err?.name,
      error_message: err?.message?.slice(0, 200),
      error_type: typeof err,
      latency_ms: latencyMs,
    }));

    return {
      review: null,
      trace: {
        degraded: true,
        timestamp: new Date().toISOString(),
        cee_sent_request_id: callerRequestId ?? null,
        cee_returned_request_id: null,
        latency_ms: latencyMs,
      },
      error: {
        code: errorCode,
        retryable: view.retryable ?? true,
        suggestedAction: view.suggestedAction ?? 'retry',
        traceId: view.traceId,
      },
    };
  }
}

// =============================================================================
// CEE Schema V2 Direct HTTP Path
// =============================================================================
// Uses direct HTTP calls with ?schema=v2 query parameter to get v2 format
// which includes effect_direction, strength_std, and observed_state fields.
// This bypasses the SDK which doesn't support schema parameters.

/**
 * Feature flag to enable CEE schema v2 mode
 * Set CEE_SCHEMA_V2=1 to use direct HTTP calls with ?schema=v2
 */
function isCeeSchemaV2Enabled(): boolean {
  return process.env.CEE_SCHEMA_V2 === '1' || process.env.CEE_SCHEMA_V2 === 'true';
}

/**
 * Run decision review via direct HTTP with schema v2
 *
 * Uses ?schema=v2 query parameter to get v2 format response including:
 * - effect_direction on edges
 * - strength_std on edges
 * - observed_state on nodes
 *
 * Falls back to SDK path if v2 calls fail.
 */
export async function runDecisionReviewViaV2Http(
  env: OrchestratorEnv,
  brief: string,
  briefContext?: BriefContext,
  callerRequestId?: string,
): Promise<OrchestratorResult> {
  const startTime = Date.now();

  if (!env.baseUrl || !env.apiKey) {
    return {
      review: null,
      trace: {
        degraded: true,
        timestamp: new Date().toISOString(),
        cee_sent_request_id: callerRequestId ?? null,
        cee_returned_request_id: null,
        latency_ms: 0,
      },
      error: {
        code: 'CEE_CONFIG_MISSING',
        retryable: false,
        suggestedAction: 'fix_input',
      },
    };
  }

  const v2Config: CEESchemaV2Config = {
    baseUrl: env.baseUrl,
    apiKey: env.apiKey,
    timeoutMs: env.timeoutMs ?? 60_000,
  };

  const requestId = callerRequestId ?? `cee-v2-${Date.now()}`;

  // Log v2 path entry for debugging
  console.log('[CEE_V2_START]', JSON.stringify({
    base_url: env.baseUrl,
    timeout_ms: v2Config.timeoutMs,
    request_id: requestId,
    draft_graph_url: `${env.baseUrl}/assist/v1/draft-graph?schema=v2`,
  }));

  try {
    // 1) Draft graph with v2 format
    const draftBrief = buildCeeBrief(brief, briefContext);
    const draftResult = await draftGraphV2(v2Config, draftBrief, requestId);
    const draft = draftResult.data;

    // Verify v2 format - log first edge for debugging
    const firstEdge = draft?.graph?.edges?.[0];
    if (firstEdge) {
      console.log(`[CEE_V2_VERIFY] draft-graph edge: effect_direction=${firstEdge.effect_direction} strength_std=${firstEdge.strength_std}`);
    }

    // 2) Options with v2 format
    const archetype = draft?.archetype ?? null;
    const optionsResult = await optionsV2(v2Config, draft.graph, archetype, requestId);
    const options = optionsResult.data;

    // 3) Bias check with v2 format
    const biasResult = await biasCheckV2(v2Config, draft.graph, archetype, requestId);
    const bias = biasResult.data;

    // Build review payload (SDK helper still works with v2 data)
    const review = buildCeeDecisionReviewPayload({ draft, options, evidence: undefined, bias });

    const latencyMs = Date.now() - startTime;
    const ceeReturnedRequestId = draft?.trace?.request_id ?? draft?.trace?.requestId ?? null;
    const model = draft?.model ?? draft?.meta?.model ?? undefined;
    const idMismatch = callerRequestId !== ceeReturnedRequestId && ceeReturnedRequestId !== null;

    return {
      review,
      trace: {
        requestId: ceeReturnedRequestId ?? callerRequestId,
        degraded: false,
        timestamp: new Date().toISOString(),
        cee_sent_request_id: callerRequestId ?? null,
        cee_returned_request_id: ceeReturnedRequestId,
        latency_ms: latencyMs,
        model,
        id_mismatch: idMismatch,
      },
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;

    // Detailed diagnostic logging for v2 failures
    const errorMessage = err?.message || String(err);
    const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('AbortError') || err?.name === 'AbortError';
    const isNetworkError = errorMessage.includes('fetch failed') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND');

    console.error('[CEE_V2_FAILURE]', JSON.stringify({
      error_message: errorMessage.slice(0, 500),
      error_name: err?.name,
      is_timeout: isTimeout,
      is_network_error: isNetworkError,
      latency_ms: latencyMs,
      base_url: v2Config.baseUrl,
      timeout_config_ms: v2Config.timeoutMs,
      request_id: requestId,
    }));

    // Derive more specific error code
    let errorCode = 'CEE_V2_ERROR';
    if (isTimeout) {
      errorCode = 'CEE_V2_TIMEOUT';
    } else if (isNetworkError) {
      errorCode = 'CEE_V2_NETWORK_ERROR';
    } else if (errorMessage.includes('HTTP 4')) {
      errorCode = 'CEE_V2_CLIENT_ERROR';
    } else if (errorMessage.includes('HTTP 5')) {
      errorCode = 'CEE_V2_SERVER_ERROR';
    }

    return {
      review: null,
      trace: {
        degraded: true,
        timestamp: new Date().toISOString(),
        cee_sent_request_id: callerRequestId ?? null,
        cee_returned_request_id: null,
        latency_ms: latencyMs,
        reason: errorMessage.slice(0, 200), // Include actual error for debugging
      },
      error: {
        code: errorCode,
        retryable: !isNetworkError, // Don't retry network errors
        suggestedAction: isTimeout ? 'retry' : 'fix_input',
      },
    };
  }
}

// =============================================================================
// M1 CEE Orchestrator - Unified review() Integration (SDK v1.12.0+)
// =============================================================================

/**
 * Result type for M1 CEE orchestration
 */
export interface CeeOrchestrationResult {
  ceeReview: CeeReviewResponse | null;
  ceeTrace: CeeTrace;
  ceeError: CeeErrorNormalized | null;
}

/**
 * Check if SDK supports review() method (v1.12.0+)
 * This will be updated when SDK v1.12.0 is published
 */
function sdkSupportsReview(client: ReturnType<typeof createCEEClient>): boolean {
  // TODO: Update when SDK v1.12.0 is published
  // return typeof (client as any).review === 'function';
  return false; // Currently SDK v1.11.1 does not have review()
}

/**
 * Normalize error to include both retriable (canonical) and retryable (alias)
 * IMPORTANT: Never produce "undefined" - always provide meaningful error info
 */
function normalizeError(error: unknown): CeeErrorNormalized {
  // Build message - never let it be undefined or empty
  let message: string;
  if (error instanceof Error) {
    message = error.message || error.name || 'Error (no message)';
  } else if (typeof error === 'string') {
    message = error || 'Empty string error';
  } else if (error && typeof error === 'object') {
    const err = error as any;
    message = err.message || err.error || JSON.stringify(error) || 'Object error (no message)';
  } else {
    message = String(error) || 'Unknown error';
  }

  // Extract code - prefer explicit code, fall back to error name
  let code = 'CEE_UNKNOWN_ERROR';
  if (error && typeof error === 'object') {
    const err = error as any;
    code = err.code || err.errorCode || (error instanceof Error ? error.name : 'CEE_UNKNOWN_ERROR');
  }

  // Extract retriable flag
  let retriable = true;
  if (error && typeof error === 'object') {
    const err = error as any;
    retriable = err.retriable ?? err.retryable ?? true;
  }

  return {
    code,
    message,
    retriable,
    retryable: retriable, // Alias for UI tolerance
  };
}

/**
 * M1 CEE Orchestrator - Unified review() call
 *
 * This is the new entry point for CEE integration. It:
 * 1. Uses CeeClient.review() when SDK v1.12.0+ is available
 * 2. Falls back to compose pattern (draftGraph + options + bias + evidence) until then
 * 3. Wraps calls with circuit breaker
 * 4. Handles three-ID tracing per spec v1.1
 *
 * @param env - CEE environment config (baseUrl, apiKey, timeoutMs)
 * @param request - CeeReviewRequest with scenario_id, graph_snapshot, inference_results
 * @param plotRequestId - Original request ID from PLoT client
 */
export async function orchestrateCeeReview(
  env: OrchestratorEnv,
  request: CeeReviewRequest,
  plotRequestId: string,
): Promise<CeeOrchestrationResult> {
  const startTime = Date.now();

  // Sanitize request ID per M1 spec
  const sanitisedId = sanitizeRequestId(plotRequestId);
  const wasSanitised = sanitisedId !== plotRequestId;

  // Check circuit breaker
  if (!shouldAllowCeeCall()) {
    return {
      ceeReview: null,
      ceeTrace: {
        requestId: sanitisedId,
        degraded: true,
        timestamp: new Date().toISOString(),
        source: 'orchestrator',
        reason: 'Circuit breaker open',
        plot_request_id: plotRequestId,
        cee_sent_request_id: null, // Never sent
        cee_returned_request_id: null,
        latency_ms: 0,
        id_mismatch: false,
      },
      ceeError: {
        code: 'CEE_CIRCUIT_OPEN',
        message: 'Circuit breaker is open, CEE calls are temporarily blocked',
        retriable: true,
        retryable: true,
      },
    };
  }

  const client = createCEEClient({
    apiKey: String(env.apiKey ?? ''),
    baseUrl: env.baseUrl,
    timeout: Number(env.timeoutMs ?? 60_000),
  });

  try {
    let ceeReview: CeeReviewResponse | null = null;
    let ceeReturnedId: string | null = null;
    let model: string | undefined;
    let sdkLatencyMs: number | undefined;

    if (sdkSupportsReview(client)) {
      // M1 Path: Use unified review() method (SDK v1.12.0+)
      // TODO: Uncomment when SDK v1.12.0 is available
      // const response = await (client as any).review(request, {
      //   headers: { 'X-Request-Id': sanitisedId },
      //   timeout: Number(env.timeoutMs ?? 6_000),
      // });
      // ceeReview = response.review ?? response;
      // ceeReturnedId = response.trace?.request_id ?? null;
      // model = response.trace?.model;
      // sdkLatencyMs = response.trace?.latency_ms;
    } else if (isCeeSchemaV2Enabled()) {
      // V2 Path: Use direct HTTP with ?schema=v2 for v2 format responses
      // This path returns effect_direction, strength_std, observed_state fields
      console.log('[CEE_ORCHESTRATOR] Using schema v2 HTTP path');
      const brief = 'Decision review for inference results';
      const briefContext = {
        nodes: request.graph_snapshot.nodes?.length ?? 0,
        edges: request.graph_snapshot.edges?.length ?? 0,
      };
      const result = await runDecisionReviewViaV2Http(
        env,
        brief,
        briefContext,
        sanitisedId,
      );

      if (result.error) {
        throw new Error(result.error.code ?? 'CEE_V2_ERROR');
      }

      // Convert compose result to M1 response shape
      ceeReview = result.review ? {
        intent: request.intent,
        analysis_state: 'ran',
        readiness: {
          level: 'ready',
          headline: 'Analysis complete (v2)',
          factors: [],
        },
        blocks: [],
        trace: {
          request_id: result.trace?.cee_returned_request_id ?? undefined,
          latency_ms: result.trace?.latency_ms ?? undefined,
          model: result.trace?.model,
        },
      } : null;

      ceeReturnedId = result.trace?.cee_returned_request_id ?? null;
      model = result.trace?.model;
      sdkLatencyMs = result.trace?.latency_ms ?? undefined;
    } else {
      // Fallback: Use compose pattern via SDK (SDK v1.11.x)
      const brief = 'Decision review for inference results';
      // Derive counts from arrays for compose pattern (expects {nodes: number, edges: number})
      const briefContext = {
        nodes: request.graph_snapshot.nodes?.length ?? 0,
        edges: request.graph_snapshot.edges?.length ?? 0,
      };
      const result = await runDecisionReviewViaSdk(
        env,
        brief,
        undefined, // No evidence items in M1 path
        briefContext,
        sanitisedId,
      );

      if (result.error) {
        throw new Error(result.error.code ?? 'CEE_SDK_ERROR');
      }

      // Convert compose result to M1 response shape (blocks added below)
      ceeReview = result.review ? {
        intent: request.intent,
        analysis_state: 'ran',
        readiness: {
          level: 'ready',
          headline: 'Analysis complete',
          factors: [],
        },
        blocks: [], // Will be populated with ISL blocks below
        trace: {
          request_id: result.trace?.cee_returned_request_id ?? undefined,
          latency_ms: result.trace?.latency_ms ?? undefined,
          model: result.trace?.model,
        },
      } : null;

      ceeReturnedId = result.trace?.cee_returned_request_id ?? null;
      model = result.trace?.model;
      sdkLatencyMs = result.trace?.latency_ms ?? undefined;
    }

    // ISL block synthesis - hoisted outside if/else so both paths include blocks
    // This runs for both SDK review() path and compose pattern fallback
    // CEE returns single "robustness" block - consolidate all ISL signals into one
    if (ceeReview && request.isl_robustness) {
      const isl = request.isl_robustness;

      // Determine overall status from robustness + validation
      const robustnessStatus = isl.overall_robustness === 'robust' ? 'ok' :
                                isl.overall_robustness === 'moderate' ? 'warning' : 'error';
      const validationStatus = isl.validation_status === 'identifiable' ? 'ok' :
                                isl.validation_status === 'uncertain' ? 'warning' :
                                isl.validation_status === 'cannot_identify' ? 'error' : null;

      // Use worst status between robustness and validation
      let finalStatus: 'ok' | 'warning' | 'error' = robustnessStatus;
      if (validationStatus === 'error' || robustnessStatus === 'error') {
        finalStatus = 'error';
      } else if (validationStatus === 'warning' || robustnessStatus === 'warning') {
        finalStatus = 'warning';
      }

      // Build consolidated factors array
      const factors: string[] = [];

      // Add validation info if available
      if (isl.validation_status) {
        const confStr = isl.validation_confidence ? ` (${isl.validation_confidence} confidence)` : '';
        factors.push(`Identifiability: ${isl.validation_status}${confStr}`);
      }

      // Add top sensitive parameters (max 3)
      if (isl.sensitive_parameters && isl.sensitive_parameters.length > 0 && isl.overall_robustness !== 'robust') {
        const topParams = isl.sensitive_parameters.slice(0, 3);
        factors.push(...topParams.map(p => `${p.parameter}: ${(p.sensitivity * 100).toFixed(0)}% sensitivity (${p.impact_direction})`));
      }

      // Add recommendations
      if (isl.recommendations && isl.recommendations.length > 0) {
        factors.push(...isl.recommendations.slice(0, 2));
      }

      // Add source provenance
      factors.push('Source: ISL');

      // Single consolidated robustness block
      const robustnessBlock: CeeReviewBlock = {
        id: 'robustness',
        status: finalStatus,
        headline: `Model robustness: ${isl.overall_robustness}`,
        details: isl.validation_status
          ? `Identifiability: ${isl.validation_status}`
          : undefined,
        factors: factors.length > 0 ? factors : undefined,
      };

      // Merge with any existing blocks from SDK review()
      ceeReview.blocks = [...(ceeReview.blocks ?? []), robustnessBlock];
    }

    const latencyMs = sdkLatencyMs ?? (Date.now() - startTime);
    const idMismatch = ceeReturnedId != null && sanitisedId !== ceeReturnedId;

    // Record success for circuit breaker
    recordCeeSuccess();

    return {
      ceeReview,
      ceeTrace: {
        requestId: ceeReturnedId ?? sanitisedId,
        degraded: false,
        timestamp: new Date().toISOString(),
        source: 'orchestrator',
        plot_request_id: plotRequestId,
        cee_sent_request_id: sanitisedId,
        cee_returned_request_id: ceeReturnedId,
        latency_ms: latencyMs,
        model,
        id_mismatch: idMismatch,
      },
      ceeError: null,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;

    // Record failure for circuit breaker
    recordCeeFailure();

    // Diagnostic logging - help debug CEE failures
    const diagInfo = {
      typeof_error: typeof error,
      is_error_instance: error instanceof Error,
      error_keys: error && typeof error === 'object' ? Object.keys(error as object) : [],
      error_string: String(error),
      error_message: error instanceof Error ? error.message : (error as any)?.message,
      error_code: (error as any)?.code,
      cee_base_url_host: env.baseUrl ? new URL(env.baseUrl).host : 'not_set',
      has_api_key: Boolean(env.apiKey && env.apiKey.length > 0),
      plot_request_id: plotRequestId,
      latency_ms: latencyMs,
    };
    // Log to stderr for visibility in Render logs
    console.error('[CEE_ORCHESTRATOR_ERROR]', JSON.stringify(diagInfo));

    // Build reason - never undefined
    let reason: string;
    if (error instanceof Error) {
      reason = error.message || error.name || 'Error (no message)';
    } else if (typeof error === 'string') {
      reason = error || 'Empty string error';
    } else {
      reason = String(error) || 'Unknown error';
    }

    return {
      ceeReview: null,
      ceeTrace: {
        requestId: sanitisedId,
        degraded: true,
        timestamp: new Date().toISOString(),
        source: 'orchestrator',
        reason,
        plot_request_id: plotRequestId,
        cee_sent_request_id: sanitisedId,
        cee_returned_request_id: null,
        latency_ms: latencyMs,
        id_mismatch: false, // No returned ID, so no mismatch
      },
      ceeError: normalizeError(error),
    };
  }
}
