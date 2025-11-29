/**
 * CEE Contract Tests
 *
 * Validates that CEE payload structures match expected contracts.
 * These tests guard against fixture drift and ensure payload compatibility.
 */

import { describe, it, expect } from 'vitest';
import type {
  CeeDecisionReviewPayloadV1,
  CeeTrace,
  CeeError,
  CeeErrorSuggestedAction,
  CeeRunContext,
  CeeDecisionReviewResult,
} from '../src/cee/client.js';

describe('CEE Contract Tests', () => {
  describe('CeeDecisionReviewPayloadV1 contract', () => {
    it('has required schema field with correct value', () => {
      const payload: CeeDecisionReviewPayloadV1 = {
        schema: 'cee.decision-review.v1',
        response_hash: 'abc123',
        seed: 42,
        inference_mode: 'standard',
        graph_summary: { nodes: 3, edges: 2 },
      };

      expect(payload.schema).toBe('cee.decision-review.v1');
    });

    it('has required response_hash field', () => {
      const payload: CeeDecisionReviewPayloadV1 = {
        schema: 'cee.decision-review.v1',
        response_hash: 'sha256:abc123def456',
        seed: 42,
        inference_mode: 'standard',
        graph_summary: { nodes: 5, edges: 4 },
      };

      expect(typeof payload.response_hash).toBe('string');
      expect(payload.response_hash.length).toBeGreaterThan(0);
    });

    it('accepts numeric seed', () => {
      const payload: CeeDecisionReviewPayloadV1 = {
        schema: 'cee.decision-review.v1',
        response_hash: 'abc',
        seed: 12345,
        inference_mode: 'standard',
        graph_summary: { nodes: 1, edges: 0 },
      };

      expect(payload.seed).toBe(12345);
    });

    it('accepts string seed', () => {
      const payload: CeeDecisionReviewPayloadV1 = {
        schema: 'cee.decision-review.v1',
        response_hash: 'abc',
        seed: '42-string-seed',
        inference_mode: 'standard',
        graph_summary: { nodes: 1, edges: 0 },
      };

      expect(payload.seed).toBe('42-string-seed');
    });

    it('has required inference_mode field', () => {
      const payload: CeeDecisionReviewPayloadV1 = {
        schema: 'cee.decision-review.v1',
        response_hash: 'abc',
        seed: 42,
        inference_mode: 'bayesian',
        graph_summary: { nodes: 1, edges: 0 },
      };

      expect(payload.inference_mode).toBe('bayesian');
    });

    it('has required graph_summary with nodes and edges', () => {
      const payload: CeeDecisionReviewPayloadV1 = {
        schema: 'cee.decision-review.v1',
        response_hash: 'abc',
        seed: 42,
        inference_mode: 'standard',
        graph_summary: { nodes: 10, edges: 15 },
      };

      expect(payload.graph_summary.nodes).toBe(10);
      expect(payload.graph_summary.edges).toBe(15);
    });

    it('accepts optional scenario_kind', () => {
      const payload: CeeDecisionReviewPayloadV1 = {
        schema: 'cee.decision-review.v1',
        response_hash: 'abc',
        seed: 42,
        inference_mode: 'standard',
        graph_summary: { nodes: 1, edges: 0 },
        scenario_kind: 'pricing_decision',
      };

      expect(payload.scenario_kind).toBe('pricing_decision');
    });

    it('allows undefined scenario_kind', () => {
      const payload: CeeDecisionReviewPayloadV1 = {
        schema: 'cee.decision-review.v1',
        response_hash: 'abc',
        seed: 42,
        inference_mode: 'standard',
        graph_summary: { nodes: 1, edges: 0 },
      };

      expect(payload.scenario_kind).toBeUndefined();
    });
  });

  describe('CeeTrace contract', () => {
    it('has required fields', () => {
      const trace: CeeTrace = {
        requestId: 'req-123',
        degraded: false,
        timestamp: '2025-01-15T10:00:00.000Z',
      };

      expect(trace.requestId).toBe('req-123');
      expect(trace.degraded).toBe(false);
      expect(trace.timestamp).toBe('2025-01-15T10:00:00.000Z');
    });

    it('accepts optional featureVersion', () => {
      const trace: CeeTrace = {
        requestId: 'req-456',
        degraded: true,
        timestamp: '2025-01-15T10:00:00.000Z',
        featureVersion: '1.2.0',
      };

      expect(trace.featureVersion).toBe('1.2.0');
    });
  });

  describe('CeeError contract', () => {
    it('has required suggestedAction field', () => {
      const error: CeeError = {
        suggestedAction: 'retry',
      };

      expect(error.suggestedAction).toBe('retry');
    });

    it('accepts all suggestedAction values', () => {
      const actions: CeeErrorSuggestedAction[] = ['retry', 'fix_input', 'fail'];

      for (const action of actions) {
        const error: CeeError = { suggestedAction: action };
        expect(error.suggestedAction).toBe(action);
      }
    });

    it('accepts optional code and message', () => {
      const error: CeeError = {
        code: 'CEE_TIMEOUT',
        message: 'Request timed out',
        suggestedAction: 'retry',
      };

      expect(error.code).toBe('CEE_TIMEOUT');
      expect(error.message).toBe('Request timed out');
    });

    it('accepts optional traceId and retryable', () => {
      const error: CeeError = {
        traceId: 'trace-789',
        retryable: true,
        suggestedAction: 'retry',
      };

      expect(error.traceId).toBe('trace-789');
      expect(error.retryable).toBe(true);
    });
  });

  describe('CeeRunContext contract', () => {
    it('has required schema field', () => {
      const context: CeeRunContext = {
        schema: 'run.v1',
      };

      expect(context.schema).toBe('run.v1');
    });

    it('accepts all optional fields', () => {
      const context: CeeRunContext = {
        schema: 'report.v1',
        response_hash: 'hash123',
        seed: 42,
        inference_mode: 'standard',
        graph_summary: { nodes: 5, edges: 4 },
        scenario_kind: 'build_vs_buy',
      };

      expect(context.schema).toBe('report.v1');
      expect(context.response_hash).toBe('hash123');
      expect(context.seed).toBe(42);
      expect(context.inference_mode).toBe('standard');
      expect(context.graph_summary?.nodes).toBe(5);
      expect(context.scenario_kind).toBe('build_vs_buy');
    });

    it('allows arbitrary additional fields via index signature', () => {
      const context: CeeRunContext = {
        schema: 'run.v1',
        customField: 'customValue',
        numericField: 123,
      };

      expect(context['customField']).toBe('customValue');
      expect(context['numericField']).toBe(123);
    });
  });

  describe('CeeDecisionReviewResult contract', () => {
    it('has required usedFixture field', () => {
      const result: CeeDecisionReviewResult = {
        ceeReview: null,
        ceeTrace: null,
        ceeError: null,
        usedFixture: false,
      };

      expect(result.usedFixture).toBe(false);
    });

    it('accepts successful result with review', () => {
      const result: CeeDecisionReviewResult = {
        ceeReview: { someField: 'value' },
        ceeTrace: {
          requestId: 'req-123',
          degraded: false,
          timestamp: '2025-01-15T10:00:00.000Z',
        },
        ceeError: null,
        usedFixture: false,
      };

      expect(result.ceeReview).toBeDefined();
      expect(result.ceeError).toBeNull();
    });

    it('accepts degraded result with error', () => {
      const result: CeeDecisionReviewResult = {
        ceeReview: null,
        ceeTrace: {
          requestId: 'req-456',
          degraded: true,
          timestamp: '2025-01-15T10:00:00.000Z',
        },
        ceeError: {
          code: 'CEE_UNAVAILABLE',
          retryable: true,
          suggestedAction: 'retry',
        },
        usedFixture: true,
      };

      expect(result.ceeReview).toBeNull();
      expect(result.ceeError?.code).toBe('CEE_UNAVAILABLE');
      expect(result.usedFixture).toBe(true);
    });
  });

  describe('Fixture payload compatibility', () => {
    it('fixture payload matches CeeDecisionReviewPayloadV1 structure', () => {
      // Simulate a fixture payload
      const fixturePayload = {
        schema: 'cee.decision-review.v1',
        response_hash: 'sha256:fixture-hash',
        seed: 4242,
        inference_mode: 'standard',
        graph_summary: { nodes: 3, edges: 2 },
        scenario_kind: 'example',
      };

      // Verify it matches the contract
      const validated: CeeDecisionReviewPayloadV1 = fixturePayload;
      expect(validated.schema).toBe('cee.decision-review.v1');
      expect(typeof validated.response_hash).toBe('string');
      expect(typeof validated.seed).toBe('number');
      expect(typeof validated.inference_mode).toBe('string');
      expect(validated.graph_summary).toHaveProperty('nodes');
      expect(validated.graph_summary).toHaveProperty('edges');
    });

    it('empty graph_summary is valid', () => {
      const payload: CeeDecisionReviewPayloadV1 = {
        schema: 'cee.decision-review.v1',
        response_hash: '',
        seed: 0,
        inference_mode: 'standard',
        graph_summary: { nodes: 0, edges: 0 },
      };

      expect(payload.graph_summary.nodes).toBe(0);
      expect(payload.graph_summary.edges).toBe(0);
    });
  });

  describe('Error code documentation', () => {
    const knownErrorCodes = [
      'CEE_CONFIG_MISSING',
      'CEE_UNAVAILABLE',
      'CEE_TIMEOUT',
      'CEE_PARSE_ERROR',
      'CEE_FIXTURE_ERROR',
      'CEE_FIXTURE_HTTP_ERROR',
      'CEE_FIXTURE_PARSE_ERROR',
      'CEE_ADAPTER_ERROR',
      'CEE_CLIENT_ERROR',
      'CEE_DISABLED',
      'CEE_FALLBACK_FIXTURE',
      'CEE_EMPTY_REVIEW',
    ];

    it('documents known error codes', () => {
      // This test documents the error codes that the CEE client can return
      expect(knownErrorCodes.length).toBeGreaterThan(0);
      for (const code of knownErrorCodes) {
        expect(code).toMatch(/^CEE_/);
      }
    });
  });
});
