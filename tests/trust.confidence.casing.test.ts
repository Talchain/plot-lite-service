import { describe, it, expect } from 'vitest';
import { calculateConfidence } from '../src/trust/confidence.js';

describe('Confidence Level Casing Invariant', () => {
  it('emits lowercase confidence.level only', () => {
    // Deterministic, seeded inputs
    const out = calculateConfidence({
      graph: {
        nodes: [
          { id: 'start', type: 'decision' },
          { id: 'end', type: 'outcome' }
        ],
        edges: [{ from: 'start', to: 'end' }]
      },
      identifiable: true,
      in_linear_range: true,
      k_samples: 1000,
      calibrated: false,
    });

    // Must be one of lowercase values
    expect(['high', 'medium', 'low']).toContain(out.level);

    // Must be equal to its lowercase version (i.e., already lowercase)
    expect(out.level).toBe(out.level.toLowerCase());
  });

  it('covers all confidence levels with varied inputs', () => {
    // Test high confidence
    const high = calculateConfidence({
      graph: {
        nodes: Array.from({ length: 5 }, (_, i) => ({ id: `node${i}`, type: 'decision' })),
        edges: Array.from({ length: 4 }, (_, i) => ({ from: `node${i}`, to: `node${i + 1}` }))
      },
      identifiable: true,
      in_linear_range: true,
      k_samples: 5000,
      calibrated: true,
    });
    expect(high.level).toBe('high');
    expect(high.level).toBe(high.level.toLowerCase());

    // Test medium confidence
    const medium = calculateConfidence({
      graph: {
        nodes: [{ id: 'a', type: 'decision' }, { id: 'b', type: 'outcome' }],
        edges: [{ from: 'a', to: 'b' }]
      },
      identifiable: true,
      in_linear_range: true,
      k_samples: 1000,
      calibrated: false,
    });
    expect(['high', 'medium']).toContain(medium.level);
    expect(medium.level).toBe(medium.level.toLowerCase());

    // Test low confidence
    const low = calculateConfidence({
      graph: {
        nodes: [{ id: 'x', type: 'decision' }],
        edges: []
      },
      identifiable: false,
      in_linear_range: false,
      k_samples: 100,
      calibrated: false,
    });
    expect(low.level).toBe('low');
    expect(low.level).toBe(low.level.toLowerCase());
  });
});
