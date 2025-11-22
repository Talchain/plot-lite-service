/**
 * SCM-Lite Performance Test
 * Validates p95 ≤ 600ms budget for 12-node reference graph
 */

import { describe, it, expect } from 'vitest';
import { runKernel } from '../../src/scm-lite/kernel.js';
import type { DAG } from '../../src/scm-lite/types.js';

describe('SCM-Lite Performance Budget', () => {
  it('12-node reference graph completes with p95 ≤ 600ms', () => {
    // Create 12-node reference graph (diamond + chains)
    const dag: DAG = {
      nodes: Array.from({ length: 12 }, (_, i) => ({ id: `N${i}` })),
      edges: [
        // Root fan-out
        { from: 'N0', to: 'N1', belief: 0.8 },
        { from: 'N0', to: 'N2', belief: 0.8 },
        { from: 'N0', to: 'N3', belief: 0.8 },
        // Middle layers
        { from: 'N1', to: 'N4', belief: 0.7 },
        { from: 'N1', to: 'N5', belief: 0.7 },
        { from: 'N2', to: 'N5', belief: 0.7 },
        { from: 'N2', to: 'N6', belief: 0.7 },
        { from: 'N3', to: 'N6', belief: 0.7 },
        { from: 'N3', to: 'N7', belief: 0.7 },
        // Convergence
        { from: 'N4', to: 'N8', belief: 0.9 },
        { from: 'N5', to: 'N8', belief: 0.9 },
        { from: 'N5', to: 'N9', belief: 0.9 },
        { from: 'N6', to: 'N9', belief: 0.9 },
        { from: 'N6', to: 'N10', belief: 0.9 },
        { from: 'N7', to: 'N10', belief: 0.9 },
        // Final convergence
        { from: 'N8', to: 'N11', belief: 0.95 },
        { from: 'N9', to: 'N11', belief: 0.95 },
        { from: 'N10', to: 'N11', belief: 0.95 },
      ],
    };

    const config = {
      seed: 4242,
      K: 256,
      maxNodes: 12,
      beliefDefault: 0.7,
    };

    // Warm-up run
    runKernel(dag, 'N11', config);

    // Measure 20 runs
    const durations: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      runKernel(dag, 'N11', { ...config, seed: 1000 + i });
      const duration = performance.now() - start;
      durations.push(duration);
    }

    // Calculate p95
    durations.sort((a, b) => a - b);
    const p95Index = Math.floor(0.95 * (durations.length - 1));
    const p95 = durations[p95Index];

    // Log for CI visibility
    console.log(`12-node graph performance: p50=${durations[Math.floor(durations.length / 2)].toFixed(2)}ms, p95=${p95.toFixed(2)}ms`);

    // Assert budget
    expect(p95).toBeLessThanOrEqual(600);
  });

  it('4-node graph completes in <50ms p95', () => {
    const dag: DAG = {
      nodes: [
        { id: 'A' },
        { id: 'B' },
        { id: 'C' },
        { id: 'D' },
      ],
      edges: [
        { from: 'A', to: 'B', belief: 0.8 },
        { from: 'A', to: 'C', belief: 0.8 },
        { from: 'B', to: 'D', belief: 0.9 },
        { from: 'C', to: 'D', belief: 0.9 },
      ],
    };

    const config = {
      seed: 42,
      K: 100,
      maxNodes: 12,
      beliefDefault: 0.7,
    };

    // Warm-up
    runKernel(dag, 'D', config);

    // Measure 10 runs
    const durations: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      runKernel(dag, 'D', { ...config, seed: 100 + i });
      const duration = performance.now() - start;
      durations.push(duration);
    }

    durations.sort((a, b) => a - b);
    const p95 = durations[Math.floor(0.95 * (durations.length - 1))];

    console.log(`4-node graph performance: p95=${p95.toFixed(2)}ms`);

    expect(p95).toBeLessThan(50);
  });
});
