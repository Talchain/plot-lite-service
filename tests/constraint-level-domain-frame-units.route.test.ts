/**
 * A '%' LIMIT'S LEVEL DOMAIN IS 0–100% ON EVERY FRAME — SENT IN THE TARGET'S OWN
 * NORMALISED UNITS. Asserted on the ISL wire through the real `POST /v2/run`.
 *
 * THE RULING (AI Quality, olumi-programme-docs#72 5870377659, "ISL #196"):
 * a percentage's possible levels are 0–100% whatever the node's frame. The '%'
 * rung reads a limit on the target's OWN frame (`resolvePercentTargetFrame`), so
 * on a 20-point frame the normalised level 1.0 is 20% and 100% sits at 5.0.
 * `levelDomainFor` sent `{0, 1}` there: a domain that says "churn cannot exceed
 * 20%". ISL counts every draw above it as impossible (`level_out_of_domain_fraction`,
 * AIQ's 20-point probe read 0.49), and PLoT's release gate (ii) then withdraws
 * the limit's grade on levels that are perfectly possible. The fix: `{0, 100/extent}`
 * (`{0, 5}` on 20 points, `{0, 1}` on 100 — byte-identical there).
 *
 * The mock mirrors ISL's `_level_out_of_domain_fraction`
 * (`robustness_analyzer_v2.py`, ISL staging e24c88c): the share of a scenario's
 * normalised draws outside the `level_domain` the REQUEST row carried, emitted
 * only for a 'level' row that carried one. So a gate verdict below is caused by
 * the domain PLoT sent, never by a number the test chose per build.
 *
 * Corpus: AI Quality's captured contrast rows (`fixtures/pct-cap-contrast-20260926`),
 * the same requests `constraint-percent-target-frame.route.test.ts` POSTs.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Per option id: the target's NORMALISED level draws the mock judges the sent domain against. */
let draws: Record<string, number[]> = {};
/** Every `goal_constraints` array ISL was handed, in call order. THE WIRE. */
let islRequests: any[][] = [];

/** ISL's `_level_out_of_domain_fraction`, verbatim in logic: undefined unless a 'level' row carried a domain. */
function outOfDomainFraction(optionId: string, c: any): number | undefined {
  const domain = c.level_domain;
  const levels = draws[optionId];
  if (domain === undefined || c.value_frame !== 'level' || levels === undefined || levels.length === 0) return undefined;
  const outside = levels.filter((l) => (domain.min !== undefined && l < domain.min) || (domain.max !== undefined && l > domain.max));
  return outside.length / levels.length;
}

const WIN: Record<string, number> = { opt_raise: 0.6, opt_hold: 0.4 };

function optionResults(options: any[], goalConstraints: any[] | undefined) {
  return options.map((opt: any, idx: number) => {
    const rows = (goalConstraints ?? []).map((c: any) => {
      const f = outOfDomainFraction(opt.id, c);
      return {
        constraint_id: c.constraint_id,
        node_id: c.node_id,
        operator: c.operator,
        value: c.value,
        prob_satisfied: 0.9,
        near_miss_fraction: 0.1,
        binding: false,
        ...(f !== undefined && { level_out_of_domain_fraction: f }),
      };
    });
    return {
      option_id: opt.id,
      status: 'computed',
      win_probability: WIN[opt.id] ?? 0,
      outcome: {
        mean: 0.7 + idx * 0.01, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9,
        n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0,
      },
      rank: idx + 1,
      ...(rows.length > 0 && { constraint_analysis: { constraints: rows, joint_probability: 0.9 } }),
    };
  });
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

/** The corpus row with its churn node re-framed and its limits replaced. */
function shape(variant: string, churn: { observed_state?: any; scale_frame?: number }, limits: any[]): any {
  const req = corpus(variant);
  const node = churnOf(req);
  if (churn.observed_state !== undefined) node.observed_state = churn.observed_state;
  if (churn.scale_frame !== undefined) node.scale_frame = churn.scale_frame;
  req.goal_constraints = limits.map((c) => ({ ...c }));
  return req;
}

/** "Churn at most N %", a level limit. */
const churnAtMost = (value: number) =>
  ({ constraint_id: 'gc_churn', node_id: 'fac_churn', operator: '<=', value, unit: '%', value_frame: 'level' });

/** "Annual delivery cost at most £250,000" on its £ cap of 500,000, a level limit. */
const COST_LIMIT = { constraint_id: 'gc_cost', node_id: 'fac_cost', operator: '<=', value: 250000, unit: '£', value_frame: 'level' };

/** The single ISL wire row for `id` on every recorded call. */
function wireRows(id: string): any[] {
  expect(islRequests.length).toBeGreaterThan(0);
  return islRequests.map((sentBatch) => {
    const row = sentBatch.find((c: any) => c.constraint_id === id);
    expect(row, `${id} must reach the ISL wire`).toBeDefined();
    return row;
  });
}

function neverOnWire(id: string): void {
  expect(islRequests.length).toBeGreaterThan(0);
  for (const sentBatch of islRequests) {
    expect(sentBatch.find((c: any) => c.constraint_id === id), `${id} must NOT reach ISL`).toBeUndefined();
  }
}

function provenanceOf(body: any, id: string): any {
  const rows = (body.constraint_results ?? []).filter((r: any) => r.constraint_id === id);
  expect(rows, `exactly one constraint_results row for ${id}`).toHaveLength(1);
  return rows[0].scale_provenance;
}

function levelDomainCritiques(body: any): any[] {
  return (body.critiques ?? []).filter((c: any) => c.code === 'CONSTRAINT_LEVEL_DRAWS_OUT_OF_DOMAIN');
}

describe("route — a '%' limit's level_domain is 0–100% in the target's own normalised units", () => {
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

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  }, 60_000);

  afterAll(async () => { await app?.close(); });

  // ---------------------------------------------------------------------------
  // ROW 1 — a 20-point frame: 100% sits at 5.0, so the domain is {0, 5}
  // ---------------------------------------------------------------------------

  it("ROW 1 — cap 20 ('%'), '<= 10 %': the wire carries 0.5 and level_domain {0, 5}; 100% sits exactly at max", async () => {
    draws = {};
    const req = shape('lvl4_cap20', {}, [churnAtMost(10)]);
    const cap = churnOf(req).observed_state.cap;
    expect(cap, 'precondition: a 20-point frame').toBe(20);
    const body = await run(req);
    for (const row of wireRows('gc_churn')) {
      expect(row.value).toBe(0.5);
      expect(row.value_frame).toBe('level');
      expect(row.level_domain).toEqual({ min: 0, max: 5 });
      // 100% of the unit, on the target's own frame, IS the domain's max.
      expect(row.level_domain.max * cap).toBe(100);
    }
    expect(provenanceOf(body, 'gc_churn').source).toBe('unit_percent');
  });

  it.each([
    ['scale_frame 20 only (no cap, no pair)', { observed_state: { value: 0.2, unit: '%', std: 0.05 }, scale_frame: 20 }],
    ['the {0.2, 4} pair only (no cap, no scale_frame)', { observed_state: { value: 0.2, raw_value: 4, unit: '%', std: 0.05 } }],
  ])("ROW 1 — the SAME 20-point frame read off %s: level_domain {0, 5}", async (_label, churn) => {
    draws = {};
    const req = shape('lvl4_cap20', churn, [churnAtMost(10)]);
    expect(churnOf(req).observed_state.cap, 'precondition: no cap').toBeUndefined();
    await run(req);
    for (const row of wireRows('gc_churn')) {
      expect(row.value).toBe(0.5);
      expect(row.level_domain).toEqual({ min: 0, max: 5 });
    }
  });

  it("ROW 1 — a FRACTION frame of 0.5 (50 points): '<= 10 %' is 0.2 and 100% sits at 2 — the extent, not the raw frame", async () => {
    draws = {};
    const req = shape('lvl4_cap100', { observed_state: { value: 0.08, raw_value: 0.04, cap: 0.5, unit: 'fraction' } }, [churnAtMost(10)]);
    await run(req);
    for (const row of wireRows('gc_churn')) {
      expect(row.value).toBeCloseTo(0.2, 12);
      expect(row.level_domain).toEqual({ min: 0, max: 2 });
    }
  });

  it("BOUNDARY — '<= 101 %' on the 20-point frame (5.05 > 1) is refused threshold_clamped at PLoT and never reaches ISL", async () => {
    // The ruling's engine row ("every option 1.0") needs this limit on the wire.
    // It is not: A3 round 2 refuses a level limit outside its target's frame
    // before `levelDomainFor` is reached. Pinned so that boundary is stated, not
    // assumed; lifting it is a separate call. The £ sibling keeps ISL's request
    // non-empty (a second '<=' on churn would be merged away by (node, operator)).
    draws = {};
    const body = await run(shape('lvl4_cap20', {}, [churnAtMost(101), COST_LIMIT]));
    neverOnWire('gc_churn');
    expect((body._meta?.filtered_constraints ?? []).filter((r: any) => r.constraint_id === 'gc_churn'))
      .toEqual([{ constraint_id: 'gc_churn', node_id: 'fac_churn', reason: 'threshold_clamped' }]);
    for (const row of wireRows('gc_cost')) expect('level_domain' in row).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // ROW 2 — CONTROLS: the 100-point frame, and a frame PLoT cannot resolve
  // ---------------------------------------------------------------------------

  it('ROW 2 CONTROL — a 100-point frame (both corpus levels): level_domain serialises EXACTLY as before, {"min":0,"max":1}', async () => {
    for (const variant of ['lvl4_cap100', 'lvl12_cap100']) {
      draws = {};
      await run(shape(variant, {}, [churnAtMost(10)]));
      for (const row of wireRows('gc_churn')) {
        expect(row.value, variant).toBeCloseTo(0.1, 12);
        expect(JSON.stringify(row.level_domain), variant).toBe('{"min":0,"max":1}');
      }
    }
  });

  it("ROW 2 CONTROL — a '%' target with NO resolvable frame (no cap, no scale_frame, no pair) keeps the legacy {0, 1}", async () => {
    draws = {};
    await run(shape('lvl4_cap100', { observed_state: { value: 0.04, unit: '%', std: 0.01 } }, [churnAtMost(10)]));
    for (const row of wireRows('gc_churn')) {
      expect(row.value).toBeCloseTo(0.1, 12);
      expect(JSON.stringify(row.level_domain)).toBe('{"min":0,"max":1}');
    }
  });

  // ---------------------------------------------------------------------------
  // ROW 3 — non-'%' units are unchanged: no domain
  // ---------------------------------------------------------------------------

  it("ROW 3 — a £ level limit gets NO level_domain; the '%' limit in the same run on the 20-point frame gets {0, 5}", async () => {
    draws = {};
    const body = await run(shape('lvl4_cap20', {}, [churnAtMost(10), COST_LIMIT]));
    for (const row of wireRows('gc_cost')) {
      expect(row.value).toBeCloseTo(0.5, 12);
      expect('level_domain' in row).toBe(false);
    }
    expect(provenanceOf(body, 'gc_cost').source).toBe('explicit_cap');
    for (const row of wireRows('gc_churn')) expect(row.level_domain).toEqual({ min: 0, max: 5 });
  });

  // ---------------------------------------------------------------------------
  // THE OUTCOME — release gate (ii) on the 20-point frame
  // ---------------------------------------------------------------------------

  it('GATE — churn draws between 20% and 50% on the 20-point frame are POSSIBLE: fraction 0, the limit keeps its grade, no critique', async () => {
    // 10%, 15%, 30%, 50% of churn: two of four sit above the frame's 20%.
    draws = { opt_raise: [0.5, 0.75, 1.5, 2.5], opt_hold: [0.5, 0.75, 1.5, 2.5] };
    const body = await run(shape('lvl4_cap20', {}, [churnAtMost(10)]));
    // The OUTCOME first (it is what the user sees); the wire cause after it.
    const prov = provenanceOf(body, 'gc_churn');
    expect(prov.level_out_of_domain).toBeUndefined();
    expect(prov.decision_grade).toBe(true);
    expect(levelDomainCritiques(body)).toEqual([]);
    for (const opt of body.option_comparison ?? []) {
      const m = (opt.constraint_margins ?? []).find((r: any) => r.constraint_id === 'gc_churn');
      expect(m?.level_out_of_domain_fraction, opt.option_id).toBe(0);
    }
    for (const row of wireRows('gc_churn')) expect(row.level_domain).toEqual({ min: 0, max: 5 });
  });

  it('GATE CONTROL — churn draws BELOW 0% still trip on the 20-point frame: the floor is kept', async () => {
    draws = { opt_raise: [-0.2, -0.1, 0.5, 0.75], opt_hold: [-0.2, -0.1, 0.5, 0.75] };
    const body = await run(shape('lvl4_cap20', {}, [churnAtMost(10)]));
    const prov = provenanceOf(body, 'gc_churn');
    expect(prov.level_out_of_domain).toMatchObject({ reason: 'level_draws_out_of_domain', fraction: 0.5 });
    expect(prov.decision_grade).toBe(false);
    expect(levelDomainCritiques(body)).toHaveLength(1);
  });
});
