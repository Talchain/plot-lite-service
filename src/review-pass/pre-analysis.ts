/**
 * Pre-analysis review pass — deterministic mapping of /validate violations to cards.
 *
 * Input: PLoT /validate violations array
 * Output: ReviewPassEnvelopeV1 with max 5 cards, sorted deterministically.
 *
 * Severity mapping:
 *   error   → structural, priority 1
 *   warning → warning,    priority 2
 *   info    → gap,        priority 3
 *
 * TRUNCATION POLICY (UX decision, not just implementation):
 * - Max 5 cards per review phase
 * - Priority order: severity (critical > high > medium > low)
 * - Secondary: card_type (bytewise), then card_id (bytewise)
 * - truncated: true + total_candidates shown to user
 */

import { createHash } from 'node:crypto';
import type {
  ProposalCardV1,
  ReviewPassEnvelopeV1,
  CardType,
  SupportingRef,
  SuggestedAction,
  PriorityBand,
} from './types.js';
import { REVIEW_PASS_SCHEMA_VERSION, PRIORITY_TO_BAND } from './types.js';
import { cmp, sortCards } from './sort.js';

const MAX_CARDS = 5;

/** Minimal violation shape from /v1/validate. */
export interface ViolationInput {
  code: string;
  severity?: 'error' | 'warning' | 'info';
  path?: string;
  reason?: string;
  at?: {
    node?: string;
    node_id?: string;
    from?: string;
    to?: string;
    [key: string]: unknown;
  };
  suggestion?: string;
}

/**
 * Map violation severity to card_type and priority.
 */
function severityToCard(severity: string): { card_type: CardType; priority: number } {
  switch (severity) {
    case 'error':
      return { card_type: 'structural', priority: 1 };
    case 'warning':
      return { card_type: 'warning', priority: 2 };
    default:
      return { card_type: 'gap', priority: 3 };
  }
}

/**
 * Map violation severity to a suggested action.
 */
function severityToAction(severity: string): SuggestedAction {
  switch (severity) {
    case 'error':
      return 'review';
    case 'warning':
      return 'update_belief';
    default:
      return 'add_evidence';
  }
}

/**
 * Build a deterministic card_id from violation code + affected node IDs.
 * Format: pre_{code}_{hash(sorted_node_ids)}
 */
function buildCardId(code: string, nodeIds: string[]): string {
  const sorted = [...nodeIds].sort(cmp);
  const hash = createHash('sha256').update(sorted.join(',')).digest('hex').slice(0, 8);
  return `pre_${code}_${hash}`;
}

/**
 * Extract affected node IDs from a violation's `at` field.
 */
function extractNodeIds(at?: ViolationInput['at']): string[] {
  if (!at) return [];
  const ids: string[] = [];
  if (at.node) ids.push(at.node);
  if (at.node_id) ids.push(at.node_id);
  return ids;
}

/**
 * Extract affected edge IDs from a violation's `at` field.
 * Returns edges as "{from}_{to}" strings.
 */
function extractEdgeIds(at?: ViolationInput['at']): string[] {
  if (!at || !at.from || !at.to) return [];
  return [`${at.from}_${at.to}`];
}

/**
 * Generate pre-analysis review cards from /validate violations.
 *
 * Deterministic:
 * - card_id derived from violation code + affected nodes
 * - sorted by (priority, card_type, card_id) using bytewise cmp
 * - truncated to max 5
 */
export function generatePreAnalysisReview(
  violations: ViolationInput[],
): ReviewPassEnvelopeV1 {
  const cards: ProposalCardV1[] = violations.map((v) => {
    const severity = v.severity ?? 'error';
    const { card_type, priority } = severityToCard(severity);
    const nodeIds = extractNodeIds(v.at);
    const edgeIds = extractEdgeIds(v.at);

    const ref: SupportingRef = {
      kind: 'violation',
      id: v.code,
    };

    return {
      card_id: buildCardId(v.code, nodeIds),
      card_type,
      review_phase: 'pre_analysis' as const,
      what: v.reason ?? v.code,
      why: v.suggestion ?? `Validation ${severity}: ${v.code}`,
      supporting_refs: [ref],
      ...(nodeIds.length > 0 && { affected_node_ids: nodeIds }),
      ...(edgeIds.length > 0 && { affected_edge_ids: edgeIds }),
      priority,
      priority_band: PRIORITY_TO_BAND[priority] ?? ('low' as PriorityBand),
      suggested_action: severityToAction(severity),
      provenance: { source: 'validate' as const, origin_id: v.code },
    };
  });

  sortCards(cards);

  const totalCandidates = cards.length;
  const truncated = totalCandidates > MAX_CARDS;
  const result = cards.slice(0, MAX_CARDS);

  return {
    review_pass_schema_version: REVIEW_PASS_SCHEMA_VERSION as 1,
    phase: 'pre_analysis',
    cards: result,
    truncated,
    total_candidates: totalCandidates,
  };
}
