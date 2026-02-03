/**
 * Decision Review Orchestrator Tests
 *
 * Tests for the decision review orchestration flow including:
 * - Feature flag behavior
 * - Cache hits/misses
 * - CEE timeout handling
 * - Validation failure handling
 * - Happy path integration
 *
 * @see Brief: M2 Decision Review Integration, Task 9
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  orchestrateDecisionReview,
  type DecisionReviewInput,
} from '../../../src/cee/decision-review-orchestrator.js';
import { clearReviewCache, getCachedReview, setCachedReview } from '../../../src/cee/validation/review-cache.js';
import { DecisionReviewEvents } from '../../../src/cee/validation/m1-review-constants.js';
import { FLAGS } from '../../../src/config/flags.js';
import * as ceeClient from '../../../src/cee/client.js';
import {
  BASE_BRIEF,
  BASE_GRAPH,
  BASE_ISL_RESULTS,
  BASE_FLIP_THRESHOLD_DATA,
  VALID_READY_REVIEW,
} from './fixtures.js';

// =============================================================================
// Test Input Builder
// =============================================================================

function buildTestInput(overrides: Partial<DecisionReviewInput> = {}): DecisionReviewInput {
  return {
    brief: BASE_BRIEF,
    graph: BASE_GRAPH as any,
    options: [
      { id: 'option-a', label: 'Option A' },
      { id: 'option-b', label: 'Option B' },
    ] as any,
    islResult: {
      options: BASE_ISL_RESULTS.option_comparison,
      factor_sensitivity: BASE_ISL_RESULTS.factor_sensitivity,
      robustness: {
        ...BASE_ISL_RESULTS.robustness,
        fragile_edges: BASE_ISL_RESULTS.fragile_edges,
      },
    },
    m1Coaching: {
      readiness: 'ready',
      headline_type: 'clear_winner',
      story_headlines: {
        'option-a': 'Strong market positioning',
        'option-b': 'Viable alternative',
      },
      evidence_gaps: [
        {
          factor_id: 'factor-market',
          factor_label: 'Market Demand',
          confidence: 0.7,
          confidence_display: '70%',
          confidence_defaulted: false,
          voi_score: 0.3,
          influence: 0.5,
          influence_display: '50%',
          suggestion: 'Gather market data',
          notes: [],
        },
      ],
      model_critiques: [],
      next_actions: [],
      coaching_version: '1.1.0',
      computed_at: new Date().toISOString(),
    },
    responseHash: 'abc123def456789012345678',
    requestId: 'test-request-001',
    ...overrides,
  };
}

// =============================================================================
// Mocks
// =============================================================================

// Mock FLAGS
vi.mock('../../../src/config/flags.js', () => ({
  FLAGS: {
    DECISION_REVIEW_ENABLE: true,
  },
}));

// =============================================================================
// Tests
// =============================================================================

describe('Decision Review Orchestrator', () => {
  beforeEach(() => {
    clearReviewCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Feature Flag Disabled', () => {
    it('returns disabled status when flag is off', async () => {
      // Override flag
      vi.spyOn(FLAGS, 'DECISION_REVIEW_ENABLE', 'get').mockReturnValue(false);

      const input = buildTestInput();
      const result = await orchestrateDecisionReview(input);

      expect(result.review_status).toBe('disabled');
      expect(result.m1_review).toBeNull();
    });
  });

  describe('Configuration Missing', () => {
    it('returns skipped status when CEE not configured', async () => {
      vi.spyOn(FLAGS, 'DECISION_REVIEW_ENABLE', 'get').mockReturnValue(true);

      const input = buildTestInput();
      // Don't provide config and ensure env vars are not set
      const originalBaseUrl = process.env.CEE_BASE_URL;
      const originalApiKey = process.env.CEE_API_KEY;
      delete process.env.CEE_BASE_URL;
      delete process.env.CEE_API_KEY;

      try {
        const result = await orchestrateDecisionReview(input);
        expect(result.review_status).toBe('skipped');
        expect(result.m1_review).toBeNull();
      } finally {
        // Restore
        if (originalBaseUrl) process.env.CEE_BASE_URL = originalBaseUrl;
        if (originalApiKey) process.env.CEE_API_KEY = originalApiKey;
      }
    });
  });

  describe('Cache Behavior', () => {
    it('returns cached review on cache hit', async () => {
      vi.spyOn(FLAGS, 'DECISION_REVIEW_ENABLE', 'get').mockReturnValue(true);

      const input = buildTestInput();
      const config = { baseUrl: 'https://cee.test', apiKey: 'test-key' };

      // Pre-populate cache
      // Cache key is computed from responseHash + briefHash
      // We need to set up the cache before calling orchestrateDecisionReview
      const mockCallDecisionReview = vi.spyOn(ceeClient, 'callDecisionReview');
      mockCallDecisionReview.mockResolvedValue({
        review: VALID_READY_REVIEW,
        error: null,
        meta: { model: 'test-model', latency_ms: 100, tokens: 500 },
      });

      // First call should populate cache
      const result1 = await orchestrateDecisionReview(input, config);
      expect(result1.review_status).toBe('complete');

      // Second call should hit cache
      mockCallDecisionReview.mockClear();
      const result2 = await orchestrateDecisionReview(input, config);
      expect(result2.review_status).toBe('complete');
      expect(result2.m1_review).toEqual(result1.m1_review);
      expect(mockCallDecisionReview).not.toHaveBeenCalled();
    });
  });

  describe('CEE Error Handling', () => {
    it('returns skipped status on CEE error', async () => {
      vi.spyOn(FLAGS, 'DECISION_REVIEW_ENABLE', 'get').mockReturnValue(true);

      const input = buildTestInput();
      const config = { baseUrl: 'https://cee.test', apiKey: 'test-key' };

      vi.spyOn(ceeClient, 'callDecisionReview').mockResolvedValue({
        review: null,
        error: { code: 'CEE_TIMEOUT', message: 'Request timed out' },
        meta: { model: 'unknown', latency_ms: 3000, tokens: 0 },
      });

      const result = await orchestrateDecisionReview(input, config);

      expect(result.review_status).toBe('skipped');
      expect(result.m1_review).toBeNull();
    });

    it('returns skipped status when CEE returns null review', async () => {
      vi.spyOn(FLAGS, 'DECISION_REVIEW_ENABLE', 'get').mockReturnValue(true);

      const input = buildTestInput();
      const config = { baseUrl: 'https://cee.test', apiKey: 'test-key' };

      vi.spyOn(ceeClient, 'callDecisionReview').mockResolvedValue({
        review: null,
        error: null,
        meta: { model: 'test-model', latency_ms: 500, tokens: 0 },
      });

      const result = await orchestrateDecisionReview(input, config);

      expect(result.review_status).toBe('skipped');
    });
  });

  describe('Validation Failure', () => {
    it('returns failed status when validation fails', async () => {
      vi.spyOn(FLAGS, 'DECISION_REVIEW_ENABLE', 'get').mockReturnValue(true);

      const input = buildTestInput();
      const config = { baseUrl: 'https://cee.test', apiKey: 'test-key' };

      // Return review with missing option headline (non-downgraded failure)
      const invalidReview = {
        ...VALID_READY_REVIEW,
        story_headlines: {
          'option-a': 'Strong market positioning',
          // Missing 'option-b' headline - causes MISSING_OPTION_HEADLINE failure
        },
      };

      vi.spyOn(ceeClient, 'callDecisionReview').mockResolvedValue({
        review: invalidReview,
        error: null,
        meta: { model: 'test-model', latency_ms: 500, tokens: 1000 },
      });

      const result = await orchestrateDecisionReview(input, config);

      expect(result.review_status).toBe('failed');
      expect(result.m1_review).toBeNull();
      expect(result.review_failure_codes).toBeDefined();
      expect(result.review_failure_codes!.length).toBeGreaterThan(0);
    });

    it('returns complete with warnings when UNGROUNDED_NUMBER is only failure', async () => {
      vi.spyOn(FLAGS, 'DECISION_REVIEW_ENABLE', 'get').mockReturnValue(true);

      const input = buildTestInput();
      const config = { baseUrl: 'https://cee.test', apiKey: 'test-key' };

      // Return review with invented number that's >25% away from all ISL values:
      // ISL values: 77%, 23%, 88%, 70%, 50%, 80%, margin 54%
      // 35% is >25% drift from all of these, so it won't be corrected
      const invalidReview = {
        ...VALID_READY_REVIEW,
        narrative_summary: 'Option A has 35% chance of success.', // >25% drift from all ISL values
      };

      vi.spyOn(ceeClient, 'callDecisionReview').mockResolvedValue({
        review: invalidReview,
        error: null,
        meta: { model: 'test-model', latency_ms: 500, tokens: 1000 },
      });

      const result = await orchestrateDecisionReview(input, config);

      // UNGROUNDED_NUMBER alone gets downgraded to warning, not failure
      expect(result.review_status).toBe('complete');
      expect(result.m1_review).not.toBeNull();
      expect(result.review_warnings).toBeDefined();
      expect(result.review_warnings).toContain('UNGROUNDED_NUMBER');
    });

    it('returns failed status on shape validation failure', async () => {
      vi.spyOn(FLAGS, 'DECISION_REVIEW_ENABLE', 'get').mockReturnValue(true);

      const input = buildTestInput();
      const config = { baseUrl: 'https://cee.test', apiKey: 'test-key' };

      // Return malformed review (missing required fields)
      vi.spyOn(ceeClient, 'callDecisionReview').mockResolvedValue({
        review: { incomplete: true } as any,
        error: null,
        meta: { model: 'test-model', latency_ms: 500, tokens: 500 },
      });

      const result = await orchestrateDecisionReview(input, config);

      expect(result.review_status).toBe('failed');
      expect(result.review_failure_codes).toContain('SHAPE_VALIDATION_FAILED');
    });
  });

  describe('Happy Path', () => {
    it('returns complete status with valid review', async () => {
      vi.spyOn(FLAGS, 'DECISION_REVIEW_ENABLE', 'get').mockReturnValue(true);

      const input = buildTestInput();
      const config = { baseUrl: 'https://cee.test', apiKey: 'test-key' };

      vi.spyOn(ceeClient, 'callDecisionReview').mockResolvedValue({
        review: VALID_READY_REVIEW,
        error: null,
        meta: { model: 'gpt-4', latency_ms: 800, tokens: 1500 },
      });

      const result = await orchestrateDecisionReview(input, config);

      expect(result.review_status).toBe('complete');
      // Review passes through the number corrector (even if no corrections needed),
      // so check key fields match rather than exact equality
      expect(result.m1_review).not.toBeNull();
      expect(result.m1_review!.narrative_summary).toBe(VALID_READY_REVIEW.narrative_summary);
      expect(result.m1_review!.story_headlines).toEqual(VALID_READY_REVIEW.story_headlines);
      expect(result.m1_review!.readiness_rationale).toBe(VALID_READY_REVIEW.readiness_rationale);
      expect(result.review_meta?.model).toBe('gpt-4');
      expect(result.review_meta?.latency_ms).toBe(800);
      expect(result.review_meta?.tokens).toBe(1500);
    });
  });

  describe('Observability', () => {
    it('logs appropriate events with logger', async () => {
      vi.spyOn(FLAGS, 'DECISION_REVIEW_ENABLE', 'get').mockReturnValue(true);

      const input = buildTestInput();
      const config = { baseUrl: 'https://cee.test', apiKey: 'test-key' };

      vi.spyOn(ceeClient, 'callDecisionReview').mockResolvedValue({
        review: VALID_READY_REVIEW,
        error: null,
        meta: { model: 'test-model', latency_ms: 500, tokens: 1000 },
      });

      const mockLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      await orchestrateDecisionReview(input, config, mockLogger as any);

      // Should log requested and completed events
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: DecisionReviewEvents.REQUESTED,
          request_id: input.requestId,
        })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: DecisionReviewEvents.COMPLETED,
          request_id: input.requestId,
          review_status: 'complete',
        })
      );
    });

    it('logs disabled event when flag is off', async () => {
      vi.spyOn(FLAGS, 'DECISION_REVIEW_ENABLE', 'get').mockReturnValue(false);

      const input = buildTestInput();
      const mockLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      await orchestrateDecisionReview(input, undefined, mockLogger as any);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: DecisionReviewEvents.DISABLED,
        })
      );
    });
  });
});
