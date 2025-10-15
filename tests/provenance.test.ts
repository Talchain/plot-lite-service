import { describe, it, expect } from 'vitest';
import { extractProvenanceSources, validateProvenanceNote, aggregateProvenance } from '../src/trust/provenance.js';

describe('Provenance (recovered)', () => {
  it('extracts unique sources', () => {
    const graph = {
      nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
      edges: [
        { from: 'A', to: 'B', provenance_note: 'Study 2023' },
        { from: 'A', to: 'B', provenance_note: 'Study 2023' }, // duplicate
        { from: 'A', to: 'B', provenance_note: 'Expert estimate' },
      ],
    };
    const sources = extractProvenanceSources(graph);
    expect(sources).toEqual(['Expert estimate', 'Study 2023']); // sorted
  });

  it('validates notes', () => {
    expect(validateProvenanceNote('Study XYZ 2023')).toBe('Study XYZ 2023');
    expect(validateProvenanceNote('  trimmed  ')).toBe('trimmed');
    expect(validateProvenanceNote('')).toBeNull();
    expect(validateProvenanceNote('a'.repeat(201))).toBeNull();
  });

  it('aggregates metadata', () => {
    const graph = {
      nodes: [{ id: 'A', label: 'A' }],
      edges: [
        { from: 'A', to: 'B', provenance_note: 'Source 1' },
        { from: 'B', to: 'C' }, // no provenance
      ],
    };
    const agg = aggregateProvenance(graph);
    expect(agg.source_count).toBe(1);
    expect(agg.edges_with_provenance).toBe(1);
    expect(agg.edges_total).toBe(2);
  });
});
