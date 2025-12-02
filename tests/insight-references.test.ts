/**
 * Insight Reference Helpers Tests
 *
 * Tests for structured insight utilities that build node and edge references
 * for UI interaction (highlighting, navigation).
 */

import { describe, it, expect } from 'vitest';
import {
  buildNodeReference,
  buildEdgeReference,
  createNodeInsight,
  createEdgeInsight,
  createMixedInsight,
} from '../src/util/insight-references.js';

describe('buildNodeReference', () => {
  const testNodes = [
    { id: 'price', label: 'Price' },
    { id: 'revenue', label: 'Revenue' },
    { id: 'marketing', label: 'Marketing Spend' },
  ];

  it('returns node reference with id and label', () => {
    const ref = buildNodeReference('price', testNodes);
    expect(ref).toEqual({
      node_id: 'price',
      node_label: 'Price',
    });
  });

  it('returns null for non-existent node', () => {
    const ref = buildNodeReference('nonexistent', testNodes);
    expect(ref).toBeNull();
  });

  it('handles empty nodes array', () => {
    const ref = buildNodeReference('price', []);
    expect(ref).toBeNull();
  });
});

describe('buildEdgeReference', () => {
  const testNodes = [
    { id: 'price', label: 'Price' },
    { id: 'revenue', label: 'Revenue' },
    { id: 'marketing', label: 'Marketing Spend' },
  ];

  it('returns edge reference with from/to ids and labels', () => {
    const ref = buildEdgeReference('price', 'revenue', testNodes);
    expect(ref).toEqual({
      from_id: 'price',
      from_label: 'Price',
      to_id: 'revenue',
      to_label: 'Revenue',
    });
  });

  it('returns null if from node not found', () => {
    const ref = buildEdgeReference('nonexistent', 'revenue', testNodes);
    expect(ref).toBeNull();
  });

  it('returns null if to node not found', () => {
    const ref = buildEdgeReference('price', 'nonexistent', testNodes);
    expect(ref).toBeNull();
  });

  it('returns null if both nodes not found', () => {
    const ref = buildEdgeReference('x', 'y', testNodes);
    expect(ref).toBeNull();
  });
});

describe('createNodeInsight', () => {
  const testNodes = [
    { id: 'price', label: 'Price' },
    { id: 'revenue', label: 'Revenue' },
    { id: 'marketing', label: 'Marketing Spend' },
  ];

  it('creates insight with single node reference', () => {
    const insight = createNodeInsight(
      'Focus validation on this primary driver',
      ['marketing'],
      testNodes
    );

    expect(insight.text).toBe('Focus validation on this primary driver');
    expect(insight.node_references).toHaveLength(1);
    expect(insight.node_references![0]).toEqual({
      node_id: 'marketing',
      node_label: 'Marketing Spend',
    });
  });

  it('creates insight with multiple node references', () => {
    const insight = createNodeInsight(
      'These nodes are significant',
      ['price', 'revenue'],
      testNodes
    );

    expect(insight.node_references).toHaveLength(2);
    expect(insight.node_references![0].node_id).toBe('price');
    expect(insight.node_references![1].node_id).toBe('revenue');
  });

  it('filters out non-existent nodes', () => {
    const insight = createNodeInsight(
      'Some nodes exist',
      ['price', 'nonexistent', 'revenue'],
      testNodes
    );

    expect(insight.node_references).toHaveLength(2);
  });

  it('omits node_references when all nodes not found', () => {
    const insight = createNodeInsight(
      'No nodes found',
      ['x', 'y', 'z'],
      testNodes
    );

    expect(insight.text).toBe('No nodes found');
    expect(insight.node_references).toBeUndefined();
  });

  it('omits node_references when empty array provided', () => {
    const insight = createNodeInsight('No refs', [], testNodes);
    expect(insight.node_references).toBeUndefined();
  });
});

describe('createEdgeInsight', () => {
  const testNodes = [
    { id: 'price', label: 'Price' },
    { id: 'revenue', label: 'Revenue' },
    { id: 'marketing', label: 'Marketing Spend' },
  ];

  it('creates insight with single edge reference', () => {
    const insight = createEdgeInsight(
      'Low evidence for this critical path',
      [{ from: 'marketing', to: 'revenue' }],
      testNodes
    );

    expect(insight.text).toBe('Low evidence for this critical path');
    expect(insight.edge_references).toHaveLength(1);
    expect(insight.edge_references![0]).toEqual({
      from_id: 'marketing',
      from_label: 'Marketing Spend',
      to_id: 'revenue',
      to_label: 'Revenue',
    });
  });

  it('creates insight with multiple edge references', () => {
    const insight = createEdgeInsight(
      'Multiple edges affected',
      [
        { from: 'price', to: 'revenue' },
        { from: 'marketing', to: 'revenue' },
      ],
      testNodes
    );

    expect(insight.edge_references).toHaveLength(2);
  });

  it('filters out invalid edges', () => {
    const insight = createEdgeInsight(
      'Some edges valid',
      [
        { from: 'price', to: 'revenue' },
        { from: 'x', to: 'y' },
      ],
      testNodes
    );

    expect(insight.edge_references).toHaveLength(1);
  });

  it('omits edge_references when all edges invalid', () => {
    const insight = createEdgeInsight(
      'No edges found',
      [{ from: 'x', to: 'y' }],
      testNodes
    );

    expect(insight.edge_references).toBeUndefined();
  });
});

describe('createMixedInsight', () => {
  const testNodes = [
    { id: 'price', label: 'Price' },
    { id: 'revenue', label: 'Revenue' },
    { id: 'marketing', label: 'Marketing Spend' },
  ];

  it('creates insight with both node and edge references', () => {
    const insight = createMixedInsight(
      'Complex insight',
      ['price'],
      [{ from: 'marketing', to: 'revenue' }],
      testNodes
    );

    expect(insight.text).toBe('Complex insight');
    expect(insight.node_references).toHaveLength(1);
    expect(insight.node_references![0].node_id).toBe('price');
    expect(insight.edge_references).toHaveLength(1);
    expect(insight.edge_references![0].from_id).toBe('marketing');
  });

  it('handles partial references', () => {
    const insight = createMixedInsight(
      'Partial insight',
      ['price'],
      [{ from: 'x', to: 'y' }],
      testNodes
    );

    expect(insight.node_references).toHaveLength(1);
    expect(insight.edge_references).toBeUndefined();
  });

  it('omits both references when none valid', () => {
    const insight = createMixedInsight(
      'Empty insight',
      ['x'],
      [{ from: 'a', to: 'b' }],
      testNodes
    );

    expect(insight.node_references).toBeUndefined();
    expect(insight.edge_references).toBeUndefined();
  });
});

describe('integration scenarios', () => {
  const realWorldNodes = [
    { id: 'marketing_budget', label: 'Marketing Budget', value: 0.8 },
    { id: 'brand_awareness', label: 'Brand Awareness', value: 0.6 },
    { id: 'sales_volume', label: 'Sales Volume', value: 0.7 },
    { id: 'revenue', label: 'Total Revenue', value: 0.9 },
    { id: 'profit', label: 'Net Profit', value: 0.5 },
  ];

  it('builds driver insight for explain_delta top driver', () => {
    const topDriverNodeId = 'marketing_budget';
    const insight = createNodeInsight(
      'Focus validation on this primary outcome driver',
      [topDriverNodeId],
      realWorldNodes
    );

    expect(insight.node_references![0].node_label).toBe('Marketing Budget');
  });

  it('builds risk insight for low-evidence edge', () => {
    const insight = createEdgeInsight(
      'Key assumption: this edge lacks external evidence',
      [{ from: 'marketing_budget', to: 'brand_awareness' }],
      realWorldNodes
    );

    expect(insight.edge_references![0].from_label).toBe('Marketing Budget');
    expect(insight.edge_references![0].to_label).toBe('Brand Awareness');
  });

  it('supports multiple drivers in single insight', () => {
    const topDriverIds = ['marketing_budget', 'brand_awareness', 'sales_volume'];
    const insight = createNodeInsight(
      'These nodes dominate outcome sensitivity',
      topDriverIds,
      realWorldNodes
    );

    expect(insight.node_references).toHaveLength(3);
    expect(insight.node_references!.map((r) => r.node_id)).toEqual(topDriverIds);
  });
});
