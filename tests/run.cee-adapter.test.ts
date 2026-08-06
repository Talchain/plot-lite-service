import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { callDecisionReviewFromEngine } from '../src/cee/client.js';

const BASE_ENV = {
  enable: '1',
  baseUrl: 'http://cee.test',
  apiKey: 'test-key',
  timeoutMs: 500,
} as const;

function makeContext() {
  return {
    response_hash: 'hash-123',
    seed: 42,
    inference_mode: 'model_based',
    graph_summary: { nodes: 2, edges: 1 },
  } as const;
}

describe('callDecisionReviewFromEngine (adapter)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch as any;
  });

  it('uses SDK orchestrator real path with strict {graph, archetype} payloads and returns non-null review', async () => {
    const graph = { nodes: [], edges: [] };
    const archetype = { id: 'archetype-1' };

    const fetchMock = vi.fn(async (url: string, init?: any) => {
      const u = new URL(url);
      const path = u.pathname;

      // 1) Health probe
      if (path.endsWith('/healthz')) {
        const payload = { ok: true };
        return {
          ok: true,
          status: 200,
          json: async () => payload,
          text: async () => JSON.stringify(payload),
        } as any;
      }

      // 2) Draft graph from brief (non-streaming)
      if (path.endsWith('/assist/v1/draft-graph')) {
        const body = init?.body ? JSON.parse(init.body) : {};
        expect(Object.keys(body).sort()).toEqual(['brief', 'config']);
        expect(typeof body.brief).toBe('string');
        expect(body.brief.length).toBeGreaterThanOrEqual(30);
        expect(body.config?.streaming).toBe(false);

        const payload = {
          graph,
          archetype,
          trace: { request_id: 'cee-req-1' },
        };

        return {
          ok: true,
          status: 200,
          json: async () => payload,
          text: async () => JSON.stringify(payload),
        } as any;
      }

      // 3) Options helper – must send { graph, archetype }
      if (path.endsWith('/assist/v1/options')) {
        const body = init?.body ? JSON.parse(init.body) : {};
        expect(Object.keys(body).sort()).toEqual(['archetype', 'graph']);
        expect(body.graph).toEqual(graph);
        expect(body.archetype).toEqual(archetype);

        const payload = {
          options: [],
          trace: { request_id: 'cee-req-1' },
        };

        return {
          ok: true,
          status: 200,
          json: async () => payload,
          text: async () => JSON.stringify(payload),
        } as any;
      }

      // 4) Evidence helper – empty evidence list is fine
      if (path.endsWith('/assist/v1/evidence-helper')) {
        const body = init?.body ? JSON.parse(init.body) : {};
        expect(body).toEqual({ evidence: [] });

        const payload = {
          items: [],
          trace: { request_id: 'cee-req-1' },
        };

        return {
          ok: true,
          status: 200,
          json: async () => payload,
          text: async () => JSON.stringify(payload),
        } as any;
      }

      // 5) Bias check — RETIRED (S-1, ROADMAP 2.461). The branch is deliberately
      //    ABSENT rather than kept as a harmless stub: `runDecisionReviewViaSdk` ran
      //    it against the CEE-DRAFTED graph, so if the call is ever re-added this
      //    mock falls through to the `Unexpected URL` throw below and REDs loudly.

      throw new Error(`Unexpected URL in CEE adapter test: ${url}`);
    });

    globalThis.fetch = fetchMock as any;

    const res = await callDecisionReviewFromEngine({
      requestId: 'req-healthy-1',
      context: makeContext(),
      env: { ...BASE_ENV },
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(res.usedFixture).toBe(false);
    expect(res.trace).toBeDefined();
    expect(res.trace.requestId).toBe('req-healthy-1');
    expect(res.trace.degraded).toBe(false);
    expect(res.review).not.toBeNull();
    expect(res.error).toBeUndefined();
  });

  it('uses enhanced brief when enhanced flag is set', async () => {
    const graph = { nodes: [], edges: [] };
    const archetype = { id: 'archetype-1' };

    const fetchMock = vi.fn(async (url: string, init?: any) => {
      const u = new URL(url);
      const path = u.pathname;

      if (path.endsWith('/healthz')) {
        const payload = { ok: true };
        return {
          ok: true,
          status: 200,
          json: async () => payload,
          text: async () => JSON.stringify(payload),
        } as any;
      }

      if (path.endsWith('/assist/v1/draft-graph')) {
        const body = init?.body ? JSON.parse(init.body) : {};
        expect(Object.keys(body).sort()).toEqual(['brief', 'config']);
        expect(typeof body.brief).toBe('string');
        expect(body.brief.length).toBeGreaterThanOrEqual(30);
        expect(String(body.brief).toLowerCase()).toContain('enhanced');
        expect(String(body.brief).toLowerCase()).toContain('sensitivity');

        const payload = {
          graph,
          archetype,
          trace: { request_id: 'cee-req-2' },
        };

        return {
          ok: true,
          status: 200,
          json: async () => payload,
          text: async () => JSON.stringify(payload),
        } as any;
      }

      if (path.endsWith('/assist/v1/options')) {
        const body = init?.body ? JSON.parse(init.body) : {};
        expect(Object.keys(body).sort()).toEqual(['archetype', 'graph']);
        expect(body.graph).toEqual(graph);
        expect(body.archetype).toEqual(archetype);

        const payload = {
          options: [],
          trace: { request_id: 'cee-req-2' },
        };

        return {
          ok: true,
          status: 200,
          json: async () => payload,
          text: async () => JSON.stringify(payload),
        } as any;
      }

      if (path.endsWith('/assist/v1/evidence-helper')) {
        const body = init?.body ? JSON.parse(init.body) : {};
        expect(body).toEqual({ evidence: [] });

        const payload = {
          items: [],
          trace: { request_id: 'cee-req-2' },
        };

        return {
          ok: true,
          status: 200,
          json: async () => payload,
          text: async () => JSON.stringify(payload),
        } as any;
      }

      // Bias check — RETIRED (S-1). Absent on purpose; see the note in the healthy
      // path test above. A re-added call falls through to the throw below.

      throw new Error(`Unexpected URL in enhanced CEE adapter test: ${url}`);
    });

    globalThis.fetch = fetchMock as any;

    const res = await callDecisionReviewFromEngine({
      requestId: 'req-enhanced-1',
      context: makeContext(),
      env: { ...BASE_ENV },
      enhanced: true,
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(res.usedFixture).toBe(false);
    expect(res.trace).toBeDefined();
    expect(res.trace.requestId).toBe('req-enhanced-1');
    expect(res.trace.degraded).toBe(false);
    expect(res.review).not.toBeNull();
    expect(res.error).toBeUndefined();
  });

  it('uses fixture fallback when health fails and fixture succeeds', async () => {
    const fetchMock = vi
      .fn()
      // healthz → not ok
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) } as any)
      // example fixture → ok with payload
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          schema: 'cee.decision-review.v1',
          response_hash: 'hash-123',
          seed: 1,
          inference_mode: 'model_based',
          graph_summary: { nodes: 1, edges: 0 },
        }),
      } as any);

    globalThis.fetch = fetchMock as any;

    const res = await callDecisionReviewFromEngine({
      requestId: 'req-fixture-1',
      context: makeContext(),
      env: { ...BASE_ENV },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.usedFixture).toBe(true);
    expect(res.review).not.toBeNull();
    expect(res.trace.degraded).toBe(true);
    expect(res.error).toBeDefined();
    expect(res.error?.code).toBe('CEE_FALLBACK_FIXTURE');
    expect(res.error?.suggestedAction).toBe('retry');
  });

  it('returns config-missing error when baseUrl/apiKey are absent', async () => {
    const fetchSpy = vi.spyOn(globalThis as any, 'fetch').mockImplementation(() => {
      throw new Error('fetch should not be called');
    });

    const res = await callDecisionReviewFromEngine({
      requestId: 'req-config-missing',
      context: makeContext(),
      env: {
        enable: '1',
        baseUrl: undefined,
        apiKey: undefined,
        timeoutMs: 100,
      },
    } as any);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.usedFixture).toBe(false);
    expect(res.error).toBeDefined();
    expect(res.error?.code).toBe('CEE_CONFIG_MISSING');
    expect(res.error?.suggestedAction).toBe('fix_input');
  });

  it('returns disabled error when env.enable is falsy', async () => {
    const fetchSpy = vi.spyOn(globalThis as any, 'fetch').mockImplementation(() => {
      throw new Error('fetch should not be called');
    });

    const res = await callDecisionReviewFromEngine({
      requestId: 'req-disabled',
      context: makeContext(),
      env: {
        enable: '0',
        baseUrl: 'http://cee.test',
        apiKey: 'key',
        timeoutMs: 100,
      },
    } as any);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.usedFixture).toBe(false);
    expect(res.error).toBeDefined();
    expect(res.error?.code).toBe('CEE_DISABLED');
  });
});
