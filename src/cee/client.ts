// CEE Decision Review client (TypeScript)
// NOTE: Real CEE Decision Review POST endpoint is not yet specified.
// For now we implement health probing and a fixture-based fallback example endpoint.

import type { FastifyBaseLogger } from 'fastify';

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
