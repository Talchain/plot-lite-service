/**
 * ISL HTTP Client with Retry Logic
 *
 * Provides robust HTTP communication with ISL service including:
 * - Configurable timeouts
 * - Exponential backoff retry
 * - Structured logging
 * - Error classification
 */

import { ISLHttpError, ISLTimeoutError, ISLNetworkError, isRetryableError, type ISLError422 } from './errors.js';
import { computeOlumiHash } from '../../util/canonical.js';
import { recordDownstreamCall, sanitizePayloadForDebug, computePayloadDigest } from '../../util/downstream-tracker.js';
import { ISL_TIMEOUT_MS, ISL_HEALTH_CHECK_TIMEOUT_MS, resolveIslMaxRetries, islRetryBackoffMs } from '../../config/timeouts.js';

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
    const { endpoint, body, requestId, signal: externalSignal } = options;
    // Pin response version via query param (in addition to header)
    const url = `${this.config.baseUrl}${endpoint}?response_version=2`;

    // Log the exact URL called (excluding API key) for debugging
    this.log('info', {
      event: 'isl_request_url',
      url,
      endpoint,
      request_id: requestId,
    });

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
              const err = new ISLHttpError(response.status, errorBody, endpoint, islError);
              (err as any).islEchoedRequestId = errorEchoedRequestId;
              throw err;
            } catch (parseErr) {
              if (parseErr instanceof ISLHttpError) throw parseErr;
              // If parsing fails, throw generic error
              const err = new ISLHttpError(response.status, errorBody, endpoint);
              (err as any).islEchoedRequestId = errorEchoedRequestId;
              throw err;
            }
          }

          const err = new ISLHttpError(response.status, errorBody, endpoint);
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
        const isLastAttempt = attempt === this.config.maxRetries;

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

        if (!retryable || isLastAttempt) {
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

        // Exponential backoff (single source: islRetryBackoffMs) — 1s, 2s, 4s… capped at 5s.
        const backoffMs = islRetryBackoffMs(attempt);
        await this.sleep(backoffMs);
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
   * Check ISL service health
   *
   * @returns true if ISL is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const healthCheckTimeout = this.config.healthCheckTimeoutMs ?? ISL_HEALTH_CHECK_TIMEOUT_MS;
      const timeoutId = setTimeout(() => controller.abort(), healthCheckTimeout);

      const response = await fetch(`${this.config.baseUrl}/health`, {
        method: 'GET',
        headers: {
          'X-API-Key': this.config.apiKey,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      return response.ok;
    } catch {
      return false;
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
