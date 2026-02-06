/**
 * Flip Threshold Denormaliser
 *
 * Converts flip threshold data from normalised [0,1] space to user units
 * and enriches with human-readable labels.
 *
 * Uses the same denormaliseValue() infrastructure as p10/p50/p90 outcomes
 * to ensure consistency across the entire response.
 */

import type { FlipThresholdInputData } from '../cee/validation/m1-review-types.js';
import type { NormalisationContext } from './intervention-normaliser.js';
import { denormaliseValue } from './intervention-normaliser.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Denormalised flip threshold ready for UI consumption.
 * Values in user units (£, %, etc.), not normalised [0,1].
 */
export interface DenormalisedFlipThreshold {
  factor_id: string;
  factor_label: string;
  /** Current value in user units */
  current_value: number;
  /** Value at which recommendation flips (user units). Null if no flip found. */
  flip_value: number | null;
  direction: 'increase' | 'decrease';
  /** Unit string from observed_state (e.g., "GBP", "%", "months") */
  unit?: string;
  /** Which option would win after the flip (null if no flip) */
  alternative_winner_id: string | null;
  /** Human-readable label for the alternative winner */
  alternative_winner_label: string | null;
  /** Reason for the flip_value result */
  flip_reason: string;
  /** Number of ISL inference iterations used */
  iterations_used?: number;
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Denormalise flip thresholds from [0,1] to user units.
 *
 * @param flipData Flip threshold data in normalised [0,1] space
 * @param context Normalisation context with per-factor ranges (undefined if no normalisation happened)
 * @param options Options array for alternative_winner_label lookup
 * @returns Denormalised flip thresholds in user units
 */
export function denormaliseFlipThresholds(
  flipData: FlipThresholdInputData[],
  context: NormalisationContext | undefined,
  options: Array<{ id: string; label: string }>
): DenormalisedFlipThreshold[] {
  return flipData.map((flip) => {
    const factorContext = context?.factors.get(flip.factor_id);

    // If no normalisation context for this factor, values are already in user units
    if (!factorContext) {
      return enrichWithLabels(flip, options);
    }

    // Denormalise current_value and flip_value using the factor's range
    const denormCurrent = denormaliseValue(flip.current_value, factorContext.range);
    const denormFlip = flip.flip_value !== null
      ? denormaliseValue(flip.flip_value, factorContext.range)
      : null;

    return {
      factor_id: flip.factor_id,
      factor_label: flip.factor_label,
      current_value: denormCurrent,
      flip_value: denormFlip,
      direction: flip.direction,
      unit: flip.unit,
      alternative_winner_id: flip.alternative_winner_id ?? null,
      alternative_winner_label: resolveLabel(flip.alternative_winner_id, options),
      flip_reason: flip.flip_reason ?? 'heuristic',
      iterations_used: flip.iterations_used,
    };
  });
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Enrich flip threshold with labels (no denormalisation).
 * Used when no normalisation context is available for a factor.
 */
function enrichWithLabels(
  flip: FlipThresholdInputData,
  options: Array<{ id: string; label: string }>
): DenormalisedFlipThreshold {
  return {
    factor_id: flip.factor_id,
    factor_label: flip.factor_label,
    current_value: flip.current_value,
    flip_value: flip.flip_value,
    direction: flip.direction,
    unit: flip.unit,
    alternative_winner_id: flip.alternative_winner_id ?? null,
    alternative_winner_label: resolveLabel(flip.alternative_winner_id, options),
    flip_reason: flip.flip_reason ?? 'heuristic',
    iterations_used: flip.iterations_used,
  };
}

/**
 * Look up option label from option ID. Returns null if not found or ID is null.
 */
function resolveLabel(
  optionId: string | undefined | null,
  options: Array<{ id: string; label: string }>
): string | null {
  if (!optionId) return null;
  const option = options.find((o) => o.id === optionId);
  return option?.label ?? optionId; // Fallback to ID if label missing
}
