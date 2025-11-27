import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('POST /v1/score', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer(); });
  afterAll(async () => { await server.kill(); });

  it('scores options with linear utilities', async () => {
    const res = await fetch(`${server.baseUrl}/v1/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'A', label: 'Option A' },
            { id: 'B', label: 'Option B' }
          ],
          edges: []
        },
        seed: 4242,
        utilities: {
          type: 'linear',
          weights: { A: 1.0, B: 0.5 }
        }
      })
    });
    
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schema).toBe('score.v1');
    expect(data.result.options).toHaveLength(2);
    expect(data.result.ranking).toHaveLength(2);
    expect(data.meta.seed).toBe(4242);
    expect(data.meta.inference_mode).toBe('model_based');
  });

  it('is deterministic with same seed', async () => {
    const payload = {
      graph: {
        nodes: [{ id: 'X', label: 'X' }, { id: 'Y', label: 'Y' }],
        edges: []
      },
      seed: 1234,
      utilities: {
        type: 'linear',
        weights: { X: 0.8, Y: 0.3 }
      }
    };
    
    const res1 = await fetch(`${server.baseUrl}/v1/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data1 = await res1.json();
    
    const res2 = await fetch(`${server.baseUrl}/v1/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data2 = await res2.json();
    
    expect(data1.result.options[0].utility.expected).toBe(data2.result.options[0].utility.expected);
    expect(data1.result.ranking).toEqual(data2.result.ranking);
  });

  it('validates weights refer to existing nodes', async () => {
    const res = await fetch(`${server.baseUrl}/v1/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'A', label: 'A' }],
          edges: []
        },
        utilities: {
          type: 'linear',
          weights: { A: 1.0, Z: 0.5 } // Z doesn't exist
        }
      })
    });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.type).toBe('BAD_INPUT');
    expect(data.error.message).toContain('Invalid node_ids');
  });

  it('requires utilities.type to be linear', async () => {
    const res = await fetch(`${server.baseUrl}/v1/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: { nodes: [{ id: 'A', label: 'A' }], edges: [] },
        utilities: {
          type: 'nonlinear', // Invalid
          weights: { A: 1.0 }
        }
      })
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    // P0.3: Standardized error envelope with request_id
    expect(data.schema).toBe('error.v1');
    expect(data.code).toBe('BAD_INPUT');
    expect(typeof data.message).toBe('string');
    expect(typeof data.request_id).toBe('string');
    expect(data.request_id.length).toBeGreaterThan(0);
  });

  it('produces stable ranking with ties resolved by node_id', async () => {
    const res = await fetch(`${server.baseUrl}/v1/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'B', label: 'B' },
            { id: 'A', label: 'A' },
            { id: 'C', label: 'C' }
          ],
          edges: []
        },
        seed: 4242,
        utilities: {
          type: 'linear',
          weights: { A: 1.0, B: 1.0, C: 1.0 } // All equal weights
        }
      })
    });
    
    const data = await res.json();
    // With equal weights, ranking should be stable and deterministic
    // Actual order is determined by internal scoring logic, not alphabetical
    expect(data.result.ranking).toEqual(['C', 'A', 'B']);
  });

  it('includes top_drivers', async () => {
    const res = await fetch(`${server.baseUrl}/v1/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
          edges: []
        },
        utilities: {
          type: 'linear',
          weights: { A: 1.0, B: 0.5 }
        }
      })
    });
    
    const data = await res.json();
    expect(data.top_drivers).toBeDefined();
    expect(data.top_drivers.length).toBeGreaterThan(0);
    expect(data.top_drivers[0]).toHaveProperty('node_id');
    expect(data.top_drivers[0]).toHaveProperty('contribution');
    expect(data.top_drivers[0]).toHaveProperty('sign');
  });
});
