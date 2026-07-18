/**
 * F9 / F3 shared mechanism — WALL-CLOCK proof that a per-call `maxRetries` bounds
 * the real ISL client's retry time, using PRODUCTION retry defaults.
 *
 * The defect both findings share: an optional-phase call (threshold F9, flip-probe
 * F3) that omits `maxRetries` inherits the config default (ISL_MAX_RETRIES = 3),
 * so a "cap" of one per-attempt timeout is really ~3× that timeout PLUS the 1s+2s
 * backoff the client sleeps. The fix passes `maxRetries = 1`.
 *
 * This drives the REAL ISLClient (no mock) against a server that accepts the POST
 * and never responds, so every attempt hits the per-attempt AbortController
 * timeout and the client retries with real backoff sleeps.
 *
 * POSITIVE CONTROL (doctrine #13): the first case OMITS maxRetries (inherits the
 * default 3) and asserts the call OVERRUNS to ~3× timeout + backoff — proving the
 * harness can SEE the overrun the optional phases used to have. Only then does the
 * second case assert `maxRetries = 1` bounds it to ~1× timeout.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getISLService } from '../src/integrations/isl/index.js';

const ROBUSTNESS_ENDPOINT = '/api/v1/robustness/analyze/v2';
const PER_ATTEMPT_TIMEOUT_MS = 250;

let server: Server;
let port: number;

describe('ISL client retry time is bounded by per-call maxRetries (F9/F3 mechanism)', () => {
  beforeAll(async () => {
    // A server that accepts the connection and NEVER responds → every attempt
    // hits the client's per-attempt AbortController timeout.
    server = createHttpServer(() => { /* intentionally hang */ });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    process.env.ISL_ENABLE = '1';
    process.env.ISL_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.ISL_API_KEY = 'test-key';
    // Production default: 3 total attempts. The positive control depends on this.
    delete process.env.ISL_MAX_RETRIES;
  });

  it('POSITIVE CONTROL — omitting maxRetries inherits the default 3 and OVERRUNS (~3× + backoff)', async () => {
    const svc = getISLService();
    const t0 = Date.now();
    const res = await svc.callAnalysisEndpoint(ROBUSTNESS_ENDPOINT, { probe: 1 }, 'rid-positive-control', PER_ATTEMPT_TIMEOUT_MS);
    const elapsed = Date.now() - t0;

    expect(res.data).toBeNull();
    expect(res.error?.code).toBe('ISL_TIMEOUT');
    // 3 attempts × 250ms + (1000 + 2000) backoff ≈ 3750ms. Anything > 3× the
    // per-attempt timeout is impossible without the inherited extra attempts +
    // backoff — this is the overrun the optional phases used to inherit.
    expect(elapsed).toBeGreaterThan(3 * PER_ATTEMPT_TIMEOUT_MS + 2_000);
    expect(elapsed).toBeLessThan(8_000);
  }, 20_000);

  it('FIX — maxRetries = 1 bounds the call to ~1× the per-attempt timeout (no retries, no backoff)', async () => {
    const svc = getISLService();
    const t0 = Date.now();
    const res = await svc.callAnalysisEndpoint(ROBUSTNESS_ENDPOINT, { probe: 1 }, 'rid-bounded', PER_ATTEMPT_TIMEOUT_MS, 1);
    const elapsed = Date.now() - t0;

    expect(res.data).toBeNull();
    expect(res.error?.code).toBe('ISL_TIMEOUT');
    // One attempt only: ~250ms. No second attempt, no 1s/2s backoff sleeps.
    expect(elapsed).toBeLessThan(1_500);
  }, 10_000);

  it('WIRING — an external AbortSignal cancels the in-flight fetch through the client (F3 end-to-end)', async () => {
    // This is the load-bearing F3 path: the flip deadline's signal must reach the
    // client's fetch, not just the flip-search bookkeeping. Per-attempt timeout is
    // set FAR longer (5s) than when we abort (150ms), so if the abort did not reach
    // the fetch the call would run the full 5s.
    const svc = getISLService();
    const ac = new AbortController();
    const LONG_PER_ATTEMPT_MS = 5_000;
    setTimeout(() => ac.abort(), 150);

    const t0 = Date.now();
    const res = await svc.callAnalysisEndpoint(ROBUSTNESS_ENDPOINT, { probe: 1 }, 'rid-external-abort', LONG_PER_ATTEMPT_MS, 1, ac.signal);
    const elapsed = Date.now() - t0;

    expect(res.data).toBeNull();
    expect(res.error?.code).toBe('ISL_TIMEOUT'); // deadline-cancel folds to a timeout
    // Cancelled at ~150ms, NOT after the 5s per-attempt timeout.
    expect(elapsed).toBeLessThan(1_500);
  }, 10_000);
});
