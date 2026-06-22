/**
 * Numeric-egress boundary guards (Track S — Codex round-2).
 * ----------------------------------------------------------------------------
 * Compile-time ISL response types are a fiction over untrusted wire data: the
 * remote engine's JSON is cast to typed numbers with NO runtime validation, so a
 * degenerate Monte Carlo run can deliver NaN / ±Infinity / out-of-range values.
 * Fastify then serialises non-finite numbers to a fabricated `null` on declared
 * number fields. These helpers are the single source of truth for validating
 * ISL-derived numbers at the PLoT serialisation boundary: an invalid value
 * returns `undefined` so the caller can OMIT the field (honest absence) rather
 * than emit a fabricated `null` or a substituted zero.
 *
 * Each helper returns the value verbatim when valid, else `undefined`. They never
 * clamp or coerce — out-of-range is treated as "not measured", not "snapped to the
 * boundary" — so an in-range value passes through byte-identically (no golden /
 * response-payload drift for the normal path).
 */

/** Finite real number (any magnitude). Use for measurements: means, std, deltas. */
export function finiteNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Finite probability/rate in [0,1]. Use for win_probability, prob_satisfied, rates. */
export function prob01(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : undefined;
}

/** Finite non-negative real. Use for std, e_value, absolute margins. */
export function nonNeg(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/** Non-negative integer. Use for sample counts (n_samples, n_valid_samples). */
export function nonNegInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0 ? v : undefined;
}

/**
 * True iff an ISL option `outcome` carries ALL required OutcomeStatsV3 stats
 * (mean/p10/p50/p90) as finite numbers. This is the SINGLE predicate that decides
 * both (a) whether the public `outcome` object is emitted in buildResponse and
 * (b) whether the option counts as a usable comparison for option_comparison_status.
 * Using one predicate for both guarantees status can never report 'computed' while
 * the public outcome was omitted (Codex round-3 #2).
 */
export function hasAllRequiredOutcomeStats(o: unknown): boolean {
  if (!o || typeof o !== 'object') return false;
  const r = o as Record<string, unknown>;
  return finiteNum(r.mean) !== undefined
    && finiteNum(r.p10) !== undefined
    && finiteNum(r.p50) !== undefined
    && finiteNum(r.p90) !== undefined;
}
