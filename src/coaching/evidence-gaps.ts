/**
 * B2: Evidence Gaps
 *
 * Identifies factors where gathering evidence would most impact the decision.
 */

import type { CoachingInputs, EvidenceGap } from './types.js';
import { computeNormalisedImpact } from './normalise-inputs.js';
import { getThresholds } from './thresholds.js';

export function computeEvidenceGaps(inputs: CoachingInputs): EvidenceGap[] {
  const { factorSensitivity } = inputs;
  const thresholds = getThresholds();

  if (factorSensitivity.length === 0) {
    return [];
  }

  // Use centralized normalised impact (shared with key drivers)
  const normalisedImpactMap = computeNormalisedImpact(factorSensitivity);

  const normalised = factorSensitivity.map((f) => ({
    ...f,
    normalisedImpact: normalisedImpactMap.get(f.node_id) ?? 0,
  }));

  // Compute VoI = normalisedImpact × (1 - confidence)
  const withVoI = normalised.map((f) => ({
    ...f,
    confidence: f.confidence ?? 0.5,
    confidenceDefaulted: f.confidence === undefined,
    voi: f.normalisedImpact * (1 - (f.confidence ?? 0.5)),
  }));

  // Top quartile with min floor from thresholds
  const k = Math.min(Math.max(Math.ceil(factorSensitivity.length / 4), thresholds.evidence_gap_floor), factorSensitivity.length);
  const gaps = withVoI
    .filter((f) => f.importance_rank <= k && f.confidence < 0.7 && f.voi >= thresholds.evidence_gap_min_voi)
    .sort((a, b) => b.voi - a.voi)
    .slice(0, thresholds.evidence_gap_cap); // Cap from thresholds

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
