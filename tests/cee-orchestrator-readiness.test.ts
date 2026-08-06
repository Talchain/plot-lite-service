/**
 * ROADMAP row 23 (step 1) — `orchestrateCeeReview` must not fabricate a readiness verdict.
 *
 * Before this suite, BOTH live branches of `orchestrateCeeReview` used the CEE compose
 * result only as a truthiness test and then emitted a hardcoded object containing
 *   readiness: { level: 'ready', headline: 'Analysis complete[ (v2)]', factors: [] }
 * on EVERY successful turn — a constant dressed as a computed verdict
 * (src/cee/orchestrator.ts:598-612 and :638-652 at 5ab93383).
 *
 * CEE's compose endpoints (/assist/v1/draft-graph, /options) return no readiness field
 * at all (olumi-assistants-service@42e0b8ec src/schemas/ceeResponses.ts:288-387), so
 * the honest output is ABSENCE. (/bias-check was a third compose endpoint until S-1
 * retired the limb — ROADMAP 2.461.)
 *
 * The suite covers both branches (SDK compose = default live branch; v2 HTTP when
 * CEE_SCHEMA_V2 ∈ {1,true}) in both directions: verdict present in the CEE payload →
 * carried; verdict absent → field omitted, never fabricated.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetCeeCircuitBreaker } from '../src/cee/circuit-breaker.js';
import type { CeeReviewRequest } from '../src/cee/types.js';

// -----------------------------------------------------------------------------
// Mocks
//
// Both mocks spread `importOriginal()` so that every export we do NOT override
// keeps its real implementation. A bare factory would replace the module and
// silently drop exports added later (see the repo's hand-maintained-mirror trap).
// -----------------------------------------------------------------------------

/** What the mocked SDK helper returns as the "CEE compose result" review payload. */
let sdkReviewPayload: unknown = { story: {}, journey: {}, uiFlags: {} };
/**
 * When true, the mocked CEE /options call rejects — exercises the degraded path.
 *
 * This used to be driven from the mocked /bias-check call. S-1 retired the bias limb
 * (ROADMAP 2.461), so the degraded path is now exercised through /options, a compose
 * step that survives. Retargeted rather than deleted: dropping it would have silently
 * removed the only coverage of the degraded branch.
 */
let composeThrows = false;

vi.mock('@olumi/assistants-sdk', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createCEEClient: () => ({
      draftGraph: async () => ({
        graph: { nodes: [], edges: [] },
        archetype: null,
        trace: { request_id: 'cee-req-sdk' },
        model: 'test-model',
      }),
      options: async () => {
        if (composeThrows) throw new Error('CEE_UPSTREAM_FAILURE');
        return { options: [] };
      },
      evidenceHelper: async () => ({ items: [] }),
      // No `biasCheck`: S-1 retired it. Left ABSENT on purpose — if the call is ever
      // re-added to the runner it will throw "biasCheck is not a function" here rather
      // than passing against a helpful stub.
    }),
    buildCeeDecisionReviewPayload: () => sdkReviewPayload,
  };
});

vi.mock('../src/cee/client.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    draftGraphV2: async () => ({
      data: {
        graph: { nodes: [], edges: [] },
        archetype: null,
        trace: { request_id: 'cee-req-v2' },
        model: 'test-model',
      },
      latency_ms: 1,
    }),
    optionsV2: async () => {
      if (composeThrows) throw new Error('CEE_UPSTREAM_FAILURE');
      return { data: { options: [] }, latency_ms: 1 };
    },
    // No `biasCheckV2` override: S-1 deleted the export from src/cee/client.ts, and the
    // `importOriginal` spread above therefore no longer carries one. A re-added import
    // would resolve to `undefined` and fail loudly.
  };
});

// Imported after the mocks so the module graph picks them up.
const { orchestrateCeeReview } = await import('../src/cee/orchestrator.js');

const ENV = { baseUrl: 'http://cee.test', apiKey: 'test-key', timeoutMs: 5_000 };

function makeRequest(): CeeReviewRequest {
  return {
    scenario_id: 'scenario-1',
    graph_snapshot: {
      nodes: [{ id: 'A' }, { id: 'B' }],
      edges: [{ from: 'A', to: 'B' }],
    },
    graph_schema_version: '2.2',
    inference_results: { quantiles: { p10: 0.1, p50: 0.5, p90: 0.9 } },
    intent: 'selection',
  };
}

describe('orchestrateCeeReview — readiness is carried, never fabricated', () => {
  beforeEach(() => {
    resetCeeCircuitBreaker();
    delete process.env.CEE_SCHEMA_V2;
    sdkReviewPayload = { story: {}, journey: {}, uiFlags: {} };
    composeThrows = false;
  });

  afterEach(() => {
    delete process.env.CEE_SCHEMA_V2;
    resetCeeCircuitBreaker();
  });

  // ---------------------------------------------------------------------------
  // (d) readiness absent in CEE payload → absent in output (no 'ready' fabrication)
  // ---------------------------------------------------------------------------

  it('SDK branch: omits readiness entirely when CEE computed none', async () => {
    const result = await orchestrateCeeReview(ENV, makeRequest(), 'req-1');

    expect(result.ceeReview).not.toBeNull();
    expect(result.ceeReview).not.toHaveProperty('readiness');
    expect((result.ceeReview as Record<string, unknown>).readiness).toBeUndefined();
    // The specific fabricated constant must be gone.
    expect(JSON.stringify(result.ceeReview)).not.toContain('Analysis complete');
  });

  it('v2 HTTP branch: omits readiness entirely when CEE computed none', async () => {
    process.env.CEE_SCHEMA_V2 = '1';
    const result = await orchestrateCeeReview(ENV, makeRequest(), 'req-2');

    expect(result.ceeReview).not.toBeNull();
    expect(result.ceeReview).not.toHaveProperty('readiness');
    expect(JSON.stringify(result.ceeReview)).not.toContain('Analysis complete (v2)');
  });

  // ---------------------------------------------------------------------------
  // (d) readiness present in CEE payload → carried through byte-identical
  // ---------------------------------------------------------------------------

  it('SDK branch: carries a real CEE readiness verdict through byte-identical', async () => {
    sdkReviewPayload = {
      story: {},
      journey: {},
      uiFlags: {},
      readiness: {
        level: 'needs_attention',
        headline: 'Two fragile edges dominate the outcome',
        factors: ['Model robustness', 'Evidence coverage'],
      },
    };

    const result = await orchestrateCeeReview(ENV, makeRequest(), 'req-3');

    expect(result.ceeReview?.readiness).toEqual({
      level: 'needs_attention',
      headline: 'Two fragile edges dominate the outcome',
      factors: ['Model robustness', 'Evidence coverage'],
    });
  });

  it('v2 HTTP branch: carries a real CEE readiness verdict through byte-identical', async () => {
    process.env.CEE_SCHEMA_V2 = '1';
    sdkReviewPayload = {
      story: {},
      journey: {},
      uiFlags: {},
      readiness: {
        level: 'not_ready',
        headline: 'Outcome node is unidentifiable',
        factors: ['Identifiability'],
      },
    };

    const result = await orchestrateCeeReview(ENV, makeRequest(), 'req-4');

    expect(result.ceeReview?.readiness).toEqual({
      level: 'not_ready',
      headline: 'Outcome node is unidentifiable',
      factors: ['Identifiability'],
    });
  });

  it('rejects a malformed readiness rather than passing it through or fabricating one', async () => {
    sdkReviewPayload = {
      story: {},
      journey: {},
      uiFlags: {},
      readiness: { level: 'totally-fine', headline: 42, factors: 'nope' },
    };

    const result = await orchestrateCeeReview(ENV, makeRequest(), 'req-5');

    expect(result.ceeReview).not.toBeNull();
    expect(result.ceeReview).not.toHaveProperty('readiness');
  });

  // ---------------------------------------------------------------------------
  // (c) existing fallback behaviour — pinned, must not change
  // ---------------------------------------------------------------------------

  it('SDK branch: ceeReview is null when CEE returns no review', async () => {
    sdkReviewPayload = null;
    const result = await orchestrateCeeReview(ENV, makeRequest(), 'req-6');

    expect(result.ceeReview).toBeNull();
    expect(result.ceeError).toBeNull();
  });

  it('v2 HTTP branch: ceeReview is null when CEE returns no review', async () => {
    process.env.CEE_SCHEMA_V2 = '1';
    sdkReviewPayload = null;
    const result = await orchestrateCeeReview(ENV, makeRequest(), 'req-7');

    expect(result.ceeReview).toBeNull();
    expect(result.ceeError).toBeNull();
  });

  it('degrades with a normalised error and null review when the CEE call fails', async () => {
    composeThrows = true;

    const result = await orchestrateCeeReview(ENV, makeRequest(), 'req-8');

    expect(result.ceeReview).toBeNull();
    expect(result.ceeError).not.toBeNull();
    expect(result.ceeTrace.degraded).toBe(true);
  });

  it('still carries intent, analysis_state, blocks and trace on a successful turn', async () => {
    const result = await orchestrateCeeReview(ENV, makeRequest(), 'req-9');

    expect(result.ceeReview?.intent).toBe('selection');
    expect(result.ceeReview?.analysis_state).toBe('ran');
    expect(Array.isArray(result.ceeReview?.blocks)).toBe(true);
    expect(result.ceeReview?.trace?.request_id).toBe('cee-req-sdk');
    expect(result.ceeTrace.degraded).toBe(false);
  });

  it('still synthesises the ISL robustness block', async () => {
    const request = makeRequest();
    request.isl_robustness = { overall_robustness: 'fragile' };

    const result = await orchestrateCeeReview(ENV, request, 'req-10');

    expect(result.ceeReview?.blocks?.some((b) => b.id === 'robustness')).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // (a)/(b) The M1 conversion does not leak the compose payload.
  //
  // THE ORIGINAL VERSION OF THIS TEST ("does NOT surface CEE bias findings") drove a
  // bias envelope through the retired /bias-check limb and said: "Delete this test
  // when, and only when, that seam is fixed." S-1 did not fix the seam — it RETIRED
  // the producer (ROADMAP 2.461), so there is no bias envelope left to drive.
  // Deleting outright would have thrown away the surviving, still-valuable guarantee:
  // `orchestrateCeeReview` rebuilds the M1 response from scratch and carries ONLY
  // readiness + trace + blocks out of the compose payload. That is what is pinned
  // here now, driven from `sdkReviewPayload` (what the SDK composer returns), so the
  // test binds to the conversion rather than to the deleted call.
  //
  // The retirement itself is pinned by execution in
  // tests/cee-bias-producer-a-retired.test.ts across all three runner entries.
  // ---------------------------------------------------------------------------

  it('the M1 conversion carries no field of the compose payload beyond readiness', async () => {
    sdkReviewPayload = {
      story: { headline: 'compose-only-story' },
      journey: {},
      uiFlags: {},
      bias: {
        bias_findings: [{ code: 'ANCHORING', severity: 'warning', message: 'anchored on X' }],
        mitigation_patches: [{ bias_code: 'ANCHORING', patch: { adds: { nodes: [{ id: 'invented-1' }] } } }],
      },
    };

    const result = await orchestrateCeeReview(ENV, makeRequest(), 'req-11');

    // Positive control: the conversion really ran and produced a review.
    expect(result.ceeReview).not.toBeNull();
    expect(result.ceeReview?.analysis_state).toBe('ran');

    // The assertions: nothing from the compose payload rides through.
    expect(result.ceeReview).not.toHaveProperty('bias');
    expect(result.ceeReview).not.toHaveProperty('story');
    expect(JSON.stringify(result.ceeReview)).not.toContain('invented-1');
    expect(JSON.stringify(result.ceeReview)).not.toContain('ANCHORING');
    expect(JSON.stringify(result.ceeReview)).not.toContain('compose-only-story');
  });
});
