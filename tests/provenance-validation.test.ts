import { describe, it, expect } from 'vitest';
import { validateProvenance } from '../src/schemas/provenance-schema.js';

describe('Provenance Validation (PROVENANCE_ENABLE=1)', () => {
  it('accepts valid provenance notes', () => {
    const edges = [
      { from: 'A', to: 'B', provenance_note: 'Study XYZ 2023' },
      { from: 'B', to: 'C', provenance_note: 'Expert estimate (Dr. Smith)' },
    ];
    const result = validateProvenance(edges);
    expect(result.valid).toBe(true);
  });

  it('rejects oversize notes', () => {
    const edges = [
      { from: 'A', to: 'B', provenance_note: 'a'.repeat(201) },
    ];
    const result = validateProvenance(edges);
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('exceeds 200 characters');
  });

  it('rejects invalid characters', () => {
    const edges = [
      { from: 'A', to: 'B', provenance_note: 'Invalid <script>' },
    ];
    const result = validateProvenance(edges);
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('invalid characters');
  });

  it('allows edges without provenance', () => {
    const edges = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C', provenance_note: 'Valid note' },
    ];
    const result = validateProvenance(edges);
    expect(result.valid).toBe(true);
  });

  it('deterministic: same notes produce same aggregation', () => {
    const edges = [
      { from: 'A', to: 'B', provenance_note: '  Source 1  ' },
      { from: 'B', to: 'C', provenance_note: 'Source 1' }, // duplicate after trim
      { from: 'C', to: 'D', provenance_note: 'Source 2' },
    ];
    
    // Import aggregation from provenance module
    const { extractProvenanceSources } = require('../dist/trust/provenance.js');
    const sources = extractProvenanceSources({ nodes: [], edges });
    
    expect(sources).toEqual(['Source 1', 'Source 2']); // sorted, unique
  });
});
