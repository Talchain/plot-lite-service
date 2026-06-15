/**
 * Strict, bounded integer parsing for ops-controlled sample-depth env vars (Track S).
 *
 * `parseInt` is too permissive for this: `parseInt('1,000')` is `1`,
 * `parseInt('4_000')` is `4`, `parseInt('1000abc')` is `1000`. Used for a sample
 * depth that is forwarded to ISL, those silently bypass the `/v2/run` request
 * schema bound (`100..10000`) and run the Monte Carlo at a garbage depth.
 *
 * This helper accepts ONLY a plain non-negative integer string within [min, max].
 * Anything else — empty, malformed (`1,000`, `4_000`, `1000abc`), fractional,
 * signed, scientific (`1e3`), or out-of-bounds — returns `null` so the caller
 * falls back to a safe default rather than to a misparsed value.
 */

/** Lower bound for a Monte Carlo sample depth (mirrors the /v2/run schema). */
export const MIN_N_SAMPLES = 100;
/** Upper bound for a Monte Carlo sample depth (mirrors the /v2/run schema). */
export const MAX_N_SAMPLES = 10_000;

/**
 * Parse a strictly-formatted, in-bounds positive integer from an env value.
 * @returns the integer, or `null` if absent/malformed/out-of-bounds.
 */
export function parseBoundedIntEnv(raw: string | undefined, min: number, max: number): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  // Plain digits only — rejects '', '1,000', '4_000', '1000abc', '1.5', '-5', '+1', '1e3'.
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}
