/**
 * ROADMAP row 23 (step 1) — `orchestrateCeeReview` must not fabricate a readiness verdict.
 *
 * Before this suite, BOTH live branches of `orchestrateCeeReview` used the CEE compose
 * result only as a truthiness test and then emitted a hardcoded object containing
 *   readiness: { level: 'ready', headline: 'Analysis complete[ (v2)]', factors: [] }
 * on EVERY successful turn — a constant dressed as a computed verdict
 * (src/cee/orchestrator.ts:598-612 and :638-652 at 5ab93383).
 *
 * CEE's compose endpoints (/assist/v1/draft-graph, /options, /bias-check) return no
 * readiness field at all (olumi-assistants-service@42e0b8ec
 * src/schemas/ceeResponses.ts:288-387), so the honest output is ABSENCE.
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
/** What the mocked CEE bias-check envelope returns. */
let biasEnvelope: Record<string, unknown> = { bias_findings: [] };
/** When true, the mocked CEE bias-check rejects — exercises the degraded path. */
let biasEnvelopeThrows = false;

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
      options: async () => ({ options: [] }),
      evidenceHelper: async () => ({ items: [] }),
      biasCheck: async () => {
        if (biasEnvelopeThrows) throw new Error('CEE_UPSTREAM_FAILURE');
        return biasEnvelope;
      },
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
    optionsV2: async () => ({ data: { options: [] }, latency_ms: 1 }),
    biasCheckV2: async () => {
      if (biasEnvelopeThrows) throw new Error('CEE_UPSTREAM_FAILURE');
      return { data: biasEnvelope, latency_ms: 1 };
    },
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
    biasEnvelope = { bias_findings: [] };
    biasEnvelopeThrows = false;
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
    biasEnvelopeThrows = true;

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
  // (a)/(b) Bias payload — PINNED AS *NOT* SURFACED, deliberately.
  //
  // This is NOT an endorsement of the gap. `orchestrateCeeReview` asks CEE to draft
  // a graph from a COUNT-ONLY brief ("Decision review context: ... (N nodes, E edges)",
  // src/cee/orchestrator.ts:118-133) and then runs the bias check against THAT drafted
  // graph (:172, :341) — the user's own graph (`request.graph_snapshot`) is read for
  // `.length` only (:583-584, :622-623). So `bias_findings` / `mitigation_patches`
  // describe a graph the user never built, and surfacing them would be a fabrication,
  // not a fix. The graph seam must be corrected first — see
  // PHASE0-EVIDENCE-2026-07-28/fix-row23-plot-carry-review.md §2.
  //
  // Delete this test when, and only when, that seam is fixed.
  // ---------------------------------------------------------------------------

  it('does NOT surface CEE bias findings (they describe a CEE-drafted graph, not the user\'s)', async () => {
    biasEnvelope = {
      bias_findings: [{ code: 'ANCHORING', severity: 'warning', message: 'anchored on X' }],
      mitigation_patches: [{ bias_code: 'ANCHORING', patch: { adds: { nodes: [{ id: 'invented-1' }] } } }],
    };

    const result = await orchestrateCeeReview(ENV, makeRequest(), 'req-11');

    expect(result.ceeReview).not.toBeNull();
    expect(result.ceeReview).not.toHaveProperty('bias');
    expect(JSON.stringify(result.ceeReview)).not.toContain('invented-1');
    expect(JSON.stringify(result.ceeReview)).not.toContain('ANCHORING');
  });
});
