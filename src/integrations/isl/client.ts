/**
 * ISL HTTP Client with Retry Logic
 *
 * Provides robust HTTP communication with ISL service including:
 * - Configurable timeouts
 * - Exponential backoff retry
 * - Structured logging
 * - Error classification
 */

import { ISLHttpError, ISLTimeoutError, ISLNetworkError, isRetryableError, parseRetryAfterMs, type ISLError422 } from './errors.js';
import { decideIslRetry, type ISLRetryBudget } from './retry-budget.js';
import type { ISLHealthResponse } from './types/isl-types.js';
import { computeOlumiHash } from '../../util/canonical.js';
import { recordIslSuccess, recordIslFailure, shouldAllowIslCall } from '../isl-circuit-breaker.js';
import { recordDownstreamCall, sanitizePayloadForDebug, computePayloadDigest } from '../../util/downstream-tracker.js';
// ROADMAP 2.202: the backoff series now lives behind decideIslRetry (which
// still derives it from islRetryBackoffMs — the single source is unchanged).
import { ISL_TIMEOUT_MS, ISL_HEALTH_CHECK_TIMEOUT_MS, resolveIslMaxRetries } from '../../config/timeouts.js';

/**
 * ISL client configuration
 */
export interface ISLClientConfig {
  /** Base URL for ISL service */
  baseUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** Request timeout in milliseconds */
  timeoutMs: number;
  /** Maximum retry attempts */
  maxRetries: number;
  /** Health check timeout in milliseconds (default: 5000) */
  healthCheckTimeoutMs?: number;
}

/**
 * Options for a single ISL request
 */
export interface ISLRequestOptions {
  /** API endpoint path */
  endpoint: string;
  /** Request body */
  body: unknown;
  /** Request ID for tracing */
  requestId: string;
  /**
   * Optional external cancellation signal (e.g. a flip-search factor/overall
   * deadline). Folded into THIS attempt's timeout AbortController so an in-flight
   * fetch aborts the moment the caller's deadline trips. A deadline-cancel
   * surfaces as an {@link ISLTimeoutError} — the same class as the per-attempt
   * timeout — because the fold re-aborts via `controller.abort()` (name
   * `AbortError`), preserving the existing AbortError→ISLTimeoutError mapping.
   */
  signal?: AbortSignal;
  /**
   * ROADMAP 2.202 — the caller's remaining wall-clock budget for THIS request.
   *
   * When supplied, the retry decision is made from the budget that actually
   * remains after each failure instead of from a worst-case attempt count fixed
   * up front — which is what made the (already-correct) 429 retry unreachable
   * on the /v2/run base call. When omitted, retry behaviour is exactly as
   * before: bounded by `config.maxRetries` with exponential backoff.
   *
   * See `./retry-budget.ts` for the full rationale.
   */
  budget?: ISLRetryBudget;
}

/**
 * Result from ISL request, including response metadata
 */
export interface ISLRequestResult<T> {
  /** Parsed response data */
  data: T;
  /** Request ID echoed back by ISL in X-Request-Id response header */
  islEchoedRequestId: string | null;
}

/**
 * Safely parse JSON, returning the string if parsing fails.
 */
function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * ISL HTTP Client
 *
 * Handles all HTTP communication with ISL service.
 */
export class ISLClient {
  private config: ISLClientConfig;

  constructor(config: ISLClientConfig) {
    this.config = config;
  }

  /**
   * Make a POST request to ISL with retry logic
   *
   * @param options - Request options
   * @returns Parsed JSON response
   * @throws ISLHttpError on non-2xx responses
   */
  async request<T>(options: ISLRequestOptions): Promise<ISLRequestResult<T>> {
    const { endpoint, body, requestId, signal: externalSignal, budget } = options;
    // Pin response version via query param (in addition to header)
    const url = `${this.config.baseUrl}${endpoint}?response_version=2`;

    // ROADMAP 2.202 — start of the client's own clock. `budget.remainingMs` is
    // measured against THIS instant, so the caller never has to share a clock
    // with the client (run.ts measures with performance.now(); we use Date.now()).
    const requestStartedAt = Date.now();

    // Log the exact URL called (excluding API key) for debugging
    this.log('info', {
      event: 'isl_request_url',
      url,
      endpoint,
      request_id: requestId,
    });

    // ROADMAP 1.209 — the READ half, DARK-SHIPPED.
    //
    // Recording (below) is always on, so the breaker's state becomes real and
    // observable on /health immediately. Acting on it is gated behind
    // ISL_CB_ENFORCE=1 and defaults OFF, because skipping ISL calls is a
    // genuine behaviour change and this breaker has never actually run: its
    // thresholds were tuned against nothing. Flip the flag once /health shows
    // what it would have done on real traffic.
    //
    // Until then this is honest in both directions — the breaker can trip, and
    // /health reports what it observes rather than an unearned 'closed'.
    if (process.env.ISL_CB_ENFORCE === '1') {
      const gate = shouldAllowIslCall();
      if (!gate.allowed) {
        this.log('warn', {
          event: 'isl_circuit_breaker_open',
          endpoint,
          reason: gate.reason,
          request_id: requestId,
        });
        throw new ISLNetworkError(endpoint, new Error(gate.reason ?? 'ISL circuit breaker open'));
      }
    }

    let lastError: Error | null = null;

    // P1: Compute payload hash outside loop for catch block access
    const payloadHash = computeOlumiHash(body);

    // Lane PLoT-R3 (2.13): diligence-grade digest of the EXACT request bytes
    // sent to ISL (same serialisation as the fetch body below). sha256 + byte
    // length + sorted top-level key manifest — full bodies never ride the wire.
    const requestBodyText = JSON.stringify(body);
    const requestDigest = computePayloadDigest(requestBodyText, body);

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      // Track start time outside try block for catch access
      const startTime = Date.now();

      // Per-attempt timeout controller. Hoisted (with the external-signal
      // listener) so the `finally` below always clears the timer and detaches the
      // listener — even on the throwing path — with no cross-attempt leak.
      const controller = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let onExternalAbort: (() => void) | undefined;

      try {
        timeoutId = setTimeout(
          () => controller.abort(),
          this.config.timeoutMs
        );
        // Fold the caller's external cancellation signal into THIS attempt's
        // controller: if it is (or becomes) aborted, abort the in-flight fetch.
        // Re-aborted via controller.abort() (name 'AbortError') so a deadline
        // cancel maps to ISLTimeoutError exactly like the per-attempt timeout.
        if (externalSignal) {
          if (externalSignal.aborted) {
            controller.abort();
          } else {
            onExternalAbort = () => controller.abort();
            externalSignal.addEventListener('abort', onExternalAbort, { once: true });
          }
        }

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.config.apiKey,
            'X-Request-Id': requestId,
            'x-olumi-payload-hash': payloadHash,
            // P0-PLOT-2: Request ISL V2 responses
            'X-ISL-Response-Version': '2',
          },
          // Lane PLoT-R3 (2.13): send the pre-serialised text so requestDigest
          // is a digest of the EXACT bytes on the wire.
          body: requestBodyText,
          signal: controller.signal,
        });

        const duration = Date.now() - startTime;

        // Always log downstream elapsed time (not suppressed)
        console.log(JSON.stringify({
          event: 'isl_downstream_elapsed',
          endpoint,
          status: response.status,
          elapsed_ms: duration,
          attempt,
          request_id: requestId,
        }));

        if (!response.ok) {
          const errorBody = await response.text();
          // Capture echoed request ID even on error responses for chain tracing
          const errorEchoedRequestId = response.headers.get('x-request-id') ?? null;
          // ROADMAP 2.202: capture ISL's `Retry-After` hint. Previously the
          // response headers were read for `x-request-id` ONLY, so the governor's
          // RETRY_AFTER_SECONDS=5 on a 429 was discarded and any retry could only
          // guess. `undefined` when absent/unparseable → our own backoff is used.
          const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
          // Record failed downstream call with payloads for debug
          recordDownstreamCall({
            service: 'isl',
            endpoint,
            status: response.status,
            elapsedMs: duration,
            payloadHash,
            requestId,
            requestPayload: sanitizePayloadForDebug(body),
            responsePayload: sanitizePayloadForDebug(tryParseJson(errorBody)),
            // Lane PLoT-R3 (2.13): digests of the exact bytes exchanged
            requestDigest,
            responseDigest: computePayloadDigest(errorBody, tryParseJson(errorBody)),
          });

          // P0-PLOT-3: Parse ISL 422 as structured result
          // 422 contains structured critiques that should be passed through
          if (response.status === 422) {
            try {
              const islError = JSON.parse(errorBody) as ISLError422;
              const err = new ISLHttpError(response.status, errorBody, endpoint, islError, retryAfterMs);
              (err as any).islEchoedRequestId = errorEchoedRequestId;
              throw err;
            } catch (parseErr) {
              if (parseErr instanceof ISLHttpError) throw parseErr;
              // If parsing fails, throw generic error
              const err = new ISLHttpError(response.status, errorBody, endpoint, undefined, retryAfterMs);
              (err as any).islEchoedRequestId = errorEchoedRequestId;
              throw err;
            }
          }

          const err = new ISLHttpError(response.status, errorBody, endpoint, undefined, retryAfterMs);
          (err as any).islEchoedRequestId = errorEchoedRequestId;
          throw err;
        }

        // Parse response and record successful downstream call with payloads for debug.
        // Lane PLoT-R3 (2.13): read the raw text first so responseDigest covers
        // the EXACT bytes received, then parse (same JSON, same errors as .json()).
        const responseText = await response.text();
        const responseData = JSON.parse(responseText) as T;
        const islEchoedRequestId = response.headers.get('x-request-id') ?? null;
        const responseHash = computeOlumiHash(responseData);
        recordDownstreamCall({
          service: 'isl',
          endpoint,
          status: response.status,
          elapsedMs: duration,
          payloadHash,
          responseHash,
          requestId,
          requestPayload: sanitizePayloadForDebug(body),
          responsePayload: sanitizePayloadForDebug(responseData),
          // Lane PLoT-R3 (2.13): digests of the exact bytes exchanged
          requestDigest,
          responseDigest: computePayloadDigest(responseText, responseData),
        });

        // ROADMAP 1.209: the ISL circuit breaker had ZERO writers until now, so
        // it could never trip while /health was free to imply it was protecting
        // something. This is the success half.
        recordIslSuccess();

        return { data: responseData, islEchoedRequestId };
      } catch (error) {
        // P1.1: Wrap errors in appropriate ISL error types
        let wrappedError: Error;
        const rawError = error as Error;

        if (rawError.name === 'AbortError') {
          // Timeout (AbortController abort)
          wrappedError = new ISLTimeoutError(endpoint, this.config.timeoutMs);
        } else if (rawError.name === 'TypeError' || rawError.message?.includes('fetch')) {
          // Network error (DNS, connection refused, etc.)
          wrappedError = new ISLNetworkError(endpoint, rawError);
        } else if (rawError instanceof ISLHttpError) {
          // Already typed
          wrappedError = rawError;
        } else {
          // Unknown error - wrap as network error
          wrappedError = new ISLNetworkError(endpoint, rawError);
        }

        lastError = wrappedError;

        const retryable = isRetryableError(wrappedError);

        // ROADMAP 2.202 — decide from the budget that ACTUALLY remains, not from
        // a worst-case attempt count fixed before the first byte was sent. The
        // old gate was `attempt === this.config.maxRetries`, and /v2/run's
        // up-front clamp resolved that cap to 1, so a 133ms 429 became a typed
        // failure with ~69.8s of budget unspent. With no `budget` supplied the
        // decision degenerates to exactly that previous behaviour.
        const retryAfterHintMs =
          wrappedError instanceof ISLHttpError ? wrappedError.retryAfterMs : undefined;
        const decision = decideIslRetry({
          retryable,
          attempt,
          maxAttempts: this.config.maxRetries,
          elapsedMs: Date.now() - requestStartedAt,
          perAttemptTimeoutMs: this.config.timeoutMs,
          retryAfterMs: retryAfterHintMs,
          budget,
        });

        this.log('warn', {
          event: 'isl_request_failed',
          endpoint,
          elapsed_ms: Date.now() - startTime,
          attempt,
          max_retries: this.config.maxRetries,
          retryable,
          error_type: wrappedError.name,
          error: wrappedError.message,
          request_id: requestId,
        });

        // ROADMAP 1.209: the failure half, recorded ONCE per request at the
        // terminal attempt — not per retry, which would multiply one outage
        // into `maxRetries` failures and trip a 3-strike breaker on a single
        // request.
        //
        // ONLY availability-class failures count. `retryable` is 5xx/429 for
        // HTTP (isl/errors.ts:80-82) plus timeouts and network errors. A 4xx is
        // this caller's fault, not the service being down, and must never open
        // the breaker for everyone else — which also means ISL's current 404
        // storm on /api/v1/analysis/* cannot spuriously open it.
        if (!decision.retry) {
          if (retryable) {
            recordIslFailure();
          }
          // ROADMAP 2.202 — make governor contention observable. The diagnosis of
          // record had to reconstruct this from Render log forensics across three
          // services; this row says, at the moment of the decision, exactly why a
          // retryable failure was NOT retried. `budget_exhausted` is the rate to
          // watch: it means the budget, not the classifier, ended the call.
          if (retryable) {
            this.log('warn', {
              event: 'isl_retry_declined',
              endpoint,
              attempt,
              max_retries: this.config.maxRetries,
              reason: decision.reason,
              status: wrappedError instanceof ISLHttpError ? wrappedError.status : undefined,
              retry_after_ms: retryAfterHintMs,
              remaining_budget_ms: decision.remainingMs,
              projected_cost_ms: decision.projectedCostMs,
              budget_supplied: budget !== undefined,
              request_id: requestId,
            });
          }
          // Record failed downstream call on final attempt (only for non-HTTP errors, HTTP errors already recorded)
          if (!(wrappedError instanceof ISLHttpError)) {
            recordDownstreamCall({
              service: 'isl',
              endpoint,
              status: 0, // 0 indicates timeout/network error
              elapsedMs: Date.now() - startTime,
              payloadHash,
              requestId,
              requestPayload: sanitizePayloadForDebug(body),
              // No response payload for network/timeout errors
              // Lane PLoT-R3 (2.13): request digest still recorded (what was sent)
              requestDigest,
            });
          }
          break;
        }

        // ROADMAP 2.202 — the retry is happening. Emit BEFORE the sleep so the
        // row is visible even if the process dies during the wait, and so the
        // rate of governor contention (and whether ISL's own hint was honoured)
        // is observable without cross-service log forensics.
        this.log('warn', {
          event: 'isl_retry_scheduled',
          endpoint,
          attempt,
          next_attempt: attempt + 1,
          max_retries: this.config.maxRetries,
          reason: decision.reason,
          status: wrappedError instanceof ISLHttpError ? wrappedError.status : undefined,
          delay_ms: decision.delayMs,
          backoff_ms: decision.backoffMs,
          retry_after_ms: retryAfterHintMs,
          retry_after_honoured: decision.retryAfterHonoured,
          remaining_budget_ms: decision.remainingMs,
          projected_cost_ms: decision.projectedCostMs,
          request_id: requestId,
        });

        // Delay chosen by decideIslRetry: max(ISL's Retry-After, our exponential
        // backoff 1s/2s/4s… capped at 5s). Retry-After is a MINIMUM wait, so it
        // can lengthen the delay but never shorten it below our own backoff.
        await this.sleep(decision.delayMs);
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        if (onExternalAbort && externalSignal) {
          externalSignal.removeEventListener('abort', onExternalAbort);
        }
      }
    }

    throw lastError || new Error('ISL request failed');
  }

  /**
   * GET `/health` with the shared auth header + short AbortController timeout.
   * The common boilerplate behind {@link healthCheck} and {@link fetchHealth};
   * each caller reads only the tail it needs (`response.ok` vs the parsed body).
   * The timeout is always cleared (finally), even when `fetch` rejects.
   */
  private async getHealthResponse(): Promise<Response> {
    const controller = new AbortController();
    const healthCheckTimeout = this.config.healthCheckTimeoutMs ?? ISL_HEALTH_CHECK_TIMEOUT_MS;
    const timeoutId = setTimeout(() => controller.abort(), healthCheckTimeout);
    try {
      return await fetch(`${this.config.baseUrl}/health`, {
        method: 'GET',
        headers: { 'X-API-Key': this.config.apiKey },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check ISL service health
   *
   * @returns true if ISL is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.getHealthResponse();
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Fetch and parse the ISL `/health` payload (Codex F8 handshake).
   *
   * Returns the parsed body (so the caller can read `compute_admission`), or
   * `null` on ANY failure — unreachable, timeout, non-2xx, or unparseable JSON.
   * A `null` return is the caller's "unreachable" signal; a non-null body that
   * simply LACKS `compute_admission` is the caller's "missing block" signal.
   * Uses the same auth + short health timeout as {@link healthCheck}.
   */
  async fetchHealth(): Promise<ISLHealthResponse | null> {
    try {
      const response = await this.getHealthResponse();
      if (!response.ok) return null;
      const body = (await response.json()) as ISLHealthResponse;
      return body && typeof body === 'object' ? body : null;
    } catch {
      return null;
    }
  }

  /**
   * Sleep for a given duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Log a message (uses console for now, can be replaced with logger)
   */
  private log(level: 'info' | 'warn' | 'error', data: Record<string, unknown>): void {
    // In production, this would use the application logger
    // For now, we use structured console output
    const logEntry = {
      level,
      time: Date.now(),
      ...data,
    };

    if (level === 'error') {
      console.error(JSON.stringify(logEntry));
    } else if (level === 'warn') {
      console.warn(JSON.stringify(logEntry));
    } else {
      // Info-level logs suppressed to avoid noise (enable via ISL_DEBUG=1 if needed)
    }
  }
}

/**
 * Get ISL client configuration from environment
 */
export function getISLClientConfig(): ISLClientConfig {
  return {
    baseUrl: String(process.env.ISL_BASE_URL ?? '').trim(),
    apiKey: String(process.env.ISL_API_KEY ?? '').trim(),
    timeoutMs: ISL_TIMEOUT_MS,
    maxRetries: resolveIslMaxRetries(),
    healthCheckTimeoutMs: ISL_HEALTH_CHECK_TIMEOUT_MS,
  };
}

/**
 * Check if ISL is configured
 */
export function isISLConfigured(): boolean {
  const config = getISLClientConfig();
  return config.baseUrl.length > 0 && config.apiKey.length > 0;
}
