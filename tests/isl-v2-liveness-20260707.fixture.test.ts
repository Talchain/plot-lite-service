/**
 * ISL V2 edge-sensitivity consumption LIVENESS test (lane PLoT-W4).
 *
 * Drives /v2/run with the RAW live staging capture
 * (tests/fixtures/isl-v2-live-20260707, ISL build 9a22a1a, 2026-07-07 —
 * the first deployed build that emits robustness.edge_sensitivity,
 * sensitivity_reference_option_id, and request-gated path_decomposition;
 * ISL lane 11 / ISL PR #65) mocked as the ISL response, and asserts the
 * POPULATED path:
 *
 *  - edge_sensitivity is NON-EMPTY (populated from the nested V2 wire
 *    location via getIslEdgeSensitivity) and the
 *    EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE marker is ABSENT;
 *  - the liveness invariant holds: populated OR marked — NEVER both absent
 *    (the 20260706 fixture test covers the warning path on the older wire);
 *  - sensitivity_reference_option_id passes through verbatim (item B);
 *  - path_decomposition passes through verbatim ONLY on explicit request
 *    opt-in, and include_path_decomposition is forwarded to ISL only then
 *    (item C — request-gated, no default payload growth).
 *
 * RED before the lane PLoT-W4 change: the edge-sensitivity read did not
 * exist (transformEdgeSensitivity was fed `undefined` unconditionally), so
 * edge_sensitivity came back [] with the warning even though the wire
 * carried 26 entries.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'isl-v2-live-20260707',
);

const capturePlain = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'isl-staging-capture.json'), 'utf8'),
);
const capturePathDecomp = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'isl-staging-capture-pathdecomp.json'), 'utf8'),
);
const requestA = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'isl-v2-request.json'), 'utf8'),
);

// Which capture the mock returns for the main analyze call, and a recorder
// for every payload sent to the robustness analyze endpoint so the tests can
// assert the request-gated include_path_decomposition forward.
let activeCapture: any = capturePlain;
const analyzePayloads: any[] = [];

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
  async callAnalysisEndpoint<T>(endpoint: string, payload?: unknown): Promise<{ data: T | null; error: string | null }> {
    if (endpoint === '/api/v1/robustness/analyze/v2') {
      analyzePayloads.push(payload);
    }
    return { data: JSON.parse(JSON.stringify(activeCapture)) as T, error: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';

// PLoT request body derived from the captured ISL request (same graph shape,
// mapped back from ISL wire format to PLoT /v2/run format — same recipe as
// tests/isl-v2-liveness.fixture.test.ts).
function buildPlotBody(extra: Record<string, unknown> = {}) {
  return {
    graph: {
      nodes: requestA.graph.nodes.map((n: any) => ({
        id: n.id,
        kind: n.kind,
        label: n.label,
        ...(n.observed_state?.value !== undefined && n.observed_state?.value !== null
          ? { observed_state: { value: n.observed_state.value } }
          : {}),
      })),
      edges: requestA.graph.edges.map((e: any) => ({
        from: e.from,
        to: e.to,
        exists_probability: e.exists_probability,
        strength: { mean: e.strength.mean, std: e.strength.std },
      })),
    },
    options: requestA.options.map((o: any) => ({
      id: o.id,
      label: o.label,
      interventions: Object.fromEntries(
        Object.entries(o.interventions).map(([nodeId, value]) => [
          nodeId,
          { value, source: 'user_specified' },
        ]),
      ),
    })),
    goal_node_id: requestA.goal_node_id,
    seed: String(requestA.seed),
    ...extra,
  };
}

describe('edge_sensitivity populated path (live capture, build 9a22a1a)', () => {
  let app: FastifyInstance;
  let body: any;
  let mainIslPayload: any;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    activeCapture = capturePlain;
    analyzePayloads.length = 0;
    app = await createServer();
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: buildPlotBody(),
    });
    expect(res.statusCode).toBe(200);
    body = JSON.parse(res.body);
    mainIslPayload = analyzePayloads[0];
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  it('edge_sensitivity is NON-EMPTY from the nested V2 wire (the pre-fix silent-empty defect)', () => {
    // The wire carries 26 valid entries at robustness.edge_sensitivity; every
    // one passes the numeric-egress guard (finite elasticity + rank).
    expect(Array.isArray(body.edge_sensitivity)).toBe(true);
    expect(body.edge_sensitivity.length).toBe(26);
  });

  it('entries carry the public V3 shape: double-colon edge_id, labels, elasticity, rank, interpretation', () => {
    const nodeLabels = new Map<string, string>(
      requestA.graph.nodes.map((n: any) => [n.id, n.label]),
    );
    for (const e of body.edge_sensitivity) {
      expect(typeof e.edge_id).toBe('string');
      expect(e.edge_id).toBe(`${e.from}::${e.to}`);
      expect(typeof e.from).toBe('string');
      expect(typeof e.to).toBe('string');
      expect(e.from_label).toBe(nodeLabels.get(e.from) ?? e.from);
      expect(e.to_label).toBe(nodeLabels.get(e.to) ?? e.to);
      expect(['existence', 'magnitude']).toContain(e.sensitivity_type);
      expect(Number.isFinite(e.elasticity)).toBe(true);
      expect(Number.isInteger(e.importance_rank)).toBe(true);
      expect(e.importance_rank).toBeGreaterThanOrEqual(1);
      expect(typeof e.interpretation).toBe('string');
    }
  });

  it('V2-only wire fields (sensitivity_score, direction) are NOT emitted outward (contract frozen)', () => {
    for (const e of body.edge_sensitivity) {
      expect(e).not.toHaveProperty('sensitivity_score');
      expect(e).not.toHaveProperty('direction');
    }
  });

  it('EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE marker is SUPPRESSED when the wire carried data', () => {
    const marker = (body.inference_warnings ?? []).filter(
      (w: any) => w.code === 'EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE',
    );
    expect(marker).toHaveLength(0);
  });

  it('liveness invariant: edge_sensitivity non-empty OR warning present — NEVER both absent', () => {
    const populated = Array.isArray(body.edge_sensitivity) && body.edge_sensitivity.length > 0;
    const marked = (body.inference_warnings ?? []).some(
      (w: any) => w.code === 'EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE',
    );
    expect(populated || marked).toBe(true);
    // On THIS capture specifically: populated, not marked.
    expect(populated).toBe(true);
    expect(marked).toBe(false);
  });

  it('drivers_status is computed with edge-level sensitivity contributing', () => {
    expect(body.drivers_status).toBe('computed');
  });

  // -------------------------------------------------------------------------
  // Item B: reference-option disclosure passthrough
  // -------------------------------------------------------------------------

  it('sensitivity_reference_option_id passes through verbatim (item B)', () => {
    expect(capturePlain.sensitivity_reference_option_id).toBe('opt_one_dev');
    expect(body.sensitivity_reference_option_id).toBe('opt_one_dev');
  });

  // -------------------------------------------------------------------------
  // Item C negative: no opt-in → no forward, no response section
  // -------------------------------------------------------------------------

  it('include_path_decomposition is NOT forwarded to ISL without request opt-in (key omitted, not false)', () => {
    expect(mainIslPayload).toBeDefined();
    expect('include_path_decomposition' in mainIslPayload).toBe(false);
  });

  it('path_decomposition is ABSENT from the response without request opt-in', () => {
    expect(body).not.toHaveProperty('path_decomposition');
  });

  // -------------------------------------------------------------------------
  // Regression guards carried over from the 20260706 liveness suite: the new
  // build's wire keeps every previously-consumed section live.
  // -------------------------------------------------------------------------

  it('previously-consumed science sections stay live on the new build (no regression)', () => {
    expect(body.analysis_status).toBe('computed');
    expect(body.option_comparison_status).toBe('computed');
    expect(body.option_comparison.length).toBe(4);
    expect(body.robustness_status).toBe('computed');
    expect(body.edge_e_values.length).toBeGreaterThan(0);
    expect(body.factor_sensitivity.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Item C positive: explicit opt-in → flag forwarded, section passed through
// ---------------------------------------------------------------------------

describe('path_decomposition opt-in (live pathdecomp capture, build 9a22a1a)', () => {
  let app: FastifyInstance;
  let body: any;
  let mainIslPayload: any;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    activeCapture = capturePathDecomp;
    analyzePayloads.length = 0;
    app = await createServer();
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: buildPlotBody({ include_path_decomposition: true }),
    });
    expect(res.statusCode).toBe(200);
    body = JSON.parse(res.body);
    mainIslPayload = analyzePayloads[0];
  }, 120_000);

  afterAll(async () => {
    await app.close();
    activeCapture = capturePlain;
  });

  it('include_path_decomposition: true is forwarded to ISL on explicit opt-in', () => {
    expect(mainIslPayload).toBeDefined();
    expect(mainIslPayload.include_path_decomposition).toBe(true);
  });

  it('path_decomposition passes through verbatim (item C)', () => {
    expect(body.path_decomposition).toEqual(capturePathDecomp.path_decomposition);
    // Shape sanity on the live section (structural, not causal — see types)
    expect(body.path_decomposition.recommended_option_id).toBe('opt_tech_lead');
    expect(body.path_decomposition.truncated).toBe(false);
    expect(body.path_decomposition.path_count).toBe(6);
    expect(body.path_decomposition.paths).toHaveLength(3);
    for (const p of body.path_decomposition.paths) {
      expect(Array.isArray(p.path)).toBe(true);
      expect(Number.isFinite(p.path_effect)).toBe(true);
      expect(Number.isFinite(p.total_effect)).toBe(true);
      expect(['computed', 'indeterminate']).toContain(p.status);
      expect(typeof p.mechanism).toBe('string');
    }
  });

  it('edge_sensitivity stays populated and unmarked on the opt-in run too', () => {
    expect(body.edge_sensitivity.length).toBe(26);
    expect(
      (body.inference_warnings ?? []).some(
        (w: any) => w.code === 'EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE',
      ),
    ).toBe(false);
    expect(body.sensitivity_reference_option_id).toBe('opt_one_dev');
  });
});
