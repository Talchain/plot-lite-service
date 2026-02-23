/**
 * Sort Key Helper Tests
 *
 * Verifies cardSortKey and factSortKey produce deterministic, comparable strings.
 *
 * cardSortKey: "${priority}:${card_type}:${card_id}" — used in sortCards implementation
 * factSortKey: canonicalJson(fact_key) — deterministic identity for facts
 */

import { describe, it, expect } from 'vitest';
import { cardSortKey, factSortKey, sortCards, cmp } from '../src/review-pass/sort.js';
import type { ProposalCardV1 } from '../src/review-pass/types.js';
import type { FactObjectV1 } from '../src/facts/types.js';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

function makeCard(overrides: Partial<ProposalCardV1>): ProposalCardV1 {
  return {
    card_id: 'test_card',
    card_type: 'challenge',
    review_phase: 'pre_analysis',
    what: 'Test',
    why: 'Test',
    supporting_refs: [],
    priority: 2,
    priority_band: 'high',
    provenance: { source: 'validate', origin_id: 'test' },
    ...overrides,
  };
}

function makeFact(factKey: Record<string, unknown>): FactObjectV1 {
  return {
    fact_id: 'test_fact',
    fact_key: factKey as any,
    fact_type: (factKey as any).type ?? 'probability',
    data: { type: 'robustness', robustness_level: 'robust', robustness_score: 0.8 } as any,
    lineage: { graph_hash: 'abc', seed: 42, config_version: '1', isl_request_id: 'req1' },
    content_hash: 'deadbeef',
  };
}

// =============================================================================
// cardSortKey
// =============================================================================

describe('cardSortKey', () => {
  it('produces expected format', () => {
    const card = makeCard({ priority: 1, card_type: 'challenge', card_id: 'pre_ERR_abc' });
    expect(cardSortKey(card)).toBe('1:challenge:pre_ERR_abc');
  });

  it('different priorities produce different sort order', () => {
    const critical = makeCard({ priority: 1, card_type: 'challenge', card_id: 'a' });
    const low = makeCard({ priority: 4, card_type: 'challenge', card_id: 'a' });
    expect(cmp(cardSortKey(critical), cardSortKey(low))).toBe(-1);
  });

  it('same priority sorts by card_type', () => {
    const challenge = makeCard({ priority: 2, card_type: 'challenge', card_id: 'a' });
    const warning = makeCard({ priority: 2, card_type: 'warning', card_id: 'a' });
    expect(cmp(cardSortKey(challenge), cardSortKey(warning))).toBe(-1);
  });

  it('same priority and type sorts by card_id', () => {
    const a = makeCard({ priority: 2, card_type: 'gap', card_id: 'alpha' });
    const b = makeCard({ priority: 2, card_type: 'gap', card_id: 'beta' });
    expect(cmp(cardSortKey(a), cardSortKey(b))).toBe(-1);
  });

  it('identical cards produce identical keys', () => {
    const a = makeCard({ priority: 1, card_type: 'fragile', card_id: 'xyz' });
    const b = makeCard({ priority: 1, card_type: 'fragile', card_id: 'xyz' });
    expect(cardSortKey(a)).toBe(cardSortKey(b));
  });
});

// =============================================================================
// sortCards uses cardSortKey
// =============================================================================

describe('sortCards is consistent with cardSortKey ordering', () => {
  it('sortCards produces same order as sorting by cardSortKey', () => {
    const cards = [
      makeCard({ priority: 3, card_type: 'warning', card_id: 'c' }),
      makeCard({ priority: 1, card_type: 'challenge', card_id: 'a' }),
      makeCard({ priority: 2, card_type: 'gap', card_id: 'b' }),
      makeCard({ priority: 1, card_type: 'fragile', card_id: 'a' }),
    ];

    // Sort using sortCards (in-place)
    sortCards(cards);
    const sortedKeys = cards.map(cardSortKey);

    // Verify keys are in ascending order
    for (let i = 1; i < sortedKeys.length; i++) {
      expect(cmp(sortedKeys[i - 1], sortedKeys[i])).toBeLessThanOrEqual(0);
    }
  });

  it('backwards compatibility: priority=1 cards before priority=4 cards', () => {
    const cards = [
      makeCard({ priority: 4, card_type: 'warning', card_id: 'low' }),
      makeCard({ priority: 1, card_type: 'challenge', card_id: 'critical' }),
    ];
    sortCards(cards);
    expect(cards[0].priority).toBe(1);
    expect(cards[1].priority).toBe(4);
  });
});

// =============================================================================
// factSortKey
// =============================================================================

describe('factSortKey', () => {
  it('produces canonical JSON of fact_key', () => {
    const fact = makeFact({ type: 'probability', option_id: 'opt1' });
    const key = factSortKey(fact);
    // canonicalJson sorts keys alphabetically
    expect(key).toBe('{"option_id":"opt1","type":"probability"}');
  });

  it('is stable regardless of property insertion order', () => {
    const a = makeFact({ type: 'probability', option_id: 'opt1', node_id: 'n1' });
    const b = makeFact({ node_id: 'n1', type: 'probability', option_id: 'opt1' });
    expect(factSortKey(a)).toBe(factSortKey(b));
  });

  it('different fact keys produce different sort keys', () => {
    const prob = makeFact({ type: 'probability', option_id: 'opt1' });
    const sens = makeFact({ type: 'factor_sensitivity', node_id: 'factor_a', metric: 'sensitivity_score' });
    expect(factSortKey(prob)).not.toBe(factSortKey(sens));
  });

  it('identical fact keys produce identical sort keys', () => {
    const a = makeFact({ type: 'critique', node_id: 'goal' });
    const b = makeFact({ type: 'critique', node_id: 'goal' });
    expect(factSortKey(a)).toBe(factSortKey(b));
  });

  it('handles optional fields correctly (undefined omitted)', () => {
    const withOptional = makeFact({ type: 'probability', option_id: 'opt1', metric: 'mean' });
    const withoutOptional = makeFact({ type: 'probability', option_id: 'opt1' });
    expect(factSortKey(withOptional)).not.toBe(factSortKey(withoutOptional));
  });
});
