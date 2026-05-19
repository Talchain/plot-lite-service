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
  computeUnifiedConfidence,
  computeValueOfInformation,
  computeFlipRiskCategory,
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
      // Unified confidence: no incoming edges to fac_price → 0.5 default edge term
      // No ISL data → 0.5 default stability term → confidence = 0.5
      expect(factor.confidence).toBe(0.5);
      // Progressive disclosure components
      expect(factor.confidence_components).toEqual({
        structural_certainty: 0.5,
        sampling_stability: null,
      });
      // When no fragile edges provided, VOI = 0
      expect(factor.value_of_information).toBe(0);
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
      // Unified confidence: edge from fac_a→goal has exists_probability=0, but this
      // edge is an outgoing edge FROM fac_a, not incoming TO fac_a. fac_a has no
      // incoming edges → confidence = 0.5 (neutral default)
      const factor = result![0];
      expect(factor.sensitivity_score).toBe(0);
      expect(factor.confidence).toBe(0.5);
      expect(factor.zero_reason).toBe('no_path_to_goal');
    });

    it('includes unified confidence from incoming edges', () => {
      // Graph: fac_a → goal (fac_a has no incoming edges)
      const noIncomingGraph: EngineGraphV3 = {
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

      const result = computeFactorSensitivityFromGraph(noIncomingGraph, 'goal');
      expect(result).not.toBeNull();
      // No incoming edges to fac_a → confidence = 0.5 (neutral)
      expect(result![0].confidence).toBe(0.5);

      // Graph: source → fac_a → goal (fac_a has incoming edge from source)
      const withIncomingGraph: EngineGraphV3 = {
        nodes: [
          { id: 'source', kind: 'factor', label: 'Source' },
          { id: 'fac_a', kind: 'factor', label: 'Factor A' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          {
            from: 'source',
            to: 'fac_a',
            exists_probability: 0.9,
            strength: { mean: 0.5, std: 0.1 },
          },
          {
            from: 'fac_a',
            to: 'goal',
            exists_probability: 0.99,
            strength: { mean: 0.8, std: 0.01 },
          },
        ],
      };

      const result2 = computeFactorSensitivityFromGraph(withIncomingGraph, 'goal');
      expect(result2).not.toBeNull();
      const facA = result2!.find(f => f.factor_id === 'fac_a');
      expect(facA).toBeDefined();
      // fac_a has incoming edge with exists_probability=0.9, strength={mean:0.5, std:0.1}
      // No ISL bootstrap → improved fallback: mean(exists_prob) × (1 - cv)
      // cv = |0.1 / 0.5| = 0.2, confidence = 0.9 × (1 - 0.2) = 0.72
      expect(facA!.confidence).toBeCloseTo(0.72, 5);
      expect(facA!.confidence_components).toEqual({
        structural_certainty: 0.9,
        sampling_stability: null,
      });
    });
  });

  describe('VOI with fragile edges', () => {
    const PRICING_GRAPH: EngineGraphV3 = {
      nodes: [
        { id: 'fac_price', kind: 'factor', label: 'Price' },
        { id: 'fac_quality', kind: 'factor', label: 'Quality' },
        { id: 'goal', kind: 'goal', label: 'Revenue' },
      ],
      edges: [
        {
          from: 'fac_price',
          to: 'goal',
          exists_probability: 0.9,
          strength: { mean: 0.8, std: 0.2 },
        },
        {
          from: 'fac_quality',
          to: 'goal',
          exists_probability: 0.95,
          strength: { mean: 0.6, std: 0.1 },
        },
      ],
    };

    it('computes VOI > 0 when factor is on fragile edge with marginal > 0', () => {
      const fragileEdges = [
        {
          edge_id: 'fac_price->goal',
          from_id: 'fac_price',
          to_id: 'goal',
          switch_probability: 0.3,
          marginal_switch_probability: 0.25,
        },
      ];

      const result = computeFactorSensitivityFromGraph(PRICING_GRAPH, 'goal', fragileEdges);

      expect(result).not.toBeNull();
      const priceFactor = result!.find(f => f.factor_id === 'fac_price');
      expect(priceFactor).toBeDefined();

      // Price is on fragile edge, so VOI > 0
      expect(priceFactor!.value_of_information).toBeGreaterThan(0);
    });

    it('VOI = 0 when factor not adjacent to any fragile edge', () => {
      const fragileEdges = [
        {
          edge_id: 'fac_price->goal',
          from_id: 'fac_price',
          to_id: 'goal',
          switch_probability: 0.3,
          marginal_switch_probability: 0.25,
        },
      ];

      const result = computeFactorSensitivityFromGraph(PRICING_GRAPH, 'goal', fragileEdges);

      expect(result).not.toBeNull();
      const qualityFactor = result!.find(f => f.factor_id === 'fac_quality');
      expect(qualityFactor).toBeDefined();

      // Quality is NOT on any fragile edge, so VOI = 0
      expect(qualityFactor!.value_of_information).toBe(0);
    });

    it('VOI != confidence when factor on fragile edge (canary)', () => {
      const fragileEdges = [
        {
          edge_id: 'fac_price->goal',
          from_id: 'fac_price',
          to_id: 'goal',
          switch_probability: 0.3,
          marginal_switch_probability: 0.4,
        },
      ];

      const result = computeFactorSensitivityFromGraph(PRICING_GRAPH, 'goal', fragileEdges);

      expect(result).not.toBeNull();
      const priceFactor = result!.find(f => f.factor_id === 'fac_price');
      expect(priceFactor).toBeDefined();

      // VOI should NOT equal confidence when using the formula
      expect(priceFactor!.value_of_information).not.toEqual(priceFactor!.confidence);
    });
  });
});

// -----------------------------------------------------------------------------
// computeValueOfInformation Tests
// -----------------------------------------------------------------------------

describe('computeValueOfInformation', () => {
  describe('edge cases', () => {
    it('returns 0 when fragile edges is undefined', () => {
      const voi = computeValueOfInformation('fac_price', 0.8, 0.5, undefined);
      expect(voi).toBe(0);
    });

    it('returns 0 when fragile edges is empty array', () => {
      const voi = computeValueOfInformation('fac_price', 0.8, 0.5, []);
      expect(voi).toBe(0);
    });

    it('returns 0 when factor not adjacent to any fragile edge', () => {
      const fragileEdges = [
        { from_id: 'other_factor', to_id: 'goal', marginal_switch_probability: 0.5 },
      ];
      const voi = computeValueOfInformation('fac_price', 0.8, 0.5, fragileEdges);
      expect(voi).toBe(0);
    });

    it('returns 0 when marginal_switch_probability is 0', () => {
      const fragileEdges = [
        { from_id: 'fac_price', to_id: 'goal', marginal_switch_probability: 0 },
      ];
      const voi = computeValueOfInformation('fac_price', 0.8, 0.5, fragileEdges);
      expect(voi).toBe(0);
    });

    it('returns 0 when marginal_switch_probability is missing', () => {
      const fragileEdges = [
        { from_id: 'fac_price', to_id: 'goal' }, // No marginal_switch_probability
      ];
      const voi = computeValueOfInformation('fac_price', 0.8, 0.5, fragileEdges);
      expect(voi).toBe(0);
    });
  });

  describe('formula computation', () => {
    it('computes VOI using |sensitivity| × (1 - confidence) × fragility', () => {
      // sensitivity = 0.8, confidence = 0.4, fragility = 0.5
      // VOI = |0.8| × (1 - 0.4) × 0.5 = 0.8 × 0.6 × 0.5 = 0.24
      const fragileEdges = [
        { from_id: 'fac_price', to_id: 'goal', marginal_switch_probability: 0.5 },
      ];
      const voi = computeValueOfInformation('fac_price', 0.8, 0.4, fragileEdges);
      expect(voi).toBeCloseTo(0.24, 5);
    });

    it('uses absolute value of sensitivity (negative case)', () => {
      // sensitivity = -0.8, confidence = 0.4, fragility = 0.5
      // VOI = |-0.8| × (1 - 0.4) × 0.5 = 0.8 × 0.6 × 0.5 = 0.24
      const fragileEdges = [
        { from_id: 'fac_price', to_id: 'goal', marginal_switch_probability: 0.5 },
      ];
      const voi = computeValueOfInformation('fac_price', -0.8, 0.4, fragileEdges);
      expect(voi).toBeCloseTo(0.24, 5);
    });

    it('uses max marginal_switch_probability from multiple adjacent edges', () => {
      // Factor on two fragile edges with marginal 0.3 and 0.6 → use 0.6
      // sensitivity = 1.0, confidence = 0.5, fragility = 0.6
      // VOI = 1.0 × 0.5 × 0.6 = 0.3
      const fragileEdges = [
        { from_id: 'fac_price', to_id: 'out_a', marginal_switch_probability: 0.3 },
        { from_id: 'fac_price', to_id: 'out_b', marginal_switch_probability: 0.6 },
      ];
      const voi = computeValueOfInformation('fac_price', 1.0, 0.5, fragileEdges);
      expect(voi).toBeCloseTo(0.3, 5);
    });

    it('matches factor when it is to_id of fragile edge', () => {
      // Factor is target of fragile edge
      const fragileEdges = [
        { from_id: 'other', to_id: 'fac_price', marginal_switch_probability: 0.4 },
      ];
      const voi = computeValueOfInformation('fac_price', 1.0, 0.5, fragileEdges);
      // VOI = 1.0 × 0.5 × 0.4 = 0.2
      expect(voi).toBeCloseTo(0.2, 5);
    });
  });

  describe('default values', () => {
    it('defaults confidence to 0.5 when undefined', () => {
      // sensitivity = 1.0, confidence = 0.5 (default), fragility = 0.4
      // VOI = 1.0 × 0.5 × 0.4 = 0.2
      const fragileEdges = [
        { from_id: 'fac_price', to_id: 'goal', marginal_switch_probability: 0.4 },
      ];
      const voi = computeValueOfInformation('fac_price', 1.0, undefined, fragileEdges);
      expect(voi).toBeCloseTo(0.2, 5);
    });

    it('defaults sensitivity to 0 when undefined', () => {
      const fragileEdges = [
        { from_id: 'fac_price', to_id: 'goal', marginal_switch_probability: 0.5 },
      ];
      const voi = computeValueOfInformation('fac_price', undefined, 0.5, fragileEdges);
      expect(voi).toBe(0);
    });
  });

  describe('clamping', () => {
    it('clamps result to maximum of 1', () => {
      // sensitivity = 5.0, confidence = 0.0, fragility = 1.0
      // Raw VOI = 5.0 × 1.0 × 1.0 = 5.0 → clamped to 1.0
      const fragileEdges = [
        { from_id: 'fac_price', to_id: 'goal', marginal_switch_probability: 1.0 },
      ];
      const voi = computeValueOfInformation('fac_price', 5.0, 0.0, fragileEdges);
      expect(voi).toBe(1);
    });

    it('clamps result to minimum of 0', () => {
      // All valid inputs should produce non-negative VOI anyway
      const fragileEdges = [
        { from_id: 'fac_price', to_id: 'goal', marginal_switch_probability: 0.5 },
      ];
      const voi = computeValueOfInformation('fac_price', 0.0, 0.5, fragileEdges);
      expect(voi).toBe(0);
      expect(voi).toBeGreaterThanOrEqual(0);
    });
  });

  describe('from_id/to_id matching (not string contains)', () => {
    it('does not match factor when ID is substring of from_id', () => {
      // 'price' should NOT match 'fac_price' via contains
      const fragileEdges = [
        { from_id: 'fac_price', to_id: 'goal', marginal_switch_probability: 0.5 },
      ];
      const voi = computeValueOfInformation('price', 0.8, 0.5, fragileEdges);
      expect(voi).toBe(0); // Should NOT match
    });

    it('requires exact from_id or to_id match', () => {
      const fragileEdges = [
        { from_id: 'fac_price', to_id: 'goal', marginal_switch_probability: 0.5 },
      ];

      // Exact match on from_id
      const voiExact = computeValueOfInformation('fac_price', 0.8, 0.5, fragileEdges);
      expect(voiExact).toBeGreaterThan(0);

      // Similar but not exact - should not match
      const voiPartial = computeValueOfInformation('fac_price_v2', 0.8, 0.5, fragileEdges);
      expect(voiPartial).toBe(0);
    });
  });

  // ===========================================================================
  // Flip Risk Category Tests
  // ===========================================================================

  describe('computeFlipRiskCategory', () => {
    it('returns "negligible" when no fragile edges', () => {
      const result = computeFlipRiskCategory('fac_price', undefined);
      expect(result).toBe('negligible');
    });

    it('returns "negligible" when empty fragile edges array', () => {
      const result = computeFlipRiskCategory('fac_price', []);
      expect(result).toBe('negligible');
    });

    it('returns "isolated" when marginal_switch_probability > 0.05', () => {
      const fragileEdges = [
        {
          from_id: 'fac_price',
          to_id: 'goal',
          switch_probability: 0.3,
          marginal_switch_probability: 0.1, // > 0.05 threshold
        },
      ];
      const result = computeFlipRiskCategory('fac_price', fragileEdges);
      expect(result).toBe('isolated');
    });

    it('returns "correlated" when switch_probability > 0.05 but marginal <= 0.05', () => {
      const fragileEdges = [
        {
          from_id: 'fac_price',
          to_id: 'goal',
          switch_probability: 0.26, // > 0.05
          marginal_switch_probability: 0, // <= 0.05
        },
      ];
      const result = computeFlipRiskCategory('fac_price', fragileEdges);
      expect(result).toBe('correlated');
    });

    it('returns "negligible" when both probabilities <= 0.05', () => {
      const fragileEdges = [
        {
          from_id: 'fac_price',
          to_id: 'goal',
          switch_probability: 0.03,
          marginal_switch_probability: 0.01,
        },
      ];
      const result = computeFlipRiskCategory('fac_price', fragileEdges);
      expect(result).toBe('negligible');
    });

    it('returns "negligible" when factor not adjacent to any fragile edge', () => {
      const fragileEdges = [
        {
          from_id: 'other_factor',
          to_id: 'goal',
          switch_probability: 0.5,
          marginal_switch_probability: 0.3,
        },
      ];
      const result = computeFlipRiskCategory('fac_price', fragileEdges);
      expect(result).toBe('negligible');
    });

    it('uses max probabilities across multiple adjacent edges', () => {
      const fragileEdges = [
        {
          from_id: 'fac_price',
          to_id: 'goal1',
          switch_probability: 0.1, // > 0.05
          marginal_switch_probability: 0.01, // <= 0.05
        },
        {
          from_id: 'fac_price',
          to_id: 'goal2',
          switch_probability: 0.02, // <= 0.05
          marginal_switch_probability: 0.02, // <= 0.05
        },
      ];
      // Max switch = 0.1 > 0.05, max marginal = 0.02 <= 0.05 → correlated
      const result = computeFlipRiskCategory('fac_price', fragileEdges);
      expect(result).toBe('correlated');
    });

    it('matches factor on to_id as well as from_id', () => {
      const fragileEdges = [
        {
          from_id: 'other',
          to_id: 'fac_price', // Factor is the target
          switch_probability: 0.3,
          marginal_switch_probability: 0.15,
        },
      ];
      const result = computeFlipRiskCategory('fac_price', fragileEdges);
      expect(result).toBe('isolated'); // marginal > 0.05
    });

    it('handles missing switch_probability (defaults to 0)', () => {
      const fragileEdges = [
        {
          from_id: 'fac_price',
          to_id: 'goal',
          // switch_probability missing
          marginal_switch_probability: 0.01,
        },
      ];
      const result = computeFlipRiskCategory('fac_price', fragileEdges);
      expect(result).toBe('negligible'); // Both effectively <= 0.05
    });

    it('handles missing marginal_switch_probability (defaults to 0)', () => {
      const fragileEdges = [
        {
          from_id: 'fac_price',
          to_id: 'goal',
          switch_probability: 0.2,
          // marginal_switch_probability missing
        },
      ];
      const result = computeFlipRiskCategory('fac_price', fragileEdges);
      expect(result).toBe('correlated'); // switch > 0.05, marginal defaults to 0
    });
  });

  describe('flip_risk_category in computeFactorSensitivityFromGraph', () => {
    const PRICING_GRAPH: EngineGraphV3 = {
      nodes: [
        { id: 'fac_price', kind: 'factor', label: 'Price' },
        { id: 'fac_quality', kind: 'factor', label: 'Quality' },
        { id: 'goal', kind: 'goal', label: 'Revenue' },
      ],
      edges: [
        {
          from: 'fac_price',
          to: 'goal',
          exists_probability: 0.9,
          strength: { mean: 0.8, std: 0.2 },
        },
        {
          from: 'fac_quality',
          to: 'goal',
          exists_probability: 0.95,
          strength: { mean: 0.6, std: 0.1 },
        },
      ],
    };

    it('includes flip_risk_category in factor sensitivity results', () => {
      const fragileEdges = [
        {
          from_id: 'fac_price',
          to_id: 'goal',
          switch_probability: 0.26,
          marginal_switch_probability: 0,
        },
      ];

      const result = computeFactorSensitivityFromGraph(PRICING_GRAPH, 'goal', fragileEdges);

      expect(result).not.toBeNull();
      const priceFactor = result!.find(f => f.factor_id === 'fac_price');
      const qualityFactor = result!.find(f => f.factor_id === 'fac_quality');

      expect(priceFactor).toBeDefined();
      expect(qualityFactor).toBeDefined();

      // Price is on correlated fragile edge
      expect(priceFactor!.flip_risk_category).toBe('correlated');

      // Quality is not on any fragile edge
      expect(qualityFactor!.flip_risk_category).toBe('negligible');
    });
  });
});

// -----------------------------------------------------------------------------
// computeUnifiedConfidence Tests
// -----------------------------------------------------------------------------

describe('computeUnifiedConfidence', () => {
  it('flags degenerate fallback via input_quality when neither bootstrap nor rich edge data is available', () => {
    // No bootstrap, no rich edges → uniform 0.5 × 0.5 + 0.5 × 0.5 = 0.5.
    // Value is not differentiating — input_quality must be 'degenerate_fallback'.
    // Source remains 'plot_unified_from_graph' (audit A1-PRIMARY: source enum
    // tags COMPUTATION origin; degeneracy moved to input_quality).
    expect(computeUnifiedConfidence(null, undefined)).toEqual({
      confidence: 0.5, source: 'plot_unified_from_graph', input_quality: 'degenerate_fallback', formula_version: 'plot_unified_v2',
    });
    expect(computeUnifiedConfidence(undefined, null)).toEqual({
      confidence: 0.5, source: 'plot_unified_from_graph', input_quality: 'degenerate_fallback', formula_version: 'plot_unified_v2',
    });
    expect(computeUnifiedConfidence(null, [])).toEqual({
      confidence: 0.5, source: 'plot_unified_from_graph', input_quality: 'degenerate_fallback', formula_version: 'plot_unified_v2',
    });
    // Plain exists_probability without strength data also hits degenerate branch
    // (graph branch requires strength_mean/std to activate CV path).
    expect(computeUnifiedConfidence(null, [{ exists_probability: 0.9 }])).toEqual({
      confidence: 0.7, // 0.5 × 0.5 + 0.5 × 0.9
      source: 'plot_unified_from_graph',
      input_quality: 'degenerate_fallback',
      formula_version: 'plot_unified_v2',
    });
  });

  it('returns source: plot_unified_from_isl_bootstrap with correct value for bootstrap + edges', () => {
    // high stability (1.0), edges mean = 0.8 → 0.5 × 1.0 + 0.5 × 0.8 = 0.9
    const result = computeUnifiedConfidence('high', [{ exists_probability: 0.8 }]);
    expect(result.confidence).toBeCloseTo(0.9, 5);
    expect(result.source).toBe('plot_unified_from_isl_bootstrap');
    expect(result.input_quality).toBe('standard');
  });

  it('returns source: plot_unified_from_isl_bootstrap (bootstrap-dominated) when edges absent', () => {
    // moderate (0.5), no edges, no ISL continuous confidence → v2 band path:
    //   0.5 × 0.5 + 0.5 × 0.5 = 0.5
    expect(computeUnifiedConfidence('moderate', undefined)).toEqual({
      confidence: 0.5, source: 'plot_unified_from_isl_bootstrap', input_quality: 'standard', formula_version: 'plot_unified_v2',
    });
    // high (1.0), no edges → 0.5 × 1.0 + 0.5 × 0.5 = 0.75
    expect(computeUnifiedConfidence('high', undefined)).toEqual({
      confidence: 0.75, source: 'plot_unified_from_isl_bootstrap', input_quality: 'standard', formula_version: 'plot_unified_v2',
    });
  });

  it('distinguishes low and negligible at root factors (audit A1-SECONDARY, plot_unified_v2 fallback)', () => {
    // No ISL continuous confidence supplied → falls through to v2 band path.
    // Under v2 band table {high:1.0, moderate:0.5, low:0.25, negligible:0.0}:
    // low (0.25), no edges → 0.5 × 0.25 + 0.5 × 0.5 = 0.375
    expect(computeUnifiedConfidence('low', undefined)).toEqual({
      confidence: 0.375, source: 'plot_unified_from_isl_bootstrap', input_quality: 'standard', formula_version: 'plot_unified_v2',
    });
    // negligible (0.0), no edges → 0.5 × 0.0 + 0.5 × 0.5 = 0.25
    expect(computeUnifiedConfidence('negligible', undefined)).toEqual({
      confidence: 0.25, source: 'plot_unified_from_isl_bootstrap', input_quality: 'standard', formula_version: 'plot_unified_v2',
    });
    // Critical regression: outputs MUST be distinct (was 0.25 for both pre-v2)
    const lowOut = computeUnifiedConfidence('low', undefined).confidence;
    const negOut = computeUnifiedConfidence('negligible', undefined).confidence;
    expect(lowOut).not.toEqual(negOut);
  });

  it('returns source: plot_unified_from_graph when rich edge data activates the CV branch', () => {
    // No bootstrap but edges carry strength_mean/std → CV path fires.
    // Edge: exists=0.9, strength_mean=1.0, strength_std=0.1 → |cv| = 0.1.
    // confidence = 0.9 × (1 - 0.1) = 0.81
    const result = computeUnifiedConfidence(null, [
      { exists_probability: 0.9, strength_mean: 1.0, strength_std: 0.1 },
    ]);
    expect(result.confidence).toBeCloseTo(0.81, 5);
    expect(result.source).toBe('plot_unified_from_graph');
    expect(result.input_quality).toBe('standard');
  });

  it('clamps confidence to [0, 1]', () => {
    expect(computeUnifiedConfidence('high', [{ exists_probability: 1.0 }])).toEqual({
      confidence: 1.0, source: 'plot_unified_from_isl_bootstrap', input_quality: 'standard', formula_version: 'plot_unified_v2',
    });
    expect(computeUnifiedConfidence('negligible', [{ exists_probability: 0.0 }])).toEqual({
      confidence: 0.0, source: 'plot_unified_from_isl_bootstrap', input_quality: 'standard', formula_version: 'plot_unified_v2',
    });
  });

  it('handles unknown stability category with default band score', () => {
    // unknown → default band 0.5, edges mean = 0.6 → 0.5 × 0.5 + 0.5 × 0.6 = 0.55
    const result = computeUnifiedConfidence('unknown_value', [{ exists_probability: 0.6 }]);
    expect(result.confidence).toBeCloseTo(0.55, 5);
    expect(result.source).toBe('plot_unified_from_isl_bootstrap');
    expect(result.input_quality).toBe('standard');
  });

  it('is deterministic: same input always produces same output', () => {
    const edges = [{ exists_probability: 0.7 }, { exists_probability: 0.9 }];
    const r1 = computeUnifiedConfidence('moderate', edges);
    const r2 = computeUnifiedConfidence('moderate', edges);
    expect(r1).toEqual(r2);
  });
});
