/**
 * EVPI (Expected Value of Perfect Information) emission helpers.
 *
 * Centralises the non-negative contract for `evpi_percentage_points` so it
 * is enforced consistently across every site that emits the field. EVPI is
 * non-negative by definition (Howard 1966; Felli & Hazen 1998 — information
 * cannot harm a rational decision-maker on average), so Monte Carlo
 * estimates that drift slightly negative are sampling artefacts, not
 * meaningful decision signals. Surfacing a negative percentage to users
 * would falsely imply "learning more about this factor would make the
 * decision worse" and violates the OpenAPI declared `minimum: 0`.
 *
 * Used by:
 * - `src/routes/v2/run.ts` — `mapIslFactorEntry` (boundary sanitisation of
 *   ISL `value_of_information`) and the EVPI enrichment loop in the route
 *   handler.
 * - `src/coaching/evidence-gaps.ts` — the parallel coaching surface that
 *   emits `m1_coaching.evidence_gaps[].evpi_percentage_points`.
 */

/**
 * Sanitise an ISL-emitted `value_of_information` value to satisfy PLoT's
 * non-negative VOI contract. ISL emits VOI via a Monte Carlo estimator which
 * can drift slightly negative from sampling noise around zero — a
 * well-known artefact, not a real signal. Mirrors the existing convention
 * in `src/integrations/isl/adapters/factor-sensitivity.ts:49` which already
 * filters CEE-facing ISL VOI by `>= 0`.
 *
 * Returns the value verbatim when it is a finite non-negative number;
 * returns `undefined` for negatives, non-finite (NaN / Infinity), and any
 * non-number type. `undefined` aligns with `FactorSensitivityResultV3.value_of_information`
 * (typed `number | undefined`, an optional field) and causes the downstream
 * EVPI emitter to skip the field entirely rather than emit zero —
 * preserving the missing-vs-zero distinction the rest of the response
 * contract relies on.
 */
export function sanitiseIslVoi(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
}

/**
 * Compute the EVPI percentage-points value to emit on a factor sensitivity
 * entry, enforcing the non-negative contract.
 *
 * Returns `undefined` (rather than `0`) when either input is missing or
 * non-finite, so the caller can conditionally include the field rather
 * than emitting a confident `0` that conflates "no measurable value of
 * information" with "we couldn't compute it". When both inputs are valid,
 * the result is the rounded product clamped to `>= 0`.
 *
 * The `Math.max(0, ...)` is belt-and-braces: when `sanitiseIslVoi` has run
 * at the boundary, `voi` should already be non-negative or `undefined`,
 * but defensive clamping here keeps the contract intact if a future
 * producer slips a negative past the boundary (e.g. a PLoT-side compute
 * path that derives VOI by a different formula, like the coaching
 * surface's `normalisedImpact × (1 - confidence)`).
 */
export function computeEvpiPercentagePoints(
  voi: number | null | undefined,
  winProbSpread: number,
): number | undefined {
  if (typeof voi !== 'number' || !Number.isFinite(voi)) return undefined;
  if (!Number.isFinite(winProbSpread) || winProbSpread <= 0) return undefined;
  const raw = voi * winProbSpread * 100;
  return Math.max(0, Math.round(raw * 10) / 10);
}
