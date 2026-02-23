/**
 * Deterministic bytewise sorting for review pass cards.
 *
 * All sorting uses bytewise comparison (< / >) — never localeCompare.
 * Sort order: (priority ASC, card_type ASC, card_id ASC).
 */

import type { ProposalCardV1 } from './types.js';

/**
 * Bytewise string comparison. Used for all deterministic ordering.
 */
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Sort cards in-place by (priority, card_type, card_id).
 * Stable, deterministic ordering using bytewise comparison.
 */
export function sortCards(cards: ProposalCardV1[]): void {
  cards.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.card_type !== b.card_type) return cmp(a.card_type, b.card_type);
    return cmp(a.card_id, b.card_id);
  });
}
