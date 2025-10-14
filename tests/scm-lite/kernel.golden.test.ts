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
