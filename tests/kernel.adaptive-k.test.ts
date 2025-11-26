/**
 * Tests for adaptive K early-stopping in SCM-Lite kernel
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runKernel } from '../src/scm-lite/kernel.js';
import type { DAG } from '../src/scm-lite/types.js';

// Simple test DAG
const simpleDag: DAG = {
  nodes: [
    { id: 'A', label: 'Input' },
    { id: 'B', label: 'Middle' },
    { id: 'C', label: 'Output' },
  ],
  edges: [
    { from: 'A', to: 'B', belief: 0.9, weight: 1.0 },
    { from: 'B', to: 'C', belief: 0.9, weight: 1.0 },
  ],
};

describe('Adaptive K early-stopping', () => {
  describe('when adaptiveK is disabled', () => {
    it('should run all K samples', () => {
      const result = runKernel(simpleDag, 'C', {
        seed: 42,
        K: 32,
        adaptiveK: false,
      });

      expect(result.meta.K_evaluated).toBe(32);
      expect(result.meta.K_requested).toBeUndefined();
      expect(result.meta.K_converged).toBeUndefined();
    });
  });

  describe('when adaptiveK is enabled', () => {
    it('should include K_requested and K_converged in meta', () => {
      const result = runKernel(simpleDag, 'C', {
        seed: 42,
        K: 64,
        adaptiveK: true,
        convergenceThreshold: 0.01,
        kMin: 16,
        kStep: 8,
      });

      expect(result.meta.K_requested).toBe(64);
      expect(typeof result.meta.K_converged).toBe('boolean');
      expect(result.meta.K_evaluated).toBeGreaterThanOrEqual(16);
      expect(result.meta.K_evaluated).toBeLessThanOrEqual(64);
    });

    it('should stop early when p50 converges', () => {
      // Simple graph should converge quickly
      const result = runKernel(simpleDag, 'C', {
        seed: 42,
        K: 256,
        adaptiveK: true,
        convergenceThreshold: 0.01,
        kMin: 16,
        kStep: 8,
      });

      // Should converge before using all 256 samples
      if (result.meta.K_converged) {
        expect(result.meta.K_evaluated).toBeLessThan(256);
      }
    });

    it('should produce deterministic results with same seed', () => {
      const config = {
        seed: 12345,
        K: 64,
        adaptiveK: true,
        convergenceThreshold: 0.01,
        kMin: 16,
        kStep: 8,
      };

      const result1 = runKernel(simpleDag, 'C', config);
      const result2 = runKernel(simpleDag, 'C', config);

      expect(result1.meta.K_evaluated).toBe(result2.meta.K_evaluated);
      expect(result1.meta.K_converged).toBe(result2.meta.K_converged);
      expect(result1.quantiles.p50).toBe(result2.quantiles.p50);
      expect(result1.bma_hash).toBe(result2.bma_hash);
    });

    it('should respect kMin before checking convergence', () => {
      const result = runKernel(simpleDag, 'C', {
        seed: 42,
        K: 64,
        adaptiveK: true,
        convergenceThreshold: 0.5, // Very loose threshold
        kMin: 24,
        kStep: 8,
      });

      // Even with loose threshold, should run at least kMin samples
      expect(result.meta.K_evaluated).toBeGreaterThanOrEqual(24);
    });

    it('should use stricter threshold for deep detail_level (0.5%)', () => {
      // Test with 0.5% threshold
      const deepResult = runKernel(simpleDag, 'C', {
        seed: 42,
        K: 64,
        adaptiveK: true,
        convergenceThreshold: 0.005, // 0.5% for deep
        kMin: 16,
        kStep: 8,
      });

      // Test with 1% threshold (should potentially converge faster)
      const standardResult = runKernel(simpleDag, 'C', {
        seed: 42,
        K: 64,
        adaptiveK: true,
        convergenceThreshold: 0.01, // 1% for standard
        kMin: 16,
        kStep: 8,
      });

      // Deep should use at least as many samples as standard
      expect(deepResult.meta.K_evaluated).toBeGreaterThanOrEqual(
        standardResult.meta.K_evaluated
      );
    });
  });

  describe('quantile accuracy', () => {
    it('should produce valid quantiles even with early stopping', () => {
      const result = runKernel(simpleDag, 'C', {
        seed: 42,
        K: 64,
        adaptiveK: true,
        convergenceThreshold: 0.01,
      });

      // Quantiles should be in order
      expect(result.quantiles.p10).toBeLessThanOrEqual(result.quantiles.p50);
      expect(result.quantiles.p50).toBeLessThanOrEqual(result.quantiles.p90);
    });

    it('should have consistent p50 between runs with different K when converged', () => {
      const result32 = runKernel(simpleDag, 'C', {
        seed: 42,
        K: 32,
        adaptiveK: true,
        convergenceThreshold: 0.01,
      });

      const result64 = runKernel(simpleDag, 'C', {
        seed: 42,
        K: 64,
        adaptiveK: true,
        convergenceThreshold: 0.01,
      });

      // If both converged, p50 should be similar (within 2%)
      if (result32.meta.K_converged && result64.meta.K_converged) {
        const diff = Math.abs(result32.quantiles.p50 - result64.quantiles.p50);
        const maxP50 = Math.max(Math.abs(result32.quantiles.p50), Math.abs(result64.quantiles.p50), 1);
        expect(diff / maxP50).toBeLessThan(0.02);
      }
    });
  });
});
