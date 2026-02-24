/**
 * Evidence Priority Card — Review Pass module
 *
 * Computes a ranked list of factors most likely to change the decision
 * if better evidence were gathered. Uses attribution stability and edge
 * existence probability as confidence signals.
 *
 * Score = |elasticity| * (1 - confidence_normalised)
 *   where confidence_normalised = 0.5 * band_score + 0.5 * mean(exists_probability)
 *
 * Factors below EVIDENCE_PRIORITY_SUPPRESSION_THRESHOLD are suppressed.
 */

import type { ProposalCardV1, PriorityBand, CardProvenance } from './types.js';
import { lookupBand } from './types.js';

// =============================================================================
// Types
// =============================================================================

export interface FactorInput {
  factor_id: string;
  factor_label: string;
  elasticity: number;
  attribution_stability?: string; // 'high' | 'moderate' | 'low' | 'negligible'
  incoming_edges?: Array<{ exists_probability: number }>;
}

export interface EvidencePriorityItem {
  factor_id: string;
  factor_label: string;
  score: number;
  confidence_normalised: number;
  elasticity: number;
}

export interface EvidencePriorityCard extends ProposalCardV1 {
  card_type: 'evidence_priority';
  items: EvidencePriorityItem[];
}

// =============================================================================
// Constants
// =============================================================================

export const EVIDENCE_PRIORITY_SUPPRESSION_THRESHOLD = 0.05;

export const ATTRIBUTION_STABILITY_BAND_SCORES: Record<string, number> = {
  high: 1.0,
  moderate: 0.5,
  low: 0.0,
  negligible: 0.0,
};

const DEFAULT_BAND_SCORE = 0.5;
const MAX_ITEMS = 3;

// =============================================================================
// Computation
// =============================================================================

/**
 * Compute normalised confidence for a factor.
 *
 * confidence_normalised = 0.5 * band_score + 0.5 * mean(exists_probability)
 *
 * Clamped to [0, 1].
 */
export function computeConfidenceNormalised(
  attributionStability: string | undefined,
  incomingEdges: Array<{ exists_probability: number }> | undefined
): number {
  const bandScore = attributionStability !== undefined
    ? (ATTRIBUTION_STABILITY_BAND_SCORES[attributionStability] ?? DEFAULT_BAND_SCORE)
    : DEFAULT_BAND_SCORE;

  let meanExistsProb = 0.5; // default when no edges
  if (incomingEdges && incomingEdges.length > 0) {
    const sum = incomingEdges.reduce((acc, e) => acc + e.exists_probability, 0);
    meanExistsProb = sum / incomingEdges.length;
  }

  const raw = 0.5 * bandScore + 0.5 * meanExistsProb;
  return Math.max(0, Math.min(1, raw));
}

/**
 * Build an EvidencePriorityCard from factor inputs.
 *
 * Returns null if no factors survive suppression.
 */
export function buildEvidencePriorityCard(
  factors: FactorInput[]
): EvidencePriorityCard | null {
  const items: EvidencePriorityItem[] = [];

  for (const f of factors) {
    const confidence = computeConfidenceNormalised(
      f.attribution_stability,
      f.incoming_edges
    );
    const score = Math.abs(f.elasticity) * (1 - confidence);

    if (score >= EVIDENCE_PRIORITY_SUPPRESSION_THRESHOLD) {
      items.push({
        factor_id: f.factor_id,
        factor_label: f.factor_label,
        score,
        confidence_normalised: confidence,
        elasticity: f.elasticity,
      });
    }
  }

  if (items.length === 0) return null;

  // Sort by score descending, then factor_id ascending for determinism
  items.sort((a, b) => {
    const diff = b.score - a.score;
    if (diff !== 0) return diff;
    return a.factor_id < b.factor_id ? -1 : a.factor_id > b.factor_id ? 1 : 0;
  });

  const topItems = items.slice(0, MAX_ITEMS);
  const topFactorLabels = topItems.map(i => i.factor_label).join(', ');

  const priority = 2;
  const priorityBand: PriorityBand = lookupBand(priority);
  const provenance: CardProvenance = {
    source: 'isl',
    origin_id: 'evidence_priority',
  };

  return {
    card_id: `ep_${topItems.map(i => i.factor_id).join('_')}`,
    card_type: 'evidence_priority',
    review_phase: 'post_analysis',
    what: `Gathering better evidence on ${topFactorLabels} could change the recommendation.`,
    why: `These factors have high sensitivity but low confidence — better data would most improve decision quality.`,
    supporting_refs: topItems.map(i => ({
      kind: 'fact' as const,
      id: `sensitivity_${i.factor_id}`,
      role: 'derived_from' as const,
    })),
    priority,
    priority_band: priorityBand,
    suggested_action: 'add_evidence',
    provenance,
    items: topItems,
  };
}
