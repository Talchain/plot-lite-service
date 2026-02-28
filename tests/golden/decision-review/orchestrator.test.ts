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
import { DecisionReviewEvents, M1ReviewFailureCodes, WARNING_GRADE_CODES } from '../../../src/cee/validation/m1-review-constants.js';
import { FLAGS } from '../../../src/config/flags.js';
import * as ceeClient from '../../../src/cee/client.js';
import * as m1ReviewTypes from '../../../src/cee/validation/m1-review-types.js';
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
vi.mock('../../../src/config/flags.ts', () => ({
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

      // Return structurally invalid review (missing required fields → SHAPE_VALIDATION_FAILED)
      const invalidReview = {
        narrative_summary: null, // null required field → shape validation failure
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

    it('returns complete with warnings when READINESS_MISALIGNMENT is only failure', async () => {
      vi.spyOn(FLAGS, 'DECISION_REVIEW_ENABLE', 'get').mockReturnValue(true);

      // Set readiness to 'needs_framing' which requires 'framing', 'structure', or 'missing'
      // Keep evidence_gaps so grounded_in references remain valid
      const baseInput = buildTestInput();
      const input = {
        ...baseInput,
        m1Coaching: {
          ...baseInput.m1Coaching,
          readiness: 'needs_framing',
        },
      };
      const config = { baseUrl: 'https://cee.test', apiKey: 'test-key' };

      // Return review that doesn't include required phrases for needs_framing
      // Also avoid forbidden phrases like 'ready to proceed', 'confident', 'clear choice'
      const misalignedReview = {
        ...VALID_READY_REVIEW,
        // Uses grounded numbers (77%, 88%) but lacks 'framing', 'structure', or 'missing'
        narrative_summary: 'Option A has 77% win probability. The recommendation shows 88% stability.',
        readiness_rationale: 'We should carefully consider this decision given the data.',
      };

      vi.spyOn(ceeClient, 'callDecisionReview').mockResolvedValue({
        review: misalignedReview,
        error: null,
        meta: { model: 'test-model', latency_ms: 500, tokens: 1000 },
      });

      const result = await orchestrateDecisionReview(input, config);

      // READINESS_MISALIGNMENT alone gets downgraded to warning, not failure
      expect(result.review_status).toBe('complete');
      expect(result.m1_review).not.toBeNull();
      expect(result.review_warnings).toBeDefined();
      expect(result.review_warnings).toContain('READINESS_MISALIGNMENT');
    });

    it('returns complete with warnings when READINESS_CONTRADICTION is only failure', async () => {
      vi.spyOn(FLAGS, 'DECISION_REVIEW_ENABLE', 'get').mockReturnValue(true);

      // Set readiness to 'needs_evidence' which forbids 'confident', 'ready to proceed', 'clear choice'
      const baseInput = buildTestInput();
      const input = {
        ...baseInput,
        m1Coaching: {
          ...baseInput.m1Coaching,
          readiness: 'needs_evidence',
        },
      };
      const config = { baseUrl: 'https://cee.test', apiKey: 'test-key' };

      // Return review with forbidden phrase for needs_evidence readiness
      const contradictionReview = {
        ...VALID_READY_REVIEW,
        // "confident" and "ready to proceed" are forbidden for needs_evidence
        // Use grounded numbers (77%, 88%) so UNGROUNDED_NUMBER doesn't fire
        narrative_summary: 'We are confident Option A wins with 77% probability. Ready to proceed.',
        readiness_rationale: 'This is a clear choice with 88% stability. We should definitely go ahead.',
      };

      vi.spyOn(ceeClient, 'callDecisionReview').mockResolvedValue({
        review: contradictionReview,
        error: null,
        meta: { model: 'test-model', latency_ms: 500, tokens: 1000 },
      });

      const result = await orchestrateDecisionReview(input, config);

      // READINESS_CONTRADICTION alone gets downgraded to warning, not failure
      expect(result.review_status).toBe('complete');
      expect(result.m1_review).not.toBeNull();
      expect(result.review_warnings).toBeDefined();
      expect(result.review_warnings).toContain('READINESS_CONTRADICTION');
    });

    it('returns complete with warnings when MISSING_BRIEF_EVIDENCE is only failure', async () => {
      vi.spyOn(FLAGS, 'DECISION_REVIEW_ENABLE', 'get').mockReturnValue(true);

      const input = buildTestInput();
      const config = { baseUrl: 'https://cee.test', apiKey: 'test-key' };

      // Return review with semantic bias finding missing brief_evidence
      const missingEvidenceReview = {
        ...VALID_READY_REVIEW,
        bias_findings: [
          {
            type: 'SUNK_COST',
            source: 'semantic',
            description: 'Prior investment may be influencing this decision.',
            affected_elements: ['factor-price'],
            // Missing brief_evidence → MISSING_BRIEF_EVIDENCE
          },
        ],
      };

      vi.spyOn(ceeClient, 'callDecisionReview').mockResolvedValue({
        review: missingEvidenceReview,
        error: null,
        meta: { model: 'test-model', latency_ms: 500, tokens: 1000 },
      });

      const result = await orchestrateDecisionReview(input, config);

      expect(result.review_status).toBe('complete');
      expect(result.m1_review).not.toBeNull();
      expect(result.review_warnings).toBeDefined();
      expect(result.review_warnings).toContain('MISSING_BRIEF_EVIDENCE');
    });

    it('returns complete with warnings when BRIEF_EVIDENCE_TOO_SHORT is only failure', async () => {
      vi.spyOn(FLAGS, 'DECISION_REVIEW_ENABLE', 'get').mockReturnValue(true);

      const input = buildTestInput();
      const config = { baseUrl: 'https://cee.test', apiKey: 'test-key' };

      // Return review with brief_evidence that's too short (< 12 chars)
      const shortEvidenceReview = {
        ...VALID_READY_REVIEW,
        bias_findings: [
          {
            type: 'ANCHORING',
            source: 'semantic',
            description: 'Price anchoring detected.',
            affected_elements: ['factor-price'],
            brief_evidence: 'price', // Too short
          },
        ],
      };

      vi.spyOn(ceeClient, 'callDecisionReview').mockResolvedValue({
        review: shortEvidenceReview,
        error: null,
        meta: { model: 'test-model', latency_ms: 500, tokens: 1000 },
      });

      const result = await orchestrateDecisionReview(input, config);

      expect(result.review_status).toBe('complete');
      expect(result.m1_review).not.toBeNull();
      expect(result.review_warnings).toBeDefined();
      expect(result.review_warnings).toContain('BRIEF_EVIDENCE_TOO_SHORT');
    });

    it('returns complete with warnings when BRIEF_EVIDENCE_NOT_SUBSTRING is only failure', async () => {
      vi.spyOn(FLAGS, 'DECISION_REVIEW_ENABLE', 'get').mockReturnValue(true);

      const input = buildTestInput();
      const config = { baseUrl: 'https://cee.test', apiKey: 'test-key' };

      // Return review with brief_evidence not found in the brief text
      const notSubstringReview = {
        ...VALID_READY_REVIEW,
        bias_findings: [
          {
            type: 'CONFIRMATION_BIAS',
            source: 'semantic',
            description: 'Confirmation bias in market analysis.',
            affected_elements: ['factor-market'],
            brief_evidence: 'This exact phrase is not in the brief at all',
          },
        ],
      };

      vi.spyOn(ceeClient, 'callDecisionReview').mockResolvedValue({
        review: notSubstringReview,
        error: null,
        meta: { model: 'test-model', latency_ms: 500, tokens: 1000 },
      });

      const result = await orchestrateDecisionReview(input, config);

      expect(result.review_status).toBe('complete');
      expect(result.m1_review).not.toBeNull();
      expect(result.review_warnings).toBeDefined();
      expect(result.review_warnings).toContain('BRIEF_EVIDENCE_NOT_SUBSTRING');
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

  describe('Warning-Grade Codes (Phase 3)', () => {
    const config = { baseUrl: 'https://cee.test', apiKey: 'test-key' };

    beforeEach(() => {
      vi.spyOn(FLAGS, 'DECISION_REVIEW_ENABLE', 'get').mockReturnValue(true);
    });

    it('returns complete with warnings when CONSEQUENCE_INVALID_OPTION is only failure', async () => {
      const input = buildTestInput();
      const review = {
        ...VALID_READY_REVIEW,
        scenario_contexts: {
          'edge-3': {
            trigger_description: 'If confidence drops below 70%, the recommendation may flip.',
            consequence: 'Option C becomes the best choice.', // Option C doesn't exist
          },
        },
      };

      vi.spyOn(ceeClient, 'callDecisionReview').mockResolvedValue({
        review, error: null, meta: { model: 'test', latency_ms: 100, tokens: 500 },
      });

      const result = await orchestrateDecisionReview(input, config);
      expect(result.review_status).toBe('complete');
      expect(result.m1_review).not.toBeNull();
      expect(result.review_warnings).toContain('CONSEQUENCE_INVALID_OPTION');
    });

    it('returns complete with warnings when INVALID_SCENARIO_EDGE is only failure', async () => {
      const input = buildTestInput();
      const review = {
        ...VALID_READY_REVIEW,
        scenario_contexts: {
          'edge-999': { // Not a fragile edge
            trigger_description: 'If this edge changes...',
            consequence: 'Option B becomes competitive.', // Valid option reference
          },
        },
      };

      vi.spyOn(ceeClient, 'callDecisionReview').mockResolvedValue({
        review, error: null, meta: { model: 'test', latency_ms: 100, tokens: 500 },
      });

      const result = await orchestrateDecisionReview(input, config);
      expect(result.review_status).toBe('complete');
      expect(result.m1_review).not.toBeNull();
      expect(result.review_warnings).toContain('INVALID_SCENARIO_EDGE');
    });

    it('returns complete with warnings when PREMORTEM_NOT_GROUNDED is only failure', async () => {
      const input = buildTestInput();
      const review = {
        ...VALID_READY_REVIEW,
        pre_mortem: {
          failure_scenario: 'Everything fails',
          warning_signs: ['Bad signs'],
          mitigation: 'Do something',
          grounded_in: [], // Empty — not grounded
        },
      };

      vi.spyOn(ceeClient, 'callDecisionReview').mockResolvedValue({
        review, error: null, meta: { model: 'test', latency_ms: 100, tokens: 500 },
      });

      const result = await orchestrateDecisionReview(input, config);
      expect(result.review_status).toBe('complete');
      expect(result.m1_review).not.toBeNull();
      expect(result.review_warnings).toContain('PREMORTEM_NOT_GROUNDED');
    });

    it('returns complete with warnings when INVALID_GROUNDING_ID is only failure', async () => {
      const input = buildTestInput();
      const review = {
        ...VALID_READY_REVIEW,
        pre_mortem: {
          failure_scenario: 'Market collapse',
          warning_signs: ['Market signals'],
          mitigation: 'Pivot plan',
          grounded_in: ['invalid-id-999'], // Invalid ID
        },
      };

      vi.spyOn(ceeClient, 'callDecisionReview').mockResolvedValue({
        review, error: null, meta: { model: 'test', latency_ms: 100, tokens: 500 },
      });

      const result = await orchestrateDecisionReview(input, config);
      expect(result.review_status).toBe('complete');
      expect(result.m1_review).not.toBeNull();
      expect(result.review_warnings).toContain('INVALID_GROUNDING_ID');
    });

    it('returns complete with warnings when STRUCTURAL_LIMIT_EXCEEDED is only failure', async () => {
      // STRUCTURAL_LIMIT_EXCEEDED is unreachable through the normal orchestrator flow
      // because Zod's .max() enforces the same array limits. To test the warning-grade
      // downgrade, we bypass Zod by mocking safeParseM1Review to return a review
      // with arrays exceeding structural limits.
      const input = buildTestInput();
      const exceedingReview = {
        ...VALID_READY_REVIEW,
        bias_findings: [
          { type: 'A', source: 'structural' as const, description: 'One', affected_elements: [], linked_critique_code: 'A' },
          { type: 'B', source: 'structural' as const, description: 'Two', affected_elements: [], linked_critique_code: 'B' },
          { type: 'C', source: 'structural' as const, description: 'Three', affected_elements: [], linked_critique_code: 'C' },
          { type: 'D', source: 'structural' as const, description: 'Four', affected_elements: [], linked_critique_code: 'D' },
        ],
      };

      vi.spyOn(ceeClient, 'callDecisionReview').mockResolvedValue({
        review: exceedingReview, error: null, meta: { model: 'test', latency_ms: 100, tokens: 500 },
      });
      vi.spyOn(m1ReviewTypes, 'safeParseM1Review').mockReturnValueOnce({
        success: true, data: exceedingReview,
      } as any);

      const result = await orchestrateDecisionReview(input, config);
      expect(result.review_status).toBe('complete');
      expect(result.m1_review).not.toBeNull();
      expect(result.review_warnings).toContain('STRUCTURAL_LIMIT_EXCEEDED');
    });

    it('returns complete with warnings when INVALID_PROMPT_STRUCTURE is only failure', async () => {
      const input = buildTestInput();
      const review = {
        ...VALID_READY_REVIEW,
        decision_quality_prompts: [
          {
            principle: '', // Empty principle
            applies_because: 'Some reason',
            question: 'No question mark', // Missing ?
          },
        ],
      };

      vi.spyOn(ceeClient, 'callDecisionReview').mockResolvedValue({
        review, error: null, meta: { model: 'test', latency_ms: 100, tokens: 500 },
      });

      const result = await orchestrateDecisionReview(input, config);
      expect(result.review_status).toBe('complete');
      expect(result.m1_review).not.toBeNull();
      expect(result.review_warnings).toContain('INVALID_PROMPT_STRUCTURE');
    });

    it('returns failed when warning-grade + blocking code both present', async () => {
      // INVALID_SCENARIO_EDGE (warning) + MODIFIED_VALUES (blocking) → failed
      const input = buildTestInput({ preResolvedFlipData: BASE_FLIP_THRESHOLD_DATA });
      const review = {
        ...VALID_READY_REVIEW,
        scenario_contexts: {
          'edge-999': { // Invalid edge → INVALID_SCENARIO_EDGE
            trigger_description: 'If this edge changes...',
            consequence: 'Option B becomes competitive.',
          },
        },
        flip_thresholds: [
          {
            factor_id: 'factor-market',
            factor_label: 'Market Demand',
            current_value: 0.9, // Modified from 0.7 → MODIFIED_VALUES
            flip_value: null,
            direction: 'decrease',
            plain_english: 'Market demand flip threshold.',
          },
        ],
      };

      vi.spyOn(ceeClient, 'callDecisionReview').mockResolvedValue({
        review, error: null, meta: { model: 'test', latency_ms: 100, tokens: 500 },
      });

      const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const result = await orchestrateDecisionReview(input, config, mockLogger as any);
      expect(result.review_status).toBe('failed');
      expect(result.m1_review).toBeNull();
      expect(result.review_failure_codes).toContain('INVALID_SCENARIO_EDGE');
      expect(result.review_failure_codes).toContain('MODIFIED_VALUES');

      // B1.2: Structured logging must emit blocking/warning breakdown on hard failure
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: DecisionReviewEvents.VALIDATION_FAILED,
          blocking_codes: expect.arrayContaining(['MODIFIED_VALUES']),
          warning_grade_codes: expect.arrayContaining(['INVALID_SCENARIO_EDGE']),
        }),
      );
    });

    it('returns failed when single blocking code (MODIFIED_VALUES) present', async () => {
      const input = buildTestInput({ preResolvedFlipData: BASE_FLIP_THRESHOLD_DATA });
      const review = {
        ...VALID_READY_REVIEW,
        flip_thresholds: [
          {
            factor_id: 'factor-market',
            factor_label: 'Market Demand',
            current_value: 0.9, // Modified from 0.7 → MODIFIED_VALUES
            flip_value: null,
            direction: 'decrease',
            plain_english: 'Market demand flip threshold.',
          },
        ],
      };

      vi.spyOn(ceeClient, 'callDecisionReview').mockResolvedValue({
        review, error: null, meta: { model: 'test', latency_ms: 100, tokens: 500 },
      });

      const result = await orchestrateDecisionReview(input, config);
      expect(result.review_status).toBe('failed');
      expect(result.m1_review).toBeNull();
      expect(result.review_failure_codes).toContain('MODIFIED_VALUES');
    });

    it('WARNING_GRADE_CODES contains all 12 expected codes', () => {
      // Verify the centralised set has all expected codes
      expect(WARNING_GRADE_CODES.has(M1ReviewFailureCodes.UNGROUNDED_NUMBER)).toBe(true);
      expect(WARNING_GRADE_CODES.has(M1ReviewFailureCodes.READINESS_MISALIGNMENT)).toBe(true);
      expect(WARNING_GRADE_CODES.has(M1ReviewFailureCodes.READINESS_CONTRADICTION)).toBe(true);
      expect(WARNING_GRADE_CODES.has(M1ReviewFailureCodes.MISSING_BRIEF_EVIDENCE)).toBe(true);
      expect(WARNING_GRADE_CODES.has(M1ReviewFailureCodes.BRIEF_EVIDENCE_TOO_SHORT)).toBe(true);
      expect(WARNING_GRADE_CODES.has(M1ReviewFailureCodes.BRIEF_EVIDENCE_NOT_SUBSTRING)).toBe(true);
      expect(WARNING_GRADE_CODES.has(M1ReviewFailureCodes.CONSEQUENCE_INVALID_OPTION)).toBe(true);
      expect(WARNING_GRADE_CODES.has(M1ReviewFailureCodes.INVALID_SCENARIO_EDGE)).toBe(true);
      expect(WARNING_GRADE_CODES.has(M1ReviewFailureCodes.PREMORTEM_NOT_GROUNDED)).toBe(true);
      expect(WARNING_GRADE_CODES.has(M1ReviewFailureCodes.INVALID_GROUNDING_ID)).toBe(true);
      expect(WARNING_GRADE_CODES.has(M1ReviewFailureCodes.STRUCTURAL_LIMIT_EXCEEDED)).toBe(true);
      expect(WARNING_GRADE_CODES.has(M1ReviewFailureCodes.INVALID_PROMPT_STRUCTURE)).toBe(true);
      // B1.2: MISSING_OPTION_HEADLINE and MISSING_CRITIQUE_CODE now warning-grade
      expect(WARNING_GRADE_CODES.has(M1ReviewFailureCodes.MISSING_OPTION_HEADLINE)).toBe(true);
      expect(WARNING_GRADE_CODES.has(M1ReviewFailureCodes.MISSING_CRITIQUE_CODE)).toBe(true);
      expect(WARNING_GRADE_CODES.size).toBe(14);

      // Only MODIFIED_VALUES remains blocking (data integrity)
      expect(WARNING_GRADE_CODES.has(M1ReviewFailureCodes.MODIFIED_VALUES)).toBe(false);
    });

    it('every M1ReviewFailureCode is classified as either warning-grade or blocking', () => {
      // Blocking codes — intentionally NOT in WARNING_GRADE_CODES
      // B1.2: Only MODIFIED_VALUES remains blocking (data integrity violation)
      const BLOCKING_CODES = new Set([
        M1ReviewFailureCodes.MODIFIED_VALUES,
      ]);

      // All 15 M1ReviewFailureCodes
      const allCodes = Object.values(M1ReviewFailureCodes);
      expect(allCodes.length).toBe(15);

      for (const code of allCodes) {
        const inWarning = WARNING_GRADE_CODES.has(code);
        const inBlocking = BLOCKING_CODES.has(code);
        // Each code must be in exactly one set
        expect(inWarning || inBlocking).toBe(true);
        expect(inWarning && inBlocking).toBe(false);
      }

      // Union must cover all codes
      expect(WARNING_GRADE_CODES.size + BLOCKING_CODES.size).toBe(allCodes.length);
    });

    it('returns complete with all warnings when 3+ warning-grade codes fire simultaneously', async () => {
      // Trigger INVALID_SCENARIO_EDGE + CONSEQUENCE_INVALID_OPTION + INVALID_PROMPT_STRUCTURE
      const input = buildTestInput();
      const review = {
        ...VALID_READY_REVIEW,
        scenario_contexts: {
          'edge-999': { // Not a fragile edge → INVALID_SCENARIO_EDGE
            trigger_description: 'If this edge changes...',
            consequence: 'Option C becomes better.', // Invalid option → CONSEQUENCE_INVALID_OPTION
          },
        },
        decision_quality_prompts: [
          {
            principle: '', // Empty → INVALID_PROMPT_STRUCTURE
            applies_because: 'Some reason',
            question: 'No question mark',
          },
        ],
      };

      vi.spyOn(ceeClient, 'callDecisionReview').mockResolvedValue({
        review, error: null, meta: { model: 'test', latency_ms: 100, tokens: 500 },
      });

      const result = await orchestrateDecisionReview(input, config);
      expect(result.review_status).toBe('complete');
      expect(result.m1_review).not.toBeNull();
      expect(result.review_warnings).toBeDefined();
      expect(result.review_warnings).toContain('INVALID_SCENARIO_EDGE');
      expect(result.review_warnings).toContain('CONSEQUENCE_INVALID_OPTION');
      expect(result.review_warnings).toContain('INVALID_PROMPT_STRUCTURE');
      expect(result.review_warnings!.length).toBeGreaterThanOrEqual(3);
    });
  });
});
