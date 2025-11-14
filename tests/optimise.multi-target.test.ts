import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('POST /v1/optimise - multi-target utility', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer(); });
  afterAll(async () => { await server.kill(); });

  it('sums utility across multiple weighted targets', async () => {
    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'A', label: 'A' },
            { id: 'B', label: 'B' },
            { id: 'C', label: 'C' }
          ],
          edges: [
            { from: 'A', to: 'B', weight: 0.5 },
            { from: 'B', to: 'C', weight: 0.7 }
          ]
        },
        budget: 100,
        actions: [
          { id: 'action1', cost: 50, do: [{ node_id: 'A', set_to: 0.8 }] }
        ],
        objective: {
          type: 'utility_linear',
          weights: {
            B: 0.6,  // Multiple targets
            C: 0.4
          }
        },
        seed: 4242
      })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    
    // Verify structure
    expect(data.schema).toBe('optimise.v1');
    expect(data.utility).toBeDefined();
    expect(data.utility.expected).toBeDefined();
    expect(typeof data.utility.expected).toBe('number');
    
    // Utility should be non-zero (sum of weighted targets)
    expect(data.utility.expected).not.toBe(0);
    
    // Verify meta includes solver
    expect(data.meta.solver).toBe('greedy_kernel_v1');
  });

  it('handles single target as special case of multi-target', async () => {
    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'X', label: 'X' },
            { id: 'Y', label: 'Y' }
          ],
          edges: [{ from: 'X', to: 'Y', weight: 0.5 }]
        },
        budget: 50,
        actions: [
          { id: 'a1', cost: 30, do: [{ node_id: 'X', set_to: 0.9 }] }
        ],
        objective: {
          type: 'utility_linear',
          weights: { Y: 1.0 }
        },
        seed: 4242
      })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.utility.expected).toBeDefined();
    expect(typeof data.utility.expected).toBe('number');
  });
});
