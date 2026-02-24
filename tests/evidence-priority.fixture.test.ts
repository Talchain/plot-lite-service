/**
 * Evidence Priority Card — Fixture Tests
 *
 * Tests for buildEvidencePriorityCard() and computeConfidenceNormalised().
 */

import { describe, it, expect } from 'vitest';
import {
  buildEvidencePriorityCard,
  computeConfidenceNormalised,
  EVIDENCE_PRIORITY_SUPPRESSION_THRESHOLD,
  ATTRIBUTION_STABILITY_BAND_SCORES,
  type FactorInput,
} from '../src/review-pass/evidence-priority.js';

// =============================================================================
// computeConfidenceNormalised unit tests
// =============================================================================

describe('computeConfidenceNormalised', () => {
  it('returns 0.5 for default (no stability, no edges)', () => {
    const c = computeConfidenceNormalised(undefined, undefined);
    expect(c).toBe(0.5);
  });

  it('returns 0.75 for high stability with no edges', () => {
    // 0.5 * 1.0 + 0.5 * 0.5 = 0.75
    const c = computeConfidenceNormalised('high', undefined);
    expect(c).toBe(0.75);
  });

  it('returns 0.25 for low stability with no edges', () => {
    // 0.5 * 0.0 + 0.5 * 0.5 = 0.25
    const c = computeConfidenceNormalised('low', undefined);
    expect(c).toBe(0.25);
  });

  it('includes mean exists_probability from edges', () => {
    // moderate stability (0.5), edges mean = 0.8
    // 0.5 * 0.5 + 0.5 * 0.8 = 0.65
    const c = computeConfidenceNormalised('moderate', [
      { exists_probability: 0.8 },
      { exists_probability: 0.8 },
    ]);
    expect(c).toBeCloseTo(0.65, 5);
  });

  it('clamps result to [0, 1]', () => {
    // high stability + high edge prob = 0.5*1.0 + 0.5*1.0 = 1.0 (at ceiling)
    const c = computeConfidenceNormalised('high', [{ exists_probability: 1.0 }]);
    expect(c).toBe(1.0);
  });
});

// =============================================================================
// Constants verification
// =============================================================================

describe('evidence priority constants', () => {
  it('suppression threshold is 0.05', () => {
    expect(EVIDENCE_PRIORITY_SUPPRESSION_THRESHOLD).toBe(0.05);
  });

  it('band scores match expected values', () => {
    expect(ATTRIBUTION_STABILITY_BAND_SCORES).toEqual({
      high: 1.0,
      moderate: 0.5,
      low: 0.0,
      negligible: 0.0,
    });
  });
});

// =============================================================================
// Golden Fixtures
// =============================================================================

describe('buildEvidencePriorityCard — fixtures', () => {
  it('Fixture 1: mixed stability factors produce card with correct scores', () => {
    const factors: FactorInput[] = [
      {
        factor_id: 'market_size',
        factor_label: 'Market Size',
        elasticity: 0.9,
        attribution_stability: 'moderate',
        incoming_edges: [{ exists_probability: 0.4 }],
      },
      {
        factor_id: 'competition',
        factor_label: 'Competition',
        elasticity: -0.7,
        attribution_stability: 'low',
        incoming_edges: [{ exists_probability: 0.3 }],
      },
      {
        factor_id: 'regulation',
        factor_label: 'Regulation',
        elasticity: 0.5,
        attribution_stability: 'low',
        incoming_edges: [{ exists_probability: 0.5 }],
      },
    ];

    const card = buildEvidencePriorityCard(factors);
    expect(card).not.toBeNull();
    expect(card!.card_type).toBe('evidence_priority');
    expect(card!.items).toHaveLength(3);
    // All 3 factors should survive suppression with these low-confidence values
    expect(card!.items[0].factor_id).toBe('competition'); // highest score: |0.7| * (1 - 0.15) = 0.595
    expect(card!.items[0].score).toBeGreaterThan(EVIDENCE_PRIORITY_SUPPRESSION_THRESHOLD);
  });

  it('Fixture 2: all factors below threshold returns null', () => {
    const factors: FactorInput[] = [
      {
        factor_id: 'tiny',
        factor_label: 'Tiny Factor',
        elasticity: 0.01,
        attribution_stability: 'high',
        incoming_edges: [{ exists_probability: 0.9 }],
      },
    ];

    const card = buildEvidencePriorityCard(factors);
    expect(card).toBeNull();
  });

  it('Fixture 3: empty factors returns null', () => {
    const card = buildEvidencePriorityCard([]);
    expect(card).toBeNull();
  });

  it('Fixture 4: card fields are well-formed', () => {
    const factors: FactorInput[] = [
      {
        factor_id: 'f1',
        factor_label: 'Factor One',
        elasticity: 0.8,
        attribution_stability: 'low',
        incoming_edges: [{ exists_probability: 0.3 }],
      },
    ];

    const card = buildEvidencePriorityCard(factors)!;
    expect(card.card_id).toMatch(/^ep_/);
    expect(card.review_phase).toBe('post_analysis');
    expect(card.priority).toBe(2);
    expect(card.priority_band).toBe('high');
    expect(card.suggested_action).toBe('add_evidence');
    expect(card.provenance.source).toBe('isl');
    expect(card.supporting_refs).toHaveLength(1);
    expect(card.supporting_refs[0].kind).toBe('fact');
    expect(card.what).toContain('Factor One');
  });

  it('caps items at top 3', () => {
    const factors: FactorInput[] = Array.from({ length: 5 }, (_, i) => ({
      factor_id: `f${i}`,
      factor_label: `Factor ${i}`,
      elasticity: 0.9 - i * 0.1,
      attribution_stability: 'low',
      incoming_edges: [{ exists_probability: 0.2 }],
    }));

    const card = buildEvidencePriorityCard(factors)!;
    expect(card.items).toHaveLength(3);
    // Verify sorted by score descending
    expect(card.items[0].score).toBeGreaterThanOrEqual(card.items[1].score);
    expect(card.items[1].score).toBeGreaterThanOrEqual(card.items[2].score);
  });
});
