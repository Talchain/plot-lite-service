import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Inference modes', () => {
  let server: ServerHandle;
  const g = { 
    nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }], 
    edges: [{ from: 'A', to: 'B', weight: 1 }] 
  };

  beforeAll(async () => { server = await spawnServer({ env: { RATE_LIMIT_ENABLED: '0' } }); });
  afterAll(async () => { await server.kill(); });

  it('defaults to model_based', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: g })
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.meta.inference_mode).toBe('model_based');
  });

  it('accepts model_of_inference', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: g, inference_mode: 'model_of_inference' })
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.meta.inference_mode).toBe('model_of_inference');
  });

  it('rejects invalid mode', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: g, inference_mode: 'bad' })
    });
    expect(res.status).toBe(400);
  });
});
