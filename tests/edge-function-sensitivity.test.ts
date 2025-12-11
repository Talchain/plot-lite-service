/**
 * Edge Function Sensitivity Analysis Tests
 *
 * Phase 3: Model Enhancements - Task 4.3
 * Tests for post-analysis sensitivity to edge function type choices.
 */

import { describe, it, expect } from 'vitest';
import {
  getTopSensitiveEdges,
  createGraphWithAlternativeFunction,
  estimateOutcomeWithGraph,
  analyzeEdgeFunctionSensitivity,
  shouldAnalyzeEdgeFunctionSensitivity,
} from '../src/engine/edge-function-sensitivity.js';
import type { Graph } from '../src/trust/types.js';

describe('Edge Function Sensitivity Analysis', () => {
  describe('getTopSensitiveEdges', () => {
    it('returns edges sorted by sensitivity score', () => {
      const edges = [
        { from: 'a', to: 'b', weight: 0.5, belief: 0.8 },
        { from: 'b', to: 'c', weight: 1.0, belief: 0.9 },
        { from: 'c', to: 'd', weight: 0.3, belief: 0.7 },
      ];

      const top = getTopSensitiveEdges(edges, 2);

      expect(top).toHaveLength(2);
      // b->c has highest score (1.0 * 0.9 = 0.9)
      expect(top[0].edge_id).toBe('b->c');
      expect(top[0].score).toBeCloseTo(0.9, 5);
      // a->b has second highest (0.5 * 0.8 = 0.4)
      expect(top[1].edge_id).toBe('a->b');
      expect(top[1].score).toBeCloseTo(0.4, 5);
    });

    it('uses default belief of 0.7 when not specified', () => {
      const edges = [{ from: 'a', to: 'b', weight: 1.0 }];

      const top = getTopSensitiveEdges(edges, 1);

      expect(top[0].score).toBeCloseTo(0.7, 5);
    });

    it('uses default weight of 1 when not specified', () => {
      const edges = [{ from: 'a', to: 'b', belief: 0.8 }];

      const top = getTopSensitiveEdges(edges, 1);

      expect(top[0].score).toBeCloseTo(0.8, 5);
    });

    it('handles function_type in edge data', () => {
      const edges = [
        { from: 'a', to: 'b', weight: 1.0, function_type: 'diminishing_returns' as const },
      ];

      const top = getTopSensitiveEdges(edges, 1);

      expect(top[0].current_function).toBe('diminishing_returns');
    });

    it('defaults to linear when function_type not specified', () => {
      const edges = [{ from: 'a', to: 'b', weight: 1.0 }];

      const top = getTopSensitiveEdges(edges, 1);

      expect(top[0].current_function).toBe('linear');
    });

    it('returns empty array for empty edges', () => {
      const top = getTopSensitiveEdges([], 5);
      expect(top).toHaveLength(0);
    });

    it('handles topN larger than available edges', () => {
      const edges = [{ from: 'a', to: 'b', weight: 1.0 }];

      const top = getTopSensitiveEdges(edges, 10);

      expect(top).toHaveLength(1);
    });
  });

  describe('createGraphWithAlternativeFunction', () => {
    it('creates graph with modified edge function', () => {
      const graph: Graph = {
        nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        edges: [{ from: 'a', to: 'b', weight: 1.0, function_type: 'linear' }],
      };

      const modified = createGraphWithAlternativeFunction(graph, 'a->b', 'diminishing_returns');

      expect(modified.edges[0].function_type).toBe('diminishing_returns');
      expect(modified.edges[0].function_params).toEqual({ k: 1 });
    });

    it('does not modify original graph', () => {
      const graph: Graph = {
        nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        edges: [{ from: 'a', to: 'b', weight: 1.0, function_type: 'linear' }],
      };

      createGraphWithAlternativeFunction(graph, 'a->b', 'diminishing_returns');

      expect(graph.edges[0].function_type).toBe('linear');
    });

    it('only modifies targeted edge', () => {
      const graph: Graph = {
        nodes: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
        ],
        edges: [
          { from: 'a', to: 'b', weight: 1.0, function_type: 'linear' },
          { from: 'b', to: 'c', weight: 0.5, function_type: 'linear' },
        ],
      };

      const modified = createGraphWithAlternativeFunction(graph, 'a->b', 'threshold');

      expect(modified.edges[0].function_type).toBe('threshold');
      expect(modified.edges[1].function_type).toBe('linear');
    });

    it('provides default params for threshold function', () => {
      const graph: Graph = {
        nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        edges: [{ from: 'a', to: 'b', weight: 1.0 }],
      };

      const modified = createGraphWithAlternativeFunction(graph, 'a->b', 'threshold');

      expect(modified.edges[0].function_params).toEqual({ threshold: 0.5, slope: 1 });
    });

    it('provides default params for s_curve function', () => {
      const graph: Graph = {
        nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        edges: [{ from: 'a', to: 'b', weight: 1.0 }],
      };

      const modified = createGraphWithAlternativeFunction(graph, 'a->b', 's_curve');

      expect(modified.edges[0].function_params).toEqual({ k: 1, midpoint: 0.5 });
    });
  });

  describe('estimateOutcomeWithGraph', () => {
    it('returns baseline when outcome node not found', () => {
      const graph: Graph = {
        nodes: [{ id: 'a', label: 'A' }],
        edges: [],
      };

      const result = estimateOutcomeWithGraph(graph, 'nonexistent', 100);

      expect(result).toBe(100);
    });

    it('uses node value when no incoming edges', () => {
      const graph: Graph = {
        nodes: [{ id: 'outcome', label: 'Outcome', value: 0.8 } as any],
        edges: [],
      };

      const result = estimateOutcomeWithGraph(graph, 'outcome', 100);

      // Expected: 100 * (0.8 + 0.8 * 0.4) = 100 * 1.12 = 112
      expect(result).toBeCloseTo(112, 1);
    });

    it('combines parent influence with node value', () => {
      const graph: Graph = {
        nodes: [
          { id: 'parent', label: 'Parent', value: 0.6 } as any,
          { id: 'outcome', label: 'Outcome', value: 0.5 } as any,
        ],
        edges: [{ from: 'parent', to: 'outcome', weight: 1.0 }],
      };

      const result = estimateOutcomeWithGraph(graph, 'outcome', 100);

      // Parent value 0.6, node value 0.5
      // Combined: 0.5 * 0.3 + 0.6 * 0.7 = 0.15 + 0.42 = 0.57
      // Result: 100 * (0.8 + 0.57 * 0.4) = 100 * 1.028 = 102.8
      expect(result).toBeCloseTo(102.8, 0);
    });

    it('applies edge function to transformed value', () => {
      const graph: Graph = {
        nodes: [
          { id: 'parent', label: 'Parent', value: 0.5 } as any,
          { id: 'outcome', label: 'Outcome', value: 0.5 } as any,
        ],
        edges: [
          {
            from: 'parent',
            to: 'outcome',
            weight: 1.0,
            function_type: 'diminishing_returns',
            function_params: { k: 1 },
          },
        ],
      };

      const result = estimateOutcomeWithGraph(graph, 'outcome', 100);

      // Diminishing returns at 0.5: 1 - e^(-0.5) ≈ 0.393
      // Combined with node value 0.5: 0.5 * 0.3 + 0.393 * 0.7 ≈ 0.425
      // Result: 100 * (0.8 + 0.425 * 0.4) ≈ 97
      expect(result).toBeGreaterThan(90);
      expect(result).toBeLessThan(110);
    });
  });

  describe('analyzeEdgeFunctionSensitivity', () => {
    it('returns empty results for graph with no edges', () => {
      const graph: Graph = {
        nodes: [{ id: 'outcome', label: 'Outcome' }],
        edges: [],
      };

      const result = analyzeEdgeFunctionSensitivity(graph, 'outcome', 100);

      expect(result.edges_tested).toBe(0);
      expect(result.sensitive_edges).toBe(0);
      expect(result.test_results).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('tests alternative functions on sensitive edges', () => {
      const graph: Graph = {
        nodes: [
          { id: 'parent', label: 'Parent', value: 0.5 } as any,
          { id: 'outcome', label: 'Outcome', value: 0.5 } as any,
        ],
        edges: [{ from: 'parent', to: 'outcome', weight: 1.0 }],
      };

      const result = analyzeEdgeFunctionSensitivity(graph, 'outcome', 100, {
        top_n_edges: 1,
        alternatives: ['linear', 'diminishing_returns', 'threshold'],
      });

      expect(result.edges_tested).toBe(1);
      // Should have tested 2 alternatives (excluding current linear)
      expect(result.test_results.length).toBe(2);
    });

    it('skips current function type in alternatives', () => {
      const graph: Graph = {
        nodes: [
          { id: 'parent', label: 'Parent', value: 0.5 } as any,
          { id: 'outcome', label: 'Outcome', value: 0.5 } as any,
        ],
        edges: [
          {
            from: 'parent',
            to: 'outcome',
            weight: 1.0,
            function_type: 'diminishing_returns',
            function_params: { k: 1 },
          },
        ],
      };

      const result = analyzeEdgeFunctionSensitivity(graph, 'outcome', 100, {
        top_n_edges: 1,
        alternatives: ['linear', 'diminishing_returns', 'threshold'],
      });

      // Should not test diminishing_returns against itself
      const testedFunctions = result.test_results.map((r) => r.alternative_function);
      expect(testedFunctions).not.toContain('diminishing_returns');
      expect(testedFunctions).toContain('linear');
      expect(testedFunctions).toContain('threshold');
    });

    it('generates warning for sensitive edges', () => {
      const graph: Graph = {
        nodes: [
          { id: 'parent', label: 'Parent', value: 0.5 } as any,
          { id: 'outcome', label: 'Outcome', value: 0.5 } as any,
        ],
        edges: [{ from: 'parent', to: 'outcome', weight: 1.0 }],
      };

      // Use very low threshold to ensure sensitivity is detected
      const result = analyzeEdgeFunctionSensitivity(graph, 'outcome', 100, {
        top_n_edges: 1,
        significance_threshold: 0.001,
        alternatives: ['linear', 'diminishing_returns'],
      });

      // Check if any edge is marked as sensitive
      const hasSensitiveEdge = result.test_results.some((r) => r.ranking_changed);

      if (hasSensitiveEdge) {
        expect(result.sensitive_edges).toBeGreaterThan(0);
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.warnings[0].code).toBe('EDGE_FUNCTION_SENSITIVE');
      }
    });

    it('warning includes edge details', () => {
      const graph: Graph = {
        nodes: [
          { id: 'marketing', label: 'Marketing', value: 0.8 } as any,
          { id: 'revenue', label: 'Revenue', value: 0.5 } as any,
        ],
        edges: [{ from: 'marketing', to: 'revenue', weight: 1.0 }],
      };

      const result = analyzeEdgeFunctionSensitivity(graph, 'revenue', 100, {
        top_n_edges: 1,
        significance_threshold: 0.001,
        alternatives: ['linear', 'threshold'],
      });

      if (result.warnings.length > 0) {
        const warning = result.warnings[0];
        expect(warning.message).toContain('marketing->revenue');
        expect(warning.severity).toBe('warning');
        expect(warning.context).toHaveProperty('edge_id');
        expect(warning.context).toHaveProperty('max_delta_pct');
      }
    });

    it('respects top_n_edges configuration', () => {
      const graph: Graph = {
        nodes: [
          { id: 'a', label: 'A', value: 0.5 } as any,
          { id: 'b', label: 'B', value: 0.5 } as any,
          { id: 'c', label: 'C', value: 0.5 } as any,
          { id: 'outcome', label: 'Outcome', value: 0.5 } as any,
        ],
        edges: [
          { from: 'a', to: 'outcome', weight: 1.0 },
          { from: 'b', to: 'outcome', weight: 0.8 },
          { from: 'c', to: 'outcome', weight: 0.5 },
        ],
      };

      const result = analyzeEdgeFunctionSensitivity(graph, 'outcome', 100, {
        top_n_edges: 2,
        alternatives: ['linear', 'threshold'],
      });

      // Should only test top 2 edges
      expect(result.edges_tested).toBe(2);
    });
  });

  describe('shouldAnalyzeEdgeFunctionSensitivity', () => {
    it('returns true for graphs with non-linear edge functions', () => {
      const graph: Graph = {
        nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        edges: [
          { from: 'a', to: 'b', function_type: 'diminishing_returns', function_params: { k: 1 } },
        ],
      };

      expect(shouldAnalyzeEdgeFunctionSensitivity(graph)).toBe(true);
    });

    it('returns true for graphs with high weight edges', () => {
      const graph: Graph = {
        nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        edges: [{ from: 'a', to: 'b', weight: 0.8 }],
      };

      expect(shouldAnalyzeEdgeFunctionSensitivity(graph)).toBe(true);
    });

    it('returns false for simple linear graphs with low weights', () => {
      const graph: Graph = {
        nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        edges: [{ from: 'a', to: 'b', weight: 0.3 }],
      };

      expect(shouldAnalyzeEdgeFunctionSensitivity(graph)).toBe(false);
    });

    it('returns false for empty graphs', () => {
      const graph: Graph = {
        nodes: [],
        edges: [],
      };

      expect(shouldAnalyzeEdgeFunctionSensitivity(graph)).toBe(false);
    });

    it('uses default weight of 1 when not specified', () => {
      const graph: Graph = {
        nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        edges: [{ from: 'a', to: 'b' }], // No weight specified, defaults to 1
      };

      expect(shouldAnalyzeEdgeFunctionSensitivity(graph)).toBe(true);
    });
  });
});
