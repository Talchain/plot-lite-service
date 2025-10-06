/**
 * Auth Guard on /v1/* Routes Tests
 * 
 * Verifies that all v1 endpoints are protected when AUTH_ENABLED=1
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('Auth Guard on /v1/* Routes', () => {
  let app: FastifyInstance;
  let port: number;
  const validToken = 'test-token-12345';

  beforeAll(async () => {
    // Enable auth for these tests
    process.env.AUTH_ENABLED = '1';
    process.env.AUTH_TOKEN = validToken;
    process.env.TEST_ROUTES = '1'; // Enable self-check route

    app = await createServer({ enableTestRoutes: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterAll(async () => {
    await app.close();
    delete process.env.AUTH_ENABLED;
    delete process.env.AUTH_TOKEN;
    delete process.env.TEST_ROUTES;
  });

  const v1Endpoints = [
    { method: 'GET', path: '/v1/health' },
    { method: 'GET', path: '/v1/version' },
    { method: 'POST', path: '/v1/run' },
    { method: 'POST', path: '/v1/counterfactual' },
    { method: 'POST', path: '/v1/critique' },
    { method: 'POST', path: '/v1/draft' },
    { method: 'GET', path: '/v1/self-check' },
  ];

  describe('Missing auth token', () => {
    for (const endpoint of v1Endpoints) {
      it(`${endpoint.method} ${endpoint.path} returns 401 without token`, async () => {
        const res = await fetch(`http://127.0.0.1:${port}${endpoint.path}`, {
          method: endpoint.method,
          headers: { 'Content-Type': 'application/json' },
          body: endpoint.method === 'POST' ? JSON.stringify({ graph: { nodes: [], edges: [] } }) : undefined,
        });

        expect(res.status).toBe(401);
        expect(res.headers.get('www-authenticate')).toBe('Bearer');
        
        const data = await res.json();
        expect(data.code).toBe('UNAUTHORIZED');
        expect(data.message).toContain('Missing bearer token');
      });
    }
  });

  describe('Invalid auth token', () => {
    for (const endpoint of v1Endpoints) {
      it(`${endpoint.method} ${endpoint.path} returns 403 with wrong token`, async () => {
        const res = await fetch(`http://127.0.0.1:${port}${endpoint.path}`, {
          method: endpoint.method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer wrong-token',
          },
          body: endpoint.method === 'POST' ? JSON.stringify({ graph: { nodes: [], edges: [] } }) : undefined,
        });

        expect(res.status).toBe(403);
        
        const data = await res.json();
        expect(data.code).toBe('FORBIDDEN');
        expect(data.message).toContain('Invalid token');
      });
    }
  });

  describe('Valid auth token', () => {
    it('POST /v1/run accepts valid token', async () => {
      const validGraph = {
        nodes: [
          { id: 'a', label: 'A', type: 'decision' },
          { id: 'b', label: 'B', type: 'outcome' },
        ],
        edges: [{ from: 'a', to: 'b' }],
      };

      const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${validToken}`,
        },
        body: JSON.stringify({ graph: validGraph, seed: 42 }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.schema).toBe('run.v1');
    });

    it('GET /v1/health accepts valid token', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/health`, {
        headers: {
          'Authorization': `Bearer ${validToken}`,
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('ok');
    });

    it('GET /v1/self-check accepts valid token', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/self-check`, {
        headers: {
          'Authorization': `Bearer ${validToken}`,
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.schema).toBe('self_check.v1');
    });
  });

  describe('Case-insensitive header support', () => {
    it('accepts "authorization" (lowercase)', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/health`, {
        headers: {
          'authorization': `Bearer ${validToken}`,
        },
      });

      expect(res.status).toBe(200);
    });

    it('accepts "Authorization" (capitalized)', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/health`, {
        headers: {
          'Authorization': `Bearer ${validToken}`,
        },
      });

      expect(res.status).toBe(200);
    });
  });
});

describe('Auth Guard disabled (AUTH_ENABLED=0 or unset)', () => {
  let app: FastifyInstance;
  let port: number;

  beforeAll(async () => {
    // Ensure auth is disabled
    delete process.env.AUTH_ENABLED;
    delete process.env.AUTH_TOKEN;

    app = await createServer({ enableTestRoutes: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /v1/run works without auth when disabled', async () => {
    const validGraph = {
      nodes: [
        { id: 'a', label: 'A', type: 'decision' },
        { id: 'b', label: 'B', type: 'outcome' },
      ],
      edges: [{ from: 'a', to: 'b' }],
    };

    const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: validGraph, seed: 42 }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schema).toBe('run.v1');
  });

  it('GET /v1/health works without auth when disabled', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/health`);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });
});
