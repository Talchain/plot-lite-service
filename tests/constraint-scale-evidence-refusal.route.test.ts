/**
 * THE FAIL-OPEN CLAMP — a raw-money cap rescaled onto the [0,1] axis PLoT
 * merely ASSUMED, and forwarded as a satisfied-looking threshold.
 *
 * MEASURED, on the deployed build `7e5d8a7`, against CEE's own minted
 * constraint (evidence: `user-constraint-journey-2026-08-24/A1-CEE-minted-
 * verbatim.json`). `_meta.repairs_applied` carried, at `severity: info`:
 *
 *   {"field":"constraint.value.gc-67901005-…","action":"normalised",
 *    "from_value":50000,"to_value":1,
 *    "reason":"normalised range=[0,1] source=default (clamped)"}
 *
 * `source=default` is not "the derived range was too narrow". `deriveRange`'s
 * priority-4 `default [0,1]` is the fallback taken when NO scale could be
 * derived at all — no `observed_state.cap`, no `state_space.range`, no
 * baseline, no non-zero observed value, and no producer `%`/cap declaration.
 * Normalising against it does not express the user's quantity on ISL's axis;
 * it invents a number. On a `<=` cap, `50000 → 1` is the CEILING of that axis,
 * so every option (which live at 0.35–0.9 on the witnessed run) reads as
 * COMPLIANT. **The transform fails OPEN: it certifies everything.**
 *
 * ⚠ AND IT DEFEATS ISL'S OWN FAIL-CLOSED GUARD. Derived at ISL `28fe0c9`,
 * `src/services/robustness_analyzer_v2.py:3827` + `:4016-4038`:
 * `NORMALISED_DOMAIN_LIMIT = 1.5`, and a `level`-framed constraint whose
 * threshold exceeds it is REFUSED with `CONSTRAINT_NOT_CONVERTIBLE /
 * constraint_values_outside_normalised_domain`. A raw `50000` would trip that
 * guard and be honestly refused — but PLoT clamps it to `1` first, which is
 * INSIDE the domain, so the one instrument built to catch this never fires.
 * PLoT's fail-open transform disarms ISL's fail-closed one.
 *
 * THE FIX, and the two directions it must hold in at once (trap 22b — a
 * predicate guarding two opposite harms needs its opposite-direction twin
 * measured, not assumed):
 *
 *   · a value PLoT cannot place on the axis (no scale evidence + clamped)
 *     must be REFUSED and reported by name — never rescaled;      → T1, T5, T6
 *   · a value that ALREADY sits on the [0,1] axis must pass untouched, on the
 *     SAME node, in the SAME request                               → T2
 *   · a clamp against a range PLoT genuinely DERIVED from node data is a
 *     different question and is deliberately UNCHANGED — the guard is bound to
 *     the ABSENCE OF SCALE EVIDENCE, not to magnitude                → T3
 *
 * T3 is a PINNED KNOWN GAP, not a closure (trap 22f): it REDs if the refusal
 * ever grows to cover derived ranges OR shrinks below the no-evidence case.
 *
 * THE ISL MOCK DERIVES ITS RESULTS FROM THE CONSTRAINTS IT ACTUALLY RECEIVED
 * (same discipline as tests/constraint-delta-frame-refusal.route.test.ts): a
 * fixed mock would echo N results whatever PLoT forwarded, which is exactly
 * the blindness that lets a wire claim be asserted against a list built by
 * removing the item.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

/** Every `goal_constraints` array ISL was handed, in call order. */
let islRequests: any[][] = [];

function echoConstraintAnalysis(goalConstraints: any[] | undefined) {
  if (!goalConstraints || goalConstraints.length === 0) return undefined;
  return {
    constraints: goalConstraints.map((c: any, i: number) => ({
      constraint_id: c.constraint_id,
      node_id: c.node_id,
      operator: c.operator,
      value: c.value,
      prob_satisfied: 0.8 + i * 0.05,
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
    // THE WIRE. This is the payload the translator built.
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

// -----------------------------------------------------------------------------
// Fixture. The two constraint targets differ in EXACTLY ONE property — whether
// the node carries data from which a scale can be derived. Nothing else varies.
// -----------------------------------------------------------------------------

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Support quality', observed_state: { value: 0.4 } },
    { id: 'market', kind: 'factor', label: 'Market Size', observed_state: { value: 0.3 } },
    // A producer-declared cap ⇒ deriveRange priority 0, `explicit_cap [0,8000]`.
    // Not intervened by any option, so no identity intervention scale overrides
    // it — this is the constraint whose verdict must SURVIVE a sibling refusal.
    { id: 'retention', kind: 'factor', label: 'Retained accounts', observed_state: { value: 4000, cap: 8000 } },
    // NO observed_state, no cap, no state_space ⇒ deriveRange falls to
    // priority 4, `default [0,1]`: PLoT holds NO scale for this node.
    { id: 'spend-noscale', kind: 'factor', label: 'Year one spend' },
    // STRUCTURALLY IDENTICAL to `spend-noscale` — same kind, same absence of
    // every scale signal, same single edge into the goal. It exists so the
    // opposite-direction twin can differ from the refused constraint in
    // EXACTLY ONE property: the value. (Both on one node would be collapsed
    // by the same-node/same-operator dedupe before normalisation ever runs —
    // measured, and it would have made the twin pass for the wrong reason.)
    { id: 'spend-noscale-twin', kind: 'factor', label: 'Year one spend (twin)' },
    // observed_state.value = 100 ⇒ deriveRange priority 3, `inferred_value`
    // [0,200]: PLoT DID derive a scale from node data.
    { id: 'spend-scaled', kind: 'factor', label: 'Year one spend (measured)', observed_state: { value: 100 } },
  ],
  edges: [
    { from: 'market', to: 'goal', strength: { mean: 0.4, std: 0.1 } },
    { from: 'retention', to: 'goal', strength: { mean: 0.3, std: 0.1 } },
    { from: 'spend-noscale', to: 'goal', strength: { mean: 0.2, std: 0.1 } },
    { from: 'spend-noscale-twin', to: 'goal', strength: { mean: 0.2, std: 0.1 } },
    { from: 'spend-scaled', to: 'goal', strength: { mean: 0.2, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt1', label: 'Option 1', interventions: { 'market': 0.5 } },
  { id: 'opt2', label: 'Option 2', interventions: { 'market': 0.8 } },
];

const BASE_PAYLOAD = { graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: '42' };

/** The witnessed shape: a real-money cap CEE mints from the user's own words. */
const MONEY_CAP_NO_SCALE = {
  constraint_id: 'budget-cap',
  node_id: 'spend-noscale',
  operator: '<=',
  value: 50000,
  unit: '\u00a3',
  label: 'Board-mandated year one budget cap',
};

/** OPPOSITE-DIRECTION TWIN — same node, same operator, already ON the axis. */
const ON_AXIS_TWIN = {
  constraint_id: 'on-axis',
  node_id: 'spend-noscale-twin',
  operator: '<=',
  value: 0.5,
  label: 'Already normalised cap',
};

/** CONTRAST — same magnitude, but on a node whose scale PLoT DID derive. */
const MONEY_CAP_DERIVED_SCALE = {
  constraint_id: 'budget-cap-derived',
  node_id: 'spend-scaled',
  operator: '<=',
  value: 50000,
  unit: '\u00a3',
  label: 'Budget cap on a measured node',
};

/** An ordinary sibling on a producer-capped node — its verdict must survive. */
const SIBLING = {
  constraint_id: 'retention-min',
  node_id: 'retention',
  operator: '>=',
  value: 3000,
  label: 'Retention floor',
};

const REFUSAL_REASON = 'scale_evidence_absent_value_rescaled';

async function run(baseUrl: string, goal_constraints: any[]) {
  islRequests = [];
  const res = await fetch(`${baseUrl}/v2/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...BASE_PAYLOAD, goal_constraints }),
  });
  expect(res.status).toBe(200);
  return res.json();
}

describe('the fail-open clamp: a value PLoT cannot place on the axis is refused, not rescaled', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterAll(async () => { await app?.close(); });

  // ---------------------------------------------------------------------------
  // PRECONDITION PIN (trap 13b — a guard must pin its own precondition). The
  // fixture must actually produce the two range resolutions the whole file
  // discriminates on. Without this, every result below could be the fixture
  // failing rather than the code deciding — a discriminator whose fixture
  // nothing pins is green whether it discriminates or not.
  // ---------------------------------------------------------------------------
  it('PRECONDITION: the two target nodes resolve DIFFERENT range sources', async () => {
    // `spend-scaled` carries observed_state.value ⇒ a DERIVED range, disclosed
    // on its own delivered result by identity.
    const derived = await run(baseUrl, [MONEY_CAP_DERIVED_SCALE]);
    const derivedRow = (derived.constraint_results ?? [])
      .find((r: any) => r.constraint_id === 'budget-cap-derived');
    expect(derivedRow).toBeDefined();
    expect(derivedRow.scale_provenance.source).toBe('inferred_value');

    // `spend-noscale` carries nothing ⇒ the `default` fallback, disclosed on the
    // repair record for a value that DOES need normalising against it.
    const fallback = await run(baseUrl, [MONEY_CAP_NO_SCALE]);
    const repair = (fallback._meta?.repairs_applied ?? [])
      .find((r: any) => r.field === 'constraint.value.budget-cap');
    expect(repair).toBeDefined();
    expect(repair.reason).toContain("target node 'spend-noscale'");
  });

  // ---------------------------------------------------------------------------
  // T1 — THE DEFECT. Fails CLOSED.
  // ---------------------------------------------------------------------------
  it('T1: a raw-money cap on a node with NO scale evidence is REFUSED, not clamped to 1', async () => {
    const body = await run(baseUrl, [MONEY_CAP_NO_SCALE, SIBLING]);

    // (a) it never reaches the ISL wire, and the sibling DOES — so the absence
    //     is discriminating, not vacuous.
    expect(islRequests.length).toBeGreaterThan(0);
    for (const sent of islRequests) {
      const ids = sent.map((c: any) => c.constraint_id);
      expect(ids).not.toContain('budget-cap');
      expect(ids).toContain('retention-min');
    }

    // (b) NO rescaled number is emitted for it anywhere in the response.
    expect((body.constraint_results ?? []).map((r: any) => r.constraint_id))
      .not.toContain('budget-cap');

    // (c) the repair record says REFUSED, not `normalised … to_value: 1`.
    const valueRepair = (body._meta?.repairs_applied ?? [])
      .find((r: any) => r.field === 'constraint.value.budget-cap');
    expect(valueRepair).toBeDefined();
    expect(valueRepair.action).toBe('removed');
    expect(valueRepair.to_value).toBe('refused');
    expect(valueRepair.from_value).toBe(50000);
    // The pre-fix signature, asserted ABSENT on the same field by identity.
    expect(valueRepair.reason).not.toContain('normalised range=[0,1]');
  });

  // ---------------------------------------------------------------------------
  // T2 — OPPOSITE-DIRECTION TWIN. Same node, same operator, same request.
  //
  // Bound to the ISL WIRE rather than to `constraints_status`, deliberately: the
  // seam this lane changed is the normaliser's refusal, and a constraint on a
  // node with no observed value is withheld from the top-level block by a
  // SEPARATE, pre-existing reliability gate (`threshold_normalisation_defaulted`)
  // whatever this fix does. Asserting `computed` here would bind the twin to a
  // gate this change does not touch, and would pass or fail for the wrong
  // reason.
  // ---------------------------------------------------------------------------
  it('T2 (TWIN): a value already ON the [0,1] axis passes UNTOUCHED on an identical node', async () => {
    const body = await run(baseUrl, [MONEY_CAP_NO_SCALE, ON_AXIS_TWIN]);

    const sent = islRequests.flat();
    const sentIds = sent.map((c: any) => c.constraint_id);
    expect(sentIds).toContain('on-axis');
    expect(sentIds).not.toContain('budget-cap');

    // …with its value byte-unchanged.
    expect(sent.find((c: any) => c.constraint_id === 'on-axis').value).toBe(0.5);

    // …and NOT refused: no record, and no repair on its value.
    const filtered = body._meta?.filtered_constraints ?? [];
    expect(filtered.find((f: any) => f.constraint_id === 'on-axis')).toBeUndefined();
    // Its own repair record, if the open gate produced one, is an IDENTITY
    // no-op — the value in equals the value out, and it was not removed.
    const twinRepair = (body._meta?.repairs_applied ?? [])
      .find((r: any) => r.field === 'constraint.value.on-axis');
    if (twinRepair !== undefined) {
      expect(twinRepair.action).toBe('normalised');
      expect(twinRepair.to_value).toBe(0.5);
      expect(twinRepair.to_value).toBe(twinRepair.from_value);
    }

    // …while its off-axis twin, in the SAME request, WAS refused.
    expect(filtered.find((f: any) => f.constraint_id === 'budget-cap')?.reason)
      .toBe(REFUSAL_REASON);
  });

  // ---------------------------------------------------------------------------
  // T3 — THE PINNED BOUNDARY, and it is a known gap rather than a closure.
  //
  // The SAME magnitude on a node whose scale PLoT genuinely DERIVED is still
  // clamped to the ceiling and still DELIVERED as a computed verdict. That is a
  // real fail-open and it is deliberately out of this lane's scope: closing it
  // makes a constraint-side `threshold_clamped` unreachable and so reaches into
  // the ratified F2a trust-marker / margin-precision design. Pinned exactly, so
  // the suite REDs if the refusal GROWS past this boundary or SHRINKS below the
  // no-evidence case.
  // ---------------------------------------------------------------------------
  it('T3 (PINNED GAP): the SAME magnitude on a node whose scale was DERIVED still travels', async () => {
    const body = await run(baseUrl, [MONEY_CAP_DERIVED_SCALE]);

    const sent = islRequests.flat();
    expect(sent.map((c: any) => c.constraint_id)).toContain('budget-cap-derived');

    expect(body.constraints_status).toBe('computed');
    const row = (body.constraint_results ?? [])
      .find((r: any) => r.constraint_id === 'budget-cap-derived');
    expect(row).toBeDefined();
    // The gap, stated as the number it is: the user's £50,000 reached ISL as 1.
    expect(sent.find((c: any) => c.constraint_id === 'budget-cap-derived').value).toBe(1);
    expect(row.scale_provenance.threshold_clamped).toBe('high');
    expect(row.scale_provenance.decision_grade).toBe(false);

    // …and it was NOT refused.
    expect((body._meta?.filtered_constraints ?? [])
      .find((f: any) => f.constraint_id === 'budget-cap-derived')).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // T4 — the sibling's verdict survives (the 2.878 F1 harm, re-pinned for the
  // new reason: removing from the ISL payload without also removing from the
  // ACTIVE set collapses every other constraint's verdict to zero results).
  // ---------------------------------------------------------------------------
  it('T4: refusing one constraint leaves its siblings verdict intact', async () => {
    const body = await run(baseUrl, [MONEY_CAP_NO_SCALE, SIBLING]);

    expect(body.constraints_status).toBe('computed');
    expect((body.constraint_results ?? []).map((r: any) => r.constraint_id))
      .toEqual(['retention-min']);
  });

  // ---------------------------------------------------------------------------
  // T5 — THE HONEST VERDICT. When the refused constraint is the ONLY one, the
  // run must say `unavailable`, never fall silent.
  // ---------------------------------------------------------------------------
  it('T5: when the only constraint is refused, constraints_status is "unavailable" — NOT absent', async () => {
    const body = await run(baseUrl, [MONEY_CAP_NO_SCALE]);

    // The lie this closes: an ABSENT constraints_status is the same wire shape
    // as "this decision states no constraints at all". The user stated one.
    expect(body.constraints_status).toBe('unavailable');
    expect(body.constraint_results ?? []).toHaveLength(0);

    // CONTROL: a run with genuinely NO constraints still omits the field, so
    // 'unavailable' above is a decision this code made, not a constant.
    // (The `unavailable`-rather-than-silence half ships in the honest-status
    // commit this branch stacks on; T5b there is the arm that flips.)
    const none = await run(baseUrl, []);
    expect(none.constraints_status).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // T5b — THE ARM THAT ACTUALLY FLIPS, and the reason it is here.
  //
  // ⚠ T5 ABOVE PASSES AT PRISTINE TOO, for a DIFFERENT reason: a constraint on
  // a scale-less node is withheld by the pre-existing reliability gate
  // (`threshold_normalisation_defaulted`), which also reports 'unavailable'. So
  // T5 alone cannot show the honesty branch exists — it is a test that would
  // pass on the wrong object (trap 19), and saying so is cheaper than
  // discovering it later.
  //
  // This arm uses the OTHER refusal reason — 2.878's delta-frame refusal, which
  // predates this lane. At pristine that constraint is refused, the active list
  // empties, and `constraints_status` is OMITTED ENTIRELY: byte-identical to
  // "this decision states no constraints", about a run where the user stated
  // one and PLoT declined it. That is the silence this branch closes, and it
  // closes it for the whole refusal class rather than only for the new reason —
  // two guards under one predicate would be the same defect one level up.
  // ---------------------------------------------------------------------------
  it('T5b: a sole DELTA-frame refusal also reports "unavailable" rather than falling silent', async () => {
    const body = await run(baseUrl, [{
      constraint_id: 'cost-reduce',
      node_id: 'spend-scaled',
      operator: '<=',
      value: -0.15,
      value_frame: 'delta',
      label: 'Unit cost down by 15%',
    }]);

    // PIN THE PRECONDITION: it really was refused, and for the OTHER reason.
    const row = (body._meta?.filtered_constraints ?? [])
      .find((f: any) => f.constraint_id === 'cost-reduce');
    expect(row).toBeDefined();
    expect(row.reason).toBe('delta_frame_value_altered_by_normalisation');
    expect(islRequests.flat().map((c: any) => c.constraint_id)).not.toContain('cost-reduce');

    // THE BRANCH. Absent at pristine; 'unavailable' now.
    expect(body.constraints_status).toBe('unavailable');
  });

  // ---------------------------------------------------------------------------
  // T6 — THE NAMED REASON. Name the limit, the factor, and what is missing.
  // ---------------------------------------------------------------------------
  it('T6: the refusal is disclosed BY NAME — constraint, node, and what is missing', async () => {
    const body = await run(baseUrl, [MONEY_CAP_NO_SCALE]);

    // (a) _meta.filtered_constraints — the one place a consumer already looks.
    const row = (body._meta?.filtered_constraints ?? [])
      .find((f: any) => f.constraint_id === 'budget-cap');
    expect(row).toBeDefined();
    expect(row.node_id).toBe('spend-noscale');
    expect(row.reason).toBe(REFUSAL_REASON);

    // (b) a typed, user-facing critique that names the limit AND the node, and
    //     does not block the run.
    const critique = (body.critiques ?? [])
      .find((c: any) => c.code === 'CONSTRAINT_REFUSED_NO_SCALE_EVIDENCE');
    expect(critique).toBeDefined();
    expect(critique.severity).toBe('warning');
    expect(critique.blocks_analysis).toBe(false);
    expect(critique.affected_node_ids).toContain('spend-noscale');
    // Named, not generic — the user's own words for the limit.
    expect(critique.message).toContain('Board-mandated year one budget cap');
    expect(critique.message).toContain('spend-noscale');
  });

  // ---------------------------------------------------------------------------
  // T7 — NEGATIVE CONTROL + POSITIVE CONTROL, so T5/T6's presence claims and
  // this absence claim are not the same instrument agreeing with itself.
  // ---------------------------------------------------------------------------
  it('T7 (CONTROLS): a run with no refusal discloses nothing, and CAN still compute', async () => {
    // NEGATIVE: an on-axis constraint on the same scale-less node refuses nothing.
    const noRefusal = await run(baseUrl, [ON_AXIS_TWIN]);
    expect((noRefusal._meta?.filtered_constraints ?? [])
      .filter((f: any) => f.reason === REFUSAL_REASON)).toHaveLength(0);
    expect((noRefusal.critiques ?? [])
      .find((c: any) => c.code === 'CONSTRAINT_REFUSED_NO_SCALE_EVIDENCE')).toBeUndefined();

    // POSITIVE: the top-level block is reachable in this fixture at all — so a
    // 'computed' assertion elsewhere is a real discrimination, not an accident.
    const computed = await run(baseUrl, [SIBLING]);
    expect(computed.constraints_status).toBe('computed');
    expect((computed.constraint_results ?? []).map((r: any) => r.constraint_id))
      .toEqual(['retention-min']);
  });

  // ---------------------------------------------------------------------------
  // T8 — THE AUTO-SYNTHESISED CONSTRAINT IS NOT CAUGHT BY THIS GUARD.
  //
  // ROADMAP 2.1023's measured harm: refusing the constraint synthesised from
  // `goal_threshold` also WITHDRAWS the user's target, because the 2.239 carry
  // binds `goal_threshold` to it. The guard sits AFTER the 2.1023 unstamp
  // branch for exactly that reason. This pins the ordering rather than
  // reasoning about it: a run with a goal target and NO client constraints must
  // emit no refusal of this reason.
  // ---------------------------------------------------------------------------
  it('T8: a run whose only constraint is auto-synthesised from goal_threshold is never refused here', async () => {
    islRequests = [];
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...BASE_PAYLOAD,
        graph: {
          ...GRAPH,
          nodes: GRAPH.nodes.map((n: any) =>
            n.id === 'goal'
              ? { ...n, goal_threshold: 0.7, goal_threshold_frame: 'delta' }
              : n,
          ),
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect((body._meta?.filtered_constraints ?? [])
      .filter((f: any) => f.reason === REFUSAL_REASON)).toHaveLength(0);
    expect((body.critiques ?? [])
      .find((c: any) => c.code === 'CONSTRAINT_REFUSED_NO_SCALE_EVIDENCE')).toBeUndefined();
  });
});
