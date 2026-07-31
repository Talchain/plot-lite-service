/**
 * ROADMAP 2.202 — unit pins for the retry-budget decision and Retry-After parsing.
 *
 * THE DEFECT (diagnosis-run-analysis-500s.md §4): the ISL retry bound was a
 * TOTAL-ATTEMPT COUNT fixed before the first byte was sent, derived from
 * WORST-CASE timeouts. At the 70s budget with a 60s per-attempt timeout,
 * `worstCaseMs(2, 60_000) = 121_000 > 69_800` → 1 attempt → ZERO retries. ISL's
 * compute governor then rejected a 3rd concurrent analysis with a 429 that
 * returned in 133 ms, and PLoT emitted a typed-failure envelope with ~69.8 s of
 * budget unspent. `ISLHttpError.isRetryable()` already returned true for 429 —
 * the retry was correct and structurally unreachable.
 *
 * These are the fast, pure pins. The wall-clock proof that the real client
 * actually performs the retry lives in tests/plot-2202-isl-retry-budget.client.test.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  decideIslRetry,
  DEFAULT_RETRY_SAFETY_MARGIN_MS,
} from '../src/integrations/isl/retry-budget.js';
import { parseRetryAfterMs, ISLHttpError } from '../src/integrations/isl/errors.js';
import {
  islRetryBackoffMs,
  worstCaseMs,
  ISL_TIMEOUT_MS,
  ISL_RETRY_BACKOFF_CAP_MS,
  resolveRequestBudgetMs,
} from '../src/config/timeouts.js';

/**
 * The live production shape from the diagnosis — DERIVED from the real
 * constants, not restated as literals (trap 12: a hand-copied mirror drifts
 * silently, and drift always reads as green). These used to be `70_000` and
 * `60_000` written out by hand, which meant a one-line bump of ISL_TIMEOUT_MS
 * could disable the whole fix with the entire suite still green.
 */
const PROD_BUDGET_MS = resolveRequestBudgetMs(); // REQUEST_BUDGET_MS, 70s default
const PROD_PER_ATTEMPT_MS = ISL_TIMEOUT_MS; // 60s default
const OBSERVED_429_ELAPSED_MS = 133; // measured: PLoT's boundary.response downstream elapsed_ms
const ISL_RETRY_AFTER_MS = 5_000; // ISL governor RETRY_AFTER_SECONDS = 5

describe('decideIslRetry — the fast-429 case that was structurally unreachable', () => {
  it('RETRIES the observed 133ms 429 under the real production budget', () => {
    // The exact live numbers. This is the whole point of 2.202.
    const d = decideIslRetry({
      retryable: true,
      attempt: 1,
      maxAttempts: 3,
      elapsedMs: OBSERVED_429_ELAPSED_MS,
      perAttemptTimeoutMs: PROD_PER_ATTEMPT_MS,
      retryAfterMs: ISL_RETRY_AFTER_MS,
      budget: { remainingMs: PROD_BUDGET_MS },
    });

    expect(d.retry).toBe(true);
    expect(d.reason).toBe('budget_available');
    expect(d.delayMs).toBe(ISL_RETRY_AFTER_MS); // honoured, not our 1s backoff
    expect(d.retryAfterHonoured).toBe(true);
    // ~69.9s remained. The projection (5s wait + 60s attempt) fits with room.
    expect(d.remainingMs).toBe(PROD_BUDGET_MS - OBSERVED_429_ELAPSED_MS);
    expect(d.projectedCostMs).toBe(ISL_RETRY_AFTER_MS + PROD_PER_ATTEMPT_MS);
  });

  it('⭐ HEADROOM — the fix only works while a 5s wait + a full attempt still fits the budget', () => {
    // ⚠ CROSS-REPO COUPLING, and it is TIGHT. The fix depends on an arithmetic
    // relation between THREE independently-owned numbers:
    //   • ISL_RETRY_AFTER_MS   — owned by ISL (compute_governor RETRY_AFTER_SECONDS = 5)
    //   • ISL_TIMEOUT_MS       — owned by PLoT config (60s)
    //   • REQUEST_BUDGET_MS    — owned by PLoT config (70s), env-overridable
    // Live headroom at the defaults is only ~8.9s. A one-line bump of
    // ISL_TIMEOUT_MS to >=64s silently disables the retry — the decision would
    // return `budget_exhausted` for the exact 133ms 429 this change exists to
    // retry — and every other test here would stay GREEN, because they pin the
    // decision function rather than this relation. That is the trap-12 shape:
    // the failure reads as green.
    //
    // So pin the relation itself. If this goes RED, the fix is OFF in
    // production and the numbers must be re-derived together, not one at a time.
    const headroomMs =
      PROD_BUDGET_MS - OBSERVED_429_ELAPSED_MS
      - (ISL_RETRY_AFTER_MS + PROD_PER_ATTEMPT_MS + DEFAULT_RETRY_SAFETY_MARGIN_MS);
    expect(
      headroomMs,
      `2.202 is DISABLED at these constants: a ${ISL_RETRY_AFTER_MS}ms Retry-After plus a ` +
      `${PROD_PER_ATTEMPT_MS}ms attempt plus the ${DEFAULT_RETRY_SAFETY_MARGIN_MS}ms margin does not ` +
      `fit ${PROD_BUDGET_MS}ms of budget. Re-derive ISL_TIMEOUT_MS / REQUEST_BUDGET_MS together.`,
    ).toBeGreaterThan(0);

    // …and prove the relation is what actually drives the decision, so this is
    // not an assertion about arithmetic that nothing consults.
    expect(
      decideIslRetry({
        retryable: true, attempt: 1, maxAttempts: 3,
        elapsedMs: OBSERVED_429_ELAPSED_MS,
        perAttemptTimeoutMs: PROD_PER_ATTEMPT_MS,
        retryAfterMs: ISL_RETRY_AFTER_MS,
        budget: { remainingMs: PROD_BUDGET_MS },
      }).retry,
    ).toBe(true);
  });

  it('WITNESS for the old policy: the up-front worst-case count allowed only 1 attempt', () => {
    // Not a test of new code — it pins WHY the retry was unreachable, so the
    // regression that reintroduces up-front counting is legible here.
    expect(worstCaseMs(2, PROD_PER_ATTEMPT_MS)).toBeGreaterThan(PROD_BUDGET_MS);
    // …while the ACTUAL cost of the failure was three orders of magnitude less.
    expect(OBSERVED_429_ELAPSED_MS).toBeLessThan(PROD_BUDGET_MS / 100);
  });
});

describe('decideIslRetry — the budget bound (no infinite retry, no budget overrun)', () => {
  it('refuses when the next attempt does not fit the remaining budget', () => {
    const d = decideIslRetry({
      retryable: true,
      attempt: 1,
      maxAttempts: 3,
      elapsedMs: 60_000, // a SLOW failure that consumed the budget
      perAttemptTimeoutMs: PROD_PER_ATTEMPT_MS,
      budget: { remainingMs: PROD_BUDGET_MS },
    });
    expect(d.retry).toBe(false);
    expect(d.reason).toBe('budget_exhausted');
    expect(d.delayMs).toBe(0);
  });

  it('⭐ preserves the property the OLD up-front clamp existed to protect', () => {
    // A slow failure must never buy a retry that outlives the caller. Sweep the
    // whole elapsed range: once the projection stops fitting, it never restarts.
    let firstRefusalAt: number | undefined;
    for (let elapsedMs = 0; elapsedMs <= PROD_BUDGET_MS; elapsedMs += 500) {
      const d = decideIslRetry({
        retryable: true,
        attempt: 1,
        maxAttempts: 3,
        elapsedMs,
        perAttemptTimeoutMs: PROD_PER_ATTEMPT_MS,
        budget: { remainingMs: PROD_BUDGET_MS },
      });
      if (!d.retry) {
        firstRefusalAt ??= elapsedMs;
        expect(d.reason).toBe('budget_exhausted');
      } else {
        // Monotonic: no retry is ever granted after the first refusal.
        expect(firstRefusalAt).toBeUndefined();
        // And a granted retry ALWAYS leaves room for the full attempt.
        expect(d.projectedCostMs + DEFAULT_RETRY_SAFETY_MARGIN_MS).toBeLessThanOrEqual(d.remainingMs!);
      }
    }
    expect(firstRefusalAt, 'the budget bound must bite somewhere in the sweep').toBeDefined();
  });

  it('an attempt is only ever granted when its FULL per-attempt timeout still fits', () => {
    // The invariant that makes overrunning the caller impossible by construction.
    for (const elapsedMs of [0, 1_000, 5_000, 8_000, 8_999, 9_000]) {
      const d = decideIslRetry({
        retryable: true,
        attempt: 1,
        maxAttempts: 5,
        elapsedMs,
        perAttemptTimeoutMs: 5_000,
        budget: { remainingMs: 12_000 },
      });
      if (d.retry) {
        expect(elapsedMs + d.delayMs + 5_000).toBeLessThanOrEqual(12_000);
      }
    }
  });

  it('still honours the configured attempt cap even with unlimited budget', () => {
    const d = decideIslRetry({
      retryable: true,
      attempt: 3,
      maxAttempts: 3,
      elapsedMs: 0,
      perAttemptTimeoutMs: 1_000,
      budget: { remainingMs: Number.MAX_SAFE_INTEGER },
    });
    expect(d.retry).toBe(false);
    expect(d.reason).toBe('attempt_cap');
  });

  it('never retries a non-retryable failure, however much budget remains', () => {
    const d = decideIslRetry({
      retryable: false,
      attempt: 1,
      maxAttempts: 3,
      elapsedMs: 0,
      perAttemptTimeoutMs: 1_000,
      budget: { remainingMs: PROD_BUDGET_MS },
    });
    expect(d.retry).toBe(false);
    expect(d.reason).toBe('not_retryable');
  });

  it('an absurd Retry-After self-limits — no arbitrary cap is invented', () => {
    // Retry-After: 3600 → the projection cannot fit, so the call terminates with
    // the typed failure instead of sleeping for an hour.
    const d = decideIslRetry({
      retryable: true,
      attempt: 1,
      maxAttempts: 3,
      elapsedMs: 133,
      perAttemptTimeoutMs: PROD_PER_ATTEMPT_MS,
      retryAfterMs: 3_600_000,
      budget: { remainingMs: PROD_BUDGET_MS },
    });
    expect(d.retry).toBe(false);
    expect(d.reason).toBe('budget_exhausted');
  });
});

describe('decideIslRetry — blast radius: no budget supplied = previous behaviour exactly', () => {
  it('retries on attempts-remaining with the plain exponential backoff (flip probes / thresholds)', () => {
    const d = decideIslRetry({
      retryable: true,
      attempt: 1,
      maxAttempts: 3,
      elapsedMs: 999_999, // irrelevant without a budget — exactly as before
      perAttemptTimeoutMs: PROD_PER_ATTEMPT_MS,
      budget: undefined,
    });
    expect(d.retry).toBe(true);
    expect(d.reason).toBe('attempts_remaining');
    expect(d.delayMs).toBe(islRetryBackoffMs(1));
    expect(d.remainingMs).toBeUndefined();
  });

  it('⭐ IGNORES Retry-After entirely — an unbounded hint must not reach an unbounded path', () => {
    // THE HIGH FROM THE PR #295 ADVERSARIAL REVIEW. The first cut computed
    // delayMs = max(retryAfterMs, backoffMs) BEFORE the !budget branch and
    // returned it there, so `Retry-After: 3600` on a path with no budget to
    // bound it meant a ONE-HOUR uninterruptible sleep.
    //
    // Live exposure, not theoretical: /v1/run calls validateCausal +
    // analyseRobustness with maxRetries = 3 and NO budget, against the very
    // endpoint whose governor 429 carries `Retry-After: 5`. The first cut would
    // have added ~7 s per call under exactly the contention 2.202 fixes.
    const absurd = decideIslRetry({
      retryable: true,
      attempt: 1,
      maxAttempts: 3,
      elapsedMs: 0,
      perAttemptTimeoutMs: 60_000,
      retryAfterMs: 3_600_000, // one hour
      budget: undefined,
    });
    expect(absurd.retry).toBe(true);
    expect(absurd.delayMs).toBe(islRetryBackoffMs(1)); // 1s, NOT 3_600_000
    expect(absurd.retryAfterHonoured).toBe(false);
    expect(absurd.projectedCostMs).toBe(islRetryBackoffMs(1) + 60_000);

    // The realistic case is the one that actually bit: ISL's own 5s hint.
    const governor = decideIslRetry({
      retryable: true, attempt: 1, maxAttempts: 3, elapsedMs: 0,
      perAttemptTimeoutMs: 60_000, retryAfterMs: 5_000, budget: undefined,
    });
    expect(governor.delayMs).toBe(1_000); // our backoff, not the 5s hint
    expect(governor.retryAfterHonoured).toBe(false);
  });

  it('the no-budget delay is bounded by our backoff CAP for every attempt', () => {
    // The structural guarantee that replaces "trust the server's number": with
    // no budget, the delay can never exceed ISL_RETRY_BACKOFF_CAP_MS, whatever
    // ISL asks for.
    for (const attempt of [1, 2, 3, 4, 5]) {
      const d = decideIslRetry({
        retryable: true, attempt, maxAttempts: 99, elapsedMs: 0,
        perAttemptTimeoutMs: 1_000, retryAfterMs: 86_400_000, budget: undefined,
      });
      expect(d.delayMs).toBe(islRetryBackoffMs(attempt));
      expect(d.delayMs).toBeLessThanOrEqual(ISL_RETRY_BACKOFF_CAP_MS);
    }
  });

  it('and still stops at the cap — maxRetries = 1 means one attempt (F3/F9 optional phases)', () => {
    const d = decideIslRetry({
      retryable: true,
      attempt: 1,
      maxAttempts: 1,
      elapsedMs: 0,
      perAttemptTimeoutMs: 250,
      budget: undefined,
    });
    expect(d.retry).toBe(false);
    expect(d.reason).toBe('attempt_cap');
  });
});

describe('Retry-After: a MINIMUM wait — it can lengthen the delay, never shorten it', () => {
  it('uses Retry-After when it exceeds our backoff', () => {
    const d = decideIslRetry({
      retryable: true, attempt: 1, maxAttempts: 3, elapsedMs: 0,
      perAttemptTimeoutMs: 1_000, retryAfterMs: 5_000,
      budget: { remainingMs: 60_000 },
    });
    expect(d.delayMs).toBe(5_000);
    expect(d.retryAfterHonoured).toBe(true);
  });

  it('keeps our backoff when Retry-After is SHORTER (never retry sooner than our own policy)', () => {
    const d = decideIslRetry({
      retryable: true, attempt: 2, maxAttempts: 3, elapsedMs: 0,
      perAttemptTimeoutMs: 1_000, retryAfterMs: 100,
      budget: { remainingMs: 60_000 },
    });
    expect(islRetryBackoffMs(2)).toBe(2_000);
    expect(d.delayMs).toBe(2_000);
    expect(d.retryAfterHonoured).toBe(false);
  });

  it('falls back to the backoff series when ISL sent no usable hint', () => {
    for (const attempt of [1, 2, 3]) {
      const d = decideIslRetry({
        retryable: true, attempt, maxAttempts: 9, elapsedMs: 0,
        perAttemptTimeoutMs: 100, retryAfterMs: undefined,
        budget: { remainingMs: 600_000 },
      });
      expect(d.delayMs).toBe(islRetryBackoffMs(attempt));
      expect(d.retryAfterHonoured).toBe(false);
    }
  });
});

describe('parseRetryAfterMs — RFC 7231 both forms', () => {
  it('delta-seconds', () => {
    expect(parseRetryAfterMs('5')).toBe(5_000); // ISL governor RETRY_AFTER_SECONDS
    expect(parseRetryAfterMs('0')).toBe(0);
    expect(parseRetryAfterMs('  5  ')).toBe(5_000);
  });

  it('HTTP-date, measured against the supplied now', () => {
    const now = Date.parse('2026-07-31T09:00:00Z');
    expect(parseRetryAfterMs('Fri, 31 Jul 2026 09:00:07 GMT', now)).toBe(7_000);
  });

  it('a PAST HTTP-date clamps to 0, never negative', () => {
    const now = Date.parse('2026-07-31T09:00:00Z');
    expect(parseRetryAfterMs('Fri, 31 Jul 2026 08:59:00 GMT', now)).toBe(0);
  });

  it('absent / blank / unparseable → undefined, so the caller falls back to its own backoff', () => {
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
    expect(parseRetryAfterMs('')).toBeUndefined();
    expect(parseRetryAfterMs('   ')).toBeUndefined();
    expect(parseRetryAfterMs('soon')).toBeUndefined();
  });

  it('⚠ a bare signed/decimal number is rejected — Date.parse would read it as a YEAR', () => {
    // `Date.parse('-5')` SUCCEEDS (year -5), so without an explicit reject a
    // malformed header becomes a multi-millennium delay rather than a fallback
    // to our own backoff. Guards the exact hole found writing this pin.
    expect(parseRetryAfterMs('-5')).toBeUndefined();
    expect(parseRetryAfterMs('+5')).toBeUndefined();
    expect(parseRetryAfterMs('1.5')).toBeUndefined();
  });
});

describe('ISLHttpError carries Retry-After (it was dropped entirely before 2.202)', () => {
  it('exposes retryAfterMs and still classifies 429 as retryable', () => {
    const err = new ISLHttpError(429, '{"detail":"caller_concurrency_exceeded"}',
      '/api/v1/robustness/analyze/v2', undefined, 5_000);
    expect(err.retryAfterMs).toBe(5_000);
    expect(err.isRetryable()).toBe(true);
  });

  it('is undefined when ISL sent no hint (unchanged for every other error path)', () => {
    const err = new ISLHttpError(500, 'boom', '/api/v1/robustness/analyze/v2');
    expect(err.retryAfterMs).toBeUndefined();
    expect(err.isRetryable()).toBe(true);
  });
});
