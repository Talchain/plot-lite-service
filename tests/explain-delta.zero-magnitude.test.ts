/**
 * Explain-Δ Zero-Magnitude Tests
 * 
 * Verifies that buildExplainDelta handles zero or near-zero magnitude
 * (baseline === counterfactual) deterministically without NaN or division errors.
 */

import { describe, it, expect } from 'vitest';
import { buildExplainDelta } from '../src/trust/explain-delta.js';

describe('Explain-Δ Zero-Magnitude Edge Cases', () => {
  const testGraph = {
    nodes: [
      { id: 'a', label: 'Node A', type: 'decision' },
      { id: 'b', label: 'Node B', type: 'decision' },
      { id: 'c', label: 'Node C', type: 'decision' },
      { id: 'd', label: 'Node D', type: 'outcome' },
    ],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd' },
    ],
  };

  it('handles exact zero magnitude (baseline === counterfactual)', () => {
    const result = buildExplainDelta({
      graph: testGraph,
      baseline_outcome: 100,
      counterfactual_outcome: 100,
      seed: 42,
      top_n: 3,
    });

    // Should return zero contributions
    expect(result.top_drivers).toBeDefined();
    expect(result.top_drivers.length).toBeGreaterThan(0);
    
    // All contributions should be 0
    for (const driver of result.top_drivers) {
      expect(driver.contribution).toBe(0);
      expect(driver.node_id).toBeDefined();
      expect(driver.node_label).toBeDefined();
      expect(driver.sign).toBe('+');
      expect(driver.explanation).toBe('No change from baseline');
    }

    // Summary should indicate no change
    expect(result.summary).toBe('No change from baseline; all contributions are 0%');
  });

  it('produces deterministic ordering for zero magnitude', () => {
    const results = [];

    for (let i = 0; i < 10; i++) {
      const result = buildExplainDelta({
        graph: testGraph,
        baseline_outcome: 50,
        counterfactual_outcome: 50,
        seed: 42,
        top_n: 3,
      });
      results.push(result.top_drivers.map(d => d.node_id).join(','));
    }

    // All results should be identical
    const uniqueResults = new Set(results);
    expect(uniqueResults.size).toBe(1);

    // Should be alphabetically ordered by node_id
    const firstResult = results[0].split(',');
    expect(firstResult).toEqual(['a', 'b', 'c']);
  });

  it('handles very small deltas near zero', () => {
    const result = buildExplainDelta({
      graph: testGraph,
      baseline_outcome: 100.0,
      counterfactual_outcome: 100.000000000001, // 1e-12, well below 1e-10 threshold
      seed: 42,
      top_n: 3,
    });

    // Should trigger zero-magnitude path (delta < 1e-10)
    expect(result.summary).toBe('No change from baseline; all contributions are 0%');
    expect(result.top_drivers.every(d => d.contribution === 0)).toBe(true);
  });

  it('does not produce NaN in contributions', () => {
    const result = buildExplainDelta({
      graph: testGraph,
      baseline_outcome: 100,
      counterfactual_outcome: 100,
      seed: 42,
      top_n: 3,
    });

    for (const driver of result.top_drivers) {
      expect(Number.isNaN(driver.contribution)).toBe(false);
    }
  });

  it('handles single-node graph with zero magnitude', () => {
    const singleNodeGraph = {
      nodes: [{ id: 'only', label: 'Only Node', type: 'outcome' }],
      edges: [],
    };

    const result = buildExplainDelta({
      graph: singleNodeGraph,
      baseline_outcome: 75,
      counterfactual_outcome: 75,
      seed: 42,
      top_n: 1,
    });

    expect(result.top_drivers).toHaveLength(1);
    expect(result.top_drivers[0].contribution).toBe(0);
    expect(result.top_drivers[0].node_id).toBe('only');
    expect(result.summary).toBe('No change from baseline; all contributions are 0%');
  });

  it('handles negative baseline with zero magnitude', () => {
    const result = buildExplainDelta({
      graph: testGraph,
      baseline_outcome: -50,
      counterfactual_outcome: -50,
      seed: 42,
      top_n: 3,
    });

    expect(result.top_drivers.every(d => d.contribution === 0)).toBe(true);
    expect(result.summary).toBe('No change from baseline; all contributions are 0%');
  });

  it('respects top_n limit with zero magnitude', () => {
    const largeGraph = {
      nodes: Array.from({ length: 10 }, (_, i) => ({
        id: `node${i}`,
        label: `Node ${i}`,
        type: 'decision',
      })),
      edges: Array.from({ length: 9 }, (_, i) => ({
        from: `node${i}`,
        to: `node${i + 1}`,
      })),
    };

    const result = buildExplainDelta({
      graph: largeGraph,
      baseline_outcome: 100,
      counterfactual_outcome: 100,
      seed: 42,
      top_n: 5,
    });

    expect(result.top_drivers).toHaveLength(5);
    expect(result.top_drivers.every(d => d.contribution === 0)).toBe(true);
    
    // Verify alphabetical ordering
    const nodeIds = result.top_drivers.map(d => d.node_id);
    expect(nodeIds).toEqual(['node0', 'node1', 'node2', 'node3', 'node4']);
  });

  it('transitions correctly from zero to non-zero magnitude', () => {
    // First call with zero magnitude
    const zeroResult = buildExplainDelta({
      graph: testGraph,
      baseline_outcome: 100,
      counterfactual_outcome: 100,
      seed: 42,
      top_n: 3,
    });

    expect(zeroResult.top_drivers.every(d => d.contribution === 0)).toBe(true);

    // Second call with non-zero magnitude
    const nonZeroResult = buildExplainDelta({
      graph: testGraph,
      baseline_outcome: 100,
      counterfactual_outcome: 115,
      seed: 42,
      top_n: 3,
    });

    expect(nonZeroResult.top_drivers.some(d => d.contribution > 0)).toBe(true);
    expect(nonZeroResult.summary).not.toBe('No change from baseline; all contributions are 0%');
  });
});
