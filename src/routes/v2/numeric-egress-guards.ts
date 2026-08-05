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

// `finiteNum` (measurements) and `nonNegInt` (sample counts) live in the
// neutral numeric util so this guard, the enrichment-egress guard, and the
// ISL compute-admission validator all share ONE definition. Re-exported here
// so existing importers of this module keep their import path unchanged.
import { finiteNum, nonNegInt, isFiniteNumber } from '../../util/numeric.js';
export { finiteNum, nonNegInt };

/** Finite probability/rate in [0,1]. Use for win_probability, prob_satisfied, rates. */
export function prob01(v: unknown): number | undefined {
  return isFiniteNumber(v) && v >= 0 && v <= 1 ? v : undefined;
}

/** Finite non-negative real. Use for std, e_value, absolute margins. */
export function nonNeg(v: unknown): number | undefined {
  return isFiniteNumber(v) && v >= 0 ? v : undefined;
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

/**
 * ISL's per-option DOWNSIDE / tail-risk block, validated for egress (2.449).
 *
 * PRODUCER SEMANTICS, read from ISL's `DownsideV2` (src/models/response_v2.py)
 * rather than inferred here (trap 13c — an expectation written from the
 * consumer's reading of what a field ought to mean is a wrong oracle no
 * mutation kit can detect):
 *   · `cvar_10`         mean of the WORST 10% of the option's post-noise outcome
 *                       samples. Same units as `outcome.mean`, no normalisation.
 *                       The 0.10 tail mass is DOCTRINE-PENDING(Neil) — a working
 *                       default, NOT ratified science.
 *   · `p05`             5th percentile, same population and `np.percentile`
 *                       convention as `outcome.p10/p50/p90`.
 *   · `expected_regret` `mean_i(best_i − o_i)` on the PRE-noise CRN population
 *                       (a JOINT, cross-option metric — the same population as
 *                       `win_probability`). `>= 0` by construction.
 *
 * ALL-OR-NOTHING, and that is the producer's rule, not a local invention: all
 * three are REQUIRED floats on `DownsideV2`, and ISL omits the whole block —
 * "Omitted, never null" — rather than ship a partial one when any component
 * cannot be computed honestly. This guard mirrors that at PLoT's serialisation
 * boundary. It NEVER substitutes a zero: a fabricated 0 in a tail-risk
 * statistic does not read as "unknown", it reads as "there is no downside",
 * which is the most damaging direction this defect class can take (the same
 * shape as the `?? 0` regret default that collapsed the whole-decision EVPI
 * bound, and the `?? 0` breach margins that produced a false architectural
 * conclusion in #237).
 *
 * A MEASURED ZERO IS NOT AN ABSENCE. The option that wins every sample has
 * `expected_regret === 0` by construction, so the guard tests finiteness and
 * range, never truthiness.
 *
 * Returns a fresh object in ISL's declaration order (cvar_10 → p05 →
 * expected_regret) when every component is honest, else `undefined` so the
 * caller OMITS the key.
 */
export function buildDownside(v: unknown): { cvar_10: number; p05: number; expected_regret: number } | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const d = v as Record<string, unknown>;
  const cvar10 = finiteNum(d.cvar_10);
  const p05 = finiteNum(d.p05);
  // `nonNeg`, not `finiteNum`: ISL declares `expected_regret: Field(..., ge=0)`.
  // A negative value means the producer's own invariant broke; PLoT must not
  // launder a broken invariant into a plausible-looking number.
  const expectedRegret = nonNeg(d.expected_regret);
  if (cvar10 === undefined || p05 === undefined || expectedRegret === undefined) return undefined;
  return { cvar_10: cvar10, p05, expected_regret: expectedRegret };
}
