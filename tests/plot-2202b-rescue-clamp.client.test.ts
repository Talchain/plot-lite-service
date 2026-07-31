/**
 * ROADMAP 2.202 fix ①b — WALL-CLOCK proof that the REAL `ISLClient` actually RUNS
 * the rescue attempt at the CLAMPED width, and that the FIRST attempt is not.
 *
 * A decision function that returns a narrower timeout proves nothing on its own:
 * if the client kept using `this.config.timeoutMs` for the retry (as it did
 * before ①b), the clamp would be advisory — a guarantee that never executes, the
 * defect class this programme names as dominant. So these arms drive the client
 * against a real socket and read the clock.
 *
 * The discriminating signal is `ISLTimeoutError.timeoutMs`: it reports the
 * timeout the attempt ACTUALLY ran with. A rescue attempt that reports the full
 * configured width has not been clamped, whatever the decision said.
 *
 *   PROBE OF RECORD: PHASE0-EVIDENCE-2026-07-28/probe-2202-retry-under-contention.md
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ISLClient } from '../src/integrations/isl/client.js';
import { ISLHttpError, ISLTimeoutError } from '../src/integrations/isl/errors.js';

const ENDPOINT = '/api/v1/robustness/analyze/v2';

describe('2.202 ①b — the rescue attempt RUNS, and it runs narrow', () => {
  let server: Server;
  let port: number;
  let hits = 0;
  /** 429s to serve before switching to the `afterRejections` behaviour. */
  let rejectionsRemaining = 0;
  /** After the 429s: 'hang' (never respond) or 'ok' (200). */
  let afterRejections: 'hang' | 'ok' = 'hang';

  beforeAll(async () => {
    server = createHttpServer((req, res) => {
      req.resume();
      req.on('end', () => {
        hits++;
        if (rejectionsRemaining > 0) {
          rejectionsRemaining--;
          res.writeHead(429, { 'Content-Type': 'application/json' });
          // ISL's real governor shape (reason carries the token) — no
          // Retry-After header here, so the BUDGET alone drives the decision.
          res.end(JSON.stringify({
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many concurrent analyses from this caller. Retry shortly.',
            reason: 'caller_concurrency_exceeded',
          }));
          return;
        }
        if (afterRejections === 'hang') return; // accept and never answer
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    hits = 0;
    rejectionsRemaining = 0;
    afterRejections = 'hang';
  });

  function client(timeoutMs: number, maxRetries = 3) {
    return new ISLClient({
      baseUrl: `http://127.0.0.1:${port}`, apiKey: 'test-key', timeoutMs, maxRetries,
    });
  }

  it('POSITIVE CONTROL — the harness can SEE a retry succeed under ample budget', async () => {
    // Trap 13. Without this, every "2 hits" assertion below could be read as a
    // harness that retries unconditionally, and every "1 hit" as one that never
    // retries. Same server, same client, only the budget differs.
    rejectionsRemaining = 1;
    afterRejections = 'ok';
    const res = await client(2_000).request<{ ok: boolean }>({
      endpoint: ENDPOINT, body: {}, requestId: 'rid-2202b-control',
      budget: { remainingMs: 60_000 },
    });
    expect(res.data).toEqual({ ok: true });
    expect(hits).toBe(2);
  }, 30_000);

  it('⭐ RED-FIRST — a budget too small for a FULL retry still buys a CLAMPED one', async () => {
    // 10s configured per-attempt timeout, 4.5s of budget. The pre-①b rule needed
    // 1s backoff + 10s attempt + 1s margin = 12s and declined after ONE hit,
    // which is precisely what staging did on 100% of contended requests.
    // ①b affords `4.5s − ~0 elapsed − 1s delay − 1s margin ≈ 2.5s` and spends it.
    rejectionsRemaining = 1;
    afterRejections = 'hang'; // the rescue attempt must be ENDED BY ITS TIMEOUT
    const CONFIGURED_TIMEOUT_MS = 10_000;
    const BUDGET_MS = 4_500;

    const t0 = Date.now();
    let caught: unknown;
    try {
      await client(CONFIGURED_TIMEOUT_MS).request({
        endpoint: ENDPOINT, body: {}, requestId: 'rid-2202b-clamped',
        budget: { remainingMs: BUDGET_MS },
      });
    } catch (e) { caught = e; }
    const elapsed = Date.now() - t0;

    // THE MECHANISM: a second attempt reached ISL at all. PRE-①b: exactly 1.
    expect(hits).toBe(2);

    // THE CLAMP, observed rather than inferred: the attempt that timed out
    // reports the width it actually ran with. PRE-①b there was no second
    // attempt; had the client ignored the decision's timeout it would report
    // 10_000 here and the call would have overrun the budget.
    expect(caught).toBeInstanceOf(ISLTimeoutError);
    const timedOut = caught as ISLTimeoutError;
    expect(timedOut.timeoutMs).toBeLessThan(CONFIGURED_TIMEOUT_MS);
    expect(timedOut.timeoutMs).toBeGreaterThanOrEqual(1_000);

    // THE BOUND: the whole call still finished inside the caller's budget.
    expect(elapsed).toBeLessThanOrEqual(BUDGET_MS);
    expect(elapsed).toBeGreaterThan(2_500); // it really did spend the rescue attempt
  }, 30_000);

  it('⭐ THE FIRST ATTEMPT IS NOT NEWLY CLAMPED — #295\'s decline stands where it holds', async () => {
    // ①b narrows RESCUE attempts only. A first attempt might still succeed if
    // left alone, so truncating it would trade a slow success for a certain
    // failure — the harm #295 refused, and still refuses.
    //
    // 1.5s configured timeout against a 400ms budget: if the clamp reached the
    // first attempt it would abort at ~400ms (or be refused outright). It must
    // run the full 1.5s and report 1.5s.
    rejectionsRemaining = 0;
    afterRejections = 'hang';
    const CONFIGURED_TIMEOUT_MS = 1_500;

    const t0 = Date.now();
    let caught: unknown;
    try {
      await client(CONFIGURED_TIMEOUT_MS).request({
        endpoint: ENDPOINT, body: {}, requestId: 'rid-2202b-first-attempt',
        budget: { remainingMs: 400 },
      });
    } catch (e) { caught = e; }
    const elapsed = Date.now() - t0;

    expect(caught).toBeInstanceOf(ISLTimeoutError);
    expect((caught as ISLTimeoutError).timeoutMs).toBe(CONFIGURED_TIMEOUT_MS);
    expect(elapsed).toBeGreaterThanOrEqual(1_400);
    // …and the exhausted budget still declines the retry, so this is bounded.
    expect(hits).toBe(1);
    expect(elapsed).toBeLessThan(2_500);
  }, 30_000);

  it('⭐ a genuinely-exhausted budget still declines — one attempt, no rescue, no hang', async () => {
    // The other side of the floor. 800ms of budget cannot pay a 1s backoff, let
    // alone an attempt, so `budget_exhausted` still terminates the call.
    rejectionsRemaining = 99;
    const t0 = Date.now();
    let caught: unknown;
    try {
      await client(5_000).request({
        endpoint: ENDPOINT, body: {}, requestId: 'rid-2202b-exhausted',
        budget: { remainingMs: 800 },
      });
    } catch (e) { caught = e; }
    const elapsed = Date.now() - t0;

    expect(caught).toBeInstanceOf(ISLHttpError);
    expect((caught as ISLHttpError).status).toBe(429);
    // fix ①b's other half: the governor's own token is now readable off the
    // error rather than sitting in a field nothing consults.
    expect((caught as ISLHttpError).getReason()).toBe('caller_concurrency_exceeded');
    expect(hits).toBe(1);
    expect(elapsed).toBeLessThan(1_000);
  }, 30_000);

  /** Structured rows the client wrote to console.warn during one call. */
  function captureRows() {
    const rows: Record<string, unknown>[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      try { rows.push(JSON.parse(String(args[0]))); } catch { /* non-JSON: ignore */ }
    });
    return rows;
  }

  it('⭐ TELEMETRY — isl_retry_scheduled names the governor cause AND the clamp', async () => {
    // ⚠ WITHOUT THIS ARM THE TELEMETRY IS UNPINNED, and the field that exists to
    // make the NEXT diagnosis a log read could be deleted with the whole suite
    // green — the same write-only shape ①b is repairing. So the row itself is
    // asserted, not just the value the parser can produce in isolation.
    rejectionsRemaining = 1;
    afterRejections = 'hang';
    const rows = captureRows();
    await client(10_000).request({
      endpoint: ENDPOINT, body: {}, requestId: 'rid-2202b-telemetry',
      budget: { remainingMs: 4_500 },
    }).catch(() => undefined);

    const scheduled = rows.find((r) => r.event === 'isl_retry_scheduled');
    expect(scheduled, 'isl_retry_scheduled must be emitted — it never fired once on 91bcac5').toBeDefined();
    // The cause, off the wire, from the field that had zero readers.
    expect(scheduled!.isl_reason).toBe('caller_concurrency_exceeded');
    // The clamp, observable without a probe.
    expect(scheduled!.timeout_clamped).toBe(true);
    expect(scheduled!.per_attempt_timeout_ms).toBe(10_000);
    expect(scheduled!.next_attempt_timeout_ms as number).toBeLessThan(10_000);
    expect(scheduled!.affordable_timeout_ms as number).toBeGreaterThan(0);
  }, 30_000);

  it('⭐ TELEMETRY — isl_retry_declined says WHY, with a negative affordable width', async () => {
    rejectionsRemaining = 99;
    const rows = captureRows();
    await client(5_000).request({
      endpoint: ENDPOINT, body: {}, requestId: 'rid-2202b-telemetry-declined',
      budget: { remainingMs: 800 },
    }).catch(() => undefined);

    const declined = rows.find((r) => r.event === 'isl_retry_declined');
    expect(declined).toBeDefined();
    expect(declined!.reason).toBe('budget_exhausted');
    expect(declined!.isl_reason).toBe('caller_concurrency_exceeded');
    // The number that distinguishes "the floor bit" from "the budget is spent".
    expect(declined!.affordable_timeout_ms as number).toBeLessThan(0);
  }, 30_000);

  it('a persistent 429 with ample budget still stops at the configured attempt cap', async () => {
    // The clamp adds a rescue; it must not remove the hard upper bound.
    rejectionsRemaining = 99;
    const res = await client(2_000, 3).request({
      endpoint: ENDPOINT, body: {}, requestId: 'rid-2202b-cap',
      budget: { remainingMs: 60_000 },
    }).catch((e) => e);
    expect(res).toBeInstanceOf(ISLHttpError);
    expect(hits).toBe(3);
  }, 40_000);
});
