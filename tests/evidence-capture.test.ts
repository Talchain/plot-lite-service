/**
 * Diligence-grade evidence capture (Lane PLoT-R3, roadmap 2.13)
 *
 * The UI debug bundle reported "plot: null / isl: null" because the full
 * payload mirror is gated behind UI_CANONICAL_META (off in staging). These
 * tests cover the always-on additive `_meta.evidence` surface:
 *   - computePayloadDigest: sha256 over EXACT bytes + UTF-8 byte length +
 *     sorted top-level key manifest (never the body itself);
 *   - ISLClient: digests recorded for the exact request bytes sent and the
 *     exact response bytes received (success, HTTP-error and network paths);
 *   - /v2/run: _meta.evidence always present with honest nulls when the ISL
 *     HTTP client was not exercised.
 */

import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  computePayloadDigest,
  initDownstreamTracking,
  getDownstreamCallsForLog,
  clearDownstreamTracking,
} from '../src/util/downstream-tracker.js';
import { ISLClient } from '../src/integrations/isl/client.js';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

// =============================================================================
// computePayloadDigest — unit
// =============================================================================

describe('computePayloadDigest', () => {
  it('digests the exact text bytes (sha256 + UTF-8 length)', () => {
    const text = '{"a":1,"b":"£"}'; // £ is 2 bytes in UTF-8
    const digest = computePayloadDigest(text, JSON.parse(text));
    expect(digest.sha256).toBe(sha256(text));
    expect(digest.bytes).toBe(Buffer.byteLength(text, 'utf8'));
    expect(digest.bytes).toBe(text.length + 1); // multibyte proof
  });

  it('key_manifest is the sorted top-level keys', () => {
    const digest = computePayloadDigest('{"zeta":1,"alpha":2,"mid":3}', { zeta: 1, alpha: 2, mid: 3 });
    expect(digest.key_manifest).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('key_manifest is [] for arrays and primitives', () => {
    expect(computePayloadDigest('[1,2]', [1, 2]).key_manifest).toEqual([]);
    expect(computePayloadDigest('"x"', 'x').key_manifest).toEqual([]);
    expect(computePayloadDigest('null', null).key_manifest).toEqual([]);
  });

  it('is a pure content digest: same bytes → same digest, different bytes → different digest', () => {
    const a1 = computePayloadDigest('{"a":1}', { a: 1 });
    const a2 = computePayloadDigest('{"a":1}', { a: 1 });
    const b = computePayloadDigest('{"a":2}', { a: 2 });
    expect(a1).toEqual(a2);
    expect(a1.sha256).not.toBe(b.sha256);
  });
});

// =============================================================================
// ISLClient — digest recording over exact wire bytes
// =============================================================================

describe('ISLClient — evidence digests', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeClient() {
    return new ISLClient({
      baseUrl: 'https://isl.test.example.com',
      apiKey: 'test-key',
      timeoutMs: 5000,
      maxRetries: 1,
    });
  }

  it('records request/response digests of the EXACT bytes exchanged', async () => {
    const requestId = 'evidence-digest-success';
    initDownstreamTracking(requestId);

    // Response text with non-canonical whitespace + unsorted keys: the digest
    // must cover these exact bytes, not a re-serialisation.
    const responseText = '{ "zeta": 1,\n  "alpha": { "nested": true } }';
    let sentBody: string | undefined;

    globalThis.fetch = vi.fn(async (_url: any, init: any) => {
      sentBody = init?.body as string;
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => responseText,
      };
    }) as unknown as typeof fetch;

    const client = makeClient();
    await client.request({ endpoint: '/api/v1/robustness/analyze/v2', body: { graph: { nodes: [] }, seed: '42' }, requestId });

    const calls = getDownstreamCallsForLog(requestId);
    clearDownstreamTracking(requestId);
    expect(calls).toHaveLength(1);

    const call = calls[0];
    // Request digest covers exactly what went over the wire
    expect(sentBody).toBeDefined();
    expect(call.request_digest!.sha256).toBe(sha256(sentBody!));
    expect(call.request_digest!.bytes).toBe(Buffer.byteLength(sentBody!, 'utf8'));
    expect(call.request_digest!.key_manifest).toEqual(['graph', 'seed']);

    // Response digest covers the exact received text (whitespace included),
    // with the manifest from the parsed object (sorted)
    expect(call.response_digest!.sha256).toBe(sha256(responseText));
    expect(call.response_digest!.bytes).toBe(Buffer.byteLength(responseText, 'utf8'));
    expect(call.response_digest!.key_manifest).toEqual(['alpha', 'zeta']);
  });

  it('records digests on HTTP error responses (non-retryable 4xx)', async () => {
    const requestId = 'evidence-digest-http-error';
    initDownstreamTracking(requestId);

    const errorText = '{"detail":"unprocessable"}';
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => errorText,
    })) as unknown as typeof fetch;

    const client = makeClient();
    await expect(
      client.request({ endpoint: '/api/v1/robustness/analyze/v2', body: { graph: {} }, requestId }),
    ).rejects.toThrow();

    const calls = getDownstreamCallsForLog(requestId);
    clearDownstreamTracking(requestId);
    expect(calls).toHaveLength(1);
    expect(calls[0].request_digest).toBeDefined();
    expect(calls[0].response_digest!.sha256).toBe(sha256(errorText));
    expect(calls[0].response_digest!.key_manifest).toEqual(['detail']);
  });

  it('records the request digest (no response digest) on network failure', async () => {
    const requestId = 'evidence-digest-network';
    initDownstreamTracking(requestId);

    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    const client = makeClient();
    await expect(
      client.request({ endpoint: '/api/v1/robustness/analyze/v2', body: { graph: {} }, requestId }),
    ).rejects.toThrow();

    const calls = getDownstreamCallsForLog(requestId);
    clearDownstreamTracking(requestId);
    expect(calls).toHaveLength(1);
    expect(calls[0].request_digest).toBeDefined();
    expect(calls[0].request_digest!.key_manifest).toEqual(['graph']);
    expect(calls[0].response_digest).toBeUndefined();
  });
});

// =============================================================================
// /v2/run — _meta.evidence always present (honest nulls)
// =============================================================================

// Mock the ISL service MODULE (same pattern as determinism-replay.test.ts):
// the mocked callAnalysisEndpoint bypasses the HTTP client, so no downstream
// call (and no digest) is recorded — evidence must then report honest nulls.
const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high',
      adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock validation', reasoning: 'Test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    const options = body.options || [];
    return {
      data: {
        options: options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: { mean: 0.65 + idx * 0.12, std: 0.08, p10: 0.45, p50: 0.65, p90: 0.85, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
          rank: idx + 1,
        })),
        edges: [],
        factors: [],
        value_of_information: [],
        overall_robustness: 'robust', robustness_score: 0.82,
        fragile_edges: [], robust_edges: [],
      } as T,
      error: null,
    };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';

describe('/v2/run — _meta.evidence', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  it('is always present: plot_build populated, honest nulls when the ISL HTTP client was not exercised', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      payload: {
        graph: {
          nodes: [
            { id: 'goal', kind: 'goal', label: 'Revenue' },
            { id: 'factor-a', kind: 'factor', label: 'Marketing Spend', observed_state: { value: 0.6 } },
          ],
          edges: [
            { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
          ],
        },
        options: [
          { id: 'opt1', label: 'Increase Marketing', interventions: { 'factor-a': 0.8 } },
          { id: 'opt2', label: 'Hold Marketing', interventions: { 'factor-a': 0.6 } },
        ],
        goal_node_id: 'goal',
        seed: '4242',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body._meta).toBeDefined();
    const evidence = body._meta.evidence;
    expect(evidence).toBeDefined();
    expect(typeof evidence.plot_build).toBe('string');
    expect(evidence.plot_build.length).toBeGreaterThan(0);
    // Module-level ISL mock bypasses the HTTP client: no digest was recorded
    // and the mock response carries no `build` — nulls must be explicit
    // (field present), never absent.
    expect(evidence).toHaveProperty('isl_build', null);
    expect(evidence).toHaveProperty('isl_request_digest', null);
    expect(evidence).toHaveProperty('isl_response_digest', null);
  });

  it('decision_brief carries the claim-safe surfaces end-to-end (flag default ON)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      payload: {
        graph: {
          nodes: [
            { id: 'goal', kind: 'goal', label: 'Revenue' },
            { id: 'factor-a', kind: 'factor', label: 'Marketing Spend', observed_state: { value: 0.6 } },
          ],
          edges: [
            { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
          ],
        },
        options: [
          { id: 'opt1', label: 'Increase Marketing', interventions: { 'factor-a': 0.8 } },
          { id: 'opt2', label: 'Hold Marketing', interventions: { 'factor-a': 0.6 } },
        ],
        goal_node_id: 'goal',
        seed: '4242',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.decision_brief).toBeTruthy();
    expect(body.decision_brief.robustness_caveat).toBeDefined();
    expect(body.decision_brief.robustness_caveat.doctrine).toBe('provisional_doctrine_v0');
    expect(Array.isArray(body.decision_brief.warning_codes)).toBe(true);
    expect(Array.isArray(body.decision_brief.defaulted_assumptions)).toBe(true);
    if (body.decision_brief.headline_banded) {
      expect(['very_close', 'slightly_ahead', 'clearly_ahead']).toContain(body.decision_brief.headline_banded.band);
      expect(body.decision_brief.headline_banded.text).not.toMatch(/EVPI|expected value/i);
    }
  });
});
