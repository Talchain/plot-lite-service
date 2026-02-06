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
import { recordDownstreamCall, sanitizePayloadForDebug } from '../../util/downstream-tracker.js';

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
  async request<T>(options: ISLRequestOptions): Promise<T> {
    const { endpoint, body, requestId } = options;
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

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      // Track start time outside try block for catch access
      const startTime = Date.now();

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.config.timeoutMs
        );

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
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

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
          });

          // P0-PLOT-3: Parse ISL 422 as structured result
          // 422 contains structured critiques that should be passed through
          if (response.status === 422) {
            try {
              const islError = JSON.parse(errorBody) as ISLError422;
              throw new ISLHttpError(response.status, errorBody, endpoint, islError);
            } catch (parseErr) {
              // If parsing fails, throw generic error
              throw new ISLHttpError(response.status, errorBody, endpoint);
            }
          }

          throw new ISLHttpError(response.status, errorBody, endpoint);
        }

        // Parse response and record successful downstream call with payloads for debug
        const responseData = (await response.json()) as T;
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
        });

        return responseData;
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
            });
          }
          break;
        }

        // Exponential backoff: 1s, 2s, 4s (capped at 5s)
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await this.sleep(backoffMs);
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
      const healthCheckTimeout = this.config.healthCheckTimeoutMs ?? 5000;
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
  const healthCheckTimeoutEnv = process.env.ISL_HEALTH_CHECK_TIMEOUT_MS;
  return {
    baseUrl: String(process.env.ISL_BASE_URL ?? '').trim(),
    apiKey: String(process.env.ISL_API_KEY ?? '').trim(),
    timeoutMs: parseInt(process.env.ISL_REQUEST_TIMEOUT_MS ?? process.env.ISL_TIMEOUT_MS ?? '30000', 10),
    maxRetries: parseInt(process.env.ISL_MAX_RETRIES ?? '3', 10),
    healthCheckTimeoutMs: healthCheckTimeoutEnv ? parseInt(healthCheckTimeoutEnv, 10) : undefined,
  };
}

/**
 * Check if ISL is configured
 */
export function isISLConfigured(): boolean {
  const config = getISLClientConfig();
  return config.baseUrl.length > 0 && config.apiKey.length > 0;
}
