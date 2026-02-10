/**
 * BFF CEE Proxy — Timeout + Instrumentation Tests
 *
 * Unit tests for the BFF proxy route POST /v1/cee/draft-graph:
 *   - Proxy timeout fires at configured threshold → typed 504 JSON error
 *   - CEE 504 JSON response is passed through without wrapping
 *   - CEE 422 JSON response is passed through without wrapping
 *   - CEE non-JSON error (HTML) is wrapped in a generic BFF error
 *   - CEE 200 response is forwarded correctly (no regression)
 *   - Timing log events are emitted with correct fields
 *
 * Uses short env-var timeout override (200ms) and globalThis.fetch mocking.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { Writable } from 'node:stream';

// Mock the timeout module to use a short timeout for tests
vi.mock('../src/config/timeouts.js', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    CEE_PROXY_TIMEOUT_MS: 200, // 200ms for fast tests
  };
});

import { registerCeeDraftGraphRoute } from '../src/routes/v1/cee-draft-graph.js';

describe('BFF CEE Proxy — Timeout + Instrumentation', () => {
  let app: FastifyInstance;
  const logLines: any[] = [];
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    process.env.CEE_BASE_URL = 'https://cee.test.example.com';
    process.env.CEE_API_KEY = 'test-key';

    const logStream = new Writable({
      write(chunk, _encoding, callback) {
        try {
          logLines.push(JSON.parse(chunk.toString()));
        } catch { /* ignore non-JSON lines */ }
        callback();
      },
    });

    app = Fastify({
      logger: { level: 'info', stream: logStream },
    });
    await registerCeeDraftGraphRoute(app);
    await app.ready();
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await app?.close();
    delete process.env.CEE_BASE_URL;
    delete process.env.CEE_API_KEY;
  });

  beforeEach(() => {
    logLines.length = 0;
    globalThis.fetch = originalFetch;
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 1. Proxy timeout fires at configured threshold → typed 504 JSON error
  // ────────────────────────────────────────────────────────────────────────────
  it('proxy timeout fires at configured threshold and returns typed 504 JSON error', async () => {
    // Mock fetch to hang until aborted (respects AbortSignal)
    globalThis.fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const onAbort = () => {
          const err = new DOMException('The operation was aborted.', 'AbortError');
          reject(err);
        };
        if (init?.signal?.aborted) {
          onAbort();
          return;
        }
        init?.signal?.addEventListener('abort', onAbort);
      });
    }) as typeof fetch;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/cee/draft-graph',
      payload: { brief: 'test' },
    });

    expect(res.statusCode).toBe(504);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe('CEE_PROXY_TIMEOUT');
    expect(body.message).toContain('did not respond');
    expect(body.retryable).toBe(true);
    expect(body.elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(body.request_id).toBeDefined();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 2. CEE 504 JSON response is passed through without wrapping
  // ────────────────────────────────────────────────────────────────────────────
  it('CEE 504 JSON response is passed through without wrapping', async () => {
    const ceeResponse = {
      error: 'CEE_LLM_TIMEOUT',
      message: 'LLM call timed out after 90s',
      retryable: true,
    };

    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 504,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ceeResponse,
      text: async () => JSON.stringify(ceeResponse),
    })) as unknown as typeof fetch;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/cee/draft-graph',
      payload: { brief: 'test' },
    });

    expect(res.statusCode).toBe(504);
    const body = JSON.parse(res.payload);
    // Must be the exact CEE response — no wrapping
    expect(body).toEqual(ceeResponse);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 3. CEE 422 JSON response is passed through without wrapping
  // ────────────────────────────────────────────────────────────────────────────
  it('CEE 422 JSON response is passed through without wrapping', async () => {
    const ceeResponse = {
      error: 'VALIDATION_ERROR',
      message: 'brief is required',
      retryable: false,
      details: { field: 'brief' },
    };

    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 422,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ceeResponse,
      text: async () => JSON.stringify(ceeResponse),
    })) as unknown as typeof fetch;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/cee/draft-graph',
      payload: { brief: 'test' },
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.payload);
    expect(body).toEqual(ceeResponse);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 4. CEE non-JSON error (HTML) is wrapped in a generic BFF error
  // ────────────────────────────────────────────────────────────────────────────
  it('CEE non-JSON error (HTML) is wrapped in a generic BFF error', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 502,
      headers: new Headers({ 'content-type': 'text/html' }),
      json: async () => { throw new Error('not json'); },
      text: async () => '<html><body>Bad Gateway</body></html>',
    })) as unknown as typeof fetch;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/cee/draft-graph',
      payload: { brief: 'test' },
    });

    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe('CEE_UPSTREAM_ERROR');
    expect(body.message).toContain('non-JSON');
    expect(body.retryable).toBe(true);
    expect(body.elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(body.request_id).toBeDefined();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 5. CEE 200 response is forwarded correctly (no regression)
  // ────────────────────────────────────────────────────────────────────────────
  it('CEE 200 response is forwarded correctly', async () => {
    const ceeData = {
      graph: { nodes: ['A', 'B'], edges: [{ from: 'A', to: 'B' }] },
      engine_version: '2.1',
    };

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ceeData,
      text: async () => JSON.stringify(ceeData),
    })) as unknown as typeof fetch;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/cee/draft-graph',
      payload: { brief: 'test' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toEqual(ceeData);

    // Should include timing headers
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-cee-latency-ms']).toBeDefined();
    expect(Number(res.headers['x-cee-latency-ms'])).toBeGreaterThanOrEqual(0);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 6. Timing log events are emitted with correct fields
  // ────────────────────────────────────────────────────────────────────────────
  it('timing log events are emitted with correct fields on success', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ graph: {} }),
      text: async () => '{"graph":{}}',
    })) as unknown as typeof fetch;

    await app.inject({
      method: 'POST',
      url: '/v1/cee/draft-graph',
      payload: { brief: 'test' },
    });

    // bff.cee_proxy.request
    const requestLog = logLines.find(l => l.evt === 'bff.cee_proxy.request');
    expect(requestLog).toBeDefined();
    expect(requestLog.cee_url).toContain('/assist/v1/draft-graph');
    expect(requestLog.timeout_ms).toBe(200);
    expect(requestLog.request_id).toBeDefined();

    // bff.cee_proxy.response
    const responseLog = logLines.find(l => l.evt === 'bff.cee_proxy.response');
    expect(responseLog).toBeDefined();
    expect(responseLog.status).toBe(200);
    expect(responseLog.cee_elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(responseLog.bff_total_elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(responseLog.request_id).toBeDefined();
  });

  it('timeout log event is emitted with correct fields', async () => {
    globalThis.fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const onAbort = () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        };
        if (init?.signal?.aborted) { onAbort(); return; }
        init?.signal?.addEventListener('abort', onAbort);
      });
    }) as typeof fetch;

    await app.inject({
      method: 'POST',
      url: '/v1/cee/draft-graph',
      payload: { brief: 'test' },
    });

    // bff.cee_proxy.timeout
    const timeoutLog = logLines.find(l => l.evt === 'bff.cee_proxy.timeout');
    expect(timeoutLog).toBeDefined();
    expect(timeoutLog.timeout_ms).toBe(200);
    expect(timeoutLog.elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(timeoutLog.request_id).toBeDefined();
  });

  it('error log event is emitted for non-JSON CEE error', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      headers: new Headers({ 'content-type': 'text/html' }),
      json: async () => { throw new Error('not json'); },
      text: async () => '<html>Service Unavailable</html>',
    })) as unknown as typeof fetch;

    await app.inject({
      method: 'POST',
      url: '/v1/cee/draft-graph',
      payload: { brief: 'test' },
    });

    // bff.cee_proxy.error
    const errorLog = logLines.find(l => l.evt === 'bff.cee_proxy.error');
    expect(errorLog).toBeDefined();
    expect(errorLog.error_code).toBe('CEE_HTTP_503');
    expect(errorLog.error_message).toContain('non-JSON');
    expect(errorLog.elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(errorLog.request_id).toBeDefined();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 7. JSON body with wrong content-type is still passed through
  // ────────────────────────────────────────────────────────────────────────────
  it('CEE JSON error with wrong content-type is still passed through', async () => {
    const ceeResponse = {
      error: 'CEE_LLM_TIMEOUT',
      message: 'LLM call timed out',
      retryable: true,
    };

    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 504,
      headers: new Headers({ 'content-type': 'text/plain' }),
      json: async () => { throw new Error('not json'); },
      text: async () => JSON.stringify(ceeResponse),
    })) as unknown as typeof fetch;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/cee/draft-graph',
      payload: { brief: 'test' },
    });

    expect(res.statusCode).toBe(504);
    const body = JSON.parse(res.payload);
    // Should passthrough the CEE response, not wrap it
    expect(body).toEqual(ceeResponse);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 8. Startup config log
  // ────────────────────────────────────────────────────────────────────────────
  it('logs bff.config.cee_proxy_timeout at startup', async () => {
    // The startup log was emitted during beforeAll — capture logs from a
    // separate Fastify instance so we can verify the event without pollution.
    const startupLogs: any[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        try { startupLogs.push(JSON.parse(chunk.toString())); } catch {}
        cb();
      },
    });
    const tempApp = Fastify({ logger: { level: 'info', stream } });
    await registerCeeDraftGraphRoute(tempApp);
    await tempApp.ready();

    const configLog = startupLogs.find(l => l.evt === 'bff.config.cee_proxy_timeout');
    expect(configLog).toBeDefined();
    expect(configLog.timeout_ms).toBe(200);

    await tempApp.close();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 8. CEE 429 rate-limit JSON response is passed through
  // ────────────────────────────────────────────────────────────────────────────
  it('CEE 429 rate-limit JSON response is passed through', async () => {
    const ceeResponse = {
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests',
      retryable: true,
      retry_after_ms: 5000,
    };

    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 429,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ceeResponse,
      text: async () => JSON.stringify(ceeResponse),
    })) as unknown as typeof fetch;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/cee/draft-graph',
      payload: { brief: 'test' },
    });

    expect(res.statusCode).toBe(429);
    const body = JSON.parse(res.payload);
    expect(body).toEqual(ceeResponse);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 9. CEE 500 internal error JSON is passed through
  // ────────────────────────────────────────────────────────────────────────────
  it('CEE 500 internal error JSON is passed through', async () => {
    const ceeResponse = {
      error: 'INTERNAL_ERROR',
      message: 'Unexpected server error',
      retryable: true,
    };

    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ceeResponse,
      text: async () => JSON.stringify(ceeResponse),
    })) as unknown as typeof fetch;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/cee/draft-graph',
      payload: { brief: 'test' },
    });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.payload);
    expect(body).toEqual(ceeResponse);
  });
});
