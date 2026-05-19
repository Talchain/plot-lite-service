/**
 * Flip-Thresholds Margin-Status Classifier
 *
 * Aggregate status for the additive margin-sensitivity diagnostic across
 * `flip_thresholds[]`. Distinct from `flip_thresholds_status` (PR #167) which
 * is strict-flip oriented and remains untouched.
 *
 * Rules — operate on the public denormalised flip_thresholds[] array:
 *
 *   empty / null / undefined                                           -> 'unavailable'
 *   no entry carries margin_sensitivity                                -> 'unavailable'
 *   at least one entry has movement ∈ {flipped, weakened, strengthened},
 *     AND at least one entry-with-margin has movement === 'none'       -> 'partial_movement'
 *   every entry-with-margin has movement === 'none'                    -> 'all_none'
 *   every entry-with-margin has movement ≠ 'none'                      -> 'computed'
 *
 * Entries without `margin_sensitivity` are excluded from classification:
 * they do NOT count toward `all_none`. The companion coverage object
 * (`flip_thresholds_margin_coverage`) surfaces honest counts.
 */

import type { DenormalisedFlipThreshold } from './flip-threshold-denormaliser.js';

export type FlipThresholdsMarginStatus =
  | 'computed'
  | 'partial_movement'
  | 'all_none'
  | 'unavailable';

export interface FlipThresholdsMarginStatusResult {
  status: FlipThresholdsMarginStatus;
}

export interface FlipThresholdsMarginCoverage {
  total: number;
  with_margin: number;
  without_margin: number;
}

export function classifyFlipThresholdsMarginStatus(
  flipThresholds: DenormalisedFlipThreshold[] | null | undefined,
): FlipThresholdsMarginStatusResult {
  if (!flipThresholds || flipThresholds.length === 0) {
    return { status: 'unavailable' };
  }

  let withMargin = 0;
  let movementCount = 0;
  let noneCount = 0;

  for (const entry of flipThresholds) {
    const ms = entry.margin_sensitivity;
    if (!ms) continue;
    withMargin++;
    if (ms.movement === 'none') {
      noneCount++;
    } else {
      // 'flipped' | 'weakened' | 'strengthened'
      movementCount++;
    }
  }

  if (withMargin === 0) {
    return { status: 'unavailable' };
  }
  if (movementCount > 0 && noneCount > 0) {
    return { status: 'partial_movement' };
  }
  if (movementCount > 0) {
    return { status: 'computed' };
  }
  return { status: 'all_none' };
}

export function computeFlipThresholdsMarginCoverage(
  flipThresholds: DenormalisedFlipThreshold[] | null | undefined,
): FlipThresholdsMarginCoverage {
  const total = flipThresholds?.length ?? 0;
  let withMargin = 0;
  if (flipThresholds) {
    for (const entry of flipThresholds) {
      if (entry.margin_sensitivity) withMargin++;
    }
  }
  return {
    total,
    with_margin: withMargin,
    without_margin: total - withMargin,
  };
}
