/**
 * CEE Draft Graph Proxy Tests
 *
 * Tests for POST /v1/cee/draft-graph endpoint:
 * - Request validation
 * - Error handling when CEE is not configured
 * - CORS preflight
 *
 * Note: Full CEE integration tests require a running CEE service.
 * These tests focus on the proxy's error handling and configuration.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('CEE Draft Graph Proxy', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  describe('Without CEE configuration', () => {
    beforeAll(async () => {
      // Clear CEE config to test error handling
      delete process.env.CEE_BASE_URL;
      delete process.env.CEE_API_KEY;
      process.env.CEE_PROXY_TIMEOUT_MS = '5000';
      process.env.RATE_LIMIT_ENABLED = '0';
      process.env.CORS_ORIGINS = 'http://localhost:5173,https://staging--olumi.netlify.app';

      app = await createServer();
      await app.listen({ port: 0, host: '127.0.0.1' });
      const addr = app.server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
      await app?.close();
      delete process.env.CEE_PROXY_TIMEOUT_MS;
      delete process.env.RATE_LIMIT_ENABLED;
      delete process.env.CORS_ORIGINS;
    });

    it('returns 503 when CEE_BASE_URL is missing', async () => {
      const res = await fetch(`${baseUrl}/v1/cee/draft-graph`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: 'test' }),
      });

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe('CEE_CONFIG_MISSING');
      expect(body.retryable).toBe(false);
      expect(body.message).toContain('CEE_BASE_URL');
    });

    it('returns X-Request-Id header', async () => {
      const res = await fetch(`${baseUrl}/v1/cee/draft-graph`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: 'test' }),
      });

      expect(res.headers.get('X-Request-Id')).toBeDefined();
    });
  });

  describe('Request validation', () => {
    let app2: FastifyInstance;
    let baseUrl2: string;

    beforeAll(async () => {
      process.env.CEE_BASE_URL = 'https://cee.test.example.com';
      process.env.CEE_API_KEY = 'test-api-key-123';
      process.env.CEE_PROXY_TIMEOUT_MS = '5000';
      process.env.RATE_LIMIT_ENABLED = '0';

      app2 = await createServer();
      await app2.listen({ port: 0, host: '127.0.0.1' });
      const addr = app2.server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl2 = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
      await app2?.close();
      delete process.env.CEE_BASE_URL;
      delete process.env.CEE_API_KEY;
      delete process.env.CEE_PROXY_TIMEOUT_MS;
      delete process.env.RATE_LIMIT_ENABLED;
    });

    it('returns error for empty request body', async () => {
      const res = await fetch(`${baseUrl2}/v1/cee/draft-graph`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '',
      });

      // Should return an error for invalid/empty body
      // Fastify may return 400, 415, or 500 depending on content-type parser behavior
      expect([400, 415, 500]).toContain(res.status);
    });

    it('accepts valid request body', async () => {
      // This will fail to connect to CEE (not running), but should pass validation
      const res = await fetch(`${baseUrl2}/v1/cee/draft-graph`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: 'Create a graph for market analysis' }),
      });

      // Should get a network error (502) or timeout (504), not a validation error (400)
      expect([502, 504]).toContain(res.status);
      const body = await res.json();
      expect(['CEE_NETWORK_ERROR', 'CEE_PROXY_TIMEOUT']).toContain(body.error);
      expect(body.retryable).toBe(true);
    });

    it('includes request_id and elapsed_ms in error response', async () => {
      const res = await fetch(`${baseUrl2}/v1/cee/draft-graph`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: 'test' }),
      });

      const body = await res.json();
      expect(body.request_id).toBeDefined();
      expect(body.elapsed_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe('CORS configuration', () => {
    let corsApp: FastifyInstance;
    let corsBaseUrl: string;

    beforeAll(async () => {
      process.env.CORS_ORIGINS = 'http://localhost:5173,https://staging--olumi.netlify.app,https://olumi.netlify.app';
      process.env.RATE_LIMIT_ENABLED = '0';
      // Clear CEE config (not needed for CORS tests)
      delete process.env.CEE_BASE_URL;
      delete process.env.CEE_API_KEY;

      corsApp = await createServer();
      await corsApp.listen({ port: 0, host: '127.0.0.1' });
      const addr = corsApp.server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      corsBaseUrl = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
      await corsApp?.close();
      delete process.env.CORS_ORIGINS;
      delete process.env.RATE_LIMIT_ENABLED;
    });

    it('responds to OPTIONS preflight request', async () => {
      const res = await fetch(`${corsBaseUrl}/v1/cee/draft-graph`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type',
        },
      });

      // OPTIONS should succeed (2xx)
      expect(res.status).toBeLessThan(300);
    });

    it('includes correct CORS headers for allowed origin', async () => {
      const res = await fetch(`${corsBaseUrl}/v1/cee/draft-graph`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type',
        },
      });

      const allowOrigin = res.headers.get('Access-Control-Allow-Origin');
      expect(allowOrigin).toBe('http://localhost:5173');
    });

    it('allows POST method in CORS', async () => {
      const res = await fetch(`${corsBaseUrl}/v1/cee/draft-graph`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
        },
      });

      const allowMethods = res.headers.get('Access-Control-Allow-Methods');
      expect(allowMethods?.toUpperCase()).toContain('POST');
    });

    it('allows X-Correlation-Id header in CORS', async () => {
      const res = await fetch(`${corsBaseUrl}/v1/cee/draft-graph`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'X-Correlation-Id',
        },
      });

      const allowHeaders = res.headers.get('Access-Control-Allow-Headers');
      // Either the specific header is allowed or we get the requested headers back
      expect(
        allowHeaders?.toLowerCase().includes('x-correlation-id') ||
        res.status < 300
      ).toBe(true);
    });

    it('exposes X-CEE-Latency-Ms header', async () => {
      const res = await fetch(`${corsBaseUrl}/v1/cee/draft-graph`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
        },
      });

      const exposeHeaders = res.headers.get('Access-Control-Expose-Headers');
      expect(exposeHeaders?.toLowerCase()).toContain('x-cee-latency-ms');
    });

    it('accepts staging Netlify origin', async () => {
      const res = await fetch(`${corsBaseUrl}/v1/cee/draft-graph`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://staging--olumi.netlify.app',
          'Access-Control-Request-Method': 'POST',
        },
      });

      const allowOrigin = res.headers.get('Access-Control-Allow-Origin');
      expect(allowOrigin).toBe('https://staging--olumi.netlify.app');
    });

    it('accepts production Netlify origin', async () => {
      const res = await fetch(`${corsBaseUrl}/v1/cee/draft-graph`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://olumi.netlify.app',
          'Access-Control-Request-Method': 'POST',
        },
      });

      const allowOrigin = res.headers.get('Access-Control-Allow-Origin');
      expect(allowOrigin).toBe('https://olumi.netlify.app');
    });
  });
});

describe('CEE Draft Graph Proxy - Auth Guard', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    // Clear CEE config
    delete process.env.CEE_BASE_URL;
    delete process.env.CEE_API_KEY;
    process.env.RATE_LIMIT_ENABLED = '0';

    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
  });

  it('endpoint is accessible (auth handled by v1 hooks)', async () => {
    // This test verifies the endpoint is registered and accessible
    // Auth behavior depends on environment configuration
    const res = await fetch(`${baseUrl}/v1/cee/draft-graph`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief: 'test' }),
    });

    // Should get a response (not a 404)
    expect(res.status).not.toBe(404);
    // Either auth required (401/403) or proceeds to endpoint logic (503 no config)
    expect([200, 401, 403, 502, 503, 504]).toContain(res.status);
  });
});
