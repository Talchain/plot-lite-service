/**
 * Doctrine 039 — producer-owned `driver_label`.
 *
 * `driver_label` is a producer-owned 3-band label (strong/moderate/minor) over
 * the normalised influence scalar (`influence_score`). The band boundaries are
 * ratified FROM the UI's existing cut-points (useResultsSectionData.ts):
 * >=0.50 strong, >=0.20 moderate, else minor.
 *
 * NOTE — this field is NOT yet a drop-in replacement for the UI's copy. The
 * UI's `getSemanticLabel` is 4-VALUED (it adds a rank-1 'biggest'/'strongest'
 * band) and keys off normalised |elasticity| / max, NOT the wire
 * `influence_score` — so the UI cannot fully drop its copy on this field alone.
 * Reconciling the rank-1 band and the elasticity-vs-influence basis is a
 * doctrine row (Neil/UI), tracked separately. This field is valid and honest as
 * a producer influence-band; it is not yet claimed to supersede getSemanticLabel.
 *
 * The label is a pure function of `influence_score`; a factor whose influence
 * is absent/non-finite gets NO label (the missing-vs-value honesty contract:
 * never fabricate 'minor' from a missing measurement).
 */

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

/** Categorical driver-strength label over normalised influence. */
export type DriverLabel = 'strong' | 'moderate' | 'minor';

/**
 * Derive the categorical driver label from a factor's normalised influence.
 *
 * Returns `undefined` (field omitted by the caller) when influence is absent or
 * non-finite — distinct from 'minor', which is a real low-influence measurement.
 */
export function deriveDriverLabel(
  influenceScore: number | null | undefined,
): DriverLabel | undefined {
  if (typeof influenceScore !== 'number' || !Number.isFinite(influenceScore)) {
    return undefined;
  }
  if (influenceScore >= DRIVER_LABEL_STRONG_MIN) return 'strong';
  if (influenceScore >= DRIVER_LABEL_MODERATE_MIN) return 'moderate';
  return 'minor';
}
