import { describe, it, expect, afterEach, vi } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

describe('Option Compare (P1A)', () => {
  let server: ServerHandle | null = null;

  const SIMPLE_GRAPH = {
    nodes: [
      { id: 'start', label: 'Start' },
      { id: 'end', label: 'End' },
    ],
    edges: [
      { from: 'start', to: 'end', weight: 1.5, label: 'Effect' },
    ],
  };

  const ENV = {
    TEST_ROUTES: '1',
    AUTH_ENABLED: '0',
    COMPARE_VIEW_ENABLE: '1',
    INSPECTOR_DEBUG_ENABLE: '0',
    RATE_LIMIT_ENABLED: '0',
    SCM_LITE_ENABLE: '0',
  };

  afterEach(async () => {
    await server?.kill();
    server = null;
  });

  it('includes debug.compare when include_debug=true and flag enabled', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });
    
    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: SIMPLE_GRAPH,
        seed: 4242,
        include_debug: true,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.data.debug).toBeDefined();
    expect(res.data.debug.compare).toBeDefined();
    expect(res.data.debug.compare.end).toBeDefined();
    expect(res.data.debug.compare.end.p10).toBeTypeOf('number');
    expect(res.data.debug.compare.end.p50).toBeTypeOf('number');
    expect(res.data.debug.compare.end.p90).toBeTypeOf('number');
    expect(Array.isArray(res.data.debug.compare.end.top3_edges)).toBe(true);
  });

  it('omits debug.compare when include_debug=false', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: SIMPLE_GRAPH,
        seed: 4242,
        include_debug: false,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.data.debug).toBeUndefined();
  });

  it('omits debug.compare when include_debug not specified', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: SIMPLE_GRAPH,
        seed: 4242,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.data.debug).toBeUndefined();
  });

  it('response_hash unchanged with/without include_debug', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const r1 = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: SIMPLE_GRAPH,
        seed: 4242,
        include_debug: false,
      }),
    });

    const r2 = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: SIMPLE_GRAPH,
        seed: 4242,
        include_debug: true,
      }),
    });

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.data.model_card.response_hash).toBe(r2.data.model_card.response_hash);
  });

  it('deterministic: same seed produces same top3_edges order', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const runs = [];
    for (let i = 0; i < 3; i++) {
      const res = await requestJSON(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: SIMPLE_GRAPH,
          seed: 4242,
          include_debug: true,
        }),
      });
      runs.push(res.data.debug?.compare?.end?.top3_edges || []);
    }

    expect(runs[0]).toEqual(runs[1]);
    expect(runs[1]).toEqual(runs[2]);
  });
});
