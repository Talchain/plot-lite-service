/**
 * Tests for graph_quality score computation
 */
import { describe, it, expect } from 'vitest';
import { computeGraphQuality } from '../src/trust/graph-quality.js';

describe('computeGraphQuality', () => {
  describe('score calculation', () => {
    it('should return high score for well-formed graph', () => {
      const result = computeGraphQuality({
        nodes: 5,
        edges: 8, // Good completeness (8 / 10 = 0.8)
        edges_with_provenance: 8, // 100% evidence coverage
        critique_issues: 0,
        identifiable: true,
      });

      expect(result.score).toBeGreaterThan(0.7);
      expect(result.completeness).toBe(0.8);
      expect(result.evidence_coverage).toBe(1.0);
    });

    it('should return lower score for sparse graph', () => {
      const result = computeGraphQuality({
        nodes: 10,
        edges: 5, // Low completeness (5 / 20 = 0.25)
        edges_with_provenance: 2, // 40% evidence coverage
        critique_issues: 0,
        identifiable: true,
      });

      expect(result.score).toBeLessThan(0.7);
      expect(result.completeness).toBe(0.25);
      expect(result.evidence_coverage).toBe(0.4);
    });

    it('should penalize critique issues', () => {
      const withoutIssues = computeGraphQuality({
        nodes: 5,
        edges: 8,
        edges_with_provenance: 8,
        critique_issues: 0,
        identifiable: true,
      });

      const withIssues = computeGraphQuality({
        nodes: 5,
        edges: 8,
        edges_with_provenance: 8,
        critique_issues: 3,
        identifiable: true,
      });

      expect(withIssues.score).toBeLessThan(withoutIssues.score);
      expect(withIssues.issues_count).toBe(3);
    });

    it('should reward identifiable structure', () => {
      const identifiable = computeGraphQuality({
        nodes: 5,
        edges: 8,
        edges_with_provenance: 4,
        critique_issues: 0,
        identifiable: true,
      });

      const notIdentifiable = computeGraphQuality({
        nodes: 5,
        edges: 8,
        edges_with_provenance: 4,
        critique_issues: 0,
        identifiable: false,
      });

      expect(identifiable.score).toBeGreaterThan(notIdentifiable.score);
    });
  });

  describe('completeness', () => {
    it('should cap completeness at 1.0', () => {
      const result = computeGraphQuality({
        nodes: 3,
        edges: 10, // More than nodes * 2
        edges_with_provenance: 5,
        critique_issues: 0,
        identifiable: true,
      });

      expect(result.completeness).toBe(1.0);
    });

    it('should handle zero nodes gracefully', () => {
      const result = computeGraphQuality({
        nodes: 0,
        edges: 0,
        edges_with_provenance: 0,
        critique_issues: 0,
        identifiable: false,
      });

      expect(result.completeness).toBe(0);
      expect(result.evidence_coverage).toBe(0);
      // Score may include small balance component even for empty graph
      expect(result.score).toBeLessThanOrEqual(0.2);
    });
  });

  describe('evidence_coverage', () => {
    it('should return 0 when no edges', () => {
      const result = computeGraphQuality({
        nodes: 3,
        edges: 0,
        edges_with_provenance: 0,
        critique_issues: 0,
        identifiable: true,
      });

      expect(result.evidence_coverage).toBe(0);
    });

    it('should return 1 when all edges have provenance', () => {
      const result = computeGraphQuality({
        nodes: 5,
        edges: 10,
        edges_with_provenance: 10,
        critique_issues: 0,
        identifiable: true,
      });

      expect(result.evidence_coverage).toBe(1.0);
    });
  });

  describe('recommendations', () => {
    it('should recommend adding evidence when coverage is low', () => {
      const result = computeGraphQuality({
        nodes: 5,
        edges: 10,
        edges_with_provenance: 2, // 20% coverage
        critique_issues: 0,
        identifiable: true,
      });

      expect(result.recommendation).toContain('evidence');
    });

    it('should recommend reviewing identifiability when not identifiable', () => {
      const result = computeGraphQuality({
        nodes: 5,
        edges: 10,
        edges_with_provenance: 8, // Good coverage
        critique_issues: 0,
        identifiable: false,
      });

      expect(result.recommendation).toContain('identifiability');
    });

    it('should recommend addressing issues when many critiques', () => {
      const result = computeGraphQuality({
        nodes: 5,
        edges: 10,
        edges_with_provenance: 8,
        critique_issues: 5,
        identifiable: true,
      });

      expect(result.recommendation).toContain('critique');
    });

    it('should have no recommendation for good graph', () => {
      const result = computeGraphQuality({
        nodes: 5,
        edges: 10,
        edges_with_provenance: 10,
        critique_issues: 0,
        identifiable: true,
      });

      expect(result.recommendation).toBeUndefined();
    });
  });

  describe('output format', () => {
    it('should return score between 0 and 1', () => {
      const result = computeGraphQuality({
        nodes: 5,
        edges: 8,
        edges_with_provenance: 4,
        critique_issues: 1,
        identifiable: true,
      });

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    it('should return two decimal places for all metrics', () => {
      const result = computeGraphQuality({
        nodes: 7,
        edges: 11,
        edges_with_provenance: 5,
        critique_issues: 2,
        identifiable: true,
      });

      // Check that values are rounded to 2 decimal places
      expect(result.score.toString()).toMatch(/^\d+\.?\d{0,2}$/);
      expect(result.completeness.toString()).toMatch(/^\d+\.?\d{0,2}$/);
      expect(result.evidence_coverage.toString()).toMatch(/^\d+\.?\d{0,2}$/);
      expect(result.balance.toString()).toMatch(/^\d+\.?\d{0,2}$/);
    });
  });

  describe('determinism', () => {
    it('should return identical results for identical inputs', () => {
      const params = {
        nodes: 5,
        edges: 8,
        edges_with_provenance: 4,
        critique_issues: 1,
        identifiable: true,
      };

      const result1 = computeGraphQuality(params);
      const result2 = computeGraphQuality(params);

      expect(result1).toEqual(result2);
    });
  });
});
