/**
 * ISL Sensitivity Response Adapter
 *
 * Transforms ISL sensitivity responses to PLoT format.
 */

import type { ISLSensitivityResponse } from '../types/isl-types.js';
import type { PLoTSensitivityResult } from '../types/plot-types.js';

/**
 * Transform ISL sensitivity response to PLoT format
 *
 * @param isl - Raw ISL sensitivity response
 * @returns PLoT-formatted sensitivity result
 *
 * @example
 * ```typescript
 * const islResponse = await islClient.request<ISLSensitivityResponse>(...);
 * const plotResult = adaptSensitivityResponse(islResponse);
 * ```
 */
export function adaptSensitivityResponse(isl: ISLSensitivityResponse): PLoTSensitivityResult {
  // Transform sensitivities to sensitive_parameters
  const sensitive_parameters = isl.sensitivities.map((s) => ({
    parameter: s.parameter,
    sensitivity: s.sensitivity_score,
    // Map 'mixed' to 'positive' as a default direction
    impact_direction: (s.direction === 'mixed' ? 'positive' : s.direction) as 'positive' | 'negative',
  }));

  // Sort by sensitivity descending (most sensitive first)
  sensitive_parameters.sort((a, b) => b.sensitivity - a.sensitivity);

  return {
    overall_robustness: isl.overall_robustness,
    sensitive_parameters,
    recommendations: isl.recommendations,
    source: 'isl',
  };
}

/**
 * Create a fallback sensitivity result when ISL is unavailable
 *
 * @param reason - Why fallback is being used
 * @returns Fallback sensitivity result
 */
export function createFallbackSensitivity(reason: string): PLoTSensitivityResult {
  return {
    overall_robustness: 'moderate',
    sensitive_parameters: [],
    recommendations: [`ISL sensitivity analysis unavailable: ${reason}`],
    source: 'engine_fallback',
  };
}
