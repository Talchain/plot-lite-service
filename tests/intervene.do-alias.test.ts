import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('POST /v1/intervene - legacy do[] alias', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer(); });
  afterAll(async () => { await server.kill(); });

  it('accepts legacy do[] with set_to', async () => {
    const res = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'A', label: 'A' },
            { id: 'B', label: 'B' }
          ],
          edges: [{ from: 'A', to: 'B', weight: 0.5 }]
        },
        do: [{ node_id: 'A', set_to: 0.8 }],
        seed: 4242
      })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schema).toBe('intervene.v1');
    expect(data.baseline).toBeDefined();
    expect(data.counterfactual).toBeDefined();
    expect(data.delta).toBeDefined();
  });

  it('accepts legacy do[] with value', async () => {
    const res = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'X', label: 'X' }],
          edges: []
        },
        do: [{ node_id: 'X', value: 0.9 }],
        seed: 4242
      })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schema).toBe('intervene.v1');
  });

  it('prefers actions[] over do[] when both present', async () => {
    const res = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'A', label: 'A' }],
          edges: []
        },
        actions: [{ node_id: 'A', value: 0.7 }],
        do: [{ node_id: 'A', set_to: 0.9 }],
        seed: 4242
      })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schema).toBe('intervene.v1');
    // Should use actions[], not do[]
  });

  it('rejects when neither actions[] nor do[] provided', async () => {
    const res = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'A', label: 'A' }],
          edges: []
        },
        seed: 4242
      })
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.message).toContain('actions');
  });
});
