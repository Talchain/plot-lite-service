import { describe, it, expect } from 'vitest';
import { runKernel } from '../src/scm-lite/kernel.js';

describe('Scope Guardrails', () => {
  it('rejects > 12 nodes with helpful message', () => {
    const nodes = Array(13).fill(0).map((_, i) => ({ id: `N${i}`, label: `Node${i}` }));
    const dag = { nodes, edges: [] };

    expect(() => runKernel(dag, 'N0', { seed: 4242, K: 10, maxNodes: 12, maxEdges: 20, beliefDefault: 0.7 }))
      .toThrow(/exceeds max nodes.*Simplify/);
  });

  it('rejects > 20 edges with helpful message', () => {
    const nodes = [
      { id: 'A', label: 'A' },
      { id: 'B', label: 'B' },
      { id: 'C', label: 'C' }
    ];
    const edges = Array(21).fill(0).map((_, i) => ({
      from: i % 2 === 0 ? 'A' : 'B',
      to: i % 2 === 0 ? 'B' : 'C',
      belief: 0.8
    }));
    const dag = { nodes, edges };

    expect(() => runKernel(dag, 'C', { seed: 4242, K: 10, maxNodes: 12, maxEdges: 20, beliefDefault: 0.7 }))
      .toThrow(/exceeds max edges.*Remove edges/);
  });

  it('accepts exactly 12 nodes and 20 edges (acyclic)', () => {
    const nodes = Array(12).fill(0).map((_, i) => ({ id: `N${i}`, label: `Node${i}` }));
    const edges = Array(20).fill(0).map((_, i) => ({
      from: `N${Math.floor(i / 2)}`,
      to: `N${Math.floor(i / 2) + 1}`,
      belief: 0.8
    })).filter(e => {
      const fromIdx = parseInt(e.from.slice(1));
      const toIdx = parseInt(e.to.slice(1));
      return fromIdx < 11 && toIdx < 12;
    }).slice(0, 20);
    const dag = { nodes, edges };

    expect(() => runKernel(dag, 'N11', { seed: 4242, K: 10, maxNodes: 12, maxEdges: 20, beliefDefault: 0.7 }))
      .not.toThrow();
  });
});
