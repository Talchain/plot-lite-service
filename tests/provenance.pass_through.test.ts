import { describe, it, expect } from 'vitest';
import {
  extractProvenanceSources,
  formatSources,
  validateProvenanceNote,
  aggregateProvenance,
  type GraphWithProvenance,
} from '../src/trust/provenance.js';

describe('Provenance pass-through', () => {
  describe('extractProvenanceSources', () => {
    it('extracts unique sources from edges', () => {
      const graph: GraphWithProvenance = {
        nodes: [
          { id: 'A', label: 'A' },
          { id: 'B', label: 'B' },
          { id: 'C', label: 'C' },
        ],
        edges: [
          { from: 'A', to: 'B', weight: 0.5, provenance_note: 'Study XYZ 2023' },
          { from: 'B', to: 'C', weight: 0.7, provenance_note: 'Expert estimate' },
        ],
      };

      const sources = extractProvenanceSources(graph);

      expect(sources).toHaveLength(2);
      expect(sources).toContain('Study XYZ 2023');
      expect(sources).toContain('Expert estimate');
    });

    it('deduplicates identical sources', () => {
      const graph: GraphWithProvenance = {
        nodes: [
          { id: 'A', label: 'A' },
          { id: 'B', label: 'B' },
          { id: 'C', label: 'C' },
        ],
        edges: [
          { from: 'A', to: 'B', provenance_note: 'Study ABC' },
          { from: 'B', to: 'C', provenance_note: 'Study ABC' },
        ],
      };

      const sources = extractProvenanceSources(graph);

      expect(sources).toHaveLength(1);
      expect(sources[0]).toBe('Study ABC');
    });

    it('returns empty array when no provenance notes', () => {
      const graph: GraphWithProvenance = {
        nodes: [
          { id: 'A', label: 'A' },
          { id: 'B', label: 'B' },
        ],
        edges: [
          { from: 'A', to: 'B', weight: 0.5 },
        ],
      };

      const sources = extractProvenanceSources(graph);

      expect(sources).toEqual([]);
    });

    it('ignores empty or whitespace-only notes', () => {
      const graph: GraphWithProvenance = {
        nodes: [
          { id: 'A', label: 'A' },
          { id: 'B', label: 'B' },
          { id: 'C', label: 'C' },
        ],
        edges: [
          { from: 'A', to: 'B', provenance_note: '' },
          { from: 'B', to: 'C', provenance_note: '   ' },
        ],
      };

      const sources = extractProvenanceSources(graph);

      expect(sources).toEqual([]);
    });

    it('returns sorted sources for determinism', () => {
      const graph: GraphWithProvenance = {
        nodes: [
          { id: 'A', label: 'A' },
          { id: 'B', label: 'B' },
          { id: 'C', label: 'C' },
        ],
        edges: [
          { from: 'A', to: 'B', provenance_note: 'Zebra Study' },
          { from: 'B', to: 'C', provenance_note: 'Alpha Study' },
        ],
      };

      const sources = extractProvenanceSources(graph);

      expect(sources).toEqual(['Alpha Study', 'Zebra Study']);
    });

    it('produces deterministic results across multiple calls', () => {
      const graph: GraphWithProvenance = {
        nodes: [
          { id: 'A', label: 'A' },
          { id: 'B', label: 'B' },
        ],
        edges: [
          { from: 'A', to: 'B', provenance_note: 'Source 1' },
        ],
      };

      const results = Array.from({ length: 5 }, () => extractProvenanceSources(graph));

      // All results should be identical
      const stringified = results.map(r => JSON.stringify(r));
      expect(new Set(stringified).size).toBe(1);
    });
  });

  describe('formatSources', () => {
    it('formats single source', () => {
      const formatted = formatSources(['Study ABC']);
      expect(formatted).toBe('Study ABC');
    });

    it('formats two sources with "and"', () => {
      const formatted = formatSources(['Study A', 'Study B']);
      expect(formatted).toBe('Study A and Study B');
    });

    it('formats three or more sources with commas', () => {
      const formatted = formatSources(['Study A', 'Study B', 'Study C']);
      expect(formatted).toBe('Study A, Study B, and Study C');
    });

    it('returns message for empty sources', () => {
      const formatted = formatSources([]);
      expect(formatted).toBe('No sources specified');
    });
  });

  describe('validateProvenanceNote', () => {
    it('accepts valid notes', () => {
      expect(validateProvenanceNote('Study XYZ 2023')).toBe('Study XYZ 2023');
      expect(validateProvenanceNote('Expert estimate')).toBe('Expert estimate');
      expect(validateProvenanceNote('Meta-analysis 2020-2023')).toBe('Meta-analysis 2020-2023');
    });

    it('trims whitespace', () => {
      expect(validateProvenanceNote('  Study ABC  ')).toBe('Study ABC');
    });

    it('rejects empty or whitespace-only notes', () => {
      expect(validateProvenanceNote('')).toBeNull();
      expect(validateProvenanceNote('   ')).toBeNull();
      expect(validateProvenanceNote(undefined)).toBeNull();
    });

    it('rejects notes that are too long', () => {
      const longNote = 'A'.repeat(201);
      expect(validateProvenanceNote(longNote)).toBeNull();
    });

    it('rejects notes with only special characters', () => {
      expect(validateProvenanceNote('!!!')).toBeNull();
      expect(validateProvenanceNote('---')).toBeNull();
    });

    it('accepts notes with mixed alphanumeric and special characters', () => {
      expect(validateProvenanceNote('Study-2023')).toBe('Study-2023');
      expect(validateProvenanceNote('Expert (2020)')).toBe('Expert (2020)');
    });
  });

  describe('aggregateProvenance', () => {
    it('aggregates provenance metadata', () => {
      const graph: GraphWithProvenance = {
        nodes: [
          { id: 'A', label: 'A' },
          { id: 'B', label: 'B' },
          { id: 'C', label: 'C' },
        ],
        edges: [
          { from: 'A', to: 'B', provenance_note: 'Source 1' },
          { from: 'B', to: 'C', provenance_note: 'Source 2' },
          { from: 'A', to: 'C', weight: 0.5 }, // No provenance
        ],
      };

      const result = aggregateProvenance(graph);

      expect(result.sources).toEqual(['Source 1', 'Source 2']);
      expect(result.source_count).toBe(2);
      expect(result.edges_with_provenance).toBe(2);
      expect(result.edges_total).toBe(3);
    });

    it('handles graph with no provenance', () => {
      const graph: GraphWithProvenance = {
        nodes: [
          { id: 'A', label: 'A' },
          { id: 'B', label: 'B' },
        ],
        edges: [
          { from: 'A', to: 'B', weight: 0.5 },
        ],
      };

      const result = aggregateProvenance(graph);

      expect(result.sources).toEqual([]);
      expect(result.source_count).toBe(0);
      expect(result.edges_with_provenance).toBe(0);
      expect(result.edges_total).toBe(1);
    });

    it('produces deterministic results', () => {
      const graph: GraphWithProvenance = {
        nodes: [
          { id: 'A', label: 'A' },
          { id: 'B', label: 'B' },
        ],
        edges: [
          { from: 'A', to: 'B', provenance_note: 'Test Source' },
        ],
      };

      const results = Array.from({ length: 5 }, () => aggregateProvenance(graph));

      const stringified = results.map(r => JSON.stringify(r));
      expect(new Set(stringified).size).toBe(1);
    });
  });
});
