/**
 * Edge Function Suggestion Proxy Tests
 *
 * Tests for POST /v1/suggest/edge-function endpoint:
 * - Request validation
 * - Node enrichment from graph
 * - CEE proxy integration
 * - Fallback behavior
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerSuggestEdgeFunctionRoute } from '../src/routes/v1/suggest-edge-function.js';

describe('POST /v1/suggest/edge-function', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await registerSuggestEdgeFunctionRoute(app);
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('request validation', () => {
    it('returns 400 when edge_id is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/suggest/edge-function',
        payload: {
          source_node: { id: 'A' },
          target_node: { id: 'B' },
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('BAD_INPUT');
      expect(body.message).toContain('edge_id');
    });

    it('returns 400 when source_node.id is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/suggest/edge-function',
        payload: {
          edge_id: 'A->B',
          source_node: {},
          target_node: { id: 'B' },
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('BAD_INPUT');
      expect(body.message).toContain('source_node.id');
    });

    it('returns 400 when target_node.id is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/suggest/edge-function',
        payload: {
          edge_id: 'A->B',
          source_node: { id: 'A' },
          target_node: {},
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('BAD_INPUT');
      expect(body.message).toContain('target_node.id');
    });
  });

  describe('fallback behavior (CEE disabled)', () => {
    beforeEach(() => {
      // Ensure CEE is disabled
      delete process.env.CEE_EDGE_FUNCTION_ENABLE;
      delete process.env.CEE_ORCHESTRATOR_ENABLE;
    });

    it('returns linear fallback when CEE is disabled', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/suggest/edge-function',
        payload: {
          edge_id: 'marketing->revenue',
          source_node: { id: 'marketing', label: 'Marketing Spend' },
          target_node: { id: 'revenue', label: 'Revenue' },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.schema).toBe('edge_function_suggestion.v1');
      expect(body.suggestion.suggested_function).toBe('linear');
      expect(body.suggestion.suggested_params).toEqual({});
      expect(body.suggestion.confidence).toBe('low');
      expect(body.suggestion.reasoning).toContain('CEE unavailable');
      expect(body.provenance).toBe('plot_fallback');
    });

    it('returns correct edge_context in response', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/suggest/edge-function',
        payload: {
          edge_id: 'A->B',
          source_node: { id: 'A', label: 'Node A', kind: 'action' },
          target_node: { id: 'B', label: 'Node B', kind: 'outcome' },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.edge_context).toEqual({
        edge_id: 'A->B',
        source_node: { id: 'A', label: 'Node A', kind: 'action' },
        target_node: { id: 'B', label: 'Node B', kind: 'outcome' },
      });
    });
  });

  describe('node enrichment from graph', () => {
    beforeEach(() => {
      delete process.env.CEE_EDGE_FUNCTION_ENABLE;
      delete process.env.CEE_ORCHESTRATOR_ENABLE;
    });

    it('enriches source_node label from graph', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/suggest/edge-function',
        payload: {
          edge_id: 'A->B',
          source_node: { id: 'A' },
          target_node: { id: 'B', label: 'Target' },
          graph: {
            nodes: [
              { id: 'A', label: 'Enriched Source', kind: 'decision' },
              { id: 'B', label: 'Enriched Target', kind: 'outcome' },
            ],
            edges: [{ from: 'A', to: 'B' }],
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.edge_context.source_node.label).toBe('Enriched Source');
      expect(body.edge_context.source_node.kind).toBe('decision');
    });

    it('enriches target_node label from graph', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/suggest/edge-function',
        payload: {
          edge_id: 'A->B',
          source_node: { id: 'A', label: 'Source' },
          target_node: { id: 'B' },
          graph: {
            nodes: [
              { id: 'A', label: 'Graph Source' },
              { id: 'B', label: 'Graph Target', kind: 'outcome' },
            ],
            edges: [],
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.edge_context.target_node.label).toBe('Graph Target');
      expect(body.edge_context.target_node.kind).toBe('outcome');
    });

    it('prefers explicit label over graph label', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/suggest/edge-function',
        payload: {
          edge_id: 'A->B',
          source_node: { id: 'A', label: 'Explicit Label' },
          target_node: { id: 'B', label: 'Explicit Target' },
          graph: {
            nodes: [
              { id: 'A', label: 'Graph Label' },
              { id: 'B', label: 'Graph Target' },
            ],
            edges: [],
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.edge_context.source_node.label).toBe('Explicit Label');
      expect(body.edge_context.target_node.label).toBe('Explicit Target');
    });

    it('enriches kind from graph when not provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/suggest/edge-function',
        payload: {
          edge_id: 'X->Y',
          source_node: { id: 'X' },
          target_node: { id: 'Y' },
          graph: {
            nodes: [
              { id: 'X', label: 'Source', kind: 'goal' },
              { id: 'Y', label: 'Target', kind: 'decision' },
            ],
            edges: [],
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.edge_context.source_node.kind).toBe('goal');
      expect(body.edge_context.target_node.kind).toBe('decision');
    });

    it('handles node not found in graph gracefully', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/suggest/edge-function',
        payload: {
          edge_id: 'X->Y',
          source_node: { id: 'X' },
          target_node: { id: 'Y' },
          graph: {
            nodes: [{ id: 'Z', label: 'Other Node' }],
            edges: [],
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      // Should use id as fallback for label
      expect(body.edge_context.source_node.id).toBe('X');
      expect(body.edge_context.target_node.id).toBe('Y');
    });
  });

  describe('CEE proxy integration', () => {
    const originalFetch = global.fetch;
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      process.env.CEE_EDGE_FUNCTION_ENABLE = '1';
      process.env.CEE_BASE_URL = 'http://cee.test';
      process.env.CEE_API_KEY = 'test-key';
      mockFetch = vi.fn();
      global.fetch = mockFetch;
    });

    afterEach(() => {
      delete process.env.CEE_EDGE_FUNCTION_ENABLE;
      delete process.env.CEE_BASE_URL;
      delete process.env.CEE_API_KEY;
      global.fetch = originalFetch;
    });

    it('calls CEE endpoint when enabled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          suggested_function: 'diminishing_returns',
          suggested_params: { k: 0.5 },
          reasoning: 'Marketing typically shows diminishing returns',
          confidence: 'high',
        }),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/suggest/edge-function',
        payload: {
          edge_id: 'marketing->revenue',
          source_node: { id: 'marketing', label: 'Marketing' },
          target_node: { id: 'revenue', label: 'Revenue' },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.suggestion.suggested_function).toBe('diminishing_returns');
      expect(body.suggestion.suggested_params).toEqual({ k: 0.5 });
      expect(body.provenance).toBe('cee');

      // Verify fetch was called correctly
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://cee.test/assist/v1/suggest-edge-function');
      expect(options.method).toBe('POST');
      expect(options.headers['Authorization']).toBe('Bearer test-key');
    });

    it('falls back when CEE returns HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/suggest/edge-function',
        payload: {
          edge_id: 'A->B',
          source_node: { id: 'A' },
          target_node: { id: 'B' },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.suggestion.suggested_function).toBe('linear');
      expect(body.provenance).toBe('plot_fallback');
      expect(body.cee_error).toBeDefined();
      expect(body.cee_error.code).toBe('CEE_HTTP_500');
      expect(body.cee_error.retryable).toBe(true);
    });

    it('falls back when CEE fetch fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const res = await app.inject({
        method: 'POST',
        url: '/v1/suggest/edge-function',
        payload: {
          edge_id: 'A->B',
          source_node: { id: 'A' },
          target_node: { id: 'B' },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.suggestion.suggested_function).toBe('linear');
      expect(body.provenance).toBe('plot_fallback');
      expect(body.cee_error).toBeDefined();
      expect(body.cee_error.code).toBe('CEE_FETCH_ERROR');
    });

    it('falls back when CEE config is missing', async () => {
      delete process.env.CEE_BASE_URL;

      const res = await app.inject({
        method: 'POST',
        url: '/v1/suggest/edge-function',
        payload: {
          edge_id: 'A->B',
          source_node: { id: 'A' },
          target_node: { id: 'B' },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.provenance).toBe('plot_fallback');
      expect(body.cee_error?.code).toBe('CEE_CONFIG_MISSING');
    });

    it('includes relationship_description in CEE request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          suggested_function: 's_curve',
          suggested_params: { k: 1.0, midpoint: 50 },
          reasoning: 'Adoption follows S-curve pattern',
          confidence: 'medium',
        }),
      });

      await app.inject({
        method: 'POST',
        url: '/v1/suggest/edge-function',
        payload: {
          edge_id: 'adoption->sales',
          source_node: { id: 'adoption' },
          target_node: { id: 'sales' },
          relationship_description: 'Market adoption drives sales with typical S-curve pattern',
        },
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.relationship_description).toBe(
        'Market adoption drives sales with typical S-curve pattern'
      );
    });
  });

  describe('response schema', () => {
    beforeEach(() => {
      delete process.env.CEE_EDGE_FUNCTION_ENABLE;
    });

    it('always includes required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/suggest/edge-function',
        payload: {
          edge_id: 'A->B',
          source_node: { id: 'A' },
          target_node: { id: 'B' },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // Required fields
      expect(body.schema).toBe('edge_function_suggestion.v1');
      expect(body.suggestion).toBeDefined();
      expect(body.suggestion.suggested_function).toBeDefined();
      expect(body.suggestion.suggested_params).toBeDefined();
      expect(body.suggestion.reasoning).toBeDefined();
      expect(body.suggestion.confidence).toBeDefined();
      expect(body.edge_context).toBeDefined();
      expect(body.provenance).toBeDefined();
    });
  });
});
