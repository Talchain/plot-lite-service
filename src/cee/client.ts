// CEE Decision Review client (TypeScript)
// NOTE: Real CEE Decision Review POST endpoint is not yet specified.
// For now we implement health probing and a fixture-based fallback example endpoint.

import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type {
  CeeReviewResult as PortCeeReviewResult,
  CeeError as PortCeeError,
  CeeTrace,
  CeeDecisionReviewPayloadV1,
  CeeErrorSuggestedAction,
  FactorEnrichment,
  CeeFactorReviewRequest,
  CeeFactorReviewResponse,
} from './types.js';
import { runDecisionReviewViaSdk, type EvidenceHelperItem } from './orchestrator.js';
import { isFlagOn } from './codes.js';
import { computeOlumiHash } from '../util/canonical.js';
import { recordDownstreamCall } from '../util/downstream-tracker.js';

/**
 * Sanitize request ID per M1 CEE Orchestrator spec v1.1
 * Pattern: ^[A-Za-z0-9._-]+$ (max 64 chars)
 * Falls back to UUID if invalid
 */
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
export function sanitizeRequestId(id: string | undefined | null): string {
  if (id && id.length <= 64 && SAFE_REQUEST_ID_PATTERN.test(id)) {
    return id;
  }
  return randomUUID();
}

export interface CeeRunContext {
  // Minimal, non-sensitive context about the run
  schema: string; // 'run.v1' | 'report.v1'
  response_hash?: string;
  seed?: number;
  inference_mode?: string;
  graph_summary?: { nodes: number; edges: number };
  // Additional metadata can be added here as needed, but avoid raw user text.
  [key: string]: any;
}

export interface CeeErrorView {
  code: string;
  retryable: boolean;
  suggestedAction?: string;
  traceId?: string;
}

// P3: Typed CEE review structure for better type safety
export interface CeeReviewView {
  schema?: string;
  response_hash?: string;
  seed?: number | string;
  inference_mode?: string;
  graph_summary?: { nodes: number; edges: number };
  scenario_kind?: string;
  issues?: Array<{ code: string; message: string; severity?: string }>;
  [key: string]: unknown;  // Allow additional CEE fields
}

export interface CeeDecisionReviewResult {
  ceeReview: CeeReviewView | null;
  ceeTrace: CeeTrace | null;
  ceeError: CeeErrorView | null;
  usedFixture: boolean;
}

// Backwards-compatible alias (internal usage only)
export type CeeSuggestedAction = CeeErrorSuggestedAction;

function _isValidCeeDecisionReviewPayload(payload: any): payload is CeeDecisionReviewPayloadV1 {
  if (!payload || typeof payload !== 'object') return false;
  if ((payload as any).schema !== 'cee.decision-review.v1') return false;
  if (typeof (payload as any).response_hash !== 'string') return false;
  const seedType = typeof (payload as any).seed;
  if (seedType !== 'number' && seedType !== 'string') return false;
  if (typeof (payload as any).inference_mode !== 'string') return false;
  const summary = (payload as any).graph_summary;
  if (!summary || typeof summary !== 'object') return false;
  if (typeof summary.nodes !== 'number' || typeof summary.edges !== 'number') return false;
  return true;
}

export interface CeeReviewResult {
  review: CeeDecisionReviewPayloadV1 | null;
  trace: CeeTrace;
  error?: PortCeeError | null;
  usedFixture: boolean;
}

// isFlagOn moved to shared codes.js module

function getBaseUrl(): string | null {
  const url = process.env.CEE_BASE_URL?.trim();
  return url && url.length > 0 ? url : null;
}

function getApiKey(): string | null {
  const key = process.env.CEE_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

async function fetchWithTimeout(url: string, opts: FetchOptions): Promise<Response> {
  const { timeoutMs, ...rest } = opts;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs).unref?.() ?? setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id as any);
  }
}

// =============================================================================
// CEE Schema V2 HTTP Client
// =============================================================================
// Direct HTTP calls with ?schema=v2 query parameter for endpoints that need
// v2 format (effect_direction, strength_std, observed_state fields).
// Bypasses SDK which doesn't support schema parameter.

export interface CEESchemaV2Config {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface CEESchemaV2Response<T> {
  data: T;
  schema_version?: string;
  latency_ms: number;
}

/**
 * Call CEE endpoint with ?schema=v2 query parameter
 *
 * This bypasses the SDK to request v2 format which includes:
 * - effect_direction on edges (for signed weights)
 * - strength_std on edges (for parametric uncertainty)
 * - observed_state on nodes (for factor values)
 *
 * @param config - CEE connection config
 * @param path - Endpoint path (e.g., '/assist/v1/draft-graph')
 * @param payload - Request body
 * @param requestId - Request ID for tracing
 * @returns Response with v2 format data
 */
export async function callCEEWithSchemaV2<T>(
  config: CEESchemaV2Config,
  path: string,
  payload: unknown,
  requestId: string
): Promise<CEESchemaV2Response<T>> {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const url = `${baseUrl}${path}?schema=v2`;
  const timeoutMs = config.timeoutMs ?? 30000;
  const startMs = Date.now();

  // Compute payload hash for downstream tracking
  const payloadHash = computeOlumiHash(payload);

  try {
    // Log payload for debugging (only for options endpoint)
    if (path.includes('/options')) {
      const payloadObj = payload as Record<string, unknown>;
      console.log('[CEE_V2_OPTIONS_PAYLOAD]', JSON.stringify({
        path,
        payload_keys: Object.keys(payloadObj),
        graph_present: 'graph' in payloadObj,
        graph_type: typeof payloadObj.graph,
        graph_is_null: payloadObj.graph === null,
        graph_is_undefined: payloadObj.graph === undefined,
        graph_keys: payloadObj.graph && typeof payloadObj.graph === 'object'
          ? Object.keys(payloadObj.graph as object) : 'N/A',
        payload_preview: JSON.stringify(payload).slice(0, 500),
      }));
    }

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Olumi-Assist-Key': config.apiKey,
        'X-Request-Id': requestId,
      },
      body: JSON.stringify(payload),
      timeoutMs,
    });

    const latencyMs = Date.now() - startMs;

    if (!response.ok) {
      // Record failed downstream call (HTTP error)
      recordDownstreamCall({
        service: 'cee',
        endpoint: path,
        status: response.status,
        elapsedMs: latencyMs,
        payloadHash,
        requestId,
      });
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`CEE ${path} failed: HTTP ${response.status} - ${errorText}`);
    }

    // Capture X-CEE-API-Version header
    const ceeApiVersion = response.headers.get('X-CEE-API-Version');

    const data = await response.json() as T & { schema_version?: string; graph?: { edges?: Array<{ effect_direction?: string; strength_std?: number }> } };
    const schemaVersion = (data as any)?.schema_version;

    // Compute response hash for downstream tracking
    const responseHash = computeOlumiHash(data);

    // Record successful downstream call
    recordDownstreamCall({
      service: 'cee',
      endpoint: path,
      status: response.status,
      elapsedMs: latencyMs,
      payloadHash,
      responseHash,
      requestId,
    });

    // V2 verification logging per acceptance criteria
    const edges = (data as any)?.graph?.edges ?? [];
    const edgeCount = edges.length;
    const hasEffectDirection = edgeCount > 0 && edges.every((e: any) => e.effect_direction !== undefined);
    const hasStrengthStd = edgeCount > 0 && edges.every((e: any) => typeof e.strength_std === 'number' && e.strength_std > 0);

    console.log('[CEE_V2_RESPONSE]', JSON.stringify({
      path,
      cee_api_version: ceeApiVersion,
      schema_version: schemaVersion,
      edge_count: edgeCount,
      has_effect_direction: hasEffectDirection,
      has_strength_std: hasStrengthStd,
      latency_ms: latencyMs,
    }));

    // Warn if v2 format fields are missing
    if (!schemaVersion) {
      console.warn(`[CEE_V2] ${path} missing schema_version in response - may not be v2 format`);
    }
    if (edgeCount > 0 && !hasEffectDirection) {
      console.warn(`[CEE_V2] ${path} edges missing effect_direction - v2 format may not be enabled`);
    }

    return {
      data,
      schema_version: schemaVersion,
      latency_ms: latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startMs;

    // Record failed downstream call (network/timeout error)
    // Only record if not already recorded (HTTP errors are recorded above)
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (!errorMsg.includes('HTTP ')) {
      recordDownstreamCall({
        service: 'cee',
        endpoint: path,
        status: 0, // 0 indicates network/timeout error
        elapsedMs: latencyMs,
        payloadHash,
        requestId,
      });
    }

    console.error(`[CEE_V2] ${path} failed after ${latencyMs}ms:`, error instanceof Error ? error.message : error);
    throw error;
  }
}

/**
 * Draft graph with schema v2 format
 * Returns graph with effect_direction, strength_std on edges
 */
export async function draftGraphV2(
  config: CEESchemaV2Config,
  brief: string,
  requestId: string
): Promise<CEESchemaV2Response<any>> {
  return callCEEWithSchemaV2(
    config,
    '/assist/v1/draft-graph',
    { brief, config: { streaming: false } },
    requestId
  );
}

/**
 * Get options with schema v2 format
 */
export async function optionsV2(
  config: CEESchemaV2Config,
  graph: unknown,
  archetype: string | null,
  requestId: string
): Promise<CEESchemaV2Response<any>> {
  return callCEEWithSchemaV2(
    config,
    '/assist/v1/options',
    { graph, archetype },
    requestId
  );
}

/**
 * Bias check with schema v2 format
 */
export async function biasCheckV2(
  config: CEESchemaV2Config,
  graph: unknown,
  archetype: string | null,
  requestId: string
): Promise<CEESchemaV2Response<any>> {
  return callCEEWithSchemaV2(
    config,
    '/assist/v1/bias-check',
    { graph, archetype },
    requestId
  );
}

// -----------------------------------------------------------------------------
// Factor Enrichments - CEE /assist/v1/review
// -----------------------------------------------------------------------------

/** Hard timeout for factor enrichments (3s per brief) */
const FACTOR_REVIEW_TIMEOUT_MS = 3000;

/**
 * Call CEE /assist/v1/review for factor enrichments.
 *
 * This endpoint provides human-readable insights for factor cards in the UI.
 * It is DISTINCT from /assist/v1/decision-review (which provides robustness synthesis).
 *
 * Contract:
 * - 3s hard timeout
 * - On error/timeout: returns undefined (silent fallback)
 * - Does not throw exceptions
 * - Does not affect analysis_status
 * - Logs errors for observability
 *
 * @param config CEE connection config
 * @param graph Normalized graph used for analysis
 * @param factorSensitivity Factor sensitivity results (will be capped to top 10 by rank)
 * @param requestId Request ID for tracing
 * @returns Factor enrichments array, or undefined on error
 */
export async function factorReviewV2(
  config: CEESchemaV2Config,
  graph: unknown,
  factorSensitivity: CeeFactorReviewRequest['factor_sensitivity'],
  requestId: string
): Promise<FactorEnrichment[] | undefined> {
  const startMs = Date.now();
  const path = '/assist/v1/review';

  try {
    // Cap to top 10 factors by rank (per brief)
    const cappedFactors = [...factorSensitivity]
      .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity))
      .slice(0, 10);

    const payload: CeeFactorReviewRequest = {
      graph,
      factor_sensitivity: cappedFactors,
    };

    const baseUrl = config.baseUrl.replace(/\/$/, '');
    const url = `${baseUrl}${path}?schema=v2`;
    const payloadHash = computeOlumiHash(payload);

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Olumi-Assist-Key': config.apiKey,
        'X-Request-Id': requestId,
      },
      body: JSON.stringify(payload),
      timeoutMs: FACTOR_REVIEW_TIMEOUT_MS,
    });

    const latencyMs = Date.now() - startMs;

    if (!response.ok) {
      // Record failed downstream call
      recordDownstreamCall({
        service: 'cee',
        endpoint: path,
        status: response.status,
        elapsedMs: latencyMs,
        payloadHash,
        requestId,
      });

      const errorText = await response.text().catch(() => 'Unknown error');
      console.warn(JSON.stringify({
        event: 'cee_factor_review_error',
        request_id: requestId,
        status: response.status,
        error: errorText,
        latency_ms: latencyMs,
      }));

      return undefined;
    }

    const data = await response.json() as CeeFactorReviewResponse;
    const responseHash = computeOlumiHash(data);

    // Record successful downstream call
    recordDownstreamCall({
      service: 'cee',
      endpoint: path,
      status: response.status,
      elapsedMs: latencyMs,
      payloadHash,
      responseHash,
      requestId,
    });

    console.log(JSON.stringify({
      event: 'cee_factor_review_success',
      request_id: requestId,
      enrichment_count: data.factor_enrichments?.length ?? 0,
      latency_ms: latencyMs,
    }));

    return data.factor_enrichments;
  } catch (error) {
    const latencyMs = Date.now() - startMs;
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Record failed downstream call (network/timeout)
    recordDownstreamCall({
      service: 'cee',
      endpoint: path,
      status: 0, // 0 indicates network/timeout error
      elapsedMs: latencyMs,
      payloadHash: '-',
      requestId,
    });

    console.warn(JSON.stringify({
      event: 'cee_factor_review_error',
      request_id: requestId,
      error: errorMsg,
      latency_ms: latencyMs,
      timeout: errorMsg.includes('timeout') || errorMsg.includes('Timeout'),
    }));

    return undefined;
  }
}

async function probeHealth(baseUrl: string, timeoutMs: number, logger?: FastifyBaseLogger): Promise<boolean> {
  const url = `${baseUrl.replace(/\/$/, '')}/healthz`;
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(url, { timeoutMs, method: 'GET', headers: {} });
    const healthy = res.ok;
    logger?.info({ evt: 'cee_health_probe', status: res.status, healthy, duration_ms: Date.now() - started }, 'CEE health probe');
    return healthy;
  } catch (err: any) {
    logger?.warn({ evt: 'cee_health_error', error: String(err?.message || err), duration_ms: Date.now() - started }, 'CEE health probe failed');
    return false;
  }
}

async function fetchFixtureExample(baseUrl: string, timeoutMs: number, requestId: string, logger?: FastifyBaseLogger): Promise<CeeDecisionReviewResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/assist/v1/decision-review/example`;
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(url, {
      timeoutMs,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Request-Id': requestId,
      },
    });
    const durationMs = Date.now() - started;
    logger?.info({ evt: 'cee_fixture_fetch', status: res.status, duration_ms: durationMs }, 'CEE fixture fetch');

    if (!res.ok) {
      // Record failed fixture fetch
      recordDownstreamCall({
        service: 'cee',
        endpoint: '/assist/v1/decision-review/example',
        status: res.status,
        elapsedMs: durationMs,
        payloadHash: '-', // GET request, no payload
        requestId,
      });
      return {
        ceeReview: null,
        ceeTrace: {
          requestId,
          degraded: true,
          timestamp: new Date().toISOString(),
          reason: 'fixture_http_error',
          status: res.status,
        },
        ceeError: {
          code: 'CEE_FIXTURE_HTTP_ERROR',
          retryable: false,
          suggestedAction: 'fail',
        },
        usedFixture: true,
      };
    }

    let payload: any = null;
    try {
      payload = await res.json();
    } catch {
      // Record fixture fetch with parse error
      recordDownstreamCall({
        service: 'cee',
        endpoint: '/assist/v1/decision-review/example',
        status: res.status,
        elapsedMs: durationMs,
        payloadHash: '-',
        requestId,
      });
      return {
        ceeReview: null,
        ceeTrace: {
          requestId,
          degraded: true,
          timestamp: new Date().toISOString(),
          reason: 'fixture_parse_error',
        },
        ceeError: {
          code: 'CEE_FIXTURE_PARSE_ERROR',
          retryable: false,
          suggestedAction: 'fail',
        },
        usedFixture: true,
      };
    }

    // Record successful fixture fetch with response hash
    const responseHash = computeOlumiHash(payload);
    recordDownstreamCall({
      service: 'cee',
      endpoint: '/assist/v1/decision-review/example',
      status: res.status,
      elapsedMs: durationMs,
      payloadHash: '-',
      responseHash,
      requestId,
    });

    return {
      ceeReview: payload ?? null,
      ceeTrace: {
        requestId,
        degraded: false,
        timestamp: new Date().toISOString(),
        source: 'fixture_example',
      },
      ceeError: null,
      usedFixture: true,
    };
  } catch {
    const durationMs = Date.now() - started;
    // Record fixture fetch network error
    recordDownstreamCall({
      service: 'cee',
      endpoint: '/assist/v1/decision-review/example',
      status: 0,
      elapsedMs: durationMs,
      payloadHash: '-',
      requestId,
    });
    return {
      ceeReview: null,
      ceeTrace: {
        requestId,
        degraded: true,
        timestamp: new Date().toISOString(),
        reason: 'fixture_fetch_error',
      },
      ceeError: {
        code: 'CEE_FIXTURE_ERROR',
        retryable: false,
        suggestedAction: 'fail',
      },
      usedFixture: true,
    };
  }
}

export interface RunDecisionReviewOptions {
  context: CeeRunContext;
  requestId: string;
  logger?: FastifyBaseLogger;
}

// CEE timeout: 60s for staging integration testing (tighten for production later)
const DEFAULT_TIMEOUT_MS = Number(process.env.CEE_TIMEOUT_MS || 60_000);

export async function runDecisionReview(opts: RunDecisionReviewOptions): Promise<CeeDecisionReviewResult> {
  const { context, requestId, logger } = opts;

  const legacyOn = isFlagOn(process.env.CEE_REVIEW_ENABLED);
  const orchestratorOn = isFlagOn(
    (process.env.CEE_ORCHESTRATOR_ENABLED ?? process.env.CEE_ORCHESTRATOR_ENABLE) ?? undefined,
  );

  // Master gate: without orchestrator flag, behave exactly as today (no CEE fields populated).
  if (!orchestratorOn) {
    if (legacyOn) {
      logger?.info({ evt: 'cee_disabled_legacy_on' }, 'CEE legacy flag set but orchestrator disabled; skipping CEE');
    }
    return { ceeReview: null, ceeTrace: null, ceeError: null, usedFixture: false };
  }

  const baseUrl = getBaseUrl();
  const apiKey = getApiKey();

  if (!baseUrl || !apiKey) {
    logger?.warn({ evt: 'cee_config_missing', has_base_url: !!baseUrl, has_api_key: !!apiKey }, 'CEE config missing; skipping CEE');
    return {
      ceeReview: null,
      ceeTrace: null,
      ceeError: {
        code: 'CEE_CONFIG_MISSING',
        retryable: false,
        suggestedAction: 'fix_input',
      },
      usedFixture: false,
    };
  }

  const timeoutMs = DEFAULT_TIMEOUT_MS;

  const healthy = await probeHealth(baseUrl, timeoutMs, logger);
  if (!healthy) {
    logger?.warn({ evt: 'cee_unhealthy' }, 'CEE unhealthy; using fixture example if available');
    return fetchFixtureExample(baseUrl, timeoutMs, requestId, logger);
  }

  // POST to real CEE Decision Review endpoint
  return postDecisionReview(baseUrl, apiKey, timeoutMs, context, requestId, logger);
}

/**
 * POST to /assist/v1/decision-review endpoint with structured context.
 * Falls back to fixture on failure for graceful degradation.
 */
async function postDecisionReview(
  baseUrl: string,
  apiKey: string,
  timeoutMs: number,
  context: CeeRunContext,
  requestId: string,
  logger?: FastifyBaseLogger
): Promise<CeeDecisionReviewResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/assist/v1/decision-review`;
  const started = Date.now();

  // Build the decision review payload following CeeDecisionReviewPayloadV1 contract
  const payload: CeeDecisionReviewPayloadV1 = {
    schema: 'cee.decision-review.v1',
    response_hash: context.response_hash || '',
    seed: context.seed ?? 0,
    inference_mode: context.inference_mode || 'standard',
    graph_summary: context.graph_summary || { nodes: 0, edges: 0 },
    scenario_kind: context.scenario_kind,
  };

  // P1: Compute payload hash for x-olumi-payload-hash header (outside try for catch access)
  const payloadHash = computeOlumiHash(payload);

  try {
    const res = await fetchWithTimeout(url, {
      timeoutMs,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Request-Id': requestId,
        'x-olumi-payload-hash': payloadHash,
      },
      body: JSON.stringify(payload),
    });

    const durationMs = Date.now() - started;
    logger?.info(
      { evt: 'cee_decision_review_post', status: res.status, duration_ms: durationMs },
      'CEE decision review POST completed'
    );

    if (!res.ok) {
      // Record failed downstream call
      recordDownstreamCall({
        service: 'cee',
        endpoint: '/assist/v1/decision-review',
        status: res.status,
        elapsedMs: durationMs,
        payloadHash,
        requestId,
      });
      // Non-2xx response - fallback to fixture
      logger?.warn(
        { evt: 'cee_decision_review_error', status: res.status, duration_ms: durationMs },
        'CEE decision review POST failed; falling back to fixture'
      );
      return fetchFixtureExample(baseUrl, timeoutMs, requestId, logger);
    }

    let responsePayload: any = null;
    try {
      responsePayload = await res.json();
    } catch {
      // Record downstream call with parse error
      recordDownstreamCall({
        service: 'cee',
        endpoint: '/assist/v1/decision-review',
        status: res.status,
        elapsedMs: durationMs,
        payloadHash,
        requestId,
      });
      logger?.warn({ evt: 'cee_decision_review_parse_error' }, 'Failed to parse CEE response');
      return {
        ceeReview: null,
        ceeTrace: {
          requestId,
          degraded: true,
          timestamp: new Date().toISOString(),
          reason: 'parse_error',
        },
        ceeError: {
          code: 'CEE_PARSE_ERROR',
          retryable: true,
          suggestedAction: 'retry',
        },
        usedFixture: false,
      };
    }

    // Record successful downstream call with response hash
    const responseHash = computeOlumiHash(responsePayload);
    recordDownstreamCall({
      service: 'cee',
      endpoint: '/assist/v1/decision-review',
      status: res.status,
      elapsedMs: durationMs,
      payloadHash,
      responseHash,
      requestId,
    });

    return {
      ceeReview: responsePayload ?? null,
      ceeTrace: {
        requestId,
        degraded: false,
        timestamp: new Date().toISOString(),
        source: 'decision_review_post',
      },
      ceeError: null,
      usedFixture: false,
    };
  } catch (err: any) {
    const durationMs = Date.now() - started;
    // Record timeout/network error downstream call
    recordDownstreamCall({
      service: 'cee',
      endpoint: '/assist/v1/decision-review',
      status: 0, // 0 indicates network/timeout error
      elapsedMs: durationMs,
      payloadHash,
      requestId,
    });
    logger?.warn(
      { evt: 'cee_decision_review_fetch_error', error: String(err?.message || err), duration_ms: durationMs },
      'CEE decision review fetch failed; falling back to fixture'
    );

    // Graceful degradation: fallback to fixture
    return fetchFixtureExample(baseUrl, timeoutMs, requestId, logger);
  }
}

export async function callDecisionReviewFromEngineLegacy(opts: {
  requestId?: string;
  context: {
    response_hash: string;
    seed: number | string;
    inference_mode: string;
    graph_summary: { nodes: number; edges: number };
    schema?: string;
    scenario_kind?: string;
  };
  logger?: FastifyBaseLogger;
}): Promise<{
  review: unknown | null;
  trace: CeeTrace;
  error?: PortCeeError;
}> {
  const { requestId, context, logger } = opts;
  const reqId = requestId && String(requestId).trim() ? String(requestId) : 'cee-unknown';

  try {
    const ceeResult = await runDecisionReview({
      context: {
        schema: context.schema ?? 'run.v1',
        response_hash: context.response_hash,
        seed: typeof context.seed === 'number' ? context.seed : Number(context.seed) || undefined,
        inference_mode: context.inference_mode,
        graph_summary: context.graph_summary,
        scenario_kind: context.scenario_kind,
      } as CeeRunContext,
      requestId: reqId,
      logger,
    });
 
    const hasReview = ceeResult.ceeReview !== null && ceeResult.ceeReview !== undefined;
    const hasError = !!ceeResult.ceeError;

    let error: PortCeeError | undefined;
    if (!hasReview && !hasError) {
      error = {
        code: 'CEE_EMPTY_REVIEW',
        message: undefined,
        traceId: undefined,
        retryable: false,
        suggestedAction: 'retry',
      };
    } else if (ceeResult.ceeError) {
      const sa = ceeResult.ceeError.suggestedAction;
      const suggestedAction: CeeSuggestedAction =
        sa === 'retry' || sa === 'fix_input' || sa === 'fail' ? sa : 'retry';
      error = {
        code: ceeResult.ceeError.code,
        message: undefined,
        traceId: ceeResult.ceeError.traceId,
        retryable: ceeResult.ceeError.retryable,
        suggestedAction,
      };
    }

    const degraded = !!error;
    const trace: CeeTrace = {
      requestId: reqId,
      degraded,
      timestamp: new Date().toISOString(),
      source: 'cee-adapter',
      ...(error ? { reason: `CEE error: ${error.code}` } : {}),
    };

    return {
      review: hasReview ? ceeResult.ceeReview : null,
      trace,
      ...(error ? { error } : {}),
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger?.warn?.(
      { evt: 'cee_adapter_error', error: errMsg },
      'CEE adapter failed; returning degraded trace',
    );
    return {
      review: null,
      trace: {
        requestId: reqId,
        degraded: true,
        timestamp: new Date().toISOString(),
        source: 'cee-adapter',
        reason: `Adapter threw: ${errMsg}`,
      },
      error: {
        code: 'CEE_ADAPTER_ERROR',
        message: undefined,
        traceId: undefined,
        retryable: false,
        suggestedAction: 'retry',
      },
    };
  }
}

const toBool = (v: unknown): boolean => v === true || v === '1' || v === 'true';

async function fetchJson(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: any },
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; json?: any }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const json = res.ok ? await res.json() : undefined;
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(t as any);
  }
}

type EngineEvidenceItem = {
  node_id: string;
  source: string;
  note?: string;
  weight?: number;
};

function mapEvidenceItems(evidence?: EngineEvidenceItem[]): EvidenceHelperItem[] {
  if (!Array.isArray(evidence)) return [];

  const items: EvidenceHelperItem[] = [];
  for (const item of evidence) {
    if (!item || typeof item.node_id !== 'string' || item.node_id.trim() === '') {
      continue;
    }

    const id = item.node_id;
    const source = typeof item.source === 'string' && item.source.trim() ? item.source : undefined;
    const content = typeof item.note === 'string' && item.note.trim() ? item.note : undefined;

    const mapped: EvidenceHelperItem = {
      id,
      type: 'other',
      ...(source ? { source } : {}),
      ...(content ? { content } : {}),
    };

    items.push(mapped);
  }

  return items;
}

export async function callDecisionReviewFromEngine(opts: {
  requestId?: string;
  context: {
    response_hash: string;
    seed: number | string;
    inference_mode: string;
    graph_summary: { nodes: number; edges: number };
    scenario_kind?: string;
  };
  env: {
    enable?: boolean | string;
    baseUrl?: string;
    apiKey?: string;
    timeoutMs?: number;
  };
  evidence?: EngineEvidenceItem[];
  /** Optional enhanced mode flag for richer review journeys. */
  enhanced?: boolean;
}): Promise<PortCeeReviewResult & { usedFixture: boolean }> {
  // M1 CEE Orchestrator spec v1.1: Sanitize request ID and use 6s timeout
  const plotRequestId = opts.requestId || '';
  const requestId = sanitizeRequestId(plotRequestId);
  const timeoutMs = Number(opts.env.timeoutMs ?? 60_000);

  const degraded = (
    code: string,
    suggested: 'retry' | 'fix_input' | 'fail',
    usedFixture = false,
    /** Optional degradation reason for observability */
    reason?: string,
    /** Optional HTTP status code when degraded due to upstream failure */
    status?: number,
    /** Latency in ms if available */
    latencyMs?: number,
  ): PortCeeReviewResult & { usedFixture: boolean } => ({
    review: null,
    trace: {
      requestId,
      degraded: true,
      timestamp: new Date().toISOString(),
      source: 'cee-client',
      // M1 CEE Orchestrator spec v1.1: Three-ID tracing
      plot_request_id: plotRequestId || undefined,
      cee_sent_request_id: requestId,
      cee_returned_request_id: null,
      latency_ms: latencyMs ?? null,
      id_mismatch: false, // No response, so no mismatch possible
      ...(reason ? { reason } : {}),
      ...(status ? { status } : {}),
    },
    error: { code, suggestedAction: suggested } as PortCeeError,
    usedFixture,
  });

  // Defense-in-depth: Caller (/v1/run) is expected to gate enable/config before calling.
  // These checks provide safety for direct callers that may skip upstream gating.
  if (!toBool(opts.env.enable)) {
    return degraded('CEE_DISABLED', 'fix_input', false, 'CEE feature disabled via environment');
  }

  const baseUrl = opts.env.baseUrl;
  const apiKey = opts.env.apiKey;
  if (!baseUrl || !apiKey) {
    return degraded('CEE_CONFIG_MISSING', 'fix_input', false, 'Missing CEE_BASE_URL or CEE_API_KEY');
  }

  // 1) Health probe
  try {
    const h = await fetchJson(
      `${baseUrl.replace(/\/$/, '')}/healthz`,
      {
        headers: {
          'X-Request-Id': requestId,
        },
      },
      Math.min(timeoutMs, 2000),
    );

    if (!h.ok) throw new Error(String(h.status));
  } catch {
    // 2) Fixture fallback
    try {
      const fx = await fetchJson(
        `${baseUrl.replace(/\/$/, '')}/assist/v1/decision-review/example`,
        {
          headers: {
            Accept: 'application/json',
            'X-Request-Id': requestId,
          },
        },
        timeoutMs,
      );

      if (fx.ok && fx.json) {
        return {
          review: fx.json,
          trace: {
            requestId,
            degraded: true,
            timestamp: new Date().toISOString(),
            source: 'fixture',
            reason: 'CEE health check failed; using fixture fallback',
          },
          error: { code: 'CEE_FALLBACK_FIXTURE', suggestedAction: 'retry' } as PortCeeError,
          usedFixture: true,
        };
      }
    } catch {
      // ignore fixture errors and fall through to degraded
    }

    return degraded('CEE_UNAVAILABLE', 'retry', false, 'CEE health check failed and fixture fallback unavailable');
  }

  // 3) Real path via Assistants SDK orchestrator
  const orchestratorStart = Date.now();
  try {
    const brief = opts.enhanced
      ? 'Create a small decision graph from the run context with enhanced assumptions and sensitivity insights.'
      : 'Create a small decision graph from the run context.';
    const evidenceItems = mapEvidenceItems(opts.evidence);
    // Pass graph_summary as structural context (no user content exposed)
    const briefContext = opts.context.graph_summary;
    // M1 CEE Orchestrator spec v1.1: Pass request ID for three-ID tracing
    const res = await runDecisionReviewViaSdk(
      { baseUrl, apiKey, timeoutMs },
      brief,
      evidenceItems,
      briefContext,
      requestId, // Pass sanitized request ID
    );
    const orchestratorLatency = Date.now() - orchestratorStart;
    const hasReview = res.review !== null && res.review !== undefined;
    const hasError = !!res.error;

    if (!hasReview && !hasError) {
      return degraded('CEE_EMPTY_REVIEW', 'retry', false, 'SDK returned neither review nor error', undefined, orchestratorLatency);
    }

    // M1 CEE Orchestrator spec v1.1: Build trace with three-ID tracking
    const ceeReturnedId = res.trace?.cee_returned_request_id ?? null;
    const idMismatch = requestId !== ceeReturnedId && ceeReturnedId !== null;
    const trace = {
      ...(res.trace ?? {}),
      requestId,
      degraded: !!res.error,
      timestamp: new Date().toISOString(),
      source: 'orchestrator',
      // Three-ID tracing
      plot_request_id: plotRequestId || undefined,
      cee_sent_request_id: requestId,
      cee_returned_request_id: ceeReturnedId,
      latency_ms: res.trace?.latency_ms ?? orchestratorLatency,
      model: res.trace?.model,
      id_mismatch: idMismatch,
      ...(res.error ? { reason: `SDK error: ${res.error.code || 'CEE_SDK_ERROR'}` } : {}),
    };

    let error: PortCeeError | undefined;
    if (res.error) {
      error = {
        code: res.error.code || 'CEE_SDK_ERROR',
        retryable: res.error.retryable ?? true,
        traceId: res.error.traceId,
        suggestedAction: res.error.suggestedAction ?? 'retry',
      };
    }

    return {
      review: (res.review ?? null) as any,
      trace: trace as any,
      ...(error ? { error } : {}),
      usedFixture: false,
    };
  } catch (err: unknown) {
    const orchestratorLatency = Date.now() - orchestratorStart;
    const msg = err instanceof Error ? err.message : String(err);
    return degraded('CEE_CLIENT_ERROR', 'retry', false, `SDK orchestrator threw: ${msg}`, undefined, orchestratorLatency);
  }
}
