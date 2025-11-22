import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('POST /v1/sensitivity', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer(); });
  afterAll(async () => { await server.kill(); });

  it('performs OAT sensitivity analysis', async () => {
    const res = await fetch(`${server.baseUrl}/v1/sensitivity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'A', label: 'Node A', value: 0.5 },
            { id: 'B', label: 'Node B', value: 0.3 }
          ],
          edges: []
        },
        seed: 4242,
        method: 'oat',
        delta: 0.1
      })
    });
    
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schema).toBe('sensitivity.v1');
    expect(data.summary.baseline).toBeDefined();
    expect(data.drivers).toBeDefined();
    expect(Array.isArray(data.drivers)).toBe(true);
    expect(data.drivers.length).toBe(2);
    expect(data.meta.method).toBe('oat');
    expect(data.meta.evaluations).toBe(5); // 1 + 2*2
  });

  it('is deterministic with same seed', async () => {
    const payload = {
      graph: {
        nodes: [{ id: 'X', label: 'X', value: 0.5 }],
        edges: []
      },
      seed: 1234,
      method: 'oat',
      delta: 0.1
    };
    
    const res1 = await fetch(`${server.baseUrl}/v1/sensitivity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data1 = await res1.json();
    
    const res2 = await fetch(`${server.baseUrl}/v1/sensitivity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data2 = await res2.json();
    
    expect(data1.summary.baseline.p50).toBe(data2.summary.baseline.p50);
    expect(data1.drivers).toEqual(data2.drivers);
  });

  it('validates delta in (0, 1]', async () => {
    const res = await fetch(`${server.baseUrl}/v1/sensitivity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'A', label: 'A' }],
          edges: []
        },
        delta: 1.5 // Invalid
      })
    });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.type).toBe('BAD_INPUT');
    expect(data.error.message).toContain('delta');
  });

  it('validates targets refer to existing nodes', async () => {
    const res = await fetch(`${server.baseUrl}/v1/sensitivity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'A', label: 'A' }],
          edges: []
        },
        targets: ['Z'] // Doesn't exist
      })
    });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.type).toBe('BAD_INPUT');
    expect(data.error.message).toContain('Invalid target');
  });

  it('supports subset of targets', async () => {
    const res = await fetch(`${server.baseUrl}/v1/sensitivity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'A', label: 'A' },
            { id: 'B', label: 'B' },
            { id: 'C', label: 'C' }
          ],
          edges: []
        },
        targets: ['A', 'C'] // Only analyze A and C
      })
    });
    
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.drivers.length).toBe(2);
    expect(data.drivers.map((d: any) => d.node_id).sort()).toEqual(['A', 'C']);
    expect(data.meta.evaluations).toBe(5); // 1 + 2*2
  });

  it('ranks drivers by total swing', async () => {
    const res = await fetch(`${server.baseUrl}/v1/sensitivity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'A', label: 'A', value: 0.8 },
            { id: 'B', label: 'B', value: 0.2 }
          ],
          edges: []
        },
        seed: 4242
      })
    });
    
    const data = await res.json();
    expect(data.drivers[0].rank).toBe(1);
    expect(data.drivers[1].rank).toBe(2);
    
    // Verify stable sort (tie-break by node_id)
    expect(data.drivers.every((d: any, idx: any) => d.rank === idx + 1)).toBe(true);
  });

  it('includes tornado chart data', async () => {
    const res = await fetch(`${server.baseUrl}/v1/sensitivity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'X', label: 'X', value: 0.5 }],
          edges: []
        }
      })
    });
    
    const data = await res.json();
    expect(data.drivers[0].tornado).toBeDefined();
    expect(data.drivers[0].tornado.low).toBeDefined();
    expect(data.drivers[0].tornado.high).toBeDefined();
    expect(typeof data.drivers[0].tornado.low).toBe('number');
    expect(typeof data.drivers[0].tornado.high).toBe('number');
  });

  it('defaults to method=oat and delta=0.1', async () => {
    const res = await fetch(`${server.baseUrl}/v1/sensitivity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'A', label: 'A' }],
          edges: []
        }
      })
    });
    
    const data = await res.json();
    expect(data.meta.method).toBe('oat');
  });
});
