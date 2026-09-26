/**
 * A '%' LIMIT IS READ ON ITS TARGET'S OWN FRAME — ASSERTED ON THE ISL WIRE.
 *
 * The four requests are AI Quality's captured contrast rows
 * (`tests/fixtures/pct-cap-contrast-20260926/`, olumi-programme-docs#69
 * comment 5843365832), POSTed verbatim to the real `/v2/run` route with ISL
 * mocked the way the other constraint route suites mock it. Every assertion
 * reads what the translator actually handed ISL, or what the route returned —
 * so the invocation decision (which lives in the route, not the normaliser) and
 * the raw-node `scale_frame` capture are both inside the test.
 *
 * WIRE BEFORE (captured, PLoT b09c0f2): all four rows sent `gc_churn` as 0.1,
 * `unit_percent`, `decision_grade: true`; P(meet) 1 / 0.017 / 0.017 / 1.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Every `goal_constraints` array ISL was handed, in call order. THE WIRE. */
let islRequests: any[][] = [];

function echoConstraintAnalysis(goalConstraints: any[] | undefined) {
  if (!goalConstraints || goalConstraints.length === 0) return undefined;
  return {
    constraints: goalConstraints.map((c: any) => ({
      constraint_id: c.constraint_id,
      node_id: c.node_id,
      operator: c.operator,
      value: c.value,
      prob_satisfied: 0.8,
      failure_margin_median: 0.04,
      near_miss_fraction: 0.1,
      binding: false,
    })),
    joint_probability: 0.75,
    conditional_probabilities: null,
  };
}

function optionResults(options: any[], goalConstraints: any[] | undefined) {
  const ca = echoConstraintAnalysis(goalConstraints);
  return options.map((opt: any, idx: number) => ({
    option_id: opt.id,
    outcome: {
      mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9,
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
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[], _t?: any, constraints?: any[]) {
    islRequests.push(constraints ?? []);
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
    islRequests.push(body.goal_constraints ?? []);
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

const FIXTURE_DIR = resolve(__dirname, 'fixtures/pct-cap-contrast-20260926');

function corpus(variant: string): any {
  return JSON.parse(readFileSync(resolve(FIXTURE_DIR, `${variant}.request.json`), 'utf8'));
}

function churnOf(req: any): any {
  const n = req.graph.nodes.find((x: any) => x.id === 'fac_churn');
  expect(n, 'fac_churn must exist in the corpus row').toBeDefined();
  return n;
}

/** The value ISL was handed for `id` on every recorded call (must be the same on each). */
function wireValues(id: string): number[] {
  expect(islRequests.length).toBeGreaterThan(0);
  const seen: number[] = [];
  for (const sentBatch of islRequests) {
    const row = sentBatch.find((c: any) => c.constraint_id === id);
    expect(row, `${id} must reach the ISL wire`).toBeDefined();
    seen.push(row.value);
  }
  return seen;
}

function neverOnWire(id: string): void {
  expect(islRequests.length).toBeGreaterThan(0);
  for (const sentBatch of islRequests) {
    expect(sentBatch.find((c: any) => c.constraint_id === id), `${id} must NOT reach ISL`).toBeUndefined();
  }
}

describe("route — a '%' limit on a ROOT '%' factor is read on the factor's own frame", () => {
  let app: FastifyInstance;
  let baseUrl: string;

  async function run(payload: any) {
    islRequests = [];
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
    return res.json();
  }

  function provenanceOf(body: any, id: string): any[] {
    return (body.constraint_results ?? [])
      .filter((r: any) => r.constraint_id === id)
      .map((r: any) => r.scale_provenance);
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

  it('CONTROL — framed on 100 (both levels): 0.1 on the wire, unit_percent, decision-grade', async () => {
    for (const variant of ['lvl4_cap100', 'lvl12_cap100']) {
      const body = await run(corpus(variant));
      for (const v of wireValues('gc_churn')) expect(v, variant).toBeCloseTo(0.1, 12);
      const prov = provenanceOf(body, 'gc_churn');
      expect(prov.length, variant).toBeGreaterThan(0);
      for (const p of prov) expect(p, variant).toEqual({ source: 'unit_percent', range_unified: true, decision_grade: true });
      expect(body.constraints_status, variant).toBe('computed');
      expect(body._meta?.filtered_constraints, variant).toBeUndefined();
    }
  });

  it('framed on 20: the wire threshold is 10/20 = 0.5, not 0.1', async () => {
    const req = corpus('lvl4_cap20');
    const cap = churnOf(req).observed_state.cap;
    const body = await run(req);
    for (const v of wireValues('gc_churn')) {
      expect(v).toBe(10 / cap);
      expect(v).toBe(0.5);
    }
    const repair = (body._meta?.repairs_applied ?? []).find((r: any) => r.field === 'constraint.value.gc_churn');
    expect(repair).toMatchObject({ action: 'normalised', from_value: 10, to_value: 0.5, reason: 'normalised range=[0,20] source=unit_percent' });
  });

  it('framed on 200: the wire threshold is 10/200 = 0.05, not 0.1', async () => {
    const req = corpus('lvl12_cap200');
    const cap = churnOf(req).observed_state.cap;
    const body = await run(req);
    for (const v of wireValues('gc_churn')) {
      expect(v).toBe(10 / cap);
      expect(v).toBe(0.05);
    }
    // The node sits at 12/200 = 0.06 — ABOVE the threshold: the broken limit is now visible to ISL.
    expect(churnOf(req).observed_state.value).toBeGreaterThan(0.05);
    expect(body.constraints_status).toBe('computed');
  });

  it('the node scale_frame is read off the RAW request node: frame 20, no cap → 0.5', async () => {
    const req = corpus('lvl4_cap20');
    const churn = churnOf(req);
    churn.observed_state = { value: 0.2, raw_value: 4, unit: '%', std: 0.05 };
    churn.scale_frame = 20;
    await run(req);
    for (const v of wireValues('gc_churn')) expect(v).toBe(0.5);
  });

  it("CONTROL — Paul's churn shape (scale_frame 100, '% per month', no cap): 0.1, decision-grade", async () => {
    const req = corpus('lvl4_cap100');
    const churn = churnOf(req);
    churn.observed_state = { value: 0.07, raw_value: 7, unit: '% per month' };
    churn.scale_frame = 100;
    const body = await run(req);
    for (const v of wireValues('gc_churn')) expect(v).toBeCloseTo(0.1, 12);
    for (const p of provenanceOf(body, 'gc_churn')) {
      expect(p).toEqual({ source: 'unit_percent', range_unified: true, decision_grade: true });
    }
  });

  it("MISMATCH — a '%' limit on a £-framed root: withheld with the typed reason, never scored", async () => {
    const req = corpus('lvl4_cap20');
    churnOf(req).observed_state = { value: 0.4, raw_value: 200000, cap: 500000, unit: '£', std: 0.05 };
    const body = await run(req);
    neverOnWire('gc_churn');
    expect(provenanceOf(body, 'gc_churn')).toEqual([]);
    expect(
      (body.constraint_results ?? []).some((r: any) => r.scale_provenance?.decision_grade === true),
    ).toBe(false);
    expect(body._meta?.filtered_constraints).toEqual([
      { constraint_id: 'gc_churn', node_id: 'fac_churn', reason: 'percent_unit_disagrees_with_target_frame' },
    ]);
    expect(body.constraints_status).toBe('unavailable');
    const c = (body.critiques ?? []).find((x: any) => x.code === 'CONSTRAINT_REFUSED_FRAME_FIDELITY');
    expect(c).toBeDefined();
    expect(c.affected_node_ids).toEqual(['fac_churn']);
    expect(c.message).toContain('[gc_churn]');
    // It is not a delta — the delta copy must not be what explains it.
    expect(c.message).not.toContain("a 'delta'");
  });

  it('MISMATCH beside a delivering sibling: only the % limit is withheld; the £ limit is still computed', async () => {
    // 2.878 F1's harm, re-checked for the new reason: a constraint dropped from
    // the ISL payload but left in the active list makes the count guard report
    // ZERO results. The sibling must still deliver.
    const req = corpus('lvl4_cap20');
    churnOf(req).observed_state = { value: 0.2, raw_value: 4, cap: 20, unit: 'count', std: 0.05 };
    req.goal_constraints.push({ constraint_id: 'gc_u3b', node_id: 'fac_cost', operator: '<=', value: 250000, unit: '£', value_frame: 'level' });
    const body = await run(req);
    neverOnWire('gc_churn');
    for (const v of wireValues('gc_u3b')) expect(v).toBe(0.5);
    expect(body.constraints_status).toBe('computed');
    expect(new Set((body.constraint_results ?? []).map((r: any) => r.constraint_id))).toEqual(new Set(['gc_u3b']));
    expect(body._meta?.filtered_constraints).toEqual([
      { constraint_id: 'gc_churn', node_id: 'fac_churn', reason: 'percent_unit_disagrees_with_target_frame' },
    ]);
  });

  it('a delta refusal and a % frame refusal in one run: one critique each, each naming only its own', async () => {
    const req = corpus('delta_cap20');
    // A second, level '%' limit on a £-framed node the delta corpus also carries.
    req.goal_constraints.push({ constraint_id: 'gc_cost_pct', node_id: 'fac_cost', operator: '<=', value: 10, unit: '%', value_frame: 'level' });
    const body = await run(req);
    neverOnWire('gc_churn_rise');
    neverOnWire('gc_cost_pct');
    expect(body._meta?.filtered_constraints).toEqual([
      { constraint_id: 'gc_churn_rise', node_id: 'fac_churn', reason: 'delta_frame_value_altered_by_normalisation' },
      { constraint_id: 'gc_cost_pct', node_id: 'fac_cost', reason: 'percent_unit_disagrees_with_target_frame' },
    ]);
    const c = (body.critiques ?? []).filter((x: any) => x.code === 'CONSTRAINT_REFUSED_FRAME_FIDELITY');
    expect(c).toHaveLength(2);
    const delta = c.find((x: any) => x.message.includes("a 'delta'"));
    const pct = c.find((x: any) => x.message.includes('stated in percent'));
    expect(delta.message.startsWith('1 constraint(s) were not evaluated: [gc_churn_rise]. ')).toBe(true);
    expect(delta.affected_node_ids).toEqual(['fac_churn']);
    expect(pct.message.startsWith('1 constraint(s) were not evaluated: [gc_cost_pct]. ')).toBe(true);
    expect(pct.affected_node_ids).toEqual(['fac_cost']);
  });

  it('MISMATCH — an undeclared unit framed on 20: withheld, never scored', async () => {
    const req = corpus('lvl4_cap20');
    churnOf(req).observed_state = { value: 0.2, raw_value: 4, cap: 20, std: 0.05 };
    const body = await run(req);
    neverOnWire('gc_churn');
    expect(body._meta?.filtered_constraints).toEqual([
      { constraint_id: 'gc_churn', node_id: 'fac_churn', reason: 'percent_unit_disagrees_with_target_frame' },
    ]);
  });

  it('PRECONDITION: a lone sub-1 row on this corpus is genuinely GATE-CLOSED (non-% 0.9 goes raw)', async () => {
    const req = corpus('lvl4_cap20');
    req.goal_constraints = [{ constraint_id: 'gc_churn', node_id: 'fac_churn', operator: '<=', value: 0.9, unit: 'count', value_frame: 'level' }];
    await run(req);
    for (const v of wireValues('gc_churn')) expect(v).toBe(0.9);
  });

  it("gate-closed: 0.04 '%' (four percent) alone on the frame-20 root reaches ISL as 0.2", async () => {
    const req = corpus('lvl4_cap20');
    req.goal_constraints = [{ constraint_id: 'gc_churn', node_id: 'fac_churn', operator: '<=', value: 0.04, unit: '%', value_frame: 'level' }];
    await run(req);
    for (const v of wireValues('gc_churn')) expect(v).toBeCloseTo(0.2, 12);
  });

  it('CONTROL — the delta contrast rows are refused for frame fidelity on both frames, delta copy unchanged', async () => {
    for (const variant of ['delta_cap100', 'delta_cap20']) {
      const body = await run(corpus(variant));
      neverOnWire('gc_churn_rise');
      expect(body._meta?.filtered_constraints, variant).toEqual([
        { constraint_id: 'gc_churn_rise', node_id: 'fac_churn', reason: 'delta_frame_value_altered_by_normalisation' },
      ]);
      const c = (body.critiques ?? []).filter((x: any) => x.code === 'CONSTRAINT_REFUSED_FRAME_FIDELITY');
      expect(c, variant).toHaveLength(1);
      expect(c[0].message, variant).toBe(
        "1 constraint(s) were not evaluated: [gc_churn_rise]. Each states a CHANGE (a 'delta'), and the scale this " +
          'graph resolves for its target node cannot carry that change without altering the amount stated. Rather ' +
          'than ask the engine a different question, the constraint was left out of the analysis.',
      );
    }
  });

  it("CONTROL — the corpus base limit (U3b: <= 250000 '£' on fac_cost) is unchanged: 0.5, explicit_cap", async () => {
    const req = corpus('lvl4_cap20');
    req.goal_constraints = [{ constraint_id: 'gc_u3b', node_id: 'fac_cost', operator: '<=', value: 250000, unit: '£', value_frame: 'level' }];
    const body = await run(req);
    for (const v of wireValues('gc_u3b')) expect(v).toBe(0.5);
    for (const p of provenanceOf(body, 'gc_u3b')) {
      expect(p).toEqual({ source: 'explicit_cap', range_unified: true, decision_grade: true });
    }
  });
});
