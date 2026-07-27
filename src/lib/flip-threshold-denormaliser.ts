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
import type { NormalisationContext, NormalisationRange } from './intervention-normaliser.js';
import { denormaliseValue } from './intervention-normaliser.js';
import { isFiniteNumber } from '../util/numeric.js';
import type { MarginSensitivity } from '../analysis/margin-sensitivity.js';

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
  /** Number of binary-search (bisection) iterations used (grid probes excluded). */
  iterations_used?: number;
  /**
   * Total probe evaluations COMPLETED (3 Step-0 probes plus any bisection/grid
   * midpoints; completions, not attempts). 0 when no probes ran. Disambiguates
   * iterations_used:0.
   */
  probes_used?: number;
  /**
   * Additive lead-margin diagnostic. Omitted on entries whose flip-search
   * Step-0 probes did not complete (pre-probe timeout, non-finite baseline,
   * exception during probe phase, heuristic-only entries).
   *
   * `value_scale` is `'display'` only when `strongest_probe_value` has been
   * denormalised here against a valid factor context. Otherwise it stays
   * `'normalised'` and the value is preserved as emitted by the helper.
   */
  margin_sensitivity?: MarginSensitivity;
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

    // Denormalise current_value and flip_value using the factor's range.
    // ROADMAP 1.277: denormaliseValue is absence-in ⇒ absence-out, so both of
    // these are `number | undefined` and the finite checks below narrow them.
    const denormCurrent = denormaliseValue(flip.current_value, factorContext.range);
    // `flip_value === null` means "no flip achievable" — a genuine, already-modelled
    // absence, NOT a failed denormalisation. The primitive would now reject null on
    // its own, but the explicit branch stays: it is what keeps that absence out of
    // the `nonFiniteDenorm` disclosure below, which must fire only for a real
    // mapping failure.
    const denormFlip = flip.flip_value !== null
      ? denormaliseValue(flip.flip_value, factorContext.range)
      : null;

    // F14 (defense-in-depth): the range-source finite guard (deriveRange) makes
    // this unreachable for ranges built here, but a directly-supplied
    // overflow-width range would denormalise a valid value to ±Infinity, which
    // JSON.stringify emits as a fabricated `null`. Finite-check every public
    // numeric after the map: emit the finite value, else null the flip_value AND
    // DISCLOSE via flip_reason so the null is attributable, never silent.
    // `isFiniteNumber` is the type-guard flavour of the same predicate: it both
    // rejects the non-finite value AND narrows `number | undefined` to `number`,
    // so the emitted field is the checked value by construction.
    const currentFinite = isFiniteNumber(denormCurrent);
    const flipFinite = isFiniteNumber(denormFlip);
    const nonFiniteDenorm = !currentFinite || (denormFlip !== null && !flipFinite);

    return {
      factor_id: flip.factor_id,
      factor_label: flip.factor_label,
      // Never emit a non-finite current_value — fall back to the pre-denorm
      // (normalised) value, which the disclosed flip_reason flags as unmapped.
      current_value: currentFinite ? denormCurrent : flip.current_value,
      flip_value: flipFinite ? denormFlip : null,
      direction: flip.direction,
      unit: flip.unit,
      alternative_winner_id: flip.alternative_winner_id ?? null,
      alternative_winner_label: resolveLabel(flip.alternative_winner_id, options),
      flip_reason: nonFiniteDenorm ? 'non_finite_denormalisation' : (flip.flip_reason ?? 'heuristic'),
      iterations_used: flip.iterations_used,
      probes_used: flip.probes_used,
      ...(flip.margin_sensitivity
        ? { margin_sensitivity: denormaliseMarginSensitivity(flip.margin_sensitivity, factorContext.range) }
        : {}),
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
    probes_used: flip.probes_used,
    // No factor context for denormalisation. Pass margin_sensitivity through
    // untouched: `value_scale` stays `'normalised'` for honesty.
    ...(flip.margin_sensitivity ? { margin_sensitivity: flip.margin_sensitivity } : {}),
  };
}

/**
 * Denormalise `strongest_probe_value` against the factor's range and stamp
 * `value_scale: 'display'`. Sets `display_value_available` = true ONLY when
 * the denormalised probe value is itself finite — so DGAI can render
 * `strongest_probe_value` exactly when this boolean is true.
 *
 * Probability fields (margins, deltas, percentage-points) are scale-
 * independent and pass through unchanged.
 */
function denormaliseMarginSensitivity(
  margin: MarginSensitivity,
  range: NormalisationRange,
): MarginSensitivity {
  // ROADMAP 1.277: the `as number` cast that used to sit on this call is GONE.
  // It existed only to launder `number | null` past a `number` parameter — i.e. to
  // silence the compiler about exactly the null this lane is closing. The primitive
  // now takes `unknown` and rejects a non-number itself, so the hand-written
  // `probeIsFinite` pre-check is redundant and has been removed with it: one guard,
  // in the primitive, instead of a cast plus a caller-side mirror of the same test.
  const denormProbe = denormaliseValue(margin.strongest_probe_value, range);
  const denormProbeFinite = isFiniteNumber(denormProbe);
  return {
    ...margin,
    strongest_probe_value: denormProbeFinite ? denormProbe : null,
    value_scale: 'display',
    display_value_available: denormProbeFinite,
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
