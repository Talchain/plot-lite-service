import { describe, it, expect } from 'vitest';
import { dSeparated, computeParentsChildren } from '../src/causal/dsep.js';

// Deterministic RNG
let seed = 12345;
function rand() { seed = (1103515245 * seed + 12345) % 2147483648; return seed / 2147483648; }

function pick<T>(arr: T[]): T { return arr[Math.floor(rand() * arr.length)] }

function genDag(n: number) {
  const nodes = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
  // upper triangular edges to keep acyclic
  const edges: Array<[string, string]> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (rand() < 0.3) edges.push([nodes[i], nodes[j]]);
    }
  }
  return { nodes, edges };
}

describe('d-sep properties', () => {
  it('symmetry dSeparated(X,Y|Z) == dSeparated(Y,X|Z) on small DAGs', () => {
    for (let t = 0; t < 30; t++) {
      const g = genDag(5);
      const pg = computeParentsChildren(g.nodes as any, g.edges as any);
      const X = pick(g.nodes);
      let Y = pick(g.nodes);
      if (Y === X) Y = pick(g.nodes.filter(v => v !== X));
      const Z = new Set<string>();
      // choose up to 2 conditioned nodes not equal to X or Y
      const zc = g.nodes.filter(v => v !== X && v !== Y);
      if (zc.length) Z.add(pick(zc));
      if (zc.length > 1 && rand() < 0.5) Z.add(pick(zc));
      const a = dSeparated(X as any, Y as any, Z as any, pg);
      const b = dSeparated(Y as any, X as any, Z as any, pg);
      expect(a).toBe(b);
    }
  });

  it('frontdoor guardrail: reject mediator if backdoor to Y not blocked by T', () => {
    // Construct: U->M, U->Y, T->M, M->Y but also W->Y creates backdoor via M
    const nodes = ['T','M','Y','U','W'];
    const edges: Array<[string,string]> = [ ['T','M'], ['M','Y'], ['U','M'], ['U','Y'], ['W','Y'] ];
    const g = computeParentsChildren(nodes as any, edges as any);
    // Frontdoor would need M but backdoor M->Y not blocked by T due to U,W
    // Check that dSeparated(M,Y|{T}) is false → reject frontdoor
    const sep = dSeparated('M' as any, 'Y' as any, new Set(['T']) as any, g);
    expect(sep).toBe(false);
  });
});
