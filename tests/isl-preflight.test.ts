/**
 * Unit tests for ISL preflight validation
 * Tests edge uncertainty detection for sensitivity analysis
 */

import { describe, it, expect } from 'vitest';
import {
  edgeHasUncertainty,
  buildParameterUncertainties,
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

      it('returns true when no existence fields provided (defaults to 0.8)', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
        };
        // DEFAULT_EXISTS_PROBABILITY = 0.8, which is in (0, 1) → has uncertainty
        expect(edgeHasUncertainty(edge)).toBe(true);
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

      it('returns false when nested strength.std = 0 and existence is certain', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
          exists_probability: 1.0,
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

      it('returns false when flat strength_std = 0 and existence is certain', () => {
        const edge = {
          from: 'a',
          to: 'b',
          exists_probability: 1.0,
          strength_std: 0,
        } as GraphEdge;
        expect(edgeHasUncertainty(edge)).toBe(false);
      });

      it('returns false when strength_std not provided and existence is certain', () => {
        const edge = {
          from: 'a',
          to: 'b',
          exists_probability: 1.0,
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

      it('returns false when belief_strength = 1 and existence is certain', () => {
        const edge: GraphEdge = {
          from: 'a',
          to: 'b',
          exists_probability: 1.0,
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

    it('returns available when edges lack explicit uncertainty (defaults to 0.8)', () => {
      const graph = {
        nodes: [
          { id: 'a', kind: 'factor' as const },
          { id: 'b', kind: 'goal' as const },
        ],
        edges: [
          { from: 'a', to: 'b' }, // no explicit uncertainty → defaults to 0.8, which is uncertain
        ],
      };

      const result = validateBeforeISL(graph);

      // DEFAULT_EXISTS_PROBABILITY = 0.8 is in (0, 1) → edge has uncertainty
      expect(result.canCallISL).toBe(true);
      expect(result.edge_sensitivity_status).toBe('available');
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

  describe('buildParameterUncertainties', () => {
    it('builds uncertainties from factors with finite observed values', () => {
      const graph = {
        nodes: [
          { id: 'f1', kind: 'factor' as const, label: 'F1', observed_state: { value: 50 } },
          { id: 'f2', kind: 'factor' as const, label: 'F2', observed_state: { value: 30 } },
          { id: 'f3', kind: 'factor' as const, label: 'F3', observed_state: { value: 10 } },
          { id: 'goal', kind: 'goal' as const, label: 'Goal' },
        ],
        edges: [
          { from: 'f1', to: 'goal' },
          { from: 'f2', to: 'goal' },
          { from: 'f3', to: 'goal' },
        ],
      };

      const result = buildParameterUncertainties(graph);

      expect(result).toHaveLength(3);
      expect(result.map((u) => u.node_id)).toEqual(['f1', 'f2', 'f3']);
      for (const u of result) {
        expect(u.distribution).toBe('normal');
        expect(u.std).toBeGreaterThan(0);
        expect(Number.isFinite(u.mean)).toBe(true);
        expect(Number.isFinite(u.std)).toBe(true);
      }
    });

    it('excludes factors with NaN observed_state.value', () => {
      const graph = {
        nodes: [
          { id: 'f1', kind: 'factor' as const, label: 'F1', observed_state: { value: 50 } },
          { id: 'f-nan', kind: 'factor' as const, label: 'NaN Factor', observed_state: { value: NaN } },
          { id: 'goal', kind: 'goal' as const, label: 'Goal' },
        ],
        edges: [{ from: 'f1', to: 'goal' }],
      };

      const result = buildParameterUncertainties(graph);

      expect(result).toHaveLength(1);
      expect(result[0].node_id).toBe('f1');
    });

    it('excludes factors with Infinity observed_state.value', () => {
      const graph = {
        nodes: [
          { id: 'f1', kind: 'factor' as const, label: 'F1', observed_state: { value: 50 } },
          { id: 'f-inf', kind: 'factor' as const, label: 'Inf Factor', observed_state: { value: Infinity } },
          { id: 'f-ninf', kind: 'factor' as const, label: '-Inf Factor', observed_state: { value: -Infinity } },
          { id: 'goal', kind: 'goal' as const, label: 'Goal' },
        ],
        edges: [{ from: 'f1', to: 'goal' }],
      };

      const result = buildParameterUncertainties(graph);

      expect(result).toHaveLength(1);
      expect(result[0].node_id).toBe('f1');
    });

    it('returns empty array when no factors have observed values', () => {
      const graph = {
        nodes: [
          { id: 'f1', kind: 'factor' as const, label: 'F1' },
          { id: 'goal', kind: 'goal' as const, label: 'Goal' },
        ],
        edges: [{ from: 'f1', to: 'goal' }],
      };

      const result = buildParameterUncertainties(graph);

      expect(result).toHaveLength(0);
    });

    it('returns empty when all factor values are non-finite', () => {
      const graph = {
        nodes: [
          { id: 'f1', kind: 'factor' as const, label: 'F1', observed_state: { value: NaN } },
          { id: 'f2', kind: 'factor' as const, label: 'F2', observed_state: { value: Infinity } },
          { id: 'goal', kind: 'goal' as const, label: 'Goal' },
        ],
        edges: [{ from: 'f1', to: 'goal' }],
      };

      const result = buildParameterUncertainties(graph);

      expect(result).toHaveLength(0);
    });

    it('uses observed_state.std when finite and positive', () => {
      const graph = {
        nodes: [
          { id: 'f1', kind: 'factor' as const, label: 'F1', observed_state: { value: 50, std: 1.5 } },
          { id: 'goal', kind: 'goal' as const, label: 'Goal' },
        ],
        edges: [{ from: 'f1', to: 'goal' }],
      };

      const result = buildParameterUncertainties(graph);

      expect(result).toHaveLength(1);
      expect(result[0].std).toBe(1.5);
    });
  });

  describe('validateBeforeISL — factor sensitivity fallback', () => {
    it('returns skipped_no_factor_values when factors lack observed values', () => {
      const graph = {
        nodes: [
          { id: 'f1', kind: 'factor' as const, label: 'F1' },
          { id: 'goal', kind: 'goal' as const, label: 'Goal' },
        ],
        edges: [{ from: 'f1', to: 'goal' }],
      };

      const result = validateBeforeISL(graph);

      expect(result.factor_sensitivity_status).toBe('skipped_no_factor_values');
    });

    it('returns skipped_no_factor_values when all factor values are non-finite', () => {
      const graph = {
        nodes: [
          { id: 'f1', kind: 'factor' as const, label: 'F1', observed_state: { value: NaN } },
          { id: 'goal', kind: 'goal' as const, label: 'Goal' },
        ],
        edges: [{ from: 'f1', to: 'goal' }],
      };

      const result = validateBeforeISL(graph);

      // NaN factors are treated as having no value (isFactorWithValue rejects non-finite)
      expect(result.factor_sensitivity_status).toBe('skipped_no_factor_values');
    });

    it('returns available when factors have finite observed values', () => {
      const graph = {
        nodes: [
          { id: 'f1', kind: 'factor' as const, label: 'F1', observed_state: { value: 50 } },
          { id: 'goal', kind: 'goal' as const, label: 'Goal' },
        ],
        edges: [{ from: 'f1', to: 'goal' }],
      };

      const result = validateBeforeISL(graph);

      expect(result.factor_sensitivity_status).toBe('available');
    });
  });
});
