import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Performance gates', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer(); });
  afterAll(async () => { await server.kill(); });

  const RUNS = 10;
  // Per-endpoint p95 targets
  const P95_RUN_MS = 600;
  const P95_COMPARE_MS = 600;
  const P95_INSPECT_MS = 600;
  const P95_INTERVENE_MS = 600;
  const P95_OPTIMISE_MS = 800;

  async function measureLatency(url: string, body: any): Promise<number> {
    const start = performance.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const elapsed = performance.now() - start;
    if (!res.ok) {
      throw new Error(`Request failed with ${res.status}: ${await res.text()}`);
    }
    return elapsed;
  }

  function calculatePercentile(values: number[], percentile: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index];
  }

  it('POST /v1/run - p50/p95/max', async () => {
    const latencies: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const ms = await measureLatency(`${server.baseUrl}/v1/run`, {
        graph: {
          nodes: [
            { id: 'A', label: 'A' },
            { id: 'B', label: 'B' },
            { id: 'C', label: 'C' }
          ],
          edges: [
            { from: 'A', to: 'B' },
            { from: 'B', to: 'C' }
          ]
        },
        seed: 4242
      });
      latencies.push(ms);
    }
    const p50 = calculatePercentile(latencies, 50);
    const p95 = calculatePercentile(latencies, 95);
    const max = Math.max(...latencies);
    console.log(`/v1/run: p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms`);
    expect(p95).toBeLessThan(P95_RUN_MS);
  });

  it('POST /v1/compare - p50/p95/max', async () => {
    const latencies: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const ms = await measureLatency(`${server.baseUrl}/v1/compare`, {
        graphs: [
          {
            label: 'Base',
            graph: {
              nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
              edges: [{ from: 'A', to: 'B' }]
            }
          },
          {
            label: 'Alt',
            graph: {
              nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
              edges: [{ from: 'A', to: 'B' }]
            }
          }
        ],
        seed: 4242
      });
      latencies.push(ms);
    }
    const p50 = calculatePercentile(latencies, 50);
    const p95 = calculatePercentile(latencies, 95);
    const max = Math.max(...latencies);
    console.log(`/v1/compare: p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms`);
    expect(p95).toBeLessThan(P95_COMPARE_MS);
  });

  it('POST /v1/inspect - p50/p95/max', async () => {
    const latencies: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const ms = await measureLatency(`${server.baseUrl}/v1/inspect`, {
        graph: {
          nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
          edges: [{ from: 'A', to: 'B', weight: 0.5 }]
        },
        seed: 4242
      });
      latencies.push(ms);
    }
    const p50 = calculatePercentile(latencies, 50);
    const p95 = calculatePercentile(latencies, 95);
    const max = Math.max(...latencies);
    console.log(`/v1/inspect: p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms`);
    expect(p95).toBeLessThan(P95_INSPECT_MS);
  });

  it('POST /v1/intervene - p95 ≤ 600ms (1-node)', async () => {
    const latencies: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const ms = await measureLatency(`${server.baseUrl}/v1/intervene`, {
        graph: { nodes: [{ id: 'X', label: 'X' }], edges: [] },
        actions: [{ node_id: 'X', value: 1.0 }],
        seed: 4242
      });
      latencies.push(ms);
    }
    const p50 = calculatePercentile(latencies, 50);
    const p95 = calculatePercentile(latencies, 95);
    const max = Math.max(...latencies);
    console.log(`/v1/intervene (1-node): p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms`);
    expect(p95).toBeLessThan(P95_INTERVENE_MS);
  });

  it('POST /v1/intervene - p95 ≤ 600ms (20-node)', async () => {
    const latencies: number[] = [];
    const nodes = Array.from({ length: 20 }, (_, i) => ({ id: `N${i}`, label: `Node${i}` }));
    const edges = Array.from({ length: 19 }, (_, i) => ({ from: `N${i}`, to: `N${i+1}`, weight: 0.5 }));
    for (let i = 0; i < RUNS; i++) {
      const ms = await measureLatency(`${server.baseUrl}/v1/intervene`, {
        graph: { nodes, edges },
        actions: [{ node_id: 'N0', value: 0.9 }],
        seed: 4242
      });
      latencies.push(ms);
    }
    const p50 = calculatePercentile(latencies, 50);
    const p95 = calculatePercentile(latencies, 95);
    const max = Math.max(...latencies);
    console.log(`/v1/intervene (20-node): p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms`);
    expect(p95).toBeLessThan(P95_INTERVENE_MS);
  });

  it('POST /v1/optimise - p95 ≤ 800ms with actions', async () => {
    const latencies: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const ms = await measureLatency(`${server.baseUrl}/v1/optimise`, {
        graph: {
          nodes: [
            { id: 'Price', label: 'Price' },
            { id: 'Demand', label: 'Demand' },
            { id: 'Revenue', label: 'Revenue' }
          ],
          edges: [
            { from: 'Price', to: 'Demand', weight: -0.5 },
            { from: 'Demand', to: 'Revenue', weight: 0.8 }
          ]
        },
        budget: 100,
        actions: [
          { id: 'discount',  cost: 50, do: [{ node_id: 'Price',  set_to: 0.7  }] },
          { id: 'marketing', cost: 80, do: [{ node_id: 'Demand', set_to: 0.9  }] },
          { id: 'promo',     cost: 30, do: [{ node_id: 'Price',  set_to: 0.85 }] }
        ],
        objective: {
          type: 'utility_linear',
          weights: { Revenue: 1.0 }
        },
        seed: 4242
      });
      latencies.push(ms);
    }
    const p50 = calculatePercentile(latencies, 50);
    const p95 = calculatePercentile(latencies, 95);
    const max = Math.max(...latencies);
    console.log(`/v1/optimise (actions): p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms`);
    expect(p95).toBeLessThan(P95_OPTIMISE_MS);
  });
});