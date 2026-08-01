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
import { denormaliseValue, deriveRange } from './intervention-normaliser.js';
import { isFiniteNumber } from '../util/numeric.js';
import type { MarginSensitivity } from '../analysis/margin-sensitivity.js';
// Type-only (erased at runtime): engine-v3.ts imports DenormalisedFlipThreshold
// from this module, so a VALUE import here would close a runtime cycle.
import type { EngineGraphV3, EngineNodeV3 } from '../types/engine-v3.js';

/**
 * Scale of a flip row's `current_value` / `flip_value`, at ROW level.
 *
 * CEE's flip-threshold cage reads this key FIRST and only then falls back to
 * `margin_sensitivity.value_scale`
 * (olumi-assistants-service `src/orchestrator-v5/context/analysis-signals.ts`
 * `readRowValueScale`/`flipRowScaleIsDisplaySafe`, CEE staging `b8a38de7`):
 * `'display'` licenses the row, any other non-empty token closes it, and an
 * absent token falls through to a value-magnitude heuristic that cannot license
 * a factor whose honest user units are themselves ≤ 1.
 *
 * - `'display'`    — user units. Set ONLY when this module actually denormalised
 *                    the pair against an `explicit_cap` range.
 * - `'normalised'` — still in [0,1]. Set only when the node positively attests
 *                    normalisation (it carries `raw_value` and/or `cap`) but no
 *                    usable cap was available to lift it.
 * - absent         — scale not established. A caller may legitimately post a
 *                    graph in user units with no cap; claiming either token
 *                    there would be an unattested assertion.
 */
export type FlipValueScale = 'display' | 'normalised';

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
  /**
   * ROADMAP 2.228 F2 — the scale of `current_value`/`flip_value` on THIS row.
   * See {@link FlipValueScale}. Absent when the scale is not established.
   */
  value_scale?: FlipValueScale;
  /**
   * `current_value` rendered in user units with the unit appended
   * (e.g. `"275000 £"`). Present only alongside `value_scale: 'display'`, and
   * only when the value can be written losslessly — see {@link formatUserScale}.
   */
  current_display?: string;
  /**
   * `flip_value` rendered in user units with the unit appended. Present only
   * alongside `value_scale: 'display'` AND a non-null, finite `flip_value`.
   */
  flip_display?: string;
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Denormalise flip thresholds from [0,1] to user units.
 *
 * ROADMAP 2.228 F2: `context` is `undefined` for the entire V5 request — Phase 4a
 * only runs when some option intervention value falls outside [0,1]
 * (`intervention-normaliser.ts` `needsNormalisation`), and CEE's V5 graph already
 * carries normalised interventions. That gate is correct for its own job and is
 * deliberately NOT widened here. Instead the factor's scale is taken from the
 * NODE, whose `observed_state.cap` is the same `explicit_cap` tier `deriveRange`
 * already ranks first — so a row can reach user units on the V5 path without
 * re-scaling anything else in the request.
 *
 * @param flipData Flip threshold data in normalised [0,1] space
 * @param context Normalisation context with per-factor ranges (undefined if no normalisation happened)
 * @param options Options array for alternative_winner_label lookup
 * @param graph Graph the flip candidates were drawn from, for the per-factor
 *   `explicit_cap` scale. Optional — omit and the pre-2.228 behaviour is exact.
 * @returns Denormalised flip thresholds in user units
 */
export function denormaliseFlipThresholds(
  flipData: FlipThresholdInputData[],
  context: NormalisationContext | undefined,
  options: Array<{ id: string; label: string }>,
  graph?: EngineGraphV3
): DenormalisedFlipThreshold[] {
  const nodesById = indexNodes(graph);

  return flipData.map((flip) => {
    const node = nodesById?.get(flip.factor_id);
    // Phase 4a's range when it exists (unchanged), else the node's own
    // authoritative cap. Only the `explicit_cap` tier is accepted from the node:
    // deriveRange's chain ends at `default` [0,1], and denormalising by [0,1] is
    // the identity — stamping 'display' off it would assert user-scale about a
    // number that never moved.
    const factorContext = context?.factors.get(flip.factor_id);
    const range = factorContext?.range ?? explicitCapRange(node);

    // If no range is available for this factor, values are left as they arrived.
    if (!range) {
      return enrichWithLabels(flip, options, node);
    }

    // Denormalise current_value and flip_value using the factor's range.
    // ROADMAP 1.277: denormaliseValue is absence-in ⇒ absence-out, so both of
    // these are `number | undefined` and the finite checks below narrow them.
    const denormCurrent = denormaliseValue(flip.current_value, range);
    // `flip_value === null` means "no flip achievable" — a genuine, already-modelled
    // absence, NOT a failed denormalisation. The primitive would now reject null on
    // its own, but the explicit branch stays: it is what keeps that absence out of
    // the `nonFiniteDenorm` disclosure below, which must fire only for a real
    // mapping failure.
    const denormFlip = flip.flip_value !== null
      ? denormaliseValue(flip.flip_value, range)
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

    // F2: the row is user-scale only when the range that mapped it IS a user
    // scale. `explicit_cap` is the authoritative CEE-set cap; every other tier
    // either infers a range or falls back to [0,1], and neither earns the claim.
    const displayScale = range.source === 'explicit_cap';

    // Prefer the node's own `raw_value` — the number the USER gave — over the
    // round-trip of an already-ROUNDED normalised value. The live a7 factor
    // carries value 0.86 with raw_value 275000 and cap 320000: round-tripping
    // 0.86 yields 275200, so the card would show £275,200 for a £275,000 input.
    // Accepted only when it agrees with `value × cap` to the precision `value`
    // is written at (see reconcileRawValue) — a raw_value that disagrees by more
    // than its own rounding error would put current_value and flip_value on
    // different footings, which is the "two numbers, one factor" hazard itself.
    const rawCurrent = displayScale
      ? reconcileRawValue(node?.observed_state?.raw_value, flip.current_value, range)
      : undefined;

    const currentValue = rawCurrent ?? (currentFinite ? denormCurrent : flip.current_value);
    const flipValue = flipFinite ? denormFlip : null;

    // Display strings are authored only for a display-scale row, and only when
    // they can be written LOSSLESSLY: CEE's agreement rung compares
    // `Number(token) === rawValue` exactly, so a string we cannot guarantee is
    // not written at all. `value_scale` is independent — the row can be honestly
    // display-scale while its digits are unwritable (see formatUserScale).
    const currentDisplay = displayScale ? formatUserScale(currentValue, flip.unit) : undefined;
    const flipDisplay =
      displayScale && flipValue !== null ? formatUserScale(flipValue, flip.unit) : undefined;

    return {
      factor_id: flip.factor_id,
      factor_label: flip.factor_label,
      // Never emit a non-finite current_value — fall back to the pre-denorm
      // (normalised) value, which the disclosed flip_reason flags as unmapped.
      current_value: currentValue,
      flip_value: flipValue,
      direction: flip.direction,
      unit: flip.unit,
      alternative_winner_id: flip.alternative_winner_id ?? null,
      alternative_winner_label: resolveLabel(flip.alternative_winner_id, options),
      flip_reason: nonFiniteDenorm ? 'non_finite_denormalisation' : (flip.flip_reason ?? 'heuristic'),
      iterations_used: flip.iterations_used,
      probes_used: flip.probes_used,
      ...(flip.margin_sensitivity
        ? { margin_sensitivity: denormaliseMarginSensitivity(flip.margin_sensitivity, range) }
        : {}),
      ...(displayScale ? { value_scale: 'display' as const } : {}),
      ...(currentDisplay !== undefined ? { current_display: currentDisplay } : {}),
      ...(flipDisplay !== undefined ? { flip_display: flipDisplay } : {}),
    };
  });
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Enrich flip threshold with labels (no denormalisation).
 * Used when no usable range is available for a factor.
 */
function enrichWithLabels(
  flip: FlipThresholdInputData,
  options: Array<{ id: string; label: string }>,
  node?: EngineNodeV3
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
    // F2 fail-closed, ATTESTED: say 'normalised' only where the node itself
    // proves normalisation happened (it carries raw_value and/or cap) yet no
    // usable cap range could be derived. Where the node bears neither mark the
    // scale is genuinely unknown and the key stays ABSENT — a direct /v2/run
    // caller may legitimately post user-scale values with no cap, and stamping
    // 'normalised' there would close a door that is correctly open.
    ...(normalisationAttested(node) ? { value_scale: 'normalised' as const } : {}),
  };
}

/** Index a graph's nodes by id. `undefined` graph ⇒ `undefined` index (pre-2.228 path). */
function indexNodes(graph: EngineGraphV3 | undefined): Map<string, EngineNodeV3> | undefined {
  if (!graph || !Array.isArray(graph.nodes)) return undefined;
  return new Map(graph.nodes.map((n) => [n.id, n]));
}

/**
 * The node's `explicit_cap` range, or null.
 *
 * DERIVED, not mirrored: `deriveRange` is called and only its priority-0 verdict
 * is accepted, so this inherits that tier's own guards (`cap > 0`, finite width)
 * instead of re-implementing them next door. Every other tier — including the
 * `default` [0,1] fallback that a capless node lands on — is refused.
 */
function explicitCapRange(node: EngineNodeV3 | undefined): NormalisationRange | null {
  if (!node) return null;
  const range = deriveRange(node);
  return range.source === 'explicit_cap' ? range : null;
}

/** True when the node carries the marks of having been normalised. */
function normalisationAttested(node: EngineNodeV3 | undefined): boolean {
  const observed = node?.observed_state;
  if (!observed) return false;
  return observed.raw_value !== undefined || observed.cap !== undefined;
}

/**
 * Decimal places in a number's canonical JS decimal text; `-1` when that text is
 * exponential, so the caller can refuse rather than guess a precision.
 */
function decimalPlaces(value: number): number {
  const text = String(value);
  if (text.includes('e') || text.includes('E')) return -1;
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

/**
 * Accept `raw_value` as the authoritative user-scale current value iff it agrees
 * with `normalised × range` to within the rounding error the normalised value's
 * OWN precision implies.
 *
 * The tolerance is derived from the data, never a magic constant: a `value`
 * written with `d` decimals carries an implied error of half a unit in its last
 * place, which is `0.5 × 10^-d` of the range width in user units. For the live
 * a7 factor (value 0.86, cap 320000) that is ±1600, and |275000 − 275200| = 200
 * sits well inside it. A raw_value further out than its own rounding error is a
 * stale or mismatched field, and is refused so the row falls back to the
 * round-trip — consistent with `flip_value`, which has no raw counterpart.
 */
function reconcileRawValue(
  rawValue: unknown,
  normalisedValue: number,
  range: NormalisationRange
): number | undefined {
  if (!isFiniteNumber(rawValue)) return undefined;
  const places = decimalPlaces(normalisedValue);
  if (places < 0) return undefined;
  const roundTripped = denormaliseValue(normalisedValue, range);
  if (!isFiniteNumber(roundTripped)) return undefined;

  const tolerance = 0.5 * Math.pow(10, -places) * Math.abs(range.max - range.min);
  // Float slack so a value exactly on the boundary is not rejected by noise.
  const slack = Math.abs(roundTripped) * Number.EPSILON * 8;
  return Math.abs(rawValue - roundTripped) <= tolerance + slack ? rawValue : undefined;
}

/**
 * `<value> <unit>` — the form CEE's decision_review prompt specifies for
 * `current_display`/`flip_display` ("16000 GBP", "800 customers").
 *
 * Returns `undefined` rather than a string it cannot guarantee. CEE's agreement
 * rung (`licenceAgreesWithRawValue`) tokenises with `/-?\d+(?:\.\d+)?/g` and
 * requires `Number(token) === rawValue` EXACTLY, so:
 *   - no `toLocaleString()` — it rounds to 3 fraction digits by default, turning
 *     1234.56789 into "1,234.568", which fails the equality it is meant to prove;
 *   - no thousands separators and no abbreviation ("£275k" fails);
 *   - exponential text is refused outright — String(1e21) is "1e+21", which
 *     tokenises to [1, 21] and would silently disagree with the value it names.
 */
function formatUserScale(value: number, unit: string | undefined): string | undefined {
  if (!Number.isFinite(value)) return undefined;
  const text = String(value);
  if (text.includes('e') || text.includes('E')) return undefined;
  const trimmedUnit = typeof unit === 'string' ? unit.trim() : '';
  return trimmedUnit.length > 0 ? `${text} ${trimmedUnit}` : text;
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
