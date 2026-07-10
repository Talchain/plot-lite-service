/**
 * Typed failure envelope for /v2/run — "generic analysis-failure UX beyond
 * the density codes" (ROADMAP §B session-robustness, fragility pair 2026-07-10).
 *
 * Pins the four confirmed gaps from FRAGILITY-PAIR-FINDINGS-2026-07-10.md:
 *
 *  GAP 2 — every ISL infrastructure failure collapsed to the single code
 *          ISL_CALL_FAILED: the discriminating codes (ISL_TIMEOUT /
 *          ISL_NETWORK_ERROR / ISL_ERROR) were computed in
 *          integrations/isl/index.ts then discarded by run.ts. The caller
 *          could not distinguish "analysis service down, retry" from
 *          "request rejected, don't retry".
 *  GAP 3 — ISL's structured 422 critiques were lost: callAnalysisEndpoint
 *          swallows ISLHttpError, so the route's is422() passthrough was
 *          dead code and ISL validation detail flattened into GAP 2.
 *  GAP 1 — an unexpected internal throw returned HTTP 200,
 *          analysis_status:'failed' with an EMPTY critiques[] — the most
 *          severe failure class carried the least structure.
 *  GAP 6 — the unknown-top-level-key 400 was the only /v2/run error emitted
 *          in the bare Fastify shape (no `schema`, no stable `code`) —
 *          every other lifecycle error uses the error.v1 envelope.
 *
 * Back-compat pins in the same file: the legacy ISL_CALL_FAILED critique
 * stays present on infrastructure failures (dashboards/consumers key on it),
 * and the happy path is byte-shape-unchanged.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Switchable ISL mock — each test sets `islBehaviour` before injecting.
// ---------------------------------------------------------------------------
type IslBehaviour =
  | { kind: 'computed' }
  | { kind: 'error'; error: { code: string; message: string; retryable: boolean; status?: number; critiques?: Array<{ code: string; severity: string; message: string }> } }
  | { kind: 'malformed-data' };

let islBehaviour: IslBehaviour = { kind: 'computed' };

const mockISLService = {
  isEnabled: () => true,
  async callAnalysisEndpoint<T>(): Promise<any> {
    if (islBehaviour.kind === 'error') {
      return { data: null, error: islBehaviour.error, latency_ms: 5, isl_echoed_request_id: null };
    }
    if (islBehaviour.kind === 'malformed-data') {
      // ISL "succeeds" but the payload detonates downstream processing —
      // drives the route's outermost catch (GAP 1). A Proxy that throws on
      // any property access is the most reliable detonator.
      const bomb = new Proxy({}, {
        get(_t, prop) {
          if (prop === 'analysis_status') return 'computed';
          if (prop === 'then') return undefined; // not a thenable
          throw new Error(`synthetic downstream explosion reading ${String(prop)}`);
        },
      });
      return { data: bomb as T, latency_ms: 5, isl_echoed_request_id: null };
    }
    return { data: makeComputedIslResponse() as T, latency_ms: 5, isl_echoed_request_id: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';
import { makeValidRunBody, makeComputedIslResponse } from './helpers/run-fixtures.js';

// Minimal valid request (2 options — schema minimum), shared fixture
const validBody = makeValidRunBody;

function critiqueCodes(body: any): string[] {
  return (body.critiques ?? []).map((c: any) => c.code);
}

describe('/v2/run typed failure envelope', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Back-compat pin: happy path unchanged
  // -------------------------------------------------------------------------
  it('happy path: computed run returns 200 computed (regression pin)', async () => {
    islBehaviour = { kind: 'computed' };
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload: validBody() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.analysis_status).toBe('computed');
  });

  // -------------------------------------------------------------------------
  // GAP 2 — ISL infrastructure failures carry their discriminating code
  // -------------------------------------------------------------------------
  it('ISL timeout: failed response carries ISL_TIMEOUT critique, honest status_reason, retryable', async () => {
    islBehaviour = { kind: 'error', error: { code: 'ISL_TIMEOUT', message: 'ISL request to /api/v1/robustness/analyze/v2 timed out after 30000ms', retryable: true } };
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload: validBody() });
    expect(res.statusCode).toBe(200); // V2 contract: failed = 200
    const body = res.json();
    expect(body.analysis_status).toBe('failed');
    expect(critiqueCodes(body)).toContain('ISL_TIMEOUT');
    expect(critiqueCodes(body)).toContain('ISL_CALL_FAILED'); // legacy pin
    expect(body.status_reason.toLowerCase()).toContain('timed out');
    expect(body.retryable).toBe(true);
    const specific = body.critiques.find((c: any) => c.code === 'ISL_TIMEOUT');
    expect(specific.user_message).toBeTruthy();
    expect(specific.source).toBe('isl');
    // Review [17]: raw ISL error detail (endpoint paths, timeout config)
    // stays in the logs — the wire carries the class-safe copy only.
    expect(specific.message).not.toContain('/api/');
    expect(specific.message).not.toContain('30000ms');
  });

  it('ISL unreachable: failed response carries ISL_NETWORK_ERROR critique + honest status_reason', async () => {
    islBehaviour = { kind: 'error', error: { code: 'ISL_NETWORK_ERROR', message: 'connect ECONNREFUSED', retryable: true } };
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload: validBody() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.analysis_status).toBe('failed');
    expect(critiqueCodes(body)).toContain('ISL_NETWORK_ERROR');
    expect(critiqueCodes(body)).toContain('ISL_CALL_FAILED');
    expect(body.status_reason.toLowerCase()).toContain('unreachable');
    expect(body.retryable).toBe(true);
    expect(body.critiques.find((c: any) => c.code === 'ISL_NETWORK_ERROR').user_message).toBeTruthy();
  });

  it('ISL HTTP 5xx: failed response keeps ISL_ERROR discriminator and status-derived retryable', async () => {
    islBehaviour = { kind: 'error', error: { code: 'ISL_ERROR', message: 'ISL request failed with status 503', retryable: true, status: 503 } };
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload: validBody() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.analysis_status).toBe('failed');
    expect(critiqueCodes(body)).toContain('ISL_ERROR');
    expect(critiqueCodes(body)).toContain('ISL_CALL_FAILED');
    expect(body.retryable).toBe(true);
  });

  // -------------------------------------------------------------------------
  // GAP 3 — ISL structured 422 passthrough revived
  // -------------------------------------------------------------------------
  it('ISL 422 with structured critiques: 422 blocked with the ISL critiques mapped through', async () => {
    islBehaviour = {
      kind: 'error',
      error: {
        code: 'ISL_REJECTED',
        message: 'Causal effect not identifiable from this structure',
        retryable: false,
        status: 422,
        critiques: [
          { code: 'ISL_CANNOT_IDENTIFY', severity: 'blocker', message: 'Effect of factor-0 on goal is not identifiable' },
        ],
      },
    };
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload: validBody() });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.analysis_status).toBe('blocked');
    expect(critiqueCodes(body)).toContain('ISL_CANNOT_IDENTIFY');
    // Review [0]: ISL blockers order FIRST — CEE plot-client renders
    // critiques[0].message, which must never be a co-occurring info warning.
    expect(body.critiques[0].code).toBe('ISL_CANNOT_IDENTIFY');
    expect(body.retryable).toBe(false);
    expect(body.status_reason).toContain('identifiable');
  });

  it('ISL 422 WITHOUT parseable critiques: stays a failed response with the ISL_REJECTED discriminator (never blocked-with-empty-critiques)', async () => {
    islBehaviour = { kind: 'error', error: { code: 'ISL_REJECTED', message: 'ISL validation failed', retryable: false, status: 422 } };
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload: validBody() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.analysis_status).toBe('failed');
    expect(critiqueCodes(body)).toContain('ISL_REJECTED');
    expect(body.retryable).toBe(false);
  });

  // -------------------------------------------------------------------------
  // GAP 1 — internal exception carries a typed critique
  // -------------------------------------------------------------------------
  it('internal PLoT exception: failed response carries PLOT_INTERNAL_ERROR critique (never an empty critiques[])', async () => {
    islBehaviour = { kind: 'malformed-data' };
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload: validBody() });
    expect(res.statusCode).toBe(200); // outermost net: error.v1 must never leak
    const body = res.json();
    expect(body.analysis_status).toBe('failed');
    expect(critiqueCodes(body)).toContain('PLOT_INTERNAL_ERROR');
    const internal = body.critiques.find((c: any) => c.code === 'PLOT_INTERNAL_ERROR');
    expect(internal.user_message).toBeTruthy();
    // Internal wording must not leak the raw exception into user_message
    expect(internal.user_message).not.toContain('synthetic downstream explosion');
    expect(body.meta.request_id).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // GAP 6 — unknown-field 400 joins the error.v1 envelope
  // -------------------------------------------------------------------------
  it('unknown top-level field: 400 in the error.v1 envelope with code BAD_INPUT (message text preserved)', async () => {
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload: validBody({ bogus_key: 1 }) });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.schema).toBe('error.v1');
    expect(body.code).toBe('BAD_INPUT');
    expect(body.message).toContain('Unknown field: bogus_key');
    expect(body.retryable).toBe(false);
  });
});
