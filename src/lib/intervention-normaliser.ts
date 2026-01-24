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

import type { EngineNodeV3, OptionV3, InterventionValueV3, OutcomeStatsV3 } from '../types/engine-v3.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * Range for normalisation.
 */
export interface NormalisationRange {
  min: number;
  max: number;
  source: 'explicit' | 'inferred_baseline' | 'inferred_value' | 'default';
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
 * Derive normalisation range for a factor node.
 *
 * Priority chain:
 * 1. Explicit state_space.range (highest priority)
 * 2. Inferred from baseline and current value
 * 3. Inferred from current value only
 * 4. Default [0, 1]
 *
 * @param node Factor node
 * @returns Normalisation range with source indicator
 */
export function deriveRange(node: EngineNodeV3): NormalisationRange {
  const stateSpace = node.state_space;
  const observedState = node.observed_state;

  // Priority 1: Explicit state_space.range
  if (stateSpace?.range) {
    const { min, max } = stateSpace.range;
    if (typeof min === 'number' && typeof max === 'number' && max > min) {
      return { min, max, source: 'explicit' };
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
 * Build normalisation context from graph nodes.
 *
 * Creates contexts for all factor nodes that might be intervention targets
 * or the goal node.
 *
 * @param nodes Graph nodes
 * @param goalNodeId Goal node ID
 * @returns Normalisation context
 */
export function buildNormalisationContext(
  nodes: EngineNodeV3[],
  goalNodeId: string
): NormalisationContext {
  const factors = new Map<string, FactorNormalisationContext>();
  let goalContext: FactorNormalisationContext | undefined;

  for (const node of nodes) {
    // Build context for all nodes (factors, goals, etc.) that might need normalisation
    const range = deriveRange(node);
    const baseline = node.observed_state?.baseline ?? node.observed_state?.value ?? 0;

    const context: FactorNormalisationContext = {
      factor_id: node.id,
      range,
      baseline,
    };

    factors.set(node.id, context);

    // Track goal node context separately for outcome denormalisation
    if (node.id === goalNodeId) {
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
 * Normalise all intervention values in options.
 *
 * @param options Original options with raw intervention values
 * @param context Normalisation context
 * @returns Normalised options and diagnostics
 */
export function normaliseOptions(
  options: OptionV3[],
  context: NormalisationContext
): { options: OptionV3[]; diagnostics: NormalisationDiagnostic[] } {
  const diagnostics: NormalisationDiagnostic[] = [];

  const normalisedOptions: OptionV3[] = options.map(option => {
    const normalisedInterventions: Record<string, InterventionValueV3> = {};

    for (const [factorId, intervention] of Object.entries(option.interventions)) {
      const factorContext = context.factors.get(factorId);

      if (!factorContext) {
        // No context for this factor - use default range
        const defaultRange: NormalisationRange = { min: 0, max: 1, source: 'default' };
        const { normalised, clamped } = normaliseValue(intervention.value, defaultRange);

        normalisedInterventions[factorId] = {
          value: normalised,
          source: intervention.source,
        };

        diagnostics.push({
          factor_id: factorId,
          original_value: intervention.value,
          normalised_value: normalised,
          range: defaultRange,
          clamped,
        });
      } else {
        const { normalised, clamped } = normaliseValue(intervention.value, factorContext.range);

        normalisedInterventions[factorId] = {
          value: normalised,
          source: intervention.source,
        };

        diagnostics.push({
          factor_id: factorId,
          original_value: intervention.value,
          normalised_value: normalised,
          range: factorContext.range,
          clamped,
        });
      }
    }

    return {
      id: option.id,
      label: option.label,
      interventions: normalisedInterventions,
    };
  });

  return { options: normalisedOptions, diagnostics };
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
export function denormaliseOutcome(
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
export function denormaliseExpectedOutcome(
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
export function denormaliseConfidenceInterval(
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
 * Normalise options for ISL call.
 *
 * Entry point for normalisation. Returns normalised options and context
 * needed for later denormalisation of outcomes.
 *
 * @param options Original options with raw intervention values
 * @param nodes Graph nodes (for building normalisation context)
 * @param goalNodeId Goal node ID
 * @returns Normalised options and context
 */
export function normaliseOptionsForISL(
  options: OptionV3[],
  nodes: EngineNodeV3[],
  goalNodeId: string
): NormalisedOptions & { diagnostics: NormalisationDiagnostic[] } {
  const context = buildNormalisationContext(nodes, goalNodeId);
  const { options: normalisedOptions, diagnostics } = normaliseOptions(options, context);

  return {
    options: normalisedOptions,
    context,
    diagnostics,
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
