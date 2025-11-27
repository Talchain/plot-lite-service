/**
 * ISL Integration Tests
 *
 * Tests the full ISL service flow including:
 * - Service initialization and configuration
 * - Graph transformation
 * - API request/response handling
 * - Error handling and fallback behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createISLService,
  resetISLService,
  type ISLService,
} from '../src/integrations/isl/index.js';
import type { Graph } from '../src/trust/types.js';
import type { ISLValidationResponse, ISLSensitivityResponse, ISLCounterfactualResponse } from '../src/integrations/isl/types/isl-types.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ISL Service Integration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    resetISLService();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // Sample graph for testing
  const sampleGraph: Graph = {
    nodes: [
      { id: 'treatment', label: 'Treatment', belief: 0.8, weight: 1.0 },
      { id: 'outcome', label: 'Outcome', belief: 0.7, weight: 1.0 },
      { id: 'confounder', label: 'Confounder', belief: 0.6, weight: 0.8 },
    ],
    edges: [
      { from: 'treatment', to: 'outcome', weight: 0.9 },
      { from: 'confounder', to: 'treatment', weight: 0.5 },
      { from: 'confounder', to: 'outcome', weight: 0.4 },
    ],
  };

  describe('Service Configuration', () => {
    it('should return disabled when ISL_ENABLE is not set', () => {
      delete process.env.ISL_ENABLE;
      const service = createISLService();
      expect(service.isEnabled()).toBe(false);
    });

    it('should return disabled when base URL is missing', () => {
      process.env.ISL_ENABLE = '1';
      delete process.env.ISL_BASE_URL;
      process.env.ISL_API_KEY = 'test-key';
      const service = createISLService();
      expect(service.isEnabled()).toBe(false);
    });

    it('should return disabled when API key is missing', () => {
      process.env.ISL_ENABLE = '1';
      process.env.ISL_BASE_URL = 'https://isl.example.com';
      delete process.env.ISL_API_KEY;
      const service = createISLService();
      expect(service.isEnabled()).toBe(false);
    });

    it('should return enabled when fully configured', () => {
      process.env.ISL_ENABLE = '1';
      process.env.ISL_BASE_URL = 'https://isl.example.com';
      process.env.ISL_API_KEY = 'test-key';
      const service = createISLService();
      expect(service.isEnabled()).toBe(true);
    });
  });

  describe('validateCausal', () => {
    let service: ISLService;

    beforeEach(() => {
      process.env.ISL_ENABLE = '1';
      process.env.ISL_BASE_URL = 'https://isl-staging.onrender.com';
      process.env.ISL_API_KEY = 'test-api-key';
      service = createISLService();
    });

    it('should return fallback when disabled', async () => {
      delete process.env.ISL_ENABLE;
      const disabledService = createISLService();

      const result = await disabledService.validateCausal(
        sampleGraph,
        'treatment',
        'outcome',
        'req-123'
      );

      expect(result.source).toBe('engine_fallback');
      expect(result.status).toBe('uncertain');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should transform graph and return adapted response', async () => {
      const islResponse: ISLValidationResponse = {
        status: 'identifiable',
        adjustment_sets: [['confounder']],
        minimal_adjustment_set: ['confounder'],
        suggestions: [],
        robustness: 'high',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(islResponse),
      });

      const result = await service.validateCausal(
        sampleGraph,
        'treatment',
        'outcome',
        'req-validate-1'
      );

      expect(result.source).toBe('isl');
      expect(result.status).toBe('identifiable');
      expect(result.confidence).toBe('high');
      expect(result.minimal_set).toEqual(['confounder']);

      // Verify the request was made correctly
      expect(mockFetch).toHaveBeenCalledWith(
        'https://isl-staging.onrender.com/api/v1/causal/validate',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-Request-Id': 'req-validate-1',
          }),
        })
      );

      // Verify graph was transformed to DAG format
      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.dag.nodes).toEqual(['treatment', 'outcome', 'confounder']);
      expect(body.dag.edges).toContainEqual(['treatment', 'outcome']);
      expect(body.dag.edges).toContainEqual(['confounder', 'treatment']);
      expect(body.treatment).toBe('treatment');
      expect(body.outcome).toBe('outcome');
    });

    it('should return fallback on API error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await service.validateCausal(
        sampleGraph,
        'treatment',
        'outcome',
        'req-error'
      );

      expect(result.source).toBe('engine_fallback');
      expect(result.status).toBe('uncertain');
      // P1.1: Error messages now include ISL-specific wrapping
      expect(result.explanation?.reasoning).toMatch(/network error/i);
    });

    it('should handle partially identifiable status', async () => {
      const islResponse: ISLValidationResponse = {
        status: 'partially_identifiable',
        adjustment_sets: [],
        minimal_adjustment_set: [],
        suggestions: [
          {
            type: 'missing_edge',
            description: 'Consider adding latent confounder',
            affected_variables: ['treatment', 'outcome'],
            suggested_action: 'Add unobserved variable',
          },
        ],
        robustness: 'medium',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(islResponse),
      });

      const result = await service.validateCausal(
        sampleGraph,
        'treatment',
        'outcome',
        'req-partial'
      );

      expect(result.status).toBe('uncertain');
      expect(result.confidence).toBe('medium');
      expect(result.issues).toHaveLength(1);
      expect(result.issues![0].type).toBe('missing_edge');
    });
  });

  describe('analyseSensitivity', () => {
    let service: ISLService;

    beforeEach(() => {
      process.env.ISL_ENABLE = '1';
      process.env.ISL_BASE_URL = 'https://isl-staging.onrender.com';
      process.env.ISL_API_KEY = 'test-api-key';
      service = createISLService();
    });

    it('should return fallback when disabled', async () => {
      delete process.env.ISL_ENABLE;
      const disabledService = createISLService();

      const result = await disabledService.analyseSensitivity(
        sampleGraph,
        'treatment',
        'outcome',
        'req-123'
      );

      expect(result.source).toBe('engine_fallback');
      expect(result.overall_robustness).toBe('moderate');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should transform and return adapted sensitivity response', async () => {
      const islResponse: ISLSensitivityResponse = {
        sensitivities: [
          { parameter: 'edge_weight_1', sensitivity_score: 0.85, direction: 'positive', confidence_interval: [0.7, 1.0] },
          { parameter: 'edge_weight_2', sensitivity_score: 0.45, direction: 'negative', confidence_interval: [0.3, 0.6] },
        ],
        overall_robustness: 'moderate',
        recommendations: ['Monitor edge_weight_1 closely'],
        analysis_metadata: { method: 'monte_carlo', samples: 1000 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(islResponse),
      });

      const result = await service.analyseSensitivity(
        sampleGraph,
        'treatment',
        'outcome',
        'req-sens-1'
      );

      expect(result.source).toBe('isl');
      expect(result.overall_robustness).toBe('moderate');
      expect(result.sensitive_parameters).toHaveLength(2);
      // Should be sorted by sensitivity descending
      expect(result.sensitive_parameters[0].parameter).toBe('edge_weight_1');
      expect(result.sensitive_parameters[0].sensitivity).toBe(0.85);
      expect(result.recommendations).toContain('Monitor edge_weight_1 closely');
    });

    it('should return fallback on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal server error'),
      });

      const result = await service.analyseSensitivity(
        sampleGraph,
        'treatment',
        'outcome',
        'req-error'
      );

      expect(result.source).toBe('engine_fallback');
      expect(result.overall_robustness).toBe('moderate');
    });
  });

  describe('computeCounterfactual', () => {
    let service: ISLService;

    beforeEach(() => {
      process.env.ISL_ENABLE = '1';
      process.env.ISL_BASE_URL = 'https://isl-staging.onrender.com';
      process.env.ISL_API_KEY = 'test-api-key';
      service = createISLService();
    });

    it('should return fallback when disabled', async () => {
      delete process.env.ISL_ENABLE;
      const disabledService = createISLService();

      const result = await disabledService.computeCounterfactual(
        sampleGraph,
        { treatment: 1.5 },
        'outcome',
        'req-123'
      );

      expect(result.source).toBe('engine_fallback');
      expect(result.estimate).toBe(0);
      expect(result.uncertainty.total).toBe(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should compute counterfactual with correct format', async () => {
      const islResponse: ISLCounterfactualResponse = {
        estimate: 125.5,
        confidence_interval: { lower: 100, upper: 150, level: 0.95 },
        uncertainty_decomposition: { parametric: 0.2, structural: 0.3, stochastic: 0.1 },
        sensitivity_range: { min: 90, max: 160 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(islResponse),
      });

      const result = await service.computeCounterfactual(
        sampleGraph,
        { treatment: 2.0 },
        'outcome',
        'req-cf-1'
      );

      expect(result.source).toBe('isl');
      expect(result.estimate).toBe(125.5);
      expect(result.confidence_interval.p10).toBe(100);
      expect(result.confidence_interval.p50).toBe(125.5);
      expect(result.confidence_interval.p90).toBe(150);
      // Total = sqrt(0.2² + 0.3² + 0.1²) ≈ 0.3742
      expect(result.uncertainty.total).toBeCloseTo(0.3742, 2);

      // Verify request format
      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.intervention).toEqual({ treatment: 2.0 });
      expect(body.target).toBe('outcome');
    });

    it('should return fallback on API timeout', async () => {
      const timeoutError = new Error('Aborted');
      timeoutError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(timeoutError);

      const result = await service.computeCounterfactual(
        sampleGraph,
        { treatment: 1.0 },
        'outcome',
        'req-timeout'
      );

      expect(result.source).toBe('engine_fallback');
      expect(result.uncertainty.total).toBe(1);
    });
  });

  describe('isAvailable', () => {
    it('should return false when disabled', async () => {
      delete process.env.ISL_ENABLE;
      const service = createISLService();
      const available = await service.isAvailable();
      expect(available).toBe(false);
    });

    it('should return true when health check passes', async () => {
      process.env.ISL_ENABLE = '1';
      process.env.ISL_BASE_URL = 'https://isl.example.com';
      process.env.ISL_API_KEY = 'test-key';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const service = createISLService();
      const available = await service.isAvailable();

      expect(available).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://isl.example.com/health',
        expect.anything()
      );
    });

    it('should return false when health check fails', async () => {
      process.env.ISL_ENABLE = '1';
      process.env.ISL_BASE_URL = 'https://isl.example.com';
      process.env.ISL_API_KEY = 'test-key';

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

      const service = createISLService();
      const available = await service.isAvailable();

      expect(available).toBe(false);
    });
  });

  describe('Graph Transformation', () => {
    let service: ISLService;

    beforeEach(() => {
      process.env.ISL_ENABLE = '1';
      process.env.ISL_BASE_URL = 'https://isl.example.com';
      process.env.ISL_API_KEY = 'test-key';
      service = createISLService();

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            status: 'identifiable',
            adjustment_sets: [],
            minimal_adjustment_set: [],
            suggestions: [],
            robustness: 'high',
          }),
      });
    });

    it('should correctly transform nodes to ISL format', async () => {
      const graph: Graph = {
        nodes: [
          { id: 'A', label: 'Node A', belief: 0.5, weight: 1.0 },
          { id: 'B', label: 'Node B', belief: 0.6, weight: 0.9 },
          { id: 'C', label: 'Node C', belief: 0.7, weight: 0.8 },
        ],
        edges: [],
      };

      await service.validateCausal(graph, 'A', 'C', 'req-nodes');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.dag.nodes).toEqual(['A', 'B', 'C']);
    });

    it('should correctly transform edges to ISL format', async () => {
      const graph: Graph = {
        nodes: [
          { id: 'X', label: 'X', belief: 0.5, weight: 1.0 },
          { id: 'Y', label: 'Y', belief: 0.5, weight: 1.0 },
          { id: 'Z', label: 'Z', belief: 0.5, weight: 1.0 },
        ],
        edges: [
          { from: 'X', to: 'Y', weight: 0.8 },
          { from: 'Y', to: 'Z', weight: 0.7 },
          { from: 'X', to: 'Z', weight: 0.6 },
        ],
      };

      await service.validateCausal(graph, 'X', 'Z', 'req-edges');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.dag.edges).toContainEqual(['X', 'Y']);
      expect(body.dag.edges).toContainEqual(['Y', 'Z']);
      expect(body.dag.edges).toContainEqual(['X', 'Z']);
    });

    it('should handle empty graph', async () => {
      const emptyGraph: Graph = {
        nodes: [],
        edges: [],
      };

      await service.validateCausal(emptyGraph, '', '', 'req-empty');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.dag.nodes).toEqual([]);
      expect(body.dag.edges).toEqual([]);
    });
  });
});
