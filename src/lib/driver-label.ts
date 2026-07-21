/**
 * Doctrine 039 — producer-owned `driver_label` (D-7: 4-valued).
 *
 * `driver_label` is a producer-owned categorical driver-strength label over the
 * normalised influence scalar (`influence_score`). It is now **4-valued** —
 * `'biggest' | 'strong' | 'moderate' | 'minor'` — to MATCH the shape of the UI's
 * `getSemanticLabel`, which adds a rank-1 'biggest'/'strongest' band on top of the
 * three magnitude bands. The three magnitude cut-points are ratified FROM the UI's
 * existing cut-points (useResultsSectionData.ts): >=0.50 strong, >=0.20 moderate,
 * else minor. The rank-1 'biggest' band is SET-AWARE (needs every factor's
 * influence), so it is applied by the caller's derive-pass — see
 * `indexOfBiggestDriver` — NOT by the pure per-factor `deriveDriverLabel` helper.
 *
 * NOTE — this now matches getSemanticLabel's 4-valued SHAPE, but two things remain
 * gated on UI confirmation (D-7 KEY UNCERTAINTY: the UI facts are unconfirmed):
 *   1. BASIS FLIP — getSemanticLabel keys off normalised |elasticity| / max, while
 *      this field keys off the wire `influence_score`. Reconciling the basis is a
 *      doctrine row (Neil/UI), tracked separately.
 *   2. UI ADOPTION — the UI dropping its own copy on this field is gated on the UI
 *      team confirming both the 4th band and the basis. This field is valid and
 *      honest as a producer influence-band today; it is not yet CLAIMED to
 *      supersede getSemanticLabel until that confirmation lands.
 *
 * The magnitude label is a pure function of `influence_score`; a factor whose
 * influence is absent/non-finite gets NO label (the missing-vs-value honesty
 * contract: never fabricate 'minor' from a missing measurement) and is likewise
 * NOT eligible to be 'biggest'.
 */

import { isFiniteNumber } from '../util/numeric.js';

/**
 * DOCTRINE-PENDING (Neil): the "strong" driver band floor over normalised
 * influence. Ratified from the UI's getSemanticLabel cut-point (0.50). A future
 * ruling changes this single const.
 */
export const DRIVER_LABEL_STRONG_MIN = 0.5;

/**
 * DOCTRINE-PENDING (Neil): the "moderate" driver band floor over normalised
 * influence. Ratified from the UI's getSemanticLabel cut-point (0.20). A future
 * ruling changes this single const.
 */
export const DRIVER_LABEL_MODERATE_MIN = 0.2;

/**
 * Categorical driver-strength label. 4-valued (D-7) to match the UI's
 * `getSemanticLabel`: the set-aware rank-1 `'biggest'` band plus the three
 * per-factor magnitude bands.
 */
export type DriverLabel = 'biggest' | 'strong' | 'moderate' | 'minor';

/**
 * The three magnitude bands `deriveDriverLabel` can return. `'biggest'` is a
 * set-aware rank-1 override applied by the caller's derive-pass, never by the
 * pure per-factor helper — so it is excluded here.
 */
export type MagnitudeDriverLabel = Exclude<DriverLabel, 'biggest'>;

/**
 * Derive the per-factor magnitude driver label from a factor's normalised
 * influence. This is the pure 3-band helper; it NEVER returns `'biggest'`
 * (that band is set-aware — see `indexOfBiggestDriver`).
 *
 * Returns `undefined` (field omitted by the caller) when influence is absent or
 * non-finite — distinct from 'minor', which is a real low-influence measurement.
 */
export function deriveDriverLabel(
  influenceScore: number | null | undefined,
): MagnitudeDriverLabel | undefined {
  if (!isFiniteNumber(influenceScore)) {
    return undefined;
  }
  if (influenceScore >= DRIVER_LABEL_STRONG_MIN) return 'strong';
  if (influenceScore >= DRIVER_LABEL_MODERATE_MIN) return 'moderate';
  return 'minor';
}

/** Minimal shape read by the set-aware rank-1 selector. */
interface InfluenceCarrier {
  influence_score?: number | null;
}

/**
 * Set-aware rank-1 selector for the `'biggest'` driver band (D-7). Returns the
 * index of the SINGLE factor with the greatest finite `influence_score`, or `-1`
 * when no factor has a finite influence.
 *
 * The selection is magnitude-BLIND — it ranks by raw `influence_score`, never by
 * the magnitude band — so the rank-1 factor is `'biggest'` UNCONDITIONAL of
 * magnitude (it is 'biggest' even if its band would be 'minor'). This matches the
 * UI `getSemanticLabel` rank-1 'biggest'/'strongest' band.
 *   // DOCTRINE-PENDING (Neil/UX): 'biggest' is rank-1 unconditional; add a
 *   // magnitude floor here if UX wants one.
 *
 * Ties on the max resolve to the FIRST such factor in the given (stable, emitted)
 * order — deterministic — via the strict-`>` update (a later equal score never
 * displaces the earlier one). A factor with absent/non-finite influence is NOT
 * eligible (it carries no driver_label at all), so it can never be 'biggest'.
 */
export function indexOfBiggestDriver(
  factors: ReadonlyArray<InfluenceCarrier>,
): number {
  let biggestIdx = -1;
  let biggestScore = -Infinity;
  for (let i = 0; i < factors.length; i++) {
    const s = factors[i].influence_score;
    if (!isFiniteNumber(s)) continue; // ineligible
    if (s > biggestScore) {
      biggestScore = s;
      biggestIdx = i;
    }
  }
  return biggestIdx;
}
