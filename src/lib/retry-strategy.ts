/**
 * Retry Strategy for External Service Calls
 *
 * Provides configurable retry logic with:
 * - Exponential backoff with optional jitter
 * - Per-attempt and overall time budgets
 * - Circuit breaker integration
 * - Transient error detection
 *
 * @module lib/retry-strategy
 */

import { shouldAllowIslCall } from '../integrations/isl-circuit-breaker.js';

/**
 * Retry configuration options
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (including initial attempt) */
  maxAttempts: number;
  /** Base delay in milliseconds for exponential backoff */
  baseDelayMs: number;
  /** Maximum delay cap in milliseconds */
  maxDelayMs: number;
  /** Overall time budget in milliseconds */
  budgetMs: number;
  /** Per-attempt timeout in milliseconds */
  perAttemptTimeoutMs: number;
  /** Whether to add jitter to delays (disable in tests) */
  jitter: boolean;
}

/**
 * Context for retry operations
 */
export interface RetryContext {
  /** Request ID - stable across retries, caller provides */
  requestId: string;
  /** Optional abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Error with retry metadata
 */
export interface RetryError extends Error {
  readonly attempts: number;
  readonly totalTimeMs: number;
  readonly lastError: Error;
  readonly isRetryExhausted: boolean;
}

/**
 * HTTP status codes that are retryable
 */
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

/**
 * Network error codes that are retryable
 */
const RETRYABLE_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ENETUNREACH',
]);

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 5000,
  budgetMs: 30000,
  perAttemptTimeoutMs: 10000,
  jitter: true,
};

/**
 * Check if an error is transient and should be retried
 */
export function isTransientError(error: unknown): boolean {
  if (!error) return false;

  // Check for HTTP status codes
  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>;

    // Check status property (common in fetch/axios errors)
    if (typeof err.status === 'number') {
      return RETRYABLE_STATUS_CODES.has(err.status);
    }

    // Check statusCode property (common in node-fetch errors)
    if (typeof err.statusCode === 'number') {
      return RETRYABLE_STATUS_CODES.has(err.statusCode);
    }

    // Check response.status (axios-style)
    if (
      err.response &&
      typeof err.response === 'object' &&
      typeof (err.response as Record<string, unknown>).status === 'number'
    ) {
      return RETRYABLE_STATUS_CODES.has(
        (err.response as Record<string, unknown>).status as number
      );
    }

    // Check error code (network errors)
    if (typeof err.code === 'string') {
      return RETRYABLE_ERROR_CODES.has(err.code);
    }

    // Check cause chain for network errors
    if (err.cause && typeof err.cause === 'object') {
      const cause = err.cause as Record<string, unknown>;
      if (typeof cause.code === 'string') {
        return RETRYABLE_ERROR_CODES.has(cause.code);
      }
    }
  }

  // Check for abort errors (not retryable)
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      // AbortError from user cancellation is not retryable
      // But timeout within a retry attempt should be retried
      return error.name === 'TimeoutError';
    }
  }

  return false;
}

/**
 * Calculate delay for a given attempt using exponential backoff
 */
export function calculateDelay(
  attempt: number,
  config: RetryConfig
): number {
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  let delay = Math.min(exponentialDelay, config.maxDelayMs);

  // Add jitter if enabled (±25%)
  if (config.jitter) {
    const jitterRange = delay * 0.25;
    delay = delay + (Math.random() * jitterRange * 2 - jitterRange);
  }

  return Math.floor(delay);
}

/**
 * Create an AbortController that times out after the specified duration
 */
function createTimeoutController(
  timeoutMs: number,
  parentSignal?: AbortSignal
): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController();

  const timeoutId = setTimeout(() => {
    controller.abort(new Error('Request timeout'));
  }, timeoutMs);

  // Link to parent signal if provided
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener('abort', () => {
        controller.abort(parentSignal.reason);
      });
    }
  }

  return {
    controller,
    cleanup: () => clearTimeout(timeoutId),
  };
}

/**
 * Sleep for the specified duration
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }

    const timeoutId = setTimeout(resolve, ms);

    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        reject(new Error('Aborted'));
      });
    }
  });
}

/**
 * Create a RetryError with metadata
 */
function createRetryError(
  message: string,
  attempts: number,
  totalTimeMs: number,
  lastError: Error,
  isRetryExhausted: boolean
): RetryError {
  const error = new Error(message) as RetryError;
  Object.defineProperty(error, 'attempts', { value: attempts, writable: false });
  Object.defineProperty(error, 'totalTimeMs', { value: totalTimeMs, writable: false });
  Object.defineProperty(error, 'lastError', { value: lastError, writable: false });
  Object.defineProperty(error, 'isRetryExhausted', { value: isRetryExhausted, writable: false });
  return error;
}

/**
 * Execute a function with retry logic
 *
 * @param fn - Function to execute, receives an AbortSignal for timeout
 * @param config - Retry configuration
 * @param context - Retry context with requestId and optional signal
 * @returns Promise resolving to the function result
 * @throws RetryError if all attempts fail or budget exceeded
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   async (signal) => fetch(url, { signal }),
 *   { maxAttempts: 3, baseDelayMs: 100, ... },
 *   { requestId: 'req-123' }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  config: RetryConfig,
  context: RetryContext
): Promise<T> {
  const startTime = Date.now();
  let lastError: Error = new Error('No attempts made');
  let attempt = 0;

  // Check if already cancelled before starting
  if (context.signal?.aborted) {
    throw createRetryError(
      'Request cancelled',
      0,
      0,
      new Error('Aborted before start'),
      false
    );
  }

  while (attempt < config.maxAttempts) {
    const elapsedMs = Date.now() - startTime;

    // Check overall budget
    if (elapsedMs >= config.budgetMs) {
      throw createRetryError(
        `Retry budget exhausted after ${elapsedMs}ms (budget: ${config.budgetMs}ms)`,
        attempt,
        elapsedMs,
        lastError,
        true
      );
    }

    // Check circuit breaker before retry (not on first attempt)
    if (attempt > 0) {
      const cbCheck = shouldAllowIslCall();
      if (!cbCheck.allowed) {
        throw createRetryError(
          `Circuit breaker open: ${cbCheck.reason}`,
          attempt,
          elapsedMs,
          lastError,
          false
        );
      }
    }

    // Check if cancelled
    if (context.signal?.aborted) {
      throw createRetryError(
        'Request cancelled',
        attempt,
        elapsedMs,
        lastError,
        false
      );
    }

    // Calculate remaining budget for this attempt
    const remainingBudget = config.budgetMs - elapsedMs;
    const attemptTimeout = Math.min(config.perAttemptTimeoutMs, remainingBudget);

    // Create timeout controller for this attempt
    const { controller, cleanup } = createTimeoutController(
      attemptTimeout,
      context.signal
    );

    try {
      // Log attempt
      console.log(
        JSON.stringify({
          event: 'retry_attempt',
          request_id: context.requestId,
          attempt: attempt + 1,
          max_attempts: config.maxAttempts,
          elapsed_ms: elapsedMs,
          timeout_ms: attemptTimeout,
        })
      );

      const result = await fn(controller.signal);
      cleanup();
      return result;
    } catch (error) {
      cleanup();
      lastError = error instanceof Error ? error : new Error(String(error));

      const isTransient = isTransientError(error);
      const isLastAttempt = attempt >= config.maxAttempts - 1;

      // Log failure
      console.log(
        JSON.stringify({
          event: 'retry_failure',
          request_id: context.requestId,
          attempt: attempt + 1,
          error_type: lastError.name,
          error_message: lastError.message,
          is_transient: isTransient,
          will_retry: isTransient && !isLastAttempt,
        })
      );

      // Don't retry non-transient errors
      if (!isTransient) {
        throw createRetryError(
          `Non-transient error: ${lastError.message}`,
          attempt + 1,
          Date.now() - startTime,
          lastError,
          false
        );
      }

      // Don't retry if this was the last attempt
      if (isLastAttempt) {
        throw createRetryError(
          `Max attempts (${config.maxAttempts}) exhausted`,
          attempt + 1,
          Date.now() - startTime,
          lastError,
          true
        );
      }

      // Calculate delay before next attempt
      const delay = calculateDelay(attempt, config);
      const timeUntilBudgetExceeded = config.budgetMs - (Date.now() - startTime);

      // Don't sleep if it would exceed budget
      if (delay >= timeUntilBudgetExceeded) {
        throw createRetryError(
          `Retry budget would be exceeded by delay`,
          attempt + 1,
          Date.now() - startTime,
          lastError,
          true
        );
      }

      // Wait before retry
      try {
        await sleep(delay, context.signal);
      } catch {
        // Sleep was aborted
        throw createRetryError(
          'Request cancelled during backoff',
          attempt + 1,
          Date.now() - startTime,
          lastError,
          false
        );
      }
    }

    attempt++;
  }

  // Should not reach here, but handle edge case
  throw createRetryError(
    'Unexpected retry termination',
    attempt,
    Date.now() - startTime,
    lastError,
    true
  );
}
