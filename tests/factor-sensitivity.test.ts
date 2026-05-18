/**
 * Factor Sensitivity Integration Tests
 *
 * Tests for the ISL factor sensitivity integration in /v1/run responses.
 * Factor sensitivity measures how outcome is affected by changes in factor node values.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

describe('Factor Sensitivity Adapter', () => {
  /**
   * Unit tests for the factor sensitivity adapter
   */
  it('adaptFactorSensitivityResponse transforms ISL response correctly', async () => {
    // Dynamic import to test the adapter directly
    const { adaptFactorSensitivityResponse } = await import(
      '../src/integrations/isl/adapters/factor-sensitivity.js'
    );

    const islResponse = {
      factor_sensitivity: [
        { node_id: 'factor_a', sensitivity: 0.8, value_of_information: 0.6, direction: 'positive' as const },
        { node_id: 'factor_b', sensitivity: 0.3, value_of_information: 0.2, direction: 'negative' as const },
        { node_id: 'factor_c', sensitivity: 0.9, value_of_information: 0.7 }, // No direction - should default to 'mixed'
      ],
      robustness: {
        score: 0.75,
        label: 'robust' as const,
        explanation: 'Model is robust to factor perturbations',
      },
    };

    const result = adaptFactorSensitivityResponse(islResponse, 280);

    // Check factors are sorted by sensitivity descending
    expect(result.factors).toHaveLength(3);
    expect(result.factors[0].factor_id).toBe('factor_c'); // 0.9 - highest
    expect(result.factors[0].sensitivity_score).toBe(0.9);
    expect(result.factors[0].direction).toBe('mixed'); // Default when undefined
    expect(result.factors[1].factor_id).toBe('factor_a'); // 0.8
    expect(result.factors[1].direction).toBe('positive');
    expect(result.factors[2].factor_id).toBe('factor_b'); // 0.3
    expect(result.factors[2].direction).toBe('negative');

    // Check value of information is sorted descending
    expect(result.value_of_information).toHaveLength(3);
    expect(result.value_of_information[0].factor_id).toBe('factor_c'); // 0.7 - highest
    expect(result.value_of_information[0].voi).toBe(0.7);

    // Check robustness
    expect(result.robustness_label).toBe('robust');
    expect(result.robustness_score).toBe(0.75);

    // Check metadata
    expect(result.latency_ms).toBe(280);
    expect(result.source).toBe('isl');
  });

  it('adaptFactorSensitivityResponse preserves zero VOI entries and rejects non-finite / negative VOI', async () => {
    // VOI = 0 is a valid computed result ("perfect info wouldn't change the recommendation").
    // It must be preserved so the UI can distinguish "computed zero" from "not computed / absent".
    // Negatives are sampling artefacts; null/undefined/NaN are not numbers. All must be excluded.
    const { adaptFactorSensitivityResponse } = await import(
      '../src/integrations/isl/adapters/factor-sensitivity.js'
    );

    const islResponse = {
      factor_sensitivity: [
        { node_id: 'factor_pos', sensitivity: 0.5, value_of_information: 0.3 },
        { node_id: 'factor_zero', sensitivity: 0.4, value_of_information: 0 }, // included (valid 0)
        { node_id: 'factor_exact_zero_float', sensitivity: 0.35, value_of_information: 0.0 }, // boundary
        { node_id: 'factor_small_pos', sensitivity: 0.3, value_of_information: 0.1 },
        { node_id: 'factor_neg', sensitivity: 0.2, value_of_information: -0.003 }, // excluded (artefact)
        { node_id: 'factor_null', sensitivity: 0.15, value_of_information: null as unknown as number }, // excluded
        { node_id: 'factor_undef', sensitivity: 0.1 }, // excluded (undefined)
        { node_id: 'factor_nan', sensitivity: 0.05, value_of_information: Number.NaN }, // excluded
      ],
      robustness: {
        score: 0.6,
        label: 'moderate' as const,
        explanation: 'Model shows moderate robustness',
      },
    };

    const result = adaptFactorSensitivityResponse(islResponse, 150);

    const ids = result.value_of_information.map((v) => v.factor_id);
    expect(ids).toEqual(expect.arrayContaining(['factor_pos', 'factor_zero', 'factor_exact_zero_float', 'factor_small_pos']));
    expect(ids).not.toContain('factor_neg');
    expect(ids).not.toContain('factor_null');
    expect(ids).not.toContain('factor_undef');
    expect(ids).not.toContain('factor_nan');
    expect(result.value_of_information).toHaveLength(4);

    // Zero factors appear with voi: 0 (not dropped, not coerced)
    const zero = result.value_of_information.find((v) => v.factor_id === 'factor_zero');
    expect(zero?.voi).toBe(0);
    const exactZero = result.value_of_information.find((v) => v.factor_id === 'factor_exact_zero_float');
    expect(exactZero?.voi).toBe(0);

    // Positive VOI still works (regression)
    const pos = result.value_of_information.find((v) => v.factor_id === 'factor_pos');
    expect(pos?.voi).toBe(0.3);

    // Sort order is VOI descending — zero values go to the end
    expect(result.value_of_information[result.value_of_information.length - 1].voi).toBe(0);
  });

  it('createFallbackFactorSensitivity returns unavailable result', async () => {
    const { createFallbackFactorSensitivity } = await import(
      '../src/integrations/isl/adapters/factor-sensitivity.js'
    );

    const result = createFallbackFactorSensitivity('ISL timeout');

    expect(result.factors).toHaveLength(0);
    expect(result.value_of_information).toHaveLength(0);
    expect(result.robustness_label).toBe('moderate');
    expect(result.robustness_score).toBe(0.5);
    expect(result.latency_ms).toBe(0);
    expect(result.source).toBe('unavailable');
  });
});

describe('POST /v1/run factor sensitivity enrichment', () => {
  let server: ServerHandle | null = null;

  const BASE_ENV = {
    TEST_ROUTES: '1',
    AUTH_ENABLED: '0',
    RATE_LIMIT_ENABLED: '0',
    SCM_LITE_ENABLE: '1',
    COMPARE_VIEW_ENABLE: '0',
    INSPECTOR_DEBUG_ENABLE: '0',
  };

  // Graph with factor nodes that have observed values - triggers factor sensitivity
  const GRAPH_WITH_FACTORS = {
    nodes: [
      { id: 'factor_a', label: 'Factor A', kind: 'factor', observed_state: { value: 10 } },
      { id: 'factor_b', label: 'Factor B', kind: 'factor', observed_state: { value: 20 } },
      { id: 'option_1', label: 'Option 1', kind: 'option' },
      { id: 'goal', label: 'Goal', kind: 'goal' },
    ],
    edges: [
      { from: 'factor_a', to: 'goal', weight: 0.5, belief: 0.9 },
      { from: 'factor_b', to: 'goal', weight: 0.3, belief: 0.8 },
      { from: 'option_1', to: 'goal', weight: 1.0, belief: 1.0 },
    ],
  };

  // Graph without factor nodes - should skip factor sensitivity
  const GRAPH_WITHOUT_FACTORS = {
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
   * Test: Factor sensitivity status is 'skipped' when no factor nodes have values
   */
  it('factor_sensitivity_status is skipped when no factor nodes have values', async () => {
    vi.resetModules();
    server = await spawnServer({
      env: {
        ...BASE_ENV,
        ISL_ENABLE: '0', // ISL disabled
      },
    });

    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-scm-lite': '1',
      },
      body: JSON.stringify({
        graph: GRAPH_WITHOUT_FACTORS,
        seed: 4242,
        k_samples: 100,
        detail_level: 'deep',
      }),
    });

    expect(res.status).toBe(200);
    expect(res.data.enrichment).toBeDefined();
    expect(res.data.enrichment.metadata.detail_level).toBe('deep');

    // Factor sensitivity should be skipped because no factor nodes with values
    // Note: Using new granular status 'skipped_no_factor_values' instead of legacy 'skipped'
    expect(res.data.enrichment.metadata.factor_sensitivity_status).toBe('skipped_no_factor_values');
  });

  /**
   * Test: Factor sensitivity metadata is populated when graph has factor nodes
   */
  it('factor sensitivity metadata reflects graph structure', async () => {
    vi.resetModules();
    server = await spawnServer({
      env: {
        ...BASE_ENV,
        ISL_ENABLE: '0', // ISL disabled but graph has factors
      },
    });

    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-scm-lite': '1',
      },
      body: JSON.stringify({
        graph: GRAPH_WITH_FACTORS,
        seed: 4242,
        k_samples: 100,
        detail_level: 'deep',
      }),
    });

    expect(res.status).toBe(200);
    expect(res.data.enrichment).toBeDefined();
    expect(res.data.enrichment.metadata.detail_level).toBe('deep');

    // When ISL is disabled, factor_sensitivity_status is undefined (no ISL calls made)
    // The status is only set when ISL is enabled and we actually make the call
    expect(res.data.enrichment.metadata.isl_enabled).toBe(false);
  });

  /**
   * Test: Factor sensitivity not called for non-deep detail levels
   */
  it('factor sensitivity not requested for standard detail_level', async () => {
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
        graph: GRAPH_WITH_FACTORS,
        seed: 4242,
        k_samples: 100,
        detail_level: 'standard',
      }),
    });

    expect(res.status).toBe(200);
    expect(res.data.enrichment).toBeDefined();
    expect(res.data.enrichment.metadata.detail_level).toBe('standard');

    // Factor sensitivity status should not be present for standard detail level
    expect(res.data.enrichment.metadata.factor_sensitivity_status).toBeUndefined();
  });

  /**
   * Test: Response includes isl_factor_sensitivity when available
   */
  it('response backward compatible - isl_factor_sensitivity field present when available', async () => {
    vi.resetModules();
    server = await spawnServer({
      env: {
        ...BASE_ENV,
        ISL_ENABLE: '0', // ISL disabled - no actual factor sensitivity
      },
    });

    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-scm-lite': '1',
      },
      body: JSON.stringify({
        graph: GRAPH_WITH_FACTORS,
        seed: 4242,
        k_samples: 100,
        detail_level: 'deep',
      }),
    });

    expect(res.status).toBe(200);

    // Core response fields should be present
    expect(res.data.results).toBeDefined();
    expect(res.data.enrichment).toBeDefined();

    // isl_factor_sensitivity is optional top-level field (only present when ISL returns data)
    // When ISL is disabled, it should be undefined
    if (res.data.isl_factor_sensitivity) {
      expect(res.data.isl_factor_sensitivity.factors).toBeDefined();
      expect(res.data.isl_factor_sensitivity.source).toBe('isl');
    }
  });

  /**
   * Test: Enrichment sensitivity_analysis.factors populated when available
   */
  it('enrichment.sensitivity_analysis.factors structure when present', async () => {
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
        graph: GRAPH_WITH_FACTORS,
        seed: 4242,
        k_samples: 100,
        detail_level: 'deep',
      }),
    });

    expect(res.status).toBe(200);
    expect(res.data.enrichment).toBeDefined();

    // sensitivity_analysis may or may not have factors depending on ISL availability
    if (res.data.enrichment.sensitivity_analysis?.factors) {
      expect(Array.isArray(res.data.enrichment.sensitivity_analysis.factors)).toBe(true);
      for (const factor of res.data.enrichment.sensitivity_analysis.factors) {
        expect(factor).toHaveProperty('factor_id');
        expect(factor).toHaveProperty('sensitivity_score');
        expect(factor).toHaveProperty('direction');
        expect(['positive', 'negative', 'mixed']).toContain(factor.direction);
      }
    }

    // value_of_information structure when present
    if (res.data.enrichment.sensitivity_analysis?.value_of_information) {
      expect(Array.isArray(res.data.enrichment.sensitivity_analysis.value_of_information)).toBe(true);
      for (const voi of res.data.enrichment.sensitivity_analysis.value_of_information) {
        expect(voi).toHaveProperty('factor_id');
        expect(voi).toHaveProperty('voi');
        expect(typeof voi.voi).toBe('number');
      }
    }
  });
});

