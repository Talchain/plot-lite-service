/**
 * ISL retry budgeting — ROADMAP 2.202.
 *
 * THE DEFECT THIS REPLACES
 * -----------------------
 * `ISLClient.request` bounded retries with a TOTAL-ATTEMPT COUNT fixed before
 * the first byte was sent, and `/v2/run` derived that count from WORST-CASE
 * timeouts:
 *
 *   worstCaseMs(2, 60_000) = 121_000  >  ~69_800 remaining  →  1 attempt
 *
 * So the base robustness call got ZERO retries. When ISL's compute governor
 * rejected a 3rd concurrent analysis with a 429 that came back in **133 ms**,
 * PLoT converted it straight to a typed-failure envelope with **~69.8 s of the
 * request budget unspent** — and CEE mapped that to an HTTP 500 the tester saw.
 * The 429 classifier (`ISLHttpError.isRetryable`) was already correct; the retry
 * was structurally unreachable.
 *
 * The policy was DURATION-BLIND: it priced every failure at a full per-attempt
 * timeout, so a failure that consumed 0.2% of the budget was treated exactly
 * like one that consumed all of it.
 *
 * THE REPLACEMENT
 * ---------------
 * Decide AFTER the failure, from the budget that ACTUALLY remains: project the
 * next attempt's cost (`delay + per-attempt timeout`) and retry iff that
 * projection plus a safety margin still fits.
 *
 * Everything is derived — there is no "is this failure fast?" constant:
 *   • fast 429  → 133 ms spent, ~69.8 s left, projection ~65 s → RETRY
 *   • slow fail → budget already consumed, projection does not fit → NO RETRY
 *     (this is precisely the property the old up-front clamp existed to
 *     protect, and it is preserved exactly)
 *   • an absurd `Retry-After: 3600` self-limits: the projection is 3.6 M ms,
 *     which cannot fit, so it terminates with the typed failure. No arbitrary
 *     cap is needed, and none is invented.
 *
 * An attempt is only ever STARTED when its FULL per-attempt timeout still fits,
 * so the total can never overrun the caller's budget.
 *
 * DELIBERATELY NOT DONE: the retry's per-attempt timeout is not re-clamped
 * downward to squeeze an extra attempt into a shrinking budget. That would
 * truncate a slow-but-successful call — the exact harm the base-call clamp's
 * own comment says it avoids.
 *
 * BLAST RADIUS: when no budget is supplied the decision degenerates to EXACTLY
 * the previous behaviour (attempt cap + exponential backoff). Only the /v2/run
 * base robustness call passes a budget; flip probes, thresholds and health are
 * untouched.
 */

import { islRetryBackoffMs } from '../../config/timeouts.js';

/**
 * The wall-clock budget a caller lends to one ISL request, for retry decisions.
 */
export interface ISLRetryBudget {
  /**
   * Wall-clock ms still available to this call at the moment `request()` is
   * entered. The client converts it to an absolute deadline against its own
   * clock, so the caller never has to share a clock with the client.
   */
  remainingMs: number;
  /**
   * Reserve kept unspent so the caller can still assemble and return its
   * response after the last attempt. Defaults to
   * {@link DEFAULT_RETRY_SAFETY_MARGIN_MS}.
   */
  safetyMarginMs?: number;
}

/**
 * Default reserve left unspent by the retry decision. Matches the 1 s safety
 * margin `/v2/run` already subtracts when clamping the base call's per-attempt
 * timeout, so the two guards agree rather than drifting apart.
 */
export const DEFAULT_RETRY_SAFETY_MARGIN_MS = 1_000;

/** Why the retry decision came out the way it did (telemetry + tests). */
export type ISLRetryReason =
  /** Error class is not retryable (4xx other than 429). */
  | 'not_retryable'
  /** The configured total-attempt cap is spent. */
  | 'attempt_cap'
  /** Retryable and the next attempt fits the remaining budget. */
  | 'budget_available'
  /** Retryable, attempts remain, but the next attempt does NOT fit the budget. */
  | 'budget_exhausted'
  /** No budget supplied — legacy behaviour: attempts remain, so retry. */
  | 'attempts_remaining';

export interface ISLRetryDecision {
  retry: boolean;
  /** ms to sleep before the next attempt (0 when not retrying). */
  delayMs: number;
  reason: ISLRetryReason;
  /** True when ISL's `Retry-After` (not our backoff) set the delay. */
  retryAfterHonoured: boolean;
  /** Our own exponential backoff for this attempt, before Retry-After. */
  backoffMs: number;
  /** Budget left at the decision point — `undefined` when none was supplied. */
  remainingMs?: number;
  /** `delayMs + perAttemptTimeoutMs` — what the next attempt could cost. */
  projectedCostMs: number;
}

export interface ISLRetryDecisionInput {
  /** Did the error classifier say this failure is retryable? */
  retryable: boolean;
  /** 1-indexed attempt that just failed. */
  attempt: number;
  /** Total attempts allowed (the `maxRetries` cap). */
  maxAttempts: number;
  /** ms elapsed since `request()` was entered. */
  elapsedMs: number;
  /** Per-attempt timeout the next attempt would use. */
  perAttemptTimeoutMs: number;
  /** ISL's `Retry-After` in ms, when it sent a usable one. */
  retryAfterMs?: number;
  /** Caller's budget. Omitted → legacy attempt-cap-only behaviour. */
  budget?: ISLRetryBudget;
}

/**
 * Decide whether to retry a failed ISL attempt, and how long to wait first.
 *
 * Pure: no clocks, no I/O. Every input is passed in so the decision can be
 * pinned directly, without driving a server.
 */
export function decideIslRetry(input: ISLRetryDecisionInput): ISLRetryDecision {
  const {
    retryable,
    attempt,
    maxAttempts,
    elapsedMs,
    perAttemptTimeoutMs,
    retryAfterMs,
    budget,
  } = input;

  const backoffMs = islRetryBackoffMs(attempt);

  // `Retry-After` is a MINIMUM wait, not an instruction to wait less: never
  // retry sooner than the server asked, and never sooner than our own backoff.
  const retryAfterUsable =
    typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs >= 0;
  const delayMs = retryAfterUsable ? Math.max(retryAfterMs, backoffMs) : backoffMs;
  const retryAfterHonoured = retryAfterUsable && retryAfterMs > backoffMs;
  const projectedCostMs = delayMs + perAttemptTimeoutMs;

  const no = (reason: ISLRetryReason): ISLRetryDecision => ({
    retry: false,
    delayMs: 0,
    reason,
    retryAfterHonoured: false,
    backoffMs,
    remainingMs: budget ? budget.remainingMs - elapsedMs : undefined,
    projectedCostMs,
  });

  if (!retryable) return no('not_retryable');
  if (attempt >= maxAttempts) return no('attempt_cap');

  // No budget supplied → EXACTLY the previous behaviour. This is what keeps the
  // change scoped to the base call.
  if (!budget) {
    return {
      retry: true,
      delayMs,
      reason: 'attempts_remaining',
      retryAfterHonoured,
      backoffMs,
      remainingMs: undefined,
      projectedCostMs,
    };
  }

  const safetyMarginMs = budget.safetyMarginMs ?? DEFAULT_RETRY_SAFETY_MARGIN_MS;
  const remainingMs = budget.remainingMs - elapsedMs;

  // Start an attempt only when its FULL per-attempt timeout still fits, so the
  // total can never outlive the caller's budget.
  if (projectedCostMs + safetyMarginMs > remainingMs) return no('budget_exhausted');

  return {
    retry: true,
    delayMs,
    reason: 'budget_available',
    retryAfterHonoured,
    backoffMs,
    remainingMs,
    projectedCostMs,
  };
}
