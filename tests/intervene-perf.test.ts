import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('POST /v1/intervene - performance', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer(); });
  afterAll(async () => { await server.kill(); });

  const RUNS = 10;
  const P95_TARGET_MS = 600;

  async function measureLatency(payload: any): Promise<number> {
    const start = performance.now();
    await fetch(`${server.baseUrl}/v1/intervene`, {
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

  it('p95 ≤ 600ms on 1-node graph', async () => {
    const payload = {
      graph: {
        nodes: [{ id: 'A', label: 'A' }],
        edges: []
      },
      actions: [{ node_id: 'A', value: 0.5 }],
      seed: 4242
    };

    const latencies: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      latencies.push(await measureLatency(payload));
    }

    const p95 = calculateP95(latencies);
    console.log(`1-node intervene: p95=${p95.toFixed(1)}ms`);
    expect(p95).toBeLessThan(P95_TARGET_MS);
  });

  it('p95 ≤ 600ms on 20-node graph', async () => {
    const nodes = Array.from({ length: 20 }, (_, i) => ({
      id: `N${i}`,
      label: `Node ${i}`
    }));

    const edges = Array.from({ length: 30 }, (_, i) => ({
      from: `N${i % 20}`,
      to: `N${(i + 1) % 20}`
    }));

    const payload = {
      graph: { nodes, edges },
      actions: [
        { node_id: 'N0', value: 0.8 },
        { node_id: 'N5', value: 0.6 },
        { node_id: 'N10', value: 0.9 }
      ],
      seed: 4242
    };

    const latencies: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      latencies.push(await measureLatency(payload));
    }

    const p95 = calculateP95(latencies);
    console.log(`20-node intervene: p95=${p95.toFixed(1)}ms`);
    expect(p95).toBeLessThan(P95_TARGET_MS);
  });
});
