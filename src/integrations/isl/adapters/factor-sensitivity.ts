/**
 * ISL Factor Sensitivity Response Adapter
 *
 * Transforms ISL /api/v1/robustness/analyze/v2 responses to PLoT format.
 * Factor sensitivity measures how outcome is affected by changes in factor node values.
 */

import type { ISLFactorSensitivityResponse } from '../types/isl-types.js';
import type { PLoTFactorSensitivityResult, FactorSensitivityEntry, VOIEntry } from '../types/plot-types.js';

/**
 * Transform ISL factor sensitivity response to PLoT format
 *
 * @param isl - Raw ISL factor sensitivity response
 * @param latencyMs - Request latency in milliseconds
 * @returns PLoT-formatted factor sensitivity result
 *
 * @example
 * ```typescript
 * const islResponse = await islClient.request<ISLFactorSensitivityResponse>(...);
 * const plotResult = adaptFactorSensitivityResponse(islResponse, 280);
 * ```
 */
export function adaptFactorSensitivityResponse(
  isl: ISLFactorSensitivityResponse,
  latencyMs: number
): PLoTFactorSensitivityResult {
  // Transform factor sensitivities
  const factors: FactorSensitivityEntry[] = isl.factor_sensitivity.map((item) => ({
    factor_id: item.node_id,
    sensitivity_score: item.sensitivity,
    direction: item.direction ?? 'mixed',
  }));

  // Sort by sensitivity descending (most sensitive first)
  factors.sort((a, b) => Math.abs(b.sensitivity_score) - Math.abs(a.sensitivity_score));

  // Transform value of information entries
  const value_of_information: VOIEntry[] = isl.factor_sensitivity
    .filter((item) => item.value_of_information > 0)
    .map((item) => ({
      factor_id: item.node_id,
      voi: item.value_of_information,
    }))
    .sort((a, b) => b.voi - a.voi);

  return {
    factors,
    value_of_information,
    robustness_label: isl.robustness.label,
    robustness_score: isl.robustness.score,
    latency_ms: latencyMs,
    source: 'isl',
  };
}

/**
 * Create a fallback factor sensitivity result when ISL is unavailable
 *
 * @param reason - Why fallback is being used
 * @returns Fallback factor sensitivity result
 */
export function createFallbackFactorSensitivity(reason: string): PLoTFactorSensitivityResult {
  return {
    factors: [],
    value_of_information: [],
    robustness_label: 'moderate',
    robustness_score: 0.5,
    latency_ms: 0,
    source: 'unavailable',
  };
}
