/**
 * ISL-specific Error Classes
 *
 * Provides structured error handling for ISL integration.
 */

/**
 * ISL 422 error body structure.
 * Supports multiple formats:
 *
 * V2 format (RequestValidatorV2):
 * { analysis_status: "blocked", status_reason: string, critiques: [...], request_id }
 *
 * V1 format (legacy):
 * { error_code: string, message: string, details: { critiques: [...] } }
 *
 * Pydantic format:
 * { detail: [{ loc: [...], msg: string, type: string }] }
 */
export interface ISLError422 {
  // V2 format fields
  analysis_status?: 'blocked';
  status_reason?: string;
  critiques?: ISLCritique[];
  request_id?: string;

  // V1 format fields
  error_code?: string;
  message?: string;
  details?: {
    critiques?: ISLCritique[];
  };

  // Pydantic format fields
  detail?: Array<{
    loc: (string | number)[];
    msg: string;
    type: string;
  }>;

  // Generic error format
  error?: {
    code?: string;
    message?: string;
  };
}

/**
 * ISL critique from 422 response.
 */
export interface ISLCritique {
  code: string;
  severity: string;
  message: string;
  suggestion?: string;
  affected_nodes?: string[];
}

/**
 * HTTP error from ISL service
 */
export class ISLHttpError extends Error {
  /** Structured 422 error (if available) */
  public islError?: ISLError422;

  constructor(
    public status: number,
    public body: string,
    public endpoint: string,
    islError?: ISLError422
  ) {
    super(`ISL request to ${endpoint} failed with status ${status}`);
    this.name = 'ISLHttpError';
    this.islError = islError;
  }

  /**
   * Check if this error is retryable
   */
  isRetryable(): boolean {
    // Retry on 5xx, 429 (rate limit), not on 4xx
    return this.status >= 500 || this.status === 429;
  }

  /**
   * Check if this is a 422 validation error with structured critiques.
   */
  is422(): boolean {
    return this.status === 422;
  }

  /**
   * Get structured critiques from 422 error.
   * Handles V2, V1, and Pydantic formats.
   */
  getCritiques(): ISLCritique[] {
    if (!this.islError) return [];

    // V2 format: critiques at top level
    if (this.islError.critiques && Array.isArray(this.islError.critiques)) {
      return this.islError.critiques;
    }

    // V1 format: critiques nested in details
    if (this.islError.details?.critiques && Array.isArray(this.islError.details.critiques)) {
      return this.islError.details.critiques;
    }

    // Pydantic format: convert detail[] to critiques
    if (this.islError.detail && Array.isArray(this.islError.detail)) {
      return this.islError.detail.map((d) => ({
        code: 'PYDANTIC_VALIDATION_ERROR',
        severity: 'blocker',
        message: `${d.loc.join('.')}: ${d.msg}`,
      }));
    }

    return [];
  }

  /**
   * Get error message from 422 error.
   * Handles V2, V1, Pydantic, and generic formats.
   */
  getErrorMessage(): string {
    if (!this.islError) return 'ISL validation failed';

    // V2 format: status_reason
    if (this.islError.status_reason) {
      return this.islError.status_reason;
    }

    // V1 format: message
    if (this.islError.message) {
      return this.islError.message;
    }

    // Generic error format
    if (this.islError.error?.message) {
      return this.islError.error.message;
    }

    // Pydantic format: concatenate messages
    if (this.islError.detail && Array.isArray(this.islError.detail)) {
      return this.islError.detail.map((d) => `${d.loc.join('.')}: ${d.msg}`).join('; ');
    }

    return 'ISL validation failed';
  }

  /**
   * Check if this is a V2 format response.
   */
  isV2Format(): boolean {
    return this.islError?.analysis_status === 'blocked';
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
