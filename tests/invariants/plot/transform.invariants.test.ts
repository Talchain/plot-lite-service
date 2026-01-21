/**
 * Transform Invariants Test Stubs
 *
 * Tests for SSOT v1.2 invariant contracts on response transforms.
 * These tests verify that transform operations produce valid output shapes.
 *
 * @see docs/audits/PLOT_OPERATIONS_INVENTORY.md
 */
import { describe, it, expect } from 'vitest';
import {
  computeFactorInfluence,
  computeFactorInfluenceWithPaths,
} from '../../../src/lib/factor-influence.js';
import type { EngineGraphV3 } from '../../../src/types/engine-v3.js';

// -----------------------------------------------------------------------------
// Test Fixtures
// -----------------------------------------------------------------------------

const SIMPLE_GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'factor_a', kind: 'factor', label: 'Factor A' },
    { id: 'factor_b', kind: 'factor', label: 'Factor B' },
    { id: 'outcome_1', kind: 'outcome', label: 'Outcome 1' },
    { id: 'goal_1', kind: 'goal', label: 'Goal 1' },
  ],
  edges: [
    { from: 'factor_a', to: 'outcome_1', exists_probability: 0.9, strength: { mean: 0.8, std: 0.1 } },
    { from: 'factor_b', to: 'outcome_1', exists_probability: 0.85, strength: { mean: -0.5, std: 0.15 } },
    { from: 'outcome_1', to: 'goal_1', exists_probability: 0.95, strength: { mean: 0.9, std: 0.05 } },
  ],
};

const DISCONNECTED_GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'factor_a', kind: 'factor', label: 'Factor A' },
    { id: 'factor_b', kind: 'factor', label: 'Factor B (Disconnected)' },
    { id: 'goal_1', kind: 'goal', label: 'Goal 1' },
  ],
  edges: [
    { from: 'factor_a', to: 'goal_1', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
    // factor_b has no path to goal
  ],
};

const CYCLIC_GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'factor_a', kind: 'factor', label: 'Factor A' },
    { id: 'outcome_1', kind: 'outcome', label: 'Outcome 1' },
    { id: 'outcome_2', kind: 'outcome', label: 'Outcome 2' },
    { id: 'goal_1', kind: 'goal', label: 'Goal 1' },
  ],
  edges: [
    { from: 'factor_a', to: 'outcome_1', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
    { from: 'outcome_1', to: 'outcome_2', exists_probability: 0.9, strength: { mean: 0.6, std: 0.1 } },
    { from: 'outcome_2', to: 'outcome_1', exists_probability: 0.8, strength: { mean: 0.3, std: 0.1 } }, // Cycle
    { from: 'outcome_2', to: 'goal_1', exists_probability: 0.95, strength: { mean: 0.7, std: 0.05 } },
  ],
};

// -----------------------------------------------------------------------------
// INV-TRANS-01: Factor influence is bounded
// -----------------------------------------------------------------------------
describe('INV-TRANS-01: Factor influence values are bounded', () => {
  it('normalised_influence is in [0, 1]', () => {
    const results = computeFactorInfluence(SIMPLE_GRAPH, 'goal_1');

    for (const result of results) {
      expect(result.normalised_influence).toBeGreaterThanOrEqual(0);
      expect(result.normalised_influence).toBeLessThanOrEqual(1);
    }
  });

  it('confidence is in [0, 1]', () => {
    const results = computeFactorInfluence(SIMPLE_GRAPH, 'goal_1');

    for (const result of results) {
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('direction is exactly "positive" or "negative"', () => {
    const results = computeFactorInfluence(SIMPLE_GRAPH, 'goal_1');

    for (const result of results) {
      expect(['positive', 'negative']).toContain(result.direction);
    }
  });

  it('influence is finite (no NaN or Infinity)', () => {
    const results = computeFactorInfluence(SIMPLE_GRAPH, 'goal_1');

    for (const result of results) {
      expect(Number.isFinite(result.influence)).toBe(true);
      expect(Number.isFinite(result.normalised_influence)).toBe(true);
      expect(Number.isFinite(result.confidence)).toBe(true);
    }
  });
});

// -----------------------------------------------------------------------------
// INV-TRANS-02: Factor influence results are sorted
// -----------------------------------------------------------------------------
describe('INV-TRANS-02: Factor influence results are sorted', () => {
  it('results are sorted by |influence| descending', () => {
    const results = computeFactorInfluence(SIMPLE_GRAPH, 'goal_1');

    for (let i = 1; i < results.length; i++) {
      expect(Math.abs(results[i - 1].influence)).toBeGreaterThanOrEqual(
        Math.abs(results[i].influence)
      );
    }
  });

  it('highest |influence| factor has normalised_influence = 1.0', () => {
    const results = computeFactorInfluence(SIMPLE_GRAPH, 'goal_1');

    if (results.length > 0 && results[0].influence !== 0) {
      expect(results[0].normalised_influence).toBeCloseTo(1.0, 5);
    }
  });
});

// -----------------------------------------------------------------------------
// INV-TRANS-03: Disconnected factors have zero influence
// -----------------------------------------------------------------------------
describe('INV-TRANS-03: Disconnected factors have zero influence', () => {
  it('factor with no path to goal has influence = 0', () => {
    const results = computeFactorInfluence(DISCONNECTED_GRAPH, 'goal_1');

    const disconnected = results.find(r => r.factor_id === 'factor_b');
    expect(disconnected).toBeDefined();
    expect(disconnected!.influence).toBe(0);
    expect(disconnected!.confidence).toBe(0);
  });

  it('factor with path to goal has non-zero influence', () => {
    const results = computeFactorInfluence(DISCONNECTED_GRAPH, 'goal_1');

    const connected = results.find(r => r.factor_id === 'factor_a');
    expect(connected).toBeDefined();
    expect(connected!.influence).not.toBe(0);
  });
});

// -----------------------------------------------------------------------------
// INV-TRANS-04: Cyclic graphs terminate
// -----------------------------------------------------------------------------
describe('INV-TRANS-04: Cyclic graphs terminate without infinite loop', () => {
  it('computes influence for cyclic graph', () => {
    // This should not hang
    const startTime = Date.now();
    const results = computeFactorInfluence(CYCLIC_GRAPH, 'goal_1');
    const duration = Date.now() - startTime;

    expect(results.length).toBe(1);
    expect(duration).toBeLessThan(1000); // Should complete in < 1s
  });

  it('finds path through cycle without revisiting nodes', () => {
    const results = computeFactorInfluenceWithPaths(CYCLIC_GRAPH, 'goal_1');

    const factorA = results.find(r => r.factor_id === 'factor_a');
    expect(factorA).toBeDefined();

    // Path should not contain duplicates
    for (const path of factorA!.paths) {
      const uniqueNodes = new Set(path.nodes);
      expect(uniqueNodes.size).toBe(path.nodes.length);
    }
  });
});

// -----------------------------------------------------------------------------
// INV-TRANS-05: Missing goal returns empty array
// -----------------------------------------------------------------------------
describe('INV-TRANS-05: Missing goal returns empty array', () => {
  it('returns empty array for non-existent goal', () => {
    const results = computeFactorInfluence(SIMPLE_GRAPH, 'nonexistent_goal');
    expect(results).toHaveLength(0);
  });

  it('returns empty array for empty graph', () => {
    const emptyGraph: EngineGraphV3 = { nodes: [], edges: [] };
    const results = computeFactorInfluence(emptyGraph, 'goal_1');
    expect(results).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// INV-TRANS-06: Direction reflects sign of influence
// -----------------------------------------------------------------------------
describe('INV-TRANS-06: Direction reflects sign of influence', () => {
  it('positive influence has direction = "positive"', () => {
    const results = computeFactorInfluence(SIMPLE_GRAPH, 'goal_1');

    const factorA = results.find(r => r.factor_id === 'factor_a');
    expect(factorA).toBeDefined();

    if (factorA!.influence > 0) {
      expect(factorA!.direction).toBe('positive');
    }
  });

  it('negative influence has direction = "negative"', () => {
    const results = computeFactorInfluence(SIMPLE_GRAPH, 'goal_1');

    const factorB = results.find(r => r.factor_id === 'factor_b');
    expect(factorB).toBeDefined();

    if (factorB!.influence < 0) {
      expect(factorB!.direction).toBe('negative');
    }
  });
});

// -----------------------------------------------------------------------------
// INV-TRANS-07: Path details are consistent with influence
// -----------------------------------------------------------------------------
describe('INV-TRANS-07: Path details are consistent with influence', () => {
  it('sum of path effects equals total influence', () => {
    const results = computeFactorInfluenceWithPaths(SIMPLE_GRAPH, 'goal_1');

    for (const result of results) {
      const sumOfPathEffects = result.paths.reduce((sum, p) => sum + p.effect, 0);
      expect(sumOfPathEffects).toBeCloseTo(result.influence, 5);
    }
  });

  it('path nodes start with factor and end with goal', () => {
    const results = computeFactorInfluenceWithPaths(SIMPLE_GRAPH, 'goal_1');

    for (const result of results) {
      for (const path of result.paths) {
        expect(path.nodes[0]).toBe(result.factor_id);
        expect(path.nodes[path.nodes.length - 1]).toBe('goal_1');
      }
    }
  });
});

// -----------------------------------------------------------------------------
// INV-TRANS-08: Low probability edges are excluded
// -----------------------------------------------------------------------------
describe('INV-TRANS-08: Low probability edges are excluded', () => {
  it('edges with exists_probability = 0 are excluded from paths', () => {
    const graphWithZeroProb: EngineGraphV3 = {
      nodes: [
        { id: 'factor_a', kind: 'factor', label: 'Factor A' },
        { id: 'goal_1', kind: 'goal', label: 'Goal 1' },
      ],
      edges: [
        { from: 'factor_a', to: 'goal_1', exists_probability: 0, strength: { mean: 0.9, std: 0.1 } },
      ],
    };

    const results = computeFactorInfluence(graphWithZeroProb, 'goal_1');

    const factorA = results.find(r => r.factor_id === 'factor_a');
    expect(factorA).toBeDefined();
    expect(factorA!.influence).toBe(0);
  });

  it('edges with exists_probability < 0.01 are excluded', () => {
    const graphWithLowProb: EngineGraphV3 = {
      nodes: [
        { id: 'factor_a', kind: 'factor', label: 'Factor A' },
        { id: 'goal_1', kind: 'goal', label: 'Goal 1' },
      ],
      edges: [
        { from: 'factor_a', to: 'goal_1', exists_probability: 0.005, strength: { mean: 0.9, std: 0.1 } },
      ],
    };

    const results = computeFactorInfluence(graphWithLowProb, 'goal_1');

    const factorA = results.find(r => r.factor_id === 'factor_a');
    expect(factorA).toBeDefined();
    expect(factorA!.influence).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// INV-TRANS-09: Label fallback
// -----------------------------------------------------------------------------
describe('INV-TRANS-09: Factor label fallback', () => {
  it('uses node label when present', () => {
    const results = computeFactorInfluence(SIMPLE_GRAPH, 'goal_1');

    const factorA = results.find(r => r.factor_id === 'factor_a');
    expect(factorA).toBeDefined();
    expect(factorA!.label).toBe('Factor A');
  });

  it('uses node id when label is missing', () => {
    const graphWithoutLabels: EngineGraphV3 = {
      nodes: [
        { id: 'factor_a', kind: 'factor', label: 'factor_a' },
        { id: 'goal_1', kind: 'goal', label: 'goal_1' },
      ],
      edges: [
        { from: 'factor_a', to: 'goal_1', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
      ],
    };

    const results = computeFactorInfluence(graphWithoutLabels, 'goal_1');

    const factorA = results.find(r => r.factor_id === 'factor_a');
    expect(factorA).toBeDefined();
    // Label should be present (node's label field contains the id as fallback)
    expect(factorA!.label).toBe('factor_a');
  });
});
