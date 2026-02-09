/**
 * CIL Phase 0.2 — Blocked response robustness contract
 *
 * Tests that buildBlockedResponse (422 path) includes robustness with empty arrays.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

describe('CIL Phase 0.2 — Blocked response robustness', () => {
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

  const INVALID_GRAPH = {
    nodes: [
      { id: 'factor-a', kind: 'factor', label: 'Factor A', observed_state: { value: 50 } },
      { id: 'goal', kind: 'goal', label: 'Goal' },
    ],
    edges: [
      { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
    ],
  };

  it('blocked response (422) includes robustness with empty arrays', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    // Trigger a 422 blocked response by providing < 2 options
    const res = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: INVALID_GRAPH,
        options: [
          {
            id: 'opt-a',
            label: 'Option A',
            interventions: { 'factor-a': { value: 0.8, source: 'user_specified' } },
          },
        ], // Only 1 option - should trigger validation error
        goal_node_id: 'goal',
      }),
    });

    expect(res.status).toBe(422);
    expect(res.body.analysis_status).toBe('blocked');

    // CIL 0.2: robustness must be present with empty arrays
    expect(res.body.robustness).toBeDefined();
    expect(res.body.robustness.fragile_edges).toEqual([]);
    expect(res.body.robustness.robust_edges).toEqual([]);
    expect(Array.isArray(res.body.robustness.fragile_edges)).toBe(true);
    expect(Array.isArray(res.body.robustness.robust_edges)).toBe(true);
  });

  it('blocked response includes robustness for invalid goal_node_id', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const res = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: INVALID_GRAPH,
        options: [
          {
            id: 'opt-a',
            label: 'Option A',
            interventions: { 'factor-a': { value: 0.8, source: 'user_specified' } },
          },
          {
            id: 'opt-b',
            label: 'Option B',
            interventions: { 'factor-a': { value: 0.6, source: 'user_specified' } },
          },
        ],
        goal_node_id: 'non-existent-goal', // Invalid goal node
      }),
    });

    expect(res.status).toBe(422);
    expect(res.body.analysis_status).toBe('blocked');

    // CIL 0.2: robustness must be present with empty arrays
    expect(res.body.robustness).toBeDefined();
    expect(res.body.robustness.fragile_edges).toEqual([]);
    expect(res.body.robustness.robust_edges).toEqual([]);
  });
});
