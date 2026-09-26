/**
 * A LIMIT "MET" ON LEVELS ITS TARGET CANNOT TAKE IS NOT DECISION-GRADE — the PLoT
 * half of the churn-limit release gate (ii).
 *
 * THE FINDING (olumi-programme-docs#70 5844762506, AI Quality, LOCAL ISL on Paul's
 * served T3 shape): "churn at most 10%" read MET at P 0.994 for the leader "Raise
 * price with AI" while 81.5% of its churn draws were below 0% — the drafted
 * AI -> churn link of -0.5 applied on churn's 0-100% frame. The Delivery Lead
 * ruled (5844770854) that the release waits for (i) the root cause or (ii) this
 * guard. The contract (5844820853, ISL #181):
 *   - request: `goal_constraints[].level_domain {min?, max?}` in the limit's
 *     NORMALISED frame — a '%' limit read by the unit_percent rung is `{0, 1}`;
 *   - response: each option's constraint row carries
 *     `level_out_of_domain_fraction` in [0,1] — ABSENT with no domain, or on a
 *     'delta' limit;
 *   - epsilon 0.05, judged on the LEADER's row.
 *
 * Every row below goes through the real `POST /v2/run` route with ISL mocked.
 * The mock mirrors ISL #181 (`_level_out_of_domain_fraction`,
 * robustness_analyzer_v2.py): it returns a fraction for a constraint ONLY when
 * the request row carried `level_domain` AND `value_frame: 'level'` — so PLoT
 * cannot pass a response row by accident without having sent the request field.
 * `islHonoursDomain: false` is an ISL build older than #181 (field never sent).
 *
 * THE SHAPE. The captured Fix 2 corpus (`fixtures/pct-cap-contrast-20260926/
 * lvl4_cap100`, AI Quality 5843365832) with Paul's served churn frame (`'% per
 * month'`, `scale_frame` 100 — the frame Fix 2's docblock names as his) and his
 * three options and numbers. Churn is kept a ROOT factor, as in the corpus: a
 * level limit on a NON-root target is withheld at this base by the L63
 * sample-frame gate until PLoT #368 lands, which would hide every constraint
 * row this gate reads. The served non-root shape is the combined-base leg
 * (#179 -> #181 -> this -> #1919 + #368).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface Scenario {
  /** win_probability per option id. */
  win: Record<string, number>;
  /** prob_satisfied per option id (every constraint row of that option). */
  prob: Record<string, number>;
  /** Per option, per constraint id: overrides `prob` for that one row. */
  probBy?: Record<string, Record<string, number>>;
  /** level_out_of_domain_fraction per option id, per constraint id. Absent key => absent field. */
  fraction: Record<string, Record<string, number>>;
  /** False = an ISL build older than #181: never returns the field. */
  islHonoursDomain: boolean;
}

let scenario: Scenario;
/** Every `goal_constraints` array ISL was handed, in call order. THE WIRE. */
let islRequests: any[][] = [];

function constraintAnalysis(optionId: string, goalConstraints: any[] | undefined) {
  if (!goalConstraints || goalConstraints.length === 0) return undefined;
  return {
    constraints: goalConstraints.map((c: any) => {
      const f = scenario.fraction[optionId]?.[c.constraint_id];
      // ISL #181: None unless a domain was stated AND the frame is 'level'.
      const emits = scenario.islHonoursDomain && c.level_domain !== undefined && c.value_frame === 'level' && f !== undefined;
      return {
        constraint_id: c.constraint_id,
        node_id: c.node_id,
        operator: c.operator,
        value: c.value,
        prob_satisfied: scenario.probBy?.[optionId]?.[c.constraint_id] ?? scenario.prob[optionId] ?? 0.9,
        near_miss_fraction: 0.1,
        binding: false,
        ...(emits && { level_out_of_domain_fraction: f }),
      };
    }),
    joint_probability: scenario.prob[optionId] ?? 0.9,
  };
}

function optionResults(options: any[], goalConstraints: any[] | undefined) {
  return options.map((opt: any, idx: number) => {
    const ca = constraintAnalysis(opt.id, goalConstraints);
    return {
      option_id: opt.id,
      status: 'computed',
      win_probability: scenario.win[opt.id],
      outcome: {
        mean: 0.7 + idx * 0.01, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9,
        n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0,
      },
      rank: idx + 1,
      ...(ca && { constraint_analysis: ca }),
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

const CORPUS = resolve(__dirname, 'fixtures/pct-cap-contrast-20260926/lvl4_cap100.request.json');
const BASE_CAPTURE = resolve(__dirname, 'fixtures/level-domain-gate-20260926/older-isl.base-response.json');

const LEADER = 'opt_raise_ai';
const RELEASE = 'opt_release_ai';
const CARRY_ON = 'opt_carry_on';

/** Paul's churn limit, as #1919 sends it: level frame, 10 '%'. */
const CHURN_LIMIT = { constraint_id: 'gc_churn', node_id: 'fac_churn', operator: '<=', value: 10, unit: '%', value_frame: 'level' };

/** AI Quality's table (5844762506): win %, P(churn <= 10%), share of draws below 0%. */
function paulsNumbers(overrides: Partial<Record<string, number>> = {}): Scenario {
  return {
    win: { [LEADER]: 0.85, [RELEASE]: 0.14, [CARRY_ON]: 0.01 },
    prob: { [LEADER]: 0.994, [RELEASE]: 0.996, [CARRY_ON]: 0.985 },
    fraction: {
      [LEADER]: { gc_churn: overrides[LEADER] ?? 0.815 },
      [RELEASE]: { gc_churn: overrides[RELEASE] ?? 0.82 },
      [CARRY_ON]: { gc_churn: overrides[CARRY_ON] ?? 0.04 },
    },
    islHonoursDomain: true,
  };
}

/** The captured corpus row, re-framed to Paul's served churn and given his three options. */
function paulsShape(constraints: any[] = [CHURN_LIMIT]): any {
  const req = JSON.parse(readFileSync(CORPUS, 'utf8'));
  const churn = req.graph.nodes.find((n: any) => n.id === 'fac_churn');
  expect(churn, 'fac_churn must exist in the corpus row').toBeDefined();
  churn.observed_state = { value: 0.04, raw_value: 4, unit: '% per month', std: 0.01 };
  churn.scale_frame = 100;
  req.graph.nodes.push({ id: 'fac_ai', kind: 'factor', label: 'AI assistant availability', observed_state: { value: 0 } });
  req.graph.edges.push({ from: 'fac_ai', to: 'out_subscribers', exists_probability: 0.9, strength: { mean: 0.3, std: 0.1 } });
  req.options = [
    { id: LEADER, label: 'Raise price with AI', interventions: { fac_price: { value: 0.59, source: 'user_specified' }, fac_ai: { value: 1, source: 'user_specified' } } },
    { id: RELEASE, label: 'Release AI at £49', interventions: { fac_price: { value: 0.49, source: 'user_specified' }, fac_ai: { value: 1, source: 'user_specified' } } },
    { id: CARRY_ON, label: 'Carry on', interventions: { fac_price: { value: 0.49, source: 'user_specified' }, fac_ai: { value: 0, source: 'user_specified' } } },
  ];
  req.goal_constraints = constraints.map((c) => ({ ...c }));
  return req;
}

/** The single ISL wire row for `id` on every recorded call (must be the same on each). */
function wireRows(id: string): any[] {
  expect(islRequests.length).toBeGreaterThan(0);
  return islRequests.map((sentBatch) => {
    const row = sentBatch.find((c: any) => c.constraint_id === id);
    expect(row, `${id} must reach the ISL wire`).toBeDefined();
    return row;
  });
}

function provenanceOf(body: any, id: string): any {
  const rows = (body.constraint_results ?? []).filter((r: any) => r.constraint_id === id);
  expect(rows, `exactly one constraint_results row for ${id}`).toHaveLength(1);
  return rows[0].scale_provenance;
}

function optionRow(body: any, optionId: string): any {
  const rows = (body.option_comparison ?? []).filter((o: any) => o.option_id === optionId);
  expect(rows, `exactly one option_comparison row for ${optionId}`).toHaveLength(1);
  return rows[0];
}

function marginRow(body: any, optionId: string, cid: string): any {
  const rows = (optionRow(body, optionId).constraint_margins ?? []).filter((m: any) => m.constraint_id === cid);
  expect(rows, `exactly one constraint_margins row for ${optionId}/${cid}`).toHaveLength(1);
  return rows[0];
}

function levelDomainCritiques(body: any): any[] {
  return (body.critiques ?? []).filter((c: any) => c.code === 'CONSTRAINT_LEVEL_DRAWS_OUT_OF_DOMAIN');
}

/**
 * The response with ONLY what differs between two IDENTICAL runs removed. Derived
 * at 71ab168 by running this scenario twice and diffing every leaf (38 leaves
 * differed): wall-clock stamps and timings, the per-request id and its echoes,
 * and the random critique UUID with the fact hashes derived from it. UUID-shaped
 * strings are replaced, not dropped, so the keys that carry them still compare.
 * Plus the BUILD identity (`build`, `plot_build`: the short SHA of HEAD), which
 * the same scenario showed moving 71ab168 -> baa2676 and nothing else with it.
 * Applied to BOTH sides, so the captured bytes stay as captured.
 * Everything else must be equal.
 */
const VOLATILE_KEYS = new Set([
  'processing_time_ms', 'latency_ms', 'normalization_ms', 'validation_ms', 'isl_ms',
  'timestamp', 'computed_at', 'created_at',
  'request_id', 'requestId', 'request_id_chain', 'isl_request_id',
  'fact_id', 'content_hash',
  'build', 'plot_build',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (VOLATILE_KEYS.has(k)) continue;
      out[k] = stable(v);
    }
    return out;
  }
  return typeof value === 'string' && UUID.test(value) ? '<uuid>' : value;
}

/** Keys whose value is a hash over the ISL REQUEST (or derived from one). */
const REQUEST_HASH_KEYS = new Set(['response_hash', 'graph_hash', 'response_content_hash']);
function withoutRequestHashes(value: any): any {
  if (Array.isArray(value)) return value.map(withoutRequestHashes);
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (!REQUEST_HASH_KEYS.has(k)) out[k] = withoutRequestHashes(v);
    }
    return out;
  }
  return value;
}

describe('route — a level limit scored on impossible levels is not decision-grade (release gate ii)', () => {
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
  // THE REQUEST — what PLoT tells ISL about the limit's possible levels
  // ---------------------------------------------------------------------------

  it("REQUEST — Paul's churn limit carries level_domain {min:0, max:1} on the ISL wire, by constraint id", async () => {
    scenario = paulsNumbers();
    const body = await run(paulsShape());
    for (const row of wireRows('gc_churn')) {
      expect(row.value).toBeCloseTo(0.1, 12);
      expect(row.value_frame).toBe('level');
      expect(row.level_domain).toEqual({ min: 0, max: 1 });
    }
    // The limit was read by the '%' rung (the precondition the domain rests on).
    expect(provenanceOf(body, 'gc_churn').source).toBe('unit_percent');
  });

  it("REQUEST — a 'delta' limit read by the SAME '%' rung gets no level_domain; its level sibling does", async () => {
    scenario = paulsNumbers();
    const rise = { constraint_id: 'gc_churn_rise', node_id: 'fac_churn', operator: '>=', value: 0.01, unit: '%', value_frame: 'delta' };
    const body = await run(paulsShape([CHURN_LIMIT, rise]));
    // Discriminating precondition: the delta DID go through the unit_percent rung.
    const repair = (body._meta?.repairs_applied ?? []).find((r: any) => r.field === 'constraint.value.gc_churn_rise');
    expect(repair).toMatchObject({ action: 'normalised', from_value: 0.01, to_value: 0.01, reason: 'normalised range=[0,1] source=unit_percent' });
    for (const row of wireRows('gc_churn_rise')) {
      expect(row.value_frame).toBe('delta');
      expect('level_domain' in row).toBe(false);
    }
    for (const row of wireRows('gc_churn')) expect(row.level_domain).toEqual({ min: 0, max: 1 });
  });

  it('REQUEST — a £ limit gets no level_domain; the % limit in the same run does', async () => {
    scenario = paulsNumbers();
    const cost = { constraint_id: 'gc_cost', node_id: 'fac_cost', operator: '<=', value: 250000, unit: '£', value_frame: 'level' };
    const body = await run(paulsShape([CHURN_LIMIT, cost]));
    for (const row of wireRows('gc_cost')) {
      expect(row.value).toBeCloseTo(0.5, 12);
      expect(row.value_frame).toBe('level');
      expect('level_domain' in row).toBe(false);
    }
    expect(provenanceOf(body, 'gc_cost').source).toBe('explicit_cap');
    for (const row of wireRows('gc_churn')) expect(row.level_domain).toEqual({ min: 0, max: 1 });
  });

  it('REQUEST — a caller-supplied level_domain never reaches ISL (PLoT mints it; the raw-forward path included)', async () => {
    scenario = paulsNumbers();
    // In [0,1], unitless: PLoT forwards this constraint RAW (no normaliser pass),
    // so what keeps the caller's key off is the temporal filter's canonical
    // rebuild (constraint-filter.ts), which keeps no `level_domain`. This row pins it.
    const raw = { constraint_id: 'gc_churn_raw', node_id: 'fac_churn', operator: '<=', value: 0.1, value_frame: 'level', level_domain: { min: -5, max: 5 } };
    await run(paulsShape([raw]));
    for (const row of wireRows('gc_churn_raw')) {
      expect(row.value).toBe(0.1);
      expect('level_domain' in row).toBe(false);
    }
  });

  // ---------------------------------------------------------------------------
  // THE RESPONSE — the leader's share of impossible levels decides the grade
  // ---------------------------------------------------------------------------

  it("PAUL'S SHAPE — leader 0.815: the limit is NOT decision-grade, with its reason, a critique and every option's fraction", async () => {
    scenario = paulsNumbers();
    const body = await run(paulsShape());

    expect(provenanceOf(body, 'gc_churn')).toEqual({
      source: 'unit_percent',
      range_unified: true,
      level_out_of_domain: { reason: 'level_draws_out_of_domain', option_id: LEADER, fraction: 0.815, tolerance: 0.05 },
      decision_grade: false,
    });

    // Every option's own row carries its own fraction, so CEE can judge any
    // option it names. Carry-on's 0.04 is tail noise: its row and P are kept.
    expect(marginRow(body, LEADER, 'gc_churn').level_out_of_domain_fraction).toBe(0.815);
    expect(marginRow(body, RELEASE, 'gc_churn').level_out_of_domain_fraction).toBe(0.82);
    expect(marginRow(body, CARRY_ON, 'gc_churn').level_out_of_domain_fraction).toBe(0.04);
    expect(optionRow(body, CARRY_ON).constraint_probabilities).toEqual({ gc_churn: 0.985 });
    expect(optionRow(body, LEADER).constraint_probabilities).toEqual({ gc_churn: 0.994 });

    // The per-constraint grade flows into every option's aggregate, so the crown
    // can no longer read "met": the leader stays crowned, compliance 'unverified'.
    for (const id of [LEADER, RELEASE, CARRY_ON]) expect(optionRow(body, id).constraints_decision_grade).toBe(false);
    expect(body.robustness.recommended_option_id).toBe(LEADER);
    expect(body.robustness.recommended_option_compliance).toBe('unverified');

    const c = levelDomainCritiques(body);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({
      severity: 'warning',
      source: 'isl',
      blocks_analysis: false,
      affected_node_ids: ['fac_churn'],
      affected_option_ids: [LEADER],
    });
    expect(c[0].message).toContain('[gc_churn (option opt_raise_ai: 0.815 of draws outside the level domain)]');
    expect(c[0].user_message).toContain('Monthly logo churn');
    expect(c[0].user_message).not.toMatch(/fac_|opt_|gc_/);
  });

  it('CONTROL — leader 0.04 (non-leaders 0.9): the grade is unchanged; the fractions still ride every row', async () => {
    scenario = paulsNumbers({ [LEADER]: 0.04, [RELEASE]: 0.9, [CARRY_ON]: 0.9 });
    const body = await run(paulsShape());
    expect(provenanceOf(body, 'gc_churn')).toEqual({ source: 'unit_percent', range_unified: true, decision_grade: true });
    for (const id of [LEADER, RELEASE, CARRY_ON]) expect(optionRow(body, id).constraints_decision_grade).toBe(true);
    expect(body.robustness.recommended_option_compliance).toBe('uncertain');
    expect(levelDomainCritiques(body)).toEqual([]);
    expect(marginRow(body, LEADER, 'gc_churn').level_out_of_domain_fraction).toBe(0.04);
    expect(marginRow(body, RELEASE, 'gc_churn').level_out_of_domain_fraction).toBe(0.9);
  });

  it('BOUNDARY — exactly epsilon (0.05) keeps the grade; the next representable share above it does not', async () => {
    scenario = paulsNumbers({ [LEADER]: 0.05 });
    const at = await run(paulsShape());
    expect(provenanceOf(at, 'gc_churn').decision_grade).toBe(true);
    expect(levelDomainCritiques(at)).toEqual([]);

    const above = 0.05 + Number.EPSILON;
    expect(above > 0.05).toBe(true);
    scenario = paulsNumbers({ [LEADER]: above });
    const over = await run(paulsShape());
    expect(provenanceOf(over, 'gc_churn')).toMatchObject({ decision_grade: false, level_out_of_domain: { fraction: above } });
  });

  // ---------------------------------------------------------------------------
  // WHICH ROW IS "THE LEADER'S" — the crown as it stands AND the argmax
  // win_probability are both judged. They differ only when the argmax is
  // excluded from the crown (step 5: P = 0 on a decision-grade limit). Here the
  // argmax "Raise price with AI" breaks the £ limit in every draw, so before the
  // gate the crown is "Release AI at £49".
  // ---------------------------------------------------------------------------

  const COST_LIMIT = { constraint_id: 'gc_cost', node_id: 'fac_cost', operator: '<=', value: 250000, unit: '£', value_frame: 'level' };

  function crownDiffersFromArgmax(fractions: Partial<Record<string, number>>): Scenario {
    return { ...paulsNumbers(fractions), probBy: { [LEADER]: { gc_cost: 0 } } };
  }

  it('CONTROL — the crown differs from the argmax, and neither row trips: the crown stays "Release AI at £49"', async () => {
    scenario = crownDiffersFromArgmax({ [LEADER]: 0.04, [RELEASE]: 0.04 });
    const body = await run(paulsShape([CHURN_LIMIT, COST_LIMIT]));
    expect(provenanceOf(body, 'gc_churn').decision_grade).toBe(true);
    expect(provenanceOf(body, 'gc_cost').decision_grade).toBe(true);
    expect(body.robustness.recommended_option_id).toBe(RELEASE);
    expect(levelDomainCritiques(body)).toEqual([]);
  });

  it('the ARGMAX row trips while the crown as it stands does not: the limit is still withdrawn, naming the argmax', async () => {
    scenario = crownDiffersFromArgmax({ [LEADER]: 0.815, [RELEASE]: 0.04 });
    const body = await run(paulsShape([CHURN_LIMIT, COST_LIMIT]));
    expect(provenanceOf(body, 'gc_churn')).toMatchObject({
      decision_grade: false,
      level_out_of_domain: { option_id: LEADER, fraction: 0.815 },
    });
    // Only the tripped limit is withdrawn; the £ limit keeps its grade.
    expect(provenanceOf(body, 'gc_cost')).toEqual({ source: 'explicit_cap', range_unified: true, decision_grade: true });
    // Fixed point: the tripped limit is non-decision-grade for every option, so
    // eligibility excludes nothing and the crown is the argmax — a JUDGED row.
    expect(body.robustness.recommended_option_id).toBe(LEADER);
    expect(body.robustness.recommended_option_compliance).toBe('unverified');
    expect(levelDomainCritiques(body)[0].affected_option_ids).toEqual([LEADER]);
  });

  it('the CROWN row trips while the argmax does not: the limit is still withdrawn, naming the crown', async () => {
    scenario = crownDiffersFromArgmax({ [LEADER]: 0.04, [RELEASE]: 0.815 });
    const body = await run(paulsShape([CHURN_LIMIT, COST_LIMIT]));
    expect(provenanceOf(body, 'gc_churn')).toMatchObject({
      decision_grade: false,
      level_out_of_domain: { option_id: RELEASE, fraction: 0.815 },
    });
    expect(provenanceOf(body, 'gc_cost').decision_grade).toBe(true);
    // The crown moves to the (judged) argmax, and says it could not check it.
    expect(body.robustness.recommended_option_id).toBe(LEADER);
    expect(body.robustness.recommended_option_compliance).toBe('unverified');
    expect(levelDomainCritiques(body)[0].affected_option_ids).toEqual([RELEASE]);
  });

  it('CONTROL — an ISL older than #181 (field absent): the response is byte-identical to 71ab168 but for the request hashes', async () => {
    scenario = { ...paulsNumbers(), islHonoursDomain: false };
    const body = await run(paulsShape());
    for (const row of wireRows('gc_churn')) expect(row.level_domain).toEqual({ min: 0, max: 1 });
    for (const id of [LEADER, RELEASE, CARRY_ON]) {
      expect('level_out_of_domain_fraction' in marginRow(body, id, 'gc_churn')).toBe(false);
    }
    expect(provenanceOf(body, 'gc_churn')).toEqual({ source: 'unit_percent', range_unified: true, decision_grade: true });
    expect(levelDomainCritiques(body)).toEqual([]);

    // The ONE deliberate difference: `response_hash` canonicalises the ISL
    // REQUEST (`canonicaliseISLRequest`, normalisation/canonicalise.ts), which
    // now carries `level_domain`, so it — and `graph_hash` / the content hash,
    // which are derived from it — move. They must move, and nothing else may.
    const base = stable(JSON.parse(readFileSync(BASE_CAPTURE, 'utf8')));
    expect(body.response_hash).not.toBe(base.response_hash);
    expect(withoutRequestHashes(stable(body))).toEqual(withoutRequestHashes(base));
  });
});
