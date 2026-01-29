/**
 * D2: Executive Summary
 *
 * One-paragraph summary (2-3 sentences) of decision quality and recommendation.
 * CRITICAL: Never use "confidence" for composite scores (only for probabilities).
 * Use "readiness", "stability", "robustness" instead.
 */

import type { CoachingInputs, Readiness, HeadlineType } from './types.js';
import type { KeyDriver } from './key-drivers.js';
import type { EvidenceGap } from './types.js';

export interface ExecutiveSummary {
  summary: string;
  decision_statement: string;
  key_qualifier: string;
  action_implication: string;
}

/**
 * Generate executive summary from coaching components.
 *
 * @param inputs Normalised coaching inputs
 * @param readiness Overall readiness
 * @param headlineType Headline type from B1
 * @param keyDrivers Top drivers from D1
 * @param evidenceGaps Evidence gaps from B2
 * @returns ExecutiveSummary with structured text
 */
export function generateExecutiveSummary(
  inputs: CoachingInputs,
  readiness: Readiness,
  headlineType: HeadlineType,
  keyDrivers: KeyDriver[],
  evidenceGaps: EvidenceGap[]
): ExecutiveSummary {
  const winner = inputs.options[0];
  const runnerUp = inputs.options[1];

  // Decision statement
  const decisionStatement = generateDecisionStatement(winner, runnerUp, headlineType);

  // Key qualifier (based on readiness and headline type)
  const keyQualifier = generateKeyQualifier(
    readiness,
    headlineType,
    inputs,
    keyDrivers,
    evidenceGaps
  );

  // Action implication
  const actionImplication = generateActionImplication(readiness, evidenceGaps, inputs);

  // Combine into summary
  const summary = `${decisionStatement} ${keyQualifier} ${actionImplication}`;

  return {
    summary,
    decision_statement: decisionStatement,
    key_qualifier: keyQualifier,
    action_implication: actionImplication,
  };
}

/**
 * Generate decision statement (who wins and by how much).
 */
function generateDecisionStatement(
  winner: { label: string; winProbability: number } | undefined,
  runnerUp: { label: string; winProbability: number } | undefined,
  headlineType: HeadlineType
): string {
  if (!winner) {
    return 'Decision analysis incomplete.';
  }

  const margin = runnerUp ? winner.winProbability - runnerUp.winProbability : winner.winProbability;
  const marginPoints = Math.round(margin * 100);

  switch (headlineType) {
    case 'clear_winner':
      return `${winner.label} is the clear winner with a ${marginPoints}-point advantage.`;
    case 'moderate_winner':
      return `${winner.label} leads by ${marginPoints} points.`;
    case 'close_call':
      return `${winner.label} edges ahead by ${marginPoints} points.`;
    case 'high_uncertainty':
      return `${winner.label} currently leads, but the outcome is highly uncertain.`;
    case 'needs_evidence':
      return 'The decision is unclear based on current evidence.';
    default:
      return `${winner.label} is the top option.`;
  }
}

/**
 * Generate key qualifier (what affects reliability).
 * CRITICAL: Use "stability", "robustness", "readiness" - NEVER "confidence" for composite scores.
 */
function generateKeyQualifier(
  readiness: Readiness,
  headlineType: HeadlineType,
  inputs: CoachingInputs,
  keyDrivers: KeyDriver[],
  evidenceGaps: EvidenceGap[]
): string {
  const stability = inputs.robustness.recommendationStability;
  const topDriver = keyDrivers[0];
  const topGap = evidenceGaps[0];

  switch (readiness) {
    case 'ready':
      if (stability !== undefined && stability >= 0.75) {
        return `The recommendation has high stability (${Math.round(stability * 100)}%) and is ready to proceed.`;
      }
      return 'The recommendation is robust and ready to proceed.';

    case 'close_call':
      if (stability !== undefined) {
        return `However, the ${Math.round(stability * 100)}% stability score indicates the decision could shift with new information.`;
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

/**
 * Generate action implication (what to do next).
 */
function generateActionImplication(
  readiness: Readiness,
  evidenceGaps: EvidenceGap[],
  inputs: CoachingInputs
): string {
  switch (readiness) {
    case 'ready':
      return 'Proceed with implementation.';

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
