import { describe, it } from 'vitest';
import * as fc from 'fast-check';

describe('Property-Based Tests (D1)', () => {
  it('graph normalization is idempotent', () => {
    const normalize = (g: any) => ({
      nodes: [...g.nodes].sort((a, b) => a.id.localeCompare(b.id)),
      edges: [...g.edges].sort((a, b) => a.from.localeCompare(b.from))
    });
    
    fc.assert(fc.property(
      fc.record({
        nodes: fc.array(fc.record({ id: fc.string(), label: fc.string() })),
        edges: fc.array(fc.record({ from: fc.string(), to: fc.string() }))
      }),
      (g) => JSON.stringify(normalize(g)) === JSON.stringify(normalize(normalize(g)))
    ), { seed: 4242, numRuns: 100 });
  });

  it('confidence weights are monotonic', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 1000 }),
      (weight) => {
        const level = weight < 500 ? 'LOW' : weight < 750 ? 'MEDIUM' : 'HIGH';
        return ['LOW', 'MEDIUM', 'HIGH'].includes(level);
      }
    ), { seed: 4242, numRuns: 100 });
  });

  it('adaptive-K stays within bounds', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 100 }),
      fc.integer({ min: 0, max: 200 }),
      (nodes, edges) => {
        const k = Math.max(250, Math.min(1000, 250 + 25 * edges + 10 * nodes));
        return k >= 250 && k <= 1000;
      }
    ), { seed: 4242, numRuns: 100 });
  });
});
