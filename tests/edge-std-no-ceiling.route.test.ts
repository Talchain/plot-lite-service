/**
 * ⭐ AIQ RULING (olumi-programme-docs#72 5869431686 §2) — ASSERTED ON THE ISL WIRE, on A's served price twin.
 *
 * WIRE EVIDENCE. AIQ's contract probe (test F, PLoT ccd602c · ISL a1fa8ae, report-A-20260928T115454Z) doubled
 * `pro_plan_price`'s frame on Paul's journey-A capture and PLoT answered with
 * `repairs_applied pro_plan_price::mrr.strength.std 0.5 → 0.4`: the 0.4 CEILING in `graph-normaliser.ts` cut 20% of
 * a spread CEE had stated. RULING: remove the ceiling; ISL needs only std > 0.001; the floor stays.
 *
 * `tests/fixtures/paul-own-a295e4a1-20260927/cee-to-plot.request.json` is byte-identical to the probe's body A
 * (sha256 8bc6f257…, asserted below). The twin is built here with the probe's own `rescale_frame` rule for a RAW
 * request (X.cap ×2; X.observed_state value/baseline/std ÷2; strengths OUT of X ×2, INTO X ÷2; interventions raw,
 * unchanged), so `pro_plan_price -> mrr` becomes {mean 1, std 0.5} — CEE's own |mean| 1 shape.
 *
 * This suite POSTs the twin to the REAL `/v2/run` route with ISL mocked (the pattern of
 * `intervention-frame-rung.route.test.ts`) and reads the std ISL was handed on that edge, by identity (from/to).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/** Every ISL analysis call, in call order. THE WIRE. */
let islBodies: any[] = [];

function optionResults(options: any[]) {
  return options.map((opt: any, idx: number) => ({
    option_id: opt.id,
    outcome: {
      mean: 0.6 + idx * 0.01, std: 0.1, p10: 0.5, p50: 0.6, p90: 0.7,
      n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0,
    },
    rank: idx + 1,
  }));
}

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [],
      backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock validation', reasoning: 'Test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseRobustness(graph: any, goalNodeId: string, options: any[], _t?: any, constraints?: any[]) {
    islBodies.push({ graph, goal_node_id: goalNodeId, options, goal_constraints: constraints ?? [] });
    return {
      options: optionResults(options),
      edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factors: [], value_of_information: [], factors_provenance: 'unavailable' as const,
      factor_sensitivity_status: 'skipped_no_factor_values' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.8,
      fragile_edges: [], robust_edges: [], latency_ms: 50, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return {
      factors: [], value_of_information: [], robustness_label: 'robust' as const,
      robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const,
    };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    islBodies.push(body);
    return {
      data: {
        options: optionResults(body.options || []),
        edges: [], factors: [], value_of_information: [],
        overall_robustness: 'robust', robustness_score: 0.8,
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

const FIXTURE = resolve(__dirname, 'fixtures/paul-own-a295e4a1-20260927/cee-to-plot.request.json');
/** AIQ contract probe body A (`report-A-20260928T115454Z.json` → `source_sha256`). */
const PROBE_BODY_A_SHA256 = '8bc6f2570726221c7f8df0444ab2248456139ab5a095706a6ebd956a9b48b39f';

/** AIQ `contract_probe.py` `rescale_frame(body, nid, r)`, RAW-request branch (A is raw: interventions 49/54/59). */
function rescaleFrame(body: any, nid: string, r: number): any {
  const b = JSON.parse(JSON.stringify(body));
  const node = b.graph.nodes.find((n: any) => n.id === nid);
  const os = node.observed_state ?? {};
  if (os.cap) os.cap = os.cap * r; else node.scale_frame = node.scale_frame * r;
  for (const k of ['value', 'baseline', 'std']) if (typeof os[k] === 'number') os[k] = os[k] / r;
  for (const e of b.graph.edges) {
    const s = e.strength ?? {};
    const f = e.from === nid ? r : e.to === nid ? 1 / r : null;
    if (f === null || e.from === e.to) continue;
    for (const k of ['mean', 'std']) if (typeof s[k] === 'number') s[k] = s[k] * f;
  }
  return b;
}

function priceTwin(): any {
  const raw = readFileSync(FIXTURE);
  expect(createHash('sha256').update(raw).digest('hex'), 'the fixture is AIQ\'s probe body A').toBe(PROBE_BODY_A_SHA256);
  return rescaleFrame(JSON.parse(raw.toString('utf8')), 'pro_plan_price', 2);
}

/** The strength ISL was handed on `from -> to`, on every recorded call. */
function wireStrengths(from: string, to: string): Array<{ mean: number; std: number }> {
  expect(islBodies.length, 'ISL must have been called').toBeGreaterThan(0);
  return islBodies.map((body) => {
    const e = (body.graph?.edges ?? []).find((x: any) => x.from === from && x.to === to);
    expect(e, `${from} -> ${to} must reach the ISL wire`).toBeDefined();
    return e.strength;
  });
}

/**
 * Every served repair on `edgeId`'s std, bound by the edge's identity (`from::to`). On `/v2/run` the normaliser's
 * CLAMP_STRENGTH_STD reaches `_meta.repairs_applied` upcast to `code: LEGACY_REPAIR` (`normaliseRepairsForMeta`), so
 * the edge's field path and the `clamped` action are the identity on the wire — exactly what AIQ's probe read.
 */
const stdRepairsOn = (body: any, edgeId: string) =>
  (body._meta?.repairs_applied ?? []).filter((r: any) => r.field_path === `${edgeId}.strength.std`);
const stdClampsOn = (body: any, edgeId: string) => stdRepairsOn(body, edgeId).filter((r: any) => r.action === 'clamped');

describe("route — A's served price twin: an edge std of 0.5 at |mean| 1 reaches ISL as 0.5", () => {
  let app: FastifyInstance;
  let baseUrl: string;

  async function run(payload: any) {
    islBodies = [];
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
    return res.json();
  }

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  }, 60_000);

  afterAll(async () => { await app?.close(); });

  it('PRECONDITION — the twin carries pro_plan_price -> mrr at {mean 1, std 0.5}, inside the ±1 mean contract', () => {
    const twin = priceTwin();
    const e = twin.graph.edges.find((x: any) => x.from === 'pro_plan_price' && x.to === 'mrr');
    expect(e.strength).toEqual({ mean: 1, std: 0.5 });
    for (const x of twin.graph.edges) expect(Math.abs(x.strength.mean)).toBeLessThanOrEqual(1);
  });

  it('RED→GREEN — no CLAMP_STRENGTH_STD (no std repair at all) on pro_plan_price::mrr, and ISL is handed std 0.5', async () => {
    const body = await run(priceTwin());
    expect(stdRepairsOn(body, 'pro_plan_price::mrr')).toEqual([]);
    for (const s of wireStrengths('pro_plan_price', 'mrr')) expect(s).toEqual({ mean: 1, std: 0.5 });
  });

  it('CONTROL (floor, same run) — the twin\'s option edge 146aa89d -> pro_plan_price (std 0.005) is still floored to 0.01', async () => {
    const body = await run(priceTwin());
    const clamps = stdClampsOn(body, '146aa89d::pro_plan_price');
    expect(clamps).toHaveLength(1);
    expect(clamps[0]).toMatchObject({ before: 0.005, after: 0.01 });
    // Option edges are carried to ISL as interventions, not graph edges, so the floor is read from the served repair.
  });

  it('CONTRAST (same twin) — pro_plan_price -> monthly_new_pro_subscribers at exactly 0.4 reaches ISL unrepaired, {−0.8, 0.4}', async () => {
    const body = await run(priceTwin());
    expect(stdRepairsOn(body, 'pro_plan_price::monthly_new_pro_subscribers')).toEqual([]);
    for (const s of wireStrengths('pro_plan_price', 'monthly_new_pro_subscribers')) expect(s).toEqual({ mean: -0.8, std: 0.4 });
  });

  it('CONTRAST — the untwinned capture sends pro_plan_price -> mrr as stated, {0.5, 0.25}', async () => {
    const body = await run(JSON.parse(readFileSync(FIXTURE, 'utf8')));
    expect(stdRepairsOn(body, 'pro_plan_price::mrr')).toEqual([]);
    for (const s of wireStrengths('pro_plan_price', 'mrr')) expect(s).toEqual({ mean: 0.5, std: 0.25 });
  });
});
