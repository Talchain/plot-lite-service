/**
 * Tests for post-analysis review pass.
 *
 * Verifies:
 * - Critiques → warning cards with role: 'supports'
 * - Low-stability → challenge cards with role: 'explains'
 * - Top drivers → challenge cards with role: 'derived_from'
 * - Deterministic card_id
 * - Priority sorting
 * - Truncation
 */

import { describe, it, expect } from 'vitest';
import { generatePostAnalysisReview } from '../src/review-pass/post-analysis.js';
import type { FactObjectV1, FactLineage } from '../src/facts/types.js';
import type { ReviewPassEnvelopeV1 } from '../src/review-pass/types.js';

const LINEAGE: FactLineage = {
  graph_hash: 'a1b2c3d4e5f6a7b8',
  seed: 4242,
  config_version: '1',
  isl_request_id: 'req-test-001',
};

function makeCritiqueFact(overrides: Partial<{
  id: string;
  code: string;
  severity: string;
  message: string;
  suggestion: string;
  affected_node_ids: string[];
}>): FactObjectV1 {
  const id = overrides.id ?? 'crit_001';
  return {
    fact_id: `fact_${id}`,
    fact_key: { type: 'critique', node_id: id, metric: overrides.code ?? 'MISSING_EVIDENCE' },
    fact_type: 'critique',
    data: {
      type: 'critique',
      id,
      code: overrides.code ?? 'MISSING_EVIDENCE',
      severity: (overrides.severity ?? 'warning') as any,
      message: overrides.message ?? 'Test critique message',
      ...(overrides.suggestion && { suggestion: overrides.suggestion }),
      ...(overrides.affected_node_ids && { affected_node_ids: overrides.affected_node_ids }),
    },
    lineage: LINEAGE,
    content_hash: 'deadbeef12345678',
  };
}

function makeSensitivityFact(overrides: Partial<{
  node_id: string;
  label: string;
  sensitivity_score: number;
  importance_rank: number;
  attribution_stability: string;
}>): FactObjectV1 {
  const nodeId = overrides.node_id ?? 'market_demand';
  return {
    fact_id: `fact_${nodeId}`,
    fact_key: { type: 'factor_sensitivity', node_id: nodeId, metric: 'sensitivity_score' },
    fact_type: 'factor_sensitivity',
    data: {
      type: 'factor_sensitivity',
      node_id: nodeId,
      label: overrides.label ?? nodeId,
      sensitivity_score: overrides.sensitivity_score ?? 0.85,
      // `importance_score` removed — family-4 slice 0 (2026-07-27). It was a
      // synthesised alias of `sensitivity_score` and is no longer a member of
      // FactorSensitivityFactData.
      importance_rank: overrides.importance_rank ?? 1,
      elasticity: 0.72,
      direction: 'positive',
      confidence: 0.9,
      attribution_stability: (overrides.attribution_stability ?? 'high') as any,
    },
    lineage: LINEAGE,
    content_hash: 'cafebabe12345678',
  };
}

describe('generatePostAnalysisReview', () => {
  it('maps critique (severity >= warning) to warning card with role: supports', () => {
    const facts = [makeCritiqueFact({ severity: 'warning', message: 'Missing evidence for node' })];
    const result = generatePostAnalysisReview(facts);

    expect(result.review_pass_schema_version).toBe(1);
    expect(result.phase).toBe('post_analysis');
    expect(result.cards).toHaveLength(1);

    const card = result.cards[0];
    expect(card.card_type).toBe('warning');
    expect(card.review_phase).toBe('post_analysis');
    expect(card.what).toBe('Missing evidence for node');
    expect(card.supporting_refs).toHaveLength(1);
    expect(card.supporting_refs[0].kind).toBe('fact');
    expect(card.supporting_refs[0].role).toBe('supports');
    expect(card.priority).toBe(2);
    expect(card.suggested_action).toBe('review');
  });

  it('maps error critique to warning card', () => {
    const facts = [makeCritiqueFact({ severity: 'error', message: 'Critical issue' })];
    const result = generatePostAnalysisReview(facts);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].card_type).toBe('warning');
  });

  it('maps blocker critique to warning card', () => {
    const facts = [makeCritiqueFact({ severity: 'blocker', message: 'Blocker issue' })];
    const result = generatePostAnalysisReview(facts);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].card_type).toBe('warning');
  });

  it('skips info-severity critiques', () => {
    const facts = [makeCritiqueFact({ severity: 'info', message: 'Info note' })];
    const result = generatePostAnalysisReview(facts);
    expect(result.cards).toHaveLength(0);
  });

  it('maps low-stability factor to challenge card with role: explains', () => {
    const facts = [makeSensitivityFact({
      node_id: 'market_demand',
      label: 'Market Demand',
      attribution_stability: 'low',
      importance_rank: 5, // not in top 3
    })];
    const result = generatePostAnalysisReview(facts);

    // Should produce exactly 1 card (low stability)
    expect(result.cards).toHaveLength(1);
    const card = result.cards[0];
    expect(card.card_type).toBe('challenge');
    expect(card.card_id).toBe('post_factor_sensitivity_market_demand');
    expect(card.what).toContain('low attribution stability');
    expect(card.supporting_refs[0].role).toBe('explains');
    expect(card.priority).toBe(1);
    expect(card.affected_node_ids).toEqual(['market_demand']);
    expect(card.suggested_action).toBe('add_evidence');
  });

  it('maps top-3 driver to challenge card with role: derived_from', () => {
    const facts = [makeSensitivityFact({
      node_id: 'price_sensitivity',
      label: 'Price Sensitivity',
      importance_rank: 2,
      attribution_stability: 'high', // not low
    })];
    const result = generatePostAnalysisReview(facts);

    expect(result.cards).toHaveLength(1);
    const card = result.cards[0];
    expect(card.card_type).toBe('challenge');
    expect(card.card_id).toBe('post_factor_importance_price_sensitivity');
    expect(card.what).toContain('top driver');
    expect(card.what).toContain('rank 2');
    expect(card.supporting_refs[0].role).toBe('derived_from');
    expect(card.priority).toBe(2);
    expect(card.suggested_action).toBe('review');
  });

  it('generates both cards for low-stability top driver', () => {
    const facts = [makeSensitivityFact({
      node_id: 'x',
      label: 'Factor X',
      importance_rank: 1,
      attribution_stability: 'low',
    })];
    const result = generatePostAnalysisReview(facts);

    // Low stability (priority 1) + top driver (priority 2) = 2 cards
    expect(result.cards).toHaveLength(2);
    expect(result.cards[0].priority).toBe(1); // low stability first
    expect(result.cards[0].supporting_refs[0].role).toBe('explains');
    expect(result.cards[1].priority).toBe(2); // top driver second
    expect(result.cards[1].supporting_refs[0].role).toBe('derived_from');
  });

  it('deterministic card_id for critiques', () => {
    const facts = [makeCritiqueFact({ id: 'crit_abc', code: 'MISSING_DATA' })];
    const r1 = generatePostAnalysisReview(facts);
    const r2 = generatePostAnalysisReview(facts);

    expect(r1.cards[0].card_id).toBe('post_critique_crit_abc');
    expect(r1.cards[0].card_id).toBe(r2.cards[0].card_id);
  });

  it('sorts by (priority, card_type, card_id)', () => {
    const facts = [
      makeSensitivityFact({ node_id: 'b', label: 'B', importance_rank: 2, attribution_stability: 'high' }),   // priority 2
      makeSensitivityFact({ node_id: 'a', label: 'A', importance_rank: 10, attribution_stability: 'low' }),    // priority 1
      makeCritiqueFact({ id: 'c', severity: 'warning', message: 'C' }), // priority 2
    ];
    const result = generatePostAnalysisReview(facts);

    expect(result.cards[0].priority).toBe(1); // low stability
    // Remaining are priority 2, sorted by card_type then card_id
    expect(result.cards.slice(1).every((c) => c.priority === 2)).toBe(true);
  });

  it('truncates to max 5 and tracks total', () => {
    const facts: FactObjectV1[] = [];
    // 6 low-stability factors → 6 cards each + 6 top-driver cards = 12 cards total
    for (let i = 0; i < 6; i++) {
      facts.push(makeSensitivityFact({
        node_id: `node_${i}`,
        label: `Node ${i}`,
        importance_rank: i + 1,
        attribution_stability: 'low',
      }));
    }
    const result = generatePostAnalysisReview(facts);

    expect(result.cards).toHaveLength(5);
    expect(result.truncated).toBe(true);
    // 6 low-stability cards + 3 top-driver cards (ranks 1-3) = 9 total
    expect(result.total_candidates).toBe(9);
  });

  it('handles empty facts', () => {
    const result = generatePostAnalysisReview([]);
    expect(result.cards).toHaveLength(0);
    expect(result.truncated).toBe(false);
    expect(result.total_candidates).toBe(0);
    expect(result.phase).toBe('post_analysis');
  });

  it('skips probability and robustness facts (no card mapping)', () => {
    const facts: FactObjectV1[] = [
      {
        fact_id: 'fact_prob',
        fact_key: { type: 'probability', option_id: 'opt_a' },
        fact_type: 'probability',
        data: {
          type: 'probability',
          option_id: 'opt_a',
          option_label: 'Option A',
          p10: 80,
          p50: 100,
          p90: 120,
          mean: 100,
        },
        lineage: LINEAGE,
        content_hash: 'abcdef1234567890',
      },
      {
        fact_id: 'fact_robust',
        fact_key: { type: 'robustness', metric: 'robustness_score' },
        fact_type: 'robustness',
        data: {
          type: 'robustness',
          robustness_level: 'moderate',
          robustness_score: 0.65,
        },
        lineage: LINEAGE,
        content_hash: '1234567890abcdef',
      },
    ];
    const result = generatePostAnalysisReview(facts);
    expect(result.cards).toHaveLength(0);
  });

  it('includes affected_node_ids from critique data', () => {
    const facts = [makeCritiqueFact({
      severity: 'warning',
      affected_node_ids: ['node_a', 'node_b'],
    })];
    const result = generatePostAnalysisReview(facts);
    expect(result.cards[0].affected_node_ids).toEqual(['node_a', 'node_b']);
  });

  it('all fact refs include role (discriminated type enforcement)', () => {
    const facts = [
      makeCritiqueFact({ severity: 'warning' }),
      makeSensitivityFact({ node_id: 'a', importance_rank: 1, attribution_stability: 'low' }),
    ];
    const result = generatePostAnalysisReview(facts);

    for (const card of result.cards) {
      for (const ref of card.supporting_refs) {
        if (ref.kind === 'fact') {
          // FactRef requires role — verify it's always present
          expect(ref.role).toBeDefined();
          expect(['supports', 'explains', 'derived_from']).toContain(ref.role);
        }
      }
    }
  });

  it('full sort tuple: (priority, card_type, card_id)', () => {
    // Two factors: same priority, same card_type, differ by card_id
    const facts = [
      makeSensitivityFact({ node_id: 'z_node', label: 'Z', importance_rank: 1, attribution_stability: 'high' }),
      makeSensitivityFact({ node_id: 'a_node', label: 'A', importance_rank: 2, attribution_stability: 'high' }),
    ];
    const result = generatePostAnalysisReview(facts);

    // Both are challenge cards, priority 2 (top drivers)
    // card_ids: post_factor_importance_a_node < post_factor_importance_z_node (bytewise)
    expect(result.cards[0].card_id).toBe('post_factor_importance_a_node');
    expect(result.cards[1].card_id).toBe('post_factor_importance_z_node');
  });

  it('cards include priority_band matching priority', () => {
    const facts = [
      makeSensitivityFact({ node_id: 'a', label: 'A', importance_rank: 1, attribution_stability: 'low' }),
      makeCritiqueFact({ severity: 'warning' }),
    ];
    const result = generatePostAnalysisReview(facts);

    // low-stability card: priority 1 → critical
    expect(result.cards[0].priority_band).toBe('critical');
    // top-driver and critique cards: priority 2 → high
    const highBands = result.cards.filter((c) => c.priority === 2);
    expect(highBands.every((c) => c.priority_band === 'high')).toBe(true);
  });

  it('cards include provenance with source=isl and fact_id as origin_id', () => {
    const facts = [
      makeSensitivityFact({ node_id: 'x', label: 'X', importance_rank: 1, attribution_stability: 'low' }),
    ];
    const result = generatePostAnalysisReview(facts);

    // Low stability card
    expect(result.cards[0].provenance.source).toBe('isl');
    expect(result.cards[0].provenance.origin_id).toBe('fact_x');

    // Top driver card
    expect(result.cards[1].provenance.source).toBe('isl');
    expect(result.cards[1].provenance.origin_id).toBe('fact_x');
  });
});
