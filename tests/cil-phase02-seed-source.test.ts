/**
 * CIL Phase 0.2 — seed_source metadata
 *
 * Tests that response meta includes seed_source indicating whether seed was
 * user-provided or internally derived.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

describe.skip('CIL Phase 0.2 — seed_source metadata (TODO: fix test setup)', () => {
  let server: ServerHandle | null = null;

  const ENV = {
    TEST_ROUTES: '1',
    AUTH_ENABLED: '0',
    RATE_LIMIT_ENABLED: '0',
    ISL_BASE_URL: 'mock',
    ISL_MOCK_ENABLE: '1',
  };

  afterEach(async () => {
    await server?.kill();
    server = null;
  });

  const VALID_GRAPH = {
    nodes: [
      { id: 'factor-a', kind: 'factor', label: 'Factor A', observed_state: { value: 50 } },
      { id: 'factor-b', kind: 'factor', label: 'Factor B', observed_state: { value: 30 } },
      { id: 'goal', kind: 'goal', label: 'Goal' },
    ],
    edges: [
      { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
      { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
    ],
  };

  const VALID_OPTIONS = [
    {
      id: 'opt-a',
      label: 'Option A',
      interventions: { 'factor-a': { value: 0.8, source: 'user_specified' } },
    },
    {
      id: 'opt-b',
      label: 'Option B',
      interventions: { 'factor-b': { value: 0.7, source: 'user_specified' } },
    },
  ];

  it('seed_source is "provided" when user provides seed', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const res = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: VALID_GRAPH,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
      }),
    });

    expect(res.status).toBe(200);
    expect(res.body.meta.seed_source).toBe('client_generated');
    expect(res.body.meta.seed_used).toBe('42');
  });

  it('seed_source is "derived" when no seed provided', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const res = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: VALID_GRAPH,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        // No seed provided
      }),
    });

    expect(res.status).toBe(200);
    expect(res.body.meta.seed_source).toBe('server_generated');
    expect(res.body.meta.seed_used).toBeDefined(); // Should have a derived seed
  });

  it('seed_source is "provided" when user provides numeric seed', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const res = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: VALID_GRAPH,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        seed: 4242,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.body.meta.seed_source).toBe('client_generated');
    expect(res.body.meta.seed_used).toBe('4242'); // Converted to string
  });
});
