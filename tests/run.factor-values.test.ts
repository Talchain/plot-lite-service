/**
 * Factor Value Integration Test (Phase 1B)
 *
 * End-to-end test verifying that factor node values propagate correctly
 * through the /v1/run endpoint with SCM-Lite enabled.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

describe('POST /v1/run with factor values (SCM-Lite)', () => {
  let server: ServerHandle | null = null;

  const ENV = {
    TEST_ROUTES: '1',
    AUTH_ENABLED: '0',
    RATE_LIMIT_ENABLED: '0',
    SCM_LITE_ENABLE: '1',
    COMPARE_VIEW_ENABLE: '0',
    INSPECTOR_DEBUG_ENABLE: '0',
  };

  afterEach(async () => {
    await server?.kill();
    server = null;
  });

  /**
   * Primary E2E Test: Factor node with observed_state.value
   *
   * Graph: Price (factor, value=100) -> Revenue (goal)
   * Expected: outcome.p50 = 100
   */
  it('factor node observed_state.value propagates to outcome', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-scm-lite': '1',
      },
      body: JSON.stringify({
        graph: {
          nodes: [
            {
              id: 'Price',
              label: 'Price',
              kind: 'factor',
              observed_state: { value: 100, unit: '£' },
            },
            { id: 'Revenue', label: 'Revenue', kind: 'goal' },
          ],
          edges: [{ from: 'Price', to: 'Revenue', weight: 1, belief: 1.0 }],
        },
        seed: 4242,
        k_samples: 100,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.data.schema).toBe('run.v1');

    // With deterministic edge (belief=1.0, weight=1), outcome should equal factor value
    // Response structure: results.most_likely.outcome or result.summary.p50
    expect(res.data.results.most_likely.outcome).toBe(100);
  });

  /**
   * Multiple Factor Nodes: Sum of values
   *
   * Graph: Price (59) + Volume (1000) -> Revenue (goal)
   * Expected: outcome.p50 = 59 + 1000 = 1059
   */
  it('multiple factor nodes sum into goal', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-scm-lite': '1',
      },
      body: JSON.stringify({
        graph: {
          nodes: [
            {
              id: 'Price',
              label: 'Price',
              kind: 'factor',
              observed_state: { value: 59, baseline: 49, unit: '£' },
            },
            {
              id: 'Volume',
              label: 'Volume',
              kind: 'factor',
              observed_state: { value: 1000, unit: 'units' },
            },
            { id: 'Revenue', label: 'Revenue', kind: 'goal' },
          ],
          edges: [
            { from: 'Price', to: 'Revenue', weight: 1, belief: 1.0 },
            { from: 'Volume', to: 'Revenue', weight: 1, belief: 1.0 },
          ],
        },
        seed: 4242,
        k_samples: 100,
      }),
    });

    expect(res.status).toBe(200);
    // Revenue = Price + Volume = 59 + 1000 = 1059
    expect(res.data.results.most_likely.outcome).toBe(1059);
  });

  /**
   * Factor with weighted edge
   *
   * Graph: Price (100) --[weight=0.5]--> Margin (goal)
   * Expected: outcome.p50 = 100 * 0.5 = 50
   */
  it('factor value multiplied by edge weight', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-scm-lite': '1',
      },
      body: JSON.stringify({
        graph: {
          nodes: [
            {
              id: 'Price',
              label: 'Price',
              kind: 'factor',
              observed_state: { value: 100 },
            },
            { id: 'Margin', label: 'Margin', kind: 'goal' },
          ],
          edges: [{ from: 'Price', to: 'Margin', weight: 0.5, belief: 1.0 }],
        },
        seed: 4242,
        k_samples: 100,
      }),
    });

    expect(res.status).toBe(200);
    // Margin = Price * 0.5 = 100 * 0.5 = 50
    expect(res.data.results.most_likely.outcome).toBe(50);
  });

  /**
   * Determinism test: same factor values + seed = same hash
   */
  it('factor values produce deterministic response_hash', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const payload = {
      graph: {
        nodes: [
          {
            id: 'Price',
            label: 'Price',
            kind: 'factor',
            observed_state: { value: 59 },
          },
          { id: 'Revenue', label: 'Revenue', kind: 'goal' },
        ],
        edges: [{ from: 'Price', to: 'Revenue', weight: 1, belief: 1.0 }],
      },
      seed: 12345,
      k_samples: 100,
    };

    const res1 = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-scm-lite': '1' },
      body: JSON.stringify(payload),
    });

    const res2 = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-scm-lite': '1' },
      body: JSON.stringify(payload),
    });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.data.model_card.response_hash).toBe(res2.data.model_card.response_hash);
    expect(res1.data.model_card.bma_hash).toBe(res2.data.model_card.bma_hash);
  });

  /**
   * Chain propagation: Factor -> Intermediate -> Goal
   *
   * Graph: Price (10) --[weight=2]--> Intermediate --[weight=3]--> Goal
   * Expected: Goal = (10 * 2) * 3 = 60
   */
  it('factor value propagates through chain', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-scm-lite': '1',
      },
      body: JSON.stringify({
        graph: {
          nodes: [
            {
              id: 'Price',
              label: 'Price',
              kind: 'factor',
              observed_state: { value: 10 },
            },
            { id: 'Intermediate', label: 'Intermediate' },
            { id: 'Goal', label: 'Goal', kind: 'goal' },
          ],
          edges: [
            { from: 'Price', to: 'Intermediate', weight: 2, belief: 1.0 },
            { from: 'Intermediate', to: 'Goal', weight: 3, belief: 1.0 },
          ],
        },
        seed: 4242,
        k_samples: 100,
      }),
    });

    expect(res.status).toBe(200);
    // Intermediate = Price * 2 = 10 * 2 = 20
    // Goal = Intermediate * 3 = 20 * 3 = 60
    expect(res.data.results.most_likely.outcome).toBe(60);
  });
});
