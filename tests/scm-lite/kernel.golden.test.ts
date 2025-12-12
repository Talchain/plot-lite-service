/**
 * SCM-Lite Golden Tests
 */
import { describe, it, expect } from 'vitest';
import { runKernel } from '../../src/scm-lite/kernel.js';
import type { DAG } from '../../src/scm-lite/types.js';

describe('SCM-Lite Kernel: Golden Fixtures', () => {
  it('Graph 1: Simple chain A->B->C (seed 4242) - deterministic', () => {
    const dag: DAG = {
      nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
      edges: [
        { from: 'A', to: 'B', belief: 0.8 },
        { from: 'B', to: 'C', belief: 0.9 },
      ],
    };
    
    const r1 = runKernel(dag, 'C', { seed: 4242, K: 100 });
    const r2 = runKernel(dag, 'C', { seed: 4242, K: 100 });
    
    expect(r1.bma_hash).toBe(r2.bma_hash);
    expect(r1.quantiles).toEqual(r2.quantiles);
    expect(r1.quantiles.p10).toBeLessThanOrEqual(r1.quantiles.p50);
    expect(r1.quantiles.p50).toBeLessThanOrEqual(r1.quantiles.p90);
  });

  it('Graph 2: Fork A->B, A->C (seed 1234) - deterministic', () => {
    const dag: DAG = {
      nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
      edges: [
        { from: 'A', to: 'B', belief: 0.7 },
        { from: 'A', to: 'C', belief: 0.7 },
      ],
    };
    
    const r1 = runKernel(dag, 'B', { seed: 1234, K: 100 });
    const r2 = runKernel(dag, 'B', { seed: 1234, K: 100 });
    
    expect(r1.bma_hash).toBe(r2.bma_hash);
    expect(r1.quantiles).toEqual(r2.quantiles);
  });

  it('Graph 3: Diamond A->B->D, A->C->D (seed 9999) - deterministic', () => {
    const dag: DAG = {
      nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }],
      edges: [
        { from: 'A', to: 'B', belief: 0.8 },
        { from: 'A', to: 'C', belief: 0.8 },
        { from: 'B', to: 'D', belief: 0.9 },
        { from: 'C', to: 'D', belief: 0.9 },
      ],
    };
    
    const r1 = runKernel(dag, 'D', { seed: 9999, K: 100 });
    const r2 = runKernel(dag, 'D', { seed: 9999, K: 100 });
    
    expect(r1.bma_hash).toBe(r2.bma_hash);
    expect(r1.meta.identified_paths).toBeGreaterThan(0);
  });

  it('Rejects cyclic graph', () => {
    const dag: DAG = {
      nodes: [{ id: 'A' }, { id: 'B' }],
      edges: [{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }],
    };
    expect(() => runKernel(dag, 'A', { seed: 1 })).toThrow('cycle');
  });

  it('Rejects graph exceeding max nodes', () => {
    const nodes = Array.from({ length: 15 }, (_, i) => ({ id: `N${i}` }));
    const dag: DAG = { nodes, edges: [] };
    expect(() => runKernel(dag, 'N0', { seed: 1, maxNodes: 12 })).toThrow('exceeds max nodes');
  });
});

describe('SCM-Lite Kernel: Probability Cap (Brief 34)', () => {
  it('caps values near 1.0 at 0.99 (100% display issue)', () => {
    // Graph with 2 parents each contributing weight 0.5
    // Result: 2 * 1.0 * 0.5 = 1.0, which gets capped to 0.99
    const dag: DAG = {
      nodes: [{ id: 'A' }, { id: 'B' }, { id: 'outcome' }],
      edges: [
        { from: 'A', to: 'outcome', belief: 1.0, weight: 0.5 },
        { from: 'B', to: 'outcome', belief: 1.0, weight: 0.5 },
      ],
    };

    const result = runKernel(dag, 'outcome', { seed: 42, K: 256 });

    // Value would be 1.0 but gets capped to 0.99
    expect(result.quantiles.p50).toBe(0.99);
    expect(result.quantiles.p90).toBe(0.99);
  });

  it('does NOT cap magnitude values (values far from 1.0)', () => {
    // Graph with 4 parents each contributing weight 0.5
    // Result: 4 * 1.0 * 0.5 = 2.0, which should NOT be capped
    const dag: DAG = {
      nodes: [
        { id: 'P1' }, { id: 'P2' }, { id: 'P3' }, { id: 'P4' },
        { id: 'outcome' }
      ],
      edges: [
        { from: 'P1', to: 'outcome', belief: 1.0, weight: 0.5 },
        { from: 'P2', to: 'outcome', belief: 1.0, weight: 0.5 },
        { from: 'P3', to: 'outcome', belief: 1.0, weight: 0.5 },
        { from: 'P4', to: 'outcome', belief: 1.0, weight: 0.5 },
      ],
    };

    const result = runKernel(dag, 'outcome', { seed: 42, K: 256 });

    // Value is 2.0, which is NOT capped (it's a magnitude, not probability)
    expect(result.quantiles.p50).toBe(2);
    expect(result.quantiles.p90).toBe(2);
  });

  it('caps exactly 1.0 chain to 0.99', () => {
    // Simple chain A->B with belief=1.0 and weight=1.0
    // Root A gets value=1, B gets 1*1=1, which gets capped to 0.99
    const dag: DAG = {
      nodes: [{ id: 'A' }, { id: 'B' }],
      edges: [
        { from: 'A', to: 'B', belief: 1.0, weight: 1.0 },
      ],
    };

    const result = runKernel(dag, 'B', { seed: 42, K: 256 });

    // Value would be 1.0 but gets capped exactly at 0.99
    expect(result.quantiles.p50).toBe(0.99);
    expect(result.quantiles.p90).toBe(0.99);
  });
});
