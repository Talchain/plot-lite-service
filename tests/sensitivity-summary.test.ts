/**
 * Tests for sensitivity_summary computation
 */
import { describe, it, expect } from 'vitest';
import { computeSensitivitySummary } from '../src/trust/sensitivity-summary.js';

describe('computeSensitivitySummary', () => {
  describe('concentration levels', () => {
    it('should return high concentration when top 3 explain >= 70%', () => {
      const drivers = [
        { edge_id: 'A::B::0', score: 0.5 },
        { edge_id: 'B::C::1', score: 0.3 },
        { edge_id: 'C::D::2', score: 0.1 },
      ];

      const result = computeSensitivitySummary(drivers);

      expect(result.concentration).toBe('high');
      expect(result.top_n_explain_pct).toBe(1.0); // All 3 are in top 3
      expect(result.top_n).toBe(3);
      expect(result.interpretation).toContain('Focus validation');
    });

    it('should return medium concentration when top 3 explain 40-70%', () => {
      const drivers = [
        { edge_id: 'A::B::0', score: 0.2 },
        { edge_id: 'B::C::1', score: 0.15 },
        { edge_id: 'C::D::2', score: 0.1 },
        { edge_id: 'D::E::3', score: 0.15 },
        { edge_id: 'E::F::4', score: 0.2 },
        { edge_id: 'F::G::5', score: 0.2 },
      ];

      const result = computeSensitivitySummary(drivers);

      expect(result.concentration).toBe('medium');
      expect(result.top_n_explain_pct).toBeGreaterThanOrEqual(0.4);
      expect(result.top_n_explain_pct).toBeLessThan(0.7);
      expect(result.interpretation).toContain('Review several');
    });

    it('should return diffuse concentration when top 3 explain < 40%', () => {
      // Many edges with similar small scores
      const drivers = [
        { edge_id: 'A::B::0', score: 0.1 },
        { edge_id: 'B::C::1', score: 0.1 },
        { edge_id: 'C::D::2', score: 0.1 },
        { edge_id: 'D::E::3', score: 0.1 },
        { edge_id: 'E::F::4', score: 0.1 },
        { edge_id: 'F::G::5', score: 0.1 },
        { edge_id: 'G::H::6', score: 0.1 },
        { edge_id: 'H::I::7', score: 0.1 },
        { edge_id: 'I::J::8', score: 0.1 },
        { edge_id: 'J::K::9', score: 0.1 },
      ];

      const result = computeSensitivitySummary(drivers);

      expect(result.concentration).toBe('diffuse');
      expect(result.top_n_explain_pct).toBeLessThan(0.4);
      expect(result.interpretation).toContain('spread across');
    });
  });

  describe('edge cases', () => {
    it('should handle empty drivers gracefully', () => {
      const result = computeSensitivitySummary([]);

      expect(result.concentration).toBe('diffuse');
      expect(result.top_n_explain_pct).toBe(0);
      expect(result.top_n).toBe(0);
      expect(result.interpretation).toBe('No significant drivers identified.');
    });

    it('should handle single driver', () => {
      const drivers = [{ edge_id: 'A::B::0', score: 1.0 }];

      const result = computeSensitivitySummary(drivers);

      expect(result.concentration).toBe('high');
      expect(result.top_n_explain_pct).toBe(1.0);
      expect(result.top_n).toBe(1);
    });

    it('should handle two drivers', () => {
      const drivers = [
        { edge_id: 'A::B::0', score: 0.6 },
        { edge_id: 'B::C::1', score: 0.4 },
      ];

      const result = computeSensitivitySummary(drivers);

      expect(result.concentration).toBe('high');
      expect(result.top_n_explain_pct).toBe(1.0);
      expect(result.top_n).toBe(2);
    });

    it('should handle zero scores', () => {
      const drivers = [
        { edge_id: 'A::B::0', score: 0 },
        { edge_id: 'B::C::1', score: 0 },
      ];

      const result = computeSensitivitySummary(drivers);

      expect(result.concentration).toBe('diffuse');
      expect(result.top_n_explain_pct).toBe(0);
    });
  });

  describe('output format', () => {
    it('should return top_n_explain_pct as number between 0 and 1', () => {
      const drivers = [
        { edge_id: 'A::B::0', score: 0.5 },
        { edge_id: 'B::C::1', score: 0.3 },
        { edge_id: 'C::D::2', score: 0.2 },
      ];

      const result = computeSensitivitySummary(drivers);

      expect(result.top_n_explain_pct).toBeGreaterThanOrEqual(0);
      expect(result.top_n_explain_pct).toBeLessThanOrEqual(1);
    });

    it('should return interpretation as non-empty string', () => {
      const drivers = [{ edge_id: 'A::B::0', score: 0.5 }];

      const result = computeSensitivitySummary(drivers);

      expect(typeof result.interpretation).toBe('string');
      expect(result.interpretation.length).toBeGreaterThan(0);
    });
  });

  describe('determinism', () => {
    it('should return identical results for identical inputs', () => {
      const drivers = [
        { edge_id: 'A::B::0', score: 0.5 },
        { edge_id: 'B::C::1', score: 0.3 },
        { edge_id: 'C::D::2', score: 0.2 },
      ];

      const result1 = computeSensitivitySummary(drivers);
      const result2 = computeSensitivitySummary(drivers);

      expect(result1).toEqual(result2);
    });
  });
});
