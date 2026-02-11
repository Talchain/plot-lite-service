/**
 * @talchain/schemas adoption tests — CIL Phase 1
 *
 * Verifies that plot-lite-service uses shared schema definitions correctly:
 * 1. Contract test: shared fixture validates against @talchain/schemas
 * 2. Limit alignment: /v1/limits returns values matching LIMITS from @talchain/schemas
 * 3. Error ownership: PLoT-generated errors use correct schema types
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  LIMITS,
  NodeV3Schema,
  EdgeV3Schema,
  GraphV3Schema,
  SeedSource,
  DetailLevel,
  CeeTypedErrorSchema,
  PlotCeeUpstreamEnvelopeSchema,
  PlotProxyTimeoutErrorSchema,
  RepairEntrySchema,
  NODE_ID_PATTERN,
} from '@talchain/schemas';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

// =============================================================================
// Shared fixture — canonical graph that validates against @talchain/schemas
// =============================================================================

const CANONICAL_GRAPH = {
  nodes: [
    { id: 'factor-a', kind: 'factor', label: 'Factor A', observed_state: { value: 50 } },
    { id: 'factor-b', kind: 'factor', label: 'Factor B', observed_state: { value: 30 } },
    { id: 'goal', kind: 'goal', label: 'Goal' },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
    { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.15 } },
  ],
};

// =============================================================================
// 1. Contract test: shared fixture validates against schemas
// =============================================================================

describe('@talchain/schemas contract tests', () => {
  it('canonical node validates against NodeV3Schema', () => {
    for (const node of CANONICAL_GRAPH.nodes) {
      const result = NodeV3Schema.safeParse(node);
      expect(result.success, `Node "${node.id}" failed validation: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it('canonical edge validates against EdgeV3Schema', () => {
    for (const edge of CANONICAL_GRAPH.edges) {
      const result = EdgeV3Schema.safeParse(edge);
      expect(result.success, `Edge "${edge.from}->${edge.to}" failed validation: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it('canonical graph validates against GraphV3Schema', () => {
    const result = GraphV3Schema.safeParse(CANONICAL_GRAPH);
    expect(result.success, `Graph failed validation: ${JSON.stringify(result.error?.issues)}`).toBe(true);
  });

  it('NODE_ID_PATTERN matches schema definition', () => {
    // PLoT re-exports NODE_ID_PATTERN from @talchain/schemas
    expect(NODE_ID_PATTERN.source).toBe('^[a-z0-9_:-]+$');
    expect(NODE_ID_PATTERN.test('factor-a')).toBe(true);
    expect(NODE_ID_PATTERN.test('goal')).toBe(true);
    expect(NODE_ID_PATTERN.test('Factor A')).toBe(false); // No uppercase
  });

  it('SeedSource enum has expected values', () => {
    expect(SeedSource.options).toContain('client_generated');
    expect(SeedSource.options).toContain('server_generated');
    expect(SeedSource.safeParse('client_generated').success).toBe(true);
    expect(SeedSource.safeParse('server_generated').success).toBe(true);
    expect(SeedSource.safeParse('invalid').success).toBe(false);
  });

  it('DetailLevel enum has expected values', () => {
    expect(DetailLevel.options).toContain('quick');
    expect(DetailLevel.options).toContain('standard');
    expect(DetailLevel.options).toContain('deep');
    expect(DetailLevel.safeParse('standard').success).toBe(true);
    expect(DetailLevel.safeParse('invalid').success).toBe(false);
  });

  it('LIMITS match expected values', () => {
    expect(LIMITS.MAX_NODES).toBe(50);
    expect(LIMITS.MAX_EDGES).toBe(100);
    expect(LIMITS.MAX_OPTIONS).toBe(10);
  });
});

// =============================================================================
// 2. Limit alignment: /v1/limits returns values matching LIMITS
// =============================================================================

describe('@talchain/schemas limit alignment', () => {
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

  it('/v1/limits returns values ≤ LIMITS from @talchain/schemas', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const res = await requestJSON(`${server.baseUrl}/v1/limits`, {
      method: 'GET',
    });

    expect(res.status).toBe(200);
    // Service limits must not exceed shared canonical limits
    expect(res.data.max_nodes).toBeLessThanOrEqual(LIMITS.MAX_NODES);
    expect(res.data.max_edges).toBeLessThanOrEqual(LIMITS.MAX_EDGES);
    expect(res.data.max_options).toBeLessThanOrEqual(LIMITS.MAX_OPTIONS);
    // Default (no env override) should exactly match
    expect(res.data.max_nodes).toBe(LIMITS.MAX_NODES);
    expect(res.data.max_edges).toBe(LIMITS.MAX_EDGES);
    expect(res.data.max_options).toBe(LIMITS.MAX_OPTIONS);
  });
});

// =============================================================================
// 3. Error ownership: PLoT errors use correct schema types
// =============================================================================

describe('@talchain/schemas error ownership', () => {
  it('PlotCeeUpstreamEnvelopeSchema validates PLoT upstream error', () => {
    const plotError = {
      error: 'CEE_UPSTREAM_ERROR',
      message: 'CEE returned non-JSON 502 response',
      retryable: true,
      upstream_content_type: 'text/html',
      upstream_body_preview: '<html>Bad Gateway</html>',
      elapsed_ms: 1234,
      request_id: 'req-1',
    };
    const result = PlotCeeUpstreamEnvelopeSchema.safeParse(plotError);
    expect(result.success).toBe(true);
  });

  it('PlotProxyTimeoutErrorSchema validates PLoT timeout error', () => {
    const timeoutError = {
      error: 'CEE_PROXY_TIMEOUT',
      message: 'CEE did not respond within 105s',
      retryable: true,
      elapsed_ms: 105000,
      request_id: 'req-2',
    };
    const result = PlotProxyTimeoutErrorSchema.safeParse(timeoutError);
    expect(result.success).toBe(true);
  });

  it('PLoT errors are NOT CEE typed errors', () => {
    // PLoT-generated errors should NOT validate as CeeTypedError
    // (they use different error codes)
    const plotUpstreamError = {
      error: 'CEE_UPSTREAM_ERROR',
      message: 'CEE returned non-JSON response',
      retryable: true,
    };
    const plotTimeoutError = {
      error: 'CEE_PROXY_TIMEOUT',
      message: 'CEE did not respond within 105s',
      retryable: true,
      elapsed_ms: 105000,
      request_id: 'req-1',
    };

    // CEE_UPSTREAM_ERROR and CEE_PROXY_TIMEOUT are NOT in CeeErrorCode enum
    expect(CeeTypedErrorSchema.safeParse(plotUpstreamError).success).toBe(false);
    expect(CeeTypedErrorSchema.safeParse(plotTimeoutError).success).toBe(false);
  });

  it('CEE errors ARE CEE typed errors', () => {
    // CEE-generated errors should validate as CeeTypedError
    const ceeLlmTimeout = {
      error: 'CEE_LLM_TIMEOUT',
      message: 'LLM did not respond',
      retryable: true,
      elapsed_ms: 90000,
    };
    expect(CeeTypedErrorSchema.safeParse(ceeLlmTimeout).success).toBe(true);

    const ceeBudget = {
      error: 'CEE_REQUEST_BUDGET_EXCEEDED',
      message: 'Budget exceeded',
      retryable: true,
    };
    expect(CeeTypedErrorSchema.safeParse(ceeBudget).success).toBe(true);
  });
});
