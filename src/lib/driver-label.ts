/**
 * Doctrine 039 — producer-owned `driver_label`.
 *
 * PLoT emits a categorical strong/moderate/minor label over the normalised
 * influence scalar (`influence_score`) so the UI can drop its `getSemanticLabel`
 * cut-point. The band boundaries are ratified FROM the UI's existing cut-points
 * (useResultsSectionData.ts): >=0.50 strong, >=0.20 moderate, else minor.
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
