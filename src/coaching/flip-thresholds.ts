/**
 * Flip Thresholds Computation
 *
 * Computes flip threshold data for the Decision Review request.
 *
 * ## Approach: Heuristic (not exact computation)
 *
 * ISL's `factor_sensitivity.elasticity` represents Δoutcome per unit factor change,
 * NOT Δwin_probability. This means we CANNOT compute exact flip thresholds using:
 *   flip_delta = margin / elasticity
 *
 * Instead, we use a heuristic approach:
 * 1. Rank factors by |elasticity| descending (highest sensitivity = most likely to flip)
 * 2. Report factor_id, factor_label, current_value, direction
 * 3. Set flip_value to null - CEE's prompt handles this by producing qualitative text
 *
 * @see Brief: M2 Decision Review Integration, Task 2
 */

import type { EngineGraphV3, EngineNodeV3 } from '../types/engine-v3.js';
import type { FlipThresholdInputData } from '../cee/validation/m1-review-types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Factor sensitivity input (from ISL).
 */
export interface FactorSensitivityInput {
  factor_id: string;
  factor_label?: string;
  elasticity: number | null | undefined;
  /** Used to infer direction: positive elasticity suggests increase helps winner */
  direction?: 'positive' | 'negative' | string;
}

/**
 * Option comparison input (from ISL).
 */
export interface OptionComparisonInput {
  option_id: string;
  option_label?: string;
  win_probability: number;
  expected_outcome?: number;
}

// =============================================================================
// Constants
// =============================================================================

/** Minimum elasticity to consider (skip near-zero values) */
const MIN_ELASTICITY_THRESHOLD = 0.01;

/**
 * Maximum number of flip thresholds to return.
 * Top 5 by |elasticity| balances UI richness against binary search cost.
 * Binary search runs up to 12 ISL calls per factor (2 bracket + 10 bisect),
 * so 5 factors = 60 calls worst-case. Timeouts (5s/factor, 10s overall)
 * prevent runaway latency. If latency proves too high, reduce to 3.
 */
const MAX_FLIP_THRESHOLDS = 5;

// =============================================================================
// Main Function
// =============================================================================

/**
 * Compute flip threshold data for the Decision Review request.
 *
 * Uses heuristic approach since elasticity ≠ Δwin_probability:
 * - Rank factors by |elasticity| descending
 * - Return top 2 factors with current_value and direction
 * - Set flip_value to null (CEE handles qualitatively)
 *
 * @param factorSensitivity Factor sensitivity array from ISL
 * @param optionComparison Option comparison array from ISL
 * @param graph Normalized graph (for current_value lookup)
 * @param overriddenFactorIds Factor IDs overridden by EVERY compared option.
 *   These are inert for assumption-threshold probing (the flip probe varies a
 *   factor's prior mean, but a do()-intervention on every option severs that
 *   factor from its prior, so probing can never move the winner). Excluded from
 *   both the primary ranked selection and the zero-elasticity fallback so they
 *   never consume flip-threshold probe budget. Factors intervened by only SOME
 *   options, or by none, are preserved. Optional — omit to disable exclusion.
 * @returns Array of flip threshold input data (max MAX_FLIP_THRESHOLDS)
 */
export function computeFlipThresholdData(
  factorSensitivity: FactorSensitivityInput[],
  optionComparison: OptionComparisonInput[],
  graph: EngineGraphV3,
  overriddenFactorIds?: ReadonlySet<string>
): FlipThresholdInputData[] {
  // Edge case: Only one option (no runner_up) → no flip thresholds
  if (!optionComparison || optionComparison.length < 2) {
    return [];
  }

  // Sort options by win_probability to find winner and runner-up
  const sortedOptions = [...optionComparison].sort(
    (a, b) => b.win_probability - a.win_probability
  );
  const winner = sortedOptions[0];
  const runnerUp = sortedOptions[1];

  // Edge case: Margin is 0 → no clear flip scenario
  const margin = winner.win_probability - runnerUp.win_probability;
  if (margin === 0) {
    return [];
  }

  // Edge case: No factor sensitivity data
  if (!factorSensitivity || factorSensitivity.length === 0) {
    return [];
  }

  // Filter factors with meaningful elasticity. Also exclude factors overridden by
  // every compared option: their prior value is severed by each option's
  // intervention, so an assumption-threshold probe on them always returns
  // no_effect_within_bounds (see overriddenFactorIds param docs).
  const validFactors = factorSensitivity.filter(
    (f) =>
      f.elasticity !== null &&
      f.elasticity !== undefined &&
      Math.abs(f.elasticity) >= MIN_ELASTICITY_THRESHOLD &&
      !overriddenFactorIds?.has(f.factor_id)
  );

  // Sort by |elasticity| descending (highest sensitivity = most likely to flip)
  const rankedFactors = [...validFactors].sort(
    (a, b) => Math.abs(b.elasticity!) - Math.abs(a.elasticity!)
  );

  // Build flip threshold data for top factors
  const results: FlipThresholdInputData[] = [];

  for (const factor of rankedFactors) {
    if (results.length >= MAX_FLIP_THRESHOLDS) break;

    // Find current_value and unit from graph node
    const factorNode = graph.nodes.find((n) => n.id === factor.factor_id);
    const currentValue = getFactorCurrentValue(factor.factor_id, graph);
    if (currentValue === null) {
      // Skip factors without current_value
      continue;
    }

    // Determine direction: which way would help the runner-up?
    // If elasticity is positive, increasing the factor improves outcome
    // If winner has higher win_prob, runner-up needs the opposite direction
    const direction = inferFlipDirection(factor.elasticity!, factor.direction);

    results.push({
      factor_id: factor.factor_id,
      factor_label: factor.factor_label ?? factor.factor_id,
      current_value: currentValue,
      flip_value: null, // Heuristic approach: CEE computes qualitative text
      direction,
      flip_reason: 'heuristic',
      iterations_used: 0,
      probes_used: 0, // Heuristic candidate — no probes run until resolveFlipValues
      alternative_winner_id: null,
      unit: factorNode?.observed_state?.unit,
    });
  }

  // Fallback: zero-elasticity graphs (all factors filtered out by MIN_ELASTICITY_THRESHOLD).
  // Emit top 2 factors by distance from midpoint (most room to flip). Overridden-by-all
  // factors are excluded here too so the fallback never re-introduces inert factors.
  if (results.length === 0 && factorSensitivity.length > 0) {
    const fallbackCandidates = factorSensitivity
      .filter((f) => !overriddenFactorIds?.has(f.factor_id))
      .map((f) => {
        const currentValue = getFactorCurrentValue(f.factor_id, graph);
        if (currentValue === null) return null;
        return {
          factor: f,
          currentValue,
          distanceFromMid: Math.abs(currentValue - 0.5),
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => b.distanceFromMid - a.distanceFromMid)
      .slice(0, 2);

    for (const candidate of fallbackCandidates) {
      const factorNode = graph.nodes.find((n) => n.id === candidate.factor.factor_id);
      results.push({
        factor_id: candidate.factor.factor_id,
        factor_label: candidate.factor.factor_label ?? candidate.factor.factor_id,
        current_value: candidate.currentValue,
        flip_value: null,
        direction: candidate.currentValue < 0.5 ? 'increase' : 'decrease',
        flip_reason: 'zero_elasticity_fallback',
        iterations_used: 0,
        probes_used: 0, // Heuristic candidate — no probes run until resolveFlipValues
        alternative_winner_id: null,
        unit: factorNode?.observed_state?.unit,
      });
    }
  }

  return results;
}

/**
 * Return the set of factor (node) IDs that EVERY compared option intervenes on.
 *
 * A factor overridden by every option is inert for assumption-threshold probing:
 * the flip probe varies `parameter_uncertainties[].mean`, but each option applies a
 * do()-intervention that fixes the factor, severing it from its prior. Probing such
 * a factor can never change any option's outcome, so it always yields
 * `no_effect_within_bounds` and wastes probe budget. Feed the result to
 * {@link computeFlipThresholdData} as `overriddenFactorIds` to exclude them.
 *
 * IMPORTANT — "overridden by every option", not "intervention target":
 *  - a factor intervened on by only SOME options is NOT included (the
 *    non-intervening options still respond to the prior, so a flip is possible);
 *  - a non-intervened factor is never included.
 *
 * @param options Compared options; intervention keys are factor node IDs.
 * @returns Set of factor IDs overridden by every option (empty if none / no options).
 */
export function getFactorsOverriddenByAllOptions(
  options: ReadonlyArray<{ interventions?: Record<string, unknown> | null }>
): Set<string> {
  if (!Array.isArray(options) || options.length === 0) {
    return new Set<string>();
  }

  // Intervention-key set (factor node IDs) per option.
  const perOptionKeys = options.map((opt) => {
    const interventions = opt?.interventions;
    if (!interventions || typeof interventions !== 'object') {
      return new Set<string>();
    }
    return new Set<string>(Object.keys(interventions));
  });

  // Intersect across all options: a factor must appear in every option's key set.
  const [firstKeys, ...restKeys] = perOptionKeys;
  const overridden = new Set<string>();
  for (const factorId of firstKeys) {
    if (restKeys.every((keys) => keys.has(factorId))) {
      overridden.add(factorId);
    }
  }
  return overridden;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get current value for a factor from the graph.
 *
 * Checks multiple locations:
 * 1. node.observed_state.value (standard location)
 * 2. node.data.value (React Flow compatibility)
 *
 * @param factorId Factor ID
 * @param graph Normalized graph
 * @returns Current value or null if not found
 */
function getFactorCurrentValue(factorId: string, graph: EngineGraphV3): number | null {
  const node = graph.nodes.find((n) => n.id === factorId);
  if (!node) return null;

  // Check observed_state.value (standard)
  if (node.observed_state?.value !== undefined) {
    return node.observed_state.value;
  }

  // Check data.value (React Flow compatibility)
  const dataNode = node as any;
  if (dataNode.data?.value !== undefined) {
    return dataNode.data.value;
  }

  return null;
}

/**
 * Infer the direction that would flip the recommendation.
 *
 * Heuristic logic:
 * - ISL's `direction` field is the canonical source if available
 * - Otherwise, infer from elasticity sign:
 *   - Positive elasticity: increasing factor improves outcome
 *   - For runner-up to win, they need the OPPOSITE of what helps winner
 *
 * Since we can't know the exact causal structure without more context,
 * we use a simplified heuristic: direction = opposite of elasticity sign
 *
 * @param elasticity Factor elasticity
 * @param islDirection ISL-provided direction (if available)
 * @returns Direction for flip ('increase' or 'decrease')
 */
function inferFlipDirection(
  elasticity: number,
  islDirection?: 'positive' | 'negative' | string
): 'increase' | 'decrease' {
  // If ISL provides direction, use opposite to flip
  if (islDirection === 'positive') return 'decrease';
  if (islDirection === 'negative') return 'increase';

  // Infer from elasticity sign
  // Positive elasticity = increasing helps winner → decrease to help runner-up
  // Negative elasticity = decreasing helps winner → increase to help runner-up
  return elasticity > 0 ? 'decrease' : 'increase';
}

// =============================================================================
// Margin Calculation Helper
// =============================================================================

/**
 * Calculate margin from option comparison data.
 *
 * @param optionComparison Option comparison array from ISL
 * @returns Margin (winner - runner_up), or 0 if insufficient data
 */
export function calculateMargin(optionComparison: OptionComparisonInput[]): number {
  if (!optionComparison || optionComparison.length < 2) {
    // Single option: use full win_probability as "margin"
    return optionComparison?.[0]?.win_probability ?? 0;
  }

  const sorted = [...optionComparison].sort(
    (a, b) => b.win_probability - a.win_probability
  );
  return sorted[0].win_probability - sorted[1].win_probability;
}

/**
 * Get winner and runner-up from option comparison data.
 */
export function getWinnerAndRunnerUp(
  optionComparison: OptionComparisonInput[]
): { winner: OptionComparisonInput | null; runnerUp: OptionComparisonInput | null } {
  if (!optionComparison || optionComparison.length === 0) {
    return { winner: null, runnerUp: null };
  }

  const sorted = [...optionComparison].sort(
    (a, b) => b.win_probability - a.win_probability
  );

  return {
    winner: sorted[0],
    runnerUp: sorted.length > 1 ? sorted[1] : null,
  };
}
