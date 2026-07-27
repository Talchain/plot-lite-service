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
  // Map ISL status to PLoT status.
  //
  // The fallback arm is reached only when ISL sends a status outside its three
  // DECLARED values — i.e. undeclared wire data we cannot interpret. It used to
  // default to 'uncertain', which is a scientific verdict PLoT would then have
  // attributed to ISL: the same fabrication class as the 404 fallback below,
  // just triggered by an unrecognised value instead of a missing response.
  // An uninterpretable status is a non-result, so it degrades to 'unavailable'.
  const status = STATUS_MAP[isl.status] || 'unavailable';

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
 * Create a fallback validation result when ISL produced no validation.
 *
 * TYPED REFUSAL, NOT A VERDICT (ROADMAP 1.240). This returns
 * `status: 'unavailable'` — a value ISL can never produce — so no consumer can
 * mistake "we did not get an answer" for "the answer is uncertain".
 *
 * It previously returned `status: 'uncertain'`, and routes/v1/run.ts rendered
 * that as a user-facing critique reading "ISL validation reports partial
 * identifiability", tagged `source: 'isl'`. ISL had returned 404 (its
 * `causal_router` is not mounted) and computed nothing; the user was told a
 * substantive scientific claim about their own graph on behalf of a service
 * that was never reached. The one honest token — 'ISL validation unavailable' —
 * was demoted into `suggested_action`, where it read as advice rather than as
 * the retraction it actually was.
 *
 * `confidence: 'low'` is retained only because the field is required by the
 * interface; with `status: 'unavailable'` it carries no claim about the graph.
 * Do NOT reintroduce a verdict here for any failure mode — 404, timeout, 5xx
 * and circuit-breaker trips are all non-results and all take this path.
 *
 * @param reason - Why fallback is being used (surfaced as explanation.reasoning,
 *                 for operators; never rendered as a finding about the graph)
 * @returns Typed-unavailable validation result
 */
export function createFallbackValidation(reason: string): PLoTValidationResult {
  return {
    status: 'unavailable',
    confidence: 'low',
    explanation: {
      summary: 'ISL validation unavailable',
      reasoning: reason,
    },
    source: 'engine_fallback',
  };
}
