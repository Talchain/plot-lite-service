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
 *   • an absurd `Retry-After: 3600` self-limits ON THE BUDGETED PATH: the
 *     projection is 3.6 M ms, which cannot fit, so it terminates with the typed
 *     failure. No arbitrary cap is needed there, and none is invented.
 *     ⚠ That self-limiting is a property of the BUDGET, not of the parser — so
 *     the no-budget path must not honour `Retry-After` at all, and does not
 *     (see the `!budget` branch). Getting this wrong is what the first cut of
 *     2.202 did, and it is the one HIGH the adversarial review found.
 *
 * An attempt is only ever STARTED when its per-attempt timeout still fits, so
 * the total can never overrun the caller's budget.
 *
 * ⭐⭐ FIX ①b (2026-07-31) — THE RESCUE CLAMP. READ THIS BEFORE CHANGING ANYTHING
 * ---------------------------------------------------------------------------
 * Everything above shipped as PR #295 and was deployed as build `91bcac5`. A live
 * probe under real governor contention then measured what it actually did:
 * **0 of 9 contended requests rescued, and `isl_retry_scheduled` had never fired
 * once in the build's entire life** (`isl_retry_declined` returned 35 rows on the
 * identical query, so the zero was a real absence, not a broken search).
 * Evidence: `PHASE0-EVIDENCE-2026-07-28/probe-2202-retry-under-contention.md`.
 *
 * WHY. Staging's Render dashboard sets `ISL_TIMEOUT_MS = 130_000` (repo default
 * 60_000) and leaves `REQUEST_BUDGET_MS` unset (→ 70_000). /v2/run's base-call
 * clamp then takes its SECOND arm and hands this decision a per-attempt timeout
 * of `remaining − 1_000`, i.e. essentially the whole budget. Writing `T =
 * ISL_TIMEOUT_MS`, `R = REQUEST_BUDGET_MS`, `A = Retry-After`, `m = margin`, the
 * pre-①b gate `A + T + m <= R` fires only while `T <= R − A − m` = 64_000. Once
 * `T >= R − m` the clamp's second arm wins and the requirement collapses to
 * `A <= 0` — **no positive `Retry-After` can EVER fit, at any budget.** Staging
 * is deep in that regime: the retry was not rate-limited or unlucky, it was
 * arithmetically impossible on 100% of requests, with 6,409 green tests, 11/11
 * green CI and a purpose-built headroom guard that derived its constant from
 * `process.env` at TEST time and so measured the repo default, never the
 * dashboard (trap 18: a constant correct in every test and wrong by 70 s live).
 *
 * THE FIX. A retry may now run with a per-attempt timeout clamped DOWN to what
 * the budget can actually afford:
 *
 *     affordable = remaining − delay − margin
 *     rescue     = min(perAttemptTimeout, affordable)
 *     retry iff  rescue >= min(BASE_CALL_MIN_TIMEOUT_MS, perAttemptTimeout)
 *
 * ⚠ THIS IS THE THING #295 EXPLICITLY DECLINED, AND THE DECLINE WAS NOT WRONG —
 * IT WAS SCOPED. #295 refused to clamp downward because it "would truncate a
 * slow-but-successful call". That reasoning is correct for a FIRST attempt, whose
 * alternative is a call that might still succeed if left alone. It does NOT
 * transfer to a RESCUE attempt, whose alternative is not "a slower success" but a
 * typed failure that has already been decided: the first attempt has failed, and
 * without a retry the caller gets the 500. Truncating a rescue can only lose an
 * outcome we were never going to get. So the clamp is applied to RETRIES ONLY —
 * the first attempt's timeout is untouched, and #295's decline stands where its
 * reasoning holds.
 *
 * WHY A FLOOR, AND WHY IT IS A THRESHOLD RATHER THAN A `Math.max`. Below some
 * width a rescue attempt cannot complete anything and merely burns the remainder,
 * so we decline instead — `budget_exhausted` still bites, just at a tighter,
 * derived boundary. Flooring UP with `Math.max` would be the opposite of a
 * bound: it would START an attempt whose timeout outlives the caller's budget,
 * breaking the one invariant 2.202 must not break. And the floor is
 * `min(BASE_CALL_MIN_TIMEOUT_MS, perAttemptTimeout)`, never the constant alone,
 * so that a caller who chose a sub-second per-attempt timeout (flip probes,
 * wall-clock tests) is not newly refused a retry it used to get.
 *
 * ⭐ THE RESULTING RULE IS A STRICT RELAXATION, and that is pinned as a property
 * test: every decision the pre-①b rule GRANTED is still granted, with an
 * IDENTICAL, unclamped timeout (if `perAttempt <= affordable` then `rescue =
 * perAttempt`). ①b only ever converts a former `budget_exhausted` into a shorter
 * rescue attempt. Nothing that used to retry now declines, and nothing that used
 * to retry now runs shorter.
 *
 * DISCLOSED TRADE: a SLOW retryable failure now buys a short rescue attempt where
 * before it bought none, so a doomed call can spend the rest of its budget before
 * returning the typed failure. `safetyMarginMs` is still reserved and still
 * unspent, so the caller can always assemble its response — the invariant that
 * matters is preserved, the "slow failures return early" behaviour is not.
 *
 * BLAST RADIUS: when no budget is supplied the decision degenerates to EXACTLY
 * the previous behaviour — attempt cap + our own exponential backoff, and
 * `Retry-After` deliberately ignored. The rescue clamp lives entirely inside the
 * budgeted branch, so it too reaches ONLY the /v2/run base robustness call; flip
 * probes, thresholds and health are untouched.
 */

import { islRetryBackoffMs, BASE_CALL_MIN_TIMEOUT_MS } from '../../config/timeouts.js';

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
  /** `delayMs + attemptTimeoutMs` — what the next attempt could cost. */
  projectedCostMs: number;
  /**
   * ROADMAP 2.202 fix ①b — the per-attempt timeout the NEXT attempt must use.
   *
   * Equals the caller's `perAttemptTimeoutMs` on every path except a budgeted
   * rescue that had to be clamped down to fit. The client MUST honour this for
   * the retry it is about to start; ignoring it re-creates the pre-①b defect,
   * because the whole point is that the attempt is narrower than the caller's
   * configured timeout. On a decline it is the unclamped ask (no attempt runs).
   */
  attemptTimeoutMs: number;
  /** True when {@link attemptTimeoutMs} was clamped below the caller's timeout. */
  timeoutClamped: boolean;
  /**
   * `remaining − delay − margin` — the widest attempt the budget can afford at
   * this instant. Negative when the budget is already spent. `undefined` on the
   * no-budget path. Logged on a decline so "why did it not retry?" is answerable
   * from one row instead of a probe.
   */
  affordableTimeoutMs?: number;
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

  // Budget-derived figures, computed once so the decline path can report the
  // SAME numbers the grant path decided on (fix ①b: a decline row that cannot
  // say how wide an attempt the budget could afford is what forced the 31 Jul
  // probe in the first place).
  const safetyMarginMs = budget
    ? budget.safetyMarginMs ?? DEFAULT_RETRY_SAFETY_MARGIN_MS
    : undefined;
  const remainingAtDecisionMs = budget ? budget.remainingMs - elapsedMs : undefined;
  const affordableTimeoutMs =
    remainingAtDecisionMs !== undefined && safetyMarginMs !== undefined
      ? remainingAtDecisionMs - delayMs - safetyMarginMs
      : undefined;

  const no = (reason: ISLRetryReason): ISLRetryDecision => ({
    retry: false,
    delayMs: 0,
    reason,
    retryAfterHonoured: false,
    backoffMs,
    remainingMs: remainingAtDecisionMs,
    projectedCostMs,
    // No attempt runs, so report the unclamped ask — this keeps the decline
    // row's `projected_cost_ms` reading exactly as it did before ①b.
    attemptTimeoutMs: perAttemptTimeoutMs,
    timeoutClamped: false,
    affordableTimeoutMs,
  });

  if (!retryable) return no('not_retryable');
  if (attempt >= maxAttempts) return no('attempt_cap');

  // No budget supplied → EXACTLY the previous behaviour, and that means the
  // BACKOFF, not `Retry-After`.
  //
  // ⚠ This branch is load-bearing and was WRONG in the first cut of 2.202
  // (caught in adversarial review of PR #295). `delayMs` above is
  // `max(retryAfterMs, backoffMs)`, and returning it here honoured
  // `Retry-After` with NO BOUND on a path that has no budget to bound it —
  // `Retry-After: 3600` meant the client slept for an hour, in a sleep that
  // observes no AbortSignal. The exposure was live, not theoretical: /v1/run
  // calls validateCausal + analyseRobustness with maxRetries = 3 and no budget
  // against the very endpoint whose governor 429 carries `Retry-After: 5` — so
  // the first cut would have added ~7 s per call under exactly the contention
  // this change exists to fix.
  //
  // Only the budgeted path may honour `Retry-After`, because only there is the
  // resulting delay checked against something. Here we sleep our own bounded
  // backoff (≤ ISL_RETRY_BACKOFF_CAP_MS), which is what the pre-2.202 client
  // did — making "no budget = previous behaviour" literally true rather than
  // approximately true.
  if (!budget) {
    return {
      retry: true,
      delayMs: backoffMs,
      reason: 'attempts_remaining',
      retryAfterHonoured: false,
      backoffMs,
      remainingMs: undefined,
      projectedCostMs: backoffMs + perAttemptTimeoutMs,
      // ⚠ NO RESCUE CLAMP HERE, deliberately. Clamping needs a budget to clamp
      // against; with none there is nothing to derive a narrower timeout FROM,
      // and inventing one would be the magic constant this module exists without.
      attemptTimeoutMs: perAttemptTimeoutMs,
      timeoutClamped: false,
      affordableTimeoutMs: undefined,
    };
  }

  const remainingMs = remainingAtDecisionMs!;

  // ⭐ THE RESCUE CLAMP (fix ①b — see the module header for why #295's decline
  // does not transfer to a retry). The widest attempt the budget can still pay
  // for, after the delay we are about to sleep and the reserve we must not spend:
  const affordableMs = affordableTimeoutMs!;
  const rescueTimeoutMs = Math.min(perAttemptTimeoutMs, affordableMs);

  // Viability threshold, NOT a `Math.max` floor — flooring up would start an
  // attempt that outlives the caller. Bounded by the caller's own per-attempt
  // timeout so a sub-second caller (flip probes, wall-clock tests) is never
  // newly refused a retry the pre-①b rule would have granted.
  const minViableTimeoutMs = Math.max(1, Math.min(BASE_CALL_MIN_TIMEOUT_MS, perAttemptTimeoutMs));
  if (rescueTimeoutMs < minViableTimeoutMs) return no('budget_exhausted');

  return {
    retry: true,
    delayMs,
    reason: 'budget_available',
    retryAfterHonoured,
    backoffMs,
    remainingMs,
    // The HONEST projection: what the attempt we are actually about to start
    // will cost, not what an unclamped one would have.
    projectedCostMs: delayMs + rescueTimeoutMs,
    attemptTimeoutMs: rescueTimeoutMs,
    timeoutClamped: rescueTimeoutMs < perAttemptTimeoutMs,
    affordableTimeoutMs: affordableMs,
  };
}
