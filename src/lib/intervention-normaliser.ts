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
 * Validate an extracted range from CE.
 * Returns true if the range is valid for normalisation.
 */
function isValidExtractedRange(range: [number, number] | undefined): range is [number, number] {
  if (!Array.isArray(range) || range.length !== 2) return false;
  const [min, max] = range;
  if (typeof min !== 'number' || typeof max !== 'number') return false;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return false;
  if (min >= max) return false;
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
 * | 2        | `inferred_baseline`| `[0, 2 × max(|baseline|, |value|)]`.                     |
 * | 3        | `inferred_value`   | `[0, 2 × |value|]`. Falls through if value is 0.          |
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
  if (typeof observedState?.cap === 'number' && observedState.cap > 0) {
    return { min: 0, max: observedState.cap, source: 'explicit_cap' };
  }

  // Priority 1: Explicit state_space.range
  if (stateSpace?.range) {
    const { min, max } = stateSpace.range;
    if (typeof min === 'number' && typeof max === 'number' && max > min) {
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
        return {
          min: paddedMin,
          max: maxVal + padding,
          source: 'inferred_spread',
        };
      }
    }
  }

  // Get current value and baseline
  const currentValue = observedState?.value;
  const baseline = observedState?.baseline;

  // Priority 2: Inferred from baseline and current value
  if (baseline !== undefined && typeof baseline === 'number') {
    // Use baseline as reference point
    // Range: [0, 2 × max(|baseline|, |currentValue|)]
    const maxAbsValue = Math.max(
      Math.abs(baseline),
      currentValue !== undefined ? Math.abs(currentValue) : 0
    );

    if (maxAbsValue > 0) {
      const max = 2 * maxAbsValue;
      return { min: 0, max, source: 'inferred_baseline' };
    }
  }

  // Priority 3: Inferred from current value only
  if (currentValue !== undefined && typeof currentValue === 'number' && currentValue !== 0) {
    // Range: [0, 2 × |currentValue|]
    const max = 2 * Math.abs(currentValue);
    return { min: 0, max, source: 'inferred_value' };
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
          fallbackRanges.set(factorId, {
            min: paddedMin,
            max: maxVal + padding,
            source: 'inferred_spread',
          });
          continue;
        }
        // Fall through to default range on extreme outlier
      }
    }

    // Fallback for single value, zero spread, or extreme outlier: [0, 2 × max(|values|)]
    const maxAbsValue = Math.max(...values.map(Math.abs));

    if (maxAbsValue > 0) {
      // Range: [0, 2 × max(|values|)] - ensures all values fit with headroom
      fallbackRanges.set(factorId, {
        min: 0,
        max: 2 * maxAbsValue,
        source: 'default', // Still 'default' source but with meaningful range
      });
    } else {
      // All values are zero - use [0, 1]
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
    /** True when the node's CEE-stamped goal_threshold was preferred (P0-C1) */
    used_node_goal_threshold?: boolean;
  }>;
}

/**
 * Normalise goal constraint values to [0,1] space.
 *
 * Uses the same deriveRange() function as interventions, extended with two
 * producer-declared constraint scales (P0-C1) that outrank the node-derived
 * chain:
 *
 * | Priority | Source               | Rule                                            |
 * |----------|----------------------|-------------------------------------------------|
 * | 0        | `goal_threshold_cap` | Node's CEE-stamped cap. Range [0, cap].         |
 * | 1        | `unit_percent`       | Constraint unit is '%'. Range [0, 100] (house   |
 * |          |                      | doctrine: '%' always normalises against 100).   |
 * | 2+       | deriveRange(node)    | Existing chain (explicit_cap → … → default).    |
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

  for (const constraint of constraints) {
    const { constraint_id, node_id, operator, value, label, weight } = constraint;

    // Find target node
    const targetNode = nodeMap.get(node_id);

    // Producer-declared scale signals (P0-C1)
    const nodeMeta = extras?.goalThresholdMetaByNodeId?.get(node_id);
    const unit = extras?.unitsByConstraintId?.get(constraint_id);
    const nodeCap = nodeMeta?.goal_threshold_cap;

    // Derive range. Producer-declared constraint scales outrank the
    // node-derived chain; deriveRange() handles observed_state.cap as
    // priority 0 (explicit_cap), then state_space.range → heuristics → [0,1].
    // If node not found and no declared scale, use default [0,1].
    let range: NormalisationRange;
    if (typeof nodeCap === 'number' && Number.isFinite(nodeCap) && nodeCap > 0) {
      range = { min: 0, max: nodeCap, source: 'goal_threshold_cap' };
    } else if (isPercentUnit(unit)) {
      range = { min: 0, max: 100, source: 'unit_percent' };
    } else {
      range = targetNode
        ? deriveRange(targetNode)
        : { min: 0, max: 1, source: 'default' };
    }

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

    // Add repair record
    repairs.push({
      field: `constraint.value.${constraint_id}`,
      action: 'normalised',
      from_value: value,
      to_value: normalised,
      reason: `normalised range=[${range.min},${range.max}] source=${range.source}${clamped ? ' (clamped)' : ''}${usedNodeGoalThreshold ? ' (node goal_threshold preferred)' : ''}`,
    });

    // Add diagnostic
    diagnostics.push({
      constraint_id,
      node_id,
      original_value: value,
      normalised_value: normalised,
      range,
      used_heuristic: usedHeuristic,
      ...(usedNodeGoalThreshold && { used_node_goal_threshold: true }),
    });

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
