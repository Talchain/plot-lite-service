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

  it('uses 0.5 default for missing attribution_stability (band_score)', () => {
    // undefined stability → band_score = 0.5, no edges → mean = 0.5
    // 0.5 * 0.5 + 0.5 * 0.5 = 0.5
    const c = computeConfidenceNormalised(undefined, undefined);
    expect(c).toBe(0.5);
  });

  it('uses 0.5 default for root node (no incoming edges)', () => {
    // low stability → band_score = 0.0, no edges → mean = 0.5
    // 0.5 * 0.0 + 0.5 * 0.5 = 0.25
    const c = computeConfidenceNormalised('low', []);
    expect(c).toBe(0.25);
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
// buildEvidencePriorityCard tests
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
    // All 3 factors have low confidence → survive per-item suppression
    expect(card!.items[0].factor_id).toBe('competition'); // highest score: |0.7| * (1 - 0.15) = 0.595
    expect(card!.items[0].score).toBeGreaterThan(EVIDENCE_PRIORITY_SUPPRESSION_THRESHOLD);
  });

  it('Fixture 2: all factors below threshold returns null (max-score suppression)', () => {
    const factors: FactorInput[] = [
      {
        factor_id: 'tiny',
        factor_label: 'Tiny Factor',
        elasticity: 0.01,
        attribution_stability: 'high',
        incoming_edges: [{ exists_probability: 0.9 }],
      },
    ];

    // max score = |0.01| * (1 - 0.95) = 0.0005 < 0.05 — entire card suppressed
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

  it('Fixture 5: max-score suppression — card suppressed when all scores below threshold', () => {
    // All high-confidence factors: scores will be tiny
    const factors: FactorInput[] = [
      {
        factor_id: 'stable_a',
        factor_label: 'Stable A',
        elasticity: 0.1,
        attribution_stability: 'high',
        incoming_edges: [{ exists_probability: 0.95 }],
      },
      {
        factor_id: 'stable_b',
        factor_label: 'Stable B',
        elasticity: 0.05,
        attribution_stability: 'high',
        incoming_edges: [{ exists_probability: 0.9 }],
      },
    ];

    // stable_a: |0.1| * (1 - (0.5*1.0 + 0.5*0.95)) = 0.1 * 0.025 = 0.0025
    // stable_b: |0.05| * (1 - (0.5*1.0 + 0.5*0.9)) = 0.05 * 0.05 = 0.0025
    // max = 0.0025 < 0.05 → null
    const card = buildEvidencePriorityCard(factors);
    expect(card).toBeNull();
  });

  it('Fixture 6: high-confidence items suppressed per-item (confidence >= 0.7)', () => {
    const factors: FactorInput[] = [
      {
        factor_id: 'high_impact',
        factor_label: 'High Impact',
        elasticity: 0.9,
        attribution_stability: 'low',
        incoming_edges: [{ exists_probability: 0.3 }],
      },
      {
        factor_id: 'low_impact',
        factor_label: 'Low Impact',
        elasticity: 0.02,
        attribution_stability: 'high',
        incoming_edges: [{ exists_probability: 0.95 }],
      },
    ];

    // high_impact: confidence = 0.5*0.0 + 0.5*0.3 = 0.15 → eligible (< 0.7)
    // low_impact:  confidence = 0.5*1.0 + 0.5*0.95 = 0.975 → suppressed (>= 0.7)
    const card = buildEvidencePriorityCard(factors);
    expect(card).not.toBeNull();
    // Only high_impact survives per-item suppression
    expect(card!.items).toHaveLength(1);
    expect(card!.items[0].factor_id).toBe('high_impact');
  });
});

// =============================================================================
// New spec-required tests (R.1)
// =============================================================================

describe('buildEvidencePriorityCard — item fields', () => {
  it('items include node_id, sensitivity_rank, sensitivity_value, suggested_evidence', () => {
    const factors: FactorInput[] = [
      {
        factor_id: 'market_size',
        factor_label: 'Market Size',
        elasticity: 0.9,
        attribution_stability: 'low',
        incoming_edges: [{ exists_probability: 0.3 }],
      },
      {
        factor_id: 'competition',
        factor_label: 'Competition',
        elasticity: -0.7,
        attribution_stability: 'low',
        incoming_edges: [{ exists_probability: 0.2 }],
      },
    ];

    const card = buildEvidencePriorityCard(factors)!;
    expect(card).not.toBeNull();

    const item = card.items[0];
    expect(item.node_id).toBe(item.factor_id);
    expect(typeof item.sensitivity_rank).toBe('number');
    expect(item.sensitivity_rank).toBeGreaterThanOrEqual(1);
    expect(item.sensitivity_value).toBe(Math.abs(item.elasticity));
    expect(typeof item.suggested_evidence).toBe('string');
    expect(item.suggested_evidence.length).toBeGreaterThan(0);
  });

  it('sensitivity_rank reflects abs(elasticity) ordering', () => {
    const factors: FactorInput[] = [
      { factor_id: 'small', factor_label: 'Small', elasticity: 0.1, attribution_stability: 'low', incoming_edges: [{ exists_probability: 0.2 }] },
      { factor_id: 'large', factor_label: 'Large', elasticity: -0.9, attribution_stability: 'low', incoming_edges: [{ exists_probability: 0.2 }] },
      { factor_id: 'medium', factor_label: 'Medium', elasticity: 0.5, attribution_stability: 'low', incoming_edges: [{ exists_probability: 0.2 }] },
    ];

    const card = buildEvidencePriorityCard(factors)!;
    // large has highest |elasticity| → rank 1
    const largeItem = card.items.find(i => i.factor_id === 'large')!;
    const mediumItem = card.items.find(i => i.factor_id === 'medium')!;
    const smallItem = card.items.find(i => i.factor_id === 'small')!;
    expect(largeItem.sensitivity_rank).toBe(1);
    expect(mediumItem.sensitivity_rank).toBe(2);
    expect(smallItem.sensitivity_rank).toBe(3);
  });

  it('suggested_evidence uses low-confidence template when confidence < 0.4', () => {
    const factors: FactorInput[] = [
      {
        factor_id: 'f1',
        factor_label: 'Revenue Growth',
        elasticity: 0.8,
        attribution_stability: 'low',
        incoming_edges: [{ exists_probability: 0.2 }],
        // confidence = 0.5*0.0 + 0.5*0.2 = 0.1 < 0.4
      },
    ];

    const card = buildEvidencePriorityCard(factors)!;
    expect(card.items[0].suggested_evidence).toContain('confidence in its strength is low');
  });

  it('suggested_evidence uses medium-confidence template when 0.4 <= confidence < 0.7', () => {
    const factors: FactorInput[] = [
      {
        factor_id: 'f1',
        factor_label: 'Revenue Growth',
        elasticity: 0.8,
        attribution_stability: 'moderate',
        incoming_edges: [{ exists_probability: 0.8 }],
        // confidence = 0.5*0.5 + 0.5*0.8 = 0.65, 0.4 <= 0.65 < 0.7
      },
    ];

    const card = buildEvidencePriorityCard(factors)!;
    expect(card.items[0].suggested_evidence).toContain('confidence in its strength is medium');
  });
});

describe('buildEvidencePriorityCard — all high confidence', () => {
  it('card suppressed when all factors have confidence >= 0.7', () => {
    const factors: FactorInput[] = [
      {
        factor_id: 'f1',
        factor_label: 'Stable Factor 1',
        elasticity: 0.9,
        attribution_stability: 'high',
        incoming_edges: [{ exists_probability: 0.9 }],
        // confidence = 0.5*1.0 + 0.5*0.9 = 0.95 >= 0.7
      },
      {
        factor_id: 'f2',
        factor_label: 'Stable Factor 2',
        elasticity: 0.8,
        attribution_stability: 'high',
        incoming_edges: [{ exists_probability: 0.8 }],
        // confidence = 0.5*1.0 + 0.5*0.8 = 0.9 >= 0.7
      },
    ];

    const card = buildEvidencePriorityCard(factors);
    expect(card).toBeNull();
  });
});

describe('buildEvidencePriorityCard — edge cases', () => {
  it('factor with no incoming edges uses 0.5 default for exists_prob', () => {
    const factors: FactorInput[] = [
      {
        factor_id: 'root_factor',
        factor_label: 'Root Factor',
        elasticity: 0.8,
        attribution_stability: 'low',
        // no incoming_edges → uses 0.5 default
      },
    ];

    const card = buildEvidencePriorityCard(factors)!;
    // confidence = 0.5*0.0 + 0.5*0.5 = 0.25
    expect(card.items[0].confidence_normalised).toBeCloseTo(0.25, 5);
  });

  it('single dominant factor produces 1 item', () => {
    const factors: FactorInput[] = [
      {
        factor_id: 'dominant',
        factor_label: 'Dominant Factor',
        elasticity: 0.95,
        attribution_stability: 'low',
        incoming_edges: [{ exists_probability: 0.1 }],
      },
      {
        factor_id: 'minor',
        factor_label: 'Minor Factor',
        elasticity: 0.05,
        attribution_stability: 'low',
        incoming_edges: [{ exists_probability: 0.1 }],
      },
    ];

    const card = buildEvidencePriorityCard(factors)!;
    expect(card.items.length).toBeGreaterThanOrEqual(1);
    // Dominant factor should have much higher score
    expect(card.items[0].factor_id).toBe('dominant');
    expect(card.items[0].score).toBeGreaterThan(card.items[1]?.score ?? 0);
  });

  it('determinism: same input produces identical card', () => {
    const factors: FactorInput[] = [
      { factor_id: 'f1', factor_label: 'F1', elasticity: 0.8, attribution_stability: 'low', incoming_edges: [{ exists_probability: 0.3 }] },
      { factor_id: 'f2', factor_label: 'F2', elasticity: -0.6, attribution_stability: 'moderate', incoming_edges: [{ exists_probability: 0.4 }] },
    ];

    const card1 = buildEvidencePriorityCard(factors)!;
    const card2 = buildEvidencePriorityCard(factors)!;
    expect(card1).toEqual(card2);
  });
});
