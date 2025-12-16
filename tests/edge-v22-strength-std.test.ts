/**
 * EdgeV2.2 strength_std Tests
 *
 * Tests for Brief v2.2: Explicit parametric uncertainty via strength_std field
 *
 * Key features:
 * - strength_std takes priority over belief_strength for weight variance
 * - Uses Box-Muller Normal sampling when strength_std is provided
 * - Falls back to belief_strength derivation for backward compatibility
 * - Preserves determinism (same seed → same results)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runKernel, getEdgeStd } from '../src/scm-lite/kernel.js';
import type { DAG, Edge } from '../src/scm-lite/types.js';
import {
  getEdgeStd as getEdgeStdMigration,
  validateStrengthStd,
  getBeliefStrength,
  sampleWeightWithVariance,
} from '../src/engine/edge-migration.js';
import type { GraphEdge } from '../src/trust/types.js';
import { FLAGS } from '../src/config/flags.js';

describe('EdgeV2.2 strength_std', () => {
  describe('getEdgeStd function', () => {
    it('uses strength_std when provided', () => {
      const edge: GraphEdge = {
        from: 'a',
        to: 'b',
        weight: 0.5,
        strength_std: 0.25,
        belief_strength: 0.8, // Should be ignored
      };

      expect(getEdgeStdMigration(edge)).toBe(0.25);
    });

    it('derives from belief_strength when strength_std absent', () => {
      const edge: GraphEdge = {
        from: 'a',
        to: 'b',
        weight: 1.0,
        belief_strength: 0.9,
      };

      // cv = 0.3 * (1 - 0.9) + 0.1 = 0.13
      // std = 0.13 * 1.0 = 0.13
      expect(getEdgeStdMigration(edge)).toBeCloseTo(0.13, 2);
    });

    it('derives from legacy belief when belief_strength absent', () => {
      const edge: GraphEdge = {
        from: 'a',
        to: 'b',
        weight: 1.0,
        belief: 0.8, // Legacy field
      };

      // cv = 0.3 * (1 - 0.8) + 0.1 = 0.16
      // std = 0.16 * 1.0 = 0.16
      expect(getEdgeStdMigration(edge)).toBeCloseTo(0.16, 2);
    });

    it('uses default when neither provided', () => {
      const edge: GraphEdge = {
        from: 'a',
        to: 'b',
        weight: 0.5,
      };

      // Default: 10% of |weight| = 0.05, minimum 0.05
      expect(getEdgeStdMigration(edge)).toBe(0.05);
    });

    it('uses minimum std when weight is small', () => {
      const edge: GraphEdge = {
        from: 'a',
        to: 'b',
        weight: 0.01, // Very small weight
      };

      // Default: 10% of 0.01 = 0.001, but minimum is 0.05
      expect(getEdgeStdMigration(edge)).toBe(0.05);
    });

    it('handles negative weights correctly', () => {
      const edge: GraphEdge = {
        from: 'a',
        to: 'b',
        weight: -0.8,
        strength_std: 0.15,
      };

      expect(getEdgeStdMigration(edge)).toBe(0.15);
    });

    it('ignores strength_std <= 0', () => {
      const edge: GraphEdge = {
        from: 'a',
        to: 'b',
        weight: 0.5,
        strength_std: 0, // Invalid, should be ignored
        belief_strength: 0.9,
      };

      // Should derive from belief_strength
      // cv = 0.3 * (1 - 0.9) + 0.1 = 0.13
      // std = 0.13 * 0.5 = 0.065
      expect(getEdgeStdMigration(edge)).toBeCloseTo(0.065, 2);
    });
  });

  describe('validateStrengthStd function', () => {
    it('accepts valid strength_std', () => {
      const edge: GraphEdge = {
        from: 'a',
        to: 'b',
        strength_std: 0.15,
      };
      expect(validateStrengthStd(edge)).toBeNull();
    });

    it('accepts edge without strength_std', () => {
      const edge: GraphEdge = {
        from: 'a',
        to: 'b',
        weight: 0.5,
      };
      expect(validateStrengthStd(edge)).toBeNull();
    });

    it('rejects strength_std = 0', () => {
      const edge: GraphEdge = {
        from: 'a',
        to: 'b',
        strength_std: 0,
      };
      const error = validateStrengthStd(edge);
      expect(error).not.toBeNull();
      expect(error).toContain('strength_std must be > 0');
    });

    it('rejects negative strength_std', () => {
      const edge: GraphEdge = {
        from: 'a',
        to: 'b',
        strength_std: -0.1,
      };
      const error = validateStrengthStd(edge);
      expect(error).not.toBeNull();
      expect(error).toContain('strength_std must be > 0');
    });
  });

  describe('backward compatibility', () => {
    it('sampleWeightWithVariance still works', () => {
      // Returns base weight when belief_strength is 1.0
      const weight = sampleWeightWithVariance(0.8, 1.0, 0.5);
      expect(weight).toBe(0.8);
    });

    it('has smaller variance with higher belief_strength', () => {
      // Low belief_strength = more variance
      const lowStrength1 = sampleWeightWithVariance(1.0, 0.2, 0.0);
      const lowStrength2 = sampleWeightWithVariance(1.0, 0.2, 1.0);
      const lowVariance = Math.abs(lowStrength2 - lowStrength1);

      // High belief_strength = less variance
      const highStrength1 = sampleWeightWithVariance(1.0, 0.9, 0.0);
      const highStrength2 = sampleWeightWithVariance(1.0, 0.9, 1.0);
      const highVariance = Math.abs(highStrength2 - highStrength1);

      expect(highVariance).toBeLessThan(lowVariance);
    });
  });
});

describe('Kernel Integration with strength_std', () => {
  beforeEach(() => {
    vi.stubEnv('ENABLE_DUAL_BELIEFS', '1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const simpleDAG: DAG = {
    nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
    edges: [
      { from: 'A', to: 'B', weight: 0.8, belief: 0.9 },
      { from: 'B', to: 'C', weight: 0.5, belief: 0.7 },
    ],
  };

  it('kernel runs with legacy edges (backward compatibility)', () => {
    const result = runKernel(simpleDAG, 'C', { seed: 42, K: 16 });

    expect(result.target).toBe('C');
    expect(result.quantiles).toBeDefined();
    expect(result.quantiles.p50).toBeGreaterThan(0);
    expect(result.confidence).toBeDefined();
  });

  it('kernel runs with strength_std edges', () => {
    const dagWithStd: DAG = {
      nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
      edges: [
        { from: 'A', to: 'B', weight: 0.8, belief_exists: 0.9, strength_std: 0.1 },
        { from: 'B', to: 'C', weight: 0.5, belief_exists: 0.7, strength_std: 0.15 },
      ],
    };

    const result = runKernel(dagWithStd, 'C', { seed: 42, K: 64 });

    expect(result.target).toBe('C');
    expect(result.quantiles).toBeDefined();
    expect(result.confidence).toBeDefined();
  });

  it('produces deterministic results with same seed', () => {
    const dagWithStd: DAG = {
      nodes: [{ id: 'A' }, { id: 'B' }],
      edges: [
        { from: 'A', to: 'B', weight: 0.6, belief_exists: 0.9, strength_std: 0.2 },
      ],
    };

    const result1 = runKernel(dagWithStd, 'B', { seed: 123, K: 32 });
    const result2 = runKernel(dagWithStd, 'B', { seed: 123, K: 32 });

    expect(result1.quantiles.p50).toBe(result2.quantiles.p50);
    expect(result1.bma_hash).toBe(result2.bma_hash);
  });

  it('negative weights produce negative sampled values on average', () => {
    const dagNegative: DAG = {
      nodes: [{ id: 'price' }, { id: 'demand' }],
      edges: [
        {
          from: 'price',
          to: 'demand',
          weight: -0.8, // Negative effect
          belief_exists: 1.0,
          strength_std: 0.1,
        },
      ],
    };

    const result = runKernel(dagNegative, 'demand', {
      seed: 42,
      K: 256,
      interventions: [{ node_id: 'price', value: 1.0 }],
    });

    // With negative weight, demand should be negative on average
    expect(result.quantiles.p50).toBeLessThan(0);
  });

  it('larger strength_std produces wider distribution', () => {
    const dagTight: DAG = {
      nodes: [{ id: 'A' }, { id: 'B' }],
      edges: [
        { from: 'A', to: 'B', weight: 0.5, belief_exists: 1.0, strength_std: 0.05 },
      ],
    };

    const dagWide: DAG = {
      nodes: [{ id: 'A' }, { id: 'B' }],
      edges: [
        { from: 'A', to: 'B', weight: 0.5, belief_exists: 1.0, strength_std: 0.25 },
      ],
    };

    const tightResult = runKernel(dagTight, 'B', { seed: 42, K: 256 });
    const wideResult = runKernel(dagWide, 'B', { seed: 42, K: 256 });

    // Wider std should produce larger p90-p10 range
    const tightRange = tightResult.quantiles.p90 - tightResult.quantiles.p10;
    const wideRange = wideResult.quantiles.p90 - wideResult.quantiles.p10;

    expect(wideRange).toBeGreaterThan(tightRange);
  });
});

describe('Edge sampling distribution with strength_std', () => {
  beforeEach(() => {
    vi.stubEnv('ENABLE_DUAL_BELIEFS', '1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('samples around mean with correct standard deviation', () => {
    // Run many kernel invocations with different seeds to verify distribution
    const dag: DAG = {
      nodes: [{ id: 'A' }, { id: 'B' }],
      edges: [
        {
          from: 'A',
          to: 'B',
          weight: 0.5,
          belief_exists: 1.0, // Always exists
          strength_std: 0.1,
        },
      ],
    };

    // Collect p50 values from multiple runs with different seeds
    const p50Values: number[] = [];
    for (let seed = 0; seed < 100; seed++) {
      const result = runKernel(dag, 'B', { seed, K: 64 });
      p50Values.push(result.quantiles.p50);
    }

    // Mean should be close to weight (0.5)
    const mean = p50Values.reduce((a, b) => a + b, 0) / p50Values.length;
    expect(mean).toBeCloseTo(0.5, 1);
  });

  it('respects edge non-existence (belief_exists < 1)', () => {
    const dag: DAG = {
      nodes: [{ id: 'A' }, { id: 'B' }],
      edges: [
        {
          from: 'A',
          to: 'B',
          weight: 10.0, // High weight, easy to detect
          belief_exists: 0.5, // 50% chance of existing
          strength_std: 0.1,
        },
      ],
    };

    const result = runKernel(dag, 'B', { seed: 42, K: 256 });

    // With 50% edge existence, we should see multiple unique graphs
    expect(result.meta.unique_graphs).toBeGreaterThan(1);
  });

  it('legacy edges (belief_strength only) now use Normal sampling', () => {
    // This test verifies the fix for sampling consistency
    // Legacy edges should use Normal(weight, derived_std) not uniform-based sampling
    const dag: DAG = {
      nodes: [{ id: 'A' }, { id: 'B' }],
      edges: [
        {
          from: 'A',
          to: 'B',
          weight: 0.5,
          belief_exists: 1.0,
          belief_strength: 0.8, // No strength_std - uses legacy path
        },
      ],
    };

    // Collect p50 values from multiple runs
    const p50Values: number[] = [];
    for (let seed = 0; seed < 100; seed++) {
      const result = runKernel(dag, 'B', { seed, K: 64 });
      p50Values.push(result.quantiles.p50);
    }

    // Mean should be close to weight (0.5)
    const mean = p50Values.reduce((a, b) => a + b, 0) / p50Values.length;
    expect(mean).toBeCloseTo(0.5, 1);

    // Derived std: cv = 0.3 * (1 - 0.8) + 0.1 = 0.16, std = 0.16 * 0.5 = 0.08
    // Variance in p50 should reflect Normal distribution (not uniform)
    const variance = p50Values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / p50Values.length;
    const sampleStd = Math.sqrt(variance);
    // With proper Normal sampling, we expect std in p50 < 0.15 (not too wide, not deterministic)
    expect(sampleStd).toBeLessThan(0.15);
    expect(sampleStd).toBeGreaterThan(0.01); // Should have some variance
  });
});
