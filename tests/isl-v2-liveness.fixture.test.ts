/**
 * ISL V2 science-channel LIVENESS test (Lane 2, item G).
 *
 * Drives /v2/run with the RAW live staging capture
 * (tests/fixtures/isl-v2-live-20260706, ISL build f3f5d92, 2026-07-06) mocked
 * as the ISL response, and asserts that EVERY science feature requested on
 * the wire (analysis_types comparison/sensitivity/robustness +
 * include_e_values + include_voi) is either NON-EMPTY in the public response
 * or EXPLICITLY marked unavailable/skipped/error.
 *
 * SILENT EMPTY ARRAYS FAIL. Before the V2-envelope fix, edge_e_values was
 * structurally [] on every live response (the read targeted a V1-era
 * top-level field the V2 wire never emits) and this test goes RED.
 *
 * Also covers:
 *  - item C: no negative EVPI/VOI value anywhere in the public response;
 *  - item D: confidence_tier never 'strong' on this capture
 *    (robustness.is_robust=false, level='low');
 *  - item F: the new ISL warning code CONSTRAINT_SAMPLES_UNNOISED passes
 *    through without crash or drop;
 *  - flag hygiene: raw factor_evpi never leaks into the public response.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'isl-v2-live-20260706',
);

const captureA = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'isl-staging-capture.json'), 'utf8'),
);
const requestA = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'isl-v2-request.json'), 'utf8'),
);

// When set, the mock appends this warning to the fixture's inference_warnings
// (the raw capture itself stays untouched).
let injectWarning: { code: string; message: string; severity?: string } | null = null;

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
    const payload = JSON.parse(JSON.stringify(captureA));
    if (injectWarning) {
      payload.inference_warnings = [...(payload.inference_warnings ?? []), injectWarning];
    }
    return { data: payload as T, error: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';

// ---------------------------------------------------------------------------
// PLoT request body derived from the captured ISL request (same graph shape,
// mapped back from ISL wire format to PLoT /v2/run format).
// ---------------------------------------------------------------------------

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

/** Recursively collect [path, value] pairs for keys matching a predicate. */
function collectFields(
  value: unknown,
  matcher: (key: string) => boolean,
  path = '$',
  out: Array<[string, unknown]> = [],
): Array<[string, unknown]> {
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectFields(v, matcher, `${path}[${i}]`, out));
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (matcher(k)) out.push([`${path}.${k}`, v]);
      collectFields(v, matcher, `${path}.${k}`, out);
    }
  }
  return out;
}

describe('ISL V2 science-channel liveness (live capture, build f3f5d92)', () => {
  let app: FastifyInstance;
  let body: any;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    // Flag hygiene under test: the internal factor_evpi mapping stays OFF
    delete process.env.ISL_FACTOR_EVPI_INTERNAL;
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
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Liveness matrix: every requested science feature is non-empty OR
  // explicitly marked. Silent empty arrays FAIL.
  // -------------------------------------------------------------------------

  it("analysis_types 'comparison' → option_comparison non-empty and status computed", () => {
    expect(body.option_comparison_status).toBe('computed');
    expect(Array.isArray(body.option_comparison)).toBe(true);
    expect(body.option_comparison.length).toBe(4);
  });

  it("analysis_types 'robustness' → robustness populated and status computed", () => {
    expect(body.robustness_status).toBe('computed');
    expect(body.robustness).toBeDefined();
    expect(body.robustness.fragile_edges.length).toBe(7);
    expect(body.robustness.robust_edges.length).toBe(4);
    // V2 summary passthrough
    expect(body.robustness.is_robust).toBe(false);
    expect(body.robustness.level).toBe('low');
    expect(typeof body.robustness.confidence).toBe('number');
  });

  it("analysis_types 'sensitivity' (factor-level) → factor_sensitivity non-empty and drivers computed", () => {
    expect(body.drivers_status).toBe('computed');
    expect(Array.isArray(body.factor_sensitivity)).toBe(true);
    expect(body.factor_sensitivity.length).toBeGreaterThan(0);
  });

  it("analysis_types 'sensitivity' (edge-level) → empty ONLY WITH the explicit V2-wire marker", () => {
    // The V2 wire genuinely drops edge-level sensitivity (no substitute is
    // invented — ISL contract followup). Empty is tolerable ONLY because it
    // is explicitly marked; a silent empty array fails here.
    expect(Array.isArray(body.edge_sensitivity)).toBe(true);
    if (body.edge_sensitivity.length === 0) {
      const marker = (body.inference_warnings ?? []).filter(
        (w: any) => w.code === 'EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE',
      );
      expect(marker).toHaveLength(1);
      expect(marker[0].severity).toBe('info');
    }
  });

  it('include_e_values → edge_e_values NON-EMPTY (the pre-fix silent-empty defect)', () => {
    // RED before the V2-envelope fix: the old read targeted top-level
    // edge_e_values, which the live V2 wire never emits → always [].
    expect(Array.isArray(body.edge_e_values)).toBe(true);
    // 13 wire entries; the 4 is_unflippable entries carry no e_value on the
    // wire and are dropped by the numeric-egress guard (logged, followup).
    expect(body.edge_e_values.length).toBe(9);
    for (const e of body.edge_e_values) {
      expect(typeof e.edge_id).toBe('string');
      expect(e.edge_id).toContain('::');
      expect(typeof e.from_label).toBe('string');
      expect(typeof e.to_label).toBe('string');
      expect(Number.isFinite(e.e_value)).toBe(true);
      expect(Number.isFinite(e.current_mean)).toBe(true);
      expect(Number.isFinite(e.flip_mean)).toBe(true);
    }
  });

  it('include_voi → factor VOI present via graph heuristic OR explicitly absent with zero_reason', () => {
    // VOI on the live wire arrives ONLY as factor_evpi (not wired to users —
    // P-5 pending). The public value_of_information comes from the graph
    // heuristic; every factor entry must either carry a VOI value or carry an
    // explicit zero_reason — silent absence on every entry fails.
    const withVoi = body.factor_sensitivity.filter(
      (f: any) => typeof f.value_of_information === 'number',
    );
    const explained = body.factor_sensitivity.filter(
      (f: any) => f.value_of_information == null && f.zero_reason != null,
    );
    expect(withVoi.length + explained.length).toBe(body.factor_sensitivity.length);
    expect(withVoi.length).toBeGreaterThan(0);
  });

  it('meta.computed_at carries the ISL wire timestamp (V2 `timestamp`, not PLoT clock)', () => {
    expect(body.meta.computed_at).toBe('2026-07-06T23:32:39.636888Z');
  });

  // -------------------------------------------------------------------------
  // Item C: negative-EVPI hygiene at the PLoT surface
  // -------------------------------------------------------------------------

  it('no negative EVPI/VOI value anywhere in the public response', () => {
    const fields = collectFields(body, (k) =>
      k === 'evpi' ||
      k === 'evpi_percentage_points' ||
      k === 'value_of_information',
    );
    for (const [path, value] of fields) {
      if (typeof value === 'number') {
        expect(value, `${path} must never be negative`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('raw factor_evpi never leaks into the public response (flag off — P-5 pending)', () => {
    expect(collectFields(body, (k) => k === 'factor_evpi')).toHaveLength(0);
    // The raw negative wire EVPI values must not appear under any EVPI/VOI
    // key anywhere in the payload. (NOTE: a plain substring check would
    // false-positive — the graph legitimately carries an edge mean of -0.15;
    // the leak check must be structural, keyed to EVPI/VOI fields.)
    const evpiFields = collectFields(body, (k) =>
      k === 'evpi' || k === 'evpi_percentage_points' || k === 'value_of_information' ||
      k === 'raw_evpi' || k === 'raw_evpi_percentage_points',
    );
    for (const [path, value] of evpiFields) {
      expect(value, `${path} must not carry the raw wire negatives`).not.toBe(-0.0015);
      expect(value, `${path} must not carry the raw wire negatives`).not.toBe(-0.15);
    }
  });

  // -------------------------------------------------------------------------
  // Item D: confidence_tier reconciliation on a non-robust response
  // -------------------------------------------------------------------------

  it("confidence_tier is never 'strong' when the same response says is_robust=false / level=low", () => {
    // This capture is the contradiction case: is_robust=false, level='low'.
    if (body.confidence_tier !== undefined) {
      expect(body.confidence_tier).not.toBe('strong');
    }
    // Sanity: the robustness signals the cap keys off are present
    expect(body.robustness.is_robust).toBe(false);
    expect(body.robustness.level).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// Item F: CONSTRAINT_SAMPLES_UNNOISED tolerance (fresh server, same fixture)
// ---------------------------------------------------------------------------

describe('CONSTRAINT_SAMPLES_UNNOISED warning tolerance', () => {
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
    injectWarning = null;
  });

  it('passes the new ISL warning code through without crash or drop', async () => {
    injectWarning = {
      code: 'CONSTRAINT_SAMPLES_UNNOISED',
      message: 'Constraint node samples were not auto-noised for this run',
      severity: 'info',
    };
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v2/run',
        headers: { 'Content-Type': 'application/json' },
        payload: buildPlotBody(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const forwarded = (body.inference_warnings ?? []).filter(
        (w: any) => w.code === 'CONSTRAINT_SAMPLES_UNNOISED',
      );
      expect(forwarded).toHaveLength(1);
      expect(forwarded[0]).toEqual({
        code: 'CONSTRAINT_SAMPLES_UNNOISED',
        message: 'Constraint node samples were not auto-noised for this run',
        severity: 'info',
      });
      // The rest of the science payload is unaffected (no drop)
      expect(body.analysis_status).toBe('computed');
      expect(body.edge_e_values.length).toBe(9);
      expect(body.option_comparison.length).toBe(4);
    } finally {
      injectWarning = null;
    }
  }, 60_000);

  it('unknown severity values degrade to info, never crash', async () => {
    injectWarning = {
      code: 'CONSTRAINT_SAMPLES_UNNOISED',
      message: 'Constraint node samples were not auto-noised for this run',
      severity: 'bizarre_future_severity',
    };
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v2/run',
        headers: { 'Content-Type': 'application/json' },
        payload: buildPlotBody(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const forwarded = (body.inference_warnings ?? []).filter(
        (w: any) => w.code === 'CONSTRAINT_SAMPLES_UNNOISED',
      );
      expect(forwarded).toHaveLength(1);
      expect(forwarded[0].severity).toBe('info');
    } finally {
      injectWarning = null;
    }
  }, 60_000);
});
