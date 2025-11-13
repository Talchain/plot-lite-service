import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('POST /v1/run_batch', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer(); });
  afterAll(async () => { await server.kill(); });

  it('processes batch of items', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run_batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          {
            graph: {
              nodes: [{ id: 'A', label: 'A' }],
              edges: []
            },
            seed: 1
          },
          {
            graph: {
              nodes: [{ id: 'B', label: 'B' }],
              edges: []
            },
            seed: 2
          }
        ]
      })
    });
    
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schema).toBe('run_batch.v1');
    expect(data.results).toBeDefined();
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results.length).toBe(2);
    
    // Each result should have response_hash and model_card
    for (const result of data.results) {
      expect(result.response_hash).toBeDefined();
      expect(result.model_card).toBeDefined();
      expect(result.model_card.schema).toBe('report.v1');
    }
  });

  it('is deterministic per item', async () => {
    const payload = {
      items: [
        {
          graph: {
            nodes: [{ id: 'X', label: 'X' }],
            edges: []
          },
          seed: 1234
        }
      ]
    };
    
    const res1 = await fetch(`${server.baseUrl}/v1/run_batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data1 = await res1.json();
    
    const res2 = await fetch(`${server.baseUrl}/v1/run_batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data2 = await res2.json();
    
    expect(data1.results[0].response_hash).toBe(data2.results[0].response_hash);
  });

  it('enforces batch size limit', async () => {
    const items = Array.from({ length: 11 }, (_, i) => ({
      graph: {
        nodes: [{ id: `N${i}`, label: `Node ${i}` }],
        edges: []
      }
    }));
    
    const res = await fetch(`${server.baseUrl}/v1/run_batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items })
    });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.type).toBe('BAD_INPUT');
    expect(data.error.message).toContain('Batch size exceeds limit');
  });

  it('enforces per-item node limit', async () => {
    const nodes = Array.from({ length: 51 }, (_, i) => ({
      id: `N${i}`,
      label: `Node ${i}`
    }));
    
    const res = await fetch(`${server.baseUrl}/v1/run_batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          {
            graph: { nodes, edges: [] }
          }
        ]
      })
    });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.type).toBe('BAD_INPUT');
    expect(data.error.message).toContain('nodes exceed limit');
  });

  it('enforces per-item edge limit', async () => {
    const edges = Array.from({ length: 101 }, (_, i) => ({
      from: 'A',
      to: 'B'
    }));
    
    const res = await fetch(`${server.baseUrl}/v1/run_batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          {
            graph: {
              nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
              edges
            }
          }
        ]
      })
    });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.type).toBe('BAD_INPUT');
    expect(data.error.message).toContain('edges exceed limit');
  });

  it('validates item structure', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run_batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          { graph: { nodes: [] } } // Missing edges
        ]
      })
    });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.type).toBe('BAD_INPUT');
  });

  it('requires non-empty items array', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run_batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: []
      })
    });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.type).toBe('BAD_INPUT');
    expect(data.error.message).toContain('must not be empty');
  });

  it('uses default seed per item if not provided', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run_batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          {
            graph: {
              nodes: [{ id: 'A', label: 'A' }],
              edges: []
            }
            // No seed provided
          }
        ]
      })
    });
    
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results[0].model_card.seed).toBeDefined();
  });
});
