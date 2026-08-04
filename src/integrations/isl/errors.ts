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
 * ISL critique from a 422 response — or, since ROADMAP 2.410, from the v2
 * SUCCESS body (`islResult.critiques`, "always a list, never None" in ISL's
 * response builder).
 *
 * ⚠ FIELD NAMES (2.410 / 2.394(a)): ISL's CritiqueV2 serialises
 * `affected_node_ids` / `affected_option_ids` (models/critique.py `build()`)
 * — it has NEVER emitted `affected_nodes`. That legacy name is kept for
 * tolerance of older/alternate producers, but a reader that consults ONLY
 * `affected_nodes` silently drops node identity for every v2-format critique
 * (which is what run.ts did until the 2.410 fix).
 */
export interface ISLCritique {
  id?: string;
  code: string;
  severity: string;
  message: string;
  suggestion?: string;
  /** ISL v2 wire field (CritiqueV2). Prefer this. */
  affected_node_ids?: string[];
  /** ISL v2 wire field (CritiqueV2). */
  affected_option_ids?: string[];
  /** Legacy/alternate-producer field name — tolerated, never emitted by ISL v2. */
  affected_nodes?: string[];
}

/**
 * Parse an RFC 7231 `Retry-After` header into milliseconds.
 *
 * ROADMAP 2.202. ISL's compute governor answers `caller_concurrency_exceeded`
 * with a 429 and a `Retry-After` hint (`RETRY_AFTER_SECONDS = 5`), and PLoT
 * discarded it entirely — `ISLHttpError` captured status/body/endpoint/islError
 * and no headers at all. The one piece of actionable guidance ISL emits never
 * reached the retry decision, so a retry could only ever guess.
 *
 * Both wire forms are accepted:
 *   • delta-seconds — `Retry-After: 5`      → 5_000
 *   • HTTP-date     — `Retry-After: <date>` → max(0, date − now)
 *
 * Returns `undefined` for absent, blank, or unparseable values, so the caller
 * falls back to its own exponential backoff rather than to a fabricated delay.
 * A past HTTP-date clamps to 0 (retry immediately), never negative.
 */
export function parseRetryAfterMs(
  raw: string | null | undefined,
  nowMs: number = Date.now(),
): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  const value = raw.trim();
  if (value === '') return undefined;

  // delta-seconds: a bare non-negative integer.
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    return Number.isFinite(seconds) ? seconds * 1_000 : undefined;
  }

  // Any OTHER bare numeric form (`-5`, `+5`, `1.5`) is valid in neither wire
  // form. It must be rejected explicitly: `Date.parse('-5')` succeeds — it reads
  // the string as a YEAR — so falling through to the date branch would turn a
  // malformed header into a multi-millennium delay.
  if (/^[+-]?\d*\.?\d+$/.test(value)) return undefined;

  // HTTP-date.
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return undefined;
  return Math.max(0, parsed - nowMs);
}

/**
 * Longest machine reason we will carry into a log row. ISL's own reasons are
 * short snake_case tokens (`caller_concurrency_exceeded`,
 * `service_busy_queue_full`, `analysis_hard_deadline_exceeded`); the bound stops
 * an unexpected upstream from turning one telemetry field into a body dump.
 */
export const ISL_ERROR_REASON_MAX_LEN = 120;

/**
 * Pull ISL's machine-readable cause out of an error response body.
 *
 * ROADMAP 2.202 fix ①b — THIS FUNCTION EXISTS TO GIVE `ISLHttpError.body` ITS
 * FIRST READER. The 31 Jul live probe established, with a passing positive
 * control, that `public body: string` was captured on every ISL error and read by
 * NOTHING (`rg -a -n "\.body\b" src/ --glob '!**\/tests\/**' | rg -a -i isl` →
 * zero matches at `b79c4829`). That is trap 10's write-only-column shape sitting
 * in the one field that names WHY the governor rejected the call — so the probe
 * had to reconstruct `caller_concurrency_exceeded` from cross-service Render
 * forensics, and recorded its own `caller_concurrency_exceeded` log search as
 * **vacuous**: PLoT never logged the body, so the zero rows proved nothing.
 *
 * ⚠ SHAPE DERIVED FROM ISL AT THE BYTES, NOT GUESSED (trap 18 / trap 16 —
 * a fixture invented at this end "proves" whatever it was written to prove).
 * Read read-only at `Talchain/Inference-Service-Layer@7c681fda` (`staging`,
 * 2026-07-31):
 *
 *   src/services/compute_governor.py:161  raise Overload(429, "caller_concurrency_exceeded")
 *   src/api/robustness.py:249-273         _overload_error_response(...) -> ErrorResponse(
 *                                            code=RATE_LIMIT_EXCEEDED, message=...,
 *                                            reason=overload.reason, ...)
 *   src/api/robustness.py:362-370         JSONResponse(status_code=429,
 *                                            content=body.model_dump(exclude_none=True),
 *                                            headers={"Retry-After": ...})
 *   src/models/responses.py:90-103        class ErrorResponse: code, message, reason?
 *
 * So the live 429 body is a FLAT object whose `reason` is the governor's token.
 * `detail` is accepted too: that is FastAPI's default `HTTPException` shape, and
 * it is what PLoT's own 2.202 fakes serve, so the parser reads both the real wire
 * and the harness rather than silently only one of them.
 *
 * Returns `undefined` for absent / non-JSON / non-string / blank causes — a
 * missing reason must read as missing, never as a fabricated one.
 */
export function parseIslErrorReason(body: string | null | undefined): string | undefined {
  if (typeof body !== 'string' || body.trim() === '') return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object') return undefined;

  const obj = parsed as Record<string, unknown>;
  const nestedError = obj.error;
  const candidates: unknown[] = [
    obj.reason, // ISL ErrorResponse.reason — the governor's own token
    nestedError && typeof nestedError === 'object'
      ? (nestedError as Record<string, unknown>).code
      : undefined,
    obj.code, // ISL ErrorResponse.code (coarser: RATE_LIMIT_EXCEEDED)
    obj.detail, // FastAPI HTTPException default shape
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    // Strip control characters so one field cannot forge extra log lines.
    const cleaned = candidate.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (cleaned === '') continue;
    return cleaned.length > ISL_ERROR_REASON_MAX_LEN
      ? `${cleaned.slice(0, ISL_ERROR_REASON_MAX_LEN)}…`
      : cleaned;
  }
  return undefined;
}

/**
 * HTTP error from ISL service
 */
export class ISLHttpError extends Error {
  /** Structured 422 error (if available) */
  public islError?: ISLError422;

  /**
   * ROADMAP 2.202 — `Retry-After` from the response, in ms, when ISL sent one
   * (see {@link parseRetryAfterMs}). `undefined` = no usable hint; the retry
   * decision then falls back to PLoT's own exponential backoff.
   */
  public retryAfterMs?: number;

  constructor(
    public status: number,
    public body: string,
    public endpoint: string,
    islError?: ISLError422,
    retryAfterMs?: number
  ) {
    super(`ISL request to ${endpoint} failed with status ${status}`);
    this.name = 'ISLHttpError';
    this.islError = islError;
    this.retryAfterMs = retryAfterMs;
  }

  /**
   * ISL's machine-readable cause for this failure, parsed from {@link body}.
   *
   * ROADMAP 2.202 fix ①b. `body` was captured on every ISL error and read by
   * nothing — see {@link parseIslErrorReason} for the probe's positive-controlled
   * zero-reader proof. This is that reader, and the client carries its result
   * into `isl_retry_scheduled` / `isl_retry_declined` so the NEXT diagnosis of
   * governor contention is a log read rather than a three-service probe.
   *
   * Computed on demand (not in the constructor) so the parse cost is paid only
   * where the value is used, and so every existing construction site is
   * unchanged.
   */
  getReason(): string | undefined {
    return parseIslErrorReason(this.body);
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
 * A PLoT-side failure that happened AFTER ISL returned a 2xx — unparseable body,
 * hashing/bookkeeping failure, etc.
 *
 * ROADMAP 2.202, review item C. The client's catch wraps any unrecognised error
 * as an {@link ISLNetworkError}, which `isRetryableError` reports as RETRYABLE.
 * That was harmless while the base call was clamped to a single attempt, but
 * 2.202 makes retries reachable — so without this class a failure occurring
 * after ISL had already COMPUTED the analysis would re-issue the whole
 * analysis, multiplying load on the very governor whose contention this change
 * exists to survive.
 *
 * ISL did its job; the fault is on our side of the wire and re-running the
 * computation cannot fix it. Deliberately absent from `isRetryableError`, so it
 * is NOT retryable.
 */
export class ISLResponseProcessingError extends Error {
  constructor(
    public endpoint: string,
    public cause?: Error
  ) {
    super(
      `ISL response from ${endpoint} could not be processed: ${cause?.message ?? 'unknown'}`,
    );
    this.name = 'ISLResponseProcessingError';
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
