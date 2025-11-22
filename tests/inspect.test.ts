import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('POST /v1/inspect', () => {
  let server: ServerHandle;

  beforeAll(async () => {
    server = await spawnServer();
  });

  afterAll(async () => {
    await server.kill();
  });

  it('inspects graph successfully', async () => {
    const res = await fetch(`${server.baseUrl}/v1/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seed: 4242,
        graph: { nodes: [{ id: 'A', label: 'Node A' }], edges: [] }
      })
    });
    
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schema).toBe('inspect.v1');
    expect(data).toHaveProperty('explain');
    expect(data).toHaveProperty('provenance');
    expect(data).toHaveProperty('hashes');
    expect(data.hashes).toHaveProperty('response_hash');
  });

  it('is deterministic with same seed', async () => {
    const payload = {
      seed: 1234,
      graph: { nodes: [{ id: 'X', label: 'X' }], edges: [] }
    };
    
    const res1 = await fetch(`${server.baseUrl}/v1/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data1 = await res1.json();
    
    const res2 = await fetch(`${server.baseUrl}/v1/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data2 = await res2.json();
    
    expect(data1.hashes.response_hash).toBe(data2.hashes.response_hash);
  });

  it('respects x-scm-lite header', async () => {
    const res = await fetch(`${server.baseUrl}/v1/inspect`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-scm-lite': '1'
      },
      body: JSON.stringify({
        graph: { nodes: [{ id: 'A', label: 'A' }], edges: [] }
      })
    });
    
    const data = await res.json();
    expect(data.hashes.bma_hash).toBeTruthy();
    expect(data.explain.flags_on).toContain('scm_lite');
  });
});
