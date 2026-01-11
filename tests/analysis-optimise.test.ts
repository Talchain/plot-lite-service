/**
 * Analysis Optimise Proxy Tests
 *
 * Tests for POST /v1/analysis/optimise - continuous variable optimisation proxy
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerAnalysisOptimiseRoute } from '../src/routes/v1/analysis-optimise.js';
import {
  resetIslCircuitBreaker,
  recordIslFailure,
  getIslCircuitBreakerStats,
} from '../src/integrations/isl-circuit-breaker.js';

describe('POST /v1/analysis/optimise', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await registerAnalysisOptimiseRoute(app);
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    delete process.env.ISL_OPTIMISE_ENABLE;
    delete process.env.ISL_ENABLE;
    resetIslCircuitBreaker();
  });

  describe('validation', () => {
    it('returns 400 when decision_variable is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/optimise',
        payload: {
          search_range: [0, 100],
          objective_node: 'revenue',
          graph: {
            nodes: [{ id: 'price', label: 'Price' }],
            edges: [],
          },
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('BAD_INPUT');
      expect(body.message).toContain('decision_variable');
    });

    it('returns 400 when search_range is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/optimise',
        payload: {
          decision_variable: 'price',
          objective_node: 'revenue',
          graph: {
            nodes: [{ id: 'price', label: 'Price' }],
            edges: [],
          },
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.message).toContain('search_range');
    });

    it('returns 400 when search_range is not [min, max]', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/optimise',
        payload: {
          decision_variable: 'price',
          search_range: [100, 50], // max < min
          objective_node: 'revenue',
          graph: {
            nodes: [{ id: 'price', label: 'Price' }],
            edges: [],
          },
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.message).toContain('min < max');
    });

    it('returns 400 when objective_node is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/optimise',
        payload: {
          decision_variable: 'price',
          search_range: [50, 150],
          graph: {
            nodes: [{ id: 'price', label: 'Price' }],
            edges: [],
          },
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.message).toContain('objective_node');
    });

    it('returns 400 when graph is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/optimise',
        payload: {
          decision_variable: 'price',
          search_range: [50, 150],
          objective_node: 'revenue',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.message).toContain('graph');
    });

    it('returns 400 when decision_variable not in graph', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/optimise',
        payload: {
          decision_variable: 'price',
          search_range: [50, 150],
          objective_node: 'revenue',
          graph: {
            nodes: [{ id: 'revenue', label: 'Revenue' }],
            edges: [],
          },
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.message).toContain("'price' not found");
    });

    it('returns 400 when objective_node not in graph', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/optimise',
        payload: {
          decision_variable: 'price',
          search_range: [50, 150],
          objective_node: 'revenue',
          graph: {
            nodes: [{ id: 'price', label: 'Price' }],
            edges: [],
          },
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.message).toContain("'revenue' not found");
    });

    it('returns 400 when grid_points out of range', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/optimise',
        payload: {
          decision_variable: 'price',
          search_range: [50, 150],
          objective_node: 'revenue',
          graph: {
            nodes: [
              { id: 'price', label: 'Price' },
              { id: 'revenue', label: 'Revenue' },
            ],
            edges: [],
          },
          grid_points: 200, // exceeds max of 100
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.message).toContain('grid_points');
    });

    it('returns 400 when graph exceeds node limit', async () => {
      const nodes = Array.from({ length: 51 }, (_, i) => ({
        id: `node${i}`,
        label: `Node ${i}`,
      }));
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/optimise',
        payload: {
          decision_variable: 'node0',
          search_range: [0, 100],
          objective_node: 'node1',
          graph: { nodes, edges: [] },
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.message).toContain('max');
      expect(body.message).toContain('nodes');
    });

    it('returns 400 when constraints exceed limit', async () => {
      const constraints = Array.from({ length: 21 }, (_, i) => ({
        node_id: `node${i}`,
        operator: '>=',
        value: 0,
      }));
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/optimise',
        payload: {
          decision_variable: 'price',
          search_range: [0, 100],
          objective_node: 'revenue',
          graph: {
            nodes: [
              { id: 'price', label: 'Price' },
              { id: 'revenue', label: 'Revenue' },
            ],
            edges: [],
          },
          constraints,
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.message).toContain('constraints');
    });
  });

  describe('local fallback', () => {
    it('returns optimisation results with fallback when ISL disabled', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/optimise',
        payload: {
          decision_variable: 'price',
          search_range: [50, 150],
          objective_node: 'revenue',
          objective_direction: 'maximise',
          graph: {
            nodes: [
              { id: 'price', label: 'Price', type: 'decision' },
              { id: 'demand', label: 'Demand', type: 'outcome' },
              { id: 'revenue', label: 'Revenue', type: 'outcome' },
            ],
            edges: [
              { from: 'price', to: 'demand', weight: -0.5 },
              { from: 'price', to: 'revenue', weight: 1.0 },
              { from: 'demand', to: 'revenue', weight: 0.8 },
            ],
          },
          grid_points: 10,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.schema).toBe('continuous_optimise.v1');
      expect(body.provenance).toBe('plot_fallback');
      expect(body.result).toBeDefined();
      expect(body.result.optimal_value).toBeDefined();
      expect(body.result.optimal_objective).toBeDefined();
      expect(body.result.confidence_interval).toHaveLength(2);
      expect(body.result.sensitivity).toBeDefined();
      expect(body.result.search_results).toBeInstanceOf(Array);
      expect(body.result.constraints_satisfied).toBe(true);
      expect(body.result.warnings).toContain('Using local fallback - ISL unavailable');
    });

    it('returns model_card with parameters', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/optimise',
        payload: {
          decision_variable: 'price',
          search_range: [50, 150],
          objective_node: 'revenue',
          objective_direction: 'minimise',
          graph: {
            nodes: [
              { id: 'price', label: 'Price' },
              { id: 'revenue', label: 'Revenue' },
            ],
            edges: [{ from: 'price', to: 'revenue' }],
          },
          grid_points: 15,
          refine: true,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.model_card).toBeDefined();
      expect(body.model_card.decision_variable).toBe('price');
      expect(body.model_card.objective_node).toBe('revenue');
      expect(body.model_card.objective_direction).toBe('minimise');
      expect(body.model_card.search_range).toEqual([50, 150]);
      expect(body.model_card.grid_points).toBe(15);
      expect(body.model_card.refine).toBe(true);
      expect(body.model_card.nodes).toBe(2);
      expect(body.model_card.edges).toBe(1);
    });

    it('uses default values for optional parameters', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/optimise',
        payload: {
          decision_variable: 'price',
          search_range: [0, 100],
          objective_node: 'revenue',
          graph: {
            nodes: [
              { id: 'price', label: 'Price' },
              { id: 'revenue', label: 'Revenue' },
            ],
            edges: [],
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.model_card.objective_direction).toBe('maximise');
      expect(body.model_card.grid_points).toBe(20); // default
      expect(body.model_card.refine).toBe(false); // default
    });

    it('optimal value is within search range', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/optimise',
        payload: {
          decision_variable: 'x',
          search_range: [10, 90],
          objective_node: 'y',
          graph: {
            nodes: [
              { id: 'x', label: 'X' },
              { id: 'y', label: 'Y' },
            ],
            edges: [],
          },
          grid_points: 20,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.result.optimal_value).toBeGreaterThanOrEqual(10);
      expect(body.result.optimal_value).toBeLessThanOrEqual(90);
    });

    it('confidence interval is within search range', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/optimise',
        payload: {
          decision_variable: 'x',
          search_range: [0, 100],
          objective_node: 'y',
          graph: {
            nodes: [
              { id: 'x', label: 'X' },
              { id: 'y', label: 'Y' },
            ],
            edges: [],
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      const [ciLow, ciHigh] = body.result.confidence_interval;
      expect(ciLow).toBeGreaterThanOrEqual(0);
      expect(ciHigh).toBeLessThanOrEqual(100);
      expect(ciLow).toBeLessThanOrEqual(ciHigh);
    });

    it('search_results has expected number of points', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/optimise',
        payload: {
          decision_variable: 'x',
          search_range: [0, 100],
          objective_node: 'y',
          graph: {
            nodes: [
              { id: 'x', label: 'X' },
              { id: 'y', label: 'Y' },
            ],
            edges: [],
          },
          grid_points: 11,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.result.search_results).toHaveLength(11);
      // Verify results are sorted by value
      const values = body.result.search_results.map((r: any) => r.value);
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
      }
    });
  });

  describe('ISL integration', () => {
    it('includes isl_error when ISL configured but unavailable', async () => {
      process.env.ISL_ENABLE = '1'; // Enable ISL globally
      process.env.ISL_OPTIMISE_ENABLE = '1';
      process.env.ISL_BASE_URL = 'http://localhost:9999'; // unavailable
      process.env.ISL_API_KEY = 'test-key';

      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/optimise',
        payload: {
          decision_variable: 'price',
          search_range: [50, 150],
          objective_node: 'revenue',
          graph: {
            nodes: [
              { id: 'price', label: 'Price' },
              { id: 'revenue', label: 'Revenue' },
            ],
            edges: [],
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      // Should fall back but include ISL error info
      expect(body.provenance).toBe('plot_fallback');
      expect(body.isl_error).toBeDefined();
      expect(body.isl_error.retryable).toBe(true);

      delete process.env.ISL_BASE_URL;
      delete process.env.ISL_API_KEY;
    });

    it('includes isl_error when ISL config missing', async () => {
      process.env.ISL_OPTIMISE_ENABLE = '1';
      // ISL_BASE_URL and ISL_API_KEY not set

      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/optimise',
        payload: {
          decision_variable: 'price',
          search_range: [50, 150],
          objective_node: 'revenue',
          graph: {
            nodes: [
              { id: 'price', label: 'Price' },
              { id: 'revenue', label: 'Revenue' },
            ],
            edges: [],
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.provenance).toBe('plot_fallback');
      expect(body.isl_error).toBeDefined();
      expect(body.isl_error.code).toBe('ISL_NOT_ENABLED');
      expect(body.isl_error.retryable).toBe(false);
    });

    it('respects ISL_ENABLE fallback flag', async () => {
      process.env.ISL_ENABLE = '1';
      // ISL_OPTIMISE_ENABLE not set - should use ISL_ENABLE as fallback

      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/optimise',
        payload: {
          decision_variable: 'price',
          search_range: [50, 150],
          objective_node: 'revenue',
          graph: {
            nodes: [
              { id: 'price', label: 'Price' },
              { id: 'revenue', label: 'Revenue' },
            ],
            edges: [],
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      // Should fall back but ISL was attempted (config missing error)
      expect(body.isl_error).toBeDefined();
    });
  });

  describe('edge inference', () => {
    it('normalizes graph and infers edge types', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/optimise',
        payload: {
          decision_variable: 'price',
          search_range: [50, 150],
          objective_node: 'revenue',
          graph: {
            nodes: [
              { id: 'price', label: 'Price' },
              { id: 'revenue', label: 'Revenue' },
            ],
            // Edge without explicit type
            edges: [{ from: 'price', to: 'revenue', weight: 0.8 }],
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.model_card.edges).toBe(1);
    });
  });

  describe('circuit breaker integration', () => {
    it('uses fallback when circuit breaker is open', async () => {
      process.env.ISL_OPTIMISE_ENABLE = '1';
      process.env.ISL_BASE_URL = 'http://localhost:9999';
      process.env.ISL_API_KEY = 'test-key';

      // Open the circuit breaker by recording failures
      recordIslFailure();
      recordIslFailure();
      recordIslFailure();
      expect(getIslCircuitBreakerStats().state).toBe('open');

      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/optimise',
        payload: {
          decision_variable: 'price',
          search_range: [50, 150],
          objective_node: 'revenue',
          graph: {
            nodes: [
              { id: 'price', label: 'Price' },
              { id: 'revenue', label: 'Revenue' },
            ],
            edges: [],
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.provenance).toBe('plot_fallback');
      expect(body.isl_error).toBeDefined();
      expect(body.isl_error.code).toBe('ISL_CIRCUIT_BREAKER_OPEN');
      expect(body.isl_error.retryable).toBe(true);

      delete process.env.ISL_BASE_URL;
      delete process.env.ISL_API_KEY;
    });

    it('uses fallback normally when ISL disabled (no circuit breaker error)', async () => {
      // Circuit breaker open but ISL disabled
      recordIslFailure();
      recordIslFailure();
      recordIslFailure();

      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/optimise',
        payload: {
          decision_variable: 'price',
          search_range: [50, 150],
          objective_node: 'revenue',
          graph: {
            nodes: [
              { id: 'price', label: 'Price' },
              { id: 'revenue', label: 'Revenue' },
            ],
            edges: [],
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.provenance).toBe('plot_fallback');
      // No ISL error when ISL is disabled
      expect(body.isl_error).toBeUndefined();
    });

    it('circuit breaker does not block when in closed state', async () => {
      process.env.ISL_OPTIMISE_ENABLE = '1';
      // No ISL_BASE_URL - config missing

      // Circuit is closed (no failures recorded)
      expect(getIslCircuitBreakerStats().state).toBe('closed');

      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/optimise',
        payload: {
          decision_variable: 'price',
          search_range: [50, 150],
          objective_node: 'revenue',
          graph: {
            nodes: [
              { id: 'price', label: 'Price' },
              { id: 'revenue', label: 'Revenue' },
            ],
            edges: [],
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      // Should show ISL_NOT_ENABLED, not circuit breaker error
      expect(body.isl_error.code).toBe('ISL_NOT_ENABLED');
    });
  });
});
