/**
 * The semantics marker for ISL's robustness `confidence` slot (ROADMAP 1.211).
 *
 * WHY THIS EXISTS
 * ---------------
 * `robustness.confidence` is a published contract slot whose MEANING changed
 * on 2026-07-26 (ISL PR #114) while its name and type did not. Verified in the
 * merged ISL source at staging 7d144c7, not inferred from the PR prose:
 *
 *   robustness_analyzer_v2.py:4522  recommendation_stability = option_wins[winner] / n_samples
 *   robustness_analyzer_v2.py:4584  confidence = _stability_confidence_figure(stability, n)
 *   robustness_analyzer_v2.py:2739      return recommendation_stability   <- bare
 *   robustness_analyzer_v2.py:4596  confidence_basis = "recommendation_stability_uncalibrated"
 *
 * It WAS `min(0.99, recommendation_stability * (1 - 1/sqrt(n_samples)))`. Two
 * consequences a consumer cannot see from the value alone:
 *
 *   - the served number is now strictly HIGHER, and can reach exactly 1.0,
 *     which the old 0.99 cap made unreachable;
 *   - it is no longer a function of sample count, so the same recommendation no
 *     longer reports a different "confidence" purely for running longer.
 *
 * A bare 0.97 is therefore ambiguous on the wire: under the old formula it was
 * a shrunken, capped figure; under the new one it is the plain share of
 * sampled scenarios the recommended option won. Same field, same type, same
 * range, different quantity. `confidence_basis` is the machine-readable marker
 * ISL added so a consumer can BRANCH rather than guess — and this module is
 * PLoT refusing to guess.
 *
 * WHY NOT INFER FROM THE VALUE
 * ----------------------------
 * Tempting heuristics all fail. A value above 0.99 proves the new basis but
 * almost every real value is below it; a value at exactly 0.99 is ambiguous
 * (old cap, or a genuine 99% win share); and every value below 0.99 is
 * reachable under both. Absence of the marker means "this producer has not
 * told us", which is a different and weaker statement than "this is legacy" —
 * but it is the honest one, and it is what `unknown_legacy` records.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not suppress anything. ISL deliberately kept the slot because three
 * repos read it, and PLoT's doctrine here is disclosure, not suppression
 * (D-5). This module only lets the value be labelled.
 */

/** The exact literal ISL emits. Pinned against the source string by test. */
export const CONFIDENCE_BASIS_STABILITY_UNCALIBRATED =
  'recommendation_stability_uncalibrated';

/**
 * What PLoT records when the producer sent no recognised marker.
 *
 * NOT a claim that the payload is old — only that its basis was not declared,
 * so the value must not be read as either basis.
 */
export const CONFIDENCE_BASIS_UNKNOWN = 'unknown_legacy';

export type ConfidenceBasis =
  | typeof CONFIDENCE_BASIS_STABILITY_UNCALIBRATED
  | typeof CONFIDENCE_BASIS_UNKNOWN;

/** The subset of an ISL robustness object this module needs. */
export interface ConfidenceBearing {
  confidence?: number;
  confidence_basis?: unknown;
}

/**
 * Resolve the basis of a robustness payload's `confidence`.
 *
 * Allow-list, not a cast: an unrecognised marker resolves to `unknown_legacy`
 * rather than being forwarded verbatim, so a future ISL basis PLoT has not
 * been taught about cannot be silently passed off as understood.
 */
export function resolveConfidenceBasis(
  robustness: ConfidenceBearing | null | undefined
): ConfidenceBasis {
  const raw = robustness?.confidence_basis;
  return raw === CONFIDENCE_BASIS_STABILITY_UNCALIBRATED
    ? CONFIDENCE_BASIS_STABILITY_UNCALIBRATED
    : CONFIDENCE_BASIS_UNKNOWN;
}

/**
 * True when the producer declared the post-#114 basis.
 *
 * Use this to decide whether `confidence` may be described to a user at all —
 * under the declared basis it is an uncalibrated scenario-win share and must
 * never be rendered as a confidence level.
 */
export function hasDeclaredStabilityBasis(
  robustness: ConfidenceBearing | null | undefined
): boolean {
  return resolveConfidenceBasis(robustness) === CONFIDENCE_BASIS_STABILITY_UNCALIBRATED;
}
