/**
 * ⭐⭐ ROADMAP 2.202 fix ①b — THE PIN AT THE DEPLOYED STAGING SHAPE.
 *
 * This is the test-time analogue of the live regime that fix ①'s guard could not
 * see. Fix ① merged with 6,409 green tests and 11/11 green CI, deployed as build
 * `91bcac5`, and then rescued **0 of 9** contended requests: `isl_retry_scheduled`
 * never fired once in the build's whole life, while `isl_retry_declined` returned
 * 35 rows on the identical Render query (so the zero was a real absence).
 *
 *   PROBE OF RECORD: PHASE0-EVIDENCE-2026-07-28/probe-2202-retry-under-contention.md
 *
 * WHY THE EXISTING ROUTE PINS COULD NOT CATCH IT. They run at the repo defaults —
 * `ISL_TIMEOUT_MS = 60_000`, `REQUEST_BUDGET_MS = 70_000` — where fix ① works.
 * Staging's Render DASHBOARD sets `ISL_TIMEOUT_MS = 130_000` and omits
 * `REQUEST_BUDGET_MS`. At that posture /v2/run's base-call clamp takes its second
 * arm and hands the client a per-attempt timeout of `remaining − 1_000`, so the
 * pre-①b gate `Retry-After + perAttempt + margin <= remaining` reduces to
 * `Retry-After <= 0` and no positive hint can ever fit. Platform trap 18: env
 * posture comes from the Render API or a live witness, never from `render.yaml`
 * or from `process.env` at test time.
 *
 * SO THIS FILE SETS THAT POSTURE EXPLICITLY, BEFORE the modules that read it are
 * loaded (`ISL_TIMEOUT_MS` is a module-level `const` in config/timeouts.ts, so a
 * static import would freeze the default before `beforeAll` ever runs — hence the
 * dynamic import below). The values are a DATED MEASUREMENT, not a re-derivation:
 * `GET /v1/services/srv-d4sl44s9c44c73ep4ak0/env-vars`, 2026-07-31, 49 keys.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';

const BASE_ROBUSTNESS_PATH = '/api/v1/robustness/analyze/v2';

/** Render dashboard value, measured 2026-07-31. The repo default is 60_000. */
const STAGING_ISL_TIMEOUT_MS = '130000';
/** Probe-measured fast-reject latency band was 349–891 ms. */
const REJECT_DELAY_MS = 350;
/** ISL compute_governor `RETRY_AFTER_SECONDS = 5`. */
const RETRY_AFTER_HEADER = '5';

const ISL_OK = {
  options: [
    { option_id: 'opt1', outcome: { mean: 0.8, std: 0.1, p10: 0.6, p50: 0.8, p90: 0.95, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 }, rank: 1, win_probability: 0.7, probability_of_goal: 0.65 },
    { option_id: 'opt2', outcome: { mean: 0.7, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 }, rank: 2, win_probability: 0.3, probability_of_goal: 0.55 },
  ],
  factor_sensitivity: [],
  robustness: { score: 0.82, label: 'robust', fragile_edges: [], robust_edges: [], edge_e_values: [] },
};

/** Single factor / two options — below the flip-probe trigger, so the only ISL
 *  traffic is the BASE call (the one the staging regime disabled). */
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
let rejectionsRemaining = 0;
let baseHits: number[] = [];

describe('⭐ 2.202 ①b — at the DEPLOYED staging shape the 429 retry finally fires', () => {
  let app: FastifyInstance;
  let previousIslTimeout: string | undefined;
  let previousIslRequestTimeout: string | undefined;

  beforeAll(async () => {
    islServer = createHttpServer((req, res) => {
      const path = (req.url ?? '').split('?')[0];
      req.resume();
      req.on('end', () => {
        if (path === BASE_ROBUSTNESS_PATH) {
          baseHits.push(Date.now());
          if (rejectionsRemaining > 0) {
            rejectionsRemaining--;
            // A FAST reject after ~350 ms, carrying ISL's real governor body and
            // its `Retry-After: 5` — the exact shape measured on the wire.
            setTimeout(() => {
              res.writeHead(429, {
                'Content-Type': 'application/json',
                'Retry-After': RETRY_AFTER_HEADER,
              });
              res.end(JSON.stringify({
                code: 'RATE_LIMIT_EXCEEDED',
                message: 'Too many concurrent analyses from this caller. Retry shortly.',
                reason: 'caller_concurrency_exceeded',
                retryable: true,
                source: 'isl',
              }));
            }, REJECT_DELAY_MS);
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(ISL_OK));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({}));
      });
    });
    await new Promise<void>((resolve) => islServer.listen(0, '127.0.0.1', () => resolve()));
    islPort = (islServer.address() as AddressInfo).port;

    previousIslTimeout = process.env.ISL_TIMEOUT_MS;
    previousIslRequestTimeout = process.env.ISL_REQUEST_TIMEOUT_MS;
    // ⭐ THE STAGING POSTURE. Set BEFORE the dynamic import below, because
    // config/timeouts.ts freezes ISL_TIMEOUT_MS at module evaluation.
    process.env.ISL_TIMEOUT_MS = STAGING_ISL_TIMEOUT_MS;
    delete process.env.ISL_REQUEST_TIMEOUT_MS; // takes precedence if set
    delete process.env.REQUEST_BUDGET_MS; // ABSENT on staging → repo default 70s
    delete process.env.ISL_MAX_RETRIES; // absent on staging → default 3

    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.ISL_ENABLE = '1';
    process.env.ISL_BASE_URL = `http://127.0.0.1:${islPort}`;
    process.env.ISL_API_KEY = 'test-key';

    const { createServer } = await import('../src/createServer.js');
    const { ISL_TIMEOUT_MS } = await import('../src/config/timeouts.js');
    // Guard the harness itself: if the dynamic import did not observe the env,
    // every assertion below would silently run at the repo default and this file
    // would test the regime fix ① already handled. Fail loudly instead.
    expect(
      ISL_TIMEOUT_MS,
      'the staging posture did not reach config/timeouts.ts — this file would be vacuous',
    ).toBe(Number(STAGING_ISL_TIMEOUT_MS));

    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    islServer.closeAllConnections?.();
    await new Promise<void>((resolve) => islServer.close(() => resolve()));
    // Restore rather than blanket-delete: ISL_TIMEOUT_MS is process-wide and
    // other files in this worker read it at their own module load.
    if (previousIslTimeout === undefined) delete process.env.ISL_TIMEOUT_MS;
    else process.env.ISL_TIMEOUT_MS = previousIslTimeout;
    if (previousIslRequestTimeout === undefined) delete process.env.ISL_REQUEST_TIMEOUT_MS;
    else process.env.ISL_REQUEST_TIMEOUT_MS = previousIslRequestTimeout;
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
      payload: JSON.stringify({ graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: 's2202b' }),
    });
    return { statusCode: res.statusCode, body: JSON.parse(res.body) as any };
  }

  const critiqueCodes = (body: any): string[] => (body.critiques ?? []).map((c: any) => c.code);

  it('POSITIVE CONTROL — at the staging posture a clean run still succeeds in ONE hit', async () => {
    // Trap 13: prove the harness can produce a PASS at ISL_TIMEOUT_MS=130000
    // before any "the 429 is now rescued" claim is made against it.
    rejectionsRemaining = 0;
    const { statusCode, body } = await run();
    expect(statusCode).toBe(200);
    expect(baseHits).toHaveLength(1);
    expect(body.analysis_status).not.toBe('failed');
    expect(critiqueCodes(body)).not.toContain('ISL_CALL_FAILED');
  }, 60_000);

  it('⭐⭐ RED-FIRST AT THE STAGING SHAPE — a 350ms 429 with Retry-After: 5 IS rescued', async () => {
    // THIS IS THE ARM THAT WAS DEAD ON `91bcac5`. Pre-①b the live telemetry read
    //   {"event":"isl_retry_declined","reason":"budget_exhausted","attempt":1,
    //    "max_retries":3,"retry_after_ms":5000,"remaining_budget_ms":69874,
    //    "projected_cost_ms":73974}
    // on 9 of 9 contended requests, and the tester got the 500.
    rejectionsRemaining = 1;
    const t0 = Date.now();
    const { statusCode, body } = await run();
    const elapsed = Date.now() - t0;

    // What the tester feels: the analysis completes.
    expect(statusCode).toBe(200);
    expect(body.analysis_status).not.toBe('failed');
    expect(critiqueCodes(body)).not.toContain('ISL_CALL_FAILED');
    expect(JSON.stringify(body)).not.toContain('HTTP 429');

    // The mechanism: a SECOND attempt reached ISL. Pre-①b this was exactly one.
    expect(baseHits).toHaveLength(2);

    // …and it waited the governor's own 5s hint, not our 1s backoff — proving
    // the delay that made the pre-①b projection impossible was actually paid.
    const gapMs = baseHits[1] - baseHits[0];
    expect(gapMs).toBeGreaterThanOrEqual(4_900);
    expect(gapMs).toBeLessThan(12_000);
    expect(elapsed).toBeLessThan(45_000);
  }, 90_000);

  it('⭐ a genuinely-exhausted budget still declines at the staging shape — no infinite retry', async () => {
    // The floor must still bite when the budget really is spent: 1.5s of budget
    // cannot pay a 5s Retry-After, whatever the clamp affords afterwards.
    process.env.REQUEST_BUDGET_MS = '1500';
    rejectionsRemaining = 99;
    const t0 = Date.now();
    const { statusCode, body } = await run();
    const elapsed = Date.now() - t0;

    expect(statusCode).toBe(200); // V2 contract: a failure is a 200 envelope
    expect(body.analysis_status).toBe('failed');
    expect(critiqueCodes(body)).toContain('ISL_CALL_FAILED');
    expect(String(body.status_reason ?? '')).toContain('429');
    expect(baseHits.length).toBeLessThanOrEqual(2);
    expect(elapsed).toBeLessThan(20_000);
  }, 60_000);
});
