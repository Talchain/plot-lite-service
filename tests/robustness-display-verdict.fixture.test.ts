/**
 * Display-safe robustness verdict — route-level fixture tests (lane PLoT-W5,
 * roadmap Tier 1.6 producer side).
 *
 * The UI hardcodes robustnessVerdict = undefined ("Robustness unknown")
 * because no display-safe field exists on the /v2/run wire: it carries
 * is_robust / level / confidence but the UI is forbidden to re-derive
 * meaning from raw producer facts. These tests pin the ADDITIVE producer
 * fields `robustness.display_verdict` + `robustness.display_verdict_reason`.
 *
 * Fixture derivation (live capture sets):
 *  - tests/fixtures/isl-v2-live-20260706 (ISL build f3f5d92): the FRAGILE
 *    case — robustness.is_robust === false, level === 'low' → 'fragile'.
 *  - tests/fixtures/isl-v2-live-20260707 (see PROVENANCE.md): same verdict
 *    facts on a later build → 'fragile'.
 *  - absent-robustness case: the 20260706 capture with the robustness key
 *    DELETED (simulates an ISL response that never computed robustness) →
 *    'not_assessed' on the CIL Phase-0 fallback object.
 *  - synthetic robust / moderate / confidence-cannot-upgrade cases: capture
 *    clones with only the verdict-bearing facts (is_robust / level) edited.
 *
 * Honesty invariants pinned here:
 *  - NEVER a determinate-looking verdict when robustness wasn't computed.
 *  - confidence alone can never upgrade a verdict (it is not an input).
 *  - display_verdict_reason is claim-safe: no digits, producer-owned phrase.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const capture20260706 = JSON.parse(
  readFileSync(join(FIXTURES_ROOT, 'isl-v2-live-20260706', 'isl-staging-capture.json'), 'utf8'),
);
const request20260706 = JSON.parse(
  readFileSync(join(FIXTURES_ROOT, 'isl-v2-live-20260706', 'isl-v2-request.json'), 'utf8'),
);
const capture20260707 = JSON.parse(
  readFileSync(join(FIXTURES_ROOT, 'isl-v2-live-20260707', 'isl-staging-capture.json'), 'utf8'),
);
const request20260707 = JSON.parse(
  readFileSync(join(FIXTURES_ROOT, 'isl-v2-live-20260707', 'isl-v2-request.json'), 'utf8'),
);

// The ISL payload the mock returns for the NEXT /v2/run call. Reassigned per
// test; always deep-cloned so the raw captures stay untouched.
let currentIslPayload: any = null;

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high',
      adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(): Promise<{ data: T | null; error: string | null }> {
    return { data: JSON.parse(JSON.stringify(currentIslPayload)) as T, error: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';

/** Map a captured ISL request back to PLoT /v2/run body shape. */
function buildPlotBody(islRequest: any) {
  return {
    graph: {
      nodes: islRequest.graph.nodes.map((n: any) => ({
        id: n.id,
        kind: n.kind,
        label: n.label,
        ...(n.observed_state?.value !== undefined && n.observed_state?.value !== null
          ? { observed_state: { value: n.observed_state.value } }
          : {}),
      })),
      edges: islRequest.graph.edges.map((e: any) => ({
        from: e.from,
        to: e.to,
        exists_probability: e.exists_probability,
        strength: { mean: e.strength.mean, std: e.strength.std },
      })),
    },
    options: islRequest.options.map((o: any) => ({
      id: o.id,
      label: o.label,
      interventions: Object.fromEntries(
        Object.entries(o.interventions).map(([nodeId, value]) => [
          nodeId,
          { value, source: 'user_specified' },
        ]),
      ),
    })),
    goal_node_id: islRequest.goal_node_id,
    seed: String(islRequest.seed),
  };
}

async function runV2(app: FastifyInstance, payload: any) {
  const res = await app.inject({
    method: 'POST',
    url: '/v2/run',
    headers: { 'Content-Type': 'application/json' },
    payload,
  });
  return { statusCode: res.statusCode, body: JSON.parse(res.body) };
}

const VERDICT_ENUM = ['robust', 'moderate', 'fragile', 'not_assessed'];

describe('robustness.display_verdict — /v2/run (live-capture derived)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    app = await createServer();
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Live fragile case — 20260706 capture (is_robust=false, level='low')
  // -------------------------------------------------------------------------

  it("20260706 live capture (is_robust=false, level='low') → 'fragile' + claim-safe reason", async () => {
    currentIslPayload = capture20260706;
    const { statusCode, body } = await runV2(app, buildPlotBody(request20260706));
    expect(statusCode).toBe(200);

    // Producer facts unchanged (additive change only)
    expect(body.robustness.is_robust).toBe(false);
    expect(body.robustness.level).toBe('low');
    expect(body.robustness_status).toBe('computed');

    expect(body.robustness.display_verdict).toBe('fragile');
    expect(typeof body.robustness.display_verdict_reason).toBe('string');
    expect(body.robustness.display_verdict_reason.length).toBeGreaterThan(0);
    // Claim-safe: producer-owned phrase, no numbers.
    expect(body.robustness.display_verdict_reason).not.toMatch(/\d/);
  });

  it("20260707 live capture (is_robust=false, level='low') → 'fragile'", async () => {
    currentIslPayload = capture20260707;
    const { statusCode, body } = await runV2(app, buildPlotBody(request20260707));
    expect(statusCode).toBe(200);
    expect(body.robustness.is_robust).toBe(false);
    expect(body.robustness.level).toBe('low');
    expect(body.robustness.display_verdict).toBe('fragile');
    expect(body.robustness.display_verdict_reason).not.toMatch(/\d/);
  });

  // -------------------------------------------------------------------------
  // Absent robustness — ISL response without the robustness key
  // -------------------------------------------------------------------------

  it("robustness ABSENT from ISL response → 'not_assessed' on the CIL fallback object", async () => {
    const noRobustness = JSON.parse(JSON.stringify(capture20260706));
    delete noRobustness.robustness;
    currentIslPayload = noRobustness;

    const { statusCode, body } = await runV2(app, buildPlotBody(request20260706));
    expect(statusCode).toBe(200);

    // CIL Phase 0 guarantee: robustness object still present with empty arrays
    expect(body.robustness).toBeDefined();
    expect(body.robustness.fragile_edges).toEqual([]);
    expect(body.robustness.robust_edges).toEqual([]);
    expect(body.robustness_status).not.toBe('computed');

    expect(body.robustness.display_verdict).toBe('not_assessed');
    expect(typeof body.robustness.display_verdict_reason).toBe('string');
    expect(body.robustness.display_verdict_reason).not.toMatch(/\d/);
    // NEVER a determinate-looking verdict when robustness wasn't computed
    expect(['robust', 'moderate', 'fragile']).not.toContain(body.robustness.display_verdict);
  });

  // -------------------------------------------------------------------------
  // Synthetic verdict-fact edits on the live capture (mapping table)
  // -------------------------------------------------------------------------

  it("is_robust=true + level='high' → 'robust'", async () => {
    const edited = JSON.parse(JSON.stringify(capture20260706));
    edited.robustness.is_robust = true;
    edited.robustness.level = 'high';
    currentIslPayload = edited;

    const { body } = await runV2(app, buildPlotBody(request20260706));
    expect(body.robustness.display_verdict).toBe('robust');
    expect(body.robustness.display_verdict_reason).not.toMatch(/\d/);
  });

  it("level='medium' → 'moderate' (is_robust true does not inflate to robust)", async () => {
    const edited = JSON.parse(JSON.stringify(capture20260706));
    edited.robustness.is_robust = true;
    edited.robustness.level = 'medium';
    currentIslPayload = edited;

    const { body } = await runV2(app, buildPlotBody(request20260706));
    expect(body.robustness.display_verdict).toBe('moderate');
  });

  it("explicit is_robust=false wins over level='high' → 'fragile' (never softened)", async () => {
    const edited = JSON.parse(JSON.stringify(capture20260706));
    edited.robustness.is_robust = false;
    edited.robustness.level = 'high';
    currentIslPayload = edited;

    const { body } = await runV2(app, buildPlotBody(request20260706));
    expect(body.robustness.display_verdict).toBe('fragile');
  });

  it('high confidence alone NEVER upgrades the verdict (is_robust=false, level=low, confidence=0.99)', async () => {
    const edited = JSON.parse(JSON.stringify(capture20260706));
    edited.robustness.confidence = 0.99;
    currentIslPayload = edited;

    const { body } = await runV2(app, buildPlotBody(request20260706));
    expect(body.robustness.display_verdict).toBe('fragile');
  });

  it("verdict-bearing facts missing (no is_robust, no level) on a computed robustness → 'not_assessed'", async () => {
    const edited = JSON.parse(JSON.stringify(capture20260706));
    delete edited.robustness.is_robust;
    delete edited.robustness.level;
    currentIslPayload = edited;

    const { body } = await runV2(app, buildPlotBody(request20260706));
    // fragile_edges/confidence survive, but no determinate verdict without
    // the verdict-bearing facts.
    expect(body.robustness.display_verdict).toBe('not_assessed');
  });

  // -------------------------------------------------------------------------
  // Blocked path (422) — robustness never computed
  // -------------------------------------------------------------------------

  it("blocked run (422) carries display_verdict 'not_assessed' on the CIL empty robustness object", async () => {
    currentIslPayload = capture20260706; // never reached — preflight blocks first
    const blockedBody = buildPlotBody(request20260706);
    blockedBody.goal_node_id = 'missing-goal-node';

    const { statusCode, body } = await runV2(app, blockedBody);
    expect(statusCode).toBe(422);
    expect(body.analysis_status).toBe('blocked');
    expect(body.robustness.fragile_edges).toEqual([]);
    expect(body.robustness.robust_edges).toEqual([]);
    expect(body.robustness.display_verdict).toBe('not_assessed');
    expect(typeof body.robustness.display_verdict_reason).toBe('string');
  });

  // -------------------------------------------------------------------------
  // Wire hygiene
  // -------------------------------------------------------------------------

  it('display_verdict is always one of the four enum values whenever present', async () => {
    currentIslPayload = capture20260706;
    const { body } = await runV2(app, buildPlotBody(request20260706));
    expect(VERDICT_ENUM).toContain(body.robustness.display_verdict);
  });
});
