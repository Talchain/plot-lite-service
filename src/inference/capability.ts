/**
 * Typed capability refusal for the inference layer.
 *
 * A compute path throws this INSTEAD of returning a number when a capability
 * the caller explicitly asked for is not available in the current
 * configuration. The contract is deliberately narrow:
 *
 *   never return a plausible number computed WITHOUT the input the caller supplied
 *
 * The alternative — dropping the unsupported input and computing anyway — is
 * indistinguishable, at the caller's boundary, from a real answer. That is the
 * failure mode this class exists to make impossible.
 *
 * `retryable` is false by construction: retrying an identical request against
 * an identically-configured server produces an identical refusal. Recovery
 * requires reconfiguring the server (or the caller dropping the input), not
 * waiting.
 *
 * Surfaced to HTTP callers as 501 + code CAPABILITY_UNAVAILABLE by the global
 * error handler in src/createServer.ts.
 */

export const CAPABILITY_UNAVAILABLE = 'CAPABILITY_UNAVAILABLE';

/** Machine-readable outcome marker: no estimate was produced. */
export type NotComputed = 'not_computed';

export class CapabilityUnavailableError extends Error {
  /** Stable wire code. */
  readonly code = CAPABILITY_UNAVAILABLE;
  /** Outcome marker — no number was computed, as distinct from a degraded one. */
  readonly status: NotComputed = 'not_computed';
  /** Retrying cannot help; the server must be reconfigured. */
  readonly retryable = false;
  /** Which capability was missing, e.g. 'interventional_inference'. */
  readonly capability: string;
  /** Human-readable cause, safe to return to the caller (no PII, no secrets). */
  readonly reason: string;

  constructor(capability: string, reason: string) {
    super(`capability unavailable: ${capability} — ${reason}`);
    this.name = 'CapabilityUnavailableError';
    this.capability = capability;
    this.reason = reason;
    // Preserve prototype chain across the ES5 target downlevel so
    // `instanceof` keeps working for callers compiled to older targets.
    Object.setPrototypeOf(this, CapabilityUnavailableError.prototype);
  }
}

/**
 * Structural type guard.
 *
 * Deliberately NOT a bare `instanceof`: the error crosses a dynamic
 * `await import()` boundary in the global error handler, and a duplicated
 * module instance (dist vs src, or two resolutions of the same specifier)
 * would break `instanceof` and silently downgrade a typed 501 refusal into an
 * unexplained 500. The structural check cannot be defeated that way.
 */
export function isCapabilityUnavailableError(e: unknown): e is CapabilityUnavailableError {
  if (e instanceof CapabilityUnavailableError) return true;
  if (!e || typeof e !== 'object') return false;
  const c = e as Partial<CapabilityUnavailableError>;
  return (
    c.code === CAPABILITY_UNAVAILABLE &&
    c.status === 'not_computed' &&
    typeof c.capability === 'string' &&
    typeof c.reason === 'string'
  );
}
