/**
 * Decision Review Orchestrator
 *
 * Orchestrates the M2 decision review flow:
 * 1. Check flag (DECISION_REVIEW_ENABLE)
 * 2. Check cache
 * 3. Assemble request
 * 4. Call CEE
 * 5. Validate response
 * 6. Cache valid result
 * 7. Return result for merging
 *
 * @see Brief: M2 Decision Review Integration, Task 6
 */

import type { FastifyBaseLogger } from 'fastify';
import { createHash } from 'node:crypto';
import { FLAGS } from '../config/flags.js';
import type { EngineGraphV3, OptionV3 } from '../types/engine-v3.js';
import type { M1Coaching } from '../coaching/types.js';
import type { M1Review, DecisionReviewResult } from './validation/m1-review-types.js';
import { safeParseM1Review } from './validation/m1-review-types.js';
import { validateM1Review, buildValidationContext } from './validation/m1-review-validator.js';
import { buildDecisionReviewRequest, type ISLResultInput } from './decision-review-request.js';
import { callDecisionReview, type CEESchemaV2Config } from './client.js';
import {
  computeCacheKey,
  getCachedReview,
  setCachedReview,
} from './validation/review-cache.js';
import { DecisionReviewEvents } from './validation/m1-review-constants.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Input for decision review orchestration.
 */
export interface DecisionReviewInput {
  /** User's decision brief text */
  brief: string;
  /** Normalized/filtered graph */
  graph: EngineGraphV3;
  /** Request options */
  options: OptionV3[];
  /** ISL response data */
  islResult: ISLResultInput;
  /** M1 coaching output */
  m1Coaching: M1Coaching;
  /** Response hash (used for cache key) */
  responseHash: string;
  /** Request ID for tracing */
  requestId: string;
}

/**
 * CEE configuration for decision review.
 */
export interface DecisionReviewConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

// =============================================================================
// Main Orchestration Function
// =============================================================================

/**
 * Orchestrate decision review flow.
 *
 * @param input DecisionReviewInput
 * @param config CEE configuration (optional - uses env vars if not provided)
 * @param logger Optional logger
 * @returns DecisionReviewResult for merging into response
 */
export async function orchestrateDecisionReview(
  input: DecisionReviewInput,
  config?: DecisionReviewConfig,
  logger?: FastifyBaseLogger
): Promise<DecisionReviewResult> {
  const startMs = Date.now();

  // Check feature flag
  if (!FLAGS.DECISION_REVIEW_ENABLE) {
    logger?.info({
      event: DecisionReviewEvents.DISABLED,
      request_id: input.requestId,
    });
    return {
      m1_review: null,
      review_status: 'disabled',
    };
  }

  // Get CEE config
  const ceeConfig = config ?? getCeeConfig();
  if (!ceeConfig) {
    logger?.warn({
      event: DecisionReviewEvents.SKIPPED,
      request_id: input.requestId,
      reason: 'CEE not configured',
    });
    return {
      m1_review: null,
      review_status: 'skipped',
    };
  }

  // Compute cache key
  const briefHash = computeBriefHash(input.brief);
  const cacheKey = computeCacheKey(input.responseHash, briefHash);

  // Check cache
  const cached = getCachedReview(cacheKey);
  if (cached) {
    logger?.info({
      event: DecisionReviewEvents.CACHE_HIT,
      request_id: input.requestId,
      cache_key: cacheKey,
    });
    return {
      m1_review: cached.review,
      review_status: 'complete',
      review_meta: cached.meta,
    };
  }

  // Assemble request
  const request = buildDecisionReviewRequest(
    input.brief,
    input.graph,
    input.options,
    input.islResult,
    input.m1Coaching
  );

  // Log request (without brief text for privacy)
  logger?.info({
    event: DecisionReviewEvents.REQUESTED,
    request_id: input.requestId,
    brief_hash: briefHash,
    winner_id: request.winner.option_id,
    runner_up_id: request.runner_up?.option_id ?? null,
    cache_hit: false,
  });

  // Call CEE
  const ceeResult = await callDecisionReview(
    ceeConfig as CEESchemaV2Config,
    request,
    input.requestId
  );

  // Handle CEE error
  if (ceeResult.error || ceeResult.review === null) {
    const latencyMs = Date.now() - startMs;
    logger?.warn({
      event: DecisionReviewEvents.SKIPPED,
      request_id: input.requestId,
      error_code: ceeResult.error?.code ?? 'CEE_NO_REVIEW',
      latency_ms: latencyMs,
    });
    return {
      m1_review: null,
      review_status: 'skipped',
      review_meta: {
        latency_ms: ceeResult.meta.latency_ms,
      },
    };
  }

  // Parse and shape-validate the review
  const parseResult = safeParseM1Review(ceeResult.review);
  if (!parseResult.success) {
    const latencyMs = Date.now() - startMs;
    logger?.warn({
      event: DecisionReviewEvents.VALIDATION_FAILED,
      request_id: input.requestId,
      error_count: parseResult.error.errors.length,
      warning_count: 0,
      failure_codes: ['SHAPE_VALIDATION_FAILED'],
      latency_ms: latencyMs,
    });
    return {
      m1_review: null,
      review_status: 'failed',
      review_failure_codes: ['SHAPE_VALIDATION_FAILED'],
      review_meta: {
        model: ceeResult.meta.model,
        latency_ms: ceeResult.meta.latency_ms,
        tokens: ceeResult.meta.tokens,
      },
    };
  }

  const review = parseResult.data;

  // Build validation context from the same request object
  const validationContext = buildValidationContext(request);

  // Run 9-tier validation
  const validationResult = validateM1Review(review, validationContext);

  if (!validationResult.valid) {
    const latencyMs = Date.now() - startMs;
    logger?.warn({
      event: DecisionReviewEvents.VALIDATION_FAILED,
      request_id: input.requestId,
      error_count: validationResult.errors.length,
      warning_count: validationResult.warnings.length,
      failure_codes: validationResult.failure_codes,
      latency_ms: latencyMs,
    });
    return {
      m1_review: null,
      review_status: 'failed',
      review_failure_codes: validationResult.failure_codes,
      review_meta: {
        model: ceeResult.meta.model,
        latency_ms: ceeResult.meta.latency_ms,
        tokens: ceeResult.meta.tokens,
      },
    };
  }

  // Cache valid result
  setCachedReview(cacheKey, review, ceeResult.meta);

  // Success!
  const latencyMs = Date.now() - startMs;
  logger?.info({
    event: DecisionReviewEvents.COMPLETED,
    request_id: input.requestId,
    review_status: 'complete',
    model: ceeResult.meta.model,
    tokens: ceeResult.meta.tokens,
    latency_ms: latencyMs,
  });

  return {
    m1_review: review,
    review_status: 'complete',
    review_meta: {
      model: ceeResult.meta.model,
      latency_ms: ceeResult.meta.latency_ms,
      tokens: ceeResult.meta.tokens,
    },
  };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get CEE config from environment.
 */
function getCeeConfig(): DecisionReviewConfig | null {
  const baseUrl = process.env.CEE_BASE_URL?.trim();
  const apiKey = process.env.CEE_API_KEY?.trim();

  if (!baseUrl || !apiKey) {
    return null;
  }

  return {
    baseUrl,
    apiKey,
    timeoutMs: Number(process.env.CEE_DECISION_REVIEW_TIMEOUT_MS ?? 3000),
  };
}

/**
 * Compute brief hash.
 */
function computeBriefHash(brief: string): string {
  return createHash('sha256').update(brief).digest('hex').slice(0, 16);
}
