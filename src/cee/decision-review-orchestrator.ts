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
import type { DecisionReviewResult, FlipThresholdInputData } from './validation/m1-review-types.js';
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
import { DecisionReviewEvents, M1ReviewWarningCodes, ReviewSkipReasons, WARNING_GRADE_CODES } from './validation/m1-review-constants.js';
import { correctUngroundedNumbers, type IslResultsForCorrection } from './validation/number-corrector.js';
import { resolveFlipValues, type ISLInferenceFn } from '../analysis/flip-thresholds.js';
import { denormaliseFlipThresholds } from '../lib/flip-threshold-denormaliser.js';
import { toPromptFlipThresholdData } from '../lib/flip-threshold-prompt-input.js';
import {
  interventionTargetIdsFromOptions,
  isOptionControlledLever,
} from '../lib/intervention-override.js';

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

  // ROADMAP 2.1248: null ⇔ ISL returned no analysed options, so no winner
  // exists. CEE's DecisionReviewInputSchema requires a non-null winner, and
  // the old fabricated `{id:'', label:'', win_probability: 0}` reached the
  // reviewing model as a measured figure. Skip with a named reason instead —
  // visible absence over confident wrongness.
  if (request === null) {
    logger?.warn({
      event: DecisionReviewEvents.SKIPPED,
      request_id: input.requestId,
      reason: ReviewSkipReasons.NO_ANALYSED_OPTIONS,
    });
    return {
      m1_review: null,
      review_status: 'skipped',
      review_skip_reason: ReviewSkipReasons.NO_ANALYSED_OPTIONS,
    };
  }

  // Use pre-resolved flip data from run.ts if available (avoids redundant ISL calls).
  // Otherwise fall back to resolving via binary search (backward compatibility).
  if (input.preResolvedFlipData) {
    // Already denormalised AND prompt-filtered by run.ts (2.676) — forwarded
    // verbatim, never reprocessed here.
    request.flip_threshold_data = input.preResolvedFlipData;
  } else {
    if (islInferenceFn && request.flip_threshold_data.length > 0 && request.winner.id) {
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
            probes_used: f.probes_used,
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

    // ROADMAP 2.685 — the fallback rows get the SAME denormalise-or-drop rule
    // the main path shipped for 2.676, applied by COMPOSING the same leaves
    // (`denormaliseFlipThresholds` + `toPromptFlipThresholdData`), never a
    // re-implementation that could drift.
    //
    // Why: `computeFlipThresholdData` reads `observed_state.value` — the
    // NORMALISED number — and pairs it with the user's `unit`. CEE's
    // decision_review prompt is told these are user units, and Tier-7
    // (`validateFlipThresholds`, via `buildValidationContext(request)`) then
    // enforces the review's `current_display` against this SAME array. So on
    // this path a normalised 0.5 wearing "GBP" either ships as a fabricated
    // magnitude or — when the model honestly corrects it — trips BLOCKING
    // `MODIFIED_VALUES` and kills the entire review. Fallback rows are all
    // `flip_value: null`, so `current_value`/`current_display` is the whole
    // exposure.
    //
    // Placed AFTER the legacy resolveFlipValues branch on purpose: the binary
    // search probes ISL in NORMALISED space, so lifting must not run before
    // it; and any flip values it finds are normalised too, so they need the
    // same lift-or-drop on the way out.
    if (request.flip_threshold_data.length > 0) {
      const optionLabels = input.options.map((o) => ({ id: o.id, label: o.label ?? o.id }));
      const denormalised = denormaliseFlipThresholds(
        request.flip_threshold_data,
        undefined,
        optionLabels,
        input.graph
      );
      const promptSafe = toPromptFlipThresholdData(denormalised);
      const refused = denormalised.length - promptSafe.length;
      if (refused > 0) {
        // Counts only — never a factor id, never a value (same discipline as
        // run.ts's `decision_review_flip_rows_scale_refused`).
        logger?.info({
          event: 'decision_review_flip_rows_scale_refused',
          request_id: input.requestId,
          refused,
          total: denormalised.length,
          source: 'fallback_builder',
        });
      }
      request.flip_threshold_data = promptSafe;
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

  // Run deterministic number correction BEFORE validation. The correction
  // input is union-filtered (same leaf derivation as buildDecisionReviewRequest)
  // so the corrector can never inject an option-controlled lever's elasticity
  // into the returned narrative (public wire via the m1_review merge).
  const islResultsForCorrection = buildIslResultsForCorrection(
    input.islResult,
    interventionTargetIdsFromOptions(input.options)
  );
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
    // Check if ALL failure codes are warning-grade (imported from m1-review-constants)
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

    // Other failures remain hard failures (at least one blocking code present)
    const latencyMs = Date.now() - startMs;
    const warningGradeCodes = failureCodes.filter((c) => WARNING_GRADE_CODES.has(c));
    const blockingCodes = failureCodes.filter((c) => !WARNING_GRADE_CODES.has(c));
    logger?.warn({
      event: DecisionReviewEvents.VALIDATION_FAILED,
      request_id: input.requestId,
      error_count: validationResult.errors.length,
      warning_count: validationResult.warnings.length,
      failure_codes: validationResult.failure_codes,
      blocking_codes: blockingCodes,
      warning_grade_codes: warningGradeCodes,
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
 *
 * factor_sensitivity is filtered with the combined D-U lever predicate
 * (ISL stamp OR structural union) — the same filter as the CEE request's
 * isl_results.factor_sensitivity — so the number-corrector's "authoritative"
 * pool can never contain an option-controlled lever's elasticity (review
 * fixup, PR #219: this builder previously read raw ISL with NO filter).
 *
 * Exported for tests (du-structural-lever-guard.decision-review.integration).
 *
 * @param structuralLeverIds Canonical union from interventionTargetIdsFromOptions.
 */
export function buildIslResultsForCorrection(
  islResult: ISLResultInput,
  structuralLeverIds?: ReadonlySet<string>
): IslResultsForCorrection {
  const options = islResult.options ?? islResult.results ?? [];

  return {
    option_comparison: options.map((opt) => ({
      option_id: opt.option_id ?? opt.id ?? '',
      option_label: opt.option_label ?? opt.label ?? '',
      win_probability: opt.win_probability ?? 0,
      expected_outcome: opt.expected_outcome ?? opt.outcome?.mean,
    })),
    // ROADMAP 2.1248: absent stability stays ABSENT. `?? 0` handed the
    // number-corrector a fabricated 0 as an AUTHORITATIVE
    // 'robustness.recommendation_stability' source — it could "correct" a
    // model-written figure TO 0, or bless a written "0%" as grounded, for a
    // run ISL never assessed. A measured 0 is real and is preserved.
    robustness: {
      ...(islResult.robustness?.recommendation_stability !== undefined
        ? { recommendation_stability: islResult.robustness.recommendation_stability }
        : {}),
    },
    factor_sensitivity: (islResult.factor_sensitivity ?? [])
      .filter((f) => !isOptionControlledLever(f, structuralLeverIds))
      .map((f) => ({
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
