/**
 * Change Attribution Builder Tests
 *
 * Tests for mapping structural graph differences to estimated causal impact.
 */

import { describe, it, expect } from 'vitest';
import { buildChangeAttribution, type ScenarioRun } from '../src/util/change-attribution.js';
import { computeGraphDiff } from '../src/util/graph-diff.js';

describe('buildChangeAttribution', () => {
  const baselineGraph = {
    nodes: [
      { id: 'marketing', label: 'Marketing', value: 0.8 },
      { id: 'awareness', label: 'Brand Awareness', value: 0.6 },
      { id: 'sales', label: 'Sales', value: 0.7 },
    ],
    edges: [
      { from: 'marketing', to: 'awareness', weight: 0.7 },
      { from: 'awareness', to: 'sales', weight: 0.6 },
    ],
  };

  const baseline: ScenarioRun = {
    graph: baselineGraph,
    outcome_value: 100,
  };

  it('returns zero delta when graphs are identical', () => {
    const comparison: ScenarioRun = {
      graph: baselineGraph,
      outcome_value: 100,
    };

    const diff = computeGraphDiff(baselineGraph, baselineGraph);
    const attribution = buildChangeAttribution(baseline, comparison, diff);

    expect(attribution.outcome_delta).toBe(0);
    expect(attribution.primary_drivers).toHaveLength(0);
    expect(attribution.summary).toContain('No significant outcome change');
  });

  it('attributes outcome change to edge removal', () => {
    const comparisonGraph = {
      nodes: baselineGraph.nodes,
      edges: [
        { from: 'marketing', to: 'awareness', weight: 0.7 },
        // Removed: awareness -> sales
      ],
    };

    const comparison: ScenarioRun = {
      graph: comparisonGraph,
      outcome_value: 80,
    };

    const diff = computeGraphDiff(baselineGraph, comparisonGraph);
    const attribution = buildChangeAttribution(baseline, comparison, diff);

    expect(attribution.outcome_delta).toBe(-20);
    expect(attribution.primary_drivers.length).toBeGreaterThan(0);

    const removalDriver = attribution.primary_drivers.find(
      (d) => d.change_type === 'edge_removed'
    );
    expect(removalDriver).toBeDefined();
    expect(removalDriver!.description).toContain('Removed');
    expect(removalDriver!.affected_nodes).toHaveLength(2);
  });

  it('attributes outcome change to edge addition', () => {
    const comparisonGraph = {
      nodes: baselineGraph.nodes,
      edges: [
        ...baselineGraph.edges,
        { from: 'marketing', to: 'sales', weight: 0.8 },
      ],
    };

    const comparison: ScenarioRun = {
      graph: comparisonGraph,
      outcome_value: 120,
    };

    const diff = computeGraphDiff(baselineGraph, comparisonGraph);
    const attribution = buildChangeAttribution(baseline, comparison, diff);

    expect(attribution.outcome_delta).toBe(20);

    const additionDriver = attribution.primary_drivers.find(
      (d) => d.change_type === 'edge_added'
    );
    expect(additionDriver).toBeDefined();
    expect(additionDriver!.description).toContain('Added');
    expect(additionDriver!.contribution_to_delta).toBeGreaterThan(0);
  });

  it('attributes outcome change to weight modification', () => {
    const comparisonGraph = {
      nodes: baselineGraph.nodes,
      edges: [
        { from: 'marketing', to: 'awareness', weight: 0.9 }, // Changed from 0.7
        { from: 'awareness', to: 'sales', weight: 0.6 },
      ],
    };

    const comparison: ScenarioRun = {
      graph: comparisonGraph,
      outcome_value: 110,
    };

    const diff = computeGraphDiff(baselineGraph, comparisonGraph);
    const attribution = buildChangeAttribution(baseline, comparison, diff);

    expect(attribution.outcome_delta).toBe(10);

    const weightDriver = attribution.primary_drivers.find(
      (d) => d.change_type === 'edge_weight_changed'
    );
    expect(weightDriver).toBeDefined();
    expect(weightDriver!.before_value).toBe(0.7);
    expect(weightDriver!.after_value).toBe(0.9);
  });

  it('attributes outcome change to node value modification', () => {
    const comparisonGraph = {
      nodes: [
        { id: 'marketing', label: 'Marketing', value: 0.95 }, // Changed from 0.8
        { id: 'awareness', label: 'Brand Awareness', value: 0.6 },
        { id: 'sales', label: 'Sales', value: 0.7 },
      ],
      edges: baselineGraph.edges,
    };

    const comparison: ScenarioRun = {
      graph: comparisonGraph,
      outcome_value: 115,
    };

    const diff = computeGraphDiff(baselineGraph, comparisonGraph);
    const attribution = buildChangeAttribution(baseline, comparison, diff);

    expect(attribution.outcome_delta).toBe(15);

    const valueDriver = attribution.primary_drivers.find(
      (d) => d.change_type === 'node_value_changed'
    );
    expect(valueDriver).toBeDefined();
    expect(valueDriver!.before_value).toBe(0.8);
    expect(valueDriver!.after_value).toBe(0.95);
    expect(valueDriver!.affected_nodes).toHaveLength(1);
    expect(valueDriver!.affected_nodes[0].label).toBe('Marketing');
  });

  it('calculates contribution percentages correctly', () => {
    const comparisonGraph = {
      nodes: [
        { id: 'marketing', label: 'Marketing', value: 0.95 },
        { id: 'awareness', label: 'Brand Awareness', value: 0.6 },
        { id: 'sales', label: 'Sales', value: 0.7 },
      ],
      edges: [
        { from: 'marketing', to: 'awareness', weight: 0.9 },
        { from: 'awareness', to: 'sales', weight: 0.6 },
      ],
    };

    const comparison: ScenarioRun = {
      graph: comparisonGraph,
      outcome_value: 125,
    };

    const diff = computeGraphDiff(baselineGraph, comparisonGraph);
    const attribution = buildChangeAttribution(baseline, comparison, diff);

    // Contribution percentages should sum to approximately 100%
    const totalPct = attribution.primary_drivers.reduce(
      (sum, d) => sum + d.contribution_pct,
      0
    );
    expect(totalPct).toBeGreaterThanOrEqual(90);
    expect(totalPct).toBeLessThanOrEqual(110); // Allow rounding
  });

  it('sorts drivers by absolute contribution', () => {
    const comparisonGraph = {
      nodes: [
        { id: 'marketing', label: 'Marketing', value: 0.5 }, // Decreased
        { id: 'awareness', label: 'Brand Awareness', value: 0.9 }, // Increased
        { id: 'sales', label: 'Sales', value: 0.7 },
      ],
      edges: baselineGraph.edges,
    };

    const comparison: ScenarioRun = {
      graph: comparisonGraph,
      outcome_value: 100,
    };

    const diff = computeGraphDiff(baselineGraph, comparisonGraph);
    const attribution = buildChangeAttribution(baseline, comparison, diff);

    // Drivers should be sorted by absolute contribution
    for (let i = 1; i < attribution.primary_drivers.length; i++) {
      const prevAbs = Math.abs(
        attribution.primary_drivers[i - 1].contribution_to_delta
      );
      const currAbs = Math.abs(
        attribution.primary_drivers[i].contribution_to_delta
      );
      expect(prevAbs).toBeGreaterThanOrEqual(currAbs);
    }
  });

  it('limits primary drivers to top 5', () => {
    // Create a graph with many changes
    const manyNodesGraph = {
      nodes: Array.from({ length: 10 }, (_, i) => ({
        id: `node${i}`,
        label: `Node ${i}`,
        value: 0.5 + i * 0.05,
      })),
      edges: Array.from({ length: 10 }, (_, i) => ({
        from: `node${i}`,
        to: `node${(i + 1) % 10}`,
        weight: 0.5,
      })),
    };

    const changedGraph = {
      nodes: Array.from({ length: 10 }, (_, i) => ({
        id: `node${i}`,
        label: `Node ${i}`,
        value: 0.6 + i * 0.05, // All changed
      })),
      edges: Array.from({ length: 10 }, (_, i) => ({
        from: `node${i}`,
        to: `node${(i + 1) % 10}`,
        weight: 0.7, // All changed
      })),
    };

    const baseline2: ScenarioRun = {
      graph: manyNodesGraph,
      outcome_value: 100,
    };

    const comparison: ScenarioRun = {
      graph: changedGraph,
      outcome_value: 150,
    };

    const diff = computeGraphDiff(manyNodesGraph, changedGraph);
    const attribution = buildChangeAttribution(baseline2, comparison, diff);

    expect(attribution.primary_drivers.length).toBeLessThanOrEqual(5);
  });

  it('generates meaningful summary for positive delta', () => {
    const comparisonGraph = {
      nodes: baselineGraph.nodes,
      edges: [
        { from: 'marketing', to: 'awareness', weight: 0.9 },
        { from: 'awareness', to: 'sales', weight: 0.6 },
      ],
    };

    const comparison: ScenarioRun = {
      graph: comparisonGraph,
      outcome_value: 130,
    };

    const diff = computeGraphDiff(baselineGraph, comparisonGraph);
    const attribution = buildChangeAttribution(baseline, comparison, diff);

    expect(attribution.summary).toContain('increase');
  });

  it('generates meaningful summary for negative delta', () => {
    const comparisonGraph = {
      nodes: baselineGraph.nodes,
      edges: [
        { from: 'marketing', to: 'awareness', weight: 0.3 },
        { from: 'awareness', to: 'sales', weight: 0.6 },
      ],
    };

    const comparison: ScenarioRun = {
      graph: comparisonGraph,
      outcome_value: 70,
    };

    const diff = computeGraphDiff(baselineGraph, comparisonGraph);
    const attribution = buildChangeAttribution(baseline, comparison, diff);

    expect(attribution.summary).toContain('decrease');
  });

  it('handles missing node values gracefully', () => {
    const graphNoValues = {
      nodes: [
        { id: 'a', label: 'A' }, // No value
        { id: 'b', label: 'B' }, // No value
      ],
      edges: [{ from: 'a', to: 'b', weight: 0.5 }],
    };

    const baselineNoValues: ScenarioRun = {
      graph: graphNoValues,
      outcome_value: 100,
    };

    const comparisonGraph = {
      nodes: graphNoValues.nodes,
      edges: [{ from: 'a', to: 'b', weight: 0.8 }],
    };

    const comparisonNoValues: ScenarioRun = {
      graph: comparisonGraph,
      outcome_value: 110,
    };

    const diff = computeGraphDiff(graphNoValues, comparisonGraph);
    const attribution = buildChangeAttribution(
      baselineNoValues,
      comparisonNoValues,
      diff
    );

    // Should use default value (0.5) and not crash
    expect(attribution).toBeDefined();
    expect(attribution.primary_drivers.length).toBeGreaterThan(0);
  });

  it('handles missing edge weights gracefully', () => {
    const graphNoWeights = {
      nodes: [
        { id: 'a', label: 'A', value: 0.8 },
        { id: 'b', label: 'B', value: 0.6 },
      ],
      edges: [{ from: 'a', to: 'b' }], // No weight
    };

    const baselineNoWeights: ScenarioRun = {
      graph: graphNoWeights,
      outcome_value: 100,
    };

    const comparisonGraph = {
      nodes: graphNoWeights.nodes,
      edges: [], // Edge removed
    };

    const comparisonNoWeights: ScenarioRun = {
      graph: comparisonGraph,
      outcome_value: 80,
    };

    const diff = computeGraphDiff(graphNoWeights, comparisonGraph);
    const attribution = buildChangeAttribution(
      baselineNoWeights,
      comparisonNoWeights,
      diff
    );

    expect(attribution).toBeDefined();
    expect(attribution.primary_drivers.length).toBeGreaterThan(0);
  });
});

describe('change attribution determinism', () => {
  const baselineGraph = {
    nodes: [
      { id: 'a', label: 'A', value: 0.7 },
      { id: 'b', label: 'B', value: 0.8 },
      { id: 'c', label: 'C', value: 0.6 },
    ],
    edges: [
      { from: 'a', to: 'b', weight: 0.5 },
      { from: 'b', to: 'c', weight: 0.6 },
    ],
  };

  const comparisonGraph = {
    nodes: [
      { id: 'a', label: 'A', value: 0.9 },
      { id: 'b', label: 'B', value: 0.8 },
      { id: 'c', label: 'C', value: 0.6 },
    ],
    edges: [
      { from: 'a', to: 'b', weight: 0.7 },
      { from: 'b', to: 'c', weight: 0.6 },
    ],
  };

  it('produces identical results across multiple calls', () => {
    const baseline: ScenarioRun = {
      graph: baselineGraph,
      outcome_value: 100,
    };

    const comparison: ScenarioRun = {
      graph: comparisonGraph,
      outcome_value: 120,
    };

    const diff = computeGraphDiff(baselineGraph, comparisonGraph);

    const results = [];
    for (let i = 0; i < 10; i++) {
      const attribution = buildChangeAttribution(baseline, comparison, diff);
      results.push(JSON.stringify(attribution));
    }

    const uniqueResults = new Set(results);
    expect(uniqueResults.size).toBe(1);
  });
});
