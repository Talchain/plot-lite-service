import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Constraints - Feasibility & Optimiser Integration', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer(); });
  afterAll(async () => { await server.kill(); });

  const basePayload = {
    graph: {
      nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
      edges: []
    },
    budget: 100,
    actions: [
      { id: 'action1', cost: 30, do: [{ node_id: 'A', set_to: 0.8 }] },
      { id: 'action2', cost: 50, do: [{ node_id: 'B', set_to: 0.6 }] },
      { id: 'action3', cost: 40, do: [{ node_id: 'A', set_to: 0.9 }] }
    ],
    objective: { type: 'utility_linear' as const, weights: { A: 1.0 } },
    seed: 4242
  };

  it('budget constraint enforced', async () => {
    const payload = {
      ...basePayload,
      constraints: {
        must: ['action1', 'action2', 'action3'] // Total cost 120 > budget 100
      }
    };

    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error.code).toBe('INFEASIBLE');
    expect(data.error.violations).toBeDefined();
    expect(data.error.violations.some((v: any) => v.type.includes('BUDGET') || v.type === 'INFEASIBLE')).toBe(true);
  });

  it('must constraint respected', async () => {
    const payload = {
      ...basePayload,
      constraints: {
        must: ['action1']
      }
    };

    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.selected).toContain('action1');
  });

  it('must_not constraint respected', async () => {
    const payload = {
      ...basePayload,
      constraints: {
        must_not: ['action2']
      }
    };

    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.selected).not.toContain('action2');
  });

  it('max_changed_nodes constraint enforced', async () => {
    const payload = {
      ...basePayload,
      actions: [
        { id: 'a1', cost: 10, do: [{ node_id: 'A', set_to: 0.5 }] },
        { id: 'a2', cost: 10, do: [{ node_id: 'B', set_to: 0.5 }] },
        { id: 'a3', cost: 10, do: [{ node_id: 'A', set_to: 0.6 }, { node_id: 'B', set_to: 0.7 }] }
      ],
      constraints: {
        must: ['a1', 'a2', 'a3'],
        max_changed_nodes: 1
      }
    };

    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error.code).toBe('INFEASIBLE');
    expect(data.error.violations.some((v: any) => v.type === 'MAX_CHANGED_NODES_EXCEEDED')).toBe(true);
  });

  it('conflicting must/must_not constraints detected', async () => {
    const payload = {
      ...basePayload,
      constraints: {
        must: ['action1'],
        must_not: ['action1']
      }
    };

    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error.code).toBe('INFEASIBLE');
    expect(data.error.violations.some((v: any) => v.type === 'CONFLICTING_CONSTRAINTS')).toBe(true);
  });

  it('must action not found in action list', async () => {
    const payload = {
      ...basePayload,
      constraints: {
        must: ['nonexistent']
      }
    };

    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error.code).toBe('INFEASIBLE');
    expect(data.error.violations.some((v: any) => v.type === 'MUST_ACTION_NOT_FOUND')).toBe(true);
  });

  it('valid constraints accepted', async () => {
    const payload = {
      ...basePayload,
      constraints: {
        must: ['action1'],
        must_not: ['action3'],
        max_changed_nodes: 5
      }
    };

    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.selected).toContain('action1');
    expect(data.selected).not.toContain('action3');
    expect(data.meta.constraints_applied).toBeDefined();
  });

  it('deterministic ranking preserved under constraints', async () => {
    const payload = {
      ...basePayload,
      constraints: {
        must: ['action1']
      }
    };

    const res1 = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data1 = await res1.json();

    const res2 = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data2 = await res2.json();

    expect(data1.selected).toEqual(data2.selected);
  });

  it('empty constraints work', async () => {
    const payload = {
      ...basePayload,
      constraints: {}
    };

    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.selected).toBeDefined();
  });

  it('no constraints field works (backward compat)', async () => {
    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(basePayload)
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.selected).toBeDefined();
  });

  it('violation includes field paths', async () => {
    const payload = {
      ...basePayload,
      constraints: {
        must: ['nonexistent']
      }
    };

    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(data.error.violations[0]).toHaveProperty('constraint');
    expect(data.error.violations[0].constraint).toBe('must');
  });

  it('multiple constraint types combined', async () => {
    const payload = {
      ...basePayload,
      budget: 80,
      constraints: {
        must: ['action1'],
        must_not: ['action3'],
        max_changed_nodes: 2
      }
    };

    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.selected).toContain('action1');
    expect(data.selected).not.toContain('action3');
  });
});
