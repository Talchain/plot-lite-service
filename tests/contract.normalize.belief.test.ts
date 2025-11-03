import { describe, it, expect } from 'vitest';
import { normalizeEdge, normalizeGraph } from '../src/util/normalize.js';

describe('Normalize belief', () => {
  it('maps confidence → belief', () => {
    const e = normalizeEdge({ from: 'A', to: 'B', confidence: 0.8 });
    expect(e.belief).toBe(0.8);
    expect(e.confidence).toBeUndefined();
  });

  it('maps probability → belief', () => {
    const e = normalizeEdge({ from: 'A', to: 'B', probability: 0.9 });
    expect(e.belief).toBe(0.9);
    expect(e.probability).toBeUndefined();
  });

  it('defaults belief to 1.0', () => {
    const e = normalizeEdge({ from: 'A', to: 'B', weight: 0.5 });
    expect(e.belief).toBe(1.0);
  });

  it('normalizeGraph processes all edges', () => {
    const g = normalizeGraph({
      nodes: [{ id: 'A' }],
      edges: [{ from: 'A', to: 'B', confidence: 0.7 }]
    });
    expect(g.edges[0].belief).toBe(0.7);
    expect(g.edges[0].confidence).toBeUndefined();
  });
});
