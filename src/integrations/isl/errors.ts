/**
 * ISL-specific Error Classes
 *
 * Provides structured error handling for ISL integration.
 */

/**
 * HTTP error from ISL service
 */
export class ISLHttpError extends Error {
  constructor(
    public status: number,
    public body: string,
    public endpoint: string
  ) {
    super(`ISL request to ${endpoint} failed with status ${status}`);
    this.name = 'ISLHttpError';
  }

  /**
   * Check if this error is retryable
   */
  isRetryable(): boolean {
    // Retry on 5xx, 429 (rate limit), not on 4xx
    return this.status >= 500 || this.status === 429;
  }
}

/**
 * Timeout error for ISL requests
 */
export class ISLTimeoutError extends Error {
  constructor(
    public endpoint: string,
    public timeoutMs: number
  ) {
    super(`ISL request to ${endpoint} timed out after ${timeoutMs}ms`);
    this.name = 'ISLTimeoutError';
  }
}

/**
 * Network error for ISL requests
 */
export class ISLNetworkError extends Error {
  constructor(
    public endpoint: string,
    public cause?: Error
  ) {
    super(`ISL request to ${endpoint} failed due to network error: ${cause?.message ?? 'unknown'}`);
    this.name = 'ISLNetworkError';
  }
}

/**
 * ISL service unavailable (circuit breaker open, etc.)
 */
export class ISLUnavailableError extends Error {
  constructor(reason: string) {
    super(`ISL service unavailable: ${reason}`);
    this.name = 'ISLUnavailableError';
  }
}

/**
 * Type guard for ISL HTTP errors
 */
export function isISLHttpError(error: unknown): error is ISLHttpError {
  return error instanceof ISLHttpError;
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof ISLHttpError) {
    return error.isRetryable();
  }
  // Network errors and timeouts are retryable
  if (error instanceof ISLNetworkError || error instanceof ISLTimeoutError) {
    return true;
  }
  // AbortError (timeout) is retryable
  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }
  return false;
}
