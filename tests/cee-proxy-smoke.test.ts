/**
 * CEE Proxy — Behavioural Smoke Tests
 *
 * Covers:
 *   1. Route availability: all CEE proxy routes return JSON, not 404
 *   2. Structured JSON on CEE config missing (503)
 *   3. Body passthrough: unknown fields survive roundtrip
 *   4. Response field passthrough: CEE JSON forwarded as-is (error + success)
 *   5. Abort taxonomy: UpstreamTimeoutError + timeoutPhase, ClientDisconnectError, network error
 *   6. Header forwarding, query string passthrough, input validation
 *   7. Full-app route availability: draft-graph, graph-readiness, /v2/run all reachable
 *
 * Uses Fastify + app.inject() with globalThis.fetch mocking (fast, in-process).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// Mock timeouts to use short values for fast tests
vi.mock('../src/config/timeouts.ts', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    CEE_PROXY_TIMEOUT_MS: 200,
    CEE_PROXY_GRAPH_READINESS_TIMEOUT_MS: 200,
    CEE_PROXY_SENSITIVITY_COACH_TIMEOUT_MS: 200,
    CEE_PROXY_PROMPTS_WARM_TIMEOUT_MS: 200,
  };
});

import { registerCeeProxyRoutes } from '../src/routes/v1/cee-proxy.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock fetch that returns a successful JSON response */
function mockFetchSuccess(data: unknown) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify(data),
    json: async () => data,
  })) as unknown as typeof fetch;
}

/** Create a mock fetch that returns an error JSON response (single-consume) */
function mockFetchError(status: number, data: unknown) {
  return vi.fn(async () => {
    let consumed = false;
    return {
      ok: false,
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => {
        if (consumed) throw new Error('Body already consumed');
        consumed = true;
        return JSON.stringify(data);
      },
      json: async () => {
        if (consumed) throw new Error('Body already consumed');
        consumed = true;
        return data;
      },
    };
  }) as unknown as typeof fetch;
}

/** Create a mock fetch that returns a non-JSON error response */
function mockFetchNonJson(status: number, body: string, contentType = 'text/html') {
  return vi.fn(async () => ({
    ok: false,
    status,
    headers: new Headers({ 'content-type': contentType }),
    text: async () => body,
    json: async () => { throw new Error('not json'); },
  })) as unknown as typeof fetch;
}

/** Create a mock fetch that hangs until aborted (respects AbortSignal) */
function mockFetchHang() {
  return vi.fn((_url: string | URL | Request, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const onAbort = () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      };
      if (init?.signal?.aborted) {
        onAbort();
        return;
      }
      init?.signal?.addEventListener('abort', onAbort);
    });
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// Unit tests — individual route registration
// ---------------------------------------------------------------------------

describe('CEE Proxy — Behavioural Smoke Tests', () => {
  let app: FastifyInstance;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    process.env.CEE_BASE_URL = 'https://cee.test.example.com';
    process.env.CEE_API_KEY = 'test-key';

    app = Fastify({ logger: false });
    await registerCeeProxyRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await app?.close();
    delete process.env.CEE_BASE_URL;
    delete process.env.CEE_API_KEY;
  });

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  // =========================================================================
  // 1. Route availability — all proxy routes return JSON, not 404
  // =========================================================================
  describe('route availability', () => {
    const routes = [
      '/v1/cee/graph-readiness',
      '/v1/cee/sensitivity-coach',
      '/v1/cee/prompts/warm',
    ];

    for (const route of routes) {
      it(`POST ${route} returns JSON, not 404`, async () => {
        globalThis.fetch = mockFetchSuccess({ status: 'ok' });

        const res = await app.inject({
          method: 'POST',
          url: route,
          payload: { test: true },
        });

        expect(res.statusCode).not.toBe(404);
        const body = JSON.parse(res.payload);
        expect(body).toBeDefined();
      });
    }
  });

  // =========================================================================
  // 1b. RETIRED route — ROADMAP 2.632 (S-1, the bias real-graph seam design §5.3)
  //
  // `/v1/cee/bias-check` was a live, registered, graph-carrying pass-through to
  // CEE `/assist/v1/bias-check` with ZERO non-test callers anywhere in the estate
  // (re-derived at UI `d18ac8b9`: `grep -a "\.biasCheck("` over `src/` excluding
  // tests → no matches; org-wide code search for the route path → PLoT + docs only).
  // It bypassed the decision-review contract gate entirely, so it was also the one
  // route on which an ungrounded bias finding could reach a caller. Retired rather
  // than left dormant: "a live, registered, graph-carrying, ungrounded route with
  // no caller is a loaded gun in the drawer."
  //
  // POSITIVE CONTROL for this absence assertion: the `route availability` block
  // above proves, on the SAME app instance with the SAME injector and the SAME
  // fetch mock, that a route which IS registered does not 404. Without it, this
  // test would pass on any app that failed to register anything at all.
  // =========================================================================
  describe('retired routes', () => {
    it('POST /v1/cee/bias-check is NOT registered (404) — the ungrounded proxy is retired', async () => {
      globalThis.fetch = mockFetchSuccess({ status: 'ok' });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/cee/bias-check',
        payload: { graph: { nodes: [], edges: [] } },
      });

      expect(res.statusCode).toBe(404);
    });

    it('the retired route never reaches CEE — fetch is not called at all', async () => {
      const spy = mockFetchSuccess({ status: 'ok' });
      globalThis.fetch = spy;

      await app.inject({
        method: 'POST',
        url: '/v1/cee/bias-check',
        payload: { graph: { nodes: [], edges: [] } },
      });

      expect(spy).toHaveBeenCalledTimes(0);
    });
  });

  // =========================================================================
  // 2. Structured JSON on CEE config missing (503)
  // =========================================================================
  describe('CEE config missing → 503', () => {
    it('returns 503 with CEE_CONFIG_MISSING when CEE_BASE_URL unset', async () => {
      const saved = process.env.CEE_BASE_URL;
      delete process.env.CEE_BASE_URL;

      const res = await app.inject({
        method: 'POST',
        url: '/v1/cee/graph-readiness',
        payload: { graph: {} },
      });

      process.env.CEE_BASE_URL = saved;

      expect(res.statusCode).toBe(503);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('CEE_CONFIG_MISSING');
      expect(body.retryable).toBe(false);
      expect(body.request_id).toBeDefined();
    });

    it('returns 503 with CEE_CONFIG_MISSING when CEE_API_KEY unset', async () => {
      const saved = process.env.CEE_API_KEY;
      delete process.env.CEE_API_KEY;

      const res = await app.inject({
        method: 'POST',
        url: '/v1/cee/prompts/warm',
        payload: { prompt_id: 'test' },
      });

      process.env.CEE_API_KEY = saved;

      expect(res.statusCode).toBe(503);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('CEE_CONFIG_MISSING');
      expect(body.request_id).toBeDefined();
    });
  });

  // =========================================================================
  // 3. Body passthrough — unknown fields survive roundtrip
  // =========================================================================
  describe('body passthrough', () => {
    it('POST /v1/cee/graph-readiness forwards body as-is to CEE', async () => {
      const sentBody = { graph: { nodes: [] }, extra_field: 'preserved', nested: { deep: true } };
      let capturedBody: string | undefined;

      globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        capturedBody = init?.body as string;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => '{"readiness":"ready"}',
          json: async () => ({ readiness: 'ready' }),
        };
      }) as unknown as typeof fetch;

      await app.inject({
        method: 'POST',
        url: '/v1/cee/graph-readiness',
        payload: sentBody,
      });

      expect(capturedBody).toBeDefined();
      const parsed = JSON.parse(capturedBody!);
      expect(parsed.extra_field).toBe('preserved');
      expect(parsed.nested.deep).toBe(true);
    });

    it('POST /v1/cee/prompts/warm forwards body as-is to CEE', async () => {
      const sentBody = { prompt_id: 'abc', options: { temperature: 0.7 } };
      let capturedBody: string | undefined;

      globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        capturedBody = init?.body as string;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => '{"warmed":true}',
          json: async () => ({ warmed: true }),
        };
      }) as unknown as typeof fetch;

      await app.inject({
        method: 'POST',
        url: '/v1/cee/prompts/warm',
        payload: sentBody,
      });

      expect(capturedBody).toBeDefined();
      const parsed = JSON.parse(capturedBody!);
      expect(parsed.prompt_id).toBe('abc');
      expect(parsed.options.temperature).toBe(0.7);
    });
  });

  // =========================================================================
  // 4. Response field passthrough — CEE JSON forwarded as-is (error + success)
  // =========================================================================
  describe('response field passthrough', () => {
    it('CEE 200 response fields are forwarded as-is', async () => {
      const ceeData = {
        readiness: 'ready',
        schema_version: 'v3',
        trace: { engine: { model: 'cee-v2' } },
        custom_field: [1, 2, 3],
      };
      globalThis.fetch = mockFetchSuccess(ceeData);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/cee/graph-readiness',
        payload: { graph: {} },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toEqual(ceeData);
    });

    it('CEE 422 JSON error is forwarded as-is (not wrapped)', async () => {
      const ceeError = {
        error: 'GRAPH_INVALID',
        message: 'Graph has cycles',
        retryable: false,
        details: { field: 'edges' },
      };
      globalThis.fetch = mockFetchError(422, ceeError);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/cee/graph-readiness',
        payload: { graph: {} },
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.payload);
      // Must be the exact CEE response — no wrapping
      expect(body).toEqual(ceeError);
    });

    it('CEE 500 JSON error is forwarded as-is (not wrapped)', async () => {
      const ceeError = {
        error: 'INTERNAL_ERROR',
        message: 'Unexpected server error',
        retryable: true,
      };
      globalThis.fetch = mockFetchError(500, ceeError);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/cee/prompts/warm',
        payload: { prompt_id: 'test' },
      });

      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.payload);
      expect(body).toEqual(ceeError);
    });

    it('CEE 429 JSON is forwarded as-is with all fields', async () => {
      const ceeError = {
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests',
        retryable: true,
        retry_after_ms: 5000,
      };
      globalThis.fetch = mockFetchError(429, ceeError);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/cee/graph-readiness',
        payload: { graph: {} },
      });

      expect(res.statusCode).toBe(429);
      const body = JSON.parse(res.payload);
      expect(body).toEqual(ceeError);
    });

    it('non-JSON CEE error is wrapped in BFF envelope with diagnostics', async () => {
      const htmlBody = '<html><body>Bad Gateway</body></html>';
      globalThis.fetch = mockFetchNonJson(502, htmlBody);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/cee/graph-readiness',
        payload: { graph: {} },
      });

      expect(res.statusCode).toBe(502);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('CEE_UPSTREAM_ERROR');
      expect(body.message).toContain('non-JSON');
      expect(body.upstream_content_type).toBe('text/html');
      expect(body.upstream_body_preview).toBe(htmlBody);
      expect(body.request_id).toBeDefined();
    });
  });

  // =========================================================================
  // 5. Abort taxonomy — UpstreamTimeoutError + timeoutPhase
  // =========================================================================
  describe('abort taxonomy', () => {
    it('provider timeout → UpstreamTimeoutError with timeoutPhase "body"', async () => {
      globalThis.fetch = mockFetchHang();

      const res = await app.inject({
        method: 'POST',
        url: '/v1/cee/graph-readiness',
        payload: { graph: {} },
      });

      expect(res.statusCode).toBe(504);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('UpstreamTimeoutError');
      expect(body.timeoutPhase).toBe('body');
      expect(body.timeout_ms).toBe(200);
      expect(body.retryable).toBe(true);
      expect(body.elapsed_ms).toBeGreaterThanOrEqual(0);
      expect(body.request_id).toBeDefined();
    });

    it('provider timeout on prompts/warm → UpstreamTimeoutError', async () => {
      globalThis.fetch = mockFetchHang();

      const res = await app.inject({
        method: 'POST',
        url: '/v1/cee/prompts/warm',
        payload: { prompt_id: 'test' },
      });

      expect(res.statusCode).toBe(504);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('UpstreamTimeoutError');
      expect(body.timeoutPhase).toBe('body');
    });

    it('pre-aborted signal → UpstreamTimeoutError with timeoutPhase "pre_aborted"', async () => {
      // Mock fetch that immediately rejects with AbortError (signal already aborted)
      globalThis.fetch = vi.fn(async () => {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }) as unknown as typeof fetch;

      const res = await app.inject({
        method: 'POST',
        url: '/v1/cee/graph-readiness',
        payload: { graph: {} },
      });

      expect(res.statusCode).toBe(504);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('UpstreamTimeoutError');
      expect(body.timeoutPhase).toBe('pre_aborted');
      expect(body.request_id).toBeDefined();
    });

    it('network error → CEE_NETWORK_ERROR with 502', async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch;

      const res = await app.inject({
        method: 'POST',
        url: '/v1/cee/graph-readiness',
        payload: { graph: {} },
      });

      expect(res.statusCode).toBe(502);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('CEE_NETWORK_ERROR');
      expect(body.message).toContain('ECONNREFUSED');
      expect(body.retryable).toBe(true);
      expect(body.request_id).toBeDefined();
    });

    it('network error on prompts/warm → CEE_NETWORK_ERROR', async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error('ETIMEDOUT');
      }) as unknown as typeof fetch;

      const res = await app.inject({
        method: 'POST',
        url: '/v1/cee/prompts/warm',
        payload: { prompt_id: 'test' },
      });

      expect(res.statusCode).toBe(502);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('CEE_NETWORK_ERROR');
    });
  });

  // =========================================================================
  // 6. Headers forwarded correctly
  // =========================================================================
  describe('header forwarding', () => {
    it('forwards X-Request-Id and X-Correlation-Id to CEE', async () => {
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const h = init?.headers as Record<string, string>;
        capturedHeaders = { ...h };
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => '{}',
          json: async () => ({}),
        };
      }) as unknown as typeof fetch;

      await app.inject({
        method: 'POST',
        url: '/v1/cee/graph-readiness',
        headers: {
          'x-request-id': 'req-123',
          'x-correlation-id': 'corr-456',
        },
        payload: { graph: {} },
      });

      expect(capturedHeaders['X-Request-Id']).toBe('req-123');
      expect(capturedHeaders['X-Correlation-Id']).toBe('corr-456');
      expect(capturedHeaders['X-Olumi-Assist-Key']).toBe('test-key');
      expect(capturedHeaders['Content-Type']).toBe('application/json');
    });

    it('returns X-Request-Id and X-CEE-Latency-Ms in response headers', async () => {
      globalThis.fetch = mockFetchSuccess({ ok: true });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/cee/prompts/warm',
        headers: { 'x-request-id': 'req-789' },
        payload: { prompt_id: 'test' },
      });

      expect(res.headers['x-request-id']).toBe('req-789');
      expect(res.headers['x-cee-latency-ms']).toBeDefined();
      expect(Number(res.headers['x-cee-latency-ms'])).toBeGreaterThanOrEqual(0);
    });
  });

  // =========================================================================
  // 7. Query string preserved
  // =========================================================================
  describe('query string passthrough', () => {
    it('preserves ?schema=v3 query parameter to CEE', async () => {
      let capturedUrl = '';

      globalThis.fetch = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
        capturedUrl = String(url);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => '{}',
          json: async () => ({}),
        };
      }) as unknown as typeof fetch;

      await app.inject({
        method: 'POST',
        url: '/v1/cee/graph-readiness?schema=v3&debug=true',
        payload: { graph: {} },
      });

      expect(capturedUrl).toContain('/assist/v1/graph-readiness');
      expect(capturedUrl).toContain('schema=v3');
      expect(capturedUrl).toContain('debug=true');
    });
  });

  // =========================================================================
  // 8. Empty body → 400
  // =========================================================================
  describe('input validation', () => {
    it('POST /v1/cee/graph-readiness returns 400 for empty body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/cee/graph-readiness',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.error).toContain('body');
    });

    // prompts/warm: {} is the VALID "warm all prompts" request — the UI's
    // prompt-preloader (DecisionGuideAI src/lib/prompt-preloader.ts) sends
    // exactly {} on every page load, and CEE /assist/v1/prompts/warm accepts
    // it (200). Rejecting it caused a silent warm-up failure on every page
    // load (ROADMAP 2.54(c), SCORECARD §3).
    it('POST /v1/cee/prompts/warm accepts empty object body and forwards {} to CEE', async () => {
      let capturedBody: string | undefined;

      globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        capturedBody = init?.body as string;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => '{"success":true}',
          json: async () => ({ success: true }),
        };
      }) as unknown as typeof fetch;

      const res = await app.inject({
        method: 'POST',
        url: '/v1/cee/prompts/warm',
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ success: true });
      expect(capturedBody).toBeDefined();
      expect(JSON.parse(capturedBody!)).toEqual({});
    });

    it('POST /v1/cee/prompts/warm accepts a missing body and forwards {} to CEE', async () => {
      let capturedBody: string | undefined;

      globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        capturedBody = init?.body as string;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => '{"success":true}',
          json: async () => ({ success: true }),
        };
      }) as unknown as typeof fetch;

      const res = await app.inject({
        method: 'POST',
        url: '/v1/cee/prompts/warm',
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ success: true });
      expect(capturedBody).toBeDefined();
      expect(JSON.parse(capturedBody!)).toEqual({});
    });
  });
});

// ---------------------------------------------------------------------------
// Full-app route availability — critical chain smoke test
// ---------------------------------------------------------------------------

describe('Full-app route availability — critical chain', () => {
  let app: FastifyInstance;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    process.env.CEE_BASE_URL = 'https://cee.test.example.com';
    process.env.CEE_API_KEY = 'test-key';
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.ISL_ENABLE = '0';
    process.env.AUTH_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';

    const { createServer } = await import('../src/createServer.js');
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await app?.close();
    delete process.env.CEE_BASE_URL;
    delete process.env.CEE_API_KEY;
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.ISL_ENABLE;
    delete process.env.AUTH_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('POST /v1/cee/draft-graph returns JSON, not 404', async () => {
    // draft-graph requires CEE config, will return 503 with JSON (not 404)
    // Temporarily unset to get deterministic 503 without needing to mock fetch
    const savedUrl = process.env.CEE_BASE_URL;
    delete process.env.CEE_BASE_URL;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/cee/draft-graph',
      payload: { brief: 'test' },
    });

    process.env.CEE_BASE_URL = savedUrl;

    expect(res.statusCode).not.toBe(404);
    const body = JSON.parse(res.payload);
    expect(body).toBeDefined();
    expect(typeof body).toBe('object');
  });

  it('POST /v1/cee/graph-readiness returns JSON, not 404', async () => {
    globalThis.fetch = mockFetchSuccess({ readiness: 'ready' });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/cee/graph-readiness',
      payload: { graph: {} },
    });

    expect(res.statusCode).not.toBe(404);
    const body = JSON.parse(res.payload);
    expect(body).toBeDefined();
  });

  it('POST /v1/cee/prompts/warm returns JSON, not 404', async () => {
    globalThis.fetch = mockFetchSuccess({ warmed: true });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/cee/prompts/warm',
      payload: { prompt_id: 'test' },
    });

    expect(res.statusCode).not.toBe(404);
    const body = JSON.parse(res.payload);
    expect(body).toBeDefined();
  });

  it('POST /v2/run returns JSON, not 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'content-type': 'application/json' },
      payload: {
        graph: {
          nodes: [
            { id: 'factor-a', kind: 'factor', label: 'Factor A' },
            { id: 'goal', kind: 'goal', label: 'Goal' },
          ],
          edges: [
            { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
          ],
        },
        options: [
          { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': 1.0 } },
          { id: 'opt2', label: 'Option 2', interventions: { 'factor-a': 2.0 } },
        ],
        goal_node_id: 'goal',
        seed: '42',
      },
    });

    expect(res.statusCode).not.toBe(404);
    const body = JSON.parse(res.payload);
    expect(body).toBeDefined();
    expect(typeof body).toBe('object');
  });
});
