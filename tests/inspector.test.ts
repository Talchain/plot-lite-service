import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

describe('Inspector (P1B)', () => {
  let server: ServerHandle;

  beforeAll(async () => {
    server = await spawnServer({
      env: {
        TEST_ROUTES: '1',
        AUTH_ENABLED: '0',
        INSPECTOR_DEBUG_ENABLE: '1',
        SCM_LITE_ENABLE: '0',
      },
    });
  });

  afterAll(async () => {
    await server?.kill();
  });

  const GRAPH_WITH_BELIEF = {
    nodes: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
    edges: [
      { from: 'a', to: 'b', weight: 1.5, belief: 0.8, provenance: 'user' },
    ],
  };

  const GRAPH_WITHOUT_BELIEF = {
    nodes: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
    edges: [
      { from: 'a', to: 'b', weight: 1.5 },
    ],
  };

  it('includes debug.inspector when include_debug=true and flag enabled', async () => {
    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: GRAPH_WITH_BELIEF,
        seed: 4242,
        include_debug: true,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.data.debug).toBeDefined();
    expect(res.data.debug.inspector).toBeDefined();
    expect(res.data.debug.inspector.edges).toHaveLength(1);
    
    const edge = res.data.debug.inspector.edges[0];
    expect(edge.weight).toBe(1.5);
    expect(edge.belief).toBe(0.8);
    expect(edge.provenance).toBe('user');
  });

  it('applies defaults when belief/provenance omitted', async () => {
    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: GRAPH_WITHOUT_BELIEF,
        seed: 4242,
        include_debug: true,
      }),
    });

    expect(res.status).toBe(200);
    const edge = res.data.debug.inspector.edges[0];
    expect(edge.belief).toBe(1.0);
    expect(edge.provenance).toBe('template');
  });

  it('omits debug.inspector when include_debug=false', async () => {
    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: GRAPH_WITH_BELIEF,
        seed: 4242,
        include_debug: false,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.data.debug).toBeUndefined();
  });

  it('summaries unchanged with/without inspector', async () => {
    const r1 = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: GRAPH_WITH_BELIEF,
        seed: 4242,
        include_debug: false,
      }),
    });

    const r2 = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: GRAPH_WITH_BELIEF,
        seed: 4242,
        include_debug: true,
      }),
    });

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.data.results).toEqual(r2.data.results);
    expect(r1.data.confidence).toEqual(r2.data.confidence);
  });

  it('response_hash unchanged with/without inspector', async () => {
    const r1 = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: GRAPH_WITH_BELIEF,
        seed: 4242,
        include_debug: false,
      }),
    });

    const r2 = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: GRAPH_WITH_BELIEF,
        seed: 4242,
        include_debug: true,
      }),
    });

    expect(r1.data.model_card.response_hash).toBe(r2.data.model_card.response_hash);
  });
});
