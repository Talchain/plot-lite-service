/**
 * P0 regression: auth bypass via percent-encoded route prefix.
 *
 * Both auth guards historically self-filtered on the RAW `req.url`
 * (`req.url.startsWith('/vN/')`). Fastify routes on the DECODED path, so a
 * percent-encoded prefix such as `/%762/run` (raw does NOT match `/v2/`) made
 * the guard early-return (skip auth) while the router still dispatched to
 * `/v2/run` → full UNAUTHENTICATED compute. Verified live on staging.
 *
 * Fix: gate on `req.routeOptions?.url` (the MATCHED ROUTE PATTERN), which is
 * `/v2/run` for both `/v2/run` and `/%762/run`, and `undefined` for a genuine
 * 404. These tests FAIL on the raw-url guard and PASS after the fix.
 *
 * Uses a REAL listening socket + raw TCP writes (curl --path-as-is equivalent)
 * so the percent-encoding reaches the server unchanged — no client-side URL
 * normalization can mask the bypass.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'node:net';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

const validToken = 'test-token-encoding-guard-12345';

let app: FastifyInstance;
let port: number;

// Send an EXACT request line over a raw socket (no client URL normalization).
function rawRequest(
  requestLine: string,
  opts: { body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: string }> {
  const body = opts.body ?? '';
  const headers: Record<string, string> = {
    Host: '127.0.0.1',
    Connection: 'close',
    ...(opts.headers ?? {}),
  };
  if (body) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
    headers['Content-Length'] = String(Buffer.byteLength(body));
  }
  const headerLines = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\r\n');

  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(`${requestLine} HTTP/1.1\r\n${headerLines}\r\n\r\n${body}`);
    });
    let data = '';
    sock.setTimeout(10000, () => {
      sock.destroy();
      reject(new Error(`raw request timed out: ${requestLine}`));
    });
    sock.on('data', (c) => {
      data += c.toString();
    });
    sock.on('end', () => {
      const m = data.match(/^HTTP\/1\.1 (\d+)/);
      const idx = data.indexOf('\r\n\r\n');
      resolve({
        status: m ? Number(m[1]) : -1,
        body: idx >= 0 ? data.slice(idx + 4) : '',
      });
    });
    sock.on('error', reject);
  });
}

const validGraphV1 = {
  nodes: [
    { id: 'a', label: 'A', type: 'decision' },
    { id: 'b', label: 'B', type: 'outcome' },
  ],
  edges: [{ from: 'a', to: 'b' }],
};

beforeAll(async () => {
  process.env.AUTH_ENABLED = '1';
  process.env.AUTH_V2_ENABLED = '1'; // widen the Bearer gate to /v2/*
  process.env.AUTH_TOKEN = validToken;
  process.env.RATE_LIMIT_ENABLED = '0'; // avoid 429 flakiness under rapid raw requests

  app = await createServer({ enableTestRoutes: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
});

afterAll(async () => {
  await app.close();
  delete process.env.AUTH_ENABLED;
  delete process.env.AUTH_V2_ENABLED;
  delete process.env.AUTH_TOKEN;
  delete process.env.RATE_LIMIT_ENABLED;
});

describe('P0: percent-encoded route-prefix auth bypass is closed', () => {
  // --- Encoded-bypass vectors: MUST be rejected at the guard (401), not reach the handler ---
  describe('encoded prefixes are auth-gated (RED before fix)', () => {
    it('POST /%762/run (decodes to /v2/run) no-token → 401', async () => {
      const r = await rawRequest('POST /%762/run', { body: '{}' });
      expect(r.status).toBe(401);
    });

    it('POST /v%32/run (decodes to /v2/run) no-token → 401', async () => {
      const r = await rawRequest('POST /v%32/run', { body: '{}' });
      expect(r.status).toBe(401);
    });

    it('POST /%761/optimise (decodes to /v1/optimise) no-token → 401 (was FULL UNAUTH COMPUTE)', async () => {
      const r = await rawRequest('POST /%761/optimise', {
        body: JSON.stringify({ graph: validGraphV1, seed: 42 }),
      });
      expect(r.status).toBe(401);
    });

    it('POST /%761/validate (decodes to /v1/validate) no-token → 401', async () => {
      const r = await rawRequest('POST /%761/validate', {
        body: JSON.stringify({ graph: validGraphV1 }),
      });
      expect(r.status).toBe(401);
    });
  });

  // --- Positive controls: literal-path behavior must be preserved ---
  describe('literal paths still behave correctly (guard preserved)', () => {
    it('POST /v2/run no-token → 401', async () => {
      const r = await rawRequest('POST /v2/run', { body: '{}' });
      expect(r.status).toBe(401);
    });

    it('POST /v2/run correct-token → NOT 401/403 (reaches handler)', async () => {
      const r = await rawRequest('POST /v2/run', {
        body: '{}',
        headers: { Authorization: `Bearer ${validToken}` },
      });
      expect([401, 403]).not.toContain(r.status);
    });

    it('POST /v1/optimise correct-token → NOT 401/403 (reaches handler)', async () => {
      const r = await rawRequest('POST /v1/optimise', {
        body: JSON.stringify({ graph: validGraphV1, seed: 42 }),
        headers: { Authorization: `Bearer ${validToken}` },
      });
      expect([401, 403]).not.toContain(r.status);
    });

    it('POST /v1/optimise no-token → 401', async () => {
      const r = await rawRequest('POST /v1/optimise', {
        body: JSON.stringify({ graph: validGraphV1, seed: 42 }),
      });
      expect(r.status).toBe(401);
    });

    it('GET /v1/templates (public read-only) still skips auth → NOT 401/403', async () => {
      const r = await rawRequest('GET /v1/templates');
      expect([401, 403]).not.toContain(r.status);
    });

    it('OPTIONS /v2/run preflight still skips auth → NOT 401/403', async () => {
      const r = await rawRequest('OPTIONS /v2/run', {
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
        },
      });
      expect([401, 403]).not.toContain(r.status);
    });

    it('POST /nope (genuine 404) is NOT auth-gated into a 401 → 404', async () => {
      const r = await rawRequest('POST /nope', { body: '{}' });
      expect(r.status).toBe(404);
    });
  });
});
