/**
 * B4: Next Actions
 *
 * Generates prioritized action list (max 3) with required rationales.
 */

import type { CoachingInputs, Critique, NextAction, Readiness, HeadlineType, EvidenceGap } from './types.js';
import { getThresholds } from './thresholds.js';

export function generateNextActions(
  inputs: CoachingInputs,
  headlineType: HeadlineType,
  critiques: Critique[],
  evidenceGaps: EvidenceGap[]
): NextAction[] {
  const thresholds = getThresholds();

  // Compute readiness
  const readiness = computeReadiness(headlineType, critiques, evidenceGaps, thresholds);

  // Build context for action interpolation
  const context = {
    readiness,
    headlineType,
    critiques,
    evidenceGaps,
    topGap: evidenceGaps[0],
    topFragileEdge: inputs.fragileEdges[0],
    winner: inputs.options[0],
    optionCount: inputs.options.length,
    stability: inputs.robustness.recommendationStability,
  };

  // Apply priority rules
  const actions: NextAction[] = [];

  // Priority 1: Narrow framing
  if (critiques.some((c) => c.type === 'NARROW_FRAMING')) {
    actions.push({
      priority: 1,
      action: 'Reconsider framing — add alternatives or Status Quo baseline',
      rationale: `With only ${context.optionCount} options and no baseline, comparisons may be misleading`,
      related_critique: 'NARROW_FRAMING',
      // No specific target - framing issue affects entire decision
    });
  }

  // Priority 2: Evidence gaps
  if (readiness === 'needs_evidence' && evidenceGaps.length > 0 && actions.length < 3) {
    actions.push({
      priority: 2,
      action: `Gather evidence on ${context.topGap.factor_label}`,
      rationale: `This factor has high impact (${context.topGap.influence_display}) but low confidence (${context.topGap.confidence_display})`,
      target_type: 'factor',
      target_id: context.topGap.factor_id,
      target_label: context.topGap.factor_label,
    });
  }

  // Priority 3: Fragile edges
  if (
    context.topFragileEdge &&
    context.topFragileEdge.switchProb > thresholds.action_fragile_edge_threshold &&
    actions.length < 3
  ) {
    actions.push({
      priority: 3,
      action: `Validate the ${context.topFragileEdge.displayLabel} assumption`,
      rationale: `${Math.round(context.topFragileEdge.switchProb * 100)}% chance this flips the decision to ${context.topFragileEdge.altWinnerLabel}`,
      target_type: 'edge',
      target_id: context.topFragileEdge.edgeId,
      target_label: context.topFragileEdge.displayLabel,
    });
  }

  // Priority 4: Close call
  if (headlineType === 'close_call' && actions.length < 3) {
    const winnerLabel = context.winner?.label ?? 'winning option';
    const delta = context.winner ? Math.round((context.winner.winProbability - (inputs.options[1]?.winProbability ?? 0)) * 100) : 0;
    actions.push({
      priority: 4,
      action: 'Define tie-breaker criteria — margin is too close to call',
      rationale: `Winner leads by only ${delta} points; within model uncertainty`,
      target_type: 'option',
      target_id: context.winner?.id,
      target_label: winnerLabel,
    });
  }

  // Priority 5: Ready to proceed
  if (readiness === 'ready' && actions.length < 3) {
    const winnerLabel = context.winner?.label ?? 'top option';
    const delta = context.winner ? Math.round((context.winner.winProbability - (inputs.options[1]?.winProbability ?? 0)) * 100) : 0;
    const stabilityDisplay = context.stability ? Math.round(context.stability * 100) : 0;
    actions.push({
      priority: 7,
      action: `Proceed with ${winnerLabel}`,
      rationale: `Decision is robust: ${delta}-point margin with ${stabilityDisplay}% stability`,
      target_type: 'option',
      target_id: context.winner?.id,
      target_label: winnerLabel,
    });
  }

  // Fallback if no actions matched
  if (actions.length === 0) {
    actions.push({
      priority: 99,
      action: 'Review model assumptions',
      rationale: 'Unable to generate specific guidance',
      // No specific target - general fallback
    });
  }

  return actions.slice(0, 3); // Max 3
}

export function computeReadiness(
  headlineType: HeadlineType,
  critiques: Critique[],
  evidenceGaps: EvidenceGap[],
  thresholds: ReturnType<typeof getThresholds>
): Readiness {
  // Framing issues take priority
  if (critiques.some((c) => c.type === 'NARROW_FRAMING')) {
    return 'needs_framing';
  }

  // High evidence gaps
  if (evidenceGaps.length >= thresholds.readiness_high_evidence_gap_count && evidenceGaps[0] && evidenceGaps[0].voi_score > thresholds.readiness_high_voi_threshold) {
    return 'needs_evidence';
  }

  // Close call
  if (headlineType === 'close_call' || headlineType === 'high_uncertainty') {
    return 'close_call';
  }

  // Ready to proceed
  if (headlineType === 'clear_winner' || headlineType === 'moderate_winner') {
    return 'ready';
  }

  return 'needs_evidence';
}
