import { describe, it, expect } from 'vitest';
import { normalizeEdge, normalizeGraph } from '../src/util/normalize.js';

describe('Normalize belief', () => {
  it('ingress: no default belief', () => {
    const e = normalizeEdge({ from: 'A', to: 'B', weight: 0.5 }, false);
    expect(e.belief).toBeUndefined();
  });

  it('emit: defaults belief to 1.0', () => {
    const e = normalizeEdge({ from: 'A', to: 'B', weight: 0.5 }, true);
    expect(e.belief).toBe(1.0);
  });

  it('maps confidence → belief', () => {
    const e = normalizeEdge({ from: 'A', to: 'B', confidence: 0.8 }, false);
    expect(e.belief).toBe(0.8);
    expect(e.confidence).toBeUndefined();
  });

  it('maps probability → belief', () => {
    const e = normalizeEdge({ from: 'A', to: 'B', probability: 0.9 }, false);
    expect(e.belief).toBe(0.9);
    expect(e.probability).toBeUndefined();
  });
});
