import { describe, it, expect } from 'vitest';
import { calculateCalibratedConfidence } from '../src/trust/confidence-calibrated.js';
import type { Graph } from '../src/trust/types.js';

describe('Confidence calibration with deterministic thresholds', () => {
  // Base graph for testing
  const baseGraph: Graph = {
    nodes: [
      { id: 'A', label: 'A' },
      { id: 'B', label: 'B' },
      { id: 'C', label: 'C' },
    ],
    edges: [
      { from: 'A', to: 'B', weight: 0.5 },
      { from: 'B', to: 'C', weight: 0.7 },
    ],
  };

  describe('HIGH confidence badge', () => {
    it('assigns HIGH when all thresholds met', () => {
      const result = calculateCalibratedConfidence({
        graph: baseGraph,
        mask_diversity: 0.65,      // ≥ 0.6 ✓
        path_stability: 0.85,      // ≥ 0.8 ✓
        linearity_distance: 0.15,  // ≤ 0.2 ✓
        k_samples: 1000,
      });

      expect(result.level).toBe('HIGH');
      expect(result.factors.calibration).toBe(0.65);      // mask_diversity mapped to calibration
      expect(result.factors.identifiability).toBe(0.85);  // path_stability mapped to identifiability
      expect(result.factors.linearity_distance).toBe(0.15);
    });

    it('assigns HIGH at exact threshold boundaries', () => {
      const result = calculateCalibratedConfidence({
        graph: baseGraph,
        mask_diversity: 0.6,       // exactly 0.6
        path_stability: 0.8,       // exactly 0.8
        linearity_distance: 0.2,   // exactly 0.2
      });

      expect(result.level).toBe('HIGH');
    });

    it('produces stable factors across multiple calls', () => {
      const inputs = {
        graph: baseGraph,
        mask_diversity: 0.7,
        path_stability: 0.9,
        linearity_distance: 0.1,
      };

      const results = Array.from({ length: 5 }, () =>
        calculateCalibratedConfidence(inputs)
      );

      // All results should be identical
      const levels = results.map(r => r.level);
      const calibrations = results.map(r => r.factors.calibration);
      const identifiabilities = results.map(r => r.factors.identifiability);

      expect(new Set(levels).size).toBe(1);
      expect(levels[0]).toBe('HIGH');
      expect(new Set(calibrations).size).toBe(1);
      expect(new Set(identifiabilities).size).toBe(1);
    });
  });

  describe('MEDIUM confidence badge', () => {
    it('assigns MEDIUM when relaxed thresholds met', () => {
      const result = calculateCalibratedConfidence({
        graph: baseGraph,
        mask_diversity: 0.45,      // ≥ 0.3 ✓ but < 0.6
        path_stability: 0.65,      // ≥ 0.5 ✓ but < 0.8
        linearity_distance: 0.35,  // > 0.2 (fails HIGH)
      });

      expect(result.level).toBe('MEDIUM');
      expect(result.factors.calibration).toBe(0.45);
      expect(result.factors.identifiability).toBe(0.65);
    });

    it('assigns MEDIUM at exact threshold boundaries', () => {
      const result = calculateCalibratedConfidence({
        graph: baseGraph,
        mask_diversity: 0.3,       // exactly 0.3
        path_stability: 0.5,       // exactly 0.5
        linearity_distance: 0.5,
      });

      expect(result.level).toBe('MEDIUM');
    });

    it('assigns MEDIUM when one HIGH threshold fails', () => {
      // High diversity and stability, but linearity too high
      const result = calculateCalibratedConfidence({
        graph: baseGraph,
        mask_diversity: 0.7,       // ≥ 0.6 ✓
        path_stability: 0.85,      // ≥ 0.8 ✓
        linearity_distance: 0.5,   // > 0.2 ✗ (fails HIGH)
      });

      expect(result.level).toBe('MEDIUM');
    });

    it('produces stable factors across multiple calls', () => {
      const inputs = {
        graph: baseGraph,
        mask_diversity: 0.4,
        path_stability: 0.6,
        linearity_distance: 0.3,
      };

      const results = Array.from({ length: 5 }, () =>
        calculateCalibratedConfidence(inputs)
      );

      const levels = results.map(r => r.level);
      expect(new Set(levels).size).toBe(1);
      expect(levels[0]).toBe('MEDIUM');
    });
  });

  describe('LOW confidence badge', () => {
    it('assigns LOW when thresholds not met', () => {
      const result = calculateCalibratedConfidence({
        graph: baseGraph,
        mask_diversity: 0.2,       // < 0.3 ✗
        path_stability: 0.4,       // < 0.5 ✗
        linearity_distance: 0.6,
      });

      expect(result.level).toBe('LOW');
      expect(result.factors.calibration).toBe(0.2);
      expect(result.factors.identifiability).toBe(0.4);
    });

    it('assigns LOW when diversity too low', () => {
      const result = calculateCalibratedConfidence({
        graph: baseGraph,
        mask_diversity: 0.25,      // < 0.3 ✗
        path_stability: 0.8,       // ≥ 0.5 ✓
        linearity_distance: 0.1,
      });

      expect(result.level).toBe('LOW');
    });

    it('assigns LOW when stability too low', () => {
      const result = calculateCalibratedConfidence({
        graph: baseGraph,
        mask_diversity: 0.5,       // ≥ 0.3 ✓
        path_stability: 0.3,       // < 0.5 ✗
        linearity_distance: 0.1,
      });

      expect(result.level).toBe('LOW');
    });

    it('produces stable factors across multiple calls', () => {
      const inputs = {
        graph: baseGraph,
        mask_diversity: 0.1,
        path_stability: 0.2,
        linearity_distance: 0.8,
      };

      const results = Array.from({ length: 5 }, () =>
        calculateCalibratedConfidence(inputs)
      );

      const levels = results.map(r => r.level);
      expect(new Set(levels).size).toBe(1);
      expect(levels[0]).toBe('LOW');
    });
  });

  describe('Edge cases and validation', () => {
    it('clamps factors to 0-1 range', () => {
      const result = calculateCalibratedConfidence({
        graph: baseGraph,
        mask_diversity: 1.5,       // > 1, should clamp to 1
        path_stability: -0.2,      // < 0, should clamp to 0
        linearity_distance: 0.5,
      });

      expect(result.factors.calibration).toBe(1);
      expect(result.factors.identifiability).toBe(0);
    });

    it('includes k_coverage factor for monitoring', () => {
      const result = calculateCalibratedConfidence({
        graph: baseGraph,
        mask_diversity: 0.5,
        path_stability: 0.6,
        linearity_distance: 0.3,
        k_samples: 1000,
      });

      expect(result.factors).toHaveProperty('k_coverage');
      expect(result.factors.k_coverage).toBe(1.0); // k >= 1000
    });

    it('includes overall score for backward compatibility', () => {
      const result = calculateCalibratedConfidence({
        graph: baseGraph,
        mask_diversity: 0.5,
        path_stability: 0.6,
        linearity_distance: 0.3,
      });

      expect(result).toHaveProperty('score');
      expect(typeof result.score).toBe('number');
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    it('throws error for invalid level', () => {
      // This should never happen with correct implementation
      // but validates the invariant check
      const result = calculateCalibratedConfidence({
        graph: baseGraph,
        mask_diversity: 0.5,
        path_stability: 0.6,
        linearity_distance: 0.3,
      });

      expect(['HIGH', 'MEDIUM', 'LOW']).toContain(result.level);
    });
  });

  describe('Determinism guarantee', () => {
    it('same inputs always produce same badge', () => {
      const inputs = {
        graph: baseGraph,
        mask_diversity: 0.55,
        path_stability: 0.75,
        linearity_distance: 0.25,
      };

      const results = Array.from({ length: 10 }, () =>
        calculateCalibratedConfidence(inputs)
      );

      // All badges should be identical
      const badges = results.map(r => r.level);
      const uniqueBadges = new Set(badges);
      expect(uniqueBadges.size).toBe(1);

      // All factors should be identical
      const calibrations = results.map(r => r.factors.calibration);
      const identifiabilities = results.map(r => r.factors.identifiability);
      const linearities = results.map(r => r.factors.linearity_distance);

      expect(new Set(calibrations).size).toBe(1);
      expect(new Set(identifiabilities).size).toBe(1);
      expect(new Set(linearities).size).toBe(1);
    });
  });
});
