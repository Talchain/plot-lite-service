/**
 * ISL HTTP Client with Retry Logic
 *
 * Provides robust HTTP communication with ISL service including:
 * - Configurable timeouts
 * - Exponential backoff retry
 * - Structured logging
 * - Error classification
 */

import { ISLHttpError, ISLTimeoutError, ISLNetworkError, isRetryableError } from './errors.js';

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
    const url = `${this.config.baseUrl}${endpoint}`;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.config.timeoutMs
        );

        const startTime = Date.now();

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.config.apiKey,
            'X-Request-Id': requestId,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const duration = Date.now() - startTime;

        // Log successful request
        this.log('info', {
          event: 'isl_request_complete',
          endpoint,
          status: response.status,
          duration_ms: duration,
          attempt,
          request_id: requestId,
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new ISLHttpError(response.status, errorBody, endpoint);
        }

        return (await response.json()) as T;
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
          attempt,
          max_retries: this.config.maxRetries,
          retryable,
          error_type: wrappedError.name,
          error: wrappedError.message,
          request_id: requestId,
        });

        if (!retryable || isLastAttempt) {
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
      const timeoutId = setTimeout(() => controller.abort(), 5000);

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
    timeoutMs: parseInt(process.env.ISL_TIMEOUT_MS ?? '15000', 10),
    maxRetries: parseInt(process.env.ISL_MAX_RETRIES ?? '3', 10),
  };
}

/**
 * Check if ISL is configured
 */
export function isISLConfigured(): boolean {
  const config = getISLClientConfig();
  return config.baseUrl.length > 0 && config.apiKey.length > 0;
}
