/**
 * ISL Enrichment Integration Tests (Phase 1A)
 *
 * Tests that the /v1/run endpoint correctly includes ISL enrichment data
 * based on detail_level and ISL availability.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

describe('POST /v1/run enrichment (Phase 1A)', () => {
  let server: ServerHandle | null = null;

  const BASE_ENV = {
    TEST_ROUTES: '1',
    AUTH_ENABLED: '0',
    RATE_LIMIT_ENABLED: '0',
    SCM_LITE_ENABLE: '1',
    COMPARE_VIEW_ENABLE: '0',
    INSPECTOR_DEBUG_ENABLE: '0',
  };

  const SIMPLE_GRAPH = {
    nodes: [
      { id: 'X', label: 'Treatment' },
      { id: 'Y', label: 'Outcome', kind: 'goal' },
    ],
    edges: [{ from: 'X', to: 'Y', weight: 1, belief: 1.0 }],
  };

  afterEach(async () => {
    await server?.kill();
    server = null;
  });

  /**
   * Test Case A: Enrichment present at standard detail_level
   *
   * When detail_level='standard', enrichment should be present with:
   * - metadata.detail_level = 'standard'
   * - metadata.isl_enabled = true/false
   * - causal_validation may be present (depending on ISL)
   */
  it('Case A: enrichment present at standard detail_level', async () => {
    vi.resetModules();
    server = await spawnServer({
      env: {
        ...BASE_ENV,
        ISL_ENABLE: '0', // ISL disabled - test enrichment structure
      },
    });

    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-scm-lite': '1',
      },
      body: JSON.stringify({
        graph: SIMPLE_GRAPH,
        seed: 4242,
        k_samples: 100,
        detail_level: 'standard',
      }),
    });

    expect(res.status).toBe(200);
    expect(res.data.schema).toBe('run.v1');

    // Enrichment should be present for standard detail_level
    expect(res.data.enrichment).toBeDefined();
    expect(res.data.enrichment.metadata).toBeDefined();
    expect(res.data.enrichment.metadata.detail_level).toBe('standard');
  });

  /**
   * Test Case B: Enrichment complete at deep detail_level
   *
   * When detail_level='deep', enrichment should include both:
   * - causal_validation (if ISL enabled)
   * - sensitivity_analysis (if ISL enabled)
   */
  it('Case B: enrichment present at deep detail_level', async () => {
    vi.resetModules();
    server = await spawnServer({
      env: {
        ...BASE_ENV,
        ISL_ENABLE: '0', // ISL disabled - test structure
      },
    });

    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-scm-lite': '1',
      },
      body: JSON.stringify({
        graph: SIMPLE_GRAPH,
        seed: 4242,
        k_samples: 100,
        detail_level: 'deep',
      }),
    });

    expect(res.status).toBe(200);
    expect(res.data.schema).toBe('run.v1');

    // Enrichment should be present for deep detail_level
    expect(res.data.enrichment).toBeDefined();
    expect(res.data.enrichment.metadata).toBeDefined();
    expect(res.data.enrichment.metadata.detail_level).toBe('deep');
  });

  /**
   * Test Case C: No enrichment at quick detail_level
   *
   * When detail_level='quick', enrichment should be undefined
   * (no ISL calls are made)
   */
  it('Case C: no enrichment at quick detail_level', async () => {
    vi.resetModules();
    server = await spawnServer({
      env: {
        ...BASE_ENV,
        ISL_ENABLE: '1', // Even with ISL enabled, quick mode skips it
      },
    });

    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-scm-lite': '1',
      },
      body: JSON.stringify({
        graph: SIMPLE_GRAPH,
        seed: 4242,
        k_samples: 100,
        detail_level: 'quick',
      }),
    });

    expect(res.status).toBe(200);
    expect(res.data.schema).toBe('run.v1');

    // Enrichment should be undefined for quick detail_level
    expect(res.data.enrichment).toBeUndefined();
  });

  /**
   * Test Case D: Graceful degradation when ISL disabled
   *
   * When ISL_ENABLE=0, enrichment.metadata.isl_enabled should be false
   * and the response should still succeed
   */
  it('Case D: graceful degradation when ISL disabled', async () => {
    vi.resetModules();
    server = await spawnServer({
      env: {
        ...BASE_ENV,
        ISL_ENABLE: '0',
      },
    });

    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-scm-lite': '1',
      },
      body: JSON.stringify({
        graph: SIMPLE_GRAPH,
        seed: 4242,
        k_samples: 100,
        detail_level: 'deep', // Request deep analysis
      }),
    });

    expect(res.status).toBe(200);
    expect(res.data.schema).toBe('run.v1');

    // Response should succeed with enrichment metadata showing ISL disabled
    expect(res.data.enrichment).toBeDefined();
    expect(res.data.enrichment.metadata.isl_enabled).toBe(false);

    // Core inference should still work
    expect(res.data.results).toBeDefined();
    expect(res.data.results.most_likely).toBeDefined();
  });

  /**
   * Test Case E: Response schema backward compatible
   *
   * All existing response fields should still be present
   * Enrichment is additive, not replacing anything
   */
  it('Case E: response schema backward compatible', async () => {
    vi.resetModules();
    server = await spawnServer({
      env: {
        ...BASE_ENV,
        ISL_ENABLE: '0',
      },
    });

    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-scm-lite': '1',
      },
      body: JSON.stringify({
        graph: SIMPLE_GRAPH,
        seed: 4242,
        k_samples: 100,
        detail_level: 'standard',
      }),
    });

    expect(res.status).toBe(200);

    // Verify all existing response fields are present
    expect(res.data.schema).toBe('run.v1');
    expect(res.data.results).toBeDefined();
    expect(res.data.results.most_likely).toBeDefined();
    expect(res.data.results.conservative).toBeDefined();
    expect(res.data.results.optimistic).toBeDefined();
    expect(res.data.model_card).toBeDefined();
    expect(res.data.confidence).toBeDefined();
    expect(res.data.result).toBeDefined();
    expect(res.data.result.summary).toBeDefined();
    expect(res.data.graph).toBeDefined();

    // Enrichment is additive
    expect(res.data.enrichment).toBeDefined();

    // Legacy fields still present (backward compatibility)
    // isl_validation and isl_sensitivity may or may not be present
    // depending on ISL being enabled
  });

  /**
   * Test: enrichment.metadata includes latency when ISL would run
   */
  it('enrichment.metadata includes detail_level', async () => {
    vi.resetModules();
    server = await spawnServer({
      env: {
        ...BASE_ENV,
        ISL_ENABLE: '0',
      },
    });

    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-scm-lite': '1',
      },
      body: JSON.stringify({
        graph: SIMPLE_GRAPH,
        seed: 4242,
        k_samples: 100,
        detail_level: 'standard',
      }),
    });

    expect(res.status).toBe(200);
    expect(res.data.enrichment.metadata.detail_level).toBe('standard');
    expect(typeof res.data.enrichment.metadata.isl_enabled).toBe('boolean');
  });

  /**
   * Test: Default detail_level is 'standard'
   */
  it('default detail_level is standard (enrichment present)', async () => {
    vi.resetModules();
    server = await spawnServer({
      env: {
        ...BASE_ENV,
        ISL_ENABLE: '0',
      },
    });

    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-scm-lite': '1',
      },
      body: JSON.stringify({
        graph: SIMPLE_GRAPH,
        seed: 4242,
        k_samples: 100,
        // No detail_level specified - should default to 'standard'
      }),
    });

    expect(res.status).toBe(200);
    // Default is 'standard', so enrichment should be present
    expect(res.data.enrichment).toBeDefined();
    expect(res.data.enrichment.metadata.detail_level).toBe('standard');
  });
});
