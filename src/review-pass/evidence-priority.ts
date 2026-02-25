/**
 * Evidence Priority Card — Review Pass module
 *
 * Computes a ranked list of factors most likely to change the decision
 * if better evidence were gathered.
 *
 * Score = |elasticity| * (1 - confidence)
 *   where confidence is the unified factor confidence (pre-computed in factor_sensitivity
 *   pipeline via computeUnifiedConfidence). Falls back to inline computation when
 *   pre-computed confidence is not available.
 *
 * Suppression: if max(score) across ALL candidates < EVIDENCE_PRIORITY_SUPPRESSION_THRESHOLD,
 * the entire card is suppressed. Otherwise, top 3 items by score are included.
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
  /** Pre-computed unified confidence. When present, used directly instead of recomputing. */
  confidence?: number;
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
 * Suppression: if max(score) across ALL candidates < threshold, returns null
 * (entire card suppressed). Otherwise returns top 3 items by score.
 */
export function buildEvidencePriorityCard(
  factors: FactorInput[]
): EvidencePriorityCard | null {
  // Compute scores for ALL candidates
  // Use pre-computed unified confidence when available (from factor_sensitivity pipeline),
  // falling back to inline computation for backwards compatibility.
  const allItems: EvidencePriorityItem[] = factors.map(f => {
    const confidence = f.confidence != null
      ? f.confidence
      : computeConfidenceNormalised(f.attribution_stability, f.incoming_edges);
    return {
      factor_id: f.factor_id,
      factor_label: f.factor_label,
      score: Math.abs(f.elasticity) * (1 - confidence),
      confidence_normalised: confidence,
      elasticity: f.elasticity,
    };
  });

  // Suppress entire card if max score < threshold
  const maxScore = allItems.reduce((max, item) => Math.max(max, item.score), 0);
  if (maxScore < EVIDENCE_PRIORITY_SUPPRESSION_THRESHOLD) return null;

  // Sort by score descending, then factor_id ascending for determinism
  allItems.sort((a, b) => {
    const diff = b.score - a.score;
    if (diff !== 0) return diff;
    return a.factor_id < b.factor_id ? -1 : a.factor_id > b.factor_id ? 1 : 0;
  });

  const topItems = allItems.slice(0, MAX_ITEMS);
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
    // NOTE (known asymmetry): These IDs are constructed placeholders
    // (`sensitivity_{factor_id}`), not real fact_id values from assembleFactObjects().
    // V2 /run does not assemble FactObjects — facts only exist in V1 /run_bundle.
    // When the orchestrator's explain_results tool produces CommentaryBlocks with
    // [fact_id] citations, those resolve against facts assembled by CEE from the
    // V2 response, not against facts in the V2 response itself. This is an
    // architectural boundary: PLoT V2 → CEE → FactObjects → citations.
    // Do not spend time debugging "citation doesn't resolve" in A.8 integration
    // testing — this is expected until V2 adopts fact assembly.
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
