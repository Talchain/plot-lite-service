/**
 * Edge Type Inference Tests
 *
 * Phase 2: Tests for edge type inference from node kinds
 */

import { describe, it, expect } from 'vitest';
import {
  inferEdgeType,
  inferEdgeTypes,
  isTypicalEdgeType,
} from '../src/services/ranking/edge-type-inference.js';
import type { GraphNode, GraphEdge, NodeKind, EdgeType } from '../src/trust/types.js';

describe('Edge Type Inference', () => {
  describe('inferEdgeType', () => {
    it('infers functional for goal -> decision', () => {
      expect(inferEdgeType('goal', 'decision')).toBe('functional');
    });

    it('infers functional for goal -> outcome', () => {
      expect(inferEdgeType('goal', 'outcome')).toBe('functional');
    });

    it('infers structural for decision -> option', () => {
      expect(inferEdgeType('decision', 'option')).toBe('structural');
    });

    it('infers structural for option -> action', () => {
      expect(inferEdgeType('option', 'action')).toBe('structural');
    });

    it('infers probabilistic for option -> outcome', () => {
      expect(inferEdgeType('option', 'outcome')).toBe('probabilistic');
    });

    it('infers probabilistic for action -> outcome', () => {
      expect(inferEdgeType('action', 'outcome')).toBe('probabilistic');
    });

    it('infers probabilistic for action -> risk', () => {
      expect(inferEdgeType('action', 'risk')).toBe('probabilistic');
    });

    it('infers probabilistic for risk -> outcome', () => {
      expect(inferEdgeType('risk', 'outcome')).toBe('probabilistic');
    });

    it('defaults to probabilistic for unspecified node kinds', () => {
      expect(inferEdgeType(undefined, undefined)).toBe('probabilistic');
    });

    it('defaults to probabilistic for unknown combinations', () => {
      expect(inferEdgeType('option', 'goal')).toBe('probabilistic');
      expect(inferEdgeType('risk', 'decision')).toBe('probabilistic');
    });
  });

  describe('inferEdgeTypes', () => {
    it('preserves explicit edge types', () => {
      const nodes: GraphNode[] = [
        { id: 'a', label: 'A', kind: 'goal' },
        { id: 'b', label: 'B', kind: 'decision' },
      ];
      const edges: GraphEdge[] = [
        { from: 'a', to: 'b', edge_type: 'structural' }, // Explicitly set (unusual)
      ];

      const result = inferEdgeTypes(nodes, edges);

      expect(result.edges[0].edge_type).toBe('structural');
      expect(result.explicit_count).toBe(1);
      expect(result.inferred_count).toBe(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('infers edge types when not specified', () => {
      const nodes: GraphNode[] = [
        { id: 'goal1', label: 'Goal 1', kind: 'goal' },
        { id: 'dec1', label: 'Decision 1', kind: 'decision' },
        { id: 'opt1', label: 'Option 1', kind: 'option' },
        { id: 'out1', label: 'Outcome 1', kind: 'outcome' },
      ];
      const edges: GraphEdge[] = [
        { from: 'goal1', to: 'dec1' },
        { from: 'dec1', to: 'opt1' },
        { from: 'opt1', to: 'out1' },
      ];

      const result = inferEdgeTypes(nodes, edges);

      expect(result.edges[0].edge_type).toBe('functional');
      expect(result.edges[1].edge_type).toBe('structural');
      expect(result.edges[2].edge_type).toBe('probabilistic');
      expect(result.explicit_count).toBe(0);
      expect(result.inferred_count).toBe(3);
      expect(result.warnings).toHaveLength(3);
    });

    it('generates warnings with correct metadata', () => {
      const nodes: GraphNode[] = [
        { id: 'a', label: 'A', kind: 'goal' },
        { id: 'b', label: 'B', kind: 'decision' },
      ];
      const edges: GraphEdge[] = [{ from: 'a', to: 'b' }];

      const result = inferEdgeTypes(nodes, edges);

      expect(result.warnings[0]).toEqual({
        code: 'EDGE_TYPE_INFERRED',
        message: "Edge a->b type inferred as 'functional' from node kinds",
        edge_id: 'a->b',
        from: 'a',
        to: 'b',
        inferred_type: 'functional',
        severity: 'info',
      });
    });

    it('handles mixed explicit and inferred edges', () => {
      const nodes: GraphNode[] = [
        { id: 'a', label: 'A', kind: 'goal' },
        { id: 'b', label: 'B', kind: 'decision' },
        { id: 'c', label: 'C', kind: 'option' },
      ];
      const edges: GraphEdge[] = [
        { from: 'a', to: 'b', edge_type: 'functional' },
        { from: 'b', to: 'c' }, // Will be inferred
      ];

      const result = inferEdgeTypes(nodes, edges);

      expect(result.explicit_count).toBe(1);
      expect(result.inferred_count).toBe(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].edge_id).toBe('b->c');
    });

    it('handles nodes without kind specified', () => {
      const nodes: GraphNode[] = [
        { id: 'a', label: 'A' }, // No kind
        { id: 'b', label: 'B' }, // No kind
      ];
      const edges: GraphEdge[] = [{ from: 'a', to: 'b' }];

      const result = inferEdgeTypes(nodes, edges);

      expect(result.edges[0].edge_type).toBe('probabilistic');
      expect(result.inferred_count).toBe(1);
    });

    it('handles missing nodes gracefully', () => {
      const nodes: GraphNode[] = [
        { id: 'a', label: 'A', kind: 'goal' },
      ];
      const edges: GraphEdge[] = [
        { from: 'a', to: 'nonexistent' },
      ];

      const result = inferEdgeTypes(nodes, edges);

      expect(result.edges[0].edge_type).toBe('probabilistic');
      expect(result.inferred_count).toBe(1);
    });

    it('preserves other edge properties', () => {
      const nodes: GraphNode[] = [
        { id: 'a', label: 'A', kind: 'goal' },
        { id: 'b', label: 'B', kind: 'decision' },
      ];
      const edges: GraphEdge[] = [
        { from: 'a', to: 'b', weight: 0.8, belief: 0.9, label: 'causes' },
      ];

      const result = inferEdgeTypes(nodes, edges);

      expect(result.edges[0]).toEqual({
        from: 'a',
        to: 'b',
        weight: 0.8,
        belief: 0.9,
        label: 'causes',
        edge_type: 'functional',
      });
    });
  });

  describe('isTypicalEdgeType', () => {
    it('returns true for typical goal -> decision functional edge', () => {
      expect(isTypicalEdgeType('functional', 'goal', 'decision')).toBe(true);
    });

    it('returns false for atypical goal -> decision structural edge', () => {
      expect(isTypicalEdgeType('structural', 'goal', 'decision')).toBe(false);
    });

    it('returns true for typical decision -> option structural edge', () => {
      expect(isTypicalEdgeType('structural', 'decision', 'option')).toBe(true);
    });

    it('returns true for typical option -> outcome probabilistic edge', () => {
      expect(isTypicalEdgeType('probabilistic', 'option', 'outcome')).toBe(true);
    });
  });

  describe('full inference table coverage', () => {
    const testCases: Array<{
      from: NodeKind | undefined;
      to: NodeKind | undefined;
      expected: EdgeType;
    }> = [
      { from: 'goal', to: 'decision', expected: 'functional' },
      { from: 'goal', to: 'outcome', expected: 'functional' },
      { from: 'decision', to: 'option', expected: 'structural' },
      { from: 'option', to: 'action', expected: 'structural' },
      { from: 'option', to: 'outcome', expected: 'probabilistic' },
      { from: 'action', to: 'outcome', expected: 'probabilistic' },
      { from: 'action', to: 'risk', expected: 'probabilistic' },
      { from: 'risk', to: 'outcome', expected: 'probabilistic' },
      // Defaults
      { from: undefined, to: undefined, expected: 'probabilistic' },
      { from: 'outcome', to: 'goal', expected: 'probabilistic' },
    ];

    for (const { from, to, expected } of testCases) {
      it(`infers ${expected} for ${from ?? 'undefined'} -> ${to ?? 'undefined'}`, () => {
        expect(inferEdgeType(from, to)).toBe(expected);
      });
    }
  });
});
