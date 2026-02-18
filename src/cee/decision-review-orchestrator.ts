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
import type { M1Review, DecisionReviewResult, FlipThresholdInputData } from './validation/m1-review-types.js';
import { safeParseM1Review } from './validation/m1-review-types.js';
import { validateM1Review, buildValidationContext, capScenarioContexts } from './validation/m1-review-validator.js';
import { buildDecisionReviewRequest, type ISLResultInput } from './decision-review-request.js';
import { CEE_DECISION_REVIEW_TIMEOUT_MS } from '../config/timeouts.js';
import { callDecisionReview, type CEESchemaV2Config } from './client.js';
import {
  computeCacheKey,
  getCachedReview,
  setCachedReview,
} from './validation/review-cache.js';
import { DecisionReviewEvents, M1ReviewFailureCodes, M1ReviewWarningCodes, ReviewSkipReasons } from './validation/m1-review-constants.js';
import { correctUngroundedNumbers, type IslResultsForCorrection } from './validation/number-corrector.js';
import { resolveFlipValues, type ISLInferenceFn } from '../analysis/flip-thresholds.js';

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
  /** Pre-resolved flip threshold data (from run.ts). When provided, orchestrator skips binary search. */
  preResolvedFlipData?: FlipThresholdInputData[];
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
  logger?: FastifyBaseLogger,
  islInferenceFn?: ISLInferenceFn
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
      review_skip_reason: ReviewSkipReasons.CEE_NOT_CONFIGURED,
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

  // Use pre-resolved flip data from run.ts if available (avoids redundant ISL calls).
  // Otherwise fall back to resolving via binary search (backward compatibility).
  if (input.preResolvedFlipData) {
    request.flip_threshold_data = input.preResolvedFlipData;
  } else if (islInferenceFn && request.flip_threshold_data.length > 0 && request.winner.id) {
    try {
      const flipResult = await resolveFlipValues(
        request.flip_threshold_data,
        islInferenceFn,
        request.winner.id
      );
      request.flip_threshold_data = flipResult.results;
      logger?.info({
        event: 'flip_threshold_resolved',
        request_id: input.requestId,
        factors: flipResult.diagnostics.length > 0 ? flipResult.diagnostics : request.flip_threshold_data.map((f) => ({
          factor_id: f.factor_id,
          flip_reason: f.flip_reason,
          flip_value: f.flip_value,
          iterations_used: f.iterations_used,
        })),
      });
    } catch (err) {
      logger?.warn({
        event: 'flip_threshold_resolve_failed',
        request_id: input.requestId,
        error: (err as Error).message,
      });
      // Continue with heuristic values — don't block the review
    }
  }

  // Log request (without brief text for privacy)
  logger?.info({
    event: DecisionReviewEvents.REQUESTED,
    request_id: input.requestId,
    brief_hash: briefHash,
    winner_id: request.winner.id,
    runner_up_id: request.runner_up?.id ?? null,
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
      review_skip_reason: ReviewSkipReasons.CEE_ERROR,
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

  const parsedReview = parseResult.data;

  // Run deterministic number correction BEFORE validation
  const islResultsForCorrection = buildIslResultsForCorrection(input.islResult);
  const { corrected: numberCorrectedReview, corrections } = correctUngroundedNumbers(
    parsedReview,
    islResultsForCorrection,
    request.winner.id,
    request.runner_up?.id
  );

  // Log corrections for observability
  if (corrections.length > 0) {
    logger?.info({
      event: 'M1_REVIEW_NUMBERS_CORRECTED',
      request_id: input.requestId,
      count: corrections.length,
      corrections,
    });
  }

  // Cap scenario_contexts at MAX_SCENARIO_CONTEXTS (truncate by relevance)
  const collectWarnings: string[] = [];
  const capResult = capScenarioContexts(
    numberCorrectedReview,
    request.isl_results.fragile_edges
  );
  const review = capResult.review;

  if (capResult.truncated) {
    collectWarnings.push(M1ReviewWarningCodes.SCENARIO_CONTEXTS_CAPPED);
    logger?.warn({
      event: 'SCENARIO_CONTEXTS_CAPPED',
      request_id: input.requestId,
      removed_keys: capResult.removedKeys,
      detail: capResult.warning,
    });
  }

  // Build validation context from the same request object
  const validationContext = buildValidationContext(request);

  // Run 9-tier validation on corrected review
  const validationResult = validateM1Review(review, validationContext);

  if (!validationResult.valid) {
    // Warning-grade failure codes that don't block the review.
    // These are tone/evidence-quality issues — users should see guidance
    // with caveats rather than nothing at all.
    const WARNING_GRADE_CODES: Set<string> = new Set([
      M1ReviewFailureCodes.UNGROUNDED_NUMBER,
      M1ReviewFailureCodes.READINESS_MISALIGNMENT,
      M1ReviewFailureCodes.READINESS_CONTRADICTION,
      M1ReviewFailureCodes.MISSING_BRIEF_EVIDENCE,
      M1ReviewFailureCodes.BRIEF_EVIDENCE_TOO_SHORT,
      M1ReviewFailureCodes.BRIEF_EVIDENCE_NOT_SUBSTRING,
    ]);

    // Check if ALL failure codes are warning-grade
    const failureCodes = validationResult.failure_codes;
    const allWarningGrade =
      failureCodes.length > 0 &&
      failureCodes.every((code) => WARNING_GRADE_CODES.has(code));

    if (allWarningGrade) {
      // Downgrade to warning - review is still usable
      setCachedReview(cacheKey, review, ceeResult.meta);

      const mergedWarnings = [...new Set([...failureCodes, ...collectWarnings])];
      const latencyMs = Date.now() - startMs;
      logger?.info({
        event: DecisionReviewEvents.COMPLETED,
        request_id: input.requestId,
        review_status: 'complete',
        review_warnings: mergedWarnings,
        model: ceeResult.meta.model,
        tokens: ceeResult.meta.tokens,
        latency_ms: latencyMs,
      });

      return {
        m1_review: review,
        review_status: 'complete',
        review_warnings: mergedWarnings,
        review_meta: {
          model: ceeResult.meta.model,
          latency_ms: ceeResult.meta.latency_ms,
          tokens: ceeResult.meta.tokens,
        },
      };
    }

    // Other failures remain hard failures
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
    ...(collectWarnings.length > 0 && { review_warnings: collectWarnings }),
    model: ceeResult.meta.model,
    tokens: ceeResult.meta.tokens,
    latency_ms: latencyMs,
  });

  return {
    m1_review: review,
    review_status: 'complete',
    ...(collectWarnings.length > 0 && { review_warnings: collectWarnings }),
    review_meta: {
      model: ceeResult.meta.model,
      latency_ms: ceeResult.meta.latency_ms,
      tokens: ceeResult.meta.tokens,
    },
  };
}

/**
 * Build ISL results format for number correction.
 */
function buildIslResultsForCorrection(islResult: ISLResultInput): IslResultsForCorrection {
  const options = islResult.options ?? islResult.results ?? [];

  return {
    option_comparison: options.map((opt) => ({
      option_id: opt.option_id ?? opt.id ?? '',
      option_label: opt.option_label ?? opt.label ?? '',
      win_probability: opt.win_probability ?? 0,
      expected_outcome: opt.expected_outcome ?? opt.outcome?.mean,
    })),
    robustness: {
      recommendation_stability: islResult.robustness?.recommendation_stability ?? 0,
    },
    factor_sensitivity: (islResult.factor_sensitivity ?? []).map((f) => ({
      factor_id: f.factor_id,
      elasticity: f.elasticity ?? 0,
      confidence: f.confidence,
    })),
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
    timeoutMs: CEE_DECISION_REVIEW_TIMEOUT_MS,
  };
}

/**
 * Compute brief hash.
 */
function computeBriefHash(brief: string): string {
  return createHash('sha256').update(brief).digest('hex').slice(0, 16);
}
