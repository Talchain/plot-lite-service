/**
 * Request ID Chain Propagation Tests
 *
 * Verifies end-to-end request ID chain:
 *   - X-Request-Id header priority over body.request_id
 *   - Fallback UUID generation when neither is present
 *   - request_id_chain in response meta
 *   - BFF proxy forwards and echoes X-Request-Id on all paths
 *
 * Uses Fastify inject (no real ISL/CEE calls).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { Writable } from 'node:stream';

// ── BFF Proxy Tests ──────────────────────────────────────────────────────────

// Mock the timeout module to use a short timeout for tests
vi.mock('../src/config/timeouts.ts', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    CEE_PROXY_TIMEOUT_MS: 200,
  };
});

import { registerCeeDraftGraphRoute } from '../src/routes/v1/cee-draft-graph.js';
import { ISLClient } from '../src/integrations/isl/client.js';
import { buildRequestIdChain } from '../src/routes/v2/run.js';

describe('BFF CEE Proxy — X-Request-Id chain', () => {
  let app: FastifyInstance;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    process.env.CEE_BASE_URL = 'https://cee.test.example.com';
    process.env.CEE_API_KEY = 'test-key';

    app = Fastify({
      logger: false,
      requestIdHeader: 'x-request-id',
      genReqId: (req) => {
        const header = req.headers['x-request-id'];
        if (header && typeof header === 'string' && header.trim()) {
          return header.trim();
        }
        return 'generated-fallback-id';
      },
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
    globalThis.fetch = originalFetch;
  });

  it('forwards incoming X-Request-Id to CEE', async () => {
    const uiRequestId = 'ui-chain-test-abc-123';
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      // Capture the headers sent to CEE
      const headers = init?.headers as Record<string, string> | undefined;
      capturedHeaders = headers ?? {};
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ result: 'ok' }),
        text: async () => '{"result":"ok"}',
      };
    }) as unknown as typeof fetch;

    await app.inject({
      method: 'POST',
      url: '/v1/cee/draft-graph',
      headers: { 'x-request-id': uiRequestId },
      payload: { brief: 'test' },
    });

    expect(capturedHeaders['X-Request-Id']).toBe(uiRequestId);
  });

  it('returns X-Request-Id in response headers on success', async () => {
    const uiRequestId = 'ui-success-header-test';

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ result: 'ok' }),
      text: async () => '{"result":"ok"}',
    })) as unknown as typeof fetch;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/cee/draft-graph',
      headers: { 'x-request-id': uiRequestId },
      payload: { brief: 'test' },
    });

    expect(res.headers['x-request-id']).toBe(uiRequestId);
  });

  it('returns X-Request-Id in response headers on CEE JSON error passthrough', async () => {
    const uiRequestId = 'ui-error-passthrough-test';

    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 504,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'CEE_LLM_TIMEOUT', message: 'timed out', retryable: true }),
      text: async () => JSON.stringify({ error: 'CEE_LLM_TIMEOUT', message: 'timed out', retryable: true }),
    })) as unknown as typeof fetch;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/cee/draft-graph',
      headers: { 'x-request-id': uiRequestId },
      payload: { brief: 'test' },
    });

    expect(res.headers['x-request-id']).toBe(uiRequestId);
  });

  it('returns X-Request-Id in response headers on CEE non-JSON error', async () => {
    const uiRequestId = 'ui-nonjson-error-test';

    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 502,
      headers: new Headers({ 'content-type': 'text/html' }),
      json: async () => { throw new Error('not json'); },
      text: async () => '<html>Bad Gateway</html>',
    })) as unknown as typeof fetch;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/cee/draft-graph',
      headers: { 'x-request-id': uiRequestId },
      payload: { brief: 'test' },
    });

    expect(res.headers['x-request-id']).toBe(uiRequestId);
    const body = JSON.parse(res.payload);
    expect(body.request_id).toBe(uiRequestId);
  });

  it('returns X-Request-Id in response headers on timeout', async () => {
    const uiRequestId = 'ui-timeout-test';

    globalThis.fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const onAbort = () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        };
        if (init?.signal?.aborted) { onAbort(); return; }
        init?.signal?.addEventListener('abort', onAbort);
      });
    }) as typeof fetch;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/cee/draft-graph',
      headers: { 'x-request-id': uiRequestId },
      payload: { brief: 'test' },
    });

    expect(res.headers['x-request-id']).toBe(uiRequestId);
    const body = JSON.parse(res.payload);
    expect(body.request_id).toBe(uiRequestId);
  });

  it('returns X-Request-Id on wrong content-type JSON passthrough', async () => {
    const uiRequestId = 'ui-wrong-ct-test';
    const ceeResponse = { error: 'CEE_LLM_TIMEOUT', message: 'timed out', retryable: true };

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
      headers: { 'x-request-id': uiRequestId },
      payload: { brief: 'test' },
    });

    expect(res.headers['x-request-id']).toBe(uiRequestId);
  });
});

// ── V2 Run Request ID Chain Tests ────────────────────────────────────────────

describe('V2 Run — request_id_chain', () => {
  let app: FastifyInstance;

  const VALID_GRAPH = {
    nodes: [
      { id: 'factor-a', kind: 'factor', label: 'Factor A' },
      { id: 'factor-b', kind: 'factor', label: 'Factor B' },
      { id: 'goal', kind: 'goal', label: 'Goal' },
    ],
    edges: [
      { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
      { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
    ],
  };

  const VALID_OPTIONS = [
    {
      id: 'opt1',
      label: 'Option 1',
      interventions: { 'factor-a': { value: 1.5, source: 'user_specified' } },
    },
    {
      id: 'opt2',
      label: 'Option 2',
      interventions: { 'factor-b': { value: 2.0, source: 'user_specified' } },
    },
  ];

  const VALID_BODY = {
    graph: VALID_GRAPH,
    options: VALID_OPTIONS,
    goal_node_id: 'goal',
    seed: '42',
  };

  beforeAll(async () => {
    // ISL disabled — forces local fallback, no real ISL calls
    process.env.ISL_ENABLE = '0';
    process.env.AUTH_ENABLED = '0';
    process.env.TEST_ROUTES = '1';

    const { createServer } = await import('../src/createServer.js');
    app = await createServer({ enableTestRoutes: true });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.ISL_ENABLE;
    delete process.env.AUTH_ENABLED;
    delete process.env.TEST_ROUTES;
  });

  it('uses X-Request-Id header as request_id in response', async () => {
    const uiRequestId = 'ui-v2-header-test-abc';

    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: {
        'content-type': 'application/json',
        'x-request-id': uiRequestId,
      },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.request_id).toBe(uiRequestId);
    expect(res.headers['x-request-id']).toBe(uiRequestId);
  });

  it('uses body.request_id when X-Request-Id header is absent', async () => {
    const bodyRequestId = 'body-request-id-fallback';

    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'content-type': 'application/json' },
      payload: { ...VALID_BODY, request_id: bodyRequestId },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.request_id).toBe(bodyRequestId);
  });

  it('generates UUID when neither header nor body.request_id provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'content-type': 'application/json' },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    // Should be a UUID v4 format
    expect(body.request_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // Header should match body
    expect(res.headers['x-request-id']).toBe(body.request_id);
  });

  it('prefers X-Request-Id header over body.request_id', async () => {
    const headerRequestId = 'header-wins';
    const bodyRequestId = 'body-loses';

    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: {
        'content-type': 'application/json',
        'x-request-id': headerRequestId,
      },
      payload: { ...VALID_BODY, request_id: bodyRequestId },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.request_id).toBe(headerRequestId);
  });

  it('includes request_id_chain with all 6 Brief 4 fields', async () => {
    const uiRequestId = 'chain-received-test';

    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: {
        'content-type': 'application/json',
        'x-request-id': uiRequestId,
      },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    const chain = body.meta.request_id_chain;
    expect(chain).toBeDefined();
    expect(chain.ui).toBe(uiRequestId);
    expect(chain.plot).toBe(uiRequestId);
    // ISL not called (disabled) → isl and isl_echoed are null
    expect(chain.isl).toBeNull();
    expect(chain.isl_echoed).toBeNull();
    expect(chain.all_match).toBe(false);
    expect(chain.chain_complete).toBe(false);
  });

  it('request_id_chain.plot matches ui', async () => {
    const uiRequestId = 'chain-forward-test';

    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: {
        'content-type': 'application/json',
        'x-request-id': uiRequestId,
      },
      payload: VALID_BODY,
    });

    const body = JSON.parse(res.payload);
    expect(body.meta.request_id_chain.plot).toBe(uiRequestId);
  });

  it('request_id_chain.isl is null when ISL is disabled (not called)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'isl-null-test',
      },
      payload: VALID_BODY,
    });

    const body = JSON.parse(res.payload);
    expect(body.meta.request_id_chain.isl).toBeNull();
    expect(body.meta.request_id_chain.isl_echoed).toBeNull();
  });

  it('all_match is false when ISL not called (isl and isl_echoed null)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'all-match-false-test',
      },
      payload: VALID_BODY,
    });

    const body = JSON.parse(res.payload);
    expect(body.meta.request_id_chain.all_match).toBe(false);
    expect(body.meta.request_id_chain.chain_complete).toBe(false);
  });

  it('all_match is false when request header is missing (ui is null)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'content-type': 'application/json' },
      payload: VALID_BODY,
    });

    const body = JSON.parse(res.payload);
    expect(body.meta.request_id_chain.ui).toBeNull();
    expect(body.meta.request_id_chain.all_match).toBe(false);
    expect(body.meta.request_id_chain.chain_complete).toBe(false);
  });
});

// ── V2 Run _meta.request_id_chain & X-Olumi-Request-Id-Chain header ──────────

describe('V2 Run — _meta.request_id_chain (Brief 4 spec)', () => {
  let app: FastifyInstance;

  const VALID_GRAPH = {
    nodes: [
      { id: 'factor-a', kind: 'factor', label: 'Factor A' },
      { id: 'factor-b', kind: 'factor', label: 'Factor B' },
      { id: 'goal', kind: 'goal', label: 'Goal' },
    ],
    edges: [
      { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
      { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
    ],
  };

  const VALID_OPTIONS = [
    {
      id: 'opt1',
      label: 'Option 1',
      interventions: { 'factor-a': { value: 1.5, source: 'user_specified' } },
    },
    {
      id: 'opt2',
      label: 'Option 2',
      interventions: { 'factor-b': { value: 2.0, source: 'user_specified' } },
    },
  ];

  const VALID_BODY = {
    graph: VALID_GRAPH,
    options: VALID_OPTIONS,
    goal_node_id: 'goal',
    seed: '42',
  };

  beforeAll(async () => {
    process.env.ISL_ENABLE = '0';
    process.env.AUTH_ENABLED = '0';
    process.env.TEST_ROUTES = '1';

    const { createServer } = await import('../src/createServer.js');
    app = await createServer({ enableTestRoutes: true });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.ISL_ENABLE;
    delete process.env.AUTH_ENABLED;
    delete process.env.TEST_ROUTES;
  });

  it('_meta.request_id_chain has all 6 Brief 4 fields', async () => {
    const requestId = 'meta-chain-brief4-test';

    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: {
        'content-type': 'application/json',
        'x-request-id': requestId,
      },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body._meta).toBeDefined();
    const chain = body._meta.request_id_chain;
    expect(chain).toBeDefined();
    expect(chain.ui).toBe(requestId);
    expect(chain.plot).toBe(requestId);
    // ISL disabled → isl and isl_echoed are null
    expect(chain.isl).toBeNull();
    expect(chain.isl_echoed).toBeNull();
    expect(chain.all_match).toBe(false);
    expect(chain.chain_complete).toBe(false);
  });

  it('X-Olumi-Request-Id-Chain header has all 6 Brief 4 fields', async () => {
    const requestId = 'header-chain-brief4-test';

    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: {
        'content-type': 'application/json',
        'x-request-id': requestId,
      },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(200);
    const headerValue = res.headers['x-olumi-request-id-chain'];
    expect(headerValue).toBeDefined();
    const chain = JSON.parse(headerValue as string);
    expect(chain.ui).toBe(requestId);
    expect(chain.plot).toBe(requestId);
    expect(chain.isl).toBeNull();
    expect(chain.isl_echoed).toBeNull();
    expect(chain.all_match).toBe(false);
    expect(chain.chain_complete).toBe(false);
  });

  it('_meta.request_id_chain.ui is null when no request ID provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'content-type': 'application/json' },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    const chain = body._meta.request_id_chain;
    expect(chain).toBeDefined();
    // No explicit request ID → ui is null
    expect(chain.ui).toBeNull();
    // PLoT still generates one → plot is the auto-generated UUID
    expect(chain.plot).toBe(body.request_id);
    expect(chain.all_match).toBe(false);
    expect(chain.chain_complete).toBe(false);
  });

  it('X-Olumi-Request-Id-Chain header has null ui when no request ID provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'content-type': 'application/json' },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(200);
    const headerValue = res.headers['x-olumi-request-id-chain'];
    expect(headerValue).toBeDefined();
    const chain = JSON.parse(headerValue as string);
    expect(chain.ui).toBeNull();
    expect(chain.all_match).toBe(false);
    expect(chain.chain_complete).toBe(false);
  });
});

// ── ISL Client — echoed request ID capture ───────────────────────────────────

describe('ISL Client — request ID echo capture', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('captures X-Request-Id from ISL response headers', async () => {
    const requestId = 'isl-echo-capture-test';

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'application/json',
        'x-request-id': requestId,
      }),
      json: async () => ({ status: 'ok' }),
      // Lane PLoT-R3: client now reads raw text (for exact-byte digests) and parses it
      text: async () => JSON.stringify({ status: 'ok' }),
    })) as unknown as typeof fetch;

    const client = new ISLClient({
      baseUrl: 'https://isl.test.example.com',
      apiKey: 'test-key',
      timeoutMs: 5000,
      maxRetries: 1,
    });

    const result = await client.request<{ status: string }>({
      endpoint: '/api/v1/test',
      body: { test: true },
      requestId,
    });

    expect(result.data).toEqual({ status: 'ok' });
    expect(result.islEchoedRequestId).toBe(requestId);
  });

  it('returns null islEchoedRequestId when ISL does not echo', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ status: 'ok' }),
      // Lane PLoT-R3: client now reads raw text (for exact-byte digests) and parses it
      text: async () => JSON.stringify({ status: 'ok' }),
    })) as unknown as typeof fetch;

    const client = new ISLClient({
      baseUrl: 'https://isl.test.example.com',
      apiKey: 'test-key',
      timeoutMs: 5000,
      maxRetries: 1,
    });

    const result = await client.request<{ status: string }>({
      endpoint: '/api/v1/test',
      body: { test: true },
      requestId: 'no-echo-test',
    });

    expect(result.islEchoedRequestId).toBeNull();
  });
});

// ── buildRequestIdChain unit tests (Brief 4 spec) ────────────────────────────

describe('buildRequestIdChain — Brief 4 spec', () => {
  it('all_match is true only when all four fields are non-null and identical', () => {
    const chain = buildRequestIdChain(true, 'abc-123', true, 'abc-123');
    expect(chain.ui).toBe('abc-123');
    expect(chain.plot).toBe('abc-123');
    expect(chain.isl).toBe('abc-123');
    expect(chain.isl_echoed).toBe('abc-123');
    expect(chain.all_match).toBe(true);
    expect(chain.chain_complete).toBe(true);
  });

  it('all_match is false when isl_echoed differs', () => {
    const chain = buildRequestIdChain(true, 'abc-123', true, 'different-id');
    expect(chain.all_match).toBe(false);
    expect(chain.chain_complete).toBe(true);
  });

  it('all_match is false when ISL does not echo (isl_echoed null)', () => {
    const chain = buildRequestIdChain(true, 'abc-123', true, null);
    expect(chain.isl_echoed).toBeNull();
    expect(chain.all_match).toBe(false);
    expect(chain.chain_complete).toBe(false);
  });

  it('all_match is false when request header is missing (ui null)', () => {
    const chain = buildRequestIdChain(false, 'auto-gen-uuid', true, 'auto-gen-uuid');
    expect(chain.ui).toBeNull();
    expect(chain.plot).toBe('auto-gen-uuid');
    expect(chain.isl).toBe('auto-gen-uuid');
    expect(chain.isl_echoed).toBe('auto-gen-uuid');
    expect(chain.all_match).toBe(false);
    expect(chain.chain_complete).toBe(false);
  });

  it('chain_complete is false when ISL not called (isl null)', () => {
    const chain = buildRequestIdChain(true, 'abc-123', false, null);
    expect(chain.isl).toBeNull();
    expect(chain.isl_echoed).toBeNull();
    expect(chain.chain_complete).toBe(false);
    expect(chain.all_match).toBe(false);
  });

  it('chain_complete is true but all_match false when IDs differ', () => {
    const chain = buildRequestIdChain(true, 'abc-123', true, 'xyz-456');
    expect(chain.chain_complete).toBe(true);
    expect(chain.all_match).toBe(false);
  });
});
