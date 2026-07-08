/**
 * ISL wire-generation assertion — /v2/run surface (lane 29, spec §2.1,
 * docs/enrichment-v1/PLOT-V2-READ-FIX-SPEC.md).
 *
 * PLoT pins the REQUEST side of the ISL exchange (?response_version=2 +
 * X-ISL-Response-Version: 2) but, before this lane, asserted NOTHING about
 * the RESPONSE generation: a mis-deployed or rolled-back ISL silently
 * degrades to empty science — the exact failure mode that motivated this
 * workstream. These tests drive /v2/run with mutated copies of the real
 * live capture (build 9a22a1a) and pin the assertion surface:
 *
 *   - `_meta.evidence.isl_wire_generation_ok` — true on a well-formed V2
 *     envelope, false when version markers are absent or a wire-location
 *     probe fails;
 *   - honest per-feature degradation: `robustness` present but
 *     `robustness.edge_e_values` ABSENT (location gone, not computed-empty)
 *     must be explicitly marked EDGE_E_VALUES_UNAVAILABLE_V2_WIRE, never a
 *     silent [] on a computed analysis;
 *   - NO hard-fail: a mismatched wire generation still returns
 *     analysis_status 'computed' — absence of enrichment is
 *     degraded-but-usable (fail-closed stays reserved for the analysis core).
 *
 * RED before the lane 29 implementation: `isl_wire_generation_ok` does not
 * exist and a deleted robustness.edge_e_values yields a SILENT empty array.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const captureA = JSON.parse(
  readFileSync(join(FIXTURES, 'isl-v2-live-20260707', 'isl-staging-capture.json'), 'utf8'),
);
const requestA = JSON.parse(
  readFileSync(join(FIXTURES, 'isl-v2-live-20260707', 'isl-v2-request.json'), 'utf8'),
);
const captureB = JSON.parse(
  readFileSync(join(FIXTURES, 'isl-v2-live-20260706', 'isl-staging-capture.json'), 'utf8'),
);

// Per-test hook: the mock deep-clones captureA (or the capture set here) and
// applies the mutation, so the checked-in fixture is never touched.
let serveCapture: any = captureA;
let mutateCapture: ((capture: any) => void) | null = null;

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
    const payload = JSON.parse(JSON.stringify(serveCapture));
    if (mutateCapture) mutateCapture(payload);
    return { data: payload as T, error: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';

// Both capture sets were produced from the SAME request fixture (the
// 20260707 PROVENANCE.md pins byte-identity), so one PLoT body serves both.
function buildPlotBody() {
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
  };
}

describe('ISL wire-generation assertion on /v2/run (spec §2.1)', () => {
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
    serveCapture = captureA;
    mutateCapture = null;
  });

  async function run(mutation: ((c: any) => void) | null, capture: any = captureA) {
    serveCapture = capture;
    mutateCapture = mutation;
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v2/run',
        headers: { 'Content-Type': 'application/json' },
        payload: buildPlotBody(),
      });
      expect(res.statusCode).toBe(200);
      return JSON.parse(res.body);
    } finally {
      serveCapture = captureA;
      mutateCapture = null;
    }
  }

  it('well-formed V2 envelope (build 9a22a1a) → isl_wire_generation_ok true, no wire-gap markers', async () => {
    const body = await run(null);
    expect(body._meta.evidence.isl_wire_generation_ok).toBe(true);
    expect(body._meta.evidence.isl_build).toBe('9a22a1a');
    const gapMarkers = (body.inference_warnings ?? []).filter(
      (w: any) =>
        w.code === 'EDGE_E_VALUES_UNAVAILABLE_V2_WIRE' ||
        w.code === 'EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE',
    );
    expect(gapMarkers).toHaveLength(0);
    expect(body.edge_e_values).toHaveLength(9);
    expect(body.edge_sensitivity.length).toBeGreaterThan(0);
  }, 60_000);

  it('version markers stripped (build/engine_version/version absent) → ok false, science still delivered (no hard-fail)', async () => {
    const body = await run((c) => {
      delete c.build;
      delete c.engine_version;
      delete c.version;
    });
    expect(body._meta.evidence.isl_wire_generation_ok).toBe(false);
    expect(body._meta.evidence.isl_build).toBeNull();
    // Do NOT hard-fail the run on version mismatch (spec §2.1): the wire
    // locations still resolved, so the science is delivered unchanged.
    expect(body.analysis_status).toBe('computed');
    expect(body.edge_e_values).toHaveLength(9);
  }, 60_000);

  it('wire-location probe failure (robustness present, edge_e_values location ABSENT) → ok false + explicit marker, never silent computed-empty', async () => {
    const body = await run((c) => {
      delete c.robustness.edge_e_values;
    });
    expect(body._meta.evidence.isl_wire_generation_ok).toBe(false);
    expect(body.analysis_status).toBe('computed'); // degraded-but-usable
    // The pre-lane defect shape: a silent [] indistinguishable from
    // "computed and found nothing". Empty is tolerable ONLY with the marker.
    expect(Array.isArray(body.edge_e_values)).toBe(true);
    expect(body.edge_e_values).toHaveLength(0);
    const markers = (body.inference_warnings ?? []).filter(
      (w: any) => w.code === 'EDGE_E_VALUES_UNAVAILABLE_V2_WIRE',
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].severity).toBe('info');
  }, 60_000);

  it('edge_e_values present but EMPTY (computed-empty) → honest empty, NO wire-gap marker, ok true', async () => {
    const body = await run((c) => {
      c.robustness.edge_e_values = [];
    });
    // The LOCATION exists — the producer computed and found nothing. That is
    // an honest empty, not a wire gap: no marker, generation verified.
    expect(body._meta.evidence.isl_wire_generation_ok).toBe(true);
    expect(body.edge_e_values).toHaveLength(0);
    const markers = (body.inference_warnings ?? []).filter(
      (w: any) => w.code === 'EDGE_E_VALUES_UNAVAILABLE_V2_WIRE',
    );
    expect(markers).toHaveLength(0);
  }, 60_000);

  it('real older-generation wire (build f3f5d92 capture, no robustness.edge_sensitivity) → ok false, existing sensitivity marker still fires', async () => {
    const body = await run(null, captureB);
    // Below ISL_MIN_WIRE_GENERATION (9a22a1a): the nested edge_sensitivity
    // location does not exist on this wire.
    expect(body._meta.evidence.isl_wire_generation_ok).toBe(false);
    expect(body._meta.evidence.isl_build).toBe('f3f5d92');
    // Paired honest degradation (pre-existing behaviour, must not regress):
    expect(body.edge_sensitivity).toHaveLength(0);
    const markers = (body.inference_warnings ?? []).filter(
      (w: any) => w.code === 'EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE',
    );
    expect(markers).toHaveLength(1);
    // e-values DO resolve on that wire → no e-values marker, science delivered
    expect(body.edge_e_values.length).toBeGreaterThan(0);
    expect(
      (body.inference_warnings ?? []).filter(
        (w: any) => w.code === 'EDGE_E_VALUES_UNAVAILABLE_V2_WIRE',
      ),
    ).toHaveLength(0);
  }, 60_000);
});
