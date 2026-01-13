/**
 * Unit tests for ISL preflight validation
 * Tests edge uncertainty detection for sensitivity analysis
 */

import { describe, it, expect } from 'vitest';
import {
  edgeHasUncertainty,
  validateBeforeISL,
} from '../src/integrations/isl/preflight.js';
import type { GraphEdge } from '../src/trust/types.js';

describe('ISL Preflight Validation', () => {
  describe('edgeHasUncertainty', () => {
    // Existence uncertainty tests
    describe('existence uncertainty', () => {
      it('detects uncertainty from exists_probability < 1', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
          exists_probability: 0.8,
        };
        expect(edgeHasUncertainty(edge)).toBe(true);
      });

      it('detects uncertainty from belief_exists < 1', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
          belief_exists: 0.7,
        };
        expect(edgeHasUncertainty(edge)).toBe(true);
      });

      it('detects uncertainty from legacy belief field < 1', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
          belief: 0.9,
        };
        expect(edgeHasUncertainty(edge)).toBe(true);
      });

      it('returns false when exists_probability = 1', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
          exists_probability: 1.0,
        };
        expect(edgeHasUncertainty(edge)).toBe(false);
      });

      it('returns false when exists_probability = 0', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
          exists_probability: 0,
        };
        expect(edgeHasUncertainty(edge)).toBe(false);
      });

      it('returns false when no existence fields provided (defaults to 1)', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
        };
        expect(edgeHasUncertainty(edge)).toBe(false);
      });
    });

    // Strength uncertainty tests - nested format
    describe('strength uncertainty - nested format', () => {
      it('detects uncertainty from nested strength.std > 0', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
          strength: { mean: 0.5, std: 0.1 },
        };
        expect(edgeHasUncertainty(edge)).toBe(true);
      });

      it('returns false when nested strength.std = 0', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
          strength: { mean: 0.5, std: 0 },
        };
        expect(edgeHasUncertainty(edge)).toBe(false);
      });
    });

    // Strength uncertainty tests - flat format (CEE V3)
    describe('strength uncertainty - flat format (CEE V3)', () => {
      it('detects uncertainty from flat strength_std > 0', () => {
        const edge = {
          from: 'a',
          to: 'b',
          strength_std: 0.125,
        } as GraphEdge;
        expect(edgeHasUncertainty(edge)).toBe(true);
      });

      it('returns false when flat strength_std = 0', () => {
        const edge = {
          from: 'a',
          to: 'b',
          strength_std: 0,
        } as GraphEdge;
        expect(edgeHasUncertainty(edge)).toBe(false);
      });

      it('returns false when strength_std not provided', () => {
        const edge = {
          from: 'a',
          to: 'b',
          strength_mean: 0.5, // mean without std
        } as GraphEdge;
        expect(edgeHasUncertainty(edge)).toBe(false);
      });
    });

    // Belief strength tests
    describe('belief_strength', () => {
      it('detects uncertainty from belief_strength < 1', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
          belief_strength: 0.8,
        };
        expect(edgeHasUncertainty(edge)).toBe(true);
      });

      it('returns false when belief_strength = 1', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
          belief_strength: 1.0,
        };
        expect(edgeHasUncertainty(edge)).toBe(false);
      });
    });

    // Combined scenarios
    describe('combined scenarios', () => {
      it('returns true with CEE V3 typical output (belief_exists + strength_std)', () => {
        const edge = {
          from: 'factor_a',
          to: 'goal',
          strength_mean: 0.5,
          strength_std: 0.125,
          belief_exists: 0.85,
        } as GraphEdge;
        expect(edgeHasUncertainty(edge)).toBe(true);
      });

      it('returns true with nested strength typical output', () => {
        const edge: GraphEdge = {
          from: 'factor_a',
          to: 'goal',
          exists_probability: 0.9,
          strength: { mean: 0.6, std: 0.1 },
        };
        expect(edgeHasUncertainty(edge)).toBe(true);
      });

      it('prefers nested strength over flat when both present', () => {
        const edge = {
          from: 'a',
          to: 'b',
          strength: { mean: 0.5, std: 0.2 }, // nested has std
          strength_std: 0, // flat has no std
        } as GraphEdge;
        expect(edgeHasUncertainty(edge)).toBe(true);
      });
    });
  });

  describe('validateBeforeISL', () => {
    it('returns available for edge sensitivity when edges have uncertainty', () => {
      const graph = {
        nodes: [
          { id: 'a', kind: 'factor' as const },
          { id: 'b', kind: 'goal' as const },
        ],
        edges: [
          { from: 'a', to: 'b', belief_exists: 0.8 },
        ],
      };

      const result = validateBeforeISL(graph);

      expect(result.canCallISL).toBe(true);
      expect(result.edge_sensitivity_status).toBe('available');
    });

    it('returns skipped_missing_uncertainty when no edges have uncertainty', () => {
      const graph = {
        nodes: [
          { id: 'a', kind: 'factor' as const },
          { id: 'b', kind: 'goal' as const },
        ],
        edges: [
          { from: 'a', to: 'b' }, // no uncertainty fields
        ],
      };

      const result = validateBeforeISL(graph);

      expect(result.edge_sensitivity_status).toBe('skipped_missing_uncertainty');
    });

    it('returns available when CEE V3 flat uncertainty fields provided', () => {
      const graph = {
        nodes: [
          { id: 'a', kind: 'factor' as const },
          { id: 'b', kind: 'goal' as const },
        ],
        edges: [
          {
            from: 'a',
            to: 'b',
            strength_mean: 0.5,
            strength_std: 0.1, // flat CEE V3 format
          } as any,
        ],
      };

      const result = validateBeforeISL(graph);

      expect(result.canCallISL).toBe(true);
      expect(result.edge_sensitivity_status).toBe('available');
    });

    it('returns skipped_no_edges when graph has no edges', () => {
      const graph = {
        nodes: [
          { id: 'a', kind: 'factor' as const },
          { id: 'b', kind: 'goal' as const },
        ],
        edges: [],
      };

      const result = validateBeforeISL(graph);

      expect(result.edge_sensitivity_status).toBe('skipped_no_edges');
    });
  });
});
