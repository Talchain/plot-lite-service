/**
 * Diligence-grade evidence provenance for /v2/run (ROADMAP 2.13 completion).
 *
 * The 2.13 sweep (2026-07-10) found the row largely landed (Lane PLoT-R3:
 * _meta.evidence digests, request-id chain, downstream capture). These tests
 * pin the four REMAINING gaps:
 *
 *  GAP A — no deterministic response-CONTENT hash exists in the body. The
 *          field named `response_hash` hashes the canonicalised REQUEST
 *          (by design — determinism token; UI freshness keys on it and it
 *          must NOT change). The only true body hash is the
 *          x-olumi-response-hash header: header-only, and non-reproducible
 *          across runs (covers latency/timestamps).
 *          → additive `_meta.response_content_hash` ("rch_v2:<sha256-16>")
 *            over the public semantic surface minus the volatile set.
 *  GAP B — "zero hash mismatches" was never ASSERTED anywhere: nothing
 *          compared header-vs-body or recorded-digest-vs-actual-bytes.
 *          → within-run consistency assertions live here.
 *  GAP C — CEE downstream calls carry no byte digests (ISL-only today):
 *          cee/client.ts never computed request/response PayloadDigests.
 *  GAP D — request-id chain is PLoT→ISL only; no PLoT→CEE leg. Additive
 *          cee/cee_echoed fields; all_match/chain_complete semantics are
 *          PINNED UNCHANGED (computed over the original ISL four).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Switchable ISL mock — deterministic; `state.meanA` varies semantic content.
// vi.hoisted: this file also imports run.js directly (buildRequestIdChain),
// so the mock factory can fire before module-body consts initialise.
// ---------------------------------------------------------------------------
const islMock = vi.hoisted(() => {
  const state = { meanA: 0.7 };

  function computedIslResponse() {
    const meanA = state.meanA;
    return {
      analysis_status: 'computed',
      seed_used: 42,
      options: [
        {
          option_id: 'opt-a',
          outcome: { mean: meanA, std: 0.05, p10: meanA - 0.1, p50: meanA, p90: meanA + 0.1, n_samples: 100, n_valid_samples: 100, validity_ratio: 1.0 },
          win_probability: 0.7,
          status: 'computed',
        },
        {
          option_id: 'opt-b',
          outcome: { mean: 0.4, std: 0.05, p10: 0.3, p50: 0.4, p90: 0.5, n_samples: 100, n_valid_samples: 100, validity_ratio: 1.0 },
          win_probability: 0.3,
          status: 'computed',
        },
      ],
      factor_sensitivity: [],
      robustness: { confidence: 0.8, level: 'high', is_robust: true, fragile_edges: [], robust_edges: [] },
      inference_warnings: [],
    };
  }

  const mockISLService = {
    isEnabled: () => true,
    async callAnalysisEndpoint<T>(): Promise<any> {
      return { data: computedIslResponse() as T, latency_ms: 5, isl_echoed_request_id: null };
    },
  };

  return { state, mockISLService };
});

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => islMock.mockISLService, islService: islMock.mockISLService };
});

import { createServer } from '../src/createServer.js';
import { computeOlumiHash } from '../src/util/canonical.js';
import {
  computeResponseContentHash,
  RESPONSE_CONTENT_HASH_VERSION,
} from '../src/util/response-content-hash.js';
import { buildRequestIdChain } from '../src/routes/v2/run.js';
import { callCEEWithSchemaV2 } from '../src/cee/client.js';
import { getDownstreamCalls, clearDownstreamTracking, initDownstreamTracking } from '../src/util/downstream-tracker.js';
import { makeValidRunBody } from './helpers/run-fixtures.js';
import { toPublicIslError } from '../src/integrations/isl/index.js';

const validBody = makeValidRunBody;

describe('/v2/run evidence provenance (2.13 completion)', () => {
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
  // GAP A — deterministic response-content hash
  // -------------------------------------------------------------------------
  it('success response carries _meta.response_content_hash (rch_v2:<16 hex>)', async () => {
    islMock.state.meanA = 0.7;
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload: validBody() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.analysis_status).toBe('computed');
    expect(body._meta.response_content_hash).toMatch(/^rch_v2:[0-9a-f]{16}$/);
  });

  it('identical request replayed → identical response_content_hash (determinism)', async () => {
    islMock.state.meanA = 0.7;
    const r1 = await app.inject({ method: 'POST', url: '/v2/run', payload: validBody() });
    const r2 = await app.inject({ method: 'POST', url: '/v2/run', payload: validBody() });
    const h1 = r1.json()._meta.response_content_hash;
    const h2 = r2.json()._meta.response_content_hash;
    expect(h1).toMatch(/^rch_v2:/);
    expect(h2).toBe(h1);
  });

  it('semantically different response → different response_content_hash', async () => {
    islMock.state.meanA = 0.7;
    const r1 = await app.inject({ method: 'POST', url: '/v2/run', payload: validBody() });
    islMock.state.meanA = 0.6;
    const r2 = await app.inject({ method: 'POST', url: '/v2/run', payload: validBody() });
    islMock.state.meanA = 0.7;
    expect(r2.json()._meta.response_content_hash).not.toBe(r1.json()._meta.response_content_hash);
  });

  it('response_content_hash is independently recomputable from the body (zero-mismatch)', async () => {
    islMock.state.meanA = 0.7;
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload: validBody() });
    const body = res.json();
    const claimed = body._meta.response_content_hash;
    const clone = JSON.parse(JSON.stringify(body));
    delete clone._meta.response_content_hash;
    expect(computeResponseContentHash(clone)).toBe(claimed);
    expect(claimed.startsWith(`${RESPONSE_CONTENT_HASH_VERSION}:`)).toBe(true);
  });

  it('response_hash (request-canonical determinism token) is UNCHANGED by the new field', async () => {
    islMock.state.meanA = 0.7;
    const r1 = await app.inject({ method: 'POST', url: '/v2/run', payload: validBody() });
    islMock.state.meanA = 0.6; // different response CONTENT, same request
    const r2 = await app.inject({ method: 'POST', url: '/v2/run', payload: validBody() });
    islMock.state.meanA = 0.7;
    // request-canonical: same request → same response_hash even when content differs
    expect(r2.json().meta.response_hash).toBe(r1.json().meta.response_hash);
  });

  // -------------------------------------------------------------------------
  // GAP B — within-run wire-integrity assertion (header vs body)
  // -------------------------------------------------------------------------
  it('x-olumi-response-hash header matches an independent recompute over the body', async () => {
    islMock.state.meanA = 0.7;
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload: validBody() });
    const headerHash = res.headers['x-olumi-response-hash'];
    expect(headerHash).toMatch(/^[0-9a-f]{12}$/);
    expect(computeOlumiHash(res.json())).toBe(headerHash);
  });

  // -------------------------------------------------------------------------
  // GAP D — request-id chain gains additive CEE legs; ISL-four semantics pinned
  // -------------------------------------------------------------------------
  it('buildRequestIdChain: cee legs are additive and informational (all_match over the ISL four only)', () => {
    const chain = buildRequestIdChain(true, 'req-1', true, 'req-1', true, 'other-id');
    expect(chain.cee).toBe('req-1');
    expect(chain.cee_echoed).toBe('other-id');
    // all_match/chain_complete pinned to the original four — a divergent CEE
    // echo must NOT break them (back-compat with the Brief 4 header spec).
    expect(chain.all_match).toBe(true);
    expect(chain.chain_complete).toBe(true);

    const noCee = buildRequestIdChain(true, 'req-1', true, 'req-1');
    expect(noCee.cee).toBeNull();
    expect(noCee.cee_echoed).toBeNull();
    expect(noCee.all_match).toBe(true);
  });

  it('success response chain carries cee:null when CEE is not called', async () => {
    islMock.state.meanA = 0.7;
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      payload: validBody(),
      headers: { 'x-request-id': 'chain-test-1' },
    });
    const chain = res.json().meta.request_id_chain;
    expect(chain.ui).toBe('chain-test-1');
    expect(chain.cee).toBeNull();
    expect(chain.cee_echoed).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GAP C — CEE downstream byte digests + echoed request id (client unit test)
// ---------------------------------------------------------------------------
describe('CEE client downstream digests (2.13 gap C)', () => {
  const REQUEST_ID = 'cee-digest-test-1';

  afterAll(() => {
    vi.unstubAllGlobals();
    clearDownstreamTracking(REQUEST_ID);
  });

  it('callCEEWithSchemaV2 records request/response PayloadDigests over exact bytes + echoed id', async () => {
    // recordDownstreamCall silently ignores un-initialised request ids —
    // mirror the request lifecycle's init.
    initDownstreamTracking(REQUEST_ID);
    const responseBody = { schema_version: 'v2', graph: { edges: [] }, ok: true };
    const responseText = JSON.stringify(responseBody);

    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(responseText, {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': REQUEST_ID },
      })
    ));

    const payload = { brief: 'digest test', nested: { a: 1 } };
    await callCEEWithSchemaV2(
      { baseUrl: 'https://cee.example.test', apiKey: 'k' },
      '/assist/v1/draft-graph',
      payload,
      REQUEST_ID,
    );

    const calls = getDownstreamCalls(REQUEST_ID).filter((c) => c.service === 'cee');
    expect(calls.length).toBeGreaterThan(0);
    const call = calls[0];

    const expectedReqSha = createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
    const expectedResSha = createHash('sha256').update(responseText, 'utf8').digest('hex');

    expect(call.requestDigest?.sha256).toBe(expectedReqSha);
    expect(call.requestDigest?.bytes).toBe(Buffer.byteLength(JSON.stringify(payload), 'utf8'));
    expect(call.requestDigest?.key_manifest).toEqual(['brief', 'nested']);
    expect(call.responseDigest?.sha256).toBe(expectedResSha);
    expect(call.responseDigest?.key_manifest).toEqual(['graph', 'ok', 'schema_version']);
    expect(call.echoedRequestId).toBe(REQUEST_ID);
  });
});

// ---------------------------------------------------------------------------
// rch_v2 determinism properties (review-hardening 2026-07-11: [12]/[15]/[18])
// ---------------------------------------------------------------------------
describe('computeResponseContentHash rch_v2 determinism', () => {
  it('duplicate natural keys (edge_sensitivity existence+magnitude rows) hash order-invariantly', () => {
    const rowA = { edge_id: 'e1', kind: 'existence', value: 0.2 };
    const rowB = { edge_id: 'e1', kind: 'magnitude', value: 0.7 };
    const h1 = computeResponseContentHash({ analysis_status: 'computed', edge_sensitivity: [rowA, rowB] });
    const h2 = computeResponseContentHash({ analysis_status: 'computed', edge_sensitivity: [rowB, rowA] });
    expect(h2).toBe(h1);
  });

  it('critique UUIDs are excluded (context-scoped id strip inside critiques)', () => {
    const base = { analysis_status: 'failed', critiques: [{ id: 'uuid-1', code: 'X', severity: 'error', message: 'm' }] };
    const other = { analysis_status: 'failed', critiques: [{ id: 'uuid-2', code: 'X', severity: 'error', message: 'm' }] };
    expect(computeResponseContentHash(other)).toBe(computeResponseContentHash(base));
  });

  it('nested semantic id fields OUTSIDE critiques are hashed content (no global id strip)', () => {
    const base = { analysis_status: 'computed', review_cards: [{ supporting_refs: [{ id: 'fact-1' }] }] };
    const other = { analysis_status: 'computed', review_cards: [{ supporting_refs: [{ id: 'fact-2' }] }] };
    expect(computeResponseContentHash(other)).not.toBe(computeResponseContentHash(base));
  });

  it('array pre-sort is locale-independent (code-unit order, never localeCompare)', () => {
    // Under ICU primary-level collation 'a-b' and 'ab' can reorder by locale;
    // code-unit order is fixed: '-' (0x2D) < 'b' (0x62).
    const h1 = computeResponseContentHash({
      option_comparison: [{ option_id: 'a-b', v: 1 }, { option_id: 'ab', v: 2 }],
    });
    const h2 = computeResponseContentHash({
      option_comparison: [{ option_id: 'ab', v: 2 }, { option_id: 'a-b', v: 1 }],
    });
    expect(h2).toBe(h1);
  });
});

// ---------------------------------------------------------------------------
// v1 proxy contract projection (review [6])
// ---------------------------------------------------------------------------
describe('toPublicIslError', () => {
  it('projects only the declared v1 isl_error contract fields (never status/critiques)', () => {
    const enriched = {
      code: 'ISL_REJECTED',
      message: 'rejected',
      retryable: false,
      status: 422,
      critiques: [{ code: 'ISL_CANNOT_IDENTIFY', severity: 'blocker', message: 'internal detail' }],
    };
    expect(toPublicIslError(enriched)).toEqual({ code: 'ISL_REJECTED', message: 'rejected', retryable: false });
  });
});
