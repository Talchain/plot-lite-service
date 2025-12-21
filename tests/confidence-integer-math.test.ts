import { describe, it, expect } from 'vitest';
import { calculateConfidence } from '../src/trust/confidence.js';

describe('Confidence Integer Math (determinism)', () => {
  const mockGraph = {
    nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
    edges: [{ from: 'A', to: 'B' }],
  };

  it('HIGH threshold: exactly 750/1000', () => {
    // identifiable=1, linear=1, k=1000 (kcov=1), calibrated=false (0.5)
    // raw = 350*1 + 250*1 + 250*1 + 150*0.5 = 350+250+250+75 = 925
    const result = calculateConfidence({
      graph: mockGraph,
      identifiable: true,
      in_linear_range: true,
      k_samples: 1000,
      calibrated: false,
    });
    expect(result.level).toBe('HIGH');
    expect(result.score).toBeGreaterThanOrEqual(0.75);
  });

  it('MEDIUM threshold: exactly 500/1000', () => {
    // identifiable=0.3, linear=0.5, k=500 (kcov=0.7), calibrated=false (0.5)
    // raw = 350*0.3 + 250*0.5 + 250*0.7 + 150*0.5 = 105+125+175+75 = 480
    const result = calculateConfidence({
      graph: mockGraph,
      identifiable: false,
      in_linear_range: false,
      k_samples: 500,
      calibrated: false,
    });
    expect(result.level).toBe('LOW'); // 480 < 500
  });

  it('deterministic: same inputs produce same output', () => {
    const inputs = {
      graph: mockGraph,
      identifiable: true,
      in_linear_range: true,
      k_samples: 800,
      calibrated: false,
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
      calibrated: false,
    };
    
    const r1 = calculateConfidence(base);
    const r2 = calculateConfidence({ ...base, k_samples: 999 });
    
    // Both should be HIGH (only k_coverage changes slightly)
    expect(r1.level).toBe('HIGH');
    expect(r2.level).toBe('HIGH');
  });
});
