/**
 * ROADMAP 2.510 — the downstream-call tracker must not lose records silently.
 *
 * THE DEFECT (measured at `e18e17c2`, the deployed tip). Tracking is initialised
 * in the `onRequest` hook under Fastify's `req.id`. `onRequest` runs BEFORE body
 * parsing, so it cannot see `body.request_id`. `/v2/run` then resolves the real
 * id (`trimmed X-Request-Id` → `body.request_id` → `req.id`) and used to mutate
 * `req.id` itself. Two sites therefore decided independently what "the request
 * id" was, and `recordDownstreamCall` — finding no entry under the resolved id —
 * threw every record away without a word.
 *
 * ⚠ THE ORIGINAL DIAGNOSIS NAMED THE WRONG TRIGGER. It reported the tracker dead
 * "whenever the caller supplies an X-Request-Id header". Measured, a CLEAN header
 * is the case that WORKS: Fastify's `req.id` is that same header, so the two
 * sites agree. The branches that actually lost records are pinned below —
 * `body.request_id` with no header (the CEE→PLoT shape) and a whitespace-padded
 * header (Fastify keys on the RAW header, the route on the trimmed one).
 *
 * WHY THE FAIL-LOUD HALF MATTERS MORE THAN THE KEYING FIX. The keying fix cures
 * today's disagreement. The fail-loud half ensures the next one is visible the
 * day it lands: "no downstream calls happened" and "calls happened and I lost
 * them" must never render identically again, because a reader cannot tell a
 * silent instrument from a quiet one — which is precisely how this sat unseen.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { createServer } from '../src/createServer.js';
import { __setIslComputeAdmissionForTest } from '../src/integrations/isl/compute-admission.js';
import {
  initDownstreamTracking,
  recordDownstreamCall,
  clearDownstreamTracking,
  getDownstreamCalls,
  getOrphanedDownstreamCallCount,
  adoptResolvedRequestId,
  type DownstreamCall,
} from '../src/util/downstream-tracker.js';

const ISL_HOST = 'https://isl-2510.test.local';
const ANALYSIS_ENDPOINT = '/api/v1/robustness/analyze/v2';

// ---------------------------------------------------------------------------
// Real route harness: real createServer, real ISLClient, stubbed transport.
// The ISL SERVICE is deliberately NOT mocked — mocking it bypasses ISLClient,
// which is the only thing that calls recordDownstreamCall, and every assertion
// below would then be vacuous.
// ---------------------------------------------------------------------------

const REQUEST_BODY = {
  graph: {
    nodes: [
      { id: 'fac_cost', kind: 'factor', label: 'Cost', observed_state: { value: 0.86, baseline: 0.86, unit: 'GBP', raw_value: 275000, cap: 320000 } },
      { id: 'fac_demand', kind: 'factor', label: 'Demand', observed_state: { value: 0.4, baseline: 0.4, unit: 'GBP', raw_value: 40, cap: 100 } },
      { id: 'outcome', kind: 'goal', label: 'Net Position' },
    ],
    edges: [
      { from: 'fac_cost', to: 'outcome', exists_probability: 0.95, strength: { mean: -0.7, std: 0.1 } },
      { from: 'fac_demand', to: 'outcome', exists_probability: 0.9, strength: { mean: 0.6, std: 0.1 } },
    ],
  },
  options: [
    { id: 'opt_a', label: 'A', interventions: { fac_demand: { value: 0.2, source: 'user_specified' } } },
    { id: 'opt_b', label: 'B', interventions: { fac_demand: { value: 0.8, source: 'user_specified' } } },
  ],
  goal_node_id: 'outcome',
};

/** Every X-Request-Id PLoT actually put on the wire to ISL, in order. */
let islWireRequestIds: string[] = [];

function seedAdmission(): void {
  __setIslComputeAdmissionForTest({
    status: 'ok',
    skew: false,
    admission: {
      max_cost_units: 24_000_000,
      complexity_formula_version: 'v2-weighted-2026-07',
      weights: {
        base_per_sample_per_option_per_struct: 1, evpi_sample_cap: 2000,
        sensitivity_coef: 4, evalue_coef: 20, bands_coef: 200,
        path_coef: 1, max_decomposition_paths: 20000,
      },
      caps: { max_options: 10, max_nodes: 50, max_edges: 200, max_parameter_uncertainties: 50 },
    },
  } as never);
}

describe('2.510 · /v2/run downstream tracking survives request-id resolution', () => {
  let app: FastifyInstance;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    process.env.ISL_ENABLE = '1';
    process.env.ISL_BASE_URL = ISL_HOST;
    process.env.ISL_API_KEY = 'test-2510-key';
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';

    globalThis.fetch = (async (url: unknown, init?: { body?: string; headers?: Record<string, string> }) => {
      if (String(url).includes('isl-2510.test.local')) {
        islWireRequestIds.push(String(init?.headers?.['X-Request-Id'] ?? ''));
        let parsed: { options?: Array<{ id?: string; option_id?: string }> } = {};
        try { parsed = JSON.parse(init?.body ?? '{}'); } catch { /* ignore */ }
        const envelope = {
          options: (parsed.options ?? []).map((opt, idx) => ({
            option_id: opt.option_id ?? opt.id, label: 'x',
            win_probability: idx === 0 ? 0.72 : 0.28,
            outcome: { mean: 0.7 - idx * 0.2, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
            rank: idx + 1,
          })),
          edges: [], factor_sensitivity: [], conditional_winners: [],
          overall_robustness: 'robust', robustness_score: 0.8,
          fragile_edges: [], robust_edges: [],
        };
        return new Response(JSON.stringify(envelope), {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-request-id': 'isl-echo' },
        });
      }
      return (originalFetch as typeof fetch)(url as string, init as RequestInit);
    }) as unknown as typeof fetch;

    app = await createServer();
    await app.ready();
    seedAdmission();
  }, 60_000);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await app?.close();
    delete process.env.ISL_ENABLE;
    delete process.env.ISL_BASE_URL;
    delete process.env.ISL_API_KEY;
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  beforeEach(() => {
    islWireRequestIds = [];
    seedAdmission();
  });

  async function run(headers: Record<string, string>, extraBody: Record<string, unknown>) {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'content-type': 'application/json', ...headers },
      payload: { ...REQUEST_BODY, ...extraBody },
    });
    const parsed = JSON.parse(res.body) as {
      downstream_calls?: { isl?: Array<{ endpoint: string; request_id: string; status: number }> };
    };
    return {
      status: res.statusCode,
      islCalls: parsed.downstream_calls?.isl ?? [],
      lostHeader: res.headers['x-olumi-downstream-lost'],
      callsHeader: res.headers['x-olumi-downstream-calls'],
    };
  }

  // ── The RED-first branch: body.request_id with no header (the CEE→PLoT shape)

  it('RED-first · records the ISL call when the id comes from body.request_id and NO header', async () => {
    const bodyId = 'req-2510-from-body';
    const out = await run({}, { request_id: bodyId });

    expect(out.status).toBe(200);
    // ANTI-VACUITY: there was genuinely something to capture. Without this, an
    // empty captured list could mean "ISL was never called" and the assertion
    // below would be testing nothing — the exact defect this row fixes.
    expect(islWireRequestIds).toContain(bodyId);

    // IDENTITY binding (trap 19): the specific analysis call, found by endpoint
    // AND by the resolved request id — never by a count or a value predicate
    // another downstream call could satisfy.
    const analysis = out.islCalls.find(
      (c) => c.endpoint === ANALYSIS_ENDPOINT && c.request_id === bodyId,
    );
    expect(analysis).toBeDefined();
    expect(analysis!.status).toBe(200);
    expect(out.lostHeader).toBeUndefined();
  }, 60_000);

  // ── The RED-first branch: whitespace-padded header
  // Fastify keys req.id on the RAW header; the route trims. They disagreed.

  it('RED-first · records the ISL call when X-Request-Id is whitespace-padded', async () => {
    const padded = '  req-2510-padded  ';
    const trimmed = 'req-2510-padded';
    const out = await run({ 'x-request-id': padded }, {});

    expect(out.status).toBe(200);
    expect(islWireRequestIds).toContain(trimmed); // anti-vacuity

    const analysis = out.islCalls.find(
      (c) => c.endpoint === ANALYSIS_ENDPOINT && c.request_id === trimmed,
    );
    expect(analysis).toBeDefined();
    expect(out.lostHeader).toBeUndefined();
  }, 60_000);

  // ── The branch that was ALREADY fine. Pinned so the fix cannot break it.

  it('the clean X-Request-Id branch (already working pre-fix) still records', async () => {
    const headerId = 'req-2510-clean-header';
    const out = await run({ 'x-request-id': headerId }, {});

    expect(out.status).toBe(200);
    expect(islWireRequestIds).toContain(headerId); // anti-vacuity

    const analysis = out.islCalls.find(
      (c) => c.endpoint === ANALYSIS_ENDPOINT && c.request_id === headerId,
    );
    expect(analysis).toBeDefined();
    expect(out.lostHeader).toBeUndefined();
  }, 60_000);

  it('the no-id-at-all branch (already working pre-fix) still records', async () => {
    const out = await run({}, {});

    expect(out.status).toBe(200);
    expect(islWireRequestIds.length).toBeGreaterThan(0); // anti-vacuity

    const analysis = out.islCalls.find((c) => c.endpoint === ANALYSIS_ENDPOINT);
    expect(analysis).toBeDefined();
    // Bind by identity to the id that actually went on the wire.
    expect(analysis!.request_id).toBe(islWireRequestIds[0]);
    expect(out.lostHeader).toBeUndefined();
  }, 60_000);

  // ── THE POSITIVE CONTROL FOR THE HARNESS ITSELF.
  //
  // Every assertion above claims "the record was captured". None of them can
  // prove the harness would NOTICE a loss — and a harness blind to loss is the
  // very defect under repair. This drives a genuinely unattributable record
  // through the SAME response path and requires the loss to surface on the wire.
  // If this test cannot go green, the four above are not evidence of anything.

  it('POSITIVE CONTROL · the harness can SEE a loss: an unattributable record surfaces on the response', async () => {
    const headerId = 'req-2510-forced-loss';

    // A record arriving for an id with no initialised scope — exactly the
    // pre-fix condition, forced deliberately.
    recordDownstreamCall({
      service: 'isl',
      endpoint: '/api/v1/forced-orphan',
      status: 200,
      elapsedMs: 5,
      payloadHash: 'aaaaaaaaaaaa',
      requestId: headerId,
    });
    expect(getOrphanedDownstreamCallCount(headerId)).toBe(1);

    const out = await run({ 'x-request-id': headerId }, {});

    expect(out.status).toBe(200);
    // THE POINT: the response distinguishes "lost" from "none". Pre-2.510 this
    // header did not exist and the loss was indistinguishable from silence.
    expect(out.lostHeader).toBe('1');
    // And the real call on the same request was still captured, so a loss does
    // not blind the tracker to everything else.
    expect(out.islCalls.some((c) => c.endpoint === ANALYSIS_ENDPOINT)).toBe(true);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Tracker unit level: the fail-loud mechanism, and the re-key that replaced the
// two-site disagreement.
// ---------------------------------------------------------------------------

describe('2.510 · recordDownstreamCall fails loud instead of dropping silently', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  function call(requestId: string, endpoint = '/api/v1/robustness/analyze/v2'): DownstreamCall {
    return { service: 'isl', endpoint, status: 200, elapsedMs: 7, payloadHash: 'bbbbbbbbbbbb', requestId };
  }

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  it('an unkeyed record is retained, counted, and alarmed — never silently ignored', () => {
    const id = 'unit-2510-never-initialised';
    clearDownstreamTracking(id);

    recordDownstreamCall(call(id));

    expect(getOrphanedDownstreamCallCount(id)).toBe(1);
    const alarms = errSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((line) => line.includes('downstream_tracker.unkeyed_record'));
    expect(alarms).toHaveLength(1);
    // The alarm must name the id it failed on, or it cannot be acted upon.
    expect(alarms[0]).toContain(id);
    clearDownstreamTracking(id);
  });

  it('CONTROL · the alarm is NOT stuck on: a properly keyed record is silent and counts zero loss', () => {
    // Without this, the test above would pass on an implementation that alarmed
    // on every single record — a fail-loud mechanism that cries constantly is
    // just a broken alarm wearing the other mask.
    const id = 'unit-2510-properly-keyed';
    initDownstreamTracking(id);

    recordDownstreamCall(call(id));

    expect(getDownstreamCalls(id)).toHaveLength(1);
    expect(getOrphanedDownstreamCallCount(id)).toBe(0);
    expect(
      errSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('downstream_tracker.unkeyed_record')),
    ).toHaveLength(0);
    clearDownstreamTracking(id);
  });

  it('clearing a request clears its loss ledger, so a later request cannot inherit it', () => {
    const id = 'unit-2510-ledger-reset';
    recordDownstreamCall(call(id));
    expect(getOrphanedDownstreamCallCount(id)).toBe(1);

    clearDownstreamTracking(id);
    expect(getOrphanedDownstreamCallCount(id)).toBe(0);
  });
});

describe('2.510 · adoptResolvedRequestId keeps the store and req.id in one operation', () => {
  it('a record under the RESOLVED id lands after adoption', () => {
    const original = 'unit-2510-original';
    const resolved = 'unit-2510-resolved';
    const req = { id: original as unknown };
    initDownstreamTracking(original);

    adoptResolvedRequestId(req, resolved);

    // The mutation the route relies on still happens...
    expect(String(req.id)).toBe(resolved);
    // ...and the store moved with it, which is the whole point.
    recordDownstreamCall({
      service: 'isl', endpoint: '/api/v1/robustness/analyze/v2', status: 200,
      elapsedMs: 3, payloadHash: 'cccccccccccc', requestId: resolved,
    });
    const landed = getDownstreamCalls(resolved);
    expect(landed).toHaveLength(1);
    expect(landed[0].requestId).toBe(resolved);
    expect(getOrphanedDownstreamCallCount(resolved)).toBe(0);

    clearDownstreamTracking(resolved);
  });

  it('adoption is a no-op when the id did not change', () => {
    const id = 'unit-2510-unchanged';
    const req = { id: id as unknown };
    initDownstreamTracking(id);

    adoptResolvedRequestId(req, id);

    expect(String(req.id)).toBe(id);
    recordDownstreamCall({
      service: 'isl', endpoint: '/api/v1/robustness/analyze/v2', status: 200,
      elapsedMs: 3, payloadHash: 'dddddddddddd', requestId: id,
    });
    expect(getDownstreamCalls(id)).toHaveLength(1);
    expect(getOrphanedDownstreamCallCount(id)).toBe(0);
    clearDownstreamTracking(id);
  });
});
