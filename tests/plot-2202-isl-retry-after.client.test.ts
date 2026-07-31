/**
 * ROADMAP 2.202 — WALL-CLOCK proof that ISL's `Retry-After` reaches the retry
 * decision, driving the REAL ISLClient against a real socket.
 *
 * THE DEFECT (diagnosis-run-analysis-500s.md §4): `ISLHttpError` captured
 * `status`, `body`, `endpoint`, `islError` — and no headers. The response
 * headers were read for `x-request-id` ONLY. So ISL's governor answering
 * `RETRY_AFTER_SECONDS = 5` on its `caller_concurrency_exceeded` 429 emitted the
 * one piece of actionable guidance in the whole chain, and PLoT discarded it.
 *
 * The timing arm is the load-bearing one: it distinguishes "slept for the
 * server's 3s hint" from "slept for our own 1s backoff", which is the only way
 * to prove the header was actually HONOURED rather than merely parsed.
 *
 * RED against the pre-fix code on both arms — transcript in the lane evidence file.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ISLClient } from '../src/integrations/isl/client.js';
import { ISLHttpError, ISLResponseProcessingError, isRetryableError } from '../src/integrations/isl/errors.js';
import { islRetryBackoffMs } from '../src/config/timeouts.js';

const ENDPOINT = '/api/v1/robustness/analyze/v2';
const PER_ATTEMPT_TIMEOUT_MS = 2_000;

let server: Server;
let port: number;
let hits = 0;
/** Value the fake ISL puts in the Retry-After header (undefined → omit). */
let retryAfterHeader: string | undefined;
/** How many 429s to serve before switching to 200. */
let rejectionsRemaining = 0;

function client(overrides: Partial<{ maxRetries: number; timeoutMs: number }> = {}) {
  return new ISLClient({
    baseUrl: `http://127.0.0.1:${port}`,
    apiKey: 'test-key',
    timeoutMs: overrides.timeoutMs ?? PER_ATTEMPT_TIMEOUT_MS,
    maxRetries: overrides.maxRetries ?? 3,
  });
}

describe('2.202 — Retry-After is captured on ISLHttpError and honoured by the retry', () => {
  beforeAll(async () => {
    server = createHttpServer((req, res) => {
      req.resume();
      req.on('end', () => {
        hits++;
        if (rejectionsRemaining > 0) {
          rejectionsRemaining--;
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (retryAfterHeader !== undefined) headers['Retry-After'] = retryAfterHeader;
          res.writeHead(429, headers);
          res.end(JSON.stringify({ detail: 'caller_concurrency_exceeded' }));
          return;
        }
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
    retryAfterHeader = undefined;
  });

  it('CAPTURE — a 429 carrying Retry-After surfaces it as retryAfterMs on the thrown error', async () => {
    rejectionsRemaining = 99;
    retryAfterHeader = '5'; // ISL governor RETRY_AFTER_SECONDS
    // maxRetries = 1 → one attempt, so the error is thrown unmodified.
    let caught: unknown;
    try {
      await client({ maxRetries: 1 }).request({ endpoint: ENDPOINT, body: {}, requestId: 'rid-capture' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ISLHttpError);
    const err = caught as ISLHttpError;
    expect(err.status).toBe(429);
    expect(err.isRetryable()).toBe(true);
    // PRE-FIX: this property did not exist — the header was never read.
    expect(err.retryAfterMs).toBe(5_000);
    expect(hits).toBe(1);
  }, 20_000);

  it('CONTROL — the same 429 WITHOUT the header leaves retryAfterMs undefined', async () => {
    // Trap 13: proves the assertion above reads the header rather than a
    // constant that would be present either way.
    rejectionsRemaining = 99;
    retryAfterHeader = undefined;
    let caught: unknown;
    try {
      await client({ maxRetries: 1 }).request({ endpoint: ENDPOINT, body: {}, requestId: 'rid-nohdr' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ISLHttpError);
    expect((caught as ISLHttpError).retryAfterMs).toBeUndefined();
  }, 20_000);

  it('⭐ HONOURED — the client waits the server\'s 3s hint, not its own 1s backoff', async () => {
    rejectionsRemaining = 1;
    retryAfterHeader = '3';
    expect(islRetryBackoffMs(1)).toBe(1_000); // what it would wait without the hint

    const t0 = Date.now();
    const res = await client({ maxRetries: 3 }).request<{ ok: boolean }>({
      endpoint: ENDPOINT,
      body: {},
      requestId: 'rid-honoured',
      budget: { remainingMs: 60_000 },
    });
    const elapsed = Date.now() - t0;

    expect(res.data).toEqual({ ok: true });
    expect(hits).toBe(2);
    // The discriminating assertion: >= ~3s can only come from the 3s hint.
    // PRE-FIX (backoff only) this landed at ~1s and the assertion FAILS.
    expect(elapsed).toBeGreaterThanOrEqual(2_900);
    expect(elapsed).toBeLessThan(10_000);
  }, 30_000);

  it('Retry-After never SHORTENS the wait below our own backoff', async () => {
    // Attempt 2's backoff is 2s; a `Retry-After: 0` must not talk us into a
    // hot retry loop against a service that is already rejecting us.
    rejectionsRemaining = 2;
    retryAfterHeader = '0';
    const t0 = Date.now();
    const res = await client({ maxRetries: 3 }).request<{ ok: boolean }>({
      endpoint: ENDPOINT,
      body: {},
      requestId: 'rid-floor',
      budget: { remainingMs: 60_000 },
    });
    const elapsed = Date.now() - t0;
    expect(res.data).toEqual({ ok: true });
    expect(hits).toBe(3);
    // 1s + 2s of our own backoff must still have been slept.
    expect(elapsed).toBeGreaterThanOrEqual(2_800);
  }, 30_000);

  it('⭐ NO BUDGET — Retry-After is ignored; the client sleeps its own backoff (A1)', async () => {
    // THE HIGH from the PR #295 adversarial review, pinned end-to-end on the
    // real client. Every caller EXCEPT the /v2/run base call passes no budget:
    // /v1/run's validateCausal + analyseRobustness run with maxRetries = 3 and
    // no budget against the very endpoint whose governor 429 carries
    // `Retry-After: 5`. The first cut honoured that hint with nothing bounding
    // it, so this call slept 5s per retry (and a hostile/misconfigured
    // `Retry-After: 3600` slept the hour, uninterruptibly).
    rejectionsRemaining = 1;
    retryAfterHeader = '3';
    const t0 = Date.now();
    const res = await client({ maxRetries: 3 }).request<{ ok: boolean }>({
      endpoint: ENDPOINT,
      body: {},
      requestId: 'rid-nobudget',
      // budget deliberately omitted — the pre-2.202 caller shape.
    });
    const elapsed = Date.now() - t0;

    expect(res.data).toEqual({ ok: true });
    expect(hits).toBe(2);
    // ~1s (our backoff), NOT ~3s (the server's hint). This is the assertion
    // that distinguishes "previous behaviour exactly" from "approximately".
    expect(elapsed).toBeLessThan(2_000);
    expect(elapsed).toBeGreaterThanOrEqual(900);
  }, 30_000);

  it('⭐ NO BUDGET — an absurd Retry-After cannot stall the call (A1)', async () => {
    // Without a budget there is nothing to reject the hint, so ignoring it is
    // the ONLY thing keeping this bounded. Pre-A1 this slept for an hour and
    // the test timed out.
    rejectionsRemaining = 1;
    retryAfterHeader = '3600';
    const t0 = Date.now();
    const res = await client({ maxRetries: 3 }).request<{ ok: boolean }>({
      endpoint: ENDPOINT, body: {}, requestId: 'rid-nobudget-absurd',
    });
    const elapsed = Date.now() - t0;
    expect(res.data).toEqual({ ok: true });
    expect(hits).toBe(2);
    expect(elapsed).toBeLessThan(2_000);
  }, 30_000);

  it('an absurd Retry-After does NOT get slept — it fails the budget check and terminates', async () => {
    rejectionsRemaining = 99;
    retryAfterHeader = '3600'; // one hour
    const t0 = Date.now();
    let caught: unknown;
    try {
      await client({ maxRetries: 3 }).request({
        endpoint: ENDPOINT, body: {}, requestId: 'rid-absurd',
        budget: { remainingMs: 60_000 },
      });
    } catch (e) { caught = e; }
    const elapsed = Date.now() - t0;

    expect(caught).toBeInstanceOf(ISLHttpError);
    expect((caught as ISLHttpError).status).toBe(429);
    expect(hits).toBe(1);
    expect(elapsed).toBeLessThan(5_000); // did not sleep for an hour
  }, 20_000);
});

describe('2.202 review item C — a failure AFTER ISL computed must not re-issue the analysis', () => {
  let badServer: Server;
  let badPort: number;
  let badHits = 0;
  /** >0 → serve a retryable 429 first (used by the positive control). */
  let controlRejections = 0;

  beforeAll(async () => {
    badServer = createHttpServer((req, res) => {
      req.resume();
      req.on('end', () => {
        badHits++;
        if (controlRejections > 0) {
          controlRejections--;
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ detail: 'caller_concurrency_exceeded' }));
          return;
        }
        if (controlMode) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        // 200 OK — ISL DID the work — but the body is not JSON.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"options": [ THIS IS NOT JSON');
      });
    });
    await new Promise<void>((resolve) => badServer.listen(0, '127.0.0.1', () => resolve()));
    badPort = (badServer.address() as AddressInfo).port;
  });

  /** When true the server returns well-formed JSON (control arm). */
  let controlMode = false;

  function badClient() {
    return new ISLClient({
      baseUrl: `http://127.0.0.1:${badPort}`,
      apiKey: 'test-key',
      timeoutMs: 2_000,
      maxRetries: 3,
    });
  }

  afterAll(async () => {
    badServer.closeAllConnections?.();
    await new Promise<void>((resolve) => badServer.close(() => resolve()));
  });

  beforeEach(() => { badHits = 0; controlRejections = 0; controlMode = false; });

  it('⭐ an unparseable 2xx body is NOT retryable — one attempt, no recompute', async () => {
    // Before 2.202 the catch wrapped any unrecognised error (incl. a JSON.parse
    // SyntaxError) as an ISLNetworkError, which isRetryableError reports as
    // RETRYABLE. That was inert while the base call was clamped to one attempt;
    // 2.202 makes those retries reachable, so without the narrowing this would
    // re-issue the WHOLE analysis — multiplying load on the very governor whose
    // contention this change exists to survive.
    let caught: unknown;
    try {
      await badClient().request({
        endpoint: ENDPOINT, body: {}, requestId: 'rid-badjson',
        budget: { remainingMs: 60_000 }, // ample — a retry WOULD fit if allowed
      });
    } catch (e) { caught = e; }

    expect(caught).toBeInstanceOf(ISLResponseProcessingError);
    expect(isRetryableError(caught)).toBe(false);
    // The load-bearing assertion: ISL was asked to compute exactly ONCE.
    expect(badHits).toBe(1);
  }, 20_000);

  it('CONTROL — the harness CAN see a retry against the SAME server and client config', async () => {
    // Trap 13: without this, `badHits === 1` above could hold because nothing in
    // this setup ever retries. Identical client, identical server, identical
    // budget — only the failure CLASS differs (retryable 429 vs post-compute
    // parse fault) — and the count goes to 2.
    controlRejections = 1;
    controlMode = true;
    const res = await badClient().request<{ ok: boolean }>({
      endpoint: ENDPOINT, body: {}, requestId: 'rid-c-control',
      budget: { remainingMs: 60_000 },
    });
    expect(res.data).toEqual({ ok: true });
    expect(badHits).toBe(2);
  }, 20_000);
});

describe('2.202 — a SLOW failure must NOT buy a retry (the property the old clamp protected)', () => {
  let hangServer: Server;
  let hangPort: number;

  beforeAll(async () => {
    hangServer = createHttpServer(() => { /* accept and never respond */ });
    await new Promise<void>((resolve) => hangServer.listen(0, '127.0.0.1', () => resolve()));
    hangPort = (hangServer.address() as AddressInfo).port;
  });

  afterAll(async () => {
    hangServer.closeAllConnections?.();
    await new Promise<void>((resolve) => hangServer.close(() => resolve()));
  });

  function hangClient(timeoutMs: number) {
    return new ISLClient({
      baseUrl: `http://127.0.0.1:${hangPort}`,
      apiKey: 'test-key',
      timeoutMs,
      maxRetries: 3,
    });
  }

  it('POSITIVE CONTROL — with AMPLE budget the same slow failure DOES retry', async () => {
    // Trap 13: the "did not retry" claim below is vacuous unless this harness
    // can see a retry at all. 3 attempts × 300ms + 1s + 2s backoff ≈ 3.9s.
    const t0 = Date.now();
    await expect(
      hangClient(300).request({
        endpoint: ENDPOINT, body: {}, requestId: 'rid-slow-control',
        budget: { remainingMs: 60_000 },
      }),
    ).rejects.toThrow();
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThan(3 * 300 + 2_000);
  }, 30_000);

  it('⭐ a failure that consumed the budget gets NO retry — bounded to one attempt', async () => {
    // 500ms attempt, 1200ms budget: after the timeout ~700ms remain, and the
    // next attempt would cost 1s backoff + 500ms + 1s margin. Does not fit.
    const t0 = Date.now();
    await expect(
      hangClient(500).request({
        endpoint: ENDPOINT, body: {}, requestId: 'rid-slow-bounded',
        budget: { remainingMs: 1_200 },
      }),
    ).rejects.toThrow();
    const elapsed = Date.now() - t0;
    // One attempt only — no backoff sleep, no second attempt.
    expect(elapsed).toBeLessThan(1_800);
  }, 20_000);

  it('⭐ the retry never outlives the supplied budget', async () => {
    // The invariant that replaces the old up-front worst-case arithmetic.
    const BUDGET_MS = 3_000;
    const t0 = Date.now();
    await expect(
      hangClient(400).request({
        endpoint: ENDPOINT, body: {}, requestId: 'rid-budget-bound',
        budget: { remainingMs: BUDGET_MS },
      }),
    ).rejects.toThrow();
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThanOrEqual(BUDGET_MS);
  }, 20_000);
});
