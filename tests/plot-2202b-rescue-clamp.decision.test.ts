/**
 * ⭐⭐ ROADMAP 2.202 fix ①b — THE RESCUE CLAMP, pinned at the DEPLOYED STAGING
 * SHAPE that made fix ① dead by construction.
 *
 * THE DEFECT THIS FILE EXISTS FOR
 * ------------------------------
 * Fix ① (PR #295) shipped with 6,409 green tests, 11/11 green CI, three biting
 * mutants and a purpose-built headroom guard — and then **never executed a single
 * retry in production**. A live 3-way contention probe against build `91bcac5`
 * measured **0 of 9 contended requests rescued** and **zero `isl_retry_scheduled`
 * rows in the build's entire life** (`isl_retry_declined` returned 35 rows on the
 * identical query, so the zero was a real absence — trap 13 satisfied).
 *
 *   PROBE OF RECORD: PHASE0-EVIDENCE-2026-07-28/probe-2202-retry-under-contention.md
 *
 * The cause was not the retry logic. Staging's Render dashboard sets
 * `ISL_TIMEOUT_MS = 130_000` (repo default 60_000) and omits `REQUEST_BUDGET_MS`
 * (→ 70_000). /v2/run's base-call clamp then takes its second arm and hands the
 * retry decision a per-attempt timeout of `remaining − 1_000`, so the pre-①b gate
 * `Retry-After + perAttempt + margin <= remaining` reduces to `Retry-After <= 0`.
 * No positive `Retry-After` can ever fit. 100% of requests, arithmetically.
 *
 * ⚠⚠ WHY THIS FILE PINS 130_000 AS A LITERAL AND DOES **NOT** RE-DERIVE IT FROM
 * `process.env` — READ BEFORE "FIXING" IT.
 * Fix ①'s guard (amendment B1) did exactly that: it derived its constants from
 * `ISL_TIMEOUT_MS` / `resolveRequestBudgetMs()` at TEST time, where those are
 * unset, so it measured the repo default 60_000 and reported a comfortable ~8.9 s
 * of headroom while the deployment ran 130_000. Mutant B1 proved the guard COULD
 * fire; it never proved the guard was reading the DEPLOYED value. Deriving from
 * the repo is still a mirror read when the source of truth is the Render
 * dashboard (platform trap 18), and a control pinned to "whatever is current"
 * decays into a tautology (trap 12b).
 *
 * So the numbers below are a **dated historical measurement**, deliberately
 * separate from anything that tracks live:
 *   • `ISL_TIMEOUT_MS = 130000` — read 2026-07-31 from
 *     `GET /v1/services/srv-d4sl44s9c44c73ep4ak0/env-vars` (Render API, 49 keys),
 *     corroborated on the wire by `base_isl_call_budget_clamped`
 *     `{"isl_timeout_ms":130000,"remaining_budget_ms":69995}`.
 *   • `REQUEST_BUDGET_MS` — ABSENT from all 49 keys → the repo default applies.
 * If staging's posture changes, this file keeps testing the regime it names; the
 * fix must survive that regime whether or not the deployment is still in it.
 *
 * The wall-clock proof that the real client RUNS the clamped attempt is in
 * tests/plot-2202b-rescue-clamp.client.test.ts; the route-level proof at the
 * staging shape is tests/plot-2202b-staging-shape-retry.route.test.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  decideIslRetry,
  DEFAULT_RETRY_SAFETY_MARGIN_MS,
} from '../src/integrations/isl/retry-budget.js';
import {
  islRetryBackoffMs,
  BASE_CALL_MIN_TIMEOUT_MS,
} from '../src/config/timeouts.js';

// ── The deployed staging regime, as MEASURED 2026-07-31 (see header) ──────────
/** Render dashboard value. NOT read from process.env, on purpose. */
const STAGING_ISL_TIMEOUT_MS = 130_000;
/**
 * ABSENT from all 49 deployed keys → the repo default is what staging runs.
 * Written as a literal, NOT `resolveRequestBudgetMs()`: this fixture must keep
 * describing the regime it was measured in even if the repo default moves or a
 * sibling test leaks the env var. That is the whole lesson of amendment B1.
 */
const STAGING_REQUEST_BUDGET_MS = 70_000;
/** /v2/run's own base-call reserve (`baseCallSafetyMarginMs`). */
const BASE_CALL_SAFETY_MARGIN_MS = 1_000;
/** `remaining_budget_ms` on the live `base_isl_call_budget_clamped` row. */
const STAGING_REMAINING_AT_CALL_MS = 69_995;
/** Probe-measured fast-reject latency band: 349–891 ms. The brief's ~350 ms. */
const STAGING_429_ELAPSED_MS = 350;
/** ISL compute_governor RETRY_AFTER_SECONDS = 5. */
const ISL_RETRY_AFTER_MS = 5_000;

/**
 * The per-attempt timeout /v2/run hands the client at the staging shape — the
 * SAME expression as `run.ts`'s clamp, evaluated at the deployed constants.
 * With `ISL_TIMEOUT_MS` (130 s) far above the budget, the second arm wins and the
 * per-attempt timeout becomes essentially the whole budget. That is the trap.
 */
const STAGING_PER_ATTEMPT_MS = Math.min(
  STAGING_ISL_TIMEOUT_MS,
  Math.max(
    BASE_CALL_MIN_TIMEOUT_MS,
    Math.floor(STAGING_REMAINING_AT_CALL_MS - BASE_CALL_SAFETY_MARGIN_MS),
  ),
);

/** The pre-①b gate, written out so the counterfactual is explicit, not implied. */
function preFixWouldRetry(
  delayMs: number,
  perAttemptTimeoutMs: number,
  remainingMs: number,
  marginMs = DEFAULT_RETRY_SAFETY_MARGIN_MS,
): boolean {
  return delayMs + perAttemptTimeoutMs + marginMs <= remainingMs;
}

describe('⭐ 2.202 ①b — the STAGING shape: the retry that could never fire, now fires', () => {
  it('⭐ RED-FIRST — ISL_TIMEOUT_MS=130000 / REQUEST_BUDGET_MS unset: a 350ms 429 with Retry-After: 5 IS rescued', () => {
    const d = decideIslRetry({
      retryable: true,
      attempt: 1,
      maxAttempts: 3,
      elapsedMs: STAGING_429_ELAPSED_MS,
      perAttemptTimeoutMs: STAGING_PER_ATTEMPT_MS,
      retryAfterMs: ISL_RETRY_AFTER_MS,
      budget: { remainingMs: STAGING_REMAINING_AT_CALL_MS },
    });

    // The whole point of ①b. PRE-FIX this returned `budget_exhausted`, exactly as
    // the live telemetry recorded on every single contended request.
    expect(d.retry).toBe(true);
    expect(d.reason).toBe('budget_available');

    // The mechanism: the attempt is NARROWER than the caller's configured
    // timeout, which is what makes it fit at all.
    expect(d.timeoutClamped).toBe(true);
    expect(d.attemptTimeoutMs).toBeLessThan(STAGING_PER_ATTEMPT_MS);
    expect(d.attemptTimeoutMs).toBeGreaterThanOrEqual(BASE_CALL_MIN_TIMEOUT_MS);

    // ISL's own hint is still honoured, and still bounded by the budget.
    expect(d.delayMs).toBe(ISL_RETRY_AFTER_MS);
    expect(d.retryAfterHonoured).toBe(true);

    // The invariant that must NEVER break: the attempt we are about to start
    // finishes inside the caller's budget with the reserve untouched.
    expect(d.delayMs + d.attemptTimeoutMs + DEFAULT_RETRY_SAFETY_MARGIN_MS)
      .toBeLessThanOrEqual(d.remainingMs!);
  });

  it('…and the PRE-①b rule declined that exact case — the counterfactual, stated not implied', () => {
    const remainingMs = STAGING_REMAINING_AT_CALL_MS - STAGING_429_ELAPSED_MS;
    // 5_000 + 68_995 + 1_000 = 74_995 > 69_645. This is the live
    // `isl_retry_declined` row from the probe, reproduced as arithmetic:
    //   {"reason":"budget_exhausted","retry_after_ms":5000,
    //    "remaining_budget_ms":69874,"projected_cost_ms":73974}
    expect(preFixWouldRetry(ISL_RETRY_AFTER_MS, STAGING_PER_ATTEMPT_MS, remainingMs)).toBe(false);
  });

  it('⭐ THE REGIME, not just the point: once ISL_TIMEOUT_MS >= budget − margin, NO positive Retry-After fitted', () => {
    // The general statement from the probe: the pre-①b gate fires iff
    // `T <= R − A − m`. Once `T >= R − m` the base-call clamp's second arm takes
    // over and the requirement collapses to `A <= 0`. Staging (130 s vs a 64 s
    // ceiling) is deep in that regime — so this is not a near-miss that a small
    // constant tweak would have fixed.
    expect(STAGING_ISL_TIMEOUT_MS).toBeGreaterThan(
      STAGING_REQUEST_BUDGET_MS - ISL_RETRY_AFTER_MS - DEFAULT_RETRY_SAFETY_MARGIN_MS,
    );
    for (const retryAfterMs of [1, 100, 1_000, 5_000, 30_000]) {
      const remainingMs = STAGING_REMAINING_AT_CALL_MS - STAGING_429_ELAPSED_MS;
      const delayMs = Math.max(retryAfterMs, islRetryBackoffMs(1));
      expect(
        preFixWouldRetry(delayMs, STAGING_PER_ATTEMPT_MS, remainingMs),
        `pre-①b should have declined at Retry-After ${retryAfterMs}ms`,
      ).toBe(false);

      // …and ①b rescues every one of them.
      const d = decideIslRetry({
        retryable: true, attempt: 1, maxAttempts: 3,
        elapsedMs: STAGING_429_ELAPSED_MS,
        perAttemptTimeoutMs: STAGING_PER_ATTEMPT_MS,
        retryAfterMs,
        budget: { remainingMs: STAGING_REMAINING_AT_CALL_MS },
      });
      expect(d.retry, `①b should rescue at Retry-After ${retryAfterMs}ms`).toBe(true);
      expect(d.timeoutClamped).toBe(true);
    }
  });
});

describe('2.202 ①b — the clamp is a STRICT RELAXATION (nothing that retried before now declines)', () => {
  it('⭐ every decision the pre-①b rule granted is still granted, with an IDENTICAL timeout', () => {
    // The property that bounds the blast radius. If it ever fails, ①b has
    // REMOVED a retry rather than added one, and the floor is the likely culprit
    // (it must be min(BASE_CALL_MIN_TIMEOUT_MS, perAttempt), never the constant
    // alone — a sub-second caller must not be newly refused).
    let grantedByBoth = 0;
    let newlyGranted = 0;
    for (const perAttemptTimeoutMs of [200, 400, 1_000, 5_000, 60_000, 68_995]) {
      for (const budgetMs of [1_200, 3_000, 12_000, 70_000]) {
        for (const elapsedMs of [0, 133, 350, 1_000, 5_000, 30_000, 69_000]) {
          for (const retryAfterMs of [undefined, 0, 5_000]) {
            const input = {
              retryable: true, attempt: 1, maxAttempts: 3,
              elapsedMs, perAttemptTimeoutMs, retryAfterMs,
              budget: { remainingMs: budgetMs },
            };
            const d = decideIslRetry(input);
            const delayMs = Math.max(retryAfterMs ?? 0, islRetryBackoffMs(1));
            const remainingMs = budgetMs - elapsedMs;
            if (preFixWouldRetry(delayMs, perAttemptTimeoutMs, remainingMs)) {
              grantedByBoth++;
              expect(d.retry, `pre-①b granted but ①b declined: ${JSON.stringify(input)}`).toBe(true);
              // Unclamped: the pre-①b rule only granted when the FULL timeout fit,
              // and where it fit, ①b must not narrow it.
              expect(d.attemptTimeoutMs).toBe(perAttemptTimeoutMs);
              expect(d.timeoutClamped).toBe(false);
            } else if (d.retry) {
              newlyGranted++;
            }
          }
        }
      }
    }
    // Both halves must be non-empty or the sweep proves nothing (trap 13).
    expect(grantedByBoth, 'the sweep must contain cases the OLD rule granted').toBeGreaterThan(0);
    expect(newlyGranted, 'the sweep must contain cases ①b newly rescues').toBeGreaterThan(0);
  });

  it('a granted rescue NEVER outlives the budget, across the same sweep', () => {
    let clamped = 0;
    for (const perAttemptTimeoutMs of [400, 5_000, 68_995]) {
      for (const budgetMs of [3_000, 12_000, 70_000]) {
        for (let elapsedMs = 0; elapsedMs <= budgetMs; elapsedMs += 250) {
          const d = decideIslRetry({
            retryable: true, attempt: 1, maxAttempts: 3,
            elapsedMs, perAttemptTimeoutMs, retryAfterMs: undefined,
            budget: { remainingMs: budgetMs },
          });
          if (!d.retry) continue;
          if (d.timeoutClamped) clamped++;
          expect(d.delayMs + d.attemptTimeoutMs + DEFAULT_RETRY_SAFETY_MARGIN_MS)
            .toBeLessThanOrEqual(d.remainingMs!);
          expect(d.projectedCostMs).toBe(d.delayMs + d.attemptTimeoutMs);
        }
      }
    }
    expect(clamped, 'the sweep must actually exercise the clamp').toBeGreaterThan(0);
  });
});

describe('2.202 ①b — the viability floor: a genuinely-exhausted budget still declines', () => {
  it('⭐ declines when not even a floored rescue attempt fits — no infinite retry', () => {
    // remaining 1_800 − 1_000 backoff − 1_000 margin = −200 affordable.
    const d = decideIslRetry({
      retryable: true, attempt: 1, maxAttempts: 3,
      elapsedMs: 68_200,
      perAttemptTimeoutMs: 60_000,
      budget: { remainingMs: 70_000 },
    });
    expect(d.retry).toBe(false);
    expect(d.reason).toBe('budget_exhausted');
    expect(d.delayMs).toBe(0);
    expect(d.affordableTimeoutMs!).toBeLessThan(BASE_CALL_MIN_TIMEOUT_MS);
  });

  it('⭐ the floor BITES in the band where an attempt would fit but be uselessly short', () => {
    // Sweep the boundary: affordable crosses BASE_CALL_MIN_TIMEOUT_MS somewhere,
    // and the decision must flip there and stay flipped.
    const perAttemptTimeoutMs = 60_000;
    const budgetMs = 70_000;
    const delayMs = islRetryBackoffMs(1);
    let lastRetry = true;
    let flips = 0;
    for (let elapsedMs = 0; elapsedMs <= budgetMs; elapsedMs += 100) {
      const d = decideIslRetry({
        retryable: true, attempt: 1, maxAttempts: 3,
        elapsedMs, perAttemptTimeoutMs, budget: { remainingMs: budgetMs },
      });
      const affordable = budgetMs - elapsedMs - delayMs - DEFAULT_RETRY_SAFETY_MARGIN_MS;
      expect(d.retry).toBe(Math.min(perAttemptTimeoutMs, affordable) >= BASE_CALL_MIN_TIMEOUT_MS);
      if (d.retry !== lastRetry) { flips++; lastRetry = d.retry; }
    }
    // Monotone: exactly ONE transition from retry to decline over the sweep.
    expect(flips).toBe(1);
    expect(lastRetry).toBe(false);
  });

  it('the floor is min(BASE_CALL_MIN_TIMEOUT_MS, perAttempt) — a sub-second caller is NOT newly refused', () => {
    // A 400ms per-attempt caller with 500ms affordable: the pre-①b rule granted
    // this (400 + 1_000 delay + 1_000 margin fits), so ①b must too. A bare
    // `affordable >= 1_000` floor would silently REMOVE this retry.
    const perAttemptTimeoutMs = 400;
    const d = decideIslRetry({
      retryable: true, attempt: 1, maxAttempts: 3,
      elapsedMs: 590, // remaining 2_010 → affordable 10 … too small
      perAttemptTimeoutMs,
      budget: { remainingMs: 2_600 },
    });
    // affordable = 2_010 − 1_000 − 1_000 = 10 < 400 → decline, correctly.
    expect(d.retry).toBe(false);

    const ok = decideIslRetry({
      retryable: true, attempt: 1, maxAttempts: 3,
      elapsedMs: 100, // remaining 2_500 → affordable 500 >= 400
      perAttemptTimeoutMs,
      budget: { remainingMs: 2_600 },
    });
    expect(ok.retry).toBe(true);
    expect(ok.attemptTimeoutMs).toBe(perAttemptTimeoutMs); // unclamped: 400 <= 500
    expect(ok.timeoutClamped).toBe(false);
    expect(BASE_CALL_MIN_TIMEOUT_MS).toBeGreaterThan(perAttemptTimeoutMs); // the floor WOULD have refused
  });

  it('a non-retryable failure and a spent attempt cap are unaffected by the clamp', () => {
    const notRetryable = decideIslRetry({
      retryable: false, attempt: 1, maxAttempts: 3, elapsedMs: 0,
      perAttemptTimeoutMs: 1_000, budget: { remainingMs: 70_000 },
    });
    expect(notRetryable.retry).toBe(false);
    expect(notRetryable.reason).toBe('not_retryable');

    const capped = decideIslRetry({
      retryable: true, attempt: 3, maxAttempts: 3, elapsedMs: 0,
      perAttemptTimeoutMs: 1_000, budget: { remainingMs: 70_000 },
    });
    expect(capped.retry).toBe(false);
    expect(capped.reason).toBe('attempt_cap');
  });

  it('an absurd Retry-After still self-limits — the clamp cannot rescue a 1-hour wait', () => {
    // The delay is subtracted BEFORE the clamp, so a hint larger than the budget
    // makes `affordable` deeply negative. No amount of narrowing helps.
    const d = decideIslRetry({
      retryable: true, attempt: 1, maxAttempts: 3, elapsedMs: 350,
      perAttemptTimeoutMs: STAGING_PER_ATTEMPT_MS,
      retryAfterMs: 3_600_000,
      budget: { remainingMs: STAGING_REMAINING_AT_CALL_MS },
    });
    expect(d.retry).toBe(false);
    expect(d.reason).toBe('budget_exhausted');
    expect(d.affordableTimeoutMs!).toBeLessThan(0);
  });
});

describe('2.202 ①b — the NO-BUDGET path is untouched (blast radius)', () => {
  it('no budget → no clamp, no affordable figure, previous behaviour exactly', () => {
    for (const perAttemptTimeoutMs of [250, 1_000, 60_000]) {
      const d = decideIslRetry({
        retryable: true, attempt: 1, maxAttempts: 3,
        elapsedMs: 999_999, perAttemptTimeoutMs,
        retryAfterMs: 3_600_000, budget: undefined,
      });
      expect(d.retry).toBe(true);
      expect(d.reason).toBe('attempts_remaining');
      // The clamp needs a budget to clamp against; with none there is nothing to
      // derive a narrower timeout FROM, and inventing one would be a magic number.
      expect(d.attemptTimeoutMs).toBe(perAttemptTimeoutMs);
      expect(d.timeoutClamped).toBe(false);
      expect(d.affordableTimeoutMs).toBeUndefined();
      expect(d.delayMs).toBe(islRetryBackoffMs(1)); // A1: Retry-After still ignored
    }
  });
});
