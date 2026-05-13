/**
 * B2: Evidence Gaps
 *
 * Identifies factors where gathering evidence would most impact the decision.
 */

import type { CoachingInputs, EvidenceGap } from './types.js';
import { computeNormalisedImpact } from './normalise-inputs.js';
import { getThresholds } from './thresholds.js';
import { computeEvpiPercentagePoints } from '../lib/evpi-emission.js';

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

  // Compute win probability spread for EVPI heuristic.
  // Heuristic approximation: VOI × win probability spread × 100.
  // Not true counterfactual EVPI. To be replaced when ISL supports
  // per-factor counterfactual EVPI.
  const sortedOptions = [...inputs.options].sort((a, b) => b.winProbability - a.winProbability);
  const winProbSpread = sortedOptions.length >= 2
    ? sortedOptions[0].winProbability - sortedOptions[1].winProbability
    : 0;

  return gaps.map((f) => {
    const node = inputs.graph.nodes.find(n => n.id === f.node_id);
    const os = node?.observed_state;
    // Non-negative EVPI contract — see `src/lib/evpi-emission.ts` for the
    // shared helper and the Howard-1966 rationale. The helper returns
    // `undefined` when either input is missing or non-finite, matching the
    // pre-existing conditional-inclusion pattern below.
    const evpiPp = computeEvpiPercentagePoints(f.voi, winProbSpread);
    return {
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
      ...(os?.value !== undefined && { value: os.value }),
      ...(os?.raw_value !== undefined && { raw_value: os.raw_value }),
      ...(os?.unit !== undefined && { unit: os.unit }),
      ...(os?.cap !== undefined && { cap: os.cap }),
      ...(evpiPp !== undefined && { evpi_percentage_points: evpiPp, evpi_method: 'heuristic' as const }),
    };
  });
}
