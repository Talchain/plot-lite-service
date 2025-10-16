import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';

describe('Contract Tests vs OpenAPI (G1)', () => {
  let app: any;

  beforeAll(async () => {
    app = await createServer({ enableTestRoutes: false });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('POST /v1/run returns required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: {
        seed: 4242,
        graph: {
          nodes: [{ id: 'A', label: 'A' }],
          edges: []
        },
        outcome_node: 'A'
      }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    
    expect(body).toHaveProperty('model_card');
    expect(body.model_card).toHaveProperty('response_hash');
    expect(body.model_card).toHaveProperty('seed');
    expect(body.model_card.seed).toBe(4242);
  });

  it('GET /v1/health returns required fields', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    
    expect(body).toHaveProperty('status');
    expect(body.status).toBe('ok');
    expect(body).toHaveProperty('engine_p95_ms');
  });

  it('GET /version returns api and flags', async () => {
    const res = await app.inject({ method: 'GET', url: '/version' });
    
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    
    expect(body).toHaveProperty('api');
    expect(body).toHaveProperty('flags');
    expect(typeof body.flags).toBe('object');
  });

  it('determinism: 3x identical response_hash', async () => {
    const payload = {
      seed: 4242,
      graph: {
        nodes: [{ id: 'X', label: 'X' }],
        edges: []
      },
      outcome_node: 'X'
    };

    const hashes = new Set();
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: 'POST', url: '/v1/run', payload });
      const body = JSON.parse(res.body);
      hashes.add(body.model_card.response_hash);
    }

    expect(hashes.size).toBe(1);
  });

  it('rejects oversized provenance_note (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: {
        seed: 4242,
        graph: { nodes: [{ id: 'A', label: 'A' }], edges: [] },
        outcome_node: 'A',
        provenance_note: 'x'.repeat(201)
      }
    });

    expect(res.statusCode).toBe(400);
  });
});
