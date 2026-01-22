/**
 * Factor Influence Computation Tests
 *
 * Tests for computeFactorInfluence - path-based influence and confidence
 * computation from graph edge data.
 *
 * @see Schema D.5 - Factor influence derived from edge-level data
 */
import { describe, it, expect } from 'vitest';
import {
  computeFactorInfluence,
  computeFactorInfluenceWithPaths,
  computeFactorSensitivityFromGraph,
  type FactorInfluence,
} from '../src/lib/factor-influence.js';
import type { EngineGraphV3, FactorSensitivityResultV3 } from '../src/types/engine-v3.js';

// -----------------------------------------------------------------------------
// Test Fixtures
// -----------------------------------------------------------------------------

/**
 * Simple linear graph: factor → outcome → goal
 * Expected influence: 0.8 × 0.9 = 0.72
 */
const SIMPLE_LINEAR_GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'fac_price', kind: 'factor', label: 'Price' },
    { id: 'out_revenue', kind: 'outcome', label: 'Revenue' },
    { id: 'goal_profit', kind: 'goal', label: 'Profit' },
  ],
  edges: [
    {
      from: 'fac_price',
      to: 'out_revenue',
      exists_probability: 0.9,
      strength: { mean: 0.8, std: 0.1 },
    },
    {
      from: 'out_revenue',
      to: 'goal_profit',
      exists_probability: 0.95,
      strength: { mean: 0.9, std: 0.05 },
    },
  ],
};

/**
 * Multiple path graph:
 * fac_price → out_mrr → goal
 * fac_price → fac_churn → out_mrr → goal
 *
 * Path 1: 0.78 × 0.9 = 0.702
 * Path 2: -0.3 × 0.5 × 0.9 = -0.135
 * Total: 0.702 + (-0.135) = 0.567
 */
const MULTIPLE_PATH_GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'fac_price', kind: 'factor', label: 'Pro Plan Price' },
    { id: 'fac_churn', kind: 'factor', label: 'Churn Rate' },
    { id: 'out_mrr', kind: 'outcome', label: 'Monthly Revenue' },
    { id: 'goal', kind: 'goal', label: 'Business Goal' },
  ],
  edges: [
    // Direct path: price → mrr
    {
      from: 'fac_price',
      to: 'out_mrr',
      exists_probability: 0.9,
      strength: { mean: 0.78, std: 0.1 },
    },
    // Indirect path: price → churn
    {
      from: 'fac_price',
      to: 'fac_churn',
      exists_probability: 0.85,
      strength: { mean: -0.3, std: 0.15 },
    },
    // churn → mrr
    {
      from: 'fac_churn',
      to: 'out_mrr',
      exists_probability: 0.9,
      strength: { mean: 0.5, std: 0.1 },
    },
    // mrr → goal
    {
      from: 'out_mrr',
      to: 'goal',
      exists_probability: 0.95,
      strength: { mean: 0.9, std: 0.05 },
    },
  ],
};

/**
 * Graph with no path from factor to goal
 */
const DISCONNECTED_GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'fac_isolated', kind: 'factor', label: 'Isolated Factor' },
    { id: 'out_middle', kind: 'outcome', label: 'Middle Node' },
    { id: 'goal', kind: 'goal', label: 'Goal' },
  ],
  edges: [
    // No edge from fac_isolated to anything
    {
      from: 'out_middle',
      to: 'goal',
      exists_probability: 0.9,
      strength: { mean: 1.0, std: 0.1 },
    },
  ],
};

/**
 * Graph with negative influence (factor decreases goal)
 */
const NEGATIVE_INFLUENCE_GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'fac_cost', kind: 'factor', label: 'Operating Cost' },
    { id: 'goal', kind: 'goal', label: 'Profit' },
  ],
  edges: [
    {
      from: 'fac_cost',
      to: 'goal',
      exists_probability: 0.95,
      strength: { mean: -0.7, std: 0.1 },
    },
  ],
};

/**
 * Graph with multiple factors
 */
const MULTI_FACTOR_GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'fac_a', kind: 'factor', label: 'Factor A' },
    { id: 'fac_b', kind: 'factor', label: 'Factor B' },
    { id: 'fac_c', kind: 'factor', label: 'Factor C' },
    { id: 'goal', kind: 'goal', label: 'Goal' },
  ],
  edges: [
    {
      from: 'fac_a',
      to: 'goal',
      exists_probability: 0.9,
      strength: { mean: 0.8, std: 0.1 },
    },
    {
      from: 'fac_b',
      to: 'goal',
      exists_probability: 0.85,
      strength: { mean: 0.5, std: 0.2 },
    },
    {
      from: 'fac_c',
      to: 'goal',
      exists_probability: 0.9,
      strength: { mean: -0.3, std: 0.1 },
    },
  ],
};

/**
 * Graph with a cycle (should not cause infinite loop)
 */
const CYCLIC_GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'fac_a', kind: 'factor', label: 'Factor A' },
    { id: 'out_b', kind: 'outcome', label: 'Outcome B' },
    { id: 'out_c', kind: 'outcome', label: 'Outcome C' },
    { id: 'goal', kind: 'goal', label: 'Goal' },
  ],
  edges: [
    {
      from: 'fac_a',
      to: 'out_b',
      exists_probability: 0.9,
      strength: { mean: 0.5, std: 0.1 },
    },
    {
      from: 'out_b',
      to: 'out_c',
      exists_probability: 0.9,
      strength: { mean: 0.6, std: 0.1 },
    },
    // Cycle: c → b
    {
      from: 'out_c',
      to: 'out_b',
      exists_probability: 0.8,
      strength: { mean: 0.3, std: 0.1 },
    },
    {
      from: 'out_c',
      to: 'goal',
      exists_probability: 0.95,
      strength: { mean: 0.7, std: 0.05 },
    },
  ],
};

/**
 * Graph with low exists_probability edge (should be included)
 */
const LOW_PROBABILITY_GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'fac_a', kind: 'factor', label: 'Factor A' },
    { id: 'goal', kind: 'goal', label: 'Goal' },
  ],
  edges: [
    {
      from: 'fac_a',
      to: 'goal',
      exists_probability: 0.1, // Low but above threshold
      strength: { mean: 0.9, std: 0.1 },
    },
  ],
};

/**
 * Graph with zero exists_probability edge (should be excluded)
 */
const ZERO_PROBABILITY_GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'fac_a', kind: 'factor', label: 'Factor A' },
    { id: 'goal', kind: 'goal', label: 'Goal' },
  ],
  edges: [
    {
      from: 'fac_a',
      to: 'goal',
      exists_probability: 0, // Zero - should be excluded
      strength: { mean: 0.9, std: 0.1 },
    },
  ],
};

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('computeFactorInfluence', () => {
  describe('basic functionality', () => {
    it('computes influence for simple linear graph', () => {
      const result = computeFactorInfluence(SIMPLE_LINEAR_GRAPH, 'goal_profit');

      expect(result).toHaveLength(1);
      expect(result[0].factor_id).toBe('fac_price');
      expect(result[0].label).toBe('Price');

      // Influence = 0.8 × 0.9 = 0.72
      expect(result[0].influence).toBeCloseTo(0.72, 2);
      expect(result[0].direction).toBe('positive');

      // Normalised influence should be 1.0 (only factor)
      expect(result[0].normalised_influence).toBeCloseTo(1.0, 2);

      // Confidence should be > 0 (high exists_probability, low std)
      expect(result[0].confidence).toBeGreaterThan(0.5);
    });

    it('computes influence for multiple path graph', () => {
      const result = computeFactorInfluence(MULTIPLE_PATH_GRAPH, 'goal');

      // Should have 2 factors: fac_price and fac_churn
      expect(result).toHaveLength(2);

      // Find price factor
      const priceInfluence = result.find(f => f.factor_id === 'fac_price');
      expect(priceInfluence).toBeDefined();

      // Path 1: price → mrr → goal = 0.78 × 0.9 = 0.702
      // Path 2: price → churn → mrr → goal = -0.3 × 0.5 × 0.9 = -0.135
      // Total: 0.702 + (-0.135) = 0.567
      expect(priceInfluence!.influence).toBeCloseTo(0.567, 2);
      expect(priceInfluence!.direction).toBe('positive');

      // Find churn factor
      const churnInfluence = result.find(f => f.factor_id === 'fac_churn');
      expect(churnInfluence).toBeDefined();

      // churn → mrr → goal = 0.5 × 0.9 = 0.45
      expect(churnInfluence!.influence).toBeCloseTo(0.45, 2);
    });

    it('returns empty array for non-existent goal', () => {
      const result = computeFactorInfluence(SIMPLE_LINEAR_GRAPH, 'non_existent_goal');
      expect(result).toHaveLength(0);
    });

    it('returns empty array for empty graph', () => {
      const emptyGraph: EngineGraphV3 = { nodes: [], edges: [] };
      const result = computeFactorInfluence(emptyGraph, 'goal');
      expect(result).toHaveLength(0);
    });
  });

  describe('direction computation', () => {
    it('identifies positive influence correctly', () => {
      const result = computeFactorInfluence(SIMPLE_LINEAR_GRAPH, 'goal_profit');
      expect(result[0].direction).toBe('positive');
    });

    it('identifies negative influence correctly', () => {
      const result = computeFactorInfluence(NEGATIVE_INFLUENCE_GRAPH, 'goal');

      expect(result).toHaveLength(1);
      expect(result[0].factor_id).toBe('fac_cost');
      expect(result[0].influence).toBeCloseTo(-0.7, 2);
      expect(result[0].direction).toBe('negative');
    });
  });

  describe('normalisation', () => {
    it('normalises influences relative to max absolute value', () => {
      const result = computeFactorInfluence(MULTI_FACTOR_GRAPH, 'goal');

      expect(result).toHaveLength(3);

      // Find the factor with highest absolute influence
      const maxAbsInfluence = Math.max(...result.map(r => Math.abs(r.influence)));

      // The highest should have normalised_influence = 1.0
      const highestFactor = result.find(r => Math.abs(r.influence) === maxAbsInfluence);
      expect(highestFactor!.normalised_influence).toBeCloseTo(1.0, 2);

      // All normalised values should be in [0, 1]
      for (const factor of result) {
        expect(factor.normalised_influence).toBeGreaterThanOrEqual(0);
        expect(factor.normalised_influence).toBeLessThanOrEqual(1);
      }
    });

    it('sorts results by absolute influence descending', () => {
      const result = computeFactorInfluence(MULTI_FACTOR_GRAPH, 'goal');

      for (let i = 1; i < result.length; i++) {
        expect(Math.abs(result[i - 1].influence)).toBeGreaterThanOrEqual(
          Math.abs(result[i].influence)
        );
      }
    });
  });

  describe('disconnected factors', () => {
    it('returns zero influence for factors with no path to goal', () => {
      const result = computeFactorInfluence(DISCONNECTED_GRAPH, 'goal');

      expect(result).toHaveLength(1);
      expect(result[0].factor_id).toBe('fac_isolated');
      expect(result[0].influence).toBe(0);
      expect(result[0].confidence).toBe(0);
    });
  });

  describe('cycle handling', () => {
    it('handles cyclic graphs without infinite loop', () => {
      // This should not hang or throw
      const result = computeFactorInfluence(CYCLIC_GRAPH, 'goal');

      expect(result).toHaveLength(1);
      expect(result[0].factor_id).toBe('fac_a');

      // Should find path: fac_a → out_b → out_c → goal
      // = 0.5 × 0.6 × 0.7 = 0.21
      expect(result[0].influence).toBeCloseTo(0.21, 2);
    });
  });

  describe('edge probability filtering', () => {
    it('includes edges with low but non-zero probability', () => {
      const result = computeFactorInfluence(LOW_PROBABILITY_GRAPH, 'goal');

      expect(result).toHaveLength(1);
      expect(result[0].influence).toBeCloseTo(0.9, 2);
    });

    it('excludes edges with zero probability', () => {
      const result = computeFactorInfluence(ZERO_PROBABILITY_GRAPH, 'goal');

      expect(result).toHaveLength(1);
      // Factor exists but has no path (edge excluded)
      expect(result[0].influence).toBe(0);
    });
  });

  describe('confidence computation', () => {
    it('computes higher confidence for high exists_probability and low std', () => {
      const highConfidenceGraph: EngineGraphV3 = {
        nodes: [
          { id: 'fac_a', kind: 'factor', label: 'Factor A' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          {
            from: 'fac_a',
            to: 'goal',
            exists_probability: 0.99,
            strength: { mean: 0.8, std: 0.01 }, // Very low std
          },
        ],
      };

      const lowConfidenceGraph: EngineGraphV3 = {
        nodes: [
          { id: 'fac_a', kind: 'factor', label: 'Factor A' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          {
            from: 'fac_a',
            to: 'goal',
            exists_probability: 0.5,
            strength: { mean: 0.8, std: 0.8 }, // High std (relative to mean)
          },
        ],
      };

      const highResult = computeFactorInfluence(highConfidenceGraph, 'goal');
      const lowResult = computeFactorInfluence(lowConfidenceGraph, 'goal');

      expect(highResult[0].confidence).toBeGreaterThan(lowResult[0].confidence);
    });
  });
});

describe('computeFactorInfluenceWithPaths', () => {
  it('includes path details in result', () => {
    const result = computeFactorInfluenceWithPaths(SIMPLE_LINEAR_GRAPH, 'goal_profit');

    expect(result).toHaveLength(1);
    expect(result[0].paths).toBeDefined();
    expect(result[0].paths.length).toBeGreaterThan(0);

    // Check path structure
    const path = result[0].paths[0];
    expect(path.nodes).toContain('fac_price');
    expect(path.nodes).toContain('goal_profit');
    expect(path.effect).toBeCloseTo(0.72, 2);
  });

  it('shows multiple paths for complex graph', () => {
    const result = computeFactorInfluenceWithPaths(MULTIPLE_PATH_GRAPH, 'goal');

    const priceResult = result.find(f => f.factor_id === 'fac_price');
    expect(priceResult).toBeDefined();

    // Should have 2 paths from fac_price to goal
    expect(priceResult!.paths.length).toBe(2);
  });
});

// -----------------------------------------------------------------------------
// computeFactorSensitivityFromGraph Wrapper Tests
// -----------------------------------------------------------------------------

describe('computeFactorSensitivityFromGraph', () => {
  describe('mapping to FactorSensitivityResultV3', () => {
    it('returns correctly mapped result for simple graph', () => {
      const result = computeFactorSensitivityFromGraph(SIMPLE_LINEAR_GRAPH, 'goal_profit');

      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);

      const factor = result![0];

      // Check field mapping
      expect(factor.factor_id).toBe('fac_price');
      expect(factor.factor_label).toBe('Price');
      expect(factor.sensitivity_score).toBeCloseTo(0.72, 2); // Raw influence
      expect(factor.influence_score).toBeCloseTo(1.0, 2);    // Normalised (only factor)
      expect(factor.elasticity).toBeCloseTo(1.0, 2);         // Same as normalised
      expect(factor.direction).toBe('positive');
      expect(factor.importance_rank).toBe(1);
      expect(factor.influence_rank).toBe(1);
      expect(factor.confidence).toBeGreaterThan(0.5);
      expect(factor.value_of_information).toEqual(factor.confidence);
      expect(factor.source).toBe('graph');
    });

    it('sets importance_rank correctly for multiple factors', () => {
      const result = computeFactorSensitivityFromGraph(MULTIPLE_PATH_GRAPH, 'goal');

      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);

      // Should be sorted by |influence| descending
      // Factor 0 should have rank 1, Factor 1 should have rank 2
      expect(result![0].importance_rank).toBe(1);
      expect(result![0].influence_rank).toBe(1);
      expect(result![1].importance_rank).toBe(2);
      expect(result![1].influence_rank).toBe(2);
    });

    it('returns null for empty graph (triggers fallback)', () => {
      const emptyGraph: EngineGraphV3 = { nodes: [], edges: [] };
      const result = computeFactorSensitivityFromGraph(emptyGraph, 'goal');

      expect(result).toBeNull();
    });

    it('returns null for non-existent goal (triggers fallback)', () => {
      const result = computeFactorSensitivityFromGraph(SIMPLE_LINEAR_GRAPH, 'non_existent_goal');

      expect(result).toBeNull();
    });

    it('sets zero_reason for factors with no path to goal', () => {
      const result = computeFactorSensitivityFromGraph(ZERO_PROBABILITY_GRAPH, 'goal');

      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);

      // Factor exists but has no path (edge excluded due to zero probability)
      const factor = result![0];
      expect(factor.sensitivity_score).toBe(0);
      expect(factor.confidence).toBe(0);
      expect(factor.zero_reason).toBe('no_path_to_goal');
    });

    it('includes confidence derived from edge data', () => {
      const highConfidenceGraph: EngineGraphV3 = {
        nodes: [
          { id: 'fac_a', kind: 'factor', label: 'Factor A' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          {
            from: 'fac_a',
            to: 'goal',
            exists_probability: 0.99,
            strength: { mean: 0.8, std: 0.01 },
          },
        ],
      };

      const result = computeFactorSensitivityFromGraph(highConfidenceGraph, 'goal');

      expect(result).not.toBeNull();
      expect(result![0].confidence).toBeGreaterThan(0.9);
    });
  });
});
