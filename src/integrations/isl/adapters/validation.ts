/**
 * ISL Validation Response Adapter
 *
 * Transforms ISL validation responses to PLoT format.
 */

import type { ISLValidationResponse } from '../types/isl-types.js';
import type { PLoTValidationResult } from '../types/plot-types.js';

/**
 * Status mapping from ISL to PLoT
 */
const STATUS_MAP: Record<ISLValidationResponse['status'], PLoTValidationResult['status']> = {
  identifiable: 'identifiable',
  partially_identifiable: 'uncertain',
  not_identifiable: 'cannot_identify',
};

/**
 * Confidence mapping from ISL robustness to PLoT confidence
 */
const CONFIDENCE_MAP: Record<ISLValidationResponse['robustness'], PLoTValidationResult['confidence']> = {
  high: 'high',
  medium: 'medium',
  low: 'low',
};

/**
 * Transform ISL validation response to PLoT format
 *
 * @param isl - Raw ISL validation response
 * @returns PLoT-formatted validation result
 *
 * @example
 * ```typescript
 * const islResponse = await islClient.request<ISLValidationResponse>(...);
 * const plotResult = adaptValidationResponse(islResponse);
 * ```
 */
export function adaptValidationResponse(isl: ISLValidationResponse): PLoTValidationResult {
  // Map ISL status to PLoT status
  const status = STATUS_MAP[isl.status] || 'uncertain';

  // Map robustness to confidence
  const confidence = CONFIDENCE_MAP[isl.robustness] || 'medium';

  // Transform suggestions to issues
  const issues = isl.suggestions.map((s) => ({
    type: s.type,
    description: s.description,
    affected_nodes: s.affected_variables,
    suggested_action: s.suggested_action,
  }));

  // Generate explanation
  const explanation = {
    summary: generateValidationSummary(isl),
    reasoning: generateValidationReasoning(isl),
  };

  return {
    status,
    confidence,
    adjustment_sets: isl.adjustment_sets.length > 0 ? isl.adjustment_sets : undefined,
    minimal_set: isl.minimal_adjustment_set.length > 0 ? isl.minimal_adjustment_set : undefined,
    issues: issues.length > 0 ? issues : undefined,
    explanation,
    source: 'isl',
  };
}

/**
 * Generate a human-readable validation summary
 */
function generateValidationSummary(isl: ISLValidationResponse): string {
  switch (isl.status) {
    case 'identifiable':
      return isl.minimal_adjustment_set.length === 0
        ? 'Causal effect is identifiable without adjustment'
        : `Causal effect is identifiable with ${isl.minimal_adjustment_set.length} adjustment(s)`;
    case 'partially_identifiable':
      return 'Causal effect is partially identifiable — some assumptions required';
    case 'not_identifiable':
      return 'Causal effect cannot be identified from current structure';
    default:
      return 'Validation status unknown';
  }
}

/**
 * Generate detailed reasoning for the validation result
 */
function generateValidationReasoning(isl: ISLValidationResponse): string {
  if (isl.status === 'identifiable' && isl.minimal_adjustment_set.length > 0) {
    return `Adjusting for ${isl.minimal_adjustment_set.join(', ')} blocks all backdoor paths.`;
  }
  if (isl.status === 'identifiable' && isl.minimal_adjustment_set.length === 0) {
    return 'No backdoor paths detected — direct causal effect is estimable.';
  }
  if (isl.suggestions.length > 0) {
    return `${isl.suggestions.length} issue(s) detected that may affect identifiability.`;
  }
  return 'Analysis complete.';
}

/**
 * Create a fallback validation result when ISL is unavailable
 *
 * @param reason - Why fallback is being used
 * @returns Fallback validation result
 */
export function createFallbackValidation(reason: string): PLoTValidationResult {
  return {
    status: 'uncertain',
    confidence: 'low',
    explanation: {
      summary: 'ISL validation unavailable',
      reasoning: reason,
    },
    source: 'engine_fallback',
  };
}
