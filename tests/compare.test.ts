import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('POST /v1/compare', () => {
  let server: ServerHandle;

  beforeAll(async () => {
    server = await spawnServer();
  });

  afterAll(async () => {
    await server.kill();
  });

  it('compares 2 options successfully', async () => {
    const res = await fetch(`${server.baseUrl}/v1/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seed: 4242,
        graphs: [
          { graph: { nodes: [{ id: 'A', label: 'Option A' }], edges: [] }, label: 'A' },
          { graph: { nodes: [{ id: 'B', label: 'Option B' }], edges: [] }, label: 'B' }
        ]
      })
    });
    
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schema).toBe('compare.v1');
    expect(data.baseline).toBe('A');
    expect(data.options).toHaveLength(2);
    expect(data.options[0]).toHaveProperty('p10');
    expect(data.options[0]).toHaveProperty('p50');
    expect(data.options[0]).toHaveProperty('p90');
  });

  it('rejects < 2 graphs', async () => {
    const res = await fetch(`${server.baseUrl}/v1/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graphs: [{ graph: { nodes: [], edges: [] }, label: 'A' }]
      })
    });
    expect(res.status).toBe(400);
  });

  it('error envelope includes schema, code, message, and request_id', async () => {
    const res = await fetch(`${server.baseUrl}/v1/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graphs: [] // Empty graphs array triggers BAD_INPUT
      })
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    // P0.3: Standardized error envelope
    expect(data.schema).toBe('error.v1');
    expect(data.code).toBe('BAD_INPUT');
    expect(typeof data.message).toBe('string');
    expect(typeof data.request_id).toBe('string');
    expect(data.request_id.length).toBeGreaterThan(0);
  });

  it('is deterministic with same seed', async () => {
    const payload = {
      seed: 1234,
      graphs: [
        { graph: { nodes: [{ id: 'X', label: 'X' }], edges: [] }, label: 'X' },
        { graph: { nodes: [{ id: 'Y', label: 'Y' }], edges: [] }, label: 'Y' }
      ]
    };
    
    const res1 = await fetch(`${server.baseUrl}/v1/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data1 = await res1.json();
    
    const res2 = await fetch(`${server.baseUrl}/v1/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data2 = await res2.json();
    
    expect(data1.options[0].p50).toBe(data2.options[0].p50);
  });
});
