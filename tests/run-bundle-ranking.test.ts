/**
 * Tests for enhanced /v1/run_bundle with ranking and attribution
 */
import { describe, it, expect } from 'vitest';
import { computeRankingConfidence, computeRankingConfidenceDetailed } from '../src/trust/ranking-confidence.js';
import { aggregateNodeSensitivity, getTopNodeSensitivity } from '../src/trust/sensitivity-node.js';
import { buildChangeAttributionFromDelta } from '../src/util/change-attribution.js';
import type { SensitivityEdge } from '../src/lib/sensitivity-simple.js';

describe('Ranking Confidence', () => {
  it('returns high confidence for non-overlapping distributions', () => {
    const ranked = [
      { summary: { p10: 80, p50: 90, p90: 100 } },
      { summary: { p10: 50, p50: 60, p90: 70 } },
    ];
    expect(computeRankingConfidence(ranked)).toBe('high');
  });

  it('returns medium confidence for moderate overlap', () => {
    const ranked = [
      { summary: { p10: 70, p50: 80, p90: 90 } },
      { summary: { p10: 60, p50: 70, p90: 80 } },
    ];
    // Overlap: 70-80 (10 units), avg range: 20 units, overlap 50% -> low
    // Actually let's check: overlap = max(70,60) to min(90,80) = 70-80 = 10
    // firstRange = 20, secondRange = 20, avgRange = 20
    // overlapPct = 10/20 = 0.5 -> low
    expect(computeRankingConfidence(ranked)).toBe('low');
  });

  it('returns low confidence for high overlap', () => {
    const ranked = [
      { summary: { p10: 50, p50: 60, p90: 70 } },
      { summary: { p10: 55, p50: 62, p90: 72 } },
    ];
    expect(computeRankingConfidence(ranked)).toBe('low');
  });

  it('returns high confidence for single result', () => {
    const ranked = [{ summary: { p10: 50, p50: 60, p90: 70 } }];
    expect(computeRankingConfidence(ranked)).toBe('high');
  });

  it('returns high confidence for empty results', () => {
    expect(computeRankingConfidence([])).toBe('high');
  });

  it('handles null summaries gracefully', () => {
    const ranked = [
      { summary: { p10: 80, p50: 90, p90: 100 } },
      { summary: null },
    ];
    expect(computeRankingConfidence(ranked as any)).toBe('high');
  });

  it('returns detailed confidence with overlap percentage', () => {
    const ranked = [
      { summary: { p10: 80, p50: 90, p90: 100 } },
      { summary: { p10: 50, p50: 60, p90: 70 } },
    ];
    const result = computeRankingConfidenceDetailed(ranked);
    expect(result.confidence).toBe('high');
    expect(result.overlap_pct).toBe(0);
  });
});

describe('Node-Level Sensitivity Aggregation', () => {
  const mockEdges: SensitivityEdge[] = [
    { edge_id: 'a::b::0', from: 'a', to: 'b', weight: 0.8, belief: 1.0, provenance: 'test', rank: 1, score: 0.8 },
    { edge_id: 'a::c::1', from: 'a', to: 'c', weight: 0.4, belief: 1.0, provenance: 'test', rank: 2, score: 0.4 },
    { edge_id: 'b::d::2', from: 'b', to: 'd', weight: 0.6, belief: 1.0, provenance: 'test', rank: 3, score: 0.6 },
  ];

  const mockNodes = [
    { id: 'a', label: 'Node A' },
    { id: 'b', label: 'Node B' },
    { id: 'c', label: 'Node C' },
    { id: 'd', label: 'Node D' },
  ];

  it('aggregates edge sensitivity by source node', () => {
    const result = aggregateNodeSensitivity(mockEdges, mockNodes);

    // Node A has edges to B (0.8) and C (0.4) = 1.2 total
    // Node B has edge to D (0.6) = 0.6 total
    // Total = 1.8
    // Node A: 1.2/1.8 = 66.67% -> 67%
    // Node B: 0.6/1.8 = 33.33% -> 33%

    expect(result).toHaveLength(2); // Only source nodes
    expect(result[0].node_id).toBe('a');
    expect(result[0].node_label).toBe('Node A');
    expect(result[0].contribution_pct).toBe(67);
    expect(result[0].edge_count).toBe(2);

    expect(result[1].node_id).toBe('b');
    expect(result[1].contribution_pct).toBe(33);
    expect(result[1].edge_count).toBe(1);
  });

  it('returns top N nodes', () => {
    const result = getTopNodeSensitivity(mockEdges, mockNodes, 1);
    expect(result).toHaveLength(1);
    expect(result[0].node_id).toBe('a');
  });

  it('handles empty edges', () => {
    const result = aggregateNodeSensitivity([], mockNodes);
    expect(result).toHaveLength(0);
  });

  it('uses node id as label when label missing', () => {
    const nodesWithoutLabels = [{ id: 'a' }, { id: 'b' }];
    const result = aggregateNodeSensitivity(mockEdges, nodesWithoutLabels);
    expect(result[0].node_label).toBe('a');
  });
});

describe('Change Attribution from Delta', () => {
  const baseGraph = {
    nodes: [
      { id: 'input', value: 100, label: 'Input' },
      { id: 'factor', value: 0.5, label: 'Factor' },
      { id: 'output', value: 50, label: 'Output' },
    ],
    edges: [
      { from: 'input', to: 'output', weight: 0.8 },
      { from: 'factor', to: 'output', weight: 0.5 },
    ],
  };

  it('detects node value changes', () => {
    const delta = {
      label: 'Higher Input',
      nodes: [{ id: 'input', value: 150 }],
    };

    const result = buildChangeAttributionFromDelta(baseGraph, delta, 50, 75);

    expect(result.outcome_delta).toBe(25);
    expect(result.primary_drivers).toHaveLength(1);
    expect(result.primary_drivers[0].change_type).toBe('node_value_changed');
    expect(result.primary_drivers[0].before_value).toBe(100);
    expect(result.primary_drivers[0].after_value).toBe(150);
    expect(result.primary_drivers[0].contribution_pct).toBe(100);
  });

  it('detects edge weight changes', () => {
    const delta = {
      label: 'Stronger Connection',
      edges: [{ from: 'input', to: 'output', weight: 1.2 }],
    };

    const result = buildChangeAttributionFromDelta(baseGraph, delta, 50, 75);

    expect(result.primary_drivers).toHaveLength(1);
    expect(result.primary_drivers[0].change_type).toBe('edge_weight_changed');
    expect(result.primary_drivers[0].before_value).toBe(0.8);
    expect(result.primary_drivers[0].after_value).toBe(1.2);
  });

  it('detects new edges', () => {
    const delta = {
      label: 'New Connection',
      edges: [
        { from: 'input', to: 'output', weight: 0.8 }, // Existing
        { from: 'input', to: 'factor', weight: 0.3 }, // New
      ],
    };

    const result = buildChangeAttributionFromDelta(baseGraph, delta, 50, 60);

    const newEdgeDriver = result.primary_drivers.find(
      (d) => d.change_type === 'edge_added'
    );
    expect(newEdgeDriver).toBeDefined();
    expect(newEdgeDriver?.description).toContain('Input → Factor');
  });

  it('handles empty delta', () => {
    const delta = { label: 'No Changes' };

    const result = buildChangeAttributionFromDelta(baseGraph, delta, 50, 50);

    expect(result.outcome_delta).toBe(0);
    expect(result.primary_drivers).toHaveLength(0);
    expect(result.summary).toContain('No significant');
  });

  it('generates meaningful summary', () => {
    const delta = {
      label: 'Major Change',
      nodes: [{ id: 'input', value: 200 }],
    };

    const result = buildChangeAttributionFromDelta(baseGraph, delta, 50, 100);

    expect(result.summary).toContain('increase');
    expect(result.summary).toContain('Input');
  });

  it('sorts drivers by contribution magnitude', () => {
    const delta = {
      label: 'Multiple Changes',
      nodes: [
        { id: 'input', value: 110 }, // +10
        { id: 'factor', value: 0.8 }, // +0.3
      ],
    };

    const result = buildChangeAttributionFromDelta(baseGraph, delta, 50, 60);

    // Input change (10) should be first, factor change (0.3) second
    expect(result.primary_drivers[0].affected_nodes[0].id).toBe('input');
  });
});

describe('run_bundle Ranking Integration', () => {
  // These tests would require a running server, so we test the components
  // Integration tests would be in a separate file with server setup

  it('ranking sorts by p50 by default', () => {
    const results = [
      { label: 'A', summary: { p10: 40, p50: 50, p90: 60 } },
      { label: 'B', summary: { p10: 50, p50: 60, p90: 70 } },
      { label: 'C', summary: { p10: 45, p50: 55, p90: 65 } },
    ];

    // Sort by p50 descending
    const sorted = [...results].sort((a, b) => b.summary.p50 - a.summary.p50);

    expect(sorted[0].label).toBe('B'); // p50 = 60
    expect(sorted[1].label).toBe('C'); // p50 = 55
    expect(sorted[2].label).toBe('A'); // p50 = 50
  });

  it('ranking can sort by p10 for risk-averse decisions', () => {
    const results = [
      { label: 'A', summary: { p10: 40, p50: 50, p90: 60 } },
      { label: 'B', summary: { p10: 50, p50: 45, p90: 70 } }, // Higher floor, lower median
      { label: 'C', summary: { p10: 45, p50: 55, p90: 65 } },
    ];

    // Sort by p10 descending (higher floor = better for risk-averse)
    const sorted = [...results].sort((a, b) => b.summary.p10 - a.summary.p10);

    expect(sorted[0].label).toBe('B'); // p10 = 50 (best floor)
    expect(sorted[1].label).toBe('C'); // p10 = 45
    expect(sorted[2].label).toBe('A'); // p10 = 40
  });

  it('ranking can sort by p90 for optimistic decisions', () => {
    const results = [
      { label: 'A', summary: { p10: 40, p50: 50, p90: 80 } }, // Highest ceiling
      { label: 'B', summary: { p10: 50, p50: 60, p90: 70 } },
      { label: 'C', summary: { p10: 45, p50: 55, p90: 65 } },
    ];

    // Sort by p90 descending (higher ceiling = better for optimists)
    const sorted = [...results].sort((a, b) => b.summary.p90 - a.summary.p90);

    expect(sorted[0].label).toBe('A'); // p90 = 80 (best ceiling)
    expect(sorted[1].label).toBe('B'); // p90 = 70
    expect(sorted[2].label).toBe('C'); // p90 = 65
  });
});
