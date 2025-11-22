import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('POST /v1/optimise', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer(); });
  afterAll(async () => { await server.kill(); });

  it('selects actions within budget', async () => {
    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: { nodes: [{ id: 'A', label: 'A' }], edges: [] },
        budget: 10.0,
        actions: [
          { id: 'doA', cost: 4.0, do: [{ node_id: 'A', set_to: 1 }] },
          { id: 'doB', cost: 7.0, do: [{ node_id: 'A', set_to: 2 }] }
        ],
        objective: { type: 'utility_linear', weights: { A: 1.0 } }
      })
    });
    
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schema).toBe('optimise.v1');
    expect(data.selected).toBeDefined();
    expect(Array.isArray(data.selected)).toBe(true);
    expect(data.utility).toBeDefined();
    expect(data.meta.solver).toBe('greedy_kernel_v1');
  });

  it('validates budget', async () => {
    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: { nodes: [], edges: [] },
        actions: []
      })
    });
    
    expect(res.status).toBe(400);
  });

  it('rejects duplicate action ids', async () => {
    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: { nodes: [], edges: [] },
        budget: 10,
        actions: [
          { id: 'dup', cost: 1, do: [] },
          { id: 'dup', cost: 2, do: [] }
        ],
        objective: { type: 'utility_linear', weights: {} }
      })
    });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.message).toContain('Duplicate');
  });

  it('rejects negative costs', async () => {
    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: { nodes: [], edges: [] },
        budget: 10,
        actions: [{ id: 'bad', cost: -5, do: [] }],
        objective: { type: 'utility_linear', weights: {} }
      })
    });
    
    expect(res.status).toBe(400);
  });
});
