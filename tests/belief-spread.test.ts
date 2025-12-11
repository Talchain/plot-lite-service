/**
 * Belief→Spread Mapping Tests
 *
 * Phase 2: Schema & Contracts - Task 2.2
 * Tests for belief-to-spread formula, variance computation, and visualisation.
 */

import { describe, it, expect } from 'vitest';
import {
  computeVarianceContribution,
  computeSpreadFromBelief,
  computeGraphSpread,
  generateBeliefSpreadCurve,
  getBeliefSpreadCapability,
  interpretBeliefLevel,
  recommendBeliefFromEvidence,
  BELIEF_SPREAD_FORMULAS,
  CURRENT_BELIEF_SPREAD_VERSION,
  BELIEF_SPREAD_DOCUMENTATION,
} from '../src/engine/belief-spread.js';

describe('Belief Spread Formula Definitions', () => {
  it('defines v1 formula as current', () => {
    expect(CURRENT_BELIEF_SPREAD_VERSION).toBe('v1');
  });

  it('v1 formula has required fields', () => {
    const v1 = BELIEF_SPREAD_FORMULAS.v1;
    expect(v1.version).toBe('v1');
    expect(v1.formula).toBeDefined();
    expect(v1.description).toBeDefined();
    expect(v1.default_belief).toBe(0.7);
    expect(v1.parameters).toBeDefined();
  });

  it('v2 formula is reserved for future', () => {
    const v2 = BELIEF_SPREAD_FORMULAS.v2;
    expect(v2.version).toBe('v2');
    expect(v2.effective_from).toBe('TBD');
  });

  it('documentation is complete', () => {
    expect(BELIEF_SPREAD_DOCUMENTATION.title).toBeDefined();
    expect(BELIEF_SPREAD_DOCUMENTATION.version).toBe(CURRENT_BELIEF_SPREAD_VERSION);
    expect(BELIEF_SPREAD_DOCUMENTATION.overview).toContain('Belief');
  });
});

describe('Variance Contribution Computation', () => {
  it('returns 0 for belief = 0', () => {
    expect(computeVarianceContribution(0)).toBe(0);
  });

  it('returns 0 for belief = 1', () => {
    expect(computeVarianceContribution(1)).toBe(0);
  });

  it('returns maximum (0.25) for belief = 0.5', () => {
    expect(computeVarianceContribution(0.5)).toBe(0.25);
  });

  it('returns symmetric values', () => {
    // Use toBeCloseTo for floating-point comparison due to IEEE 754 precision
    expect(computeVarianceContribution(0.2)).toBeCloseTo(computeVarianceContribution(0.8), 10);
    expect(computeVarianceContribution(0.3)).toBeCloseTo(computeVarianceContribution(0.7), 10);
  });

  it('clamps belief to [0, 1]', () => {
    // Values outside [0, 1] should be clamped
    expect(computeVarianceContribution(-0.5)).toBe(0); // Clamped to 0
    expect(computeVarianceContribution(1.5)).toBe(0); // Clamped to 1
  });

  it('follows belief × (1 - belief) formula', () => {
    const beliefs = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    for (const b of beliefs) {
      expect(computeVarianceContribution(b)).toBeCloseTo(b * (1 - b), 10);
    }
  });
});

describe('Spread Computation', () => {
  describe('computeSpreadFromBelief', () => {
    it('returns 0 for belief = 0', () => {
      expect(computeSpreadFromBelief(0, 1)).toBe(0);
    });

    it('returns 0 for belief = 1', () => {
      expect(computeSpreadFromBelief(1, 1)).toBe(0);
    });

    it('returns maximum spread for belief = 0.5', () => {
      const spread = computeSpreadFromBelief(0.5, 1);
      expect(spread).toBeCloseTo(0.5, 5); // √0.25 = 0.5
    });

    it('scales with weight magnitude', () => {
      const spreadWeight1 = computeSpreadFromBelief(0.5, 1);
      const spreadWeight2 = computeSpreadFromBelief(0.5, 2);
      expect(spreadWeight2).toBeCloseTo(spreadWeight1 * 2, 5);
    });

    it('uses absolute weight value', () => {
      const spreadPositive = computeSpreadFromBelief(0.5, 2);
      const spreadNegative = computeSpreadFromBelief(0.5, -2);
      expect(spreadPositive).toBe(spreadNegative);
    });
  });

  describe('computeGraphSpread', () => {
    it('returns 0 for empty graph', () => {
      expect(computeGraphSpread([])).toBe(0);
    });

    it('computes spread for single edge', () => {
      const edges = [{ belief: 0.5, weight: 1 }];
      const spread = computeGraphSpread(edges);
      expect(spread).toBeCloseTo(0.5, 5);
    });

    it('computes spread for multiple edges', () => {
      const edges = [
        { belief: 0.5, weight: 1 },
        { belief: 0.5, weight: 1 },
      ];
      const spread = computeGraphSpread(edges);
      // Variance = 0.25 + 0.25 = 0.5, spread = √0.5 ≈ 0.707
      expect(spread).toBeCloseTo(Math.sqrt(0.5), 5);
    });

    it('uses default belief when not specified', () => {
      const edges = [{ weight: 1 }]; // No belief specified
      const spread = computeGraphSpread(edges);
      // Default belief is 0.7, variance = 0.7 × 0.3 = 0.21
      expect(spread).toBeCloseTo(Math.sqrt(0.21), 5);
    });

    it('uses default weight when not specified', () => {
      const edges = [{ belief: 0.5 }]; // No weight specified
      const spread = computeGraphSpread(edges);
      // Default weight is 1, variance = 0.25
      expect(spread).toBeCloseTo(0.5, 5);
    });
  });
});

describe('Visualisation Data Generation', () => {
  it('generates correct number of points', () => {
    const curve = generateBeliefSpreadCurve(1, 11);
    expect(curve).toHaveLength(11);
  });

  it('starts at belief = 0', () => {
    const curve = generateBeliefSpreadCurve();
    expect(curve[0].belief).toBe(0);
    expect(curve[0].spread).toBe(0);
  });

  it('ends at belief = 1', () => {
    const curve = generateBeliefSpreadCurve();
    const last = curve[curve.length - 1];
    expect(last.belief).toBe(1);
    expect(last.spread).toBe(0);
  });

  it('has maximum spread at belief = 0.5', () => {
    const curve = generateBeliefSpreadCurve(1, 21);
    const mid = curve.find((p) => p.belief === 0.5);
    expect(mid).toBeDefined();
    expect(mid!.spread).toBeCloseTo(0.5, 2);

    // Verify it's the maximum
    const maxSpread = Math.max(...curve.map((p) => p.spread));
    expect(mid!.spread).toBe(maxSpread);
  });

  it('includes all required fields', () => {
    const curve = generateBeliefSpreadCurve();
    for (const point of curve) {
      expect(point).toHaveProperty('belief');
      expect(point).toHaveProperty('spread');
      expect(point).toHaveProperty('spread_p10');
      expect(point).toHaveProperty('spread_p90');
      expect(point).toHaveProperty('inclusion_probability');
      expect(point).toHaveProperty('variance_contribution');
    }
  });

  it('scales with weight parameter', () => {
    const curve1 = generateBeliefSpreadCurve(1, 11);
    const curve2 = generateBeliefSpreadCurve(2, 11);

    // Spreads should be doubled when weight doubles
    for (let i = 0; i < curve1.length; i++) {
      if (curve1[i].spread > 0) {
        expect(curve2[i].spread).toBeCloseTo(curve1[i].spread * 2, 2);
      }
    }
  });
});

describe('Belief Spread Capability', () => {
  it('returns complete capability information', () => {
    const capability = getBeliefSpreadCapability();

    expect(capability.current_version).toBe('v1');
    expect(capability.formula).toBeDefined();
    expect(capability.visualisation_data).toBeDefined();
    expect(capability.supported_versions).toContain('v1');
    expect(capability.supported_versions).toContain('v2');
  });

  it('includes visualisation data', () => {
    const capability = getBeliefSpreadCapability();
    expect(capability.visualisation_data.length).toBeGreaterThan(0);
  });

  it('formula matches current version', () => {
    const capability = getBeliefSpreadCapability();
    expect(capability.formula.version).toBe(capability.current_version);
  });
});

describe('Belief Level Interpretation', () => {
  it('interprets very low belief (< 0.2)', () => {
    const result = interpretBeliefLevel(0.1);
    expect(result.level).toBe('very_low');
    expect(result.label).toContain('Very Low');
  });

  it('interprets low belief (0.2-0.4)', () => {
    const result = interpretBeliefLevel(0.3);
    expect(result.level).toBe('low');
    expect(result.label).toContain('Low');
  });

  it('interprets moderate belief (0.4-0.6)', () => {
    const result = interpretBeliefLevel(0.5);
    expect(result.level).toBe('moderate');
    expect(result.label).toContain('Moderate');
  });

  it('interprets high belief (0.6-0.8)', () => {
    const result = interpretBeliefLevel(0.7);
    expect(result.level).toBe('high');
    expect(result.label).toContain('High');
  });

  it('interprets very high belief (>= 0.8)', () => {
    const result = interpretBeliefLevel(0.9);
    expect(result.level).toBe('very_high');
    expect(result.label).toContain('Very High');
  });
});

describe('Evidence-Based Belief Recommendation', () => {
  it('recommends low belief for no evidence', () => {
    expect(recommendBeliefFromEvidence('none')).toBe(0.3);
  });

  it('recommends moderate belief for weak evidence', () => {
    expect(recommendBeliefFromEvidence('weak')).toBe(0.5);
  });

  it('recommends higher belief for moderate evidence', () => {
    expect(recommendBeliefFromEvidence('moderate')).toBe(0.7);
  });

  it('recommends high belief for strong evidence', () => {
    expect(recommendBeliefFromEvidence('strong')).toBe(0.85);
  });

  it('recommends very high belief for definitive evidence', () => {
    expect(recommendBeliefFromEvidence('definitive')).toBe(0.95);
  });

  it('defaults to 0.7 for unknown evidence', () => {
    expect(recommendBeliefFromEvidence('unknown' as any)).toBe(0.7);
  });
});
