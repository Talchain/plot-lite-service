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

  it('returns 0.375 for low stability with no edges (v2 band table, audit A1-SECONDARY)', () => {
    // v2 band score for 'low' lifted from 0.0 to 0.25 to distinguish from
    // 'negligible' at root factors. 0.5 * 0.25 + 0.5 * 0.5 = 0.375.
    const c = computeConfidenceNormalised('low', undefined);
    expect(c).toBe(0.375);
  });

  it('returns 0.25 for negligible stability with no edges (v2 band table — distinct from low)', () => {
    // v2 band score for 'negligible' remains 0.0 (no information loss).
    // 0.5 * 0.0 + 0.5 * 0.5 = 0.25 — distinct from low's 0.375.
    const c = computeConfidenceNormalised('negligible', undefined);
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

  it('uses 0.5 default for root node (no incoming edges; v2 band table)', () => {
    // v2: low stability → band_score = 0.25 (was 0.0), no edges → mean = 0.5
    // 0.5 * 0.25 + 0.5 * 0.5 = 0.375 (audit A1-SECONDARY).
    const c = computeConfidenceNormalised('low', []);
    expect(c).toBe(0.375);
  });
});

// =============================================================================
// Constants verification
// =============================================================================

describe('evidence priority constants', () => {
  it('suppression threshold is 0.05', () => {
    expect(EVIDENCE_PRIORITY_SUPPRESSION_THRESHOLD).toBe(0.05);
  });

  it('band scores match v2 values (audit A1-SECONDARY: low and negligible distinguished)', () => {
    expect(ATTRIBUTION_STABILITY_BAND_SCORES).toEqual({
      high: 1.0,
      moderate: 0.5,
      low: 0.25,
      negligible: 0.0,
    });
    // Critical regression: low must NOT collapse to negligible.
    expect(ATTRIBUTION_STABILITY_BAND_SCORES.low).not.toBe(ATTRIBUTION_STABILITY_BAND_SCORES.negligible);
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
    // All 3 factors have low confidence → survive per-item suppression.
    // Score-ordering is locked by the explicit > threshold assertion below;
    // exact pre-v2 values (e.g. 0.595) shifted slightly under formula_version
    // plot_unified_v2 (audit A1-SECONDARY) but the rank ordering is unchanged.
    expect(card!.items[0].factor_id).toBe('competition');
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
    // v2 (audit A1-SECONDARY): low → 0.25 band score, no edges → 0.5 default.
    // confidence = 0.5*0.25 + 0.5*0.5 = 0.375 (was 0.25 pre-v2).
    expect(card.items[0].confidence_normalised).toBeCloseTo(0.375, 5);
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

// =============================================================================
// Audit A1-SECONDARY: v2 band-table downstream-threshold proof
// =============================================================================
// Pin the actual classifier-bucket and suppression-bucket outcomes for the
// v2 band table change (low: 0.0 → 0.25). Brief instruction:
// "If any downstream consumer buckets on the previous 0.25 collapse, surface
//  in the final report — do not silently fix."
// These tests document and pin every bucket-boundary case. If a future
// change crosses a threshold differently, the test fails and surfaces it.

describe('A1-SECONDARY: v2 band table threshold-impact proof', () => {
  // Per evidence-priority.ts:
  //   confidence < 0.4   → "low confidence" copy (suggestedEvidenceText)
  //   0.4 <= confidence < 0.7 → "medium confidence" copy
  //   confidence >= 0.7  → suppressed (no copy emitted, item dropped)
  //   max(score) < 0.05  → entire card suppressed (returns null)
  // where score = |elasticity| × (1 - confidence).

  describe('text classifier (< 0.4 boundary)', () => {
    it('low @ root: pre-v2 0.25 → post-v2 0.375; STAYS in "low" bucket', () => {
      // Both pre-v2 and post-v2 outputs are < 0.4 → same "low" message.
      const factors: FactorInput[] = [{
        factor_id: 'low_root', factor_label: 'Low Root', elasticity: 0.8,
        attribution_stability: 'low',
        // No incoming_edges → meanExistsProb defaults to 0.5
      }];
      const card = buildEvidencePriorityCard(factors)!;
      expect(card.items[0].confidence_normalised).toBeCloseTo(0.375, 5);
      expect(card.items[0].suggested_evidence).toMatch(/your confidence in its strength is low/);
    });

    it('negligible @ root: 0.25 unchanged; "low" copy unchanged', () => {
      const factors: FactorInput[] = [{
        factor_id: 'neg_root', factor_label: 'Neg Root', elasticity: 0.8,
        attribution_stability: 'negligible',
      }];
      const card = buildEvidencePriorityCard(factors)!;
      expect(card.items[0].confidence_normalised).toBeCloseTo(0.25, 5);
      expect(card.items[0].suggested_evidence).toMatch(/your confidence in its strength is low/);
    });

    it('low + edge_mean ≈ 0.55: post-v2 reaches 0.4 — bucket SHIFTS "low" → "medium"', () => {
      // 0.5 × 0.25 + 0.5 × 0.55 = 0.4 (boundary; `< 0.4` evaluates false → "medium").
      // Pre-v2 same input: 0.5 × 0.0 + 0.5 × 0.55 = 0.275 → "low".
      // Documented bucket shift — intentional consequence of distinguishing
      // low from negligible. This test pins the post-v2 behaviour.
      const factors: FactorInput[] = [{
        factor_id: 'low_high_edge', factor_label: 'Low + High Edge', elasticity: 0.8,
        attribution_stability: 'low',
        incoming_edges: [{ exists_probability: 0.55 }],
      }];
      const card = buildEvidencePriorityCard(factors)!;
      expect(card.items[0].confidence_normalised).toBeCloseTo(0.4, 5);
      // At exactly 0.4 the `< 0.4` branch is false → "medium" copy.
      expect(card.items[0].suggested_evidence).toMatch(/your confidence in its strength is medium/);
    });
  });

  describe('per-item suppression (>= 0.7 boundary)', () => {
    it('low band cannot reach 0.7 even at saturated edges', () => {
      // Maximum post-v2 confidence for low: 0.5 × 0.25 + 0.5 × 1.0 = 0.625 < 0.7.
      // So no `low` factor is ever suppressed by the per-item filter.
      const factors: FactorInput[] = [{
        factor_id: 'low_saturated', factor_label: 'Low Saturated', elasticity: 0.8,
        attribution_stability: 'low',
        incoming_edges: [{ exists_probability: 1.0 }],
      }];
      const card = buildEvidencePriorityCard(factors)!;
      expect(card).not.toBeNull();
      expect(card!.items).toHaveLength(1);
      expect(card!.items[0].confidence_normalised).toBeCloseTo(0.625, 5);
    });

    it('moderate band can reach 0.7 at saturated edges (boundary)', () => {
      // 0.5 × 0.5 + 0.5 × 1.0 = 0.75 → suppressed (>= 0.7).
      // Use a high-elasticity factor so card-level isn't suppressed alongside.
      const factors: FactorInput[] = [{
        factor_id: 'mod_saturated', factor_label: 'Mod Saturated', elasticity: 0.8,
        attribution_stability: 'moderate',
        incoming_edges: [{ exists_probability: 1.0 }],
      }];
      const card = buildEvidencePriorityCard(factors);
      // Single high-confidence factor → all eligible items filtered → null card.
      expect(card).toBeNull();
    });
  });

  describe('low/negligible distinction at root (audit A1-SECONDARY heart of fix)', () => {
    it('low and negligible produce DISTINCT confidence_normalised at root', () => {
      const lowOnly: FactorInput[] = [{
        factor_id: 'low_only', factor_label: 'L', elasticity: 0.8, attribution_stability: 'low',
      }];
      const negOnly: FactorInput[] = [{
        factor_id: 'neg_only', factor_label: 'N', elasticity: 0.8, attribution_stability: 'negligible',
      }];
      const lowConf = buildEvidencePriorityCard(lowOnly)!.items[0].confidence_normalised;
      const negConf = buildEvidencePriorityCard(negOnly)!.items[0].confidence_normalised;
      // Pre-v2: both 0.25 (collapse). Post-v2: distinct.
      expect(lowConf).not.toEqual(negConf);
      expect(lowConf).toBeCloseTo(0.375, 5);
      expect(negConf).toBeCloseTo(0.25, 5);
    });
  });

  describe('card-level suppression (max score < 0.05)', () => {
    it('low band with tiny elasticity: post-v2 score still above suppression floor', () => {
      // |elasticity| × (1 - 0.375) = 0.5 × |elasticity|. Threshold 0.05 → need |e| > 0.08.
      const factors: FactorInput[] = [{
        factor_id: 'small_low', factor_label: 'Small Low', elasticity: 0.1,
        attribution_stability: 'low',
      }];
      const card = buildEvidencePriorityCard(factors);
      // 0.1 × (1 - 0.375) = 0.0625 > 0.05 → card emitted.
      expect(card).not.toBeNull();
    });

    it('low band at near-zero elasticity: card suppressed (no false positives from band lift)', () => {
      const factors: FactorInput[] = [{
        factor_id: 'tiny_low', factor_label: 'Tiny Low', elasticity: 0.05,
        attribution_stability: 'low',
      }];
      // 0.05 × (1 - 0.375) = 0.03125 < 0.05 → card suppressed.
      const card = buildEvidencePriorityCard(factors);
      expect(card).toBeNull();
    });
  });
});
