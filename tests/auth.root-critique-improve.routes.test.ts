/**
 * Auth Guard on root POST /critique and POST /improve
 *
 * These two root-mounted compute routes previously ran UNAUTHENTICATED. After
 * the R-8 auth flip they were the only compute routes still publicly reachable.
 * This suite pins that they are now front-gated by the same conditional authGuard
 * that protects /draft-flows and /v1/*:
 *   - AUTH_ENABLED unset  → guard allows (auth-off callers unchanged)
 *   - AUTH_ENABLED=1, no token    → 401 (WWW-Authenticate: Bearer, code UNAUTHORIZED)
 *   - AUTH_ENABLED=1, wrong token → 403 (code FORBIDDEN)
 *   - AUTH_ENABLED=1, correct token → reaches the handler (behaviour byte-preserved)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

const validFlow = {
  nodes: [
    { id: 'n1', type: 'decision', label: 'Adjust price', baseline: 99 },
    { id: 'n2', type: 'outcome', label: 'Revenue', baseline: 100000 },
  ],
  edges: [{ id: 'e1', from: 'n1', to: 'n2', weight: 0.4, belief: 0.7 }],
  comments: [],
  metadata: { thresholds: [99] },
};

describe('Auth Guard on root /critique + /improve (AUTH_ENABLED=1)', () => {
  let app: FastifyInstance;
  let port: number;
  const validToken = 'root-compute-token-12345';

  beforeAll(async () => {
    process.env.AUTH_ENABLED = '1';
    process.env.PLOT_AUTH_TOKEN = validToken;
    // 64-hex secret so secret-validation / token rate-limiting stay satisfied.
    process.env.TOKEN_HMAC_SECRET = 'a'.repeat(64);

    app = await createServer({ enableTestRoutes: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterAll(async () => {
    await app.close();
    delete process.env.AUTH_ENABLED;
    delete process.env.PLOT_AUTH_TOKEN;
    delete process.env.TOKEN_HMAC_SECRET;
  });

  const routes = ['/critique', '/improve'] as const;

  describe('Missing auth token → 401', () => {
    for (const path of routes) {
      it(`POST ${path} returns 401 without token`, async () => {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parse_json: validFlow }),
        });
        expect(res.status).toBe(401);
        expect(res.headers.get('www-authenticate')).toBe('Bearer');
        const data = await res.json();
        expect(data.schema).toBe('error.v1');
        expect(data.code).toBe('UNAUTHORIZED');
        expect(data.message).toContain('Missing bearer token');
      });
    }
  });

  describe('Invalid auth token → 403', () => {
    for (const path of routes) {
      it(`POST ${path} returns 403 with wrong token`, async () => {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer wrong-token',
          },
          body: JSON.stringify({ parse_json: validFlow }),
        });
        expect(res.status).toBe(403);
        const data = await res.json();
        expect(data.schema).toBe('error.v1');
        expect(data.code).toBe('FORBIDDEN');
        expect(data.message).toContain('Invalid token');
      });
    }
  });

  describe('Valid auth token → reaches handler (behaviour preserved)', () => {
    it('POST /critique accepts valid token and runs the critique', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/critique`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${validToken}`,
        },
        body: JSON.stringify({ parse_json: validFlow }),
      });
      expect(res.status).toBe(200);
      const arr = await res.json();
      expect(Array.isArray(arr)).toBe(true);
      expect(arr.length).toBeGreaterThanOrEqual(2);
    });

    it('POST /critique with valid token but no parse_json reaches handler (400 BAD_INPUT, not 401/403)', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/critique`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${validToken}`,
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error?.type).toBe('BAD_INPUT');
    });

    it('POST /improve accepts valid token and echoes parse_json', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/improve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${validToken}`,
        },
        body: JSON.stringify({ parse_json: { nodes: [], edges: [] } }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ parse_json: { nodes: [], edges: [] }, fix_applied: [] });
    });
  });
});

describe('Auth Guard disabled (AUTH_ENABLED unset) — root /critique + /improve unchanged', () => {
  let app: FastifyInstance;
  let port: number;

  beforeAll(async () => {
    delete process.env.AUTH_ENABLED;
    delete process.env.PLOT_AUTH_TOKEN;

    app = await createServer({ enableTestRoutes: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /critique works without any token when auth disabled', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/critique`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parse_json: validFlow }),
    });
    expect(res.status).toBe(200);
    const arr = await res.json();
    expect(Array.isArray(arr)).toBe(true);
  });

  it('POST /improve works without any token when auth disabled', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/improve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parse_json: { nodes: [], edges: [] } }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ parse_json: { nodes: [], edges: [] }, fix_applied: [] });
  });
});
