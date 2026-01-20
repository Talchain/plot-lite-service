/**
 * Unit tests for V2 option node filtering
 */

import { describe, it, expect } from 'vitest';
import {
  filterOptionNodes,
  hasOptionNodes,
  countOptionNodes,
} from '../src/normalisation/option-filter.js';
import type { EngineGraphV3 } from '../src/types/engine-v3.js';

describe('Option Node Filtering', () => {
  describe('filterOptionNodes', () => {
    it('removes option nodes', () => {
      const graph: EngineGraphV3 = {
        nodes: [
          { id: 'opt1', kind: 'option' as any, label: 'Option 1' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
          { id: 'factor', kind: 'factor', label: 'Factor' },
        ],
        edges: [],
      };

      const result = filterOptionNodes(graph);

      expect(result.filteredGraph.nodes).toHaveLength(2);
      expect(result.removedNodeIds.has('opt1')).toBe(true);
      expect(result.removedNodeIds.size).toBe(1);
    });

    it('removes edges incident to option nodes', () => {
      const graph: EngineGraphV3 = {
        nodes: [
          { id: 'opt1', kind: 'option' as any, label: 'Option 1' },
          { id: 'factor', kind: 'factor', label: 'Factor' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          { from: 'opt1', to: 'factor', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
          { from: 'factor', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
          { from: 'factor', to: 'opt1', exists_probability: 0.5, strength: { mean: 0.3, std: 0.1 } },
        ],
      };

      const result = filterOptionNodes(graph);

      // Only factor -> goal should remain
      expect(result.filteredGraph.edges).toHaveLength(1);
      expect(result.filteredGraph.edges[0].from).toBe('factor');
      expect(result.filteredGraph.edges[0].to).toBe('goal');
      expect(result.removedEdgeCount).toBe(2);
    });

    it('removes constraint nodes and their edges', () => {
      const graph: EngineGraphV3 = {
        nodes: [
          { id: 'constraint-1', kind: 'constraint' as any, label: 'Constraint' },
          { id: 'factor', kind: 'factor', label: 'Factor' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          { from: 'constraint-1', to: 'factor', exists_probability: 0.8, strength: { mean: 0.4, std: 0.1 } },
          { from: 'factor', to: 'goal', exists_probability: 0.9, strength: { mean: 0.6, std: 0.1 } },
        ],
      };

      const result = filterOptionNodes(graph);

      expect(result.filteredGraph.nodes).toHaveLength(2);
      expect(result.filteredGraph.nodes.find((n) => n.id === 'constraint-1')).toBeUndefined();
      expect(result.filteredGraph.edges).toHaveLength(1);
      expect(result.filteredGraph.edges[0].from).toBe('factor');
      expect(result.filteredGraph.edges[0].to).toBe('goal');
      expect(result.removedNodeIds.has('constraint-1')).toBe(true);
      expect(result.removedEdgeCount).toBe(1);
    });

    it('returns original graph when no option nodes', () => {
      const graph: EngineGraphV3 = {
        nodes: [
          { id: 'a', kind: 'factor', label: 'A' },
          { id: 'b', kind: 'goal', label: 'B' },
        ],
        edges: [
          { from: 'a', to: 'b', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        ],
      };

      const result = filterOptionNodes(graph);

      expect(result.filteredGraph).toBe(graph); // Same reference
      expect(result.removedNodeIds.size).toBe(0);
      expect(result.removedEdgeCount).toBe(0);
    });

    it('handles case-insensitive option kind', () => {
      const graph: EngineGraphV3 = {
        nodes: [
          { id: 'opt1', kind: 'OPTION' as any, label: 'Option 1' },
          { id: 'opt2', kind: 'Option' as any, label: 'Option 2' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [],
      };

      const result = filterOptionNodes(graph);

      expect(result.filteredGraph.nodes).toHaveLength(1);
      expect(result.removedNodeIds.size).toBe(2);
    });

    it('removes all option nodes and their edges', () => {
      const graph: EngineGraphV3 = {
        nodes: [
          { id: 'opt-a', kind: 'option' as any, label: 'Option A' },
          { id: 'opt-b', kind: 'option' as any, label: 'Option B' },
          { id: 'factor', kind: 'factor', label: 'Factor' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          { from: 'opt-a', to: 'factor', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
          { from: 'opt-b', to: 'factor', exists_probability: 0.8, strength: { mean: 0.3, std: 0.1 } },
          { from: 'factor', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
        ],
      };

      const result = filterOptionNodes(graph);

      expect(result.filteredGraph.nodes).toHaveLength(2);
      expect(result.filteredGraph.edges).toHaveLength(1);
      expect(result.removedNodeIds.size).toBe(2);
      expect(result.removedEdgeCount).toBe(2);
    });
  });

  describe('hasOptionNodes', () => {
    it('returns true when option nodes present', () => {
      const graph: EngineGraphV3 = {
        nodes: [
          { id: 'opt1', kind: 'option' as any, label: 'Option 1' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [],
      };

      expect(hasOptionNodes(graph)).toBe(true);
    });

    it('returns false when no option nodes', () => {
      const graph: EngineGraphV3 = {
        nodes: [
          { id: 'factor', kind: 'factor', label: 'Factor' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [],
      };

      expect(hasOptionNodes(graph)).toBe(false);
    });

    it('is case-insensitive', () => {
      const graph: EngineGraphV3 = {
        nodes: [
          { id: 'opt1', kind: 'OPTION' as any, label: 'Option 1' },
        ],
        edges: [],
      };

      expect(hasOptionNodes(graph)).toBe(true);
    });
  });

  describe('countOptionNodes', () => {
    it('counts option nodes correctly', () => {
      const graph: EngineGraphV3 = {
        nodes: [
          { id: 'opt1', kind: 'option' as any, label: 'Option 1' },
          { id: 'opt2', kind: 'option' as any, label: 'Option 2' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [],
      };

      expect(countOptionNodes(graph)).toBe(2);
    });

    it('returns 0 when no option nodes', () => {
      const graph: EngineGraphV3 = {
        nodes: [
          { id: 'factor', kind: 'factor', label: 'Factor' },
        ],
        edges: [],
      };

      expect(countOptionNodes(graph)).toBe(0);
    });
  });
});
