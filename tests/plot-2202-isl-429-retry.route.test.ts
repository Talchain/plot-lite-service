/**
 * ⭐ ROADMAP 2.202 — THE RED-FIRST PIN. End-to-end through route → service →
 * real ISLClient → the wire, against a fake ISL that answers 429 then 200.
 *
 * THE DEFECT (diagnosis-run-analysis-500s.md §1/§2/§4, byte-verified):
 * ISL's compute governor rejects the 3rd concurrent analysis with a 429
 * (`caller_concurrency_exceeded`, ANALYSIS_WORKERS = 2 — and PLoT holds ONE API
 * key for the whole product, so a per-caller fairness gate is a global 2-slot
 * cap). The 429 came back in **133 ms**. PLoT classified it retryable — and then
 * did not retry, because /v2/run clamped the base call's attempt count from
 * WORST-CASE timeouts before the call (`worstCaseMs(2, 60_000) = 121_000 >
 * 69_800` → 1 attempt). PLoT emitted a typed-failure envelope with **~69.8 s of
 * the request budget unspent**; CEE mapped it to the HTTP 500 the tester saw
 * (4 of 20 chip-click run_analysis attempts on the 31 Jul probe).
 *
 * RED AGAINST THE PRE-FIX CODE: the route passed `maxRetries = 1`, so the fake
 * ISL received exactly ONE request and /v2/run answered
 * `analysis_status: 'failed'` + `ISL_CALL_FAILED` + a status_reason naming
 * HTTP 429. Verbatim RED transcript in the lane evidence file.
 *
 * This drives the REAL client on purpose. A mocked `islService` would bypass
 * `ISLClient.request` — i.e. bypass the retry loop under test — and prove
 * nothing (trap 16: a mock proves presence-in-repo, never presence-on-the-wire).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

const BASE_ROBUSTNESS_PATH = '/api/v1/robustness/analyze/v2';

/** Minimal ISL success body for the base robustness call. */
const ISL_OK = {
  options: [
    { option_id: 'opt1', outcome: { mean: 0.8, std: 0.1, p10: 0.6, p50: 0.8, p90: 0.95, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 }, rank: 1, win_probability: 0.7, probability_of_goal: 0.65 },
    { option_id: 'opt2', outcome: { mean: 0.7, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 }, rank: 2, win_probability: 0.3, probability_of_goal: 0.55 },
  ],
  factor_sensitivity: [],
  robustness: { score: 0.82, label: 'robust', fragile_edges: [], robust_edges: [], edge_e_values: [] },
};

/** Single factor / two options — deliberately below the flip-probe trigger, so
 *  the only ISL traffic is the BASE call and the test stays fast. */
const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'factor-a', kind: 'factor', label: 'Marketing', observed_state: { value: 0.6 } },
  ],
  edges: [{ from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } }],
};
const OPTIONS = [
  { id: 'opt1', label: 'A', interventions: { 'factor-a': 0.8 } },
  { id: 'opt2', label: 'B', interventions: { 'factor-a': 0.3 } },
];

let islServer: Server;
let islPort: number;
/** How many 429s the fake ISL should serve before switching to 200. */
let rejectionsRemaining = 0;
/** Base-endpoint hits, in order. */
let baseHits: number[] = [];
/** When true the fake ISL answers a NON-retryable 400 (negative control). */
let nonRetryable400 = false;

describe('2.202 — a fast ISL 429 is retried from the budget that actually remains', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    islServer = createHttpServer((req, res) => {
      const path = (req.url ?? '').split('?')[0];
      // Drain the body so keep-alive sockets are reusable.
      req.resume();
      req.on('end', () => {
        if (path === BASE_ROBUSTNESS_PATH) {
          baseHits.push(Date.now());
          if (nonRetryable400) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ detail: 'bad request' }));
            return;
          }
          if (rejectionsRemaining > 0) {
            rejectionsRemaining--;
            // ISL's governor shape: 429 + a JSON detail. NO Retry-After header
            // here on purpose — this arm proves the BUDGET drives the retry,
            // independent of any hint. Retry-After is pinned separately in
            // tests/plot-2202-isl-retry-after.client.test.ts.
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ detail: 'caller_concurrency_exceeded' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(ISL_OK));
          return;
        }
        // Any other ISL endpoint the route may touch: benign 200.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({}));
      });
    });
    await new Promise<void>((resolve) => islServer.listen(0, '127.0.0.1', () => resolve()));
    islPort = (islServer.address() as AddressInfo).port;

    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.ISL_ENABLE = '1';
    process.env.ISL_BASE_URL = `http://127.0.0.1:${islPort}`;
    process.env.ISL_API_KEY = 'test-key';
    delete process.env.ISL_MAX_RETRIES; // production default: 3
    delete process.env.REQUEST_BUDGET_MS; // production default: 70s

    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    islServer.closeAllConnections?.();
    await new Promise<void>((resolve) => islServer.close(() => resolve()));
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
    delete process.env.ISL_ENABLE;
    delete process.env.ISL_BASE_URL;
    delete process.env.ISL_API_KEY;
    delete process.env.REQUEST_BUDGET_MS;
  });

  beforeEach(() => {
    baseHits = [];
    rejectionsRemaining = 0;
    delete process.env.REQUEST_BUDGET_MS;
  });

  async function run() {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({ graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: 's2202' }),
    });
    return { statusCode: res.statusCode, body: JSON.parse(res.body) as any };
  }

  const critiqueCodes = (body: any): string[] =>
    (body.critiques ?? []).map((c: any) => c.code);

  it('POSITIVE CONTROL — the harness can SEE a clean run: 1 hit, no failure envelope', async () => {
    // Trap 13: before asserting "the 429 no longer fails", prove this harness
    // produces a PASS when there is nothing to retry. Without this, the
    // success assertions below could pass by testing nothing.
    rejectionsRemaining = 0;
    const { statusCode, body } = await run();
    expect(statusCode).toBe(200);
    expect(baseHits).toHaveLength(1);
    expect(body.analysis_status).not.toBe('failed');
    expect(critiqueCodes(body)).not.toContain('ISL_CALL_FAILED');
  }, 30_000);

  it('POSITIVE CONTROL — the harness can SEE a failure: a NON-retryable 4xx still fails fast', async () => {
    // The other half of the control. A 400 is not retryable, so it must still
    // produce the typed-failure envelope after exactly ONE hit — proving the
    // success assertions are not simply unable to observe a failure, and that
    // the fix did not widen retries to non-classified statuses.
    const original = rejectionsRemaining;
    rejectionsRemaining = 0;
    const previousHandlerHits = baseHits.length;
    // Temporarily answer 400 by exhausting nothing and swapping the flag below.
    nonRetryable400 = true;
    try {
      const { statusCode, body } = await run();
      expect(statusCode).toBe(200); // V2 contract: failure is a 200 envelope
      expect(baseHits.length - previousHandlerHits).toBe(1);
      expect(body.analysis_status).toBe('failed');
      expect(critiqueCodes(body)).toContain('ISL_CALL_FAILED');
    } finally {
      nonRetryable400 = false;
      rejectionsRemaining = original;
    }
  }, 30_000);

  it('⭐ RED-FIRST — 429 then 200 under ample budget: TWO attempts and a SUCCESS envelope', async () => {
    rejectionsRemaining = 1;
    const t0 = Date.now();
    const { statusCode, body } = await run();
    const elapsed = Date.now() - t0;

    // The behaviour the tester feels: the analysis completes.
    expect(statusCode).toBe(200);
    expect(body.analysis_status).not.toBe('failed');
    expect(critiqueCodes(body)).not.toContain('ISL_CALL_FAILED');
    expect(JSON.stringify(body)).not.toContain('HTTP 429');

    // The mechanism: exactly two attempts on the wire, one backoff apart.
    // PRE-FIX this was ONE hit and a typed-failure envelope naming HTTP 429.
    expect(baseHits).toHaveLength(2);
    const gapMs = baseHits[1] - baseHits[0];
    expect(gapMs).toBeGreaterThanOrEqual(900); // the 1s exponential backoff
    expect(gapMs).toBeLessThan(4_000);

    // ~69.8s of budget remained after a 133ms reject in production; here the
    // whole recovery costs about one backoff.
    expect(elapsed).toBeLessThan(20_000);
  }, 40_000);

  it('recovers from TWO consecutive 429s (1s then 2s backoff) — still inside budget', async () => {
    rejectionsRemaining = 2;
    const { statusCode, body } = await run();
    expect(statusCode).toBe(200);
    expect(body.analysis_status).not.toBe('failed');
    expect(baseHits).toHaveLength(3);
    expect(baseHits[1] - baseHits[0]).toBeGreaterThanOrEqual(900); // 1s
    expect(baseHits[2] - baseHits[1]).toBeGreaterThanOrEqual(1_900); // 2s
  }, 40_000);

  it('⭐ BUDGET EXHAUSTION still yields the typed failure — bounded, no infinite retry', async () => {
    // A budget too small to fit another attempt must terminate with exactly the
    // pre-existing typed-failure envelope. This is the arm that proves the fix
    // did not trade a 500 for a hang.
    process.env.REQUEST_BUDGET_MS = '1500';
    rejectionsRemaining = 99; // ISL never recovers
    const t0 = Date.now();
    const { statusCode, body } = await run();
    const elapsed = Date.now() - t0;

    expect(statusCode).toBe(200); // V2 contract: failed = 200 envelope
    expect(body.analysis_status).toBe('failed');
    expect(critiqueCodes(body)).toContain('ISL_CALL_FAILED');
    expect(String(body.status_reason ?? '')).toContain('429');
    expect(body.retryable).toBe(true);

    // Bounded: it did not burn the attempt cap, and it did not hang.
    expect(baseHits.length).toBeLessThanOrEqual(2);
    expect(elapsed).toBeLessThan(15_000);
  }, 40_000);

  it('a persistent 429 under the FULL budget stops at the configured attempt cap (3), never loops', async () => {
    rejectionsRemaining = 99;
    const { statusCode, body } = await run();
    expect(statusCode).toBe(200);
    expect(body.analysis_status).toBe('failed');
    // The cap is still a hard upper bound on top of the budget bound.
    expect(baseHits.length).toBeLessThanOrEqual(3);
    expect(baseHits.length).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
