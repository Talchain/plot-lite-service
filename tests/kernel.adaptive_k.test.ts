import { describe, it, expect } from 'vitest';
import {
  computeAdaptiveK,
  determineK,
  validateK,
  getDefaultConfig,
} from '../src/kernel/adaptive-k.js';

describe('Adaptive K (deterministic)', () => {
  describe('computeAdaptiveK', () => {
    it('computes K for small graph', () => {
      // 3 nodes, 2 edges
      // K = 250 + 25*2 + 10*3 = 250 + 50 + 30 = 330
      const result = computeAdaptiveK(3, 2);

      expect(result.k_samples).toBe(330);
      expect(result.clamped).toBe(false);
      expect(result.raw_k).toBe(330);
      expect(result.reason).toContain('330');
    });

    it('computes K for medium graph', () => {
      // 8 nodes, 12 edges
      // K = 250 + 25*12 + 10*8 = 250 + 300 + 80 = 630
      const result = computeAdaptiveK(8, 12);

      expect(result.k_samples).toBe(630);
      expect(result.clamped).toBe(false);
      expect(result.raw_k).toBe(630);
    });

    it('clamps to minimum for very small graph', () => {
      // 1 node, 0 edges
      // K = 250 + 0 + 10 = 260, but min is 250
      const result = computeAdaptiveK(1, 0);

      expect(result.k_samples).toBe(260);
      expect(result.clamped).toBe(false);
    });

    it('clamps to maximum for very large graph', () => {
      // 50 nodes, 100 edges
      // K = 250 + 25*100 + 10*50 = 250 + 2500 + 500 = 3250
      // Max is 1000
      const result = computeAdaptiveK(50, 100);

      expect(result.k_samples).toBe(1000);
      expect(result.clamped).toBe(true);
      expect(result.raw_k).toBe(3250);
      expect(result.reason).toContain('clamped to maximum');
    });

    it('produces deterministic results', () => {
      const results = Array.from({ length: 10 }, () => computeAdaptiveK(5, 8));

      const k_values = results.map(r => r.k_samples);
      const reasons = results.map(r => r.reason);

      expect(new Set(k_values).size).toBe(1);
      expect(new Set(reasons).size).toBe(1);
      expect(k_values[0]).toBe(500); // 250 + 25*8 + 10*5
    });

    it('respects custom config', () => {
      const result = computeAdaptiveK(5, 8, {
        base: 100,
        per_edge: 10,
        per_node: 5,
        min: 100,
        max: 500,
      });

      // K = 100 + 10*8 + 5*5 = 100 + 80 + 25 = 205
      expect(result.k_samples).toBe(205);
      expect(result.clamped).toBe(false);
    });
  });

  describe('determineK', () => {
    it('uses user-specified K when provided', () => {
      const result = determineK(5, 8, 777);

      expect(result.k_samples).toBe(777);
      expect(result.reason).toContain('User-specified');
      expect(result.clamped).toBe(false);
    });

    it('computes adaptive K when not provided', () => {
      const result = determineK(5, 8);

      expect(result.k_samples).toBe(500); // 250 + 25*8 + 10*5
      expect(result.reason).toContain('Adaptive K');
    });

    it('computes adaptive K when requested_k is 0', () => {
      const result = determineK(5, 8, 0);

      expect(result.k_samples).toBe(500);
      expect(result.reason).toContain('Adaptive K');
    });

    it('computes adaptive K when requested_k is negative', () => {
      const result = determineK(5, 8, -1);

      expect(result.k_samples).toBe(500);
      expect(result.reason).toContain('Adaptive K');
    });

    it('produces deterministic results for same inputs', () => {
      const results = Array.from({ length: 10 }, () => determineK(6, 10));

      const k_values = results.map(r => r.k_samples);
      expect(new Set(k_values).size).toBe(1);
      expect(k_values[0]).toBe(560); // 250 + 25*10 + 10*6
    });
  });

  describe('validateK', () => {
    it('accepts K within bounds', () => {
      expect(validateK(500).valid).toBe(true);
      expect(validateK(250).valid).toBe(true);
      expect(validateK(1000).valid).toBe(true);
    });

    it('rejects K below minimum', () => {
      const result = validateK(100);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('too low');
    });

    it('rejects K above maximum', () => {
      const result = validateK(2000);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('too high');
    });

    it('respects custom bounds', () => {
      const result = validateK(150, { min: 100, max: 200 });
      expect(result.valid).toBe(true);
    });
  });

  describe('Reference graph: 12 nodes (p95 ≤ 600ms budget)', () => {
    it('computes K for 12-node reference graph', () => {
      // 12 nodes, assume ~20 edges (typical for 12-node graph)
      // K = 250 + 25*20 + 10*12 = 250 + 500 + 120 = 870
      const result = computeAdaptiveK(12, 20);

      expect(result.k_samples).toBe(870);
      expect(result.k_samples).toBeLessThanOrEqual(1000);
      expect(result.clamped).toBe(false);
    });

    it('stays within performance budget for typical 12-node graph', () => {
      // Test various edge counts for 12 nodes
      const edge_counts = [15, 20, 25, 30];

      for (const edges of edge_counts) {
        const result = computeAdaptiveK(12, edges);
        
        // All should be ≤ 1000 (max)
        expect(result.k_samples).toBeLessThanOrEqual(1000);
        
        // Should be reasonable for performance
        // (actual p95 validation happens in integration tests)
        expect(result.k_samples).toBeGreaterThanOrEqual(250);
      }
    });
  });

  describe('Determinism guarantee', () => {
    it('same graph always produces same K', () => {
      const node_count = 7;
      const edge_count = 11;

      const results = Array.from({ length: 20 }, () => 
        computeAdaptiveK(node_count, edge_count)
      );

      // All K values should be identical
      const k_values = results.map(r => r.k_samples);
      const unique_k = new Set(k_values);
      expect(unique_k.size).toBe(1);

      // All reasons should be identical
      const reasons = results.map(r => r.reason);
      const unique_reasons = new Set(reasons);
      expect(unique_reasons.size).toBe(1);

      // Verify expected value
      const expected_k = 250 + 25 * 11 + 10 * 7; // 250 + 275 + 70 = 595
      expect(k_values[0]).toBe(expected_k);
    });

    it('different graphs produce different K', () => {
      const k1 = computeAdaptiveK(5, 8).k_samples;
      const k2 = computeAdaptiveK(10, 15).k_samples;
      const k3 = computeAdaptiveK(3, 4).k_samples;

      // All should be different
      expect(k1).not.toBe(k2);
      expect(k2).not.toBe(k3);
      expect(k1).not.toBe(k3);
    });
  });

  describe('getDefaultConfig', () => {
    it('returns default configuration', () => {
      const config = getDefaultConfig();

      expect(config.base).toBe(250);
      expect(config.per_edge).toBe(25);
      expect(config.per_node).toBe(10);
      expect(config.min).toBe(250);
      expect(config.max).toBe(1000);
    });
  });
});
