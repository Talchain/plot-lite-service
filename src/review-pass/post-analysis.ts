/**
 * Post-analysis review pass — deterministic mapping of FactObjects to cards.
 *
 * Input: FactObjectV1[] from assembleFactObjects()
 * Output: ReviewPassEnvelopeV1 with max 5 cards, sorted deterministically.
 *
 * Mapping rules:
 *   critique (severity >= warning)           → warning card,   priority 2, role: supports
 *   factor_sensitivity (stability === low)   → challenge card, priority 1, role: explains
 *   factor_sensitivity (importance_rank <= 3) → challenge card, priority 2, role: derived_from
 */

import type {
  ProposalCardV1,
  ReviewPassEnvelopeV1,
  SupportingRef,
  CitationRole,
} from './types.js';
import { REVIEW_PASS_SCHEMA_VERSION } from './types.js';
import { sortCards } from './sort.js';
import type {
  FactObjectV1,
  CritiqueFactData,
  FactorSensitivityFactData,
} from '../facts/types.js';

const MAX_CARDS = 5;

/**
 * Generate post-analysis review cards from assembled FactObjects.
 *
 * Deterministic:
 * - card_id derived from fact_type + node_id/option_id
 * - sorted by (priority, card_type, card_id) using bytewise cmp
 * - truncated to max 5
 */
export function generatePostAnalysisReview(
  facts: FactObjectV1[],
): ReviewPassEnvelopeV1 {
  const cards: ProposalCardV1[] = [];

  for (const fact of facts) {
    if (fact.fact_type === 'critique') {
      const data = fact.data as CritiqueFactData;
      if (data.severity === 'warning' || data.severity === 'error' || data.severity === 'blocker') {
        cards.push(buildCritiqueCard(fact, data));
      }
    }

    if (fact.fact_type === 'factor_sensitivity') {
      const data = fact.data as FactorSensitivityFactData;

      // Low-stability drivers → challenge cards
      if (data.attribution_stability === 'low') {
        cards.push(buildLowStabilityCard(fact, data));
      }

      // High-sensitivity drivers (top 3) → challenge cards
      if (data.importance_rank <= 3) {
        cards.push(buildTopDriverCard(fact, data));
      }
    }
  }

  sortCards(cards);

  const totalCandidates = cards.length;
  const truncated = totalCandidates > MAX_CARDS;
  const result = cards.slice(0, MAX_CARDS);

  return {
    review_pass_schema_version: REVIEW_PASS_SCHEMA_VERSION as 1,
    phase: 'post_analysis',
    cards: result,
    truncated,
    total_candidates: totalCandidates,
  };
}

// ---------------------------------------------------------------------------
// Card builders
// ---------------------------------------------------------------------------

function buildCritiqueCard(fact: FactObjectV1, data: CritiqueFactData): ProposalCardV1 {
  const ref: SupportingRef = {
    kind: 'fact',
    id: fact.fact_id,
    role: 'supports' as CitationRole,
  };

  return {
    card_id: `post_critique_${data.id}`,
    card_type: 'warning',
    review_phase: 'post_analysis',
    what: data.message,
    why: data.suggestion ?? `Critique ${data.code} at severity ${data.severity}`,
    supporting_refs: [ref],
    ...(data.affected_node_ids?.length && { affected_node_ids: data.affected_node_ids }),
    priority: 2,
    suggested_action: 'review',
  };
}

function buildLowStabilityCard(
  fact: FactObjectV1,
  data: FactorSensitivityFactData,
): ProposalCardV1 {
  const ref: SupportingRef = {
    kind: 'fact',
    id: fact.fact_id,
    role: 'explains' as CitationRole,
  };

  return {
    card_id: `post_factor_sensitivity_${data.node_id}`,
    card_type: 'challenge',
    review_phase: 'post_analysis',
    what: `Factor "${data.label}" has low attribution stability`,
    why: `Bootstrap analysis shows unstable causal attribution for this driver`,
    supporting_refs: [ref],
    affected_node_ids: [data.node_id],
    priority: 1,
    suggested_action: 'add_evidence',
  };
}

function buildTopDriverCard(
  fact: FactObjectV1,
  data: FactorSensitivityFactData,
): ProposalCardV1 {
  const ref: SupportingRef = {
    kind: 'fact',
    id: fact.fact_id,
    role: 'derived_from' as CitationRole,
  };

  return {
    card_id: `post_factor_importance_${data.node_id}`,
    card_type: 'challenge',
    review_phase: 'post_analysis',
    what: `Factor "${data.label}" is a top driver (rank ${data.importance_rank})`,
    why: `High-importance driver with sensitivity score ${data.sensitivity_score}`,
    supporting_refs: [ref],
    affected_node_ids: [data.node_id],
    priority: 2,
    suggested_action: 'review',
  };
}
