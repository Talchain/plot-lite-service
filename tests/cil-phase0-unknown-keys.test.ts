/**
 * CIL Phase 0.2 — Unknown top-level key rejection
 *
 * Tests that /v2/run rejects unknown top-level keys but accepts unknown nested keys
 * for forward compatibility.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

describe('CIL Phase 0.2 — Unknown top-level key rejection', () => {
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

  it('rejects unknown top-level field with 400', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const res = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: VALID_GRAPH,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        unknown_field: 'should be rejected',
      }),
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Unknown field: unknown_field');
  });

  it('accepts all allowlisted keys without rejection', async () => {
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
        n_samples: 1000,
        detail_level: 'standard',
        request_id: 'test-req',
        idempotency_key: 'test-idem',
        goal_threshold: 0.8,
        brief: 'Test brief for validation',
        goal_constraints: [],
      }),
    });

    // Should not be 400 (unknown field rejection)
    // May be 200 (success) or 422 (validation error) depending on other validation
    expect(res.status).not.toBe(400);
  });

  it('silently accepts unknown fields in graph.nodes[] (nested permissiveness)', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const graphWithUnknownNodeField = {
      nodes: [
        {
          id: 'factor-a',
          kind: 'factor',
          label: 'Factor A',
          observed_state: { value: 50 },
          unknown_nested_field: 'should not be rejected',
        },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
      ],
    };

    const res = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: graphWithUnknownNodeField,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
      }),
    });

    // Should not be 400 (unknown field rejection at top level)
    // Nested unknown fields are intentionally permitted and silently dropped
    expect(res.status).not.toBe(400);
  });
});
