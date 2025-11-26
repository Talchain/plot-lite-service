/**
 * ISL Counterfactual Response Adapter
 *
 * Transforms ISL counterfactual responses to PLoT format.
 */

import type { ISLCounterfactualResponse } from '../types/isl-types.js';
import type { PLoTCounterfactualResult } from '../types/plot-types.js';

/**
 * Transform ISL counterfactual response to PLoT format
 *
 * @param isl - Raw ISL counterfactual response
 * @returns PLoT-formatted counterfactual result
 *
 * @example
 * ```typescript
 * const islResponse = await islClient.request<ISLCounterfactualResponse>(...);
 * const plotResult = adaptCounterfactualResponse(islResponse);
 * ```
 */
export function adaptCounterfactualResponse(isl: ISLCounterfactualResponse): PLoTCounterfactualResult {
  // Map ISL CI to p-bands
  // ISL gives [lower, upper] at 95% CI
  // We map: p10 ≈ lower, p50 ≈ estimate, p90 ≈ upper
  const confidence_interval = {
    p10: isl.confidence_interval.lower,
    p50: isl.estimate,
    p90: isl.confidence_interval.upper,
  };

  // Calculate total uncertainty (root sum of squares)
  const breakdown = isl.uncertainty_decomposition;
  const total = Math.sqrt(
    Math.pow(breakdown.parametric, 2) +
    Math.pow(breakdown.structural, 2) +
    Math.pow(breakdown.stochastic, 2)
  );

  return {
    estimate: isl.estimate,
    confidence_interval,
    uncertainty: {
      total: Number(total.toFixed(4)),
      breakdown: {
        parametric: breakdown.parametric,
        structural: breakdown.structural,
        stochastic: breakdown.stochastic,
      },
    },
    source: 'isl',
  };
}

/**
 * Create a fallback counterfactual result when ISL is unavailable
 *
 * @param reason - Why fallback is being used
 * @returns Fallback counterfactual result
 */
export function createFallbackCounterfactual(reason: string): PLoTCounterfactualResult {
  return {
    estimate: 0,
    confidence_interval: { p10: 0, p50: 0, p90: 0 },
    uncertainty: {
      total: 1,
      breakdown: { parametric: 0.33, structural: 0.33, stochastic: 0.34 },
    },
    source: 'engine_fallback',
  };
}
