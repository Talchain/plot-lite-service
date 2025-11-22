/**
 * P0.3: What-If Delta Tests
 * Verifies WHATIF_DELTA_ENABLE flag behavior
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computeDeltaSummary } from '../src/trust/whatif-delta.js';

describe('What-If Delta (P0.3)', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.WHATIF_DELTA_ENABLE;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.WHATIF_DELTA_ENABLE;
    } else {
      process.env.WHATIF_DELTA_ENABLE = originalEnv;
    }
  });

  describe('Flag OFF (default)', () => {
    it('returns null when flag is not set', () => {
      delete process.env.WHATIF_DELTA_ENABLE;

      const graph = {
        nodes: [{ id: 'A' }, { id: 'B' }],
        edges: [{ from: 'A', to: 'B', weight: 0.5, belief: 0.8 }],
      };

      const result = computeDeltaSummary(graph, 'B', 100);
      expect(result).toBeNull();
    });

    it('returns null when flag is set to 0', () => {
      process.env.WHATIF_DELTA_ENABLE = '0';

      const graph = {
        nodes: [{ id: 'A' }, { id: 'B' }],
        edges: [{ from: 'A', to: 'B', weight: 0.5, belief: 0.8 }],
      };

      const result = computeDeltaSummary(graph, 'B', 100);
      expect(result).toBeNull();
    });

    it('returns null when flag is set to empty string', () => {
      process.env.WHATIF_DELTA_ENABLE = '';

      const graph = {
        nodes: [{ id: 'A' }, { id: 'B' }],
        edges: [{ from: 'A', to: 'B', weight: 0.5, belief: 0.8 }],
      };

      const result = computeDeltaSummary(graph, 'B', 100);
      expect(result).toBeNull();
    });
  });

  describe('Flag ON', () => {
    beforeEach(() => {
      process.env.WHATIF_DELTA_ENABLE = '1';
    });

    it('returns delta summary with perturbation string and numeric outcome_delta', () => {
      const graph = {
        nodes: [{ id: 'A' }, { id: 'B' }],
        edges: [{ from: 'A', to: 'B', weight: 0.5, belief: 0.8 }],
      };

      const result = computeDeltaSummary(graph, 'B', 100);

      expect(result).not.toBeNull();
      expect(result).toHaveProperty('perturbation');
      expect(result).toHaveProperty('outcome_delta');
      expect(typeof result!.perturbation).toBe('string');
      expect(typeof result!.outcome_delta).toBe('number');
    });

    it('produces deterministic perturbation string from first edge', () => {
      const graph = {
        nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
        edges: [
          { from: 'A', to: 'B', weight: 0.5, belief: 0.8 },
          { from: 'B', to: 'C', weight: 0.7, belief: 0.9 },
        ],
      };

      const result = computeDeltaSummary(graph, 'C', 100);

      expect(result).not.toBeNull();
      expect(result!.perturbation).toBe('A→B weight +0.1');
    });

    it('calculates outcome_delta based on edge weight and belief', () => {
      const graph = {
        nodes: [{ id: 'A' }, { id: 'B' }],
        edges: [{ from: 'A', to: 'B', weight: 0.5, belief: 0.8 }],
      };

      const result = computeDeltaSummary(graph, 'B', 100);

      expect(result).not.toBeNull();
      // delta = weight * belief * 0.1 = 0.5 * 0.8 * 0.1 = 0.04
      expect(result!.outcome_delta).toBe(0.04);
    });

    it('rounds outcome_delta to 3 decimal places', () => {
      const graph = {
        nodes: [{ id: 'A' }, { id: 'B' }],
        edges: [{ from: 'A', to: 'B', weight: 0.333, belief: 0.777 }],
      };

      const result = computeDeltaSummary(graph, 'B', 100);

      expect(result).not.toBeNull();
      // delta = 0.333 * 0.777 * 0.1 = 0.025874...
      expect(result!.outcome_delta).toBe(0.026);
      expect(result!.outcome_delta.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(3);
    });

    it('uses default belief of 0.5 when not provided', () => {
      const graph = {
        nodes: [{ id: 'A' }, { id: 'B' }],
        edges: [{ from: 'A', to: 'B', weight: 0.6 }],
      };

      const result = computeDeltaSummary(graph, 'B', 100);

      expect(result).not.toBeNull();
      // delta = 0.6 * 0.5 * 0.1 = 0.03
      expect(result!.outcome_delta).toBe(0.03);
    });

    it('handles zero weight edge', () => {
      const graph = {
        nodes: [{ id: 'A' }, { id: 'B' }],
        edges: [{ from: 'A', to: 'B', weight: 0, belief: 0.8 }],
      };

      const result = computeDeltaSummary(graph, 'B', 100);

      expect(result).not.toBeNull();
      expect(result!.outcome_delta).toBe(0);
    });

    it('handles missing weight (defaults to 0)', () => {
      const graph = {
        nodes: [{ id: 'A' }, { id: 'B' }],
        edges: [{ from: 'A', to: 'B', belief: 0.8 }],
      };

      const result = computeDeltaSummary(graph, 'B', 100);

      expect(result).not.toBeNull();
      expect(result!.outcome_delta).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      process.env.WHATIF_DELTA_ENABLE = '1';
    });

    it('returns null when graph has no edges', () => {
      const graph = {
        nodes: [{ id: 'A' }, { id: 'B' }],
        edges: [],
      };

      const result = computeDeltaSummary(graph, 'B', 100);
      expect(result).toBeNull();
    });

    it('returns null when edges array is missing', () => {
      const graph = {
        nodes: [{ id: 'A' }, { id: 'B' }],
      };

      const result = computeDeltaSummary(graph, 'B', 100);
      expect(result).toBeNull();
    });

    it('returns null when edges is null', () => {
      const graph = {
        nodes: [{ id: 'A' }, { id: 'B' }],
        edges: null,
      };

      const result = computeDeltaSummary(graph, 'B', 100);
      expect(result).toBeNull();
    });

    it('handles graph with single edge', () => {
      const graph = {
        nodes: [{ id: 'A' }, { id: 'B' }],
        edges: [{ from: 'A', to: 'B', weight: 1.0, belief: 1.0 }],
      };

      const result = computeDeltaSummary(graph, 'B', 100);

      expect(result).not.toBeNull();
      expect(result!.perturbation).toBe('A→B weight +0.1');
      expect(result!.outcome_delta).toBe(0.1);
    });
  });

  describe('Determinism', () => {
    beforeEach(() => {
      process.env.WHATIF_DELTA_ENABLE = '1';
    });

    it('produces identical results across multiple calls', () => {
      const graph = {
        nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
        edges: [
          { from: 'A', to: 'B', weight: 0.5, belief: 0.8 },
          { from: 'B', to: 'C', weight: 0.7, belief: 0.9 },
        ],
      };

      const results = [];
      for (let i = 0; i < 10; i++) {
        const result = computeDeltaSummary(graph, 'C', 100);
        results.push(JSON.stringify(result));
      }

      // All results should be byte-identical
      const uniqueResults = new Set(results);
      expect(uniqueResults.size).toBe(1);
    });

    it('always selects first edge regardless of order', () => {
      const graph1 = {
        nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
        edges: [
          { from: 'A', to: 'B', weight: 0.5, belief: 0.8 },
          { from: 'B', to: 'C', weight: 0.7, belief: 0.9 },
        ],
      };

      const graph2 = {
        nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
        edges: [
          { from: 'B', to: 'C', weight: 0.7, belief: 0.9 },
          { from: 'A', to: 'B', weight: 0.5, belief: 0.8 },
        ],
      };

      const result1 = computeDeltaSummary(graph1, 'C', 100);
      const result2 = computeDeltaSummary(graph2, 'C', 100);

      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      // Different first edges should produce different perturbations
      expect(result1!.perturbation).toBe('A→B weight +0.1');
      expect(result2!.perturbation).toBe('B→C weight +0.1');
    });
  });

  describe('No Schema Drift', () => {
    it('flag OFF does not add fields to response', () => {
      delete process.env.WHATIF_DELTA_ENABLE;

      const graph = {
        nodes: [{ id: 'A' }, { id: 'B' }],
        edges: [{ from: 'A', to: 'B', weight: 0.5, belief: 0.8 }],
      };

      const result = computeDeltaSummary(graph, 'B', 100);
      
      // When OFF, result is null - no schema pollution
      expect(result).toBeNull();
    });

    it('flag ON returns only expected fields', () => {
      process.env.WHATIF_DELTA_ENABLE = '1';

      const graph = {
        nodes: [{ id: 'A' }, { id: 'B' }],
        edges: [{ from: 'A', to: 'B', weight: 0.5, belief: 0.8 }],
      };

      const result = computeDeltaSummary(graph, 'B', 100);

      expect(result).not.toBeNull();
      const keys = Object.keys(result!);
      expect(keys).toEqual(['perturbation', 'outcome_delta']);
    });
  });
});
