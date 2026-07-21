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

import { isFiniteNumber } from '../util/numeric.js';

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

/**
 * Emission resolution for EVPI percentage-points values.
 *
 * PLoT rounds emitted EVPI to 1 decimal place (see
 * `computeEvpiPercentagePoints`), so any value below half of that rounding
 * step (0.05pp) is indistinguishable from zero at the emitted precision.
 * Raw estimates below this threshold — including ALL negatives, which are
 * Monte Carlo sampling artefacts (Howard 1966 non-negativity) — are
 * "below resolution": too small to measure at this sampling depth.
 */
export const EVPI_EMISSION_RESOLUTION_PP = 0.05;

/** Classification of a raw EVPI percentage-points value for outward emission. */
export interface EvpiEmissionClassification {
  /**
   * The outward-safe value (rounded to 0.1pp), or `undefined` when the raw
   * value is below resolution. NEVER negative, NEVER a clamped 0 standing in
   * for a negative.
   */
  emit: number | undefined;
  /**
   * True when the raw value is below the emission resolution (including all
   * negatives). Surfaces that can express it should label the factor
   * "below resolution" rather than showing 0 — a clamped 0 falsely claims
   * "measured as exactly worthless" when the honest statement is "too small
   * to measure at this sampling depth".
   */
  below_resolution: boolean;
  /** The raw input value, for diagnostics only (may be negative). */
  raw: number;
}

/**
 * Classify a raw EVPI percentage-points value (e.g. from the ISL V2
 * `factor_evpi[].evpi_percentage_points` wire field) for outward emission.
 *
 * Contract (raw negative EVPI observed flowing in staging logs; the live
 * capture at tests/fixtures/isl-v2-live-20260706 carries fac_hiring_cost
 * -0.15pp):
 * - Negative values are NEVER emitted outward, in any form.
 * - Below-resolution values (raw < EVPI_EMISSION_RESOLUTION_PP, which
 *   includes all negatives) are labelled, not clamped to zero: `emit` is
 *   `undefined` and `below_resolution` is true.
 * - At-or-above-resolution values are rounded to 0.1pp for emission.
 * - Non-finite input yields `{ emit: undefined, below_resolution: false }` —
 *   absence of a measurement is not a below-resolution measurement.
 */
export function classifyEvpiPercentagePointsForEmission(
  rawPp: number,
): EvpiEmissionClassification {
  if (typeof rawPp !== 'number' || !Number.isFinite(rawPp)) {
    return { emit: undefined, below_resolution: false, raw: rawPp };
  }
  if (rawPp < EVPI_EMISSION_RESOLUTION_PP) {
    return { emit: undefined, below_resolution: true, raw: rawPp };
  }
  return { emit: Math.round(rawPp * 10) / 10, below_resolution: false, raw: rawPp };
}

/**
 * DOCTRINE-PENDING (Neil): the "material EVPI" floor (in percentage points of
 * win-probability) above which the producer flags "gather evidence".
 *
 * PROVISIONAL placeholder, WEAKLY grounded — do NOT cite a "clean bimodal
 * 0.85-7.8pp band" as firm grounding. The available staging captures
 * (isl-v2-live-2026070{6,7,8}) are near-duplicate re-captures (effectively 1-2
 * distinct runs, mixed metric types), and the observed "material" EVPI values
 * sit at/below ISL's own ~6pp counterfactual noise floor — so this gate is
 * near-inert on current stamped builds. The value is harmless (one-line
 * reversible) but the REAL threshold is DOCTRINE-PENDING (Neil), to be set once
 * EVPI is calibrated against a wider, distinct sample. A future ruling changes
 * this single const.
 */
export const EVPI_HINT_MIN_PP = 0.5;

/**
 * DOCTRINE-PENDING (Neil): the heuristic-VOI fallback floor for the "gather
 * evidence" hint (used only when no REAL counterfactual EVPI is present).
 * Ratified from the UI's `value_of_information > 0.05` cut-point. A future ruling
 * changes this single const.
 */
export const VOI_HINT_MIN = 0.05;

/**
 * Doctrine 014 — derive the producer-owned `evidence_hint` ("gather evidence")
 * gate for a factor. Gates on the REAL per-factor counterfactual EVPI where
 * present, otherwise falls back to the heuristic VOI:
 *   `realEvpiPp` finite  ⇒ `realEvpiPp >= EVPI_HINT_MIN_PP`
 *   else `voi` finite     ⇒ `voi > VOI_HINT_MIN`
 *   else                  ⇒ `undefined` (no basis — the caller omits the field).
 *
 * `realEvpiPp` MUST be the counterfactual EVPI only (the caller passes
 * `undefined` for below-resolution or heuristic-derived percentage points, which
 * route to the VOI fallback per the ratified "real EVPI where present" rule).
 */
export function deriveEvidenceHint(args: {
  realEvpiPp?: number | null;
  voi?: number | null;
}): boolean | undefined {
  const { realEvpiPp, voi } = args;
  if (isFiniteNumber(realEvpiPp)) {
    return realEvpiPp >= EVPI_HINT_MIN_PP;
  }
  if (isFiniteNumber(voi)) {
    return voi > VOI_HINT_MIN;
  }
  return undefined;
}
