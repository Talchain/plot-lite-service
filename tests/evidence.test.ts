import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('POST /v1/evidence', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer(); });
  afterAll(async () => { await server.kill(); });

  it('applies priors to inference', async () => {
    const res = await fetch(`${server.baseUrl}/v1/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'A', label: 'Node A' },
            { id: 'B', label: 'Node B' }
          ],
          edges: []
        },
        seed: 4242,
        priors: [
          { node_id: 'A', mean: 0.8, variance: 0.05, source: 'refclass:xyz' }
        ]
      })
    });
    
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schema).toBe('evidence.v1');
    expect(data.result.summary).toBeDefined();
    expect(data.result.baseline).toBeDefined();
    expect(data.result.adjustment).toBeDefined();
    expect(data.meta.seed).toBe(4242);
    expect(data.meta.limitations).toContain('v1');
  });

  it('is deterministic with same seed', async () => {
    const payload = {
      graph: {
        nodes: [{ id: 'X', label: 'X' }],
        edges: []
      },
      seed: 1234,
      priors: [
        { node_id: 'X', mean: 0.5, variance: 0.1 }
      ]
    };
    
    const res1 = await fetch(`${server.baseUrl}/v1/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data1 = await res1.json();
    
    const res2 = await fetch(`${server.baseUrl}/v1/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data2 = await res2.json();
    
    expect(data1.result.summary.p50).toBe(data2.result.summary.p50);
    expect(data1.result.adjustment.delta).toBe(data2.result.adjustment.delta);
  });

  it('validates priors refer to existing nodes', async () => {
    const res = await fetch(`${server.baseUrl}/v1/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'A', label: 'A' }],
          edges: []
        },
        priors: [
          { node_id: 'Z', mean: 0.5, variance: 0.1 } // Z doesn't exist
        ]
      })
    });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.type).toBe('BAD_INPUT');
    expect(data.error.message).toContain('Invalid node_ids');
  });

  it('requires at least one prior', async () => {
    const res = await fetch(`${server.baseUrl}/v1/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'A', label: 'A' }],
          edges: []
        },
        priors: [] // Empty
      })
    });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.type).toBe('BAD_INPUT');
  });

  it('influences result in expected direction (monotonic sanity)', async () => {
    // Prior with positive mean should increase result
    const res = await fetch(`${server.baseUrl}/v1/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'X', label: 'X' }],
          edges: []
        },
        seed: 4242,
        priors: [
          { node_id: 'X', mean: 1.5, variance: 0.1 }
        ]
      })
    });
    
    const data = await res.json();
    expect(data.result.adjustment.direction).toBe('increase');
    expect(data.result.adjustment.delta).toBeGreaterThan(0);
  });

  it('includes top_drivers with source', async () => {
    const res = await fetch(`${server.baseUrl}/v1/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'A', label: 'A' }],
          edges: []
        },
        priors: [
          { node_id: 'A', mean: 0.8, variance: 0.05, source: 'expert_judgment' }
        ]
      })
    });
    
    const data = await res.json();
    expect(data.top_drivers).toBeDefined();
    expect(data.top_drivers.length).toBeGreaterThan(0);
    expect(data.top_drivers[0]).toHaveProperty('node_id');
    expect(data.top_drivers[0]).toHaveProperty('source');
    expect(data.top_drivers[0].source).toBe('expert_judgment');
  });

  it('handles multiple priors', async () => {
    const res = await fetch(`${server.baseUrl}/v1/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'A', label: 'A' },
            { id: 'B', label: 'B' }
          ],
          edges: []
        },
        priors: [
          { node_id: 'A', mean: 0.6, variance: 0.1 },
          { node_id: 'B', mean: 0.4, variance: 0.08 }
        ]
      })
    });
    
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schema).toBe('evidence.v1');
  });
});
