/**
 * A3 "one unit and frame" — ASSERTED ON THE ISL WIRE, on Paul's own graph.
 *
 * `tests/fixtures/paul-own-a295e4a1-20260927/cee-to-plot.request.json` is MG's
 * byte-for-byte capture of the CEE→PLoT `/v2/run` body for Paul's graph
 * a295e4a1 (CEE's real run loader + run_analysis handler, fake PLoT client).
 * `CAPTURED-BEFORE.plot-to-isl.request.json` is what PLoT 1f6ad52 then handed
 * ISL (local PLoT, ISL capture proxy): the retention and conversion options
 * reached ISL at the [0,1] RAIL — `monthly_churn: 1`, `monthly_new_pro_subscribers: 1`.
 *
 * This suite POSTs the captured body to the REAL `/v2/run` route with ISL
 * mocked (the pattern of `constraint-percent-target-frame.route.test.ts`) and
 * reads what the translator handed ISL. The raw node's `scale_frame` capture
 * and its hand-off into Phase 4a live in the route, so both are inside the test.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Every ISL analysis body, in call order. THE WIRE. */
let islBodies: any[] = [];

function echoConstraintAnalysis(goalConstraints: any[] | undefined) {
  if (!goalConstraints || goalConstraints.length === 0) return undefined;
  return {
    constraints: goalConstraints.map((c: any) => ({
      constraint_id: c.constraint_id,
      node_id: c.node_id,
      operator: c.operator,
      value: c.value,
      prob_satisfied: 0.8,
      failure_margin_median: 0.01,
      near_miss_fraction: 0.1,
      binding: false,
    })),
    joint_probability: 0.8,
    conditional_probabilities: null,
  };
}

function optionResults(options: any[], goalConstraints?: any[]) {
  const ca = echoConstraintAnalysis(goalConstraints);
  return options.map((opt: any, idx: number) => ({
    option_id: opt.id,
    outcome: {
      mean: 0.6 + idx * 0.01, std: 0.1, p10: 0.5, p50: 0.6, p90: 0.7,
      n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0,
    },
    rank: idx + 1,
    ...(ca && { constraint_analysis: ca }),
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
      options: optionResults(options, constraints),
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
        options: optionResults(body.options || [], body.goal_constraints),
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

const FIXTURE_DIR = resolve(__dirname, 'fixtures/paul-own-a295e4a1-20260927');

function paulRequest(): any {
  return JSON.parse(readFileSync(resolve(FIXTURE_DIR, 'cee-to-plot.request.json'), 'utf8'));
}

function capturedBefore(): any {
  return JSON.parse(readFileSync(resolve(FIXTURE_DIR, 'CAPTURED-BEFORE.plot-to-isl.request.json'), 'utf8'));
}

/** The level ISL was handed for `optionId`/`factorId` on every recorded call (all must agree). */
function wireLevels(optionId: string, factorId: string): number[] {
  expect(islBodies.length, 'ISL must have been called').toBeGreaterThan(0);
  const seen: number[] = [];
  for (const body of islBodies) {
    const opt = (body.options ?? []).find((o: any) => o.id === optionId);
    expect(opt, `${optionId} must reach the ISL wire`).toBeDefined();
    const iv = opt.interventions?.[factorId];
    const level = typeof iv === 'number' ? iv : iv?.value;
    expect(typeof level, `${optionId}.${factorId} must be a number on the wire`).toBe('number');
    seen.push(level);
  }
  return seen;
}

function wireConstraint(id: string): any[] {
  expect(islBodies.length).toBeGreaterThan(0);
  return islBodies.map((b) => (b.goal_constraints ?? []).find((c: any) => c.constraint_id === id));
}

describe("route — Paul's retention and conversion reach ISL on their node's frame", () => {
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

  it('PRECONDITION — the captured BEFORE wire sent both framed options at the 1.0 rail', () => {
    const before = capturedBefore();
    const byId = new Map(before.options.map((o: any) => [o.id, o.interventions]));
    expect(byId.get('ca47b368')).toEqual({ monthly_churn: 1 });
    expect(byId.get('6dbac00d')).toEqual({ monthly_new_pro_subscribers: 1 });
  });

  it('RED→GREEN — retention reaches ISL at churn 0.025; conversion at new subscribers 0.09', async () => {
    const body = await run(paulRequest());
    for (const v of wireLevels('ca47b368', 'monthly_churn')) expect(v).toBe(0.025);
    for (const v of wireLevels('6dbac00d', 'monthly_new_pro_subscribers')) expect(v).toBe(0.09);
    const repairs = body._meta?.repairs_applied ?? [];
    expect(repairs.find((r: any) => r.field === 'intervention.value.monthly_churn' && r.action === 'normalised')).toMatchObject({
      from_value: 2.5, to_value: 0.025, reason: 'normalised range=[0,100] source=scale_frame',
    });
    expect(repairs.find((r: any) => r.field === 'intervention.value.monthly_new_pro_subscribers' && r.action === 'normalised')).toMatchObject({
      from_value: 90, to_value: 0.09, reason: 'normalised range=[0,1000] source=scale_frame',
    });
    expect(repairs.filter((r: any) => r.action === 'clamped')).toEqual([]);
  });

  it('CONTRAST — the price options reach ISL byte-identical to the captured BEFORE wire', async () => {
    await run(paulRequest());
    const before = capturedBefore();
    const priceIds = ['keep_current_49_price', 'increase_price_to_59', 'increase_price_to_54'];
    for (const body of islBodies) {
      for (const id of priceIds) {
        const now = (body.options ?? []).find((o: any) => o.id === id);
        const then = before.options.find((o: any) => o.id === id);
        expect(then, `${id} in the BEFORE capture`).toBeDefined();
        expect(JSON.stringify(now?.interventions), id).toBe(JSON.stringify(then.interventions));
      }
    }
  });

  it("the churn limit (<= 4 '%') is scored on the SAME [0,100] scale as the churn samples: 0.04, not the clamped 1", async () => {
    const body = await run(paulRequest());
    for (const c of wireConstraint('agent-lane:monthly_churn:<=')) {
      expect(c, 'the churn limit reaches ISL').toBeDefined();
      expect(c.value).toBe(0.04);
    }
    const repair = (body._meta?.repairs_applied ?? []).find((r: any) => r.field === 'constraint.value.agent-lane:monthly_churn:<=');
    expect(repair).toMatchObject({ action: 'normalised', from_value: 4, to_value: 0.04, reason: 'normalised range=[0,100] source=scale_frame' });
    // (This mock yields `constraints_status: 'unavailable'` for this graph at
    // base AND with the fix, so the trust marker is not asserted here; by code,
    // `scale_frame` is outside DECISION_GRADE_SOURCES and fails closed.)
  });

  it('the ROUTE passes the raw scale_frame into Phase 4a: churn with scale_frame but NO pair still reaches 0.025', async () => {
    const req = paulRequest();
    const churn = req.graph.nodes.find((n: any) => n.id === 'monthly_churn');
    delete churn.observed_state.raw_value;
    expect(churn.scale_frame, 'precondition: scale_frame is the only frame carrier').toBe(100);
    expect(churn.observed_state.cap).toBeUndefined();
    await run(req);
    for (const v of wireLevels('ca47b368', 'monthly_churn')) expect(v).toBe(0.025);
  });

  it('with NO scale_frame on the wire, the pair alone carries the frame: 0.025 / 0.09', async () => {
    const req = paulRequest();
    for (const n of req.graph.nodes) delete n.scale_frame;
    const body = await run(req);
    for (const v of wireLevels('ca47b368', 'monthly_churn')) expect(v).toBe(0.025);
    for (const v of wireLevels('6dbac00d', 'monthly_new_pro_subscribers')) expect(v).toBe(0.09);
    const repairs = body._meta?.repairs_applied ?? [];
    expect(repairs.find((r: any) => r.field === 'intervention.value.monthly_churn' && r.action === 'normalised')?.reason)
      .toBe('normalised range=[0,100] source=pair_frame');
  });

  it('CLAMP DISCLOSED on the route — an out-of-frame retention level (churn 150 on frame 100) carries a typed clamped repair', async () => {
    const req = paulRequest();
    req.options.find((o: any) => o.id === 'ca47b368').interventions.monthly_churn = 150;
    const body = await run(req);
    for (const v of wireLevels('ca47b368', 'monthly_churn')) expect(v).toBe(1);
    const clamps = (body._meta?.repairs_applied ?? []).filter((r: any) => r.action === 'clamped');
    expect(clamps).toHaveLength(1);
    expect(clamps[0]).toMatchObject({
      field: 'intervention.value.monthly_churn',
      action: 'clamped',
      from_value: 150,
      to_value: 1,
      reason: 'option=ca47b368 normalised range=[0,100] source=scale_frame (clamped)',
    });
  });
});
