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
    // RE-RULED (DL olumi-programme-docs#72 5861214582): the SAME [0,100] bounds
    // (0.04 unchanged), now read on the '%' limit's own rung because CEE's
    // stamp says the '%' was relabelled from the node's own '% per month'
    // (`sameUnitRelabelReadsOnPercentRung`). Was `source=scale_frame`. The
    // trust marker and delivery are asserted in
    // `nonroot-same-period-limit.route.test.ts` (R1).
    expect(repair).toMatchObject({ action: 'normalised', from_value: 4, to_value: 0.04, reason: 'normalised range=[0,100] source=unit_percent' });
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

  // ===========================================================================
  // A3 ROUND 2 — the unit check on the frame sources (verifier mutant M10)
  // ===========================================================================
  //
  // What the user sees for Paul's churn limit ('%') on a '% per month' node.
  // Bound by the node's identity (its label in the warning) and by the unit
  // clause written from what the user must be told — not read back off the
  // message builder.
  const CHURN_LIMIT = 'agent-lane:monthly_churn:<=';
  const UNIT_CLAUSE = 'your target is stated in % while "Monthly churn" is measured in % per month';
  const TOPOLOGY_CLAUSE = '"Monthly churn" is calculated from the factors feeding into it';

  function churnLimitWarnings(body: any): any[] {
    return (body.inference_warnings ?? []).filter(
      (w: any) => w.code === 'CONSTRAINT_TARGET_UNRELIABLE' && String(w.message).startsWith('The target on "Monthly churn"'),
    );
  }

  function deliveredChurnLimitResults(body: any): any[] {
    return (body.constraint_results ?? []).filter((c: any) => c.constraint_id === CHURN_LIMIT);
  }

  // ⭐ RE-RULED 28 Sep 2026 — Delivery Lead, olumi-programme-docs#72
  // 5861214582: A3 r2's "(a) UNIT CHECK KEPT" is re-ruled for the SAME-PERIOD
  // relabel ONLY. Paul's wire carries CEE's stamp
  // `provenance_unit_relabelled.pre_normalisation_unit: '% per month'` — the
  // node's own unit — so the '%' is the same quantity with the period dropped
  // from the label: scored as `unit_percent` on churn's own frame, with
  // `level_domain`. A DIFFERENT period and a limit with NO stamp keep the unit
  // check: the rows below (and R5/R6 in `nonroot-same-period-limit.route.test.ts`)
  // strip or change the stamp and stay withheld with the unit reason.
  const withoutStamp = (req: any) => {
    for (const c of [...(req.goal_constraints ?? []), ...(req.graph?.goal_constraints ?? [])]) {
      if (c.constraint_id === CHURN_LIMIT) delete c.provenance_unit_relabelled;
    }
    return req;
  };

  it("(a) RE-RULED (DL 5861214582) — Paul's one-option shape, SAME-PERIOD stamp: the churn limit is scored, decision-grade, no unit warning", async () => {
    const body = await run(paulRequest());
    expect(churnLimitWarnings(body)).toEqual([]);
    expect(body.constraints_status).toBe('computed');
    const [result] = deliveredChurnLimitResults(body);
    expect(result?.scale_provenance).toEqual({ source: 'unit_percent', range_unified: true, decision_grade: true });
  });

  it("(a) UNIT CHECK KEPT — Paul's one-option shape with NO stamp: the churn limit is withheld WITH the unit reason", async () => {
    const body = await run(withoutStamp(paulRequest()));
    const warnings = churnLimitWarnings(body);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain(UNIT_CLAUSE);
    expect(body.constraints_status).toBe('unavailable');
    expect(deliveredChurnLimitResults(body)).toEqual([]);
  });

  it('(b) UNIT CHECK GAINED — NO stamp; a second option sets churn to a DIFFERENT level (2): withheld WITH the unit reason', async () => {
    const req = withoutStamp(paulRequest());
    req.options.push({ id: 'retention_b', option_id: 'retention_b', label: 'Retention B', interventions: { monthly_churn: 2 }, is_baseline: false });
    const body = await run(req);
    for (const v of wireLevels('ca47b368', 'monthly_churn')) expect(v).toBe(0.025);
    for (const v of wireLevels('retention_b', 'monthly_churn')) expect(v).toBe(0.02);
    const warnings = churnLimitWarnings(body);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain(UNIT_CLAUSE);
    expect(deliveredChurnLimitResults(body)).toEqual([]);
  });

  it('(b) the unit is the SOLE reason — NO stamp; only the two retention options (churn pinned by every option): withheld on the unit alone', async () => {
    // Every option sets churn, so the sample frame is anchored
    // (`pinned_by_every_option`) and the unit mismatch is the ONLY thing that
    // can withhold this limit. MEASURED at base 1f6ad52 (this row's request):
    // the class was DELIVERED — constraints_status 'computed', scale_provenance
    // {source: 'inferred_spread', threshold_clamped: 'high', decision_grade:
    // false}, churn on the wire at 0.857 / 0.143 and the 4% limit clamped to 1,
    // no warning. The unit check is GAINED here; this row is what shows it.
    const req = withoutStamp(paulRequest());
    req.options = [
      { id: 'ca47b368', option_id: 'ca47b368', label: 'Retention A', interventions: { monthly_churn: 2.5 }, is_baseline: true },
      { id: 'retention_b', option_id: 'retention_b', label: 'Retention B', interventions: { monthly_churn: 2 }, is_baseline: false },
    ];
    const body = await run(req);
    for (const v of wireLevels('ca47b368', 'monthly_churn')) expect(v).toBe(0.025);
    for (const v of wireLevels('retention_b', 'monthly_churn')) expect(v).toBe(0.02);
    for (const c of wireConstraint(CHURN_LIMIT)) expect(c?.value).toBe(0.04);
    const warnings = churnLimitWarnings(body);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain(UNIT_CLAUSE);
    expect(warnings[0].message).not.toContain(TOPOLOGY_CLAUSE);
    expect(deliveredChurnLimitResults(body)).toEqual([]);
  });

  it('(b) RE-RULED twin (DL 5861214582) — the SAME two retention options WITH the same-period stamp: scored on unit_percent, decision-grade', async () => {
    const req = paulRequest();
    req.options = [
      { id: 'ca47b368', option_id: 'ca47b368', label: 'Retention A', interventions: { monthly_churn: 2.5 }, is_baseline: true },
      { id: 'retention_b', option_id: 'retention_b', label: 'Retention B', interventions: { monthly_churn: 2 }, is_baseline: false },
    ];
    const body = await run(req);
    for (const c of wireConstraint(CHURN_LIMIT)) expect(c).toMatchObject({ value: 0.04, level_domain: { min: 0, max: 1 } });
    expect(churnLimitWarnings(body)).toEqual([]);
    const [result] = deliveredChurnLimitResults(body);
    expect(result?.scale_provenance).toEqual({ source: 'unit_percent', range_unified: true, decision_grade: true });
  });

  // ===========================================================================
  // A3 ROUND 2 — (e) the ledger keeps one clamp per OPTION, through the route
  // ===========================================================================
  it('RED→GREEN — two options clamp churn (150, 200 on frame 100): two clamp repairs and two ledger entries, one per option', async () => {
    const req = paulRequest();
    req.options.find((o: any) => o.id === 'ca47b368').interventions.monthly_churn = 150;
    req.options.push({ id: 'retention_b', option_id: 'retention_b', label: 'Retention B', interventions: { monthly_churn: 200 }, is_baseline: false });
    const body = await run(req);
    const clamps = (body._meta?.repairs_applied ?? []).filter((r: any) => r.action === 'clamped');
    expect(clamps.map((r: any) => [r.option_id, r.field, r.from_value])).toEqual([
      ['ca47b368', 'intervention.value.monthly_churn', 150],
      ['retention_b', 'intervention.value.monthly_churn', 200],
    ]);
    const ledger = (body.m1_coaching?.assumptions_ledger?.assumptions ?? []).filter((a: any) => a.action === 'clamped');
    expect(ledger.map((a: any) => [a.entity_type, a.entity_id, a.field, a.from_value])).toEqual([
      ['option', 'ca47b368', 'intervention.value.monthly_churn', 150],
      ['option', 'retention_b', 'intervention.value.monthly_churn', 200],
    ]);
  });

  // ===========================================================================
  // A3 ROUND 2 — (d) NOT BUILT: CEE's demoted request depends on the gate
  // skipping an all-[0,1] request. See `needsNormalisation`.
  // ===========================================================================
  //
  // These option levels are NOT authored here. They are what CEE's own egress
  // (`projectRequestInterventionsToWireScale`, CEE staging 9cfdbb35, run
  // locally and read-only on Paul's persisted option interventions — MG
  // capture paul-own-a295e4a1 `snapshot.A-agent-policy-flag-on.json`) emits
  // when ONE extra option sets a 0|1 flag with no raw form: the request is
  // "mixed", so CEE DEMOTES every value it can to its unit form (price
  // 59 → 0.295, new subscribers 90 → 0.09, churn 2.5 → 0.025) and ships an
  // all-[0,1] request for PLoT's gate to skip. The flag option is the one input
  // chosen here.
  it("CEE's demoted request (all-[0,1], framed churn in UNIT form) reaches ISL verbatim — the gate must not open on the frame", async () => {
    const req = paulRequest();
    const demoted: Record<string, Record<string, number>> = {
      increase_price_to_59: { pro_plan_price: 0.295 },
      increase_price_to_54: { pro_plan_price: 0.27 },
      '146aa89d': { pro_plan_price: 0.295 },
      '6dbac00d': { monthly_new_pro_subscribers: 0.09 },
      ca47b368: { monthly_churn: 0.025 },
    };
    req.options = req.options
      .filter((o: any) => o.id in demoted)
      .map((o: any) => ({ ...o, interventions: demoted[o.id] }));
    req.options.push({ id: 'grandfather_flag', option_id: 'grandfather_flag', label: 'Grandfather existing customers', interventions: { fac_existing_customers_grandfathered: 1 }, is_baseline: false });
    const body = await run(req);
    for (const v of wireLevels('ca47b368', 'monthly_churn')) expect(v).toBe(0.025);
    for (const v of wireLevels('6dbac00d', 'monthly_new_pro_subscribers')) expect(v).toBe(0.09);
    for (const v of wireLevels('increase_price_to_59', 'pro_plan_price')) expect(v).toBe(0.295);
    for (const v of wireLevels('grandfather_flag', 'fac_existing_customers_grandfathered')) expect(v).toBe(1);
    expect((body._meta?.repairs_applied ?? []).filter((r: any) => String(r.field).startsWith('intervention.value.'))).toEqual([]);
  });

  it('KNOWN RESIDUAL (CEE-owned) — "cut churn to 0.8%" alone is emitted raw (0.8) and forwarded as unit scale: PLoT cannot tell it from a demoted 0.8', async () => {
    // CEE's egress (same function, same commit) emits this option's raw_value
    // (0.8, `raw_value_used`) beside the 0|1 flag (`no_cap`) and does NOT
    // demote, because nothing in the request is outside [0,1]. The same number,
    // on the same node, is what a demoted request carries for an 80% level. The
    // fix is at CEE's egress (or a wire attestation) — this row pins where the
    // boundary is today, so it REDs if PLoT's side moves.
    const req = paulRequest();
    req.options = [
      { id: 'cut_churn', option_id: 'cut_churn', label: 'Cut churn to 0.8%', interventions: { monthly_churn: 0.8 }, is_baseline: false },
      { id: 'grandfather_flag', option_id: 'grandfather_flag', label: 'Grandfather existing customers', interventions: { fac_existing_customers_grandfathered: 1 }, is_baseline: true },
    ];
    await run(req);
    for (const v of wireLevels('cut_churn', 'monthly_churn')) expect(v).toBe(0.8);
    for (const v of wireLevels('grandfather_flag', 'fac_existing_customers_grandfathered')) expect(v).toBe(1);
  });

  // The residual above is NOT fixable on PLoT's side: opening the gate on a
  // node's frame was built and measured (branch
  // mg/a3-pct-alone-residual-180127-brieffix-REGRESSES) and it double-normalises
  // CEE's demoted request above (churn 0.025 -> 0.00025, new subscribers
  // 0.09 -> 0.00009, price 0.295 -> 0.001475). The fix is CEE's egress emitting
  // the KNOWN unit form (`unitIntervalEquivalent`) whenever the request is
  // already all-[0,1]. The two rows below pin the PLoT half of that handshake.

  it('CONTRAST — "cut churn to 0.8%" in company with RAW price options: the gate is open, churn reaches ISL at 0.008 and the price options are byte-identical to the BEFORE wire', async () => {
    const req = paulRequest();
    const keep = ['keep_current_49_price', 'increase_price_to_59'];
    req.options = req.options.filter((o: any) => keep.includes(o.id));
    req.options.push({ id: 'cut_churn', option_id: 'cut_churn', label: 'Cut churn to 0.8%', interventions: { monthly_churn: 0.8 }, is_baseline: false });
    const body = await run(req);
    for (const v of wireLevels('cut_churn', 'monthly_churn')) expect(v).toBe(0.008);
    const before = capturedBefore();
    for (const b of islBodies) {
      for (const id of keep) {
        const now = (b.options ?? []).find((o: any) => o.id === id);
        const then = before.options.find((o: any) => o.id === id);
        expect(then, `${id} in the BEFORE capture`).toBeDefined();
        expect(JSON.stringify(now?.interventions), id).toBe(JSON.stringify(then.interventions));
      }
    }
    expect((body._meta?.repairs_applied ?? []).find((r: any) => r.field === 'intervention.value.monthly_churn' && r.action === 'normalised')).toMatchObject({
      from_value: 0.8, to_value: 0.008, reason: 'normalised range=[0,100] source=scale_frame',
    });
  });

  it('CEE-FIX CONTRACT — "cut churn to 0.8%" emitted in its UNIT form (0.008) beside the 0|1 flag reaches ISL at 0.008 verbatim: the gate stays shut, nothing is re-scaled', async () => {
    const req = paulRequest();
    req.options = [
      { id: 'cut_churn', option_id: 'cut_churn', label: 'Cut churn to 0.8%', interventions: { monthly_churn: 0.008 }, is_baseline: false },
      { id: 'grandfather_flag', option_id: 'grandfather_flag', label: 'Grandfather existing customers', interventions: { fac_existing_customers_grandfathered: 1 }, is_baseline: true },
    ];
    const body = await run(req);
    for (const v of wireLevels('cut_churn', 'monthly_churn')) expect(v).toBe(0.008);
    for (const v of wireLevels('grandfather_flag', 'fac_existing_customers_grandfathered')) expect(v).toBe(1);
    expect((body._meta?.repairs_applied ?? []).filter((r: any) => String(r.field).startsWith('intervention.value.'))).toEqual([]);
  });
});
