/**
 * B4: Next Actions
 *
 * Generates prioritized action list (max 3) with required rationales.
 * Priority 5 wording is gated by the D2-tone classifier: confident tone emits
 * a forward-leaning action; tempered/caution swap in validation-first actions
 * so we never issue an imperative the evidence does not support.
 */

import type { CoachingInputs, Critique, NextAction, Readiness, HeadlineType, EvidenceGap } from './types.js';
import { getThresholds } from './thresholds.js';
import { computeKeyDrivers } from './key-drivers.js';
import { deriveReadinessTone, type ReadinessToneReason, type ReadinessToneResult } from './readiness-tone.js';

export function generateNextActions(
  inputs: CoachingInputs,
  headlineType: HeadlineType,
  critiques: Critique[],
  evidenceGaps: EvidenceGap[],
  precomputedTone?: ReadinessToneResult,
): NextAction[] {
  const thresholds = getThresholds();

  // Compute readiness (unchanged semantics — downstream consumers depend on it).
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
    const leadingLabel = context.winner?.label ?? 'the leading option';
    const delta = context.winner ? Math.round((context.winner.winProbability - (inputs.options[1]?.winProbability ?? 0)) * 100) : 0;
    actions.push({
      priority: 4,
      action: 'Define tie-breaker criteria — margin is too close to call',
      rationale: `${leadingLabel} leads by only ${delta} points; within model uncertainty`,
      target_type: 'option',
      target_id: context.winner?.id,
      target_label: leadingLabel,
    });
  }

  // Priority 5: Ready — tone-gated wording.
  // Confident tone allows a forward-leaning action; tempered/caution swap in
  // a validation-first action so we don't issue an imperative the evidence
  // doesn't support.
  if (readiness === 'ready' && actions.length < 3) {
    const leadingLabel = context.winner?.label ?? 'the leading option';
    const delta = context.winner ? Math.round((context.winner.winProbability - (inputs.options[1]?.winProbability ?? 0)) * 100) : 0;
    const stabilityDisplay = context.stability !== undefined ? Math.round(context.stability * 100) : 0;
    const keyDrivers = computeKeyDrivers(inputs);
    // Reuse the orchestrator-precomputed tone when threaded in so the structured
    // m1_coaching.readiness_tone and this prose share one classification.
    // Direct callers (unit tests) may omit it; we then recompute locally.
    const { tone, reasons } = precomputedTone ?? deriveReadinessTone(
      inputs,
      readiness,
      headlineType,
      keyDrivers,
      evidenceGaps,
      thresholds,
    );
    const reasonSummary = summariseTopReason(reasons, { evidenceGapCount: evidenceGaps.length });

    let action: string;
    let rationale: string;
    if (tone === 'confident') {
      action = `Move forward with ${leadingLabel} while validating the key assumptions`;
      rationale = context.stability !== undefined
        ? `${leadingLabel} has a strong current lead by ${delta} points with ${stabilityDisplay}% recommendation stability`
        : `${leadingLabel} has a strong current lead by ${delta} points`;
    } else if (tone === 'caution') {
      action = `Validate the fragile assumptions before treating ${leadingLabel} as a decision`;
      rationale = reasonSummary
        ? `${leadingLabel} currently leads by ${delta} points, but ${reasonSummary}`
        : `${leadingLabel} currently leads by ${delta} points, but the model is not yet strong enough for an unqualified decision`;
    } else {
      action = `Validate the key assumptions before acting on ${leadingLabel}`;
      rationale = context.stability !== undefined
        ? (reasonSummary
            ? `${leadingLabel} currently leads by ${delta} points with ${stabilityDisplay}% recommendation stability, but ${reasonSummary}`
            : `${leadingLabel} currently leads by ${delta} points with ${stabilityDisplay}% recommendation stability`)
        : (reasonSummary
            ? `${leadingLabel} currently leads by ${delta} points, but ${reasonSummary}`
            : `${leadingLabel} currently leads by ${delta} points`);
    }

    actions.push({
      priority: 7,
      action,
      rationale,
      target_type: 'option',
      target_id: context.winner?.id,
      target_label: leadingLabel,
    });
  }

  // Fallback if no actions matched
  if (actions.length === 0) {
    actions.push({
      priority: 99,
      action: 'Review model assumptions',
      rationale: 'Unable to generate specific guidance',
    });
  }

  return actions.slice(0, 3);
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

const REASON_PHRASES: Record<Exclude<ReadinessToneReason, 'EVIDENCE_GAPS'>, string> = {
  NOT_ROBUST: 'the recommendation is not yet robust',
  LOW_ROBUSTNESS: 'robustness is below the confident threshold',
  LOW_STABILITY: 'stability is below the confident threshold',
  MATERIAL_FRAGILE_EDGE: 'a fragile edge could flip the result',
  LOW_DRIVER_CONFIDENCE: 'the top driver has low confidence',
  NEAR_TIE: 'the margin is near a tie',
  INSUFFICIENT_SIGNALS: 'key signals are not yet available',
};

// Reasons are surfaced in display priority order so the rationale leads with
// the most decision-relevant signal failure.
const REASON_DISPLAY_ORDER: ReadinessToneReason[] = [
  'NOT_ROBUST',
  'MATERIAL_FRAGILE_EDGE',
  'EVIDENCE_GAPS',
  'LOW_ROBUSTNESS',
  'LOW_STABILITY',
  'LOW_DRIVER_CONFIDENCE',
  'NEAR_TIE',
  'INSUFFICIENT_SIGNALS',
];

interface ReasonContext {
  evidenceGapCount: number;
}

function summariseTopReason(reasons: ReadinessToneReason[], ctx: ReasonContext): string | null {
  if (reasons.length === 0) return null;
  const reasonSet = new Set(reasons);
  for (const r of REASON_DISPLAY_ORDER) {
    if (!reasonSet.has(r)) continue;
    if (r === 'EVIDENCE_GAPS') {
      // EVIDENCE_GAPS fires for either ≥2 gaps OR a single gap above the
      // high-VoI threshold. Match the wording to which one applies so the
      // user-facing rationale doesn't falsely claim "multiple" for a single gap.
      return ctx.evidenceGapCount <= 1
        ? 'a decision-relevant evidence gap remains'
        : 'multiple evidence gaps remain';
    }
    return REASON_PHRASES[r];
  }
  return null;
}
