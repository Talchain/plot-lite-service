import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('POST /v1/optimise - constrained performance', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer(); });
  afterAll(async () => { await server.kill(); });

  const RUNS = 10;
  const P95_TARGET_MS = 800;

  async function measureLatency(payload: any): Promise<number> {
    const start = performance.now();
    await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return performance.now() - start;
  }

  function calculateP95(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil(0.95 * sorted.length) - 1;
    return sorted[index];
  }

  it('p95 ≤ 800ms on 20-node graph with constraints', async () => {
    const nodes = Array.from({ length: 20 }, (_, i) => ({
      id: `N${i}`,
      label: `Node ${i}`
    }));

    const actions = Array.from({ length: 15 }, (_, i) => ({
      id: `action${i}`,
      cost: 10 + (i * 5),
      do: [{ node_id: `N${i % 20}`, set_to: 0.5 + (i * 0.02) }]
    }));

    const payload = {
      graph: { nodes, edges: [] },
      budget: 200,
      actions,
      objective: { type: 'utility_linear' as const, weights: { N0: 1.0 } },
      constraints: {
        must: ['action0', 'action1'],
        must_not: ['action14'],
        max_changed_nodes: 10
      },
      seed: 4242
    };

    const latencies: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      latencies.push(await measureLatency(payload));
    }

    const p95 = calculateP95(latencies);
    console.log(`20-node constrained optimise: p95=${p95.toFixed(1)}ms`);
    expect(p95).toBeLessThan(P95_TARGET_MS);
  });
});
