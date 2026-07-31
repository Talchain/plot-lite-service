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

  it('⭐ HEADROOM — a FULL-WIDTH retry only fits while a 5s wait + a full attempt does', () => {
    // ⚠⚠ RE-POINTED 2026-07-31 BY FIX ①b. THIS GUARD'S CLAIM WENT FALSE, AND A
    // FALSE ALARM IS WORSE THAN NO ALARM (trap 14: an honest label overwritten
    // by a misleading one teaches every lane to stop looking).
    //
    // It used to say "2.202 is DISABLED at these constants" and it was RIGHT:
    // pre-①b, once `ISL_TIMEOUT_MS >= REQUEST_BUDGET_MS − Retry-After − margin`
    // the retry declined outright. That is precisely what staging did at
    // `ISL_TIMEOUT_MS = 130_000` — and this guard, deriving from `process.env` at
    // TEST time where the var is unset, measured the repo default 60_000 and
    // reported ~8.9 s of comfortable headroom while the deployment sat 66 s the
    // wrong side of the line (platform trap 18).
    //
    // Post-①b that relation no longer decides IF the retry happens — only
    // whether it runs at FULL width or CLAMPED. So the message is corrected and
    // an arm is added below proving the fix survives the violation. The
    // regime-level pins live in tests/plot-2202b-rescue-clamp.decision.test.ts,
    // which fixes the DEPLOYED constants as a dated measurement rather than
    // re-deriving them from an environment that does not have them.
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
      `At these constants a ${ISL_RETRY_AFTER_MS}ms Retry-After plus a FULL ` +
      `${PROD_PER_ATTEMPT_MS}ms attempt plus the ${DEFAULT_RETRY_SAFETY_MARGIN_MS}ms margin does not ` +
      `fit ${PROD_BUDGET_MS}ms of budget, so the retry runs CLAMPED rather than at full width. ` +
      `Since 2.202 fix ①b that is degraded, not disabled — but re-derive ` +
      `ISL_TIMEOUT_MS / REQUEST_BUDGET_MS together before accepting it.`,
    ).toBeGreaterThan(0);

    // …and prove the relation is what actually drives the decision, so this is
    // not an assertion about arithmetic that nothing consults.
    const d = decideIslRetry({
      retryable: true, attempt: 1, maxAttempts: 3,
      elapsedMs: OBSERVED_429_ELAPSED_MS,
      perAttemptTimeoutMs: PROD_PER_ATTEMPT_MS,
      retryAfterMs: ISL_RETRY_AFTER_MS,
      budget: { remainingMs: PROD_BUDGET_MS },
    });
    expect(d.retry).toBe(true);
    // With headroom, the attempt runs at FULL configured width — that is what
    // the headroom buys, and the only thing this relation now controls.
    expect(d.timeoutClamped).toBe(false);
    expect(d.attemptTimeoutMs).toBe(PROD_PER_ATTEMPT_MS);
  });

  it('⭐ ①b — and when that headroom is GONE the retry is CLAMPED, not cancelled', () => {
    // The arm that stops the guard above from ever again reading as "the fix is
    // off". Violate the relation deliberately — a per-attempt timeout larger
    // than the whole budget, i.e. the staging regime — and the decision must
    // still retry, narrower. If this ever goes RED, ①b has been reverted and the
    // 0-of-9 live outcome is back.
    const overBudgetPerAttemptMs = PROD_BUDGET_MS + 60_000; // staging: 130s vs 70s
    const d = decideIslRetry({
      retryable: true, attempt: 1, maxAttempts: 3,
      elapsedMs: OBSERVED_429_ELAPSED_MS,
      perAttemptTimeoutMs: overBudgetPerAttemptMs,
      retryAfterMs: ISL_RETRY_AFTER_MS,
      budget: { remainingMs: PROD_BUDGET_MS },
    });
    expect(d.retry).toBe(true);
    expect(d.reason).toBe('budget_available');
    expect(d.timeoutClamped).toBe(true);
    expect(d.attemptTimeoutMs).toBeLessThan(overBudgetPerAttemptMs);
    expect(d.delayMs + d.attemptTimeoutMs + DEFAULT_RETRY_SAFETY_MARGIN_MS)
      .toBeLessThanOrEqual(d.remainingMs!);
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
  it('refuses when not even a CLAMPED attempt fits the remaining budget', () => {
    // ⚠⚠ RE-POINTED 2026-07-31 BY FIX ①b — DISCLOSED, NOT SILENTLY REWRITTEN.
    //
    // As written this arm used `elapsedMs: 60_000` against the 70s budget and
    // asserted `budget_exhausted`, on the reasoning that "a SLOW failure that
    // consumed the budget" must get no retry. Fix ①b deliberately changes that:
    // with ~10s left, a rescue attempt clamped to ~8s DOES fit, and a rescue
    // attempt's alternative is not a slower success but the typed failure the
    // caller is already getting. So at 60_000 elapsed the decision now —
    // correctly — RETRIES, and this arm would have gone RED against its own fix
    // while appearing to defend it. That is exactly the mutant §4.5 of
    // fix-plot-retry-budget-2202.md flagged, one lane later.
    //
    // The INVARIANT it protected is unchanged and still pinned, one arm below
    // and across the ①b sweeps: no attempt is ever started whose timeout
    // outlives the caller's budget. What moved is the boundary, from "the FULL
    // per-attempt timeout must fit" to "a floored, affordable one must". So this
    // arm is re-pointed to a budget that is GENUINELY spent — nothing fits, not
    // even the floor — which is the claim the title was really making.
    const d = decideIslRetry({
      retryable: true,
      attempt: 1,
      maxAttempts: 3,
      elapsedMs: 68_500, // 1.5s left: cannot pay a 1s backoff + 1s margin at all
      perAttemptTimeoutMs: PROD_PER_ATTEMPT_MS,
      budget: { remainingMs: PROD_BUDGET_MS },
    });
    expect(d.retry).toBe(false);
    expect(d.reason).toBe('budget_exhausted');
    expect(d.delayMs).toBe(0);
    expect(d.affordableTimeoutMs!).toBeLessThan(0);
  });

  it('⭐ ①b — the same SLOW failure now buys a CLAMPED rescue (the behaviour change, pinned)', () => {
    // The arm above used to live at this input. Pinning the new outcome here
    // means the change is asserted in both directions rather than quietly
    // dropped: 10s remain, so a ~8s rescue attempt is started, and it still
    // finishes inside the budget with the margin reserved.
    const d = decideIslRetry({
      retryable: true,
      attempt: 1,
      maxAttempts: 3,
      elapsedMs: 60_000,
      perAttemptTimeoutMs: PROD_PER_ATTEMPT_MS,
      budget: { remainingMs: PROD_BUDGET_MS },
    });
    expect(d.retry).toBe(true);
    expect(d.reason).toBe('budget_available');
    expect(d.timeoutClamped).toBe(true);
    expect(d.attemptTimeoutMs).toBeLessThan(PROD_PER_ATTEMPT_MS);
    expect(d.delayMs + d.attemptTimeoutMs + DEFAULT_RETRY_SAFETY_MARGIN_MS)
      .toBeLessThanOrEqual(d.remainingMs!);
  });

  it('⭐ preserves the property the OLD up-front clamp existed to protect', () => {
    // A retry must never outlive the caller. Sweep the whole elapsed range: once
    // the projection stops fitting, it never restarts.
    //
    // ⚠ NOTE AFTER FIX ①b (2026-07-31): what is swept is now the CLAMPED
    // projection, so the refusal boundary sits later than it did — a slow
    // failure buys a shorter rescue rather than nothing. Both assertions below
    // are unchanged and both still hold, because the bound they express
    // ("projected + margin never exceeds remaining") is about the attempt that
    // will actually run, not about the caller's configured width.
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

  it('an attempt is only ever granted when the timeout IT WILL RUN WITH still fits', () => {
    // ⚠⚠ RE-POINTED 2026-07-31 BY FIX ①b — DISCLOSED, NOT SILENTLY REWRITTEN.
    //
    // As written, this asserted `elapsedMs + delayMs + 5_000 <= 12_000` — i.e. it
    // priced the granted attempt at the CALLER'S CONFIGURED timeout. That is the
    // pre-①b mechanism, not the invariant: at elapsedMs 8_000 the decision now
    // grants a rescue clamped to ~2s, and the old assertion would read
    // `8000 + 1000 + 5000 <= 12000` → RED, blocking its own fix.
    //
    // The invariant is, and always was, that no attempt is STARTED whose timeout
    // outlives the caller's budget. It is now checked against
    // `d.attemptTimeoutMs` — the width the attempt will actually run with, which
    // the client is required to honour (pinned on the real socket in
    // tests/plot-2202b-rescue-clamp.client.test.ts). This is strictly stronger
    // than the old form: it fails if the decision ever hands back a timeout the
    // budget cannot pay for, including an unclamped one.
    let granted = 0;
    let clamped = 0;
    for (const elapsedMs of [0, 1_000, 5_000, 8_000, 8_999, 9_000]) {
      const d = decideIslRetry({
        retryable: true,
        attempt: 1,
        maxAttempts: 5,
        elapsedMs,
        perAttemptTimeoutMs: 5_000,
        budget: { remainingMs: 12_000 },
      });
      if (!d.retry) continue;
      granted++;
      if (d.timeoutClamped) clamped++;
      expect(d.attemptTimeoutMs).toBeLessThanOrEqual(5_000); // never widened
      expect(elapsedMs + d.delayMs + d.attemptTimeoutMs).toBeLessThanOrEqual(12_000);
      expect(d.delayMs + d.attemptTimeoutMs + DEFAULT_RETRY_SAFETY_MARGIN_MS)
        .toBeLessThanOrEqual(d.remainingMs!);
    }
    // Both halves must be exercised or the loop proves less than it looks
    // (trap 13): an unclamped grant AND a clamped one.
    expect(granted).toBeGreaterThan(0);
    expect(clamped, 'the sweep must reach the clamped band').toBeGreaterThan(0);
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
