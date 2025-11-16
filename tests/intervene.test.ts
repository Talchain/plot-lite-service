import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('POST /v1/intervene', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer(); });
  afterAll(async () => { await server.kill(); });

  it('performs causal intervention', async () => {
    const res = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'X', label: 'Cause' },
            { id: 'Y', label: 'Effect' }
          ],
          edges: [{ from: 'X', to: 'Y', weight: 0.5 }]
        },
        seed: 4242,
        do: [{ node_id: 'X', value: 1.0 }]
      })
    });
    
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schema).toBe('intervene.v1');
    expect(data.baseline).toBeDefined();
    expect(data.counterfactual).toBeDefined();
    expect(data.delta).toBeDefined();
    expect(data.explain.provenance).toBe('do-operator');
    expect(data.model_card.seed).toBe(4242);
  });

  it('is deterministic with same seed', async () => {
    const payload = {
      graph: {
        nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
        edges: [{ from: 'A', to: 'B', weight: 0.3 }]
      },
      seed: 1234,
      do: [{ node_id: 'A', value: 0.8 }]
    };
    
    const res1 = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data1 = await res1.json();
    
    const res2 = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data2 = await res2.json();
    
    expect(data1.baseline.summary.p50).toBe(data2.baseline.summary.p50);
    expect(data1.counterfactual.summary.p50).toBe(data2.counterfactual.summary.p50);
    expect(data1.delta.p50).toBe(data2.delta.p50);
  });

  it('validates do interventions refer to existing nodes', async () => {
    const res = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'A', label: 'A' }],
          edges: []
        },
        do: [{ node_id: 'Z', value: 1.0 }] // Z doesn't exist
      })
    });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.type).toBe('BAD_INPUT');
    expect(data.error.message).toContain('Invalid node_ids');
  });

  it('requires at least one intervention', async () => {
    const res = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'A', label: 'A' }],
          edges: []
        },
        do: [] // Empty
      })
    });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.type).toBe('BAD_INPUT');
  });

  it('handles multiple interventions', async () => {
    const res = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'X1', label: 'X1' },
            { id: 'X2', label: 'X2' },
            { id: 'Y', label: 'Y' }
          ],
          edges: []
        },
        do: [
          { node_id: 'X1', value: 1.0 },
          { node_id: 'X2', value: 0.5 }
        ]
      })
    });
    
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schema).toBe('intervene.v1');
    expect(data.explain.top_drivers).toBeDefined();
  });

  it('includes top_drivers', async () => {
    const res = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
          edges: []
        },
        do: [{ node_id: 'A', value: 1.0 }]
      })
    });
    
    const data = await res.json();
    expect(data.explain.top_drivers).toBeDefined();
    expect(data.explain.top_drivers.length).toBeGreaterThan(0);
    expect(data.explain.top_drivers[0]).toHaveProperty('node_id');
    expect(data.explain.top_drivers[0]).toHaveProperty('contribution');
    expect(data.explain.top_drivers[0]).toHaveProperty('sign');
  });
});
