import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('Auth integration (AUTH_ENABLED=1)', () => {
  let app: FastifyInstance;
  const originalAuthEnabled = process.env.AUTH_ENABLED;
  const originalAuthToken = process.env.AUTH_TOKEN;

  beforeAll(async () => {
    // Enable auth for this test suite
    process.env.AUTH_ENABLED = '1';
    process.env.AUTH_TOKEN = 'test-token-12345';
    
    app = await createServer({ enableTestRoutes: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    // Restore original env
    if (originalAuthEnabled !== undefined) {
      process.env.AUTH_ENABLED = originalAuthEnabled;
    } else {
      delete process.env.AUTH_ENABLED;
    }
    if (originalAuthToken !== undefined) {
      process.env.AUTH_TOKEN = originalAuthToken;
    } else {
      delete process.env.AUTH_TOKEN;
    }
  });

  it('POST /v1/run without Authorization header → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/run',
      headers: {
        'Content-Type': 'application/json',
      },
      payload: {
        graph: {
          nodes: [{ id: 'A', label: 'A' }],
          edges: [],
        },
        outcome_node: 'A',
        seed: 42,
      },
    });

    expect(res.statusCode).toBe(401);
    const json = res.json();
    expect(json.code).toBe('UNAUTHORIZED');
    expect(json.message).toContain('bearer token');
  });

  it('POST /v1/run with invalid Authorization header → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/run',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer wrong-token',
      },
      payload: {
        graph: {
          nodes: [{ id: 'A', label: 'A' }],
          edges: [],
        },
        outcome_node: 'A',
        seed: 42,
      },
    });

    expect(res.statusCode).toBe(403);
    const json = res.json();
    expect(json.code).toBe('FORBIDDEN');
  });

  it('POST /v1/run with valid Authorization header → 200', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/run',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token-12345',
      },
      payload: {
        graph: {
          nodes: [
            { id: 'Price', label: 'Price' },
            { id: 'Revenue', label: 'Revenue' },
          ],
          edges: [
            { from: 'Price', to: 'Revenue', weight: 0.8, belief: 0.9 },
          ],
        },
        outcome_node: 'Revenue',
        seed: 42,
      },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.schema).toBe('run.v1');
    expect(json.results).toBeDefined();
    expect(json.model_card).toBeDefined();
  });

  it('GET /v1/health is not protected by auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/health',
    });

    // Health endpoint should always be accessible
    expect(res.statusCode).toBe(200);
  });

  it('GET /version is not protected by auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/version',
    });

    // Version endpoint should always be accessible
    expect(res.statusCode).toBe(200);
  });
});
