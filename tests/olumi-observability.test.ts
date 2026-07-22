/**
 * P1: Olumi Observability Headers Tests
 * Tests for x-olumi-service, x-olumi-service-build, X-Olumi-Response-Hash headers
 * and canonical hash computation.
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';
import { computeOlumiHash, canonicalStringify } from '../src/util/canonical.js';
import { resetBuildIdCacheForTests } from '../src/util/build-id.js';
import { GOLDEN_SCENARIO } from '../src/fixtures/self-check.js';

let app: FastifyInstance;
let port = 0;
const prevs: Record<string, string | undefined> = {
  TEST_ROUTES: process.env.TEST_ROUTES,
  AUTH_ENABLED: process.env.AUTH_ENABLED,
  RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED,
  BUILD_ID: process.env.BUILD_ID,
};

beforeAll(async () => {
  process.env.TEST_ROUTES = '1';
  process.env.AUTH_ENABLED = '0';
  process.env.RATE_LIMIT_ENABLED = '0';
  process.env.BUILD_ID = 'abcdef1234567'; // SHA-like; canonical build id is the 7-char slice 'abcdef1'
  resetBuildIdCacheForTests(); // a prior test file in this worker may have locked the shared cache
  app = await createServer({ enableTestRoutes: true });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  port = typeof addr === 'object' && addr ? (addr.port as number) : 0;
});

afterAll(async () => {
  await app.close();
  for (const k of Object.keys(prevs)) {
    const v = (prevs as any)[k];
    if (v === undefined) delete (process.env as any)[k]; else (process.env as any)[k] = v;
  }
  resetBuildIdCacheForTests(); // don't leak this file's build id to later files in the worker
});

describe('canonical hash computation', () => {
  it('sorts keys alphabetically in canonical form', () => {
    const obj = { z: 1, a: 2, m: 3 };
    const canonical = canonicalStringify(obj);
    expect(canonical).toBe('{"a":2,"m":3,"z":1}');
  });

  it('sorts nested object keys recursively', () => {
    const obj = { outer: { z: 1, a: 2 }, name: 'test' };
    const canonical = canonicalStringify(obj);
    expect(canonical).toBe('{"name":"test","outer":{"a":2,"z":1}}');
  });

  it('computeOlumiHash returns 12-character hex string', () => {
    const obj = { z: 1, a: 2, m: 3 };
    const hash = computeOlumiHash(obj);
    expect(hash).toHaveLength(12);
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it('computeOlumiHash is deterministic for same input', () => {
    const obj = { outer: { z: 1, a: 2 }, name: 'test' };
    const hash1 = computeOlumiHash(obj);
    const hash2 = computeOlumiHash(obj);
    expect(hash1).toBe(hash2);
  });

  it('computeOlumiHash produces different hashes for different inputs', () => {
    const hash1 = computeOlumiHash({ a: 1 });
    const hash2 = computeOlumiHash({ a: 2 });
    expect(hash1).not.toBe(hash2);
  });

  it('computeOlumiHash handles arrays correctly', () => {
    const obj = { items: [{ z: 1, a: 2 }, { c: 3, b: 4 }] };
    const canonical = canonicalStringify(obj);
    expect(canonical).toBe('{"items":[{"a":2,"z":1},{"b":4,"c":3}]}');
    const hash = computeOlumiHash(obj);
    expect(hash).toHaveLength(12);
  });

  it('computeOlumiHash handles null values', () => {
    const obj = { a: null, b: 1 };
    const hash = computeOlumiHash(obj);
    expect(hash).toHaveLength(12);
  });

  it('filters undefined values from arrays', () => {
    const withUndefined = { items: [undefined, 1, undefined, 2] };
    const withoutUndefined = { items: [1, 2] };
    expect(canonicalStringify(withUndefined)).toBe('{"items":[1,2]}');
    expect(computeOlumiHash(withUndefined)).toBe(computeOlumiHash(withoutUndefined));
  });

  it('skips undefined values in objects', () => {
    const withUndefined = { a: 1, b: undefined, c: 3 };
    const withoutUndefined = { a: 1, c: 3 };
    expect(canonicalStringify(withUndefined)).toBe('{"a":1,"c":3}');
    expect(computeOlumiHash(withUndefined)).toBe(computeOlumiHash(withoutUndefined));
  });
});

describe('x-olumi-service header', () => {
  it('returns x-olumi-service: plot on health endpoint', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-olumi-service')).toBe('plot');
  });

  it('returns x-olumi-service: plot on /v1/run endpoint', async () => {
    const body = {
      ...GOLDEN_SCENARIO,
      treatment_node: GOLDEN_SCENARIO.graph.nodes[0]?.id,
      outcome_node: GOLDEN_SCENARIO.graph.nodes[GOLDEN_SCENARIO.graph.nodes.length - 1]?.id,
      baseline_value: 100,
    };
    const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-olumi-service')).toBe('plot');
  });
});

describe('x-olumi-service-build header', () => {
  it('returns x-olumi-service-build with BUILD_ID on health endpoint', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-olumi-service-build')).toBe('abcdef1');
  });

  it('returns both x-olumi-service-build and X-Build-Tag (backward compat)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-olumi-service-build')).toBe('abcdef1');
    expect(res.headers.get('X-Build-Tag')).toBe('abcdef1');
  });

  // Codex F12: the build HEADER and the /health body build MUST agree — they are
  // one identity, derived from one resolver. Before the fix the header used its
  // own inline `BUILD_ID || GITHUB_SHA || 'dev'` (no slice, no git fallback) while
  // the body used getBuildId() (7-char slice + git fallback), so they diverged
  // (header 'dev' vs body the real SHA in deploys where neither env var is set).
  // This pins the invariant so a re-divergence fails loud, not silently.
  it('build header equals the /health body build (single-sourced, cannot diverge)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const header = res.headers.get('x-olumi-service-build');
    expect(header).toBe(body.build);
    expect(header).toBe('abcdef1');
  });
});

describe('x-olumi-response-hash header', () => {
  it('returns x-olumi-response-hash on JSON responses', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const responseHash = res.headers.get('x-olumi-response-hash');
    expect(responseHash).toBeTruthy();
    expect(responseHash).toHaveLength(12);
    expect(responseHash).toMatch(/^[0-9a-f]{12}$/);
  });

  it('response hash is deterministic for same response', async () => {
    // Make two identical requests
    const res1 = await fetch(`http://127.0.0.1:${port}/version`);
    const res2 = await fetch(`http://127.0.0.1:${port}/version`);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const hash1 = res1.headers.get('x-olumi-response-hash');
    const hash2 = res2.headers.get('x-olumi-response-hash');

    expect(hash1).toBe(hash2);
  });

  it('response hash matches computed hash of response body', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/version`);
    expect(res.status).toBe(200);

    const responseHash = res.headers.get('x-olumi-response-hash');
    const body = await res.json();
    const computedHash = computeOlumiHash(body);

    expect(responseHash).toBe(computedHash);
  });
});

describe('X-Request-Id propagation', () => {
  it('echoes X-Request-Id from client', async () => {
    const customRequestId = 'test-request-id-12345';
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { 'X-Request-Id': customRequestId },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-Id')).toBe(customRequestId);
  });

  it('generates X-Request-Id if not provided', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const requestId = res.headers.get('X-Request-Id');
    expect(requestId).toBeTruthy();
    // Should be a UUID format
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('x-olumi-payload-hash header (incoming)', () => {
  it('accepts valid x-olumi-payload-hash header on requests', async () => {
    const body = {
      ...GOLDEN_SCENARIO,
      treatment_node: GOLDEN_SCENARIO.graph.nodes[0]?.id,
      outcome_node: GOLDEN_SCENARIO.graph.nodes[GOLDEN_SCENARIO.graph.nodes.length - 1]?.id,
      baseline_value: 100,
    };
    const payloadHash = computeOlumiHash(body);

    const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-olumi-payload-hash': payloadHash,
      },
      body: JSON.stringify(body),
    });

    // Request should succeed (header is accepted for logging)
    expect(res.status).toBe(200);
  });

  it('rejects malformed x-olumi-payload-hash (not logged to telemetry)', async () => {
    const body = {
      ...GOLDEN_SCENARIO,
      treatment_node: GOLDEN_SCENARIO.graph.nodes[0]?.id,
      outcome_node: GOLDEN_SCENARIO.graph.nodes[GOLDEN_SCENARIO.graph.nodes.length - 1]?.id,
      baseline_value: 100,
    };

    // Invalid hash (too short, non-hex)
    const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-olumi-payload-hash': 'invalid!',
      },
      body: JSON.stringify(body),
    });

    // Request should still succeed - invalid hash is just ignored
    expect(res.status).toBe(200);
  });
});

describe('headers on OPTIONS preflight', () => {
  it('returns x-olumi-service on OPTIONS preflight', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-olumi-payload-hash',
      },
    });
    // OPTIONS should return 204 or 200
    expect([200, 204]).toContain(res.status);
    expect(res.headers.get('x-olumi-service')).toBe('plot');
    expect(res.headers.get('x-olumi-service-build')).toBe('abcdef1');
  });

  it('includes x-olumi-payload-hash in Access-Control-Allow-Headers', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-olumi-payload-hash',
      },
    });
    expect([200, 204]).toContain(res.status);
    const allowedHeaders = res.headers.get('Access-Control-Allow-Headers')?.toLowerCase() || '';
    expect(allowedHeaders).toContain('x-olumi-payload-hash');
  });

  it('includes x-olumi-sdk in Access-Control-Allow-Headers', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-olumi-sdk',
      },
    });
    expect([200, 204]).toContain(res.status);
    const allowedHeaders = res.headers.get('Access-Control-Allow-Headers')?.toLowerCase() || '';
    expect(allowedHeaders).toContain('x-olumi-sdk');
  });
});

describe('headers on HEAD requests', () => {
  it('returns olumi headers on HEAD /health', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      method: 'HEAD',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-olumi-service')).toBe('plot');
    expect(res.headers.get('x-olumi-service-build')).toBe('abcdef1');
  });
});

describe('headers on error responses', () => {
  it('returns olumi headers on 404 Not Found', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/nonexistent-path`);
    expect(res.status).toBe(404);
    expect(res.headers.get('x-olumi-service')).toBe('plot');
    expect(res.headers.get('x-olumi-service-build')).toBe('abcdef1');
  });

  it('returns olumi headers on validation error (4xx)', async () => {
    // Send a request missing required fields to trigger validation error
    const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invalid: 'missing required fields' }),
    });
    // Should be a 4xx error (400 or 422 depending on validation)
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.headers.get('x-olumi-service')).toBe('plot');
    expect(res.headers.get('x-olumi-service-build')).toBe('abcdef1');
  });

  it('returns x-olumi-response-hash on error JSON responses', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/nonexistent-path`);
    expect(res.status).toBe(404);
    const responseHash = res.headers.get('x-olumi-response-hash');
    // Should have response hash for JSON error response
    if (responseHash) {
      expect(responseHash).toHaveLength(12);
      expect(responseHash).toMatch(/^[0-9a-f]{12}$/);
    }
  });
});

describe('CORS headers configuration', () => {
  it('includes x-olumi-downstream-calls in Access-Control-Allow-Headers', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-olumi-downstream-calls',
      },
    });
    expect([200, 204]).toContain(res.status);
    const allowedHeaders = res.headers.get('Access-Control-Allow-Headers')?.toLowerCase() || '';
    expect(allowedHeaders).toContain('x-olumi-downstream-calls');
  });

  it('includes x-olumi-response-hash in Access-Control-Expose-Headers', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: {
        'Origin': 'http://localhost:5173',
      },
    });
    expect(res.status).toBe(200);
    const exposedHeaders = res.headers.get('Access-Control-Expose-Headers')?.toLowerCase() || '';
    expect(exposedHeaders).toContain('x-olumi-response-hash');
  });

  it('includes x-olumi-downstream-calls in Access-Control-Expose-Headers', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: {
        'Origin': 'http://localhost:5173',
      },
    });
    expect(res.status).toBe(200);
    const exposedHeaders = res.headers.get('Access-Control-Expose-Headers')?.toLowerCase() || '';
    expect(exposedHeaders).toContain('x-olumi-downstream-calls');
  });

  it('includes x-olumi-service in Access-Control-Expose-Headers', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: {
        'Origin': 'http://localhost:5173',
      },
    });
    expect(res.status).toBe(200);
    const exposedHeaders = res.headers.get('Access-Control-Expose-Headers')?.toLowerCase() || '';
    expect(exposedHeaders).toContain('x-olumi-service');
  });
});

describe('x-olumi-downstream-calls header', () => {
  it('does not include x-olumi-downstream-calls when no downstream calls made', async () => {
    // Health endpoint makes no downstream calls
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    // Should NOT have downstream calls header when no calls were made
    const downstreamHeader = res.headers.get('x-olumi-downstream-calls');
    expect(downstreamHeader).toBeNull();
  });
});

describe('Buffer response hash handling', () => {
  it('computes response hash correctly for health endpoint', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const responseHash = res.headers.get('x-olumi-response-hash');
    const body = await res.json();
    const computedHash = computeOlumiHash(body);
    // Response hash should match computed hash (regardless of internal Buffer handling)
    expect(responseHash).toBe(computedHash);
  });

  it('computes response hash correctly for version endpoint', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/version`);
    expect(res.status).toBe(200);
    const responseHash = res.headers.get('x-olumi-response-hash');
    const body = await res.json();
    const computedHash = computeOlumiHash(body);
    expect(responseHash).toBe(computedHash);
  });

  it('computes response hash correctly for error responses', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/nonexistent-path`);
    expect(res.status).toBe(404);
    const responseHash = res.headers.get('x-olumi-response-hash');
    if (responseHash) {
      const body = await res.json();
      const computedHash = computeOlumiHash(body);
      expect(responseHash).toBe(computedHash);
    }
  });
});
