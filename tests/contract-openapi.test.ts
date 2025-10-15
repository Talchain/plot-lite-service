import { describe, it, expect } from 'vitest';
import { createServer } from '../src/createServer.js';

describe('Contract Testing vs OpenAPI (D2)', () => {
  it('/v1/run returns model_card', async () => {
    const app = await createServer({ enableTestRoutes: false });
    
    const res = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: {
        seed: 4242,
        graph: { nodes: [{ id: "A", label: "A" }], edges: [] },
        outcome_node: "A"
      }
    });
    
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.model_card).toBeDefined();
    expect(body.model_card.response_hash).toBeDefined();
    
    await app.close();
  });

  it('rejects oversized provenance_note', async () => {
    const app = await createServer({ enableTestRoutes: false });
    
    const res = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: {
        seed: 4242,
        graph: { nodes: [{ id: "A", label: "A" }], edges: [] },
        outcome_node: "A",
        provenance_note: "x".repeat(201)
      }
    });
    
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('/v1/health shape stable', async () => {
    const app = await createServer({ enableTestRoutes: false });
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    const body = JSON.parse(res.body);
    
    expect(body.status).toBe('ok');
    expect(typeof body.engine_p95_ms).toBe('number');
    
    await app.close();
  });

  it('/version includes flags', async () => {
    const app = await createServer({ enableTestRoutes: false });
    const res = await app.inject({ method: 'GET', url: '/version' });
    const body = JSON.parse(res.body);
    
    expect(body.flags).toBeDefined();
    expect(body.flags.SCM_LITE_ENABLE).toBeDefined();
    
    await app.close();
  });

  it('determinism: 3 runs yield identical hash', async () => {
    const app = await createServer({ enableTestRoutes: false });
    const hashes = new Set();
    
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/run',
        payload: {
          seed: 4242,
          graph: { nodes: [{ id: "A", label: "A" }], edges: [] },
          outcome_node: "A"
        }
      });
      const body = JSON.parse(res.body);
      hashes.add(body.model_card.response_hash);
    }
    
    expect(hashes.size).toBe(1);
    await app.close();
  });
});
