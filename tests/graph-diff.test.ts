import { describe, it, expect } from 'vitest';

import { computeGraphDiff, type DiffGraph } from '../src/util/graph-diff.js';

describe('Graph Diff', () => {
  it('detects added nodes', () => {
    const before: DiffGraph = {
      nodes: [{ id: 'n1', label: 'A' }],
      edges: [],
    };

    const after: DiffGraph = {
      nodes: [
        { id: 'n1', label: 'A' },
        { id: 'n2', label: 'B' },
      ],
      edges: [],
    };

    const diff = computeGraphDiff(before, after);

    expect(diff.nodes_added).toHaveLength(1);
    expect(diff.nodes_added[0].id).toBe('n2');
    expect(diff.nodes_removed).toHaveLength(0);
    expect(diff.summary.total_changes).toBe(1);
  });

  it('detects removed nodes', () => {
    const before: DiffGraph = {
      nodes: [
        { id: 'n1', label: 'A' },
        { id: 'n2', label: 'B' },
      ],
      edges: [],
    };

    const after: DiffGraph = {
      nodes: [{ id: 'n1', label: 'A' }],
      edges: [],
    };

    const diff = computeGraphDiff(before, after);

    expect(diff.nodes_removed).toHaveLength(1);
    expect(diff.nodes_removed[0].id).toBe('n2');
    expect(diff.summary.total_changes).toBe(1);
  });

  it('detects modified node fields', () => {
    const before: DiffGraph = {
      nodes: [{ id: 'n1', label: 'Old' }],
      edges: [],
    };

    const after: DiffGraph = {
      nodes: [{ id: 'n1', label: 'New' }],
      edges: [],
    };

    const diff = computeGraphDiff(before, after);

    expect(diff.nodes_modified).toHaveLength(1);
    expect(diff.nodes_modified[0].node.label).toBe('New');
    expect(diff.nodes_modified[0].changes[0]).toMatchObject({ field: 'label', old_value: 'Old', new_value: 'New' });
  });

  it('detects added edges', () => {
    const before: DiffGraph = {
      nodes: [
        { id: 'n1', label: 'A' },
        { id: 'n2', label: 'B' },
      ],
      edges: [],
    };

    const after: DiffGraph = {
      nodes: before.nodes,
      edges: [
        { id: 'e1', from: 'n1', to: 'n2', weight: 1.0, belief: 0.8 },
      ],
    };

    const diff = computeGraphDiff(before, after);

    expect(diff.edges_added).toHaveLength(1);
    expect(diff.edges_added[0].id).toBe('e1');
    expect(diff.summary.total_changes).toBe(1 + diff.nodes_added.length + diff.nodes_removed.length + diff.nodes_modified.length + diff.edges_removed.length + diff.edges_modified.length);
  });

  it('detects modified edge weight and counts as significant when > 0.5', () => {
    const before: DiffGraph = {
      nodes: [
        { id: 'n1', label: 'A' },
        { id: 'n2', label: 'B' },
      ],
      edges: [
        { id: 'e1', from: 'n1', to: 'n2', weight: 1.0, belief: 0.8 },
      ],
    };

    const after: DiffGraph = {
      nodes: before.nodes,
      edges: [
        { id: 'e1', from: 'n1', to: 'n2', weight: 2.0, belief: 0.8 },
      ],
    };

    const diff = computeGraphDiff(before, after);

    expect(diff.edges_modified).toHaveLength(1);
    const edgeDiff = diff.edges_modified[0];
    const weightChange = edgeDiff.changes.find((c) => c.field === 'weight');
    expect(weightChange?.old_value).toBe(1.0);
    expect(weightChange?.new_value).toBe(2.0);
    expect(diff.summary.significant_changes).toBe(1);
  });

  it('ignores insignificant weight changes (≤ 0.5) for significant count', () => {
    const before: DiffGraph = {
      nodes: [
        { id: 'n1', label: 'A' },
        { id: 'n2', label: 'B' },
      ],
      edges: [
        { id: 'e1', from: 'n1', to: 'n2', weight: 1.0, belief: 0.8 },
      ],
    };

    const after: DiffGraph = {
      nodes: before.nodes,
      edges: [
        { id: 'e1', from: 'n1', to: 'n2', weight: 1.4, belief: 0.8 },
      ],
    };

    const diff = computeGraphDiff(before, after);

    expect(diff.edges_modified).toHaveLength(1);
    expect(diff.summary.significant_changes).toBe(0);
  });

  it('uses edge id when available and falls back to from/to when missing', () => {
    const before: DiffGraph = {
      nodes: [
        { id: 'n1', label: 'A' },
        { id: 'n2', label: 'B' },
      ],
      edges: [
        { from: 'n1', to: 'n2', weight: 1.0 },
      ],
    };

    const after: DiffGraph = {
      nodes: before.nodes,
      edges: [
        { from: 'n1', to: 'n2', weight: 1.5 },
      ],
    };

    const diff = computeGraphDiff(before, after);

    expect(diff.edges_added).toHaveLength(0);
    expect(diff.edges_removed).toHaveLength(0);
    expect(diff.edges_modified).toHaveLength(1);
  });

  it('returns zero changes for identical graphs', () => {
    const graph: DiffGraph = {
      nodes: [
        { id: 'n1', label: 'A' },
        { id: 'n2', label: 'B' },
      ],
      edges: [
        { id: 'e1', from: 'n1', to: 'n2', weight: 1.0, belief: 0.8 },
      ],
    };

    const diff = computeGraphDiff(graph, graph);

    expect(diff.summary.total_changes).toBe(0);
    expect(diff.summary.significant_changes).toBe(0);
    expect(diff.nodes_added).toHaveLength(0);
    expect(diff.nodes_removed).toHaveLength(0);
    expect(diff.nodes_modified).toHaveLength(0);
    expect(diff.edges_added).toHaveLength(0);
    expect(diff.edges_removed).toHaveLength(0);
    expect(diff.edges_modified).toHaveLength(0);
  });
});
