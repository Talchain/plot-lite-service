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

const NO_EFFECT_REASON = 'no_effect_within_bounds';

/**
 * Reasons that mean "we did not produce a flip_value but it is not because the
 * factor has no effect" — these signal the analysis itself was incomplete or
 * imprecise, and must NOT be conflated with 'no_effect_within_bounds'.
 */
const UNRESOLVED_REASONS = new Set<string>([
  'timeout',
  'error',
  'insufficient_precision',
  'non_monotonic_grid',
  'heuristic',
  'zero_elasticity_fallback',
  'single_option',
]);

type EntryKind = 'computed' | 'no_effect' | 'unresolved';

function classifyEntry(entry: DenormalisedFlipThreshold): EntryKind {
  if (entry.flip_value !== null && entry.flip_value !== undefined) {
    return 'computed';
  }
  if (entry.flip_reason === NO_EFFECT_REASON) {
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

  if (computedCount > 0 && noEffectCount > 0) {
    // When unresolved entries (timeout / error / insufficient_precision)
    // are also present, surface the first-seen unresolved reason so UI
    // consumers can soften copy that would otherwise imply every
    // non-computed factor was a harmless no_effect_within_bounds case.
    // The base status stays 'partial_no_effect' so existing consumers
    // continue to render the same broad UX; status_reason is purely
    // additive metadata. Field is payload-only — never user-facing copy.
    return {
      status: 'partial_no_effect',
      ...(unresolvedCount > 0 && firstUnresolvedReason
        ? { status_reason: firstUnresolvedReason }
        : {}),
    };
  }
  if (computedCount > 0) {
    // Known scope choice (follow-up tracked separately): when a mix of
    // computed and unresolved entries is present (no no_effect entries),
    // we report 'computed' because at least one factor produced a flip
    // value, and the UI treats the result as actionable. This silently
    // absorbs the unresolved entries. A future revision may emit a
    // dedicated 'partial_unresolved' status (or add an `unresolved_count`
    // counter) so timeout / error / insufficient_precision entries are
    // surfaced even when one factor has a flip value. Deliberately out
    // of scope for the initial display-honesty workstream.
    return { status: 'computed' };
  }
  if (noEffectCount > 0 && unresolvedCount === 0) {
    return { status: 'all_no_effect' };
  }
  return { status: 'unresolved', status_reason: firstUnresolvedReason };
}
