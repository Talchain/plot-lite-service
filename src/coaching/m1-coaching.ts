/**
 * M1 Coaching - Main Orchestrator
 *
 * Coordinates all coaching components with graceful degradation.
 * Fully deterministic, no LLM calls, < 100ms computation budget.
 */

import type { M1Coaching } from './types.js';
import type { EngineGraphV3, OptionV3 } from '../types/engine-v3.js';
import { normaliseCoachingInputs } from './normalise-inputs.js';
import { generateHeadlines, getFragileEdgeContext } from './headlines.js';
import { computeEvidenceGaps } from './evidence-gaps.js';
import { generateCritiques } from './critiques.js';
import { generateNextActions, computeReadiness } from './next-actions.js';

/**
 * Generate M1 coaching output from ISL response data.
 *
 * @param graph Normalized graph (after filtering)
 * @param options Request options
 * @param islResult ISL response data
 * @param logger Optional logger for warnings
 * @returns M1Coaching object or null if generation fails
 */
export function generateM1Coaching(
  graph: EngineGraphV3,
  options: OptionV3[],
  islResult: any,
  logger?: any
): M1Coaching | null {
  const startTime = performance.now();

  try {
    // Normalize inputs (required for all components)
    const inputs = normaliseCoachingInputs(graph, options, islResult);

    // Generate each component with error isolation
    const storyHeadlines = safeCompute(() => generateHeadlines(inputs), {}, logger, 'headlines');
    const evidenceGaps = safeCompute(() => computeEvidenceGaps(inputs), [], logger, 'evidence_gaps');
    const modelCritiques = safeCompute(() => generateCritiques(inputs), [], logger, 'critiques');

    // Get headline type from first option (for readiness computation)
    const headlineType = inputs.options.length > 0 ? detectHeadlineType(inputs) : 'needs_evidence';

    // Generate next actions (depends on other components)
    const nextActions = safeCompute(
      () => generateNextActions(inputs, headlineType, modelCritiques, evidenceGaps),
      [],
      logger,
      'next_actions'
    );

    // Compute readiness
    const readiness = computeReadiness(headlineType, modelCritiques, evidenceGaps);

    // Get fragile edge context if relevant
    const topFragileEdge = getFragileEdgeContext(inputs.fragileEdges);

    // Check computation time
    const elapsed = performance.now() - startTime;
    if (elapsed > 100) {
      logger?.warn({ event: 'm1_coaching_slow', elapsed_ms: elapsed });
    }

    return {
      story_headlines: storyHeadlines,
      evidence_gaps: evidenceGaps,
      model_critiques: modelCritiques,
      next_actions: nextActions,
      readiness,
      headline_type: headlineType,
      top_fragile_edge: topFragileEdge
        ? {
            edge_id: topFragileEdge.edgeId,
            label: topFragileEdge.label,
            alternative_winner: topFragileEdge.altWinner,
            switch_probability: topFragileEdge.switchProb,
          }
        : undefined,
      coaching_version: '1.0.0',
      computed_at: new Date().toISOString(),
    };
  } catch (err) {
    logger?.error({ event: 'm1_coaching_error', error: (err as Error).message });
    return null; // Graceful degradation: no coaching
  }
}

/**
 * Safely compute a component, returning fallback on error.
 */
function safeCompute<T>(fn: () => T, fallback: T, logger: any, component: string): T {
  try {
    return fn();
  } catch (err) {
    logger?.warn({
      event: 'm1_coaching_component_error',
      component,
      error: (err as Error).message,
    });
    return fallback;
  }
}

/**
 * Detect headline type from inputs (simplified version of headlines.ts logic).
 */
function detectHeadlineType(inputs: any): any {
  const { options, factorSensitivity, robustness } = inputs;

  if (options.length === 0 || factorSensitivity.length === 0) {
    return 'needs_evidence';
  }

  const sorted = [...options].sort((a: any, b: any) => b.winProbability - a.winProbability);
  const winner = sorted[0];
  const runnerUp = sorted[1];

  const winProbDelta = runnerUp ? winner.winProbability - runnerUp.winProbability : winner.winProbability;
  const stability = robustness.recommendationStability;

  if (stability === undefined) return 'needs_evidence';
  if (winProbDelta >= 0.20 && stability >= 0.70) return 'clear_winner';
  if (winProbDelta >= 0.10 && stability >= 0.50) return 'moderate_winner';
  if (winProbDelta < 0.10) return 'close_call';

  return 'needs_evidence';
}
