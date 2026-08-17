/**
 * C3: Readiness Signals
 *
 * Multi-dimensional readiness assessment with scoring breakdown.
 * Score derives FROM overall readiness enum to ensure consistency.
 */

import type { CoachingInputs, Readiness, Critique, EvidenceGap } from './types.js';
import type { CoachingThresholds } from './thresholds.js';

export interface ReadinessSignals {
  /** Overall readiness (from B4, authoritative) */
  overall: Readiness;

  /** Overall numeric score (0-1, derived from enum for consistency) */
  overall_score: number;

  /** Raw computed score before enum alignment (0-1, for transparency/debugging) */
  computed_score_raw: number;

  /** Breakdown by dimension */
  dimensions: {
    evidence_quality: number;
    model_robustness: number;
    framing_quality: number;
  };

  /** Signals contributing to assessment */
  signals: Array<{
    dimension: 'evidence' | 'robustness' | 'framing';
    signal: string;
    impact: 'positive' | 'negative' | 'neutral';
    weight: number;
  }>;
}

/**
 * Compute readiness signals from coaching inputs.
 *
 * @param inputs Normalised coaching inputs
 * @param overallReadiness Authoritative readiness from B4
 * @param critiques Model critiques from B3
 * @param evidenceGaps Evidence gaps from B2
 * @param thresholds Coaching thresholds
 * @returns ReadinessSignals with multi-dimensional breakdown
 */
export function computeReadinessSignals(
  inputs: CoachingInputs,
  overallReadiness: Readiness,
  critiques: Critique[],
  evidenceGaps: EvidenceGap[],
  thresholds: CoachingThresholds
): ReadinessSignals {
  const signals: ReadinessSignals['signals'] = [];

  // 1. Evidence Quality Dimension (0-1)
  const evidenceQuality = computeEvidenceQuality(inputs, evidenceGaps, thresholds, signals);

  // 2. Model Robustness Dimension (0-1)
  const modelRobustness = computeModelRobustness(inputs, thresholds, signals);

  // 3. Framing Quality Dimension (0-1)
  const framingQuality = computeFramingQuality(inputs, critiques, signals);

  // 4. Overall Score (weighted average - raw computed value)
  const computedScoreRaw = 0.4 * evidenceQuality + 0.4 * modelRobustness + 0.2 * framingQuality;

  // 5. Derive score from readiness enum for consistency
  // The enum-derived score is authoritative; raw score is for transparency
  const derivedScore = deriveScoreFromReadiness(overallReadiness);

  return {
    overall: overallReadiness,
    overall_score: Math.round(derivedScore * 100) / 100,
    computed_score_raw: Math.round(computedScoreRaw * 100) / 100,
    dimensions: {
      evidence_quality: Math.round(evidenceQuality * 100) / 100,
      model_robustness: Math.round(modelRobustness * 100) / 100,
      framing_quality: Math.round(framingQuality * 100) / 100,
    },
    signals,
  };
}

/**
 * Derive numeric score from readiness enum (authoritative mapping).
 */
function deriveScoreFromReadiness(readiness: Readiness): number {
  switch (readiness) {
    case 'ready':
      return 0.85; // HIGH
    case 'close_call':
      return 0.55; // MEDIUM
    case 'needs_evidence':
      return 0.35; // LOW
    case 'needs_framing':
      return 0.25; // VERY LOW
    default:
      return 0.5;
  }
}

/**
 * Compute evidence quality score (0-1).
 */
function computeEvidenceQuality(
  inputs: CoachingInputs,
  evidenceGaps: EvidenceGap[],
  thresholds: CoachingThresholds,
  signals: ReadinessSignals['signals']
): number {
  let score = 1.0;

  // Penalty for evidence gaps
  const highGapCount = evidenceGaps.filter((g) => g.voi_score > thresholds.readiness_high_voi_threshold).length;

  if (highGapCount >= thresholds.readiness_high_evidence_gap_count) {
    score -= 0.4;
    signals.push({
      dimension: 'evidence',
      signal: `${highGapCount} high-VoI evidence gaps`,
      impact: 'negative',
      weight: 0.4,
    });
  } else if (evidenceGaps.length > 0) {
    score -= 0.2;
    signals.push({
      dimension: 'evidence',
      signal: `${evidenceGaps.length} evidence gaps`,
      impact: 'negative',
      weight: 0.2,
    });
  }

  // Bonus for high average confidence
  const avgConfidence =
    inputs.factorSensitivity.reduce((sum, f) => sum + (f.confidence ?? 0.5), 0) /
      inputs.factorSensitivity.length || 0.5;

  if (avgConfidence >= 0.75) {
    signals.push({
      dimension: 'evidence',
      signal: `High average confidence (${Math.round(avgConfidence * 100)}%)`,
      impact: 'positive',
      weight: 0.1,
    });
  } else if (avgConfidence < 0.5) {
    score -= 0.2;
    signals.push({
      dimension: 'evidence',
      signal: `Low average confidence (${Math.round(avgConfidence * 100)}%)`,
      impact: 'negative',
      weight: 0.2,
    });
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Compute model robustness score (0-1).
 */
function computeModelRobustness(
  inputs: CoachingInputs,
  thresholds: CoachingThresholds,
  signals: ReadinessSignals['signals']
): number {
  let score = 1.0;

  // Penalty for low stability.
  //
  // The stability value THRESHOLDS the signal but is never printed in it: the
  // quantity is withheld from the wire, so publishing it as prose is the same
  // fabrication the withhold exists to prevent (see the `recommendationStability`
  // doc in ./types.ts). The signal keeps its full discriminating power — low
  // still scores -0.4 and reads negative, high still reads positive — because
  // the classification, not the figure, is what a reader can act on.
  const stability = inputs.robustness.recommendationStability;
  if (stability !== undefined) {
    if (stability < 0.5) {
      score -= 0.4;
      signals.push({
        dimension: 'robustness',
        signal: 'Low recommendation stability',
        impact: 'negative',
        weight: 0.4,
      });
    } else if (stability >= 0.75) {
      signals.push({
        dimension: 'robustness',
        signal: 'High recommendation stability',
        impact: 'positive',
        weight: 0.2,
      });
    }
  } else {
    score -= 0.2;
    signals.push({
      dimension: 'robustness',
      signal: 'Stability metric unavailable',
      impact: 'negative',
      weight: 0.2,
    });
  }

  // Penalty for fragile edges. Presence branch (Codex P1-5): only a MEASURED
  // switchProb can count an edge as fragile; unmeasured edges neither count
  // nor read as "0 = safe".
  const highFragileCount = inputs.fragileEdges.filter(
    (e) => typeof e.switchProb === 'number' && e.switchProb > thresholds.action_fragile_edge_threshold
  ).length;

  if (highFragileCount > 0) {
    score -= 0.3;
    signals.push({
      dimension: 'robustness',
      signal: `${highFragileCount} fragile edges`,
      impact: 'negative',
      weight: 0.3,
    });
  }

  // Bonus for clear margin
  if (inputs.options.length >= 2) {
    const margin = inputs.options[0].winProbability - inputs.options[1].winProbability;
    if (margin >= 0.2) {
      signals.push({
        dimension: 'robustness',
        signal: `Clear ${Math.round(margin * 100)}-point margin`,
        impact: 'positive',
        weight: 0.15,
      });
    }
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Compute framing quality score (0-1).
 */
function computeFramingQuality(
  inputs: CoachingInputs,
  critiques: Critique[],
  signals: ReadinessSignals['signals']
): number {
  let score = 1.0;

  // Penalty for framing critiques
  const framingCritiques = critiques.filter((c) => c.type === 'NARROW_FRAMING');
  if (framingCritiques.length > 0) {
    score -= 0.5;
    signals.push({
      dimension: 'framing',
      signal: 'Narrow framing detected',
      impact: 'negative',
      weight: 0.5,
    });
  }

  // Penalty for missing risk pathway
  const riskCritiques = critiques.filter((c) => c.type === 'MISSING_RISK_PATHWAY');
  if (riskCritiques.length > 0) {
    score -= 0.3;
    signals.push({
      dimension: 'framing',
      signal: 'Missing risk pathway',
      impact: 'negative',
      weight: 0.3,
    });
  }

  // Penalty for anchoring risk
  const anchoringCritiques = critiques.filter((c) => c.type === 'ANCHORING_RISK');
  if (anchoringCritiques.length > 0) {
    score -= 0.2;
    signals.push({
      dimension: 'framing',
      signal: 'Anchoring risk detected',
      impact: 'negative',
      weight: 0.2,
    });
  }

  // Bonus for good framing (multiple options, includes baseline)
  if (inputs.options.length >= 3) {
    signals.push({
      dimension: 'framing',
      signal: `${inputs.options.length} options considered`,
      impact: 'positive',
      weight: 0.1,
    });
  }

  return Math.max(0, Math.min(1, score));
}
