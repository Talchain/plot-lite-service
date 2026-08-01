/**
 * Flip Threshold Status Classifier
 *
 * Classifies the public, post-denormalised flip_thresholds[] array into a
 * single high-level status that consumers can render honestly without
 * re-deriving the picture from individual flip_reason strings.
 *
 * Rules — applied AFTER denormalisation, on the array placed in the v2/run
 * response. Operates only on the public shape so the source of truth is the
 * same data consumers see.
 *
 *   empty / null array                                  -> 'unavailable'
 *   every entry has flip_value !== null                 -> 'computed'
 *   no entry has flip_value, every entry is no_effect   -> 'all_no_effect'
 *   no entry has flip_value, mix of no_effect/unresolved-> 'unresolved'
 *   no entry has flip_value, every entry is unresolved  -> 'unresolved'
 *   at least one computed AND at least one no_effect    -> 'partial_no_effect'
 *   at least one computed, rest unresolved (no no_effect) -> 'computed'
 *
 * Crucially: timeout/error/insufficient_precision entries are never
 * misclassified as 'all_no_effect' — they fall under 'unresolved'.
 */

import type { DenormalisedFlipThreshold } from './flip-threshold-denormaliser.js';

export type FlipThresholdsStatus =
  | 'computed'
  | 'all_no_effect'
  | 'partial_no_effect'
  | 'unresolved'
  | 'unavailable';

export interface FlipThresholdsStatusResult {
  status: FlipThresholdsStatus;
  /** Populated for 'unresolved' — the first unresolved flip_reason seen. */
  status_reason?: string;
}

/**
 * Reasons that ATTEST a factor cannot flip the winner — a positive result, not
 * a failure to measure.
 *
 * - `'no_effect_within_bounds'` — the per-option transmission slopes genuinely
 *   differ, but no crossing lies inside the factor's domain.
 * - `'structurally_invariant'` (ROADMAP 2.228-F3, ISL PR #117) — the per-option
 *   transmission slopes are IDENTICAL (spread <= 1e-9), so no value of this
 *   factor can move the argmax. ISL calls this "a MATHEMATICAL ATTESTATION,
 *   not a failed or timed-out probe", and it is precisely the class PLoT's
 *   retired bisection probe used to mislabel as `no_effect_within_bounds`
 *   without ever having established it.
 *
 * ⚠ Membership here is load-bearing: it is what lets `all_no_effect` say "no
 * factor could change the leading option" truthfully. Never add a reason that
 * merely means "we did not finish".
 */
const NO_EFFECT_REASONS = new Set<string>([
  'no_effect_within_bounds',
  'structurally_invariant',
]);

/**
 * Reasons that mean "we did not produce a flip_value but it is not because the
 * factor has no effect" — these signal the analysis itself was incomplete or
 * imprecise, and must NOT be conflated with an attested no-effect.
 */
const UNRESOLVED_REASONS = new Set<string>([
  'timeout',
  'error',
  'insufficient_precision',
  'non_monotonic_grid',
  'heuristic',
  'zero_elasticity_fallback',
  'single_option',
  // ROADMAP 2.228-F3 (ISL PR #117): a GENUINE candidate that ranked below
  // FACTOR_FLIP_MAX_CANDIDATES by slope spread and was NOT evaluated. ISL
  // emits it rather than dropping the row so the omission is never silent —
  // which makes it unresolved, emphatically not a no-effect attestation.
  'candidate_cap_exceeded',
  // PLoT-side producer-contradiction guards (see adapters/factor-flip-values.ts):
  // ISL claimed 'found' but shipped no usable flip_value, shipped a value with
  // no statable direction, or shipped no reason at all. None of the three
  // establishes anything about the factor.
  'found_without_value',
  'value_without_direction',
  'unattested',
  // Review S6: set by flip-threshold-denormaliser.ts when a row's values could
  // not be mapped to finite user units. Safe today only via the conservative
  // unknown-reason default below — listed EXPLICITLY so it cannot become an
  // attested no-effect if that default is ever relaxed. A failed mapping says
  // nothing whatever about whether the factor can flip.
  'non_finite_denormalisation',
]);

type EntryKind = 'computed' | 'no_effect' | 'unresolved';

function classifyEntry(entry: DenormalisedFlipThreshold): EntryKind {
  if (entry.flip_value !== null && entry.flip_value !== undefined) {
    return 'computed';
  }
  if (NO_EFFECT_REASONS.has(entry.flip_reason)) {
    return 'no_effect';
  }
  if (UNRESOLVED_REASONS.has(entry.flip_reason)) {
    return 'unresolved';
  }
  // Unknown reason with null flip_value — treat conservatively as unresolved
  // rather than asserting no_effect, so future flip_reason additions don't
  // silently get reported as "no factors changed the leading option".
  return 'unresolved';
}

export function classifyFlipThresholdsStatus(
  flipThresholds: DenormalisedFlipThreshold[] | null | undefined,
): FlipThresholdsStatusResult {
  if (!flipThresholds || flipThresholds.length === 0) {
    return { status: 'unavailable' };
  }

  let computedCount = 0;
  let noEffectCount = 0;
  let unresolvedCount = 0;
  let firstUnresolvedReason: string | undefined;

  for (const entry of flipThresholds) {
    const kind = classifyEntry(entry);
    if (kind === 'computed') {
      computedCount++;
    } else if (kind === 'no_effect') {
      noEffectCount++;
    } else {
      unresolvedCount++;
      if (firstUnresolvedReason === undefined) {
        firstUnresolvedReason = entry.flip_reason || 'unknown';
      }
    }
  }

  // ⚠ THE `unresolvedCount === 0` GUARD IS LOAD-BEARING (review S1, 2.228-F3).
  //
  // `partial_no_effect` renders as "some factors flip, THE REST CANNOT" — a
  // claim about every non-computed row. That is only true when every
  // non-computed row is an ATTESTED no-effect. Without this guard the mix
  //   1 × found + 1 × structurally_invariant + 8 × candidate_cap_exceeded
  // reported `partial_no_effect` while eight factors had never been evaluated
  // at all, and the correction could not reach the copy: `status_reason` is
  // declared payload-only and is never rendered.
  //
  // That mix is not hypothetical — it became reachable the moment ISL's
  // closed-form phase started emitting `candidate_cap_exceeded`, which it does
  // for every genuine candidate ranked below FACTOR_FLIP_MAX_CANDIDATES (10),
  // i.e. on any graph with more than ten eligible root factors.
  //
  // The sibling `all_no_effect` at the bottom of this function has always
  // carried the same guard, for the same reason. This one was missing it.
  if (computedCount > 0 && noEffectCount > 0 && unresolvedCount === 0) {
    return { status: 'partial_no_effect' };
  }
  if (computedCount > 0) {
    // At least one factor produced a flip value, so the result is actionable
    // and the UI renders it as such. This branch now also absorbs the mix the
    // guard above rejects (computed + attested-no-effect + unresolved), which
    // is the deliberately conservative landing: `computed` claims only what it
    // can prove — "a flip was found" — and asserts NOTHING about the rows that
    // did not resolve, whereas `partial_no_effect` asserted they cannot flip.
    //
    // `status_reason` carries the first unresolved reason so the absorption is
    // attributable in the payload rather than silent. It stays payload-only.
    //
    // ⚠ WHY NOT A NEW `partial_unresolved` STATUS (the alternative the review
    // offered): a new `flip_thresholds_status` token is a cross-repo wire
    // change, and this very PR is already blocked behind CEE #784 because the
    // new `structurally_invariant` FLIP_REASON token broke exact-string mirror
    // sites in CEE. Minting a second new token in the same PR would repeat that
    // defect class while the first instance is still in flight. Rowed: add
    // `partial_unresolved` (or an `unresolved_count`) together with the CEE
    // consumer that reads it.
    return {
      status: 'computed',
      ...(unresolvedCount > 0 && firstUnresolvedReason
        ? { status_reason: firstUnresolvedReason }
        : {}),
    };
  }
  if (noEffectCount > 0 && unresolvedCount === 0) {
    return { status: 'all_no_effect' };
  }
  return { status: 'unresolved', status_reason: firstUnresolvedReason };
}
