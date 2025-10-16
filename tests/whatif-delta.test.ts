import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computeDeltaSummary } from '../src/trust/whatif-delta.js';

describe('What-If Delta (E4)', () => {
  let origEnv: string | undefined;

  beforeEach(() => {
    origEnv = process.env.WHATIF_DELTA_ENABLE;
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.WHATIF_DELTA_ENABLE = origEnv;
    } else {
      delete process.env.WHATIF_DELTA_ENABLE;
    }
  });

  it('returns null when flag OFF', () => {
    delete process.env.WHATIF_DELTA_ENABLE;
    const result = computeDeltaSummary(
      { nodes: [], edges: [{ from: 'A', to: 'B', weight: 0.5, belief: 0.8 }] },
      'B',
      100
    );
    expect(result).toBeNull();
  });

  it('computes delta when flag ON', () => {
    process.env.WHATIF_DELTA_ENABLE = '1';
    const result = computeDeltaSummary(
      { nodes: [], edges: [{ from: 'A', to: 'B', weight: 0.5, belief: 0.8 }] },
      'B',
      100
    );
    expect(result).not.toBeNull();
    expect(result!.perturbation).toContain('A→B');
    expect(typeof result!.outcome_delta).toBe('number');
  });

  it('deterministic across runs', () => {
    process.env.WHATIF_DELTA_ENABLE = '1';
    const graph = { nodes: [], edges: [{ from: 'X', to: 'Y', weight: 0.3, belief: 0.9 }] };
    
    const r1 = computeDeltaSummary(graph, 'Y', 50);
    const r2 = computeDeltaSummary(graph, 'Y', 50);
    
    expect(r1).toEqual(r2);
  });
});
