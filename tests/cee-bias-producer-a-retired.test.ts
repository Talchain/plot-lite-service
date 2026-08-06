/**
 * S-1 — PRODUCER A'S BIAS LIMB IS RETIRED (ROADMAP 2.461 / 2.632 / 2.143 ②).
 *
 * Producer A is the counts-only compose path: `orchestrateCeeReview` reduces the
 * user's real `request.graph_snapshot` to two integers, `buildCeeBrief` turns those
 * into a string, CEE DRAFTS A NEW GRAPH from that string, and the bias check then ran
 * against THAT drafted graph. Every `bias_findings[].node_ids` and every
 * `mitigation_patches[]` on that path described a graph the user never built.
 *
 * This suite pins the retirement by EXECUTION, not by inspection: the CEE bias
 * endpoint must never be reached from any of producer A's three entries, and the
 * compose payload must be assembled without a `bias` limb at all.
 *
 * ⚠ THE THREE ENTRIES (complete manifest, re-derived at PLoT `4cad7f74`, `src/`,
 * non-test, `grep -a`) — the design brief named only the first two:
 *   1. `src/routes/v1/run.ts:1467`            → orchestrateCeeReview → SDK | V2 runner
 *   2. `src/routes/v2/run.ts:4416`            → orchestrateCeeReview → SDK | V2 runner
 *   3. `src/cee/client.ts:1319`               → runDecisionReviewViaSdk DIRECTLY,
 *      via `callDecisionReviewFromEngine`, reached only from
 *      `src/routes/v1/helpers/cee-integration.ts:128` (`executeCeeIntegration`),
 *      whose barrel `src/routes/v1/helpers/index.ts` has ZERO importers at this tip.
 *      Entry 3 is therefore dead — but unlike entries 1 and 2 it does NOT discard the
 *      review (`cee-integration.ts:159-160` returns `cee.review` WHOLE), so it is the
 *      one entry on which the fabricated bias payload would have reached its caller
 *      intact. It is covered here because the bias limb lived in the SHARED runner.
 *
 * POSITIVE CONTROLS (trap 13): every "was not called" assertion below is paired, in
 * the SAME test and through the SAME spy mechanism, with a "was called" assertion on
 * a surviving compose step. Without that pairing these tests would pass by executing
 * nothing at all.
 *
 * BINDING (trap 19): assertions bind to the bias step by IDENTITY — the exact SDK
 * method `biasCheck`, the exact module export `biasCheckV2`, and the exact `bias` KEY
 * of the compose argument — never by a value predicate another step could satisfy.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetCeeCircuitBreaker } from '../src/cee/circuit-breaker.js';
import type { CeeReviewRequest } from '../src/cee/types.js';

// -----------------------------------------------------------------------------
// Spies. Both mock factories spread `importOriginal()` so every export we do NOT
// override keeps its real implementation (trap 12: a bare factory REPLACES the
// module and silently drops exports added later).
// -----------------------------------------------------------------------------

const DRAFTED_GRAPH = { nodes: [{ id: 'cee-drafted-1' }], edges: [] };

/** The bias payload producer A used to compute on the DRAFTED graph. */
const FABRICATED_BIAS = {
  bias_findings: [
    { code: 'ANCHORING', severity: 'warning', message: 'anchored on X', node_ids: ['cee-drafted-1'] },
  ],
  mitigation_patches: [
    { bias_code: 'ANCHORING', patch: { adds: { nodes: [{ id: 'invented-1', kind: 'option' }] } } },
  ],
};

const sdkDraftGraph = vi.fn(async () => ({
  graph: DRAFTED_GRAPH,
  archetype: null,
  trace: { request_id: 'cee-req-sdk' },
  model: 'test-model',
}));
const sdkOptions = vi.fn(async () => ({ options: [] }));
const sdkEvidenceHelper = vi.fn(async () => ({ items: [] }));
/** If this is ever reached again, producer A's bias limb is back. */
const sdkBiasCheck = vi.fn(async () => FABRICATED_BIAS);
/** Records the exact argument object handed to the SDK's compose helper. */
const composeArgs: Array<Record<string, unknown>> = [];
const buildPayload = vi.fn((args: Record<string, unknown>) => {
  composeArgs.push(args);
  return { story: {}, journey: {}, uiFlags: {} };
});

vi.mock('@olumi/assistants-sdk', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createCEEClient: () => ({
      draftGraph: sdkDraftGraph,
      options: sdkOptions,
      evidenceHelper: sdkEvidenceHelper,
      biasCheck: sdkBiasCheck,
    }),
    buildCeeDecisionReviewPayload: buildPayload,
  };
});

const v2DraftGraph = vi.fn(async () => ({
  data: { graph: DRAFTED_GRAPH, archetype: null, trace: { request_id: 'cee-req-v2' }, model: 'test-model' },
  latency_ms: 1,
}));
const v2Options = vi.fn(async () => ({ data: { options: [] }, latency_ms: 1 }));
/** If this is ever reached again, producer A's V2 bias limb is back. */
const v2BiasCheck = vi.fn(async () => ({ data: FABRICATED_BIAS, latency_ms: 1 }));

vi.mock('../src/cee/client.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    draftGraphV2: v2DraftGraph,
    optionsV2: v2Options,
    // Deliberately still provided: at pristine the orchestrator imports and calls it,
    // so this spy is what turns the retirement RED-first. After the retirement the
    // real module no longer exports it (see the module-surface test below).
    biasCheckV2: v2BiasCheck,
  };
});

// Imported after the mocks so the module graph picks them up.
const { orchestrateCeeReview, runDecisionReviewViaSdk } = await import('../src/cee/orchestrator.js');
const { callDecisionReviewFromEngine } = await import('../src/cee/client.js');

const ENV = { baseUrl: 'http://cee.test', apiKey: 'test-key', timeoutMs: 5_000 };

function makeRequest(): CeeReviewRequest {
  return {
    scenario_id: 'scenario-1',
    graph_snapshot: {
      nodes: [{ id: 'user-node-A' }, { id: 'user-node-B' }],
      edges: [{ from: 'user-node-A', to: 'user-node-B' }],
    },
    graph_schema_version: '2.2',
    inference_results: { quantiles: { p10: 0.1, p50: 0.5, p90: 0.9 } },
    intent: 'selection',
  };
}

const originalFetch = globalThis.fetch;

describe('S-1 — producer A no longer bias-checks a CEE-drafted graph', () => {
  beforeEach(() => {
    resetCeeCircuitBreaker();
    delete process.env.CEE_SCHEMA_V2;
    composeArgs.length = 0;
    sdkDraftGraph.mockClear();
    sdkOptions.mockClear();
    sdkEvidenceHelper.mockClear();
    sdkBiasCheck.mockClear();
    v2DraftGraph.mockClear();
    v2Options.mockClear();
    v2BiasCheck.mockClear();
    buildPayload.mockClear();
  });

  afterEach(() => {
    delete process.env.CEE_SCHEMA_V2;
    globalThis.fetch = originalFetch;
    resetCeeCircuitBreaker();
  });

  // ---------------------------------------------------------------------------
  // Entry 1/2 — orchestrateCeeReview, SDK branch (the default live branch)
  // ---------------------------------------------------------------------------

  it('SDK branch: never calls CEE /bias-check (positive control: it DID draft and fetch options)', async () => {
    await orchestrateCeeReview(ENV, makeRequest(), 'req-sdk-1');

    // POSITIVE CONTROL, same spy mechanism: the compose path really executed.
    expect(sdkDraftGraph).toHaveBeenCalledTimes(1);
    expect(sdkOptions).toHaveBeenCalledTimes(1);

    // THE ASSERTION: the bias step is gone, bound to the SDK method by name.
    expect(sdkBiasCheck).toHaveBeenCalledTimes(0);
  });

  // ---------------------------------------------------------------------------
  // Entry 1/2 — orchestrateCeeReview, V2 HTTP branch
  // ---------------------------------------------------------------------------

  it('v2 HTTP branch: never calls biasCheckV2 (positive control: it DID draft and fetch options)', async () => {
    process.env.CEE_SCHEMA_V2 = '1';
    await orchestrateCeeReview(ENV, makeRequest(), 'req-v2-1');

    // POSITIVE CONTROL, same spy mechanism: the v2 branch really executed.
    expect(v2DraftGraph).toHaveBeenCalledTimes(1);
    expect(v2Options).toHaveBeenCalledTimes(1);

    // THE ASSERTION: bound to the module export by name.
    expect(v2BiasCheck).toHaveBeenCalledTimes(0);
  });

  // ---------------------------------------------------------------------------
  // Entry 3 — callDecisionReviewFromEngine → runDecisionReviewViaSdk DIRECTLY.
  // The entry the design brief's manifest missed, and the only one that would have
  // returned the fabricated bias payload to its caller instead of discarding it.
  // ---------------------------------------------------------------------------

  it('callDecisionReviewFromEngine (entry 3): never calls CEE /bias-check (positive control: it DID draft)', async () => {
    globalThis.fetch = (async (url: string) => {
      if (String(url).endsWith('/healthz')) {
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as any;
      }
      throw new Error(`Unexpected fetch in entry-3 test: ${url}`);
    }) as any;

    const res = await callDecisionReviewFromEngine({
      requestId: 'req-entry3',
      context: {
        response_hash: 'hash-1',
        seed: 42,
        inference_mode: 'model_based',
        graph_summary: { nodes: 2, edges: 1 },
      },
      env: { enable: '1', baseUrl: ENV.baseUrl, apiKey: ENV.apiKey, timeoutMs: 5_000 },
    });

    // POSITIVE CONTROL: the SDK orchestrator path really ran (not the fixture fallback).
    expect(res.usedFixture).toBe(false);
    expect(sdkDraftGraph).toHaveBeenCalledTimes(1);

    // THE ASSERTION.
    expect(sdkBiasCheck).toHaveBeenCalledTimes(0);

    // And the review it returns WHOLE to its caller carries no fabricated bias.
    expect(JSON.stringify(res.review ?? null)).not.toContain('invented-1');
    expect(JSON.stringify(res.review ?? null)).not.toContain('ANCHORING');
  });

  // ---------------------------------------------------------------------------
  // The compose payload is assembled without a bias limb — bound to the KEY.
  // ---------------------------------------------------------------------------

  it('the compose payload is built with NO `bias` key (positive control: `draft` and `options` ARE passed)', async () => {
    await runDecisionReviewViaSdk(ENV, 'Decision review for inference results', undefined, { nodes: 2, edges: 1 }, 'req-args');

    expect(composeArgs).toHaveLength(1);
    const args = composeArgs[0];

    // POSITIVE CONTROL: the key-presence matcher can see a presence.
    expect(Object.keys(args)).toContain('draft');
    expect(Object.keys(args)).toContain('options');

    // THE ASSERTION: bound to the exact key, not to its value (a `bias: undefined`
    // key would still be a bias limb the composer can read).
    expect(Object.keys(args)).not.toContain('bias');
  });

  it('v2 HTTP branch: the compose payload is built with NO `bias` key (positive control: `draft` and `options` ARE passed)', async () => {
    process.env.CEE_SCHEMA_V2 = '1';
    await orchestrateCeeReview(ENV, makeRequest(), 'req-v2-args');

    expect(composeArgs).toHaveLength(1);
    const args = composeArgs[0];

    expect(Object.keys(args)).toContain('draft');
    expect(Object.keys(args)).toContain('options');
    expect(Object.keys(args)).not.toContain('bias');
  });

  // ---------------------------------------------------------------------------
  // Module surface — derived from the REAL module, not from the mock above.
  // This is what stops the limb being re-imported by a future lane.
  // ---------------------------------------------------------------------------

  it('src/cee/client.ts no longer exports biasCheckV2 (positive control: optionsV2 IS still exported)', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../src/cee/client.js');

    // POSITIVE CONTROL: the same surface read can see a sibling that survives.
    expect(Object.keys(actual)).toContain('optionsV2');
    expect(Object.keys(actual)).toContain('draftGraphV2');

    // THE ASSERTION.
    expect(Object.keys(actual)).not.toContain('biasCheckV2');
  });
});
