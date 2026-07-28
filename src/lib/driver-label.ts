/**
 * Doctrine 039 — producer-owned `driver_label` (D-7: 4-valued).
 *
 * `driver_label` is a producer-owned categorical driver-strength label over the
 * normalised influence scalar (`influence_score`). It is now **4-valued** —
 * `'biggest' | 'strong' | 'moderate' | 'minor'` — to MATCH the shape of the UI's
 * `getSemanticLabel`, which adds a rank-1 'biggest'/'strongest' band on top of the
 * three magnitude bands. The three magnitude cut-points are ratified FROM the UI's
 * existing cut-points (useResultsSectionData.ts): >=0.50 strong, >=0.20 moderate,
 * else minor. The rank-1 'biggest' band is SET-AWARE, so it is applied by the
 * caller's derive-pass — see `indexOfCanonicalTopDriver` — NOT by the pure
 * per-factor `deriveDriverLabel` helper.
 *
 * ## ⭐ FAMILY-4 S1b — the two bands now answer two DIFFERENT questions
 *
 * `'strong' | 'moderate' | 'minor'` are MAGNITUDE claims about the row's own
 * `influence_score`, unchanged. `'biggest'` is a RANK claim, and it now projects
 * `driver_order.ranked_factor_ids[0]` — PLoT's ONE canonical, lever-aware order —
 * instead of running a second, lever-blind argmax over `influence_score`. Before
 * this slice the two disagreed on the live wire, and `'biggest'` was the one that
 * crowned a producer-zeroed lever. The raw structural argmax is still published,
 * under its own honest name, as `influence_rank === 1`.
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
 * influence is absent/non-finite gets NO magnitude label (the missing-vs-value
 * honesty contract: never fabricate 'minor' from a missing measurement).
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
 * (that band is a RANK claim projected from the canonical driver order — see
 * `indexOfCanonicalTopDriver`).
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

/**
 * ⭐ Index of the factor that carries the `'biggest'` band — a PROJECTION of the
 * canonical driver order (family 4, slice S1b).
 *
 * ## What this replaced, and why
 *
 * This was `indexOfBiggestDriver`: argmax over `influence_score`, NOT
 * lever-aware. On the live wire it crowned the option-pinned lever the same
 * response publishes at `sensitivity_score: 0`, `elasticity: 0`,
 * `zero_reason: 'intervention_override'` — a factor the producer had explicitly
 * zeroed, labelled the biggest driver in the decision — while
 * `importance_rank: 1` (which IS lever-aware) named a different factor.
 *
 * The prior lane left that divergence deliberately, on three reasons that the
 * amendment re-derived and overturned:
 *
 *   1. *"'biggest' is DEFINED as the greatest influence_score, so gating it makes
 *      the label contradict its own row."* — The definition is what changed.
 *      `'biggest'` is now a RANK claim over PLoT's one canonical order, not a
 *      magnitude claim; the three magnitude bands still speak for the number in
 *      the row, and they are untouched. The response also now publishes
 *      `driver_order` and `influence_rank`, so the structural argmax remains
 *      readable under its own honest name — nothing was hidden, one crown moved.
 *   2. *"the basis question is an open doctrine row (Neil/UI)."* — Still open,
 *      and still only about the three MAGNITUDE cut-points. The amendment's §4.3
 *      settles the separate question of which ORDER a crown projects, and
 *      settles it for all five crowns at once.
 *   3. *"blast radius is zero — no consumer reads driver_label."* — A census
 *      taken 25 Jul at tips that have since moved (CLAUDE.md trap 12: a census
 *      is a hand-maintained mirror). Not inherited here — and the argument cuts
 *      the other way regardless: a field with no readers is the cheapest
 *      possible moment to correct it.
 *
 * ## The rule
 *
 * Rule S3 — *"one order, and the array IS it"*: `factor_sensitivity[]` is
 * emitted in canonical order, so `ranked_factor_ids[0]` is index `0`. The crown
 * therefore projects the order rather than re-deriving a second argmax over a
 * quantity the order was not made on.
 *
 * Returns `-1` for an empty array — no order, no crown.
 *
 * ⚠ The crowned row keeps whatever magnitude band its own `influence_score`
 * earned until this override replaces it, and a row with absent/non-finite
 * influence carries no magnitude band at all. It is STILL crowned when it heads
 * the canonical order: `'biggest'` now answers *"which factor does this producer
 * rank first?"*, and that question has an answer even when the magnitude
 * question does not.
 */
export function indexOfCanonicalTopDriver(
  factors: ReadonlyArray<unknown>,
): number {
  return factors.length > 0 ? 0 : -1;
}
