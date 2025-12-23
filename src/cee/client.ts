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
    (process.env.CEE_ORCHESTRATOR_ENABLE ?? process.env.CEE_ORCHESTRATOR_ENABLED) ?? undefined,
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
