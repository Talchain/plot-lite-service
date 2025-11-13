import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Audit Surface', () => {
  let server: ServerHandle;

  beforeAll(async () => { 
    // Spawn with TEST_ROUTES=1 to enable audit endpoint
    server = await spawnServer({ env: { TEST_ROUTES: '1' } }); 
  });
  afterAll(async () => { await server.kill(); });

  it('exposes /__audit__/recent when TEST_ROUTES=1', async () => {
    const res = await fetch(`${server.baseUrl}/__audit__/recent`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schema).toBe('audit.v1');
    expect(data.events).toBeDefined();
    expect(data.stats).toBeDefined();
    expect(Array.isArray(data.events)).toBe(true);
  });

  it('records audit events with hashes only (no payloads)', async () => {
    // Make a request to score endpoint
    await fetch(`${server.baseUrl}/v1/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'A', label: 'A' }],
          edges: []
        },
        utilities: {
          type: 'linear',
          weights: { A: 1.0 }
        }
      })
    });
    
    // Check audit log
    const res = await fetch(`${server.baseUrl}/__audit__/recent`);
    const data = await res.json();
    
    const scoreEvents = data.events.filter((e: any) => e.route === '/v1/score');
    expect(scoreEvents.length).toBeGreaterThan(0);
    
    const event = scoreEvents[scoreEvents.length - 1];
    expect(event.evt).toBe('score');
    expect(event.route).toBe('/v1/score');
    expect(event.id).toBeDefined();
    expect(event.response_hash).toBeDefined();
    expect(event.status).toBe(200);
    expect(event.ts).toBeDefined();
    
    // Ensure no payload bodies are present
    expect(event).not.toHaveProperty('graph');
    expect(event).not.toHaveProperty('utilities');
    expect(event).not.toHaveProperty('result');
  });

  it('includes seed and inference_mode in audit', async () => {
    await fetch(`${server.baseUrl}/v1/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'X', label: 'X' }],
          edges: []
        },
        seed: 9999,
        utilities: {
          type: 'linear',
          weights: { X: 0.5 }
        }
      })
    });
    
    const res = await fetch(`${server.baseUrl}/__audit__/recent`);
    const data = await res.json();
    
    const scoreEvents = data.events.filter((e: any) => e.route === '/v1/score');
    const event = scoreEvents[scoreEvents.length - 1];
    
    expect(event.seed).toBe(9999);
    expect(event.inference_mode).toBe('model_based');
  });

  it('provides audit stats', async () => {
    const res = await fetch(`${server.baseUrl}/__audit__/recent`);
    const data = await res.json();
    
    expect(data.stats).toBeDefined();
    expect(data.stats.total_entries).toBeGreaterThanOrEqual(0);
    expect(data.stats.max_entries).toBe(100);
  });

  it('respects limit parameter', async () => {
    const res = await fetch(`${server.baseUrl}/__audit__/recent?limit=5`);
    const data = await res.json();
    
    expect(data.events.length).toBeLessThanOrEqual(5);
  });
});
