// CEE Decision Review client (TypeScript)
// NOTE: Real CEE Decision Review POST endpoint is not yet specified.
// For now we implement health probing and a fixture-based fallback example endpoint.

import type { FastifyBaseLogger } from 'fastify';
import type { CeeReviewResult as PortCeeReviewResult, CeeError as PortCeeError } from './types.js';
import { runDecisionReviewViaSdk } from './orchestrator.js';

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

export interface CeeDecisionReviewResult {
  ceeReview: any | null;
  ceeTrace: any | null;
  ceeError: CeeErrorView | null;
  usedFixture: boolean;
}

export type CeeErrorSuggestedAction = 'retry' | 'fix_input' | 'fail';

// Backwards-compatible alias (internal usage only)
export type CeeSuggestedAction = CeeErrorSuggestedAction;

export interface CeeTrace {
  requestId: string;
  degraded: boolean;
  timestamp: string;
  featureVersion?: string;
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
  usedFixture: boolean;
}

function isFlagOn(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const v = raw.toLowerCase();
  return v === '1' || v === 'true';
}

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
  } catch (err: any) {
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

const DEFAULT_TIMEOUT_MS = Number(process.env.CEE_TIMEOUT_MS || 2000);

export async function runDecisionReview(opts: RunDecisionReviewOptions): Promise<CeeDecisionReviewResult> {
  const { context, requestId, logger } = opts;

  const legacyOn = isFlagOn(process.env.CEE_REVIEW_ENABLED);
  const orchestratorOn = isFlagOn(process.env.CEE_ORCHESTRATOR_ENABLE);

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

  // TODO: Implement real CEE Decision Review POST endpoint once contract is available.
  // For now, we use the fixture example as a stand-in to exercise plumbing.
  return fetchFixtureExample(baseUrl, timeoutMs, requestId, logger);
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
  error?: CeeError;
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

    const degraded = !!ceeResult.ceeError;
    const trace: CeeTrace = {
      requestId: reqId,
      degraded,
      timestamp: new Date().toISOString(),
    };

    let error: CeeError | undefined;
    if (ceeResult.ceeError) {
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

    return {
      review: ceeResult.ceeReview,
      trace,
      ...(error ? { error } : {}),
    };
  } catch (err: any) {
    logger?.warn?.(
      { evt: 'cee_adapter_error', error: String(err?.message || err) },
      'CEE adapter failed; returning degraded trace',
    );
    return {
      review: null,
      trace: {
        requestId: reqId,
        degraded: true,
        timestamp: new Date().toISOString(),
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
}): Promise<PortCeeReviewResult & { usedFixture: boolean }> {
  const requestId = String(opts.requestId || '');
  const timeoutMs = Number(opts.env.timeoutMs ?? 10_000);

  const degraded = (
    code: string,
    suggested: 'retry' | 'fix_input' | 'fail',
    usedFixture = false,
  ): PortCeeReviewResult & { usedFixture: boolean } => ({
    review: null,
    trace: {
      requestId,
      degraded: true,
      timestamp: new Date().toISOString(),
    },
    error: { code, suggestedAction: suggested } as PortCeeError,
    usedFixture,
  });

  if (!toBool(opts.env.enable)) {
    return degraded('CEE_DISABLED', 'fix_input');
  }

  const baseUrl = opts.env.baseUrl;
  const apiKey = opts.env.apiKey;
  if (!baseUrl || !apiKey) {
    return degraded('CEE_CONFIG_MISSING', 'fix_input');
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
          },
          error: { code: 'CEE_FALLBACK_FIXTURE', suggestedAction: 'retry' } as PortCeeError,
          usedFixture: true,
        };
      }
    } catch {
      // ignore fixture errors and fall through to degraded
    }

    return degraded('CEE_UNAVAILABLE', 'retry');
  }

  // 3) Real path via Assistants SDK orchestrator
  try {
    const brief = 'Create a small decision graph from the run context.';
    const res = await runDecisionReviewViaSdk(
      { baseUrl, apiKey, timeoutMs },
      brief,
    );

    const trace = {
      requestId,
      degraded: !!res.error,
      timestamp: new Date().toISOString(),
      ...(res.trace ?? {}),
    };

    let error: PortCeeError | undefined;
    if (res.error) {
      error = {
        code: res.error.code,
        retryable: res.error.retryable,
        traceId: res.error.traceId,
        suggestedAction: res.error.suggestedAction,
      };
    }

    return {
      review: (res.review ?? null) as any,
      trace: trace as any,
      ...(error ? { error } : {}),
      usedFixture: false,
    };
  } catch {
    return degraded('CEE_CLIENT_ERROR', 'retry');
  }
}
