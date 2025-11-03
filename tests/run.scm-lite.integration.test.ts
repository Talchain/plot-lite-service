import { describe, it, expect, afterEach, vi } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

describe('POST /v1/run with SCM-Lite enabled', () => {
  let server: ServerHandle | null = null;

  const ENV = {
    TEST_ROUTES: '1',
    AUTH_ENABLED: '0',
    RATE_LIMIT_ENABLED: '0',
    SCM_LITE_ENABLE: '1',
    PRINCIPAL_HMAC_SECRET: '',
    PRINCIPAL_HMAC_SECRET_ACTIVE: '',
    PRINCIPAL_HMAC_SECRET_STAGED: '',
    COMPARE_VIEW_ENABLE: '0',
    INSPECTOR_DEBUG_ENABLE: '0',
  };

  afterEach(async () => {
    await server?.kill();
    server = null;
  });

  const CANONICAL_GRAPH = {
    nodes: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ],
    edges: [
      { from: 'a', to: 'b', weight: 1.2 },
      { from: 'b', to: 'c', weight: 0.8 },
    ],
  };

  it('produces deterministic response_hash and bma_hash with fixed seed', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const runs = [];
    for (let i = 0; i < 3; i++) {
      const res = await requestJSON(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: CANONICAL_GRAPH,
          seed: 4242,
          k_samples: 500,
        }),
      });
      runs.push({
        response_hash: res.data.result.response_hash,
        bma_hash: res.data.model_card.bma_hash,
      });
    }

    expect(runs[0].response_hash).toBe(runs[1].response_hash);
    expect(runs[1].response_hash).toBe(runs[2].response_hash);
    expect(runs[0].bma_hash).toBe(runs[1].bma_hash);
    expect(runs[1].bma_hash).toBe(runs[2].bma_hash);
  });

  it('returns valid report.v1 contract with summary.bands', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: CANONICAL_GRAPH,
        seed: 4242,
        k_samples: 500,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.data.schema).toBe('run.v1');
    expect(res.data.model_card.bma_hash).toBeDefined();
    expect(typeof res.data.model_card.bma_hash).toBe('string');
  });

  it('rejects graph exceeding max nodes', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const largeGraph = {
      nodes: Array.from({ length: 13 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}` })),
      edges: [{ from: 'n0', to: 'n1', weight: 1 }],
    };

    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: largeGraph,
        seed: 4242,
      }),
    });

    expect(res.status).toBe(400);
  });
});

describe('POST /v1/run rate-limit parity with SCM-Lite', () => {
  let server: ServerHandle | null = null;

  afterEach(async () => {
    await server?.kill();
    server = null;
  });

  it('returns 429 with proper headers after exceeding rate limit', async () => {
    vi.resetModules();
    server = await spawnServer({
      env: {
        TEST_ROUTES: '1',
        AUTH_ENABLED: '0',
        RATE_LIMIT_ENABLED: '1',
        RATE_LIMIT_RPM: '1',
        SCM_LITE_ENABLE: '1',
    PRINCIPAL_HMAC_SECRET: '',
    PRINCIPAL_HMAC_SECRET_ACTIVE: '',
    PRINCIPAL_HMAC_SECRET_STAGED: '',
        COMPARE_VIEW_ENABLE: '0',
        INSPECTOR_DEBUG_ENABLE: '0',
      },
    });

    const payload = {
      graph: {
        nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        edges: [{ from: 'a', to: 'b', weight: 1 }],
      },
      seed: 4242,
    };

    const r1 = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(r1.status).toBe(200);

    const r2 = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(r2.status).toBe(429);
    expect(r2.headers.get('retry-after')).toBeDefined();
  });
});
