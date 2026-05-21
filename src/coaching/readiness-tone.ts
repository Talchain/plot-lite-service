/**
 * D2-tone: Readiness-tone classifier
 *
 * Pure, deterministic classifier that derives a coaching-copy tone from the
 * scientific signals already present in CoachingInputs. Used by D2 executive
 * summary and B4 next-actions to gate over-confident wording when the
 * underlying robustness / fragility / evidence signals do not warrant it.
 *
 * Does NOT alter Readiness semantics — downstream consumers (CEE prompt, DGAI
 * view-model) keep seeing the same Readiness enum.
 */

import type { CoachingInputs, EvidenceGap, HeadlineType, Readiness } from './types.js';
import type { KeyDriver } from './key-drivers.js';
import type { CoachingThresholds } from './thresholds.js';

export type ReadinessTone = 'confident' | 'tempered' | 'caution';

export type ReadinessToneReason =
  | 'NOT_ROBUST'
  | 'LOW_ROBUSTNESS'
  | 'LOW_STABILITY'
  | 'MATERIAL_FRAGILE_EDGE'
  | 'EVIDENCE_GAPS'
  | 'LOW_DRIVER_CONFIDENCE'
  | 'NEAR_TIE'
  | 'INSUFFICIENT_SIGNALS';

export interface ReadinessToneResult {
  tone: ReadinessTone;
  reasons: ReadinessToneReason[];
}

const HARD_REASONS: ReadonlySet<ReadinessToneReason> = new Set<ReadinessToneReason>([
  'NOT_ROBUST',
  'LOW_ROBUSTNESS',
  'LOW_STABILITY',
  'MATERIAL_FRAGILE_EDGE',
  'EVIDENCE_GAPS',
  'LOW_DRIVER_CONFIDENCE',
  'NEAR_TIE',
]);

export function deriveReadinessTone(
  inputs: CoachingInputs,
  _readiness: Readiness,
  _headlineType: HeadlineType,
  keyDrivers: KeyDriver[],
  evidenceGaps: EvidenceGap[],
  thresholds: CoachingThresholds,
): ReadinessToneResult {
  const reasons: ReadinessToneReason[] = [];
  const { robustness, fragileEdges, factorSensitivity, options } = inputs;

  if (robustness.isRobust === false) {
    reasons.push('NOT_ROBUST');
  }

  if (robustness.level === 'low' || robustness.level === 'very_low' || robustness.level === 'moderate') {
    reasons.push('LOW_ROBUSTNESS');
  }

  const stability = robustness.recommendationStability;
  if (stability !== undefined && stability < thresholds.tone_confident_stability_min) {
    reasons.push('LOW_STABILITY');
  }

  const topFragile = pickTopFragile(fragileEdges);
  if (topFragile !== undefined && topFragile.switchProb > thresholds.action_fragile_edge_threshold) {
    reasons.push('MATERIAL_FRAGILE_EDGE');
  }

  // Evidence gaps temper the tone if the count is at-or-above the readiness
  // threshold OR if even a single gap has VoI above the existing high-VoI
  // threshold (one decision-relevant gap is enough to disqualify confident tone).
  const topVoi = evidenceGaps.reduce((max, g) => (g.voi_score > max ? g.voi_score : max), 0);
  const hasGapCountIssue = evidenceGaps.length >= thresholds.readiness_high_evidence_gap_count;
  const hasHighVoiGap = evidenceGaps.length >= 1 && topVoi > thresholds.readiness_high_voi_threshold;
  if (hasGapCountIssue || hasHighVoiGap) {
    reasons.push('EVIDENCE_GAPS');
  }

  const topDriver = keyDrivers[0];
  let topDriverConfidence: number | undefined;
  if (topDriver !== undefined) {
    const factor = factorSensitivity.find((f) => f.node_id === topDriver.factor_id);
    topDriverConfidence = factor?.confidence;
    if (topDriverConfidence !== undefined && topDriverConfidence <= thresholds.tone_low_driver_confidence_max) {
      reasons.push('LOW_DRIVER_CONFIDENCE');
    }
  }

  if (options.length >= 2 && options[0] !== undefined && options[1] !== undefined) {
    const margin = options[0].winProbability - options[1].winProbability;
    if (margin < thresholds.headline_close_call_delta) {
      reasons.push('NEAR_TIE');
    }
  }

  // Missing-data policy: absence of an optional signal does not by itself force
  // tempering, but combined with any other weakness signal we add a
  // conservative INSUFFICIENT_SIGNALS marker so callers can surface it.
  const hasMissingSignal =
    robustness.level === undefined
    || stability === undefined
    || (topDriver !== undefined && topDriverConfidence === undefined);
  if (hasMissingSignal && reasons.length > 0) {
    reasons.push('INSUFFICIENT_SIGNALS');
  }

  const hardCount = reasons.filter((r) => HARD_REASONS.has(r)).length;
  let tone: ReadinessTone;
  if (reasons.length === 0) {
    tone = 'confident';
  } else if (hardCount >= 2) {
    tone = 'caution';
  } else {
    tone = 'tempered';
  }

  return { tone, reasons };
}

function pickTopFragile(
  fragileEdges: CoachingInputs['fragileEdges'],
): CoachingInputs['fragileEdges'][number] | undefined {
  if (fragileEdges.length === 0) return undefined;
  let top = fragileEdges[0];
  for (let i = 1; i < fragileEdges.length; i++) {
    const candidate = fragileEdges[i];
    if (candidate !== undefined && top !== undefined && candidate.switchProb > top.switchProb) {
      top = candidate;
    }
  }
  return top;
}
