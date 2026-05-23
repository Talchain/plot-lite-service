/**
 * D2: Executive Summary
 *
 * One-paragraph summary (2-3 sentences) of decision quality and recommendation.
 * CRITICAL: Never use "confidence" for composite scores (only for probabilities).
 * Use "readiness", "stability", "robustness" instead.
 *
 * Wording is gated by the D2-tone classifier so confident phrasing only appears
 * when robustness / fragility / evidence signals all support it.
 */

import type { CoachingInputs, Readiness, HeadlineType } from './types.js';
import type { KeyDriver } from './key-drivers.js';
import type { EvidenceGap } from './types.js';
import { deriveReadinessTone, type ReadinessTone, type ReadinessToneResult } from './readiness-tone.js';
import { getThresholds } from './thresholds.js';

export interface ExecutiveSummary {
  summary: string;
  decision_statement: string;
  key_qualifier: string;
  action_implication: string;
}

export function generateExecutiveSummary(
  inputs: CoachingInputs,
  readiness: Readiness,
  headlineType: HeadlineType,
  keyDrivers: KeyDriver[],
  evidenceGaps: EvidenceGap[],
  precomputedTone?: ReadinessToneResult,
): ExecutiveSummary {
  const winner = inputs.options[0];
  const runnerUp = inputs.options[1];
  // Reuse the orchestrator-precomputed tone when threaded in so the structured
  // m1_coaching.readiness_tone and this prose share one classification.
  // Direct callers (unit tests) may omit it; we then recompute locally.
  const toneResult = precomputedTone ?? deriveReadinessTone(
    inputs,
    readiness,
    headlineType,
    keyDrivers,
    evidenceGaps,
    getThresholds(),
  );

  const decisionStatement = generateDecisionStatement(winner, runnerUp, headlineType, toneResult.tone);
  const keyQualifier = generateKeyQualifier(
    readiness,
    headlineType,
    inputs,
    keyDrivers,
    evidenceGaps,
    toneResult.tone,
  );
  const actionImplication = generateActionImplication(readiness, evidenceGaps, inputs, toneResult.tone);

  const summary = `${decisionStatement} ${keyQualifier} ${actionImplication}`;

  return {
    summary,
    decision_statement: decisionStatement,
    key_qualifier: keyQualifier,
    action_implication: actionImplication,
  };
}

function generateDecisionStatement(
  winner: { label: string; winProbability: number } | undefined,
  runnerUp: { label: string; winProbability: number } | undefined,
  headlineType: HeadlineType,
  tone: ReadinessTone,
): string {
  if (!winner) {
    return 'Decision analysis incomplete.';
  }

  const margin = runnerUp ? winner.winProbability - runnerUp.winProbability : winner.winProbability;
  const marginPoints = Math.round(margin * 100);

  switch (headlineType) {
    case 'clear_winner':
      if (tone === 'confident') {
        return `${winner.label} has a strong current lead with a ${marginPoints}-point advantage.`;
      }
      if (tone === 'caution') {
        return `${winner.label} currently leads by ${marginPoints} points, but the model is not yet strong enough for an unqualified decision.`;
      }
      return `${winner.label} currently leads by ${marginPoints} points on the current model.`;
    case 'moderate_winner':
      if (tone === 'caution') {
        return `${winner.label} currently leads by ${marginPoints} points, but the model is not yet strong enough for an unqualified decision.`;
      }
      return `${winner.label} currently leads by ${marginPoints} points on the current model.`;
    case 'close_call':
      return `${winner.label} edges ahead by ${marginPoints} points.`;
    case 'high_uncertainty':
      return `${winner.label} currently leads, but the outcome is highly uncertain.`;
    case 'needs_evidence':
      return 'The decision is unclear based on current evidence.';
    default:
      return `${winner.label} is the top option on the current model.`;
  }
}

function generateKeyQualifier(
  readiness: Readiness,
  _headlineType: HeadlineType,
  inputs: CoachingInputs,
  keyDrivers: KeyDriver[],
  evidenceGaps: EvidenceGap[],
  tone: ReadinessTone,
): string {
  const stability = inputs.robustness.recommendationStability;
  const topDriver = keyDrivers[0];
  const topGap = evidenceGaps[0];

  switch (readiness) {
    case 'ready':
      if (tone === 'confident') {
        if (stability !== undefined) {
          return `The current model favours this option on the strongest combination of signals (${Math.round(stability * 100)}% recommendation stability).`;
        }
        return 'The current model favours this option on the strongest combination of signals.';
      }
      if (tone === 'caution') {
        return 'Treat this as a provisional lead until the fragile assumptions are checked.';
      }
      return 'This option leads on the current model, with important caveats.';

    case 'close_call':
      if (stability !== undefined) {
        return `However, the ${Math.round(stability * 100)}% recommendation stability indicates the decision could shift with new information.`;
      }
      return 'However, the outcome is within model uncertainty.';

    case 'needs_evidence':
      if (topGap) {
        return `Key uncertainty: ${topGap.factor_label} has high impact but low evidence quality.`;
      }
      return 'Significant evidence gaps remain.';

    case 'needs_framing':
      return 'The decision framing should be reconsidered before proceeding.';

    default:
      if (topDriver) {
        return `The outcome is primarily driven by ${topDriver.factor_label}.`;
      }
      return 'Additional analysis recommended.';
  }
}

function generateActionImplication(
  readiness: Readiness,
  evidenceGaps: EvidenceGap[],
  _inputs: CoachingInputs,
  tone: ReadinessTone,
): string {
  switch (readiness) {
    case 'ready':
      if (tone === 'confident') {
        return 'It is reasonable to move forward while validating the key assumptions.';
      }
      if (tone === 'caution') {
        return 'Validate the fragile assumptions before treating this as a decision.';
      }
      return 'Before acting, validate the assumptions most likely to change the result.';

    case 'close_call':
      return 'Define tie-breaker criteria or gather additional evidence.';

    case 'needs_evidence':
      if (evidenceGaps.length > 0) {
        const topGap = evidenceGaps[0];
        return `Gather evidence on ${topGap.factor_label} before deciding.`;
      }
      return 'Gather additional evidence before deciding.';

    case 'needs_framing':
      return 'Reconsider the decision framing and alternatives.';

    default:
      return 'Review assumptions before proceeding.';
  }
}

export function deriveExecutiveSummaryTone(
  inputs: CoachingInputs,
  readiness: Readiness,
  headlineType: HeadlineType,
  keyDrivers: KeyDriver[],
  evidenceGaps: EvidenceGap[],
): ReadinessToneResult {
  return deriveReadinessTone(inputs, readiness, headlineType, keyDrivers, evidenceGaps, getThresholds());
}
