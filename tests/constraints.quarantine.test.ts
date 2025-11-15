import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Constraints on /v1/run', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer(); });
  afterAll(async () => { await server.kill(); });

  it('accepts request without constraints', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
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
    
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schema).toBe('run.v1');
  });

  it('rejects bounds violation (min)', async () => {
    const payload = {
      graph: {
        nodes: [{ id: 'X', label: 'X', value: 0.5 }],
        edges: []
      },
      constraints: {
        bounds: { X: { min: 1.0 } }
      }
    };
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await res.json();
    if (res.status !== 400) {
      console.log('Expected 400, got:', res.status);
      console.log('Payload:', JSON.stringify(payload, null, 2));
      console.log('Response:', JSON.stringify(data, null, 2));
    }
    expect(res.status).toBe(400);
    expect(data.error.type).toBe('BAD_INPUT');
    expect(data.error.message).toContain('violates min bound');
  });

  it('rejects bounds violation (max)', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'Y', label: 'Y', value: 2.0 }],
          edges: []
        },
        constraints: {
          bounds: { Y: { max: 1.0 } }
        }
      })
    });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.type).toBe('BAD_INPUT');
    expect(data.error.message).toContain('violates max bound');
  });

  it('rejects forbidden edge', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
          edges: [{ from: 'A', to: 'B', weight: 0.5 }]
        },
        constraints: {
          structure: {
            forbid_edges: [['A', 'B']]
          }
        }
      })
    });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.type).toBe('BAD_INPUT');
    expect(data.error.message).toContain('Forbidden edge present');
  });

  it('accepts graph with allowed edges', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
          edges: [{ from: 'A', to: 'B', weight: 0.5 }]
        },
        constraints: {
          structure: {
            forbid_edges: [['B', 'A']] // Different edge
          }
        }
      })
    });
    
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schema).toBe('run.v1');
  });

  it('rejects bounds on non-existent node', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'A', label: 'A' }],
          edges: []
        },
        constraints: {
          bounds: { Z: { min: 0, max: 1 } } // Z doesn't exist
        }
      })
    });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.type).toBe('BAD_INPUT');
    expect(data.error.message).toContain('non-existent node');
  });

  it('accepts valid bounds', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'X', label: 'X', value: 0.5 }],
          edges: []
        },
        constraints: {
          bounds: { X: { min: 0, max: 1 } }
        }
      })
    });
    
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schema).toBe('run.v1');
  });
});
