import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('POST /v1/run with node effects', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer(); });
  afterAll(async () => { await server.kill(); });

  it('accepts graph without effects (backwards compatible)', async () => {
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

  it('accepts linear effect (explicit)', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'A', label: 'A', effect: { kind: 'linear' } }
          ],
          edges: []
        },
        seed: 4242
      })
    });
    
    expect(res.status).toBe(200);
  });

  it('accepts threshold effect', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            {
              id: 'A',
              label: 'A',
              effect: {
                kind: 'threshold',
                params: { threshold: 0.6, low: 0.0, high: 1.0 }
              }
            }
          ],
          edges: []
        },
        seed: 4242
      })
    });
    
    expect(res.status).toBe(200);
  });

  it('accepts piecewise_linear effect', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            {
              id: 'A',
              label: 'A',
              effect: {
                kind: 'piecewise_linear',
                params: {
                  breakpoints: [
                    { x: 0.0, y: 0.0 },
                    { x: 0.5, y: 0.8 },
                    { x: 1.0, y: 1.0 }
                  ]
                }
              }
            }
          ],
          edges: []
        },
        seed: 4242
      })
    });
    
    expect(res.status).toBe(200);
  });

  it('rejects invalid effect kind', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'A', label: 'A', effect: { kind: 'invalid' } }
          ],
          edges: []
        }
      })
    });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.type).toBe('BAD_INPUT');
    expect(data.error.message).toContain('Invalid effect');
  });

  it('rejects malformed threshold effect', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            {
              id: 'A',
              label: 'A',
              effect: { kind: 'threshold' } // Missing params
            }
          ],
          edges: []
        }
      })
    });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.type).toBe('BAD_INPUT');
  });

  it('rejects malformed piecewise_linear effect', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            {
              id: 'A',
              label: 'A',
              effect: {
                kind: 'piecewise_linear',
                params: { breakpoints: [{ x: 0, y: 0 }] } // Only 1 point
              }
            }
          ],
          edges: []
        }
      })
    });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.type).toBe('BAD_INPUT');
  });

  it('deterministic with effects', async () => {
    const payload = {
      graph: {
        nodes: [
          {
            id: 'X',
            label: 'X',
            effect: {
              kind: 'threshold',
              params: { threshold: 0.5, low: 0.0, high: 1.0 }
            }
          }
        ],
        edges: []
      },
      seed: 1234
    };
    
    const res1 = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data1 = await res1.json();
    
    const res2 = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data2 = await res2.json();
    
    expect(data1.result.response_hash).toBe(data2.result.response_hash);
  });
});
