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

  it('returns structured result and usedFixture=false when health is OK (SDK orchestrator path)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) } as any);

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
    expect(res.error?.code).not.toBe('CEE_SDK_UNAVAILABLE');
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
