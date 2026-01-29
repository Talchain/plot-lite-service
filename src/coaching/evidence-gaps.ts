/**
 * B2: Evidence Gaps
 *
 * Identifies factors where gathering evidence would most impact the decision.
 */

import type { CoachingInputs, EvidenceGap } from './types.js';

export function computeEvidenceGaps(inputs: CoachingInputs): EvidenceGap[] {
  const { factorSensitivity } = inputs;

  if (factorSensitivity.length === 0) {
    return [];
  }

  // Compute raw impact (prefer elasticity, fallback to influence_score)
  const withImpact = factorSensitivity.map((f) => ({
    ...f,
    rawImpact: Math.abs(f.elasticity ?? f.influence_score ?? 0),
  }));

  // Normalise by max
  const maxImpact = Math.max(...withImpact.map((f) => f.rawImpact), 0.001);
  const normalised = withImpact.map((f) => ({
    ...f,
    normalisedImpact: f.rawImpact / maxImpact,
  }));

  // Compute VoI = normalisedImpact × (1 - confidence)
  const withVoI = normalised.map((f) => ({
    ...f,
    confidence: f.confidence ?? 0.5,
    confidenceDefaulted: f.confidence === undefined,
    voi: f.normalisedImpact * (1 - (f.confidence ?? 0.5)),
  }));

  // Top quartile with min floor of 3
  const k = Math.min(Math.max(Math.ceil(factorSensitivity.length / 4), 3), factorSensitivity.length);
  const gaps = withVoI
    .filter((f) => f.importance_rank <= k && f.confidence < 0.7)
    .sort((a, b) => b.voi - a.voi)
    .slice(0, 3); // Cap at 3

  return gaps.map((f) => ({
    factor_id: f.node_id,
    factor_label: f.label,
    voi_score: f.voi,
    confidence: f.confidence,
    confidence_display: `${Math.round(f.confidence * 100)}%`,
    confidence_defaulted: f.confidenceDefaulted,
    influence: f.normalisedImpact,
    influence_display: `${Math.round(f.normalisedImpact * 100)}%`,
    suggestion: `Gather data on "${f.label}" to reduce uncertainty`,
    notes: f.confidenceDefaulted ? ['Confidence defaulted to 50% (not provided by ISL)'] : [],
  }));
}
