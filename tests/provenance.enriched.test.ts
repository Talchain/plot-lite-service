import { describe, it, expect } from 'vitest';

import {
  aggregateProvenance,
  classifyProvenanceConfidence,
  isValidIsoTimestamp,
} from '../src/trust/provenance.js';

// NOTE: These tests focus on the enriched provenance summary & helpers.
// Existing provenance tests cover basic extraction/validation behaviour.

describe('Provenance enrichment', () => {
  describe('aggregateProvenance summary shape', () => {
    it('returns empty summary for graph with no edges', () => {
      const graph = {
        nodes: [],
        edges: [],
      };

      const summary = aggregateProvenance(graph as any);

      expect(summary.sources).toEqual([]);
      expect(summary.source_count).toBe(0);
      expect(summary.edges_with_provenance).toBe(0);
      expect(summary.edges_total).toBe(0);
      expect(summary.coverage_ratio).toBe(0);
      expect(summary.confidence_level).toBe('unknown');
      expect(summary.confidence_score).toBe(0);
      expect(isValidIsoTimestamp(summary.collected_at)).toBe(true);
    });

    it('computes coverage and confidence for mixed provenance', () => {
      const graph = {
        nodes: [
          { id: 'A', label: 'A' },
          { id: 'B', label: 'B' },
          { id: 'C', label: 'C' },
        ],
        edges: [
          { from: 'A', to: 'B', provenance_note: 'Study 2024' },
          { from: 'B', to: 'C', provenance_note: 'Expert estimate' },
          { from: 'C', to: 'A', provenance_note: 'template' },
          { from: 'A', to: 'C' }, // no provenance
        ],
      };

      const summary = aggregateProvenance(graph as any);

      expect(summary.sources).toEqual(['Expert estimate', 'Study 2024']);
      expect(summary.source_count).toBe(2);
      expect(summary.edges_total).toBe(4);
      expect(summary.edges_with_provenance).toBe(2);
      expect(summary.coverage_ratio).toBeCloseTo(0.5, 5);
      expect(['low', 'medium', 'high', 'unknown']).toContain(summary.confidence_level);
      expect(summary.confidence_score).toBeGreaterThanOrEqual(0);
      expect(summary.confidence_score).toBeLessThanOrEqual(1);
      expect(isValidIsoTimestamp(summary.collected_at)).toBe(true);
    });

    it('ignores assumption-only provenance values', () => {
      const graph = {
        nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
        edges: [
          { from: 'A', to: 'B', provenance_note: 'template' },
          { from: 'B', to: 'A', provenance_note: 'assumption' },
        ],
      };

      const summary = aggregateProvenance(graph as any);

      expect(summary.sources).toEqual([]);
      expect(summary.source_count).toBe(0);
      expect(summary.edges_with_provenance).toBe(0);
      expect(summary.coverage_ratio).toBe(0);
      expect(summary.confidence_level).toBe('low');
    });

    it('is deterministic for equivalent graphs regardless of edge order', () => {
      const g1 = {
        nodes: [{ id: 'A', label: 'A' }],
        edges: [
          { from: 'A', to: 'A', provenance_note: 'Source 1' },
          { from: 'A', to: 'A', provenance_note: 'Source 2' },
        ],
      };

      const g2 = {
        nodes: [{ id: 'A', label: 'A' }],
        edges: [
          { from: 'A', to: 'A', provenance_note: 'Source 2' },
          { from: 'A', to: 'A', provenance_note: 'Source 1' },
        ],
      };

      const s1 = aggregateProvenance(g1 as any);
      const s2 = aggregateProvenance(g2 as any);

      expect(s1.sources).toEqual(s2.sources);
      expect(s1.source_count).toBe(s2.source_count);
      expect(s1.edges_with_provenance).toBe(s2.edges_with_provenance);
      expect(s1.edges_total).toBe(s2.edges_total);
      expect(s1.coverage_ratio).toBe(s2.coverage_ratio);
      expect(s1.confidence_level).toBe(s2.confidence_level);
      expect(s1.confidence_score).toBe(s2.confidence_score);
    });
  });

  describe('classifyProvenanceConfidence', () => {
    it('returns UNKNOWN for empty graphs', () => {
      const { level, score } = classifyProvenanceConfidence(0, 0, 0);
      expect(level).toBe('unknown');
      expect(score).toBe(0);
    });

    it('returns LOW when no edges have provenance', () => {
      const { level, score } = classifyProvenanceConfidence(0, 10, 0);
      expect(level).toBe('low');
      expect(score).toBe(0);
    });

    it('returns LOW for sparse coverage', () => {
      const { level } = classifyProvenanceConfidence(1, 10, 1);
      expect(level).toBe('low');
    });

    it('returns MEDIUM for moderate coverage and sources', () => {
      const { level, score } = classifyProvenanceConfidence(5, 10, 2);
      expect(level).toBe('medium');
      expect(score).toBeGreaterThan(0.4);
      expect(score).toBeLessThan(0.8);
    });

    it('returns HIGH for strong coverage and diverse sources', () => {
      const { level, score } = classifyProvenanceConfidence(8, 10, 3);
      expect(level).toBe('high');
      expect(score).toBeGreaterThanOrEqual(0.75);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  describe('isValidIsoTimestamp', () => {
    it('accepts valid ISO 8601 timestamps', () => {
      const now = new Date().toISOString();
      expect(isValidIsoTimestamp(now)).toBe(true);
    });

    it('rejects invalid formats', () => {
      expect(isValidIsoTimestamp('not-a-timestamp')).toBe(false);
      expect(isValidIsoTimestamp('2025-13-01T00:00:00Z')).toBe(false);
      expect(isValidIsoTimestamp('')).toBe(false);
    });

    it('rejects null/undefined', () => {
      expect(isValidIsoTimestamp(undefined)).toBe(false);
      expect(isValidIsoTimestamp(null as any)).toBe(false);
    });
  });
});
