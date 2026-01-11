/**
 * Analysis Sequential Proxy Tests
 *
 * Phase 4: Sequential & Advanced
 * Tests for POST /v1/analysis/sequential - multi-stage decision analysis
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerSequentialAnalysisRoute } from '../src/routes/v1/analysis-sequential.js';
import {
  resetIslCircuitBreaker,
  recordIslFailure,
  getIslCircuitBreakerStats,
} from '../src/integrations/isl-circuit-breaker.js';

describe('POST /v1/analysis/sequential', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await registerSequentialAnalysisRoute(app);
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    delete process.env.ENABLE_SEQUENTIAL_ANALYSIS;
    delete process.env.ISL_SEQUENTIAL_ENABLE;
    delete process.env.ISL_ENABLE;
    delete process.env.ISL_BASE_URL;
    delete process.env.ISL_API_KEY;
    resetIslCircuitBreaker();
  });

  describe('feature flag', () => {
    it('returns 501 when ENABLE_SEQUENTIAL_ANALYSIS is not set', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/sequential',
        payload: {
          graph: {
            nodes: [{ id: 'a', label: 'A' }],
            edges: [],
          },
        },
      });

      expect(res.statusCode).toBe(501);
      const body = JSON.parse(res.payload);
      expect(body.message).toContain('Sequential analysis is not enabled');
      expect(body.message).toContain('ENABLE_SEQUENTIAL_ANALYSIS');
    });

    it('returns 501 when ENABLE_SEQUENTIAL_ANALYSIS is 0', async () => {
      process.env.ENABLE_SEQUENTIAL_ANALYSIS = '0';

      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/sequential',
        payload: {
          graph: {
            nodes: [{ id: 'a', label: 'A' }],
            edges: [],
          },
        },
      });

      expect(res.statusCode).toBe(501);
    });

    it('allows requests when ENABLE_SEQUENTIAL_ANALYSIS=1', async () => {
      process.env.ENABLE_SEQUENTIAL_ANALYSIS = '1';

      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/sequential',
        payload: {
          graph: {
            nodes: [
              { id: 'stage1_opt1', label: 'Option 1', kind: 'option', stage: 1 },
              { id: 'outcome', label: 'Outcome', kind: 'outcome', stage: 2 },
            ],
            edges: [{ from: 'stage1_opt1', to: 'outcome' }],
            sequential_metadata: {
              stages: [
                { index: 1, label: 'Stage 1' },
                { index: 2, label: 'Stage 2' },
              ],
            },
          },
        },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe('validation', () => {
    beforeEach(() => {
      process.env.ENABLE_SEQUENTIAL_ANALYSIS = '1';
    });

    it('returns 400 when graph is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/sequential',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.message).toContain('graph');
    });

    it('returns 400 when graph.nodes is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/sequential',
        payload: {
          graph: { edges: [] },
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.message).toContain('nodes');
    });

    it('returns 400 when graph exceeds node limit', async () => {
      const nodes = Array.from({ length: 51 }, (_, i) => ({
        id: `node${i}`,
        label: `Node ${i}`,
      }));

      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/sequential',
        payload: {
          graph: { nodes, edges: [] },
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.message).toContain('max');
      expect(body.message).toContain('nodes');
    });

    it('returns 400 when discount_factor out of range', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/sequential',
        payload: {
          graph: {
            nodes: [{ id: 'a', label: 'A' }],
            edges: [],
          },
          discount_factor: 1.5, // Invalid: must be 0-1
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.message).toContain('discount_factor');
    });

    it('returns 400 when discount_factor is negative', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/sequential',
        payload: {
          graph: {
            nodes: [{ id: 'a', label: 'A' }],
            edges: [],
          },
          discount_factor: -0.1,
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('local fallback', () => {
    beforeEach(() => {
      process.env.ENABLE_SEQUENTIAL_ANALYSIS = '1';
    });

    it('returns analysis results with fallback when ISL disabled', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/sequential',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option', stage: 1 },
              { id: 'opt2', label: 'Option 2', kind: 'option', stage: 1 },
              { id: 'outcome', label: 'Outcome', kind: 'outcome', stage: 2 },
            ],
            edges: [
              { from: 'opt1', to: 'outcome', weight: 0.8 },
              { from: 'opt2', to: 'outcome', weight: 0.6 },
            ],
            sequential_metadata: {
              stages: [
                { index: 1, label: 'Decision Stage' },
                { index: 2, label: 'Outcome Stage' },
              ],
            },
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.schema).toBe('sequential_analysis.v1');
      expect(body.provenance).toBe('plot_fallback');
      expect(body.analysis).toBeDefined();
      expect(body.analysis.overall_expected_value).toBeDefined();
      expect(body.analysis.overall_confidence).toBeDefined();
      expect(body.analysis.strategy_summary).toBeDefined();
    });

    it('returns model_card with parameters', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/sequential',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option', stage: 1 },
              { id: 'outcome', label: 'Outcome' },
            ],
            edges: [{ from: 'opt1', to: 'outcome' }],
          },
          seed: 1234,
          discount_factor: 0.95,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.model_card).toBeDefined();
      expect(body.model_card.seed).toBe(1234);
      expect(body.model_card.discount_factor).toBe(0.95);
      expect(body.model_card.nodes).toBe(2);
      expect(body.model_card.edges).toBe(1);
    });

    it('uses default discount_factor of 1.0', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/sequential',
        payload: {
          graph: {
            nodes: [{ id: 'a', label: 'A' }],
            edges: [],
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.model_card.discount_factor).toBe(1.0);
    });

    it('includes validation results', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/sequential',
        payload: {
          graph: {
            nodes: [
              { id: 'a', label: 'A', stage: 1 },
              { id: 'b', label: 'B', stage: 2 },
            ],
            edges: [{ from: 'a', to: 'b' }],
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.validation).toBeDefined();
      expect(body.validation).toHaveProperty('valid');
      expect(body.validation).toHaveProperty('stage_count');
      expect(body.validation).toHaveProperty('issues');
    });
  });

  describe('ISL integration', () => {
    beforeEach(() => {
      process.env.ENABLE_SEQUENTIAL_ANALYSIS = '1';
    });

    it('includes isl_error when ISL configured but unavailable', async () => {
      process.env.ISL_ENABLE = '1'; // Enable ISL globally
      process.env.ISL_SEQUENTIAL_ENABLE = '1';
      process.env.ISL_BASE_URL = 'http://localhost:9999';
      process.env.ISL_API_KEY = 'test-key';

      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/sequential',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option', stage: 1 },
              { id: 'outcome', label: 'Outcome' },
            ],
            edges: [{ from: 'opt1', to: 'outcome' }],
            sequential_metadata: {
              stages: [{ index: 1, label: 'Stage 1' }],
            },
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.provenance).toBe('plot_fallback');
      expect(body.isl_error).toBeDefined();
      expect(body.isl_error.retryable).toBe(true);
    });

    it('includes isl_error when ISL config missing', async () => {
      process.env.ISL_SEQUENTIAL_ENABLE = '1';

      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/sequential',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option', stage: 1 },
              { id: 'outcome', label: 'Outcome' },
            ],
            edges: [{ from: 'opt1', to: 'outcome' }],
            sequential_metadata: {
              stages: [{ index: 1, label: 'Stage 1' }],
            },
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.isl_error).toBeDefined();
      expect(body.isl_error.code).toBe('ISL_NOT_ENABLED');
    });
  });

  describe('circuit breaker integration', () => {
    beforeEach(() => {
      process.env.ENABLE_SEQUENTIAL_ANALYSIS = '1';
    });

    it('uses fallback when circuit breaker is open', async () => {
      process.env.ISL_SEQUENTIAL_ENABLE = '1';
      process.env.ISL_BASE_URL = 'http://localhost:9999';
      process.env.ISL_API_KEY = 'test-key';

      // Open the circuit breaker
      recordIslFailure();
      recordIslFailure();
      recordIslFailure();
      expect(getIslCircuitBreakerStats().state).toBe('open');

      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/sequential',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option', stage: 1 },
              { id: 'outcome', label: 'Outcome' },
            ],
            edges: [{ from: 'opt1', to: 'outcome' }],
            sequential_metadata: {
              stages: [{ index: 1, label: 'Stage 1' }],
            },
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.provenance).toBe('plot_fallback');
      expect(body.isl_error).toBeDefined();
      expect(body.isl_error.code).toBe('ISL_CIRCUIT_BREAKER_OPEN');
      expect(body.isl_error.retryable).toBe(true);
    });

    it('does not report circuit breaker error when ISL disabled', async () => {
      // Circuit breaker open but ISL disabled
      recordIslFailure();
      recordIslFailure();
      recordIslFailure();

      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/sequential',
        payload: {
          graph: {
            nodes: [{ id: 'a', label: 'A' }],
            edges: [],
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.provenance).toBe('plot_fallback');
      expect(body.isl_error).toBeUndefined();
    });

    it('circuit breaker allows calls when closed', async () => {
      process.env.ISL_SEQUENTIAL_ENABLE = '1';
      expect(getIslCircuitBreakerStats().state).toBe('closed');

      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/sequential',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option', stage: 1 },
              { id: 'outcome', label: 'Outcome' },
            ],
            edges: [{ from: 'opt1', to: 'outcome' }],
            sequential_metadata: {
              stages: [{ index: 1, label: 'Stage 1' }],
            },
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      // Should show ISL_NOT_ENABLED (config missing), not circuit breaker
      expect(body.isl_error.code).toBe('ISL_NOT_ENABLED');
    });
  });

  describe('stage processing', () => {
    beforeEach(() => {
      process.env.ENABLE_SEQUENTIAL_ANALYSIS = '1';
    });

    it('processes multi-stage graphs', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/sequential',
        payload: {
          graph: {
            nodes: [
              { id: 's1_a', label: 'Stage 1 Option A', kind: 'option', stage: 1 },
              { id: 's1_b', label: 'Stage 1 Option B', kind: 'option', stage: 1 },
              { id: 's2_a', label: 'Stage 2 Option A', kind: 'decision', stage: 2 },
              { id: 'outcome', label: 'Final Outcome', kind: 'outcome', stage: 3 },
            ],
            edges: [
              { from: 's1_a', to: 's2_a' },
              { from: 's1_b', to: 's2_a' },
              { from: 's2_a', to: 'outcome' },
            ],
            sequential_metadata: {
              stages: [
                { index: 1, label: 'Initial Choice' },
                { index: 2, label: 'Follow-up Decision' },
                { index: 3, label: 'Final Outcome' },
              ],
            },
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.model_card.stages).toBeGreaterThan(0);
    });

    it('detects outcome node automatically', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/sequential',
        payload: {
          graph: {
            nodes: [
              { id: 'decision', label: 'Decision', kind: 'option' },
              { id: 'result', label: 'Result', kind: 'outcome' },
            ],
            edges: [{ from: 'decision', to: 'result' }],
          },
        },
      });

      expect(res.statusCode).toBe(200);
    });
  });
});
