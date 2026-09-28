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

import { evidenceAdviceMayName, type CoachingInputs, type Readiness, type HeadlineType } from './types.js';
import type { KeyDriver } from './key-drivers.js';
import type { EvidenceGap } from './types.js';
import { deriveReadinessTone, type ReadinessTone, type ReadinessToneResult } from './readiness-tone.js';
import { getThresholds } from './thresholds.js';
import { NEAR_TIE_THRESHOLD } from '../trust/result-coherence.js';

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

  // ⭐ R13 (AI Quality #72 5872888088; the rule #398 applied to `headline_banded`): inside the near-tie band the gap
  // is within Monte Carlo noise, so this summary names no leader. It is RENDERED (the UI's results section reads
  // `m1_coaching.executive_summary`) and it is `decision_brief.headline`. Served eh4 (gap 0.0175) read "Continue as now
  // currently leads, but the outcome is highly uncertain." The same threshold `near_tie` publishes.
  const nearTie = winner !== undefined && runnerUp !== undefined
    && winner.winProbability - runnerUp.winProbability < NEAR_TIE_THRESHOLD;
  const decisionStatement = nearTie
    ? `Too close to call: ${winner!.label} and ${runnerUp!.label}.`
    : generateDecisionStatement(winner, runnerUp, headlineType, toneResult.tone);
  // A `ready` qualifier or action presumes a leader ("this option leads", "move forward"); on a near tie they are
  // said as the close call they are.
  const phrasingReadiness: Readiness = nearTie && readiness === 'ready' ? 'close_call' : readiness;
  const keyQualifier = generateKeyQualifier(
    phrasingReadiness,
    headlineType,
    inputs,
    keyDrivers,
    evidenceGaps,
    toneResult.tone,
  );
  const actionImplication = generateActionImplication(phrasingReadiness, evidenceGaps, inputs, toneResult.tone);

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
  // NB: recommendationStability is deliberately NOT read here any more. It still
  // grounds this wording — via the D2-tone classifier in readiness-tone.ts, which
  // thresholds it — but the qualifier no longer needs the raw value now that it
  // publishes no figure. See the `recommendationStability` doc in ./types.ts.
  const topDriver = keyDrivers[0];
  const measuredGap = evidenceGaps.find((g) => evidenceAdviceMayName(inputs, g.factor_id));

  switch (readiness) {
    case 'ready':
      if (tone === 'confident') {
        // No stability FIGURE here (or below): the quantity is withheld from the
        // wire, so publishing it as prose is the same fabrication — see the
        // `recommendationStability` doc in ./types.ts. The claim is qualitative
        // and the tone gate above is what grounds it, so the sentence is now the
        // same whether or not ISL supplied the number.
        return 'The current model favours this option on the strongest combination of signals.';
      }
      if (tone === 'caution') {
        return 'Treat this as a provisional lead until the fragile assumptions are checked.';
      }
      return 'This option leads on the current model, with important caveats.';

    case 'close_call':
      // Keeps BOTH halves of what the figure-bearing sentence conveyed — that
      // the outcome sits inside model uncertainty, and the actionable
      // consequence that the ranking can still move — while publishing no
      // withheld figure. Grounded in the `close_call` readiness classification
      // itself, not in the suppressed number.
      return 'However, the outcome is within model uncertainty, so the ranking could shift with new information.';

    case 'needs_evidence':
      // AIQ 5866850180: name a gap only when its EVPPI was MEASURED above resolution (the first measured one).
      if (measuredGap) {
        return `Key uncertainty: ${measuredGap.factor_label} has high impact but low evidence quality.`;
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
      // AIQ 5866850180: "Gather evidence on X before deciding" only when X's EVPPI was MEASURED above resolution.
      {
        const measuredGap = evidenceGaps.find((g) => evidenceAdviceMayName(_inputs, g.factor_id));
        if (measuredGap) return `Gather evidence on ${measuredGap.factor_label} before deciding.`;
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
