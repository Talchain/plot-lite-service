/**
 * Edge Functions Tests
 *
 * Tests for non-linear edge function transformations.
 */

import { describe, it, expect } from 'vitest';
import {
  applyEdgeFunction,
  applyWeightedEdgeFunction,
  validateEdgeFunctionParams,
  validateGraphEdgeFunctions,
} from '../src/engine/edge-functions.js';
import type { GraphEdge } from '../src/trust/types.js';

describe('Edge Functions', () => {
  describe('applyEdgeFunction', () => {
    describe('linear (default)', () => {
      it('returns input unchanged for linear function', () => {
        const edge: GraphEdge = { from: 'a', to: 'b', function_type: 'linear' };
        expect(applyEdgeFunction(0, edge)).toBe(0);
        expect(applyEdgeFunction(0.5, edge)).toBe(0.5);
        expect(applyEdgeFunction(1, edge)).toBe(1);
        expect(applyEdgeFunction(100, edge)).toBe(100);
      });

      it('uses linear as default when function_type undefined', () => {
        const edge: GraphEdge = { from: 'a', to: 'b' };
        expect(applyEdgeFunction(0.5, edge)).toBe(0.5);
        expect(applyEdgeFunction(1, edge)).toBe(1);
      });

      it('handles negative values', () => {
        const edge: GraphEdge = { from: 'a', to: 'b', function_type: 'linear' };
        expect(applyEdgeFunction(-0.5, edge)).toBe(-0.5);
        expect(applyEdgeFunction(-100, edge)).toBe(-100);
      });
    });

    describe('diminishing_returns', () => {
      it('returns 0 for x = 0', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
          function_type: 'diminishing_returns',
          function_params: { k: 1 },
        };
        expect(applyEdgeFunction(0, edge)).toBe(0);
      });

      it('approaches 1 as x increases', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
          function_type: 'diminishing_returns',
          function_params: { k: 1 },
        };
        // 1 - e^(-1*1) ≈ 0.632
        expect(applyEdgeFunction(1, edge)).toBeCloseTo(0.632, 2);
        // 1 - e^(-1*2) ≈ 0.865
        expect(applyEdgeFunction(2, edge)).toBeCloseTo(0.865, 2);
        // 1 - e^(-1*5) ≈ 0.993
        expect(applyEdgeFunction(5, edge)).toBeCloseTo(0.993, 2);
      });

      it('higher k = faster saturation', () => {
        const slowEdge: GraphEdge = {
          from: 'a',
          to: 'b',
          function_type: 'diminishing_returns',
          function_params: { k: 0.5 },
        };
        const fastEdge: GraphEdge = {
          from: 'a',
          to: 'b',
          function_type: 'diminishing_returns',
          function_params: { k: 2 },
        };
        const slow = applyEdgeFunction(1, slowEdge);
        const fast = applyEdgeFunction(1, fastEdge);
        expect(fast).toBeGreaterThan(slow);
      });

      it('returns 0 for negative input', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
          function_type: 'diminishing_returns',
          function_params: { k: 1 },
        };
        expect(applyEdgeFunction(-1, edge)).toBe(0);
      });

      it('defaults k to 1 if not specified', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
          function_type: 'diminishing_returns',
        };
        expect(applyEdgeFunction(1, edge)).toBeCloseTo(0.632, 2);
      });
    });

    describe('threshold', () => {
      it('returns 0 below threshold', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
          function_type: 'threshold',
          function_params: { threshold: 5 },
        };
        expect(applyEdgeFunction(0, edge)).toBe(0);
        expect(applyEdgeFunction(4.9, edge)).toBe(0);
      });

      it('returns (x - threshold) * slope at/above threshold', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
          function_type: 'threshold',
          function_params: { threshold: 5, slope: 1 },
        };
        expect(applyEdgeFunction(5, edge)).toBe(0);
        expect(applyEdgeFunction(6, edge)).toBe(1);
        expect(applyEdgeFunction(10, edge)).toBe(5);
      });

      it('applies custom slope', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
          function_type: 'threshold',
          function_params: { threshold: 5, slope: 2 },
        };
        expect(applyEdgeFunction(6, edge)).toBe(2);
        expect(applyEdgeFunction(10, edge)).toBe(10);
      });

      it('defaults slope to 1', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
          function_type: 'threshold',
          function_params: { threshold: 5 },
        };
        expect(applyEdgeFunction(7, edge)).toBe(2);
      });

      it('defaults threshold to 0', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
          function_type: 'threshold',
        };
        expect(applyEdgeFunction(0, edge)).toBe(0);
        expect(applyEdgeFunction(1, edge)).toBe(1);
      });
    });

    describe('s_curve', () => {
      it('returns 0.5 at midpoint', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
          function_type: 's_curve',
          function_params: { k: 1, midpoint: 5 },
        };
        expect(applyEdgeFunction(5, edge)).toBeCloseTo(0.5, 5);
      });

      it('approaches 0 far below midpoint', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
          function_type: 's_curve',
          function_params: { k: 1, midpoint: 5 },
        };
        expect(applyEdgeFunction(-10, edge)).toBeCloseTo(0, 3);
      });

      it('approaches 1 far above midpoint', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
          function_type: 's_curve',
          function_params: { k: 1, midpoint: 5 },
        };
        expect(applyEdgeFunction(20, edge)).toBeCloseTo(1, 3);
      });

      it('higher k = steeper transition', () => {
        const gentleEdge: GraphEdge = {
          from: 'a',
          to: 'b',
          function_type: 's_curve',
          function_params: { k: 0.5, midpoint: 0 },
        };
        const steepEdge: GraphEdge = {
          from: 'a',
          to: 'b',
          function_type: 's_curve',
          function_params: { k: 5, midpoint: 0 },
        };
        // At x = 1, steeper should be closer to 1
        const gentle = applyEdgeFunction(1, gentleEdge);
        const steep = applyEdgeFunction(1, steepEdge);
        expect(steep).toBeGreaterThan(gentle);
      });

      it('handles extreme values without overflow', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
          function_type: 's_curve',
          function_params: { k: 1, midpoint: 0 },
        };
        expect(applyEdgeFunction(1000, edge)).toBe(1);
        expect(applyEdgeFunction(-1000, edge)).toBe(0);
      });
    });
  });

  describe('applyWeightedEdgeFunction', () => {
    it('multiplies edge weight with transformed value', () => {
      const edge: GraphEdge = {
        from: 'a',
        to: 'b',
        weight: 0.5,
        function_type: 'linear',
      };
      expect(applyWeightedEdgeFunction(10, edge)).toBe(5);
    });

    it('defaults weight to 1', () => {
      const edge: GraphEdge = {
        from: 'a',
        to: 'b',
        function_type: 'linear',
      };
      expect(applyWeightedEdgeFunction(10, edge)).toBe(10);
    });

    it('combines weight with non-linear function', () => {
      const edge: GraphEdge = {
        from: 'a',
        to: 'b',
        weight: 2,
        function_type: 'diminishing_returns',
        function_params: { k: 1 },
      };
      // 2 * (1 - e^(-1)) ≈ 2 * 0.632 ≈ 1.264
      expect(applyWeightedEdgeFunction(1, edge)).toBeCloseTo(1.264, 2);
    });
  });

  describe('validateEdgeFunctionParams', () => {
    it('returns null for linear function', () => {
      const edge: GraphEdge = { from: 'a', to: 'b', function_type: 'linear' };
      expect(validateEdgeFunctionParams(edge)).toBeNull();
    });

    it('returns null for edge without function_type', () => {
      const edge: GraphEdge = { from: 'a', to: 'b' };
      expect(validateEdgeFunctionParams(edge)).toBeNull();
    });

    it('returns error for diminishing_returns without k', () => {
      const edge: GraphEdge = {
        from: 'a',
        to: 'b',
        function_type: 'diminishing_returns',
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).not.toBeNull();
      expect(error?.field).toBe('function_params.k');
    });

    it('returns error for diminishing_returns with k <= 0', () => {
      const edge: GraphEdge = {
        from: 'a',
        to: 'b',
        function_type: 'diminishing_returns',
        function_params: { k: 0 },
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('k must be > 0');
    });

    it('returns null for valid diminishing_returns', () => {
      const edge: GraphEdge = {
        from: 'a',
        to: 'b',
        function_type: 'diminishing_returns',
        function_params: { k: 1 },
      };
      expect(validateEdgeFunctionParams(edge)).toBeNull();
    });

    it('returns error for threshold without threshold param', () => {
      const edge: GraphEdge = {
        from: 'a',
        to: 'b',
        function_type: 'threshold',
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).not.toBeNull();
      expect(error?.field).toBe('function_params.threshold');
    });

    it('returns null for valid threshold', () => {
      const edge: GraphEdge = {
        from: 'a',
        to: 'b',
        function_type: 'threshold',
        function_params: { threshold: 5 },
      };
      expect(validateEdgeFunctionParams(edge)).toBeNull();
    });

    it('returns error for s_curve without k', () => {
      const edge: GraphEdge = {
        from: 'a',
        to: 'b',
        function_type: 's_curve',
        function_params: { midpoint: 5 },
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).not.toBeNull();
      expect(error?.field).toBe('function_params.k');
    });

    it('returns error for s_curve without midpoint', () => {
      const edge: GraphEdge = {
        from: 'a',
        to: 'b',
        function_type: 's_curve',
        function_params: { k: 1 },
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).not.toBeNull();
      expect(error?.field).toBe('function_params.midpoint');
    });

    it('returns null for valid s_curve', () => {
      const edge: GraphEdge = {
        from: 'a',
        to: 'b',
        function_type: 's_curve',
        function_params: { k: 1, midpoint: 5 },
      };
      expect(validateEdgeFunctionParams(edge)).toBeNull();
    });
  });

  describe('validateGraphEdgeFunctions', () => {
    it('returns empty array for graph with no function types', () => {
      const edges: GraphEdge[] = [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ];
      expect(validateGraphEdgeFunctions(edges)).toEqual([]);
    });

    it('returns empty array for graph with valid functions', () => {
      const edges: GraphEdge[] = [
        { from: 'a', to: 'b', function_type: 'linear' },
        { from: 'b', to: 'c', function_type: 'diminishing_returns', function_params: { k: 1 } },
      ];
      expect(validateGraphEdgeFunctions(edges)).toEqual([]);
    });

    it('returns errors for invalid function params', () => {
      const edges: GraphEdge[] = [
        { from: 'a', to: 'b', function_type: 'diminishing_returns' }, // Missing k
        { from: 'b', to: 'c', function_type: 's_curve', function_params: { k: 1 } }, // Missing midpoint
      ];
      const errors = validateGraphEdgeFunctions(edges);
      expect(errors).toHaveLength(2);
      expect(errors[0].edge_id).toBe('a->b');
      expect(errors[1].edge_id).toBe('b->c');
    });
  });

  describe('backwards compatibility', () => {
    it('edges without function_type work as before', () => {
      const edges: GraphEdge[] = [
        { from: 'a', to: 'b', weight: 0.8 },
        { from: 'b', to: 'c', weight: 1.2, belief: 0.9 },
      ];

      for (const edge of edges) {
        // Linear by default
        expect(applyEdgeFunction(0.5, edge)).toBe(0.5);
        expect(applyEdgeFunction(1, edge)).toBe(1);
      }
    });

    it('validation passes for edges without function_type', () => {
      const edges: GraphEdge[] = [
        { from: 'a', to: 'b', weight: 0.8 },
        { from: 'b', to: 'c' },
      ];
      expect(validateGraphEdgeFunctions(edges)).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('handles Infinity input gracefully', () => {
      const linearEdge: GraphEdge = { from: 'a', to: 'b', function_type: 'linear' };
      expect(applyEdgeFunction(Infinity, linearEdge)).toBe(Infinity);

      const drEdge: GraphEdge = {
        from: 'a',
        to: 'b',
        function_type: 'diminishing_returns',
        function_params: { k: 1 },
      };
      expect(applyEdgeFunction(Infinity, drEdge)).toBeCloseTo(1, 5);

      const sCurveEdge: GraphEdge = {
        from: 'a',
        to: 'b',
        function_type: 's_curve',
        function_params: { k: 1, midpoint: 0 },
      };
      expect(applyEdgeFunction(Infinity, sCurveEdge)).toBe(1);
    });

    it('handles NaN input gracefully', () => {
      const edge: GraphEdge = { from: 'a', to: 'b', function_type: 'linear' };
      expect(Number.isNaN(applyEdgeFunction(NaN, edge))).toBe(true);
    });

    it('handles zero threshold', () => {
      const edge: GraphEdge = {
        from: 'a',
        to: 'b',
        function_type: 'threshold',
        function_params: { threshold: 0 },
      };
      expect(applyEdgeFunction(0, edge)).toBe(0);
      expect(applyEdgeFunction(1, edge)).toBe(1);
      expect(applyEdgeFunction(-1, edge)).toBe(0);
    });

    it('handles negative threshold', () => {
      const edge: GraphEdge = {
        from: 'a',
        to: 'b',
        function_type: 'threshold',
        function_params: { threshold: -5 },
      };
      expect(applyEdgeFunction(-10, edge)).toBe(0);
      expect(applyEdgeFunction(-5, edge)).toBe(0);
      expect(applyEdgeFunction(0, edge)).toBe(5);
    });
  });
});
