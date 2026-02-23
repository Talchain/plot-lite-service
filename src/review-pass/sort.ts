/**
 * Deterministic bytewise sorting for review pass cards and fact objects.
 *
 * All sorting uses bytewise comparison (< / >) — never localeCompare.
 *
 * Card sort order: (priority ASC, card_type ASC, card_id ASC).
 * Fact sort key: canonicalJson(fact_key) — deterministic string for identity/comparison.
 */

import type { ProposalCardV1 } from './types.js';
import type { FactObjectV1 } from '../facts/types.js';
import { canonicalJson } from '../facts/hash.js';

/**
 * Bytewise string comparison. Used for all deterministic ordering.
 */
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Deterministic sort key for a proposal card.
 * Encodes (priority, card_type, card_id) as a single comparable string.
 * Priorities are always 1–4 (single digit), so string comparison is safe.
 */
export function cardSortKey(card: ProposalCardV1): string {
  return `${card.priority}:${card.card_type}:${card.card_id}`;
}

/**
 * Deterministic identity key for a fact object.
 * Produces canonical JSON of the fact_key (sorted keys, no whitespace).
 * Useful for deduplication, assertions, and stable comparisons.
 */
export function factSortKey(fact: FactObjectV1): string {
  return canonicalJson(fact.fact_key);
}

/**
 * Sort cards in-place by (priority, card_type, card_id).
 * Stable, deterministic ordering using bytewise comparison via cardSortKey.
 */
export function sortCards(cards: ProposalCardV1[]): void {
  cards.sort((a, b) => cmp(cardSortKey(a), cardSortKey(b)));
}
