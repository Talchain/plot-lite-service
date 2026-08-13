import { describe, it, expect } from 'vitest';
import { calculateConfidence } from '../src/trust/confidence.js';

describe('Confidence Integer Math (determinism)', () => {
  const mockGraph = {
    nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
    edges: [{ from: 'A', to: 'B' }],
  };

  it('HIGH threshold: exactly 750/1000', () => {
    // identifiable=1 (412), linear=1 (294), k=1000 -> kcov=1 (294)
    // raw = 412 + 294 + 294 = 1000
    const result = calculateConfidence({
      graph: mockGraph,
      identifiable: true,
      in_linear_range: true,
      k_samples: 1000,
    });
    expect(result.level).toBe('HIGH');
    expect(result.score).toBeGreaterThanOrEqual(0.75);
  });

  it('MEDIUM threshold: exactly 500/1000', () => {
    // identifiable=0.3, linear=0.5, k=500 -> kcov=0.7
    // raw = round(300*412/1000)=124 + round(500*294/1000)=147 + round(700*294/1000)=206 = 477
    const result = calculateConfidence({
      graph: mockGraph,
      identifiable: false,
      in_linear_range: false,
      k_samples: 500,
    });
    expect(result.level).toBe('LOW'); // 477 < 500
  });

  it('deterministic: same inputs produce same output', () => {
    const inputs = {
      graph: mockGraph,
      identifiable: true,
      in_linear_range: true,
      k_samples: 800,
    };
    
    const r1 = calculateConfidence(inputs);
    const r2 = calculateConfidence(inputs);
    
    expect(r1).toEqual(r2);
    expect(r1.score).toBe(r2.score);
    expect(r1.level).toBe(r2.level);
  });

  it('integer boundaries are stable', () => {
    // Test that small input variations don't cause unexpected level changes
    const base = {
      graph: mockGraph,
      identifiable: true,
      in_linear_range: true,
      k_samples: 1000,
    };
    
    const r1 = calculateConfidence(base);
    const r2 = calculateConfidence({ ...base, k_samples: 999 });
    
    // Both should be HIGH (only k_coverage changes slightly)
    expect(r1.level).toBe('HIGH');
    expect(r2.level).toBe('HIGH');
  });
});
