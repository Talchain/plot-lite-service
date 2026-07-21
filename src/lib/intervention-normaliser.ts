/**
 * Intervention Normaliser
 *
 * Normalises intervention values to [0,1] before ISL calls and denormalises
 * outcome values back to user units after ISL responses.
 *
 * Problem: ISL expects normalised [0,1] inputs but receives raw values (e.g., $180,000)
 * causing catastrophic outcome predictions.
 *
 * Solution: Scale interventions to [0,1] using node state_space ranges, then
 * inverse-transform ISL outcomes back to user units.
 *
 * @see Schema v2.6 §B.8 - Range derivation priority chain
 */

import type { EngineNodeV3, OptionV3, InterventionValueV3, OutcomeStatsV3, RepairRecord } from '../types/engine-v3.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * Range source for normalisation.
 * Priority order (interventions): explicit_cap > explicit > extracted > inferred_spread > inferred_baseline > inferred_value > default
 *
 * Constraint-only sources (P0-C1, producer-declared scales — see
 * normaliseGoalConstraints):
 * - 'goal_threshold_cap': the node's CEE-stamped goal_threshold_cap
 * - 'unit_percent': the constraint's '%' unit (house doctrine: '%' always
 *   normalises against 100)
 */
export type RangeSource = 'explicit_cap' | 'explicit' | 'extracted' | 'inferred_spread' | 'inferred_baseline' | 'inferred_value' | 'default' | 'goal_threshold_cap' | 'unit_percent';

/**
 * Range for normalisation.
 */
export interface NormalisationRange {
  min: number;
  max: number;
  source: RangeSource;
}

/**
 * True iff `r` is the IDENTITY range `[0,1]`. Doctrine-load-bearing: an identity
 * intervention scale is the marker for "this scale is an ASSUMPTION, not a
 * MEASURED spread" — the node was intervened while Phase 4a was SKIPPED (all
 * interventions already in [0,1]). A NON-identity range is a measured
 * ground-truth spread. The two rank very differently in the constraint priority
 * ladder (identity is demoted below producer declarations). Ignores `source` —
 * only the numeric bounds decide.
 */
export function isIdentityRange(r: NormalisationRange): boolean {
  return r.min === 0 && r.max === 1;
}

/**
 * True iff two ranges are the SAME scale — equal numeric bounds. Source-agnostic
 * by design (A3 R1): "equal bounds = same scale" — a measured intervention spread
 * `[0, cap]` and a producer `goal_threshold_cap` `[0, cap]` describe the identical
 * scale even though their `source` strings differ, so the threshold IS on the
 * samples' scale and did NOT diverge. Compares min AND max by value.
 */
export function rangesEqual(a: NormalisationRange, b: NormalisationRange): boolean {
  return a.min === b.min && a.max === b.max;
}

/**
 * Intervention hints from CE (Context Engine).
 * Used to provide additional metadata for normalisation.
 */
export interface InterventionHints {
  /** Unit of measurement (e.g., "USD", "percent") */
  unit?: string;
  /** Factor type hint (e.g., "salary", "probability") */
  factor_type?: string;
  /** CE-extracted range bounds */
  extracted_range?: [number, number];
  /** Source of the intervention */
  source?: 'brief_extraction' | 'user_specified' | 'inferred';
}

/**
 * Intervention transform record for repairs_applied[].
 * Captures the normalisation transform for auditability.
 */
export interface InterventionTransformRecord {
  factor_id: string;
  raw: number;
  normalised: number;
  range: { min: number; max: number };
  range_source: RangeSource;
}

/**
 * Context for a single factor's normalisation.
 */
export interface FactorNormalisationContext {
  factor_id: string;
  range: NormalisationRange;
  /** Original baseline value (for outcome denormalisation) */
  baseline: number;
}

/**
 * Full normalisation context for a request.
 * Contains all factor contexts needed for normalisation/denormalisation.
 */
export interface NormalisationContext {
  factors: Map<string, FactorNormalisationContext>;
  /** Goal node ID (for outcome denormalisation) */
  goal_node_id: string;
  /** Goal node context (if available) */
  goal_context?: FactorNormalisationContext;
}

/**
 * Normalised options ready for ISL.
 */
export interface NormalisedOptions {
  options: OptionV3[];
  context: NormalisationContext;
}

/**
 * Diagnostic info for a normalised intervention.
 */
export interface NormalisationDiagnostic {
  /**
   * Which option this intervention belongs to. Lets a per-option clamp map
   * be derived (Map<optionId, Map<factorId, clamped>>) so egress can flag a
   * clamped breach magnitude as a lower bound (constraint_margins
   * margin_precision). The push is inside options.map(option => …) where
   * option.id is in scope.
   */
  option_id: string;
  factor_id: string;
  original_value: number;
  normalised_value: number;
  range: NormalisationRange;
  clamped: boolean;
}

// -----------------------------------------------------------------------------
// Range Derivation (Priority Chain per Schema v2.6 §B.8)
// -----------------------------------------------------------------------------

/**
 * A range is usable for (de)normalisation ONLY when both endpoints are finite
 * AND the width is finite and strictly positive (Codex F14). The half-open
 * check `max > min` is NOT sufficient: `{min:-1e308,max:1e308}` satisfies it,
 * yet `max - min === Infinity`, so denormalising a valid `0.5` returns
 * `Infinity` — which `JSON.stringify` emits as a fabricated `null` on the wire,
 * or (for edge current_mean/flip_mean) makes PLoT silently DROP the whole
 * E-value. Every range source is gated through this so a non-finite-width range
 * can never reach `denormaliseValue`; a rejected source falls through the
 * priority chain to the safe `default [0,1]`.
 */
export function isFiniteRange(min: number, max: number): boolean {
  return (
    Number.isFinite(min) &&
    Number.isFinite(max) &&
    Number.isFinite(max - min) &&
    max - min > 0
  );
}

/**
 * Validate an extracted range from CE.
 * Returns true if the range is valid for normalisation.
 */
function isValidExtractedRange(range: [number, number] | undefined): range is [number, number] {
  if (!Array.isArray(range) || range.length !== 2) return false;
  const [min, max] = range;
  if (typeof min !== 'number' || typeof max !== 'number') return false;
  // F14: require finite endpoints AND a finite positive width (min<max alone
  // admits {-1e308,1e308} whose width overflows to Infinity).
  if (!isFiniteRange(min, max)) return false;
  return true;
}

/**
 * Derive normalisation range for a factor node.
 *
 * 7-tier priority chain (per Schema v2.6 §B.8, extended):
 *
 * | Priority | Source label       | Formula / Rule                                            |
 * |----------|--------------------|-----------------------------------------------------------|
 * | 0        | `explicit_cap`     | `observed_state.cap` (CEE-set authoritative scale cap).   |
 * |          |                    | Range: [0, cap]. Requires cap > 0.                       |
 * | 1        | `explicit`         | `state_space.range` (user-confirmed). Requires max > min. |
 * | 1.5      | `extracted`        | `intervention_hints.extracted_range` from CE extraction.  |
 * | 1.75     | `inferred_spread`  | min/max of intervention values across options + 20%       |
 * |          |                    | padding. Requires ≥2 values with variation.               |
 * |          |                    | Outlier guard: skipped if maxVal > minVal × 100.          |
 * |          |                    | Lower bound clamped to 0 when all values non-negative.    |
 * | 2        | `inferred_baseline`| `[min(0,2b,2v), max(0,2b,2v)]` over baseline b and (when   |
 * |          |                    | finite) current value v. Sign-preserving AND CONTAINS     |
 * |          |                    | BOTH (D-9): opposite-sign b/v both round-trip (e.g.       |
 * |          |                    | b=-500,v=+600 → `[-1000,1200]`). Same-sign/single reduces |
 * |          |                    | to `[0,2r]` (r≥0) / `[2r,0]` (r<0), unchanged.            |
 * | 3        | `inferred_value`   | `[min(0,2v), max(0,2v)]`, sign-preserving (D-9). Falls    |
 * |          |                    | through if value is 0.                                    |
 * | 4        | `default`          | `[0, 1]`. Used when value is 0, missing, or unavailable.  |
 *
 * @param node Factor node
 * @param hints Optional intervention hints from CE
 * @param interventionValues Optional array of intervention values for this factor across options
 * @returns Normalisation range with source indicator (see RangeSource type)
 */
export function deriveRange(
  node: EngineNodeV3,
  hints?: InterventionHints,
  interventionValues?: number[]
): NormalisationRange {
  const stateSpace = node.state_space;
  const observedState = node.observed_state;

  // Priority 0: Explicit cap from observed_state
  // Authoritative scale cap set by CEE (e.g., goal node with cap=1000 means value=200 → 0.2).
  // Takes precedence over state_space.range to ensure consistent normalisation
  // across both intervention (Phase 4a) and constraint (Phase 4b) paths.
  // F14: require a finite positive width at every source (isFiniteRange) so an
  // overflow-width range can never reach denormaliseValue — a rejected source
  // falls through to the next priority (ultimately the safe default [0,1]).
  if (typeof observedState?.cap === 'number' && observedState.cap > 0 && isFiniteRange(0, observedState.cap)) {
    return { min: 0, max: observedState.cap, source: 'explicit_cap' };
  }

  // Priority 1: Explicit state_space.range
  if (stateSpace?.range) {
    const { min, max } = stateSpace.range;
    if (typeof min === 'number' && typeof max === 'number' && isFiniteRange(min, max)) {
      return { min, max, source: 'explicit' };
    }
  }

  // Priority 1.5: CE extracted_range (from intervention_hints)
  if (hints && isValidExtractedRange(hints.extracted_range)) {
    const [min, max] = hints.extracted_range;
    return { min, max, source: 'extracted' };
  }

  // Priority 1.75: Intervention spread across options
  // Requires ≥2 intervention values to compute meaningful spread
  if (interventionValues && interventionValues.length >= 2) {
    // Sort values for consistent min/max calculation regardless of input order
    const sorted = interventionValues.slice().sort((a, b) => a - b);
    const minVal = sorted[0];
    const maxVal = sorted[sorted.length - 1];
    const spread = maxVal - minVal;

    // Only use spread if there's actual variation
    if (spread > 0) {
      // Outlier guard: skip spread if ratio is extreme (likely extraction error)
      // e.g., one option has £50k, another has £5m due to LLM hallucination
      if (minVal > 0 && maxVal > minVal * 100) {
        // Fall through to baseline/value inference
        // Extreme ratio detected - spread range would be unreliable
      } else {
        const padding = spread * 0.2;
        // Clamp lower bound to 0 when all intervention values are non-negative
        const paddedMin = minVal >= 0 ? Math.max(0, minVal - padding) : minVal - padding;
        const paddedMax = maxVal + padding;
        // F14: skip an overflow-width spread (e.g. values near ±1e308) — fall
        // through to baseline/value inference or the default.
        if (isFiniteRange(paddedMin, paddedMax)) {
          return { min: paddedMin, max: paddedMax, source: 'inferred_spread' };
        }
      }
    }
  }

  // Get current value and baseline
  const currentValue = observedState?.value;
  const baseline = observedState?.baseline;

  // Priority 2: Inferred from baseline and current value
  if (baseline !== undefined && typeof baseline === 'number') {
    // D-9 (CONTAIN BOTH, sign-preserving): the derived range must CONTAIN 0 AND
    // both the (doubled) baseline and the (doubled) current value, so a
    // negative-domain factor round-trips instead of clamping to 0 — AND an
    // OPPOSITE-SIGN baseline/currentValue pair (e.g. baseline=-500,
    // currentValue=+600) yields a range containing BOTH (-1000..1200), not just
    // the larger-magnitude one ({0,1200}, which erased -500). The earlier
    // larger-magnitude single-`ref` logic was incomplete for mixed signs.
    //   candidates = [0, 2·baseline] (+ 2·currentValue when finite)
    //   range = [min(candidates), max(candidates)]
    // Reduces to the prior behaviour for the same-sign / single-value cases:
    //   both ≥ 0 → [0, 2·max] · both < 0 → [2·min, 0] · single r → [min(0,2r), max(0,2r)]
    // (zero delta for positive-domain factors; unchanged for both-negative and
    // single-value). A baseline=0 with no currentValue collapses to {0,0} and
    // falls through to Priority 3/4 exactly as before (isFiniteRange width guard).
    const candidates = [0, 2 * baseline];
    if (currentValue !== undefined && Number.isFinite(currentValue)) {
      candidates.push(2 * currentValue);
    }
    const min = Math.min(...candidates);
    const max = Math.max(...candidates);
    // F14: only a finite POSITIVE-width range is usable (also rejects the {0,0}
    // baseline=0 no-currentValue collapse); fall through to value / default.
    if (isFiniteRange(min, max)) return { min, max, source: 'inferred_baseline' };
  }

  // Priority 3: Inferred from current value only
  if (currentValue !== undefined && typeof currentValue === 'number' && currentValue !== 0) {
    // D-9 (PRESERVE SIGN): range = [min(0,2v), max(0,2v)] — [0,2v] for v>0
    // (identical to the previous {0, 2×|v|}, zero delta for positive factors)
    // and [2v,0] for v<0 (e.g. v=-500 → {-1000,0}, so -500 → ~0.5 not clamp-to-0).
    const doubled = 2 * currentValue;
    const min = Math.min(0, doubled);
    const max = Math.max(0, doubled);
    // F14: skip an overflow-width inferred range; fall through to the default.
    if (isFiniteRange(min, max)) return { min, max, source: 'inferred_value' };
  }

  // Priority 4: Default [0, 1]
  return { min: 0, max: 1, source: 'default' };
}

// -----------------------------------------------------------------------------
// Normalisation Functions
// -----------------------------------------------------------------------------

/**
 * Normalise a value to [0, 1] given a range.
 *
 * Formula: normalised = (value - min) / (max - min)
 *
 * Edge cases:
 * - Zero-width range (min == max): return 0.5 (midpoint)
 * - Value outside range: clamp to [0, 1]
 *
 * @param value Raw value to normalise
 * @param range Normalisation range
 * @returns Normalised value in [0, 1]
 */
export function normaliseValue(value: number, range: NormalisationRange): { normalised: number; clamped: boolean } {
  const { min, max } = range;
  const rangeWidth = max - min;

  // Edge case: zero-width range
  if (rangeWidth <= 0) {
    // If value equals the single point, return 0.5 (midpoint of [0,1])
    // Otherwise, use value / max if max > 0, else 0
    if (max > 0) {
      const normalised = Math.min(1, Math.max(0, value / max));
      return { normalised, clamped: value !== max };
    }
    return { normalised: 0.5, clamped: false };
  }

  // Standard normalisation
  const raw = (value - min) / rangeWidth;

  // Clamp to [0, 1]
  const clamped = raw < 0 || raw > 1;
  const normalised = Math.min(1, Math.max(0, raw));

  return { normalised, clamped };
}

/**
 * Denormalise a value from [0, 1] back to original units.
 *
 * Formula: original = normalised × (max - min) + min
 *
 * @param normalised Normalised value in [0, 1]
 * @param range Original normalisation range
 * @returns Denormalised value in original units
 */
export function denormaliseValue(normalised: number, range: NormalisationRange): number {
  const { min, max } = range;
  const rangeWidth = max - min;

  // Edge case: zero-width range
  if (rangeWidth <= 0) {
    // Return the single point
    return max;
  }

  return normalised * rangeWidth + min;
}

// -----------------------------------------------------------------------------
// Context Building
// -----------------------------------------------------------------------------

/**
 * Collect intervention values per factor from all options.
 * Returns a map of factor ID to array of intervention values.
 */
function collectInterventionValues(options: OptionV3[]): Map<string, number[]> {
  const valuesByFactor = new Map<string, number[]>();

  for (const option of options) {
    for (const [factorId, intervention] of Object.entries(option.interventions)) {
      const existing = valuesByFactor.get(factorId) ?? [];
      existing.push(intervention.value);
      valuesByFactor.set(factorId, existing);
    }
  }

  return valuesByFactor;
}

/**
 * Build normalisation context from graph nodes.
 *
 * Creates contexts for all factor nodes that might be intervention targets
 * or the goal node.
 *
 * @param nodes Graph nodes
 * @param goalNodeId Goal node ID
 * @param interventionHints Optional map of factor ID to intervention hints from CE
 * @param options Optional options array for intervention spread calculation
 * @returns Normalisation context
 */
export function buildNormalisationContext(
  nodes: EngineNodeV3[],
  goalNodeId: string,
  interventionHints?: Map<string, InterventionHints>,
  options?: OptionV3[]
): NormalisationContext {
  const factors = new Map<string, FactorNormalisationContext>();
  let goalContext: FactorNormalisationContext | undefined;

  // Collect intervention values per factor for spread calculation
  const interventionValuesByFactor = options ? collectInterventionValues(options) : new Map();

  for (const node of nodes) {
    // Only build context for factors and the goal node
    // Skip non-causal nodes (option, decision, etc.) to avoid spurious normalisation
    const isGoalNode = node.id === goalNodeId;
    const isFactorNode = node.kind === 'factor';

    if (!isGoalNode && !isFactorNode) {
      continue;
    }

    // Get hints for this factor if available
    const hints = interventionHints?.get(node.id);
    // Get intervention values for spread calculation
    const interventionValues = interventionValuesByFactor.get(node.id);
    const range = deriveRange(node, hints, interventionValues);
    const baseline = node.observed_state?.baseline ?? node.observed_state?.value ?? 0;

    const context: FactorNormalisationContext = {
      factor_id: node.id,
      range,
      baseline,
    };

    factors.set(node.id, context);

    // Track goal node context separately for outcome denormalisation
    if (isGoalNode) {
      goalContext = context;
    }
  }

  return {
    factors,
    goal_node_id: goalNodeId,
    goal_context: goalContext,
  };
}

// -----------------------------------------------------------------------------
// Option Normalisation
// -----------------------------------------------------------------------------

/**
 * Build fallback ranges from intervention values for factors without context.
 *
 * When a factor has no normalisation context (no observed_state, no state_space.range),
 * we derive a range from the intervention values themselves to avoid collapsing
 * distinct values to the same normalised result.
 *
 * Range: [0, 2 × max(|intervention values|)]
 *
 * @param options Options with intervention values
 * @param context Existing normalisation context
 * @returns Map of factor ID to inferred range
 */
function buildFallbackRanges(
  options: OptionV3[],
  context: NormalisationContext
): Map<string, NormalisationRange> {
  // Collect all intervention values by factor ID
  const valuesByFactor = new Map<string, number[]>();

  for (const option of options) {
    for (const [factorId, intervention] of Object.entries(option.interventions)) {
      // Only collect for factors without existing context
      if (!context.factors.has(factorId)) {
        const existing = valuesByFactor.get(factorId) ?? [];
        existing.push(intervention.value);
        valuesByFactor.set(factorId, existing);
      }
    }
  }

  // Build ranges from collected values
  const fallbackRanges = new Map<string, NormalisationRange>();

  for (const [factorId, values] of valuesByFactor) {
    // Use spread formula when ≥2 values with actual variation
    if (values.length >= 2) {
      // Sort values for consistent min/max calculation regardless of input order
      const sorted = values.slice().sort((a, b) => a - b);
      const minVal = sorted[0];
      const maxVal = sorted[sorted.length - 1];
      const spread = maxVal - minVal;

      if (spread > 0) {
        // Outlier guard: skip spread if ratio is extreme (likely extraction error)
        const isOutlier = minVal > 0 && maxVal > minVal * 100;
        if (!isOutlier) {
          const padding = spread * 0.2;
          // Clamp lower bound to 0 when all values are non-negative
          const paddedMin = minVal >= 0 ? Math.max(0, minVal - padding) : minVal - padding;
          const paddedMax = maxVal + padding;
          // F14: skip an overflow-width spread; fall through to the [0, 2×max]
          // fallback or the default [0,1] below.
          if (isFiniteRange(paddedMin, paddedMax)) {
            fallbackRanges.set(factorId, { min: paddedMin, max: paddedMax, source: 'inferred_spread' });
            continue;
          }
        }
        // Fall through to default range on extreme outlier / overflow
      }
    }

    // Fallback for single value, zero spread, or extreme outlier: [0, 2 × max(|values|)]
    const maxAbsValue = Math.max(...values.map(Math.abs));

    if (maxAbsValue > 0 && isFiniteRange(0, 2 * maxAbsValue)) {
      // Range: [0, 2 × max(|values|)] - ensures all values fit with headroom
      fallbackRanges.set(factorId, {
        min: 0,
        max: 2 * maxAbsValue,
        source: 'default', // Still 'default' source but with meaningful range
      });
    } else {
      // All values are zero, or an overflow-width inference (F14) — use [0, 1]
      fallbackRanges.set(factorId, { min: 0, max: 1, source: 'default' });
    }
  }

  return fallbackRanges;
}

/**
 * Round a number to 6 decimal places for stable diffs.
 */
function roundTo6Decimals(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Format reason string for intervention normalisation.
 * Format: "normalised range=[{min},{max}] source={range_source}"
 */
function formatNormalisationReason(range: NormalisationRange): string {
  const min = roundTo6Decimals(range.min);
  const max = roundTo6Decimals(range.max);
  return `normalised range=[${min},${max}] source=${range.source}`;
}

/**
 * Normalise all intervention values in options.
 *
 * When factors lack normalisation context (no observed_state, no state_space.range),
 * ranges are inferred from the intervention values themselves to ensure distinct
 * values produce distinct normalised results.
 *
 * @param options Original options with raw intervention values
 * @param context Normalisation context
 * @returns Normalised options, diagnostics, transforms, and repair records
 */
export function normaliseOptions(
  options: OptionV3[],
  context: NormalisationContext
): {
  options: OptionV3[];
  diagnostics: NormalisationDiagnostic[];
  transforms: Map<string, InterventionTransformRecord>;
  repairs: RepairRecord[];
} {
  const diagnostics: NormalisationDiagnostic[] = [];

  // Track transforms by factor ID (for deduplication)
  // Key: factor_id, Value: transform record
  const transforms = new Map<string, InterventionTransformRecord>();

  // Track first raw value seen for each factor (for repair records)
  const firstRawValueByFactor = new Map<string, number>();

  // Build fallback ranges for factors without context
  const fallbackRanges = buildFallbackRanges(options, context);

  const normalisedOptions: OptionV3[] = options.map(option => {
    const normalisedInterventions: Record<string, InterventionValueV3> = {};

    for (const [factorId, intervention] of Object.entries(option.interventions)) {
      const factorContext = context.factors.get(factorId);

      // Determine which range to use
      const range: NormalisationRange = factorContext
        ? factorContext.range
        : fallbackRanges.get(factorId) ?? { min: 0, max: 1, source: 'default' };

      const { normalised, clamped } = normaliseValue(intervention.value, range);

      normalisedInterventions[factorId] = {
        value: normalised,
        source: intervention.source,
      };

      diagnostics.push({
        option_id: option.id,
        factor_id: factorId,
        original_value: intervention.value,
        normalised_value: normalised,
        range,
        clamped,
      });

      // Track first raw value for this factor (for deduplicated repair record)
      if (!firstRawValueByFactor.has(factorId)) {
        firstRawValueByFactor.set(factorId, intervention.value);
      }

      // Only create one transform record per factor (dedupe by factor_id)
      if (!transforms.has(factorId)) {
        transforms.set(factorId, {
          factor_id: factorId,
          raw: roundTo6Decimals(intervention.value),
          normalised: roundTo6Decimals(normalised),
          range: { min: roundTo6Decimals(range.min), max: roundTo6Decimals(range.max) },
          range_source: range.source,
        });
      }
    }

    return {
      id: option.id,
      label: option.label,
      interventions: normalisedInterventions,
    };
  });

  // Build repair records from transforms (one per factor)
  // Include factor_id in field name for traceability: "intervention.value.{factor_id}"
  const repairs: RepairRecord[] = Array.from(transforms.values()).map(transform => ({
    field: `intervention.value.${transform.factor_id}`,
    action: 'normalised' as const,
    from_value: transform.raw,
    to_value: transform.normalised,
    reason: formatNormalisationReason({
      min: transform.range.min,
      max: transform.range.max,
      source: transform.range_source,
    }),
  }));

  return { options: normalisedOptions, diagnostics, transforms, repairs };
}

// -----------------------------------------------------------------------------
// Outcome Denormalisation
// -----------------------------------------------------------------------------

/**
 * Denormalise outcome statistics from ISL response.
 *
 * ISL returns outcomes in normalised [0,1] space. This function
 * transforms them back to the goal node's original units.
 *
 * @param outcome Normalised outcome stats from ISL
 * @param goalContext Goal node normalisation context
 * @returns Denormalised outcome stats
 */
/** @internal Not used in runtime — denormaliseISLResult handles this via denormaliseOptionResult. */
function denormaliseOutcome(
  outcome: OutcomeStatsV3,
  goalContext: FactorNormalisationContext
): OutcomeStatsV3 {
  const range = goalContext.range;

  return {
    mean: denormaliseValue(outcome.mean, range),
    std: outcome.std !== undefined
      ? outcome.std * (range.max - range.min) // Scale std by range width
      : undefined,
    p10: denormaliseValue(outcome.p10, range),
    p50: denormaliseValue(outcome.p50, range),
    p90: denormaliseValue(outcome.p90, range),
    n_samples: outcome.n_samples,
    n_valid_samples: outcome.n_valid_samples,
    validity_ratio: outcome.validity_ratio,
  };
}

/**
 * Denormalise a single expected outcome value.
 *
 * @param expectedOutcome Normalised expected outcome
 * @param goalContext Goal node normalisation context
 * @returns Denormalised expected outcome
 */
/** @internal Not used in runtime — denormaliseISLResult handles this via denormaliseOptionResult. */
function denormaliseExpectedOutcome(
  expectedOutcome: number,
  goalContext: FactorNormalisationContext
): number {
  return denormaliseValue(expectedOutcome, goalContext.range);
}

/**
 * Denormalise a confidence interval.
 *
 * @param interval Normalised confidence interval [p10, p90]
 * @param goalContext Goal node normalisation context
 * @returns Denormalised confidence interval
 */
/** @internal Not used in runtime — denormaliseISLResult handles this via denormaliseOptionResult. */
function denormaliseConfidenceInterval(
  interval: [number, number],
  goalContext: FactorNormalisationContext
): [number, number] {
  return [
    denormaliseValue(interval[0], goalContext.range),
    denormaliseValue(interval[1], goalContext.range),
  ];
}

// -----------------------------------------------------------------------------
// Full Request/Response Transformation
// -----------------------------------------------------------------------------

/**
 * Full result from normaliseOptionsForISL including repair records.
 */
export interface NormalisationResult {
  options: OptionV3[];
  context: NormalisationContext;
  diagnostics: NormalisationDiagnostic[];
  /** Intervention transforms by factor ID */
  transforms: Map<string, InterventionTransformRecord>;
  /** Repair records for _meta.repairs_applied (one per factor) */
  repairs: RepairRecord[];
}

/**
 * Normalise options for ISL call.
 *
 * Entry point for normalisation. Returns normalised options and context
 * needed for later denormalisation of outcomes.
 *
 * @param options Original options with raw intervention values
 * @param nodes Graph nodes (for building normalisation context)
 * @param goalNodeId Goal node ID
 * @param interventionHints Optional map of factor ID to intervention hints from CE
 * @returns Normalised options, context, diagnostics, transforms, and repair records
 */
export function normaliseOptionsForISL(
  options: OptionV3[],
  nodes: EngineNodeV3[],
  goalNodeId: string,
  interventionHints?: Map<string, InterventionHints>
): NormalisationResult {
  // Pass options to context builder for intervention spread calculation
  const context = buildNormalisationContext(nodes, goalNodeId, interventionHints, options);
  const { options: normalisedOptions, diagnostics, transforms, repairs } = normaliseOptions(options, context);

  return {
    options: normalisedOptions,
    context,
    diagnostics,
    transforms,
    repairs,
  };
}

/**
 * Check if normalisation is needed for the given options.
 *
 * Returns true if any intervention value is outside [0, 1].
 * This allows skipping normalisation when values are already normalised.
 *
 * @param options Options to check
 * @returns True if normalisation is needed
 */
export function needsNormalisation(options: OptionV3[]): boolean {
  for (const option of options) {
    for (const intervention of Object.values(option.interventions)) {
      const value = intervention.value;
      if (value < 0 || value > 1) {
        return true;
      }
    }
  }
  return false;
}

// -----------------------------------------------------------------------------
// ISL Result Denormalisation
// -----------------------------------------------------------------------------

/**
 * ISL option result with outcome data.
 * Matches the shape returned by ISL /api/v1/robustness/analyze/v2
 */
interface ISLOptionResult {
  option_id?: string;
  id?: string;
  expected_outcome?: number;
  confidence_interval?: [number, number];
  outcome?: {
    mean: number;
    std?: number;
    p10: number;
    p50: number;
    p90: number;
    n_samples?: number;
    n_valid_samples?: number;
    validity_ratio?: number;
  };
  [key: string]: unknown;
}

/**
 * ISL result shape for robustness analysis.
 */
interface ISLResult {
  options?: ISLOptionResult[];
  results?: ISLOptionResult[]; // V1 compatibility
  [key: string]: unknown;
}

/**
 * Denormalise ISL result outcomes back to user units.
 *
 * Transforms all outcome values (mean, p10, p50, p90, expected_outcome,
 * confidence_interval) from [0,1] back to the goal node's original units.
 *
 * @param islResult ISL result with normalised outcomes
 * @param context Normalisation context (must include goal_context)
 * @returns ISL result with denormalised outcomes (new object, doesn't mutate input)
 */
export function denormaliseISLResult(
  islResult: ISLResult,
  context: NormalisationContext
): ISLResult {
  // No goal context means we can't denormalise
  if (!context.goal_context) {
    return islResult;
  }

  const goalContext = context.goal_context;
  const range = goalContext.range;

  // Clone the result to avoid mutation
  const result: ISLResult = { ...islResult };

  // Process options array (ISL V2 format)
  if (Array.isArray(result.options)) {
    result.options = result.options.map(opt => denormaliseOptionResult(opt, range));
  }

  // Process results array (ISL V1 format)
  if (Array.isArray(result.results)) {
    result.results = result.results.map(opt => denormaliseOptionResult(opt, range));
  }

  return result;
}

/**
 * Denormalise a single option result.
 */
function denormaliseOptionResult(
  opt: ISLOptionResult,
  range: NormalisationRange
): ISLOptionResult {
  const denormalised: ISLOptionResult = { ...opt };

  // Denormalise expected_outcome
  if (typeof opt.expected_outcome === 'number') {
    denormalised.expected_outcome = denormaliseValue(opt.expected_outcome, range);
  }

  // Denormalise confidence_interval
  if (Array.isArray(opt.confidence_interval) && opt.confidence_interval.length === 2) {
    denormalised.confidence_interval = [
      denormaliseValue(opt.confidence_interval[0], range),
      denormaliseValue(opt.confidence_interval[1], range),
    ];
  }

  // Denormalise full outcome stats
  if (opt.outcome && typeof opt.outcome === 'object') {
    const rangeWidth = range.max - range.min;

    denormalised.outcome = {
      ...opt.outcome,
      mean: denormaliseValue(opt.outcome.mean, range),
      p10: denormaliseValue(opt.outcome.p10, range),
      p50: denormaliseValue(opt.outcome.p50, range),
      p90: denormaliseValue(opt.outcome.p90, range),
      // Scale std by range width
      std: opt.outcome.std !== undefined ? opt.outcome.std * rangeWidth : undefined,
    };
  }

  return denormalised;
}

// -----------------------------------------------------------------------------
// Goal Constraint Normalisation
// -----------------------------------------------------------------------------

import type { GoalConstraint } from '../types/engine-v3.js';

/**
 * Normalised goal constraint with original value preserved.
 */
export interface NormalisedGoalConstraint extends GoalConstraint {
  /** Original value in user units (before normalisation) */
  original_value: number;
}

/**
 * Node-level goal-threshold metadata (P0-C1).
 *
 * CEE stamps these on the RAW upstream node (`goal_threshold` already
 * normalised to [0,1], `goal_threshold_cap` = the scale it was normalised
 * against, e.g. 100 for '%'). The canonical EngineNodeV3 does not carry them,
 * so the route captures them from `body.graph.nodes` and passes them in here.
 */
export interface GoalThresholdNodeMeta {
  /** Already-normalised threshold in [0,1], stamped by CEE */
  goal_threshold?: number;
  /** Scale cap the raw user threshold was normalised against (e.g. 100 for '%') */
  goal_threshold_cap?: number;
}

/**
 * Producer-declared scale signals for constraint normalisation (P0-C1).
 * Both are additive/optional — omitting them reproduces the legacy behaviour.
 */
export interface ConstraintNormalisationExtras {
  /**
   * Unit per constraint_id, captured from the raw client/compiled constraints
   * BEFORE the ISL-boundary strip (the temporal filter removes `unit`).
   */
  unitsByConstraintId?: Map<string, string>;
  /** Raw-node goal-threshold metadata per node_id */
  goalThresholdMetaByNodeId?: Map<string, GoalThresholdNodeMeta>;
  /**
   * The EXACT normalisation range each node's INTERVENTIONS were scaled against
   * in Phase 4a (keyed by node_id). This is the scale the ISL samples for that
   * node actually occupy, so the constraint threshold on the same node MUST be
   * normalised against the identical range — otherwise ISL compares a threshold
   * and samples that live on two different scales (the A3 range-split defect:
   * a violated cap scored probability 1; margins were on a phantom width).
   *
   * When present for a node, this range OVERRIDES the constraint-side derivation
   * chain (including producer-declared caps) — see the DOCTRINE-PENDING note in
   * normaliseGoalConstraints. A node whose interventions were forwarded raw
   * ([0,1] gate skipped) is carried here as an identity [0,1] range so the
   * threshold stays on the same raw sample scale rather than being independently
   * re-normalised via a node heuristic.
   */
  interventionScaleByNodeId?: Map<string, NormalisationRange>;
  /**
   * Whether the caller's global `constraintsNeedNormalisation` gate fired. When
   * TRUE (or unset — the default preserves every direct-unit-test caller), a
   * constraint on a node WITHOUT an intervention scale is normalised through the
   * existing derivation chain, exactly as before. When explicitly FALSE, that
   * same constraint is forwarded raw (its value is already in [0,1] by
   * definition of the gate), so only constraints on intervened nodes with a
   * NON-identity scale are transformed. This keeps behaviour byte-identical for
   * constraints on non-intervened nodes across every gate combination.
   */
  normaliseWithoutScale?: boolean;
}

/**
 * True when a constraint unit means "percent" (house doctrine: '%' always
 * normalises against 100).
 */
export function isPercentUnit(unit: string | undefined): boolean {
  if (typeof unit !== 'string') return false;
  const u = unit.trim().toLowerCase();
  return u === '%' || u === 'percent' || u === 'pct' || u === 'percentage';
}

/**
 * Tolerance (on the normalised [0,1] scale) for treating the node's
 * CEE-stamped goal_threshold as "the same target" as the re-normalised raw
 * constraint value. Wide enough to absorb producer rounding (4 dp), narrow
 * enough that a genuinely changed target (e.g. 25% vs a stale 0.2 stamp) is
 * NOT silently overridden by the stale stamp.
 */
const GOAL_THRESHOLD_CORRESPONDENCE_TOLERANCE = 1e-3;

/**
 * Result of constraint normalisation.
 */
export interface ConstraintNormalisationResult {
  /** Normalised constraints */
  constraints: NormalisedGoalConstraint[];
  /** Repair records for auditing */
  repairs: RepairRecord[];
  /** Diagnostics for logging */
  diagnostics: Array<{
    constraint_id: string;
    node_id: string;
    original_value: number;
    normalised_value: number;
    range: NormalisationRange;
    used_heuristic: boolean;
    /**
     * True when the raw threshold fell OUTSIDE the normalisation range and was
     * clamped onto [0,1] (Codex F2a). The clamp DIRECTION is read from
     * normalised_value at egress (0 ⇒ clamped at the range floor, 1 ⇒ at the
     * ceiling). A clamped threshold makes the emitted failure_margin a strict
     * bound, not an exact distance — the margin egress consults this so it never
     * labels an understated margin 'exact'.
     */
    clamped: boolean;
    /**
     * A3 R1: recorded at ladder-decision time (here — where BOTH the resolved
     * range and the node's intervention scale are in hand), so the trust marker
     * can PROJECT it rather than re-derive it 700 lines away. TRUE when the
     * threshold's scale did NOT diverge from the node's producer-declared scale:
     * a measured (non-identity) intervention spread was adopted as the threshold
     * scale (ladder branch 1) AND a producer declared a DIFFERENT scale
     * (goal_threshold_cap / '%') for the same node. NUMERIC-equality test — equal
     * bounds are the SAME scale (no divergence). No producer declaration, an
     * identity (assumed) intervention scale, or no intervention scale ⇒ TRUE
     * (nothing to diverge from).
     */
    range_unified: boolean;
    /** True when the node's CEE-stamped goal_threshold was preferred (P0-C1) */
    used_node_goal_threshold?: boolean;
  }>;
}

/**
 * Normalise goal constraint values to [0,1] space.
 *
 * Uses the same deriveRange() function as interventions, resolved through a
 * measurement/producer priority ladder (F4, Codex-confirmed reorder). This
 * header MIRRORS the authoritative inline `Derive range` comment in the loop
 * body below — keep the two in sync:
 *
 * | Priority | Source                            | Rule                                             |
 * |----------|-----------------------------------|--------------------------------------------------|
 * | 1        | `interventionScale` (NON-identity)| A MEASURED sample spread is ground truth; the    |
 * |          |                                   | threshold shares the exact scale its samples     |
 * |          |                                   | occupy. Wins even over a producer cap (DOCTRINE- |
 * |          |                                   | PENDING).                                        |
 * | 2        | forward-raw                       | Gate FALSE + no intervention scale ⇒ value       |
 * |          |                                   | already in [0,1]; forwarded verbatim (HEAD       |
 * |          |                                   | parity, F1). Outranks producers.                 |
 * | 3        | `goal_threshold_cap`              | Producer-declared. Node's CEE-stamped cap.       |
 * |          |                                   | Range [0, cap].                                  |
 * | 4        | `unit_percent`                    | Producer-declared. Constraint unit is '%'.       |
 * |          |                                   | Range [0, 100] (house doctrine).                 |
 * | 5        | `interventionScale` (IDENTITY)    | Phase-4a-skipped ASSUMED [0,1] scale; ranks      |
 * |          |                                   | below producer declarations, above the heuristic.|
 * | 6        | deriveRange(node)                 | Existing chain (explicit_cap → … → default).     |
 *
 * Additionally, when the node carries a CEE-stamped, already-normalised
 * finite `goal_threshold` in [0,1] that corresponds to the same target
 * (|value/cap − goal_threshold| ≤ 1e-3 under a producer-declared cap), the
 * stamp is PREFERRED over re-normalising the raw client value — CEE is the
 * producer of both numbers, so its normalisation is authoritative and free of
 * re-derivation drift. A stamp that does NOT correspond (e.g. stale after the
 * user changed the target) is ignored.
 *
 * Preserves original user-unit value for response denormalisation.
 *
 * @param constraints Goal constraints to normalise
 * @param nodes Graph nodes (for range derivation)
 * @param extras Producer-declared scale signals (units, node goal-threshold metadata)
 * @returns Normalised constraints with original values preserved
 */
export function normaliseGoalConstraints(
  constraints: GoalConstraint[],
  nodes: EngineNodeV3[],
  extras?: ConstraintNormalisationExtras
): ConstraintNormalisationResult {
  const repairs: RepairRecord[] = [];
  const diagnostics: ConstraintNormalisationResult['diagnostics'] = [];
  const normalisedConstraints: NormalisedGoalConstraint[] = [];

  // Build node lookup map
  const nodeMap = new Map<string, EngineNodeV3>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  // Loop-invariant (does not vary per constraint). Default TRUE so every existing
  // caller (unit tests, code paths that omit the flag) keeps the pre-fix chain
  // behaviour for scale-less constraints.
  const applyChainWithoutScale = extras?.normaliseWithoutScale ?? true;

  for (const constraint of constraints) {
    const { constraint_id, node_id, operator, value, label, weight } = constraint;

    // Find target node
    const targetNode = nodeMap.get(node_id);

    // Producer-declared scale signals (P0-C1)
    const nodeMeta = extras?.goalThresholdMetaByNodeId?.get(node_id);
    const unit = extras?.unitsByConstraintId?.get(constraint_id);
    const nodeCap = nodeMeta?.goal_threshold_cap;

    // The scale this node's INTERVENTIONS were normalised against (Phase 4a).
    const interventionScale = extras?.interventionScaleByNodeId?.get(node_id);
    // An IDENTITY [0,1] intervention scale is the route's marker for "this node
    // was intervened while Phase 4a was SKIPPED" (all interventions already in
    // [0,1]) — it is an ASSUMPTION, not a measured spread. A NON-identity scale
    // is a measured ground-truth spread. The two rank very differently below.
    const interventionScaleIsIdentity =
      interventionScale !== undefined && isIdentityRange(interventionScale);

    // Derive range. Priority ladder (F4, Codex-confirmed reorder):
    //   1  interventionScale, NON-identity — a MEASURED spread is ground truth;
    //      the threshold MUST share the exact scale its samples occupy
    //      (A3 range-unify). Wins even over a producer cap (DOCTRINE-PENDING).
    //   2  forward-raw — gate FALSE + no intervention scale ⇒ value already in
    //      [0,1] ⇒ leave it untouched (HEAD parity, F1). MUST outrank producers.
    //   3  goal_threshold_cap  (producer-declared)   ]  a producer DECLARATION
    //   4  unit_percent        (producer-declared)   ]  outranks an ASSUMED
    //                                                    identity scale (F4).
    //   5  interventionScale, IDENTITY — the Phase-4a-skipped assumption; ranks
    //      BELOW producer declarations, ABOVE the node heuristic, so the
    //      core no-producer-metadata combos stay unchanged.
    //   6  deriveRange(node)   (existing chain: explicit_cap → … → default)
    // If node not found and no declared scale, use default [0,1].
    let range: NormalisationRange;
    // Forwarded-raw ⇒ value is already in [0,1] (the global gate was FALSE) and
    // this node has no intervention scale: leave it untouched, emit no repair.
    let forwardedRawUnchanged = false;
    if (interventionScale && !interventionScaleIsIdentity) {
      // DOCTRINE-PENDING: when a node carries BOTH a MEASURED intervention spread
      // scale and a producer-declared cap (goal_threshold_cap / '%' / explicit_cap
      // / state_space.range) and the two DISAGREE, this fix picks the
      // intervention-side range — it is the scale the ISL samples actually live
      // on, so it is the only choice that keeps threshold and samples
      // comparable. WHICH of the two should be authoritative when they diverge
      // is an unratified doctrine call (owner: A3 lead). Sameness is the
      // invariant here; the pick is provisional. (F4: this branch is now gated on
      // NON-identity — an identity scale is an assumption, demoted to branch 5.)
      range = interventionScale;
    } else if (!applyChainWithoutScale) {
      // F1 (adversarial review): the global gate did NOT fire and this node has
      // NO intervention scale ⇒ the value is already in [0,1] by definition of
      // the gate; forward it verbatim (identity). This decision MUST precede the
      // producer goal_threshold_cap / '%' branches below: at HEAD the function
      // was NOT called for a constraint on a non-intervened node when the gate
      // was false, so a producer cap or '%' unit on such a node must NOT drag the
      // value through a normalisation HEAD never applied (e.g. '%' value 0.5 →
      // 0.005, a new repair, margin denorm ×100). Restores exact HEAD parity for
      // non-intervened nodes in the gate-false + some-other-node-has-a-scale
      // combo. When the gate IS true (or unset — every direct-unit-test caller),
      // this branch is skipped and the producer/chain branches apply as before.
      range = { min: 0, max: 1, source: 'default' };
      forwardedRawUnchanged = true;
    } else if (typeof nodeCap === 'number' && Number.isFinite(nodeCap) && nodeCap > 0) {
      range = { min: 0, max: nodeCap, source: 'goal_threshold_cap' };
    } else if (isPercentUnit(unit)) {
      range = { min: 0, max: 100, source: 'unit_percent' };
    } else if (interventionScale) {
      // F4 branch 5: an IDENTITY [0,1] intervention scale (Phase 4a skipped for
      // this intervened node). Reached only when no producer '%'/cap declared it
      // (those are handled above). Keeps the threshold on the SAME raw sample
      // scale the interventions occupy, rather than independently re-deriving a
      // node heuristic. (interventionScaleIsIdentity is necessarily true here.)
      range = interventionScale;
    } else {
      range = targetNode
        ? deriveRange(targetNode)
        : { min: 0, max: 1, source: 'default' };
    }

    // A3 R1 (false-divergence fix): decide range_unified HERE, at ladder-decision
    // time, and record it in the diagnostic — the trust marker then PROJECTS it
    // (no re-derivation from inputs 700 lines away). Divergence — range_unified
    // FALSE — arises ONLY when a MEASURED (non-identity) intervention spread was
    // adopted as the threshold scale (branch 1) while a producer declared a
    // scale (goal_threshold_cap / '%') for the same node AND the two scales
    // DIFFER NUMERICALLY. Equal bounds are the SAME scale ⇒ the threshold sits on
    // the samples' scale ⇒ NO divergence (the bug this fixes assumed divergence on
    // mere co-presence). No producer declaration, an identity (assumed) scale, or
    // no intervention scale ⇒ nothing to diverge from ⇒ TRUE.
    const producerDeclaredRange: NormalisationRange | undefined =
      typeof nodeCap === 'number' && Number.isFinite(nodeCap) && nodeCap > 0
        ? { min: 0, max: nodeCap, source: 'goal_threshold_cap' }
        : isPercentUnit(unit)
          ? { min: 0, max: 100, source: 'unit_percent' }
          : undefined;
    const rangeUnified =
      interventionScale === undefined ||
      interventionScaleIsIdentity ||
      producerDeclaredRange === undefined ||
      rangesEqual(interventionScale, producerDeclaredRange);

    // Normalise value
    let { normalised, clamped } = normaliseValue(value, range);

    // Prefer the node's CEE-stamped, already-normalised goal_threshold when it
    // corresponds to the same target under a producer-declared cap.
    let usedNodeGoalThreshold = false;
    const nodeGoalThreshold = nodeMeta?.goal_threshold;
    if (
      (range.source === 'goal_threshold_cap' || range.source === 'unit_percent') &&
      typeof nodeGoalThreshold === 'number' &&
      Number.isFinite(nodeGoalThreshold) &&
      nodeGoalThreshold >= 0 && nodeGoalThreshold <= 1 &&
      Math.abs(normalised - nodeGoalThreshold) <= GOAL_THRESHOLD_CORRESPONDENCE_TOLERANCE
    ) {
      normalised = nodeGoalThreshold;
      clamped = false;
      usedNodeGoalThreshold = true;
    }

    // Track if we used a heuristic (non-producer-declared range)
    const NON_HEURISTIC_SOURCES: ReadonlySet<RangeSource> = new Set<RangeSource>([
      'explicit', 'explicit_cap', 'goal_threshold_cap', 'unit_percent',
    ]);
    const usedHeuristic = !NON_HEURISTIC_SOURCES.has(range.source);

    // Create normalised constraint
    const normalisedConstraint: NormalisedGoalConstraint = {
      constraint_id,
      node_id,
      operator,
      value: normalised,
      original_value: value,
      label,
      weight,
    };
    normalisedConstraints.push(normalisedConstraint);

    // A forwarded-raw constraint (gate FALSE, no intervention scale) is an
    // identity no-op — skip BOTH the repair record AND the diagnostic so the
    // response stays byte-identical to the pre-fix "gate false ⇒ no constraint
    // normalisation" path. (A synthetic 'default'-range diagnostic emitted here
    // would trip constraint-reliability.ts's threshold_normalisation_defaulted
    // and SUPPRESS a constraint that HEAD delivered; and no diagnostic ⇒ no
    // constraintNormalisationRanges entry ⇒ the reliability gate and margin
    // denorm behave exactly as before.)
    if (!forwardedRawUnchanged) {
      // Add repair record.
      repairs.push({
        field: `constraint.value.${constraint_id}`,
        action: 'normalised',
        from_value: value,
        to_value: normalised,
        reason: `normalised range=[${range.min},${range.max}] source=${range.source}${clamped ? ' (clamped)' : ''}${usedNodeGoalThreshold ? ' (node goal_threshold preferred)' : ''}`,
      });
      // Add diagnostic.
      diagnostics.push({
        constraint_id,
        node_id,
        original_value: value,
        normalised_value: normalised,
        range,
        used_heuristic: usedHeuristic,
        // F2a: carry whether the threshold clamped. When the CEE goal_threshold
        // stamp was preferred, `clamped` was reset to false above (the stamp is
        // an exact in-[0,1] value, no clamp), so this is correct in that branch too.
        clamped,
        // A3 R1: the scale-unity decision, recorded for the trust marker to project.
        range_unified: rangeUnified,
        ...(usedNodeGoalThreshold && { used_node_goal_threshold: true }),
      });
    }

    // Heuristic use is captured in diagnostics[].used_heuristic and repair records.
  }

  return {
    constraints: normalisedConstraints,
    repairs,
    diagnostics,
  };
}

/**
 * Check if constraint normalisation is needed.
 *
 * Returns true if any constraint value is outside [0, 1].
 *
 * @param constraints Constraints to check
 * @returns True if normalisation is needed
 */
export function constraintsNeedNormalisation(constraints: GoalConstraint[]): boolean {
  for (const constraint of constraints) {
    if (constraint.value < 0 || constraint.value > 1) {
      return true;
    }
  }
  return false;
}
