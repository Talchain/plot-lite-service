/**
 * A3 constraint trust marker (producer-owned) — route-level pins.
 *
 * Emits two additive disclosures on the /v2/run egress (schemas contract lands
 * separately; these are PLoT-local):
 *   - constraint_results[].scale_provenance
 *       { source, range_unified, threshold_clamped?, decision_grade }
 *   - option_comparison[].constraints_decision_grade  (AND over participating
 *     constraints' decision_grade; ABSENT when zero participate — fail-closed)
 *
 * Doctrine: A3-DOCTRINE-DECISIONS-2026-07-21.md D-2 (spread wins, disclosed via
 * source) / D-5 (inferred_value/default ⇒ decision_grade false, marker-only, no
 * new suppression).
 *
 * Reuses the faithful-ISL-surrogate harness from
 * constraint-intervention-range-unify.test.ts (surrogate computes prob_satisfied
 * / failure_margin_median from the NORMALISED threshold it receives vs each
 * option's NORMALISED intervention on the constraint node — the exact cross-scale
 * comparison the real ISL does).
 */
import { makeOptionResultV2 } from '../helpers/isl-option-fixture.js';
import { CROWN_COMPLIANCE_REASONS } from '../../src/routes/v2/crown-eligibility.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

let capturedISLRequest: any = null;

function evalConstraint(sample: number, threshold: number, operator: string): { sat: boolean; margin: number } {
  const sat = operator === '<=' ? sample <= threshold : sample >= threshold;
  const margin = operator === '<=' ? sample - threshold : threshold - sample;
  return { sat, margin };
}

/**
 * ISL emits `prob_satisfied` as a Monte Carlo FRACTION over all draws
 * (`satisfied_count / n_samples`) — derived at ISL staging 28fe0c95,
 * robustness_analyzer_v2.py:8071. The base surrogate only produces the two
 * extremes, so this override makes the interior band reachable, which is the
 * band where Olumi must NOT binarise.
 */
const PROB_OVERRIDE = new Map<string, number>();
/** Per-option ISL status, so the "no crownable candidate" cell is reachable. */
const STATUS_OVERRIDE = new Map<string, string>();

function buildSurrogateOptions(body: any) {
  const constraints: any[] = body.goal_constraints ?? [];
  return (body.options ?? []).map((opt: any, idx: number) => {
    const analysis = constraints.length
      ? {
          constraints: constraints.map((c: any) => {
            const sample = opt.interventions?.[c.node_id];
            if (typeof sample !== 'number') {
              // Never-intervened node: surrogate cannot breach it → satisfied.
              return { node_id: c.node_id, operator: c.operator, value: c.value, prob_satisfied: 1 };
            }
            const { sat, margin } = evalConstraint(sample, c.value, c.operator);
            const override =
              PROB_OVERRIDE.get(`${opt.id}::${c.constraint_id}`) ?? PROB_OVERRIDE.get(opt.id);
            const p = override !== undefined ? override : (sat ? 1 : 0);
            return {
              node_id: c.node_id,
              operator: c.operator,
              value: c.value,
              prob_satisfied: p,
              ...(p < 1 ? { failure_margin_median: Math.max(0, margin), near_miss_fraction: 0 } : {}),
            };
          }),
          joint_probability: PROB_OVERRIDE.get(opt.id) !== undefined
            ? PROB_OVERRIDE.get(opt.id)!
            : constraints.every((c: any) => {
            const s = opt.interventions?.[c.node_id];
            return typeof s !== 'number' || evalConstraint(s, c.value, c.operator).sat;
          })
            ? 1
            : 0,
        }
      : undefined;
    return makeOptionResultV2({
      // ROADMAP 2.744 sweep — RAW ISL V2 wire, routed through the contract-derived
      // builder. `option_id` was V1's identity name (V2 declares `id`) and `rank`
      // is declared on NEITHER ISL option schema; both were inert at the consumer
      // (run.ts reads `r.option_id ?? r.id`, and nothing reads `rank` on the V2
      // path) — but the literal was a hand-maintained mirror, which is the defect.
      id: opt.id,
      outcome: { mean: 0.7 - idx * 0.05, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
      win_probability: 0.5 - idx * 0.1,
      status: STATUS_OVERRIDE.get(opt.id) ?? 'computed',
      ...(analysis !== undefined && { constraint_analysis: analysis }),
    });
  });
}

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return { status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [], explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl' };
  },
  async analyseSensitivity() { return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' }; },
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return {
      options: buildSurrogateOptions(capturedISLRequest ?? { options }),
      edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const, factors: [], value_of_information: [],
      factors_provenance: 'unavailable' as const, factor_sensitivity_status: 'skipped_no_factor_values' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.8, fragile_edges: [], robust_edges: [],
      latency_ms: 50, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() { return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const }; },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    capturedISLRequest = body;
    return {
      data: {
        options: buildSurrogateOptions(body),
        edges: [], factors: [], value_of_information: [], overall_robustness: 'robust', robustness_score: 0.8, fragile_edges: [], robust_edges: [],
      } as T,
      error: null,
    };
  },
};

vi.mock('../../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

const { createServer } = await import('../../src/createServer.js');

// cost: monetary factor, NO cap / NO state_space.range.
// churn: monetary factor, observed value 10000, NEVER intervened → chain
//        deriveRange → inferred_value [0,20000].
const NODES = [
  { id: 'goal', kind: 'goal', label: 'Programme value', observed_state: { value: 0.4 } },
  { id: 'cost', kind: 'factor', label: 'First-year cost', observed_state: { value: 30000 } },
  { id: 'churn', kind: 'factor', label: 'Churn count', observed_state: { value: 10000 } },
];
const EDGES = [
  { from: 'cost', to: 'goal', strength: { mean: -0.5, std: 0.1 } },
  { from: 'churn', to: 'goal', strength: { mean: -0.3, std: 0.1 } },
];
const GRAPH = { nodes: NODES, edges: EDGES };

// Interventions 25000 / 45000 → spread range [21000,49000] (source inferred_spread).
const OPTIONS_SPREAD = [
  { id: 'opt_a', label: 'A', interventions: { cost: 25000 } },
  { id: 'opt_b', label: 'B', interventions: { cost: 45000 } },
];
// Interventions in [0,1] → Phase 4a SKIPPED → cost carries an IDENTITY scale.
const OPTIONS_UNIT = [
  { id: 'opt_a', label: 'A', interventions: { cost: 0.3 } },
  { id: 'opt_b', label: 'B', interventions: { cost: 0.7 } },
];

function optionEntry(body: any, id: string): any {
  return (body.option_comparison ?? []).find((o: any) => o.option_id === id);
}
function topLevelConstraint(body: any, cid: string): any {
  return (body.constraint_results ?? []).find((c: any) => c.constraint_id === cid);
}


// ---------------------------------------------------------------------------
// Scenario: a stated monetary cap the options straddle.
//   cost carries observed value 60000 and NO cap, so the constraint resolves
//   against the MEASURED intervention spread (source 'inferred_spread', a
//   DECISION_GRADE source) — the clean case where the scale is trustworthy and
//   the only question is compliance.
// ---------------------------------------------------------------------------
const CAP_NODES = [
  { id: 'goal', kind: 'goal', label: 'Programme value', observed_state: { value: 0.4 } },
  { id: 'cost', kind: 'factor', label: 'First-year cost', observed_state: { value: 60000 } },
  // A SECOND target, so a multi-constraint case has two DISTINCT nodes. Two
  // `<=` constraints on one node resolve to the same (node_id, operator) pair
  // and collapse, which would make a mixed fixture silently single-constraint.
  { id: 'headcount', kind: 'factor', label: 'Headcount', observed_state: { value: 40 } },
];
const CAP_EDGES = [
  { from: 'cost', to: 'goal', strength: { mean: -0.5, std: 0.1 } },
  { from: 'headcount', to: 'goal', strength: { mean: 0.3, std: 0.1 } },
];
const CAP_CONSTRAINT = [{ constraint_id: 'c_cap', node_id: 'cost', operator: '<=', value: 50000 }];

// The surrogate gives index 0 the HIGHEST win_probability, so listing the
// breaching option first is what makes it win on win_probability alone.
const OVER_FIRST = [
  { id: 'opt_over', label: 'Expensive', interventions: { cost: 90000 } },
  { id: 'opt_under', label: 'Cheap', interventions: { cost: 30000 } },
];
const UNDER_FIRST = [
  { id: 'opt_under', label: 'Cheap', interventions: { cost: 30000, headcount: 45 } },
  { id: 'opt_over', label: 'Expensive', interventions: { cost: 90000, headcount: 55 } },
];
const BOTH_OVER = [
  { id: 'opt_over_a', label: 'Expensive A', interventions: { cost: 90000 } },
  { id: 'opt_over_b', label: 'Expensive B', interventions: { cost: 95000 } },
];

describe('crown eligibility consumes the constraint verdict', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  }, 30000);
  afterAll(async () => { await app?.close(); });
  beforeEach(() => { capturedISLRequest = null; PROB_OVERRIDE.clear(); STATUS_OVERRIDE.clear(); });

  async function run(payload: object): Promise<any> {
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
    return res.json();
  }

  // -------------------------------------------------------------------
  // THE DEFECT. Bind by IDENTITY (option_id + constraint_id), never by a
  // value predicate another option could satisfy.
  // -------------------------------------------------------------------
  it('a certain breach on a TRUSTED scale is not crownable, even at the highest win_probability', async () => {
    const body = await run({
      graph: { nodes: CAP_NODES, edges: CAP_EDGES },
      options: OVER_FIRST, goal_node_id: 'goal', seed: '42',
      goal_constraints: CAP_CONSTRAINT,
    });

    // PRECONDITION PINNED IN-TEST: this payload really does put the breaching
    // option ahead on win_probability, and really does trust the scale.
    // Without this the assertion below could pass for the wrong reason.
    const over = optionEntry(body, 'opt_over');
    const under = optionEntry(body, 'opt_under');
    expect(over.win_probability).toBeGreaterThan(under.win_probability);
    expect(over.constraints_decision_grade).toBe(true);
    expect(over.constraint_probabilities.c_cap).toBe(0);
    expect(under.constraint_probabilities.c_cap).toBe(1);

    // THE PIN.
    expect(body.robustness.recommended_option_id).toBe('opt_under');
    expect(body.robustness.recommended_option_label).toBe('Cheap');
    expect(body.robustness.recommended_option_compliance).toBe('compliant');
    expect(body.robustness.recommended_option_compliance_reason)
      .toBe(CROWN_COMPLIANCE_REASONS.compliant);
  });

  // OPPOSITE-DIRECTION TWIN: a compliant option that leads must STILL be crowned.
  it('OPPOSITE DIRECTION: a compliant leader is still crowned (eligibility never suppresses a good crown)', async () => {
    const body = await run({
      graph: { nodes: CAP_NODES, edges: CAP_EDGES },
      options: UNDER_FIRST, goal_node_id: 'goal', seed: '42',
      goal_constraints: CAP_CONSTRAINT,
    });
    const under = optionEntry(body, 'opt_under');
    const over = optionEntry(body, 'opt_over');
    expect(under.win_probability).toBeGreaterThan(over.win_probability);
    expect(under.constraint_probabilities.c_cap).toBe(1);

    expect(body.robustness.recommended_option_id).toBe('opt_under');
    expect(body.robustness.recommended_option_compliance).toBe('compliant');
  });

  // -------------------------------------------------------------------
  // NOT AN EMPTY DEAD END. Every option breaches ⇒ no eligible leader, but
  // the run must SAY so rather than go silent.
  // -------------------------------------------------------------------
  it('when EVERY option breaches there is no crown, and the run says so by name', async () => {
    // The options STRADDLE the cap so the measured spread contains it and the
    // scale is decision-grade; ISL is then made to report zero satisfaction for
    // both. (A fixture where both options sit ABOVE the cap puts the threshold
    // outside the spread, which CLAMPS it — a different domain cell, pinned
    // separately below.)
    PROB_OVERRIDE.set('opt_under', 0);
    PROB_OVERRIDE.set('opt_over', 0);
    const body = await run({
      graph: { nodes: CAP_NODES, edges: CAP_EDGES },
      options: OVER_FIRST, goal_node_id: 'goal', seed: '42',
      goal_constraints: CAP_CONSTRAINT,
    });

    // PRECONDITION PINNED IN-TEST — without this the assertion below could pass
    // because the scale was untrusted rather than because every option breached.
    for (const id of ['opt_over', 'opt_under']) {
      const o = optionEntry(body, id);
      expect(o.constraints_decision_grade, id).toBe(true);
      expect(o.constraint_probabilities.c_cap, id).toBe(0);
    }

    expect(body.robustness.recommended_option_id).toBeUndefined();
    expect(body.robustness.recommended_option_label).toBeUndefined();
    expect(body.robustness.recommended_option_compliance).toBe('no_eligible_option');
    // Usefully, not silently: a claim-safe reason travels with it, and it is
    // the reason for THIS verdict (derived from the single source of truth,
    // not a hand-copied string) — and it is claim-safe, i.e. carries no
    // numbers a consumer could re-derive a statistic from.
    const reason = body.robustness.recommended_option_compliance_reason;
    expect(reason).toBe(CROWN_COMPLIANCE_REASONS.no_eligible_option);
    expect(reason.length).toBeGreaterThan(0);
    expect(reason).not.toMatch(/[0-9]/);
  });

  // -------------------------------------------------------------------
  // UNKNOWN REMAINS UNKNOWN, IN BOTH DIRECTIONS. Zero satisfaction on a scale
  // we do NOT trust is not a breach we may act on. Discovered by execution:
  // options that both sit above the cap push the threshold outside the
  // measured spread, so it CLAMPS low and decision_grade goes false.
  // -------------------------------------------------------------------
  it('zero satisfaction on a CLAMPED (untrusted) scale does NOT withhold the crown — it discloses unverified', async () => {
    const body = await run({
      graph: { nodes: CAP_NODES, edges: CAP_EDGES },
      options: BOTH_OVER, goal_node_id: 'goal', seed: '42',
      goal_constraints: CAP_CONSTRAINT,
    });

    // PRECONDITION: the scale really is clamped and untrusted here.
    const provenance = (body.constraint_results ?? [])
      .find((c: any) => c.constraint_id === 'c_cap')?.scale_provenance;
    expect(provenance.threshold_clamped).toBe('low');
    expect(provenance.decision_grade).toBe(false);
    expect(optionEntry(body, 'opt_over_a').constraint_probabilities.c_cap).toBe(0);

    // The crown STANDS — an untrusted scale licenses no claim either way — and
    // the run says exactly that.
    expect(body.robustness.recommended_option_id).toBe('opt_over_a');
    expect(body.robustness.recommended_option_compliance).toBe('unverified');
  });

  // -------------------------------------------------------------------
  // UNKNOWN REMAINS UNKNOWN. An interior probability is NOT a breach — ISL
  // exposes no satisfied/breached threshold (derived at ISL 28fe0c95), so
  // binarising here would be Olumi inventing one.
  // -------------------------------------------------------------------
  it('an INTERIOR probability is not treated as a breach — the crown stands and discloses uncertainty', async () => {
    PROB_OVERRIDE.set('opt_over', 0.35);
    const body = await run({
      graph: { nodes: CAP_NODES, edges: CAP_EDGES },
      options: OVER_FIRST, goal_node_id: 'goal', seed: '42',
      goal_constraints: CAP_CONSTRAINT,
    });
    const over = optionEntry(body, 'opt_over');
    expect(over.constraint_probabilities.c_cap).toBeCloseTo(0.35, 10);

    expect(body.robustness.recommended_option_id).toBe('opt_over');
    expect(body.robustness.recommended_option_compliance).toBe('uncertain');
  });

  // -------------------------------------------------------------------
  // THE BLOCKER. `goal_constraints` is the POST-FILTER list: PLoT empties it
  // when every constraint was dropped before reaching ISL. Reading only that
  // list made the product tell a user who said "we must ship by March" that
  // they had set no limits — in the SAME payload that recorded dropping it.
  // -------------------------------------------------------------------
  it('a TEMPORAL-only constraint is withheld, not absent — the run must never say "no limits were set"', async () => {
    const body = await run({
      graph: { nodes: CAP_NODES, edges: CAP_EDGES },
      options: OVER_FIRST, goal_node_id: 'goal', seed: '42',
      goal_constraints: [{
        constraint_id: 'c_deadline', node_id: 'cost', operator: '<=', value: 6,
        unit: 'months', deadline_metadata: { horizon_months: 6 },
      }],
    });

    // PRECONDITION PINNED IN-TEST: PLoT really did withhold it, and really did
    // file a record — so this exercises the withheld path, not an empty run.
    const filtered = body._meta?.filtered_constraints ?? [];
    expect(filtered.map((f: any) => f.constraint_id)).toContain('c_deadline');

    // THE PIN: the falsehood is gone.
    expect(body.robustness.recommended_option_compliance).not.toBe('not_applicable');
    expect(body.robustness.recommended_option_compliance).toBe('not_assessed');
    expect(body.robustness.recommended_option_compliance_reason)
      .toBe(CROWN_COMPLIANCE_REASONS.not_assessed);
    // Not a dead end: a leader is still offered, with the caveat beside it.
    expect(body.robustness.recommended_option_id).toBe('opt_over');
  });

  // -------------------------------------------------------------------
  // THE QUANTIFIER on the most load-bearing user-facing claim in this PR.
  // `compliant` says "met EVERY limit"; a corpus with only single-constraint
  // cases cannot tell `every` from `some`.
  // -------------------------------------------------------------------
  it('MIXED constraints: one satisfied in every draw, one partial ⇒ uncertain, never compliant', async () => {
    PROB_OVERRIDE.set('opt_under::c_cap', 1);
    PROB_OVERRIDE.set('opt_under::c_cap2', 0.4);
    const body = await run({
      graph: { nodes: CAP_NODES, edges: CAP_EDGES },
      options: UNDER_FIRST, goal_node_id: 'goal', seed: '42',
      goal_constraints: [
        { constraint_id: 'c_cap', node_id: 'cost', operator: '<=', value: 50000 },
        // Inside the measured headcount spread [45,55] so the scale is
        // decision-grade — the point of this case is the QUANTIFIER, not trust.
        { constraint_id: 'c_cap2', node_id: 'headcount', operator: '<=', value: 50 },
      ],
    });
    const under = optionEntry(body, 'opt_under');
    // PRECONDITION: the two constraints really do disagree on this option, and
    // the scale is trusted — so `every` vs `some` is genuinely discriminated.
    expect(under.constraints_decision_grade).toBe(true);
    expect(under.constraint_probabilities.c_cap).toBe(1);
    expect(under.constraint_probabilities.c_cap2).toBeCloseTo(0.4, 10);

    expect(body.robustness.recommended_option_id).toBe('opt_under');
    expect(body.robustness.recommended_option_compliance).toBe('uncertain');
  });

  // -------------------------------------------------------------------
  // "ISL COMPUTED NOTHING" vs "EVERY OPTION BREACHED" — two very different
  // things to tell a user, and both end with no crown.
  // -------------------------------------------------------------------
  it('no crown AND no crownable candidate ⇒ not_assessed, NOT no_eligible_option', async () => {
    STATUS_OVERRIDE.set('opt_over', 'failed');
    STATUS_OVERRIDE.set('opt_under', 'failed');
    const body = await run({
      graph: { nodes: CAP_NODES, edges: CAP_EDGES },
      options: OVER_FIRST, goal_node_id: 'goal', seed: '42',
      goal_constraints: CAP_CONSTRAINT,
    });
    // PRECONDITION: nothing was crownable on ISL-status grounds.
    for (const id of ['opt_over', 'opt_under']) {
      expect(optionEntry(body, id).status, id).toBe('failed');
    }
    expect(body.robustness.recommended_option_id).toBeUndefined();
    expect(body.robustness.recommended_option_compliance).toBe('not_assessed');
  });

  // -------------------------------------------------------------------
  // A withheld crown must not ship a SECOND leader-ish identifier a UI could
  // render as exactly the badge it just refused.
  // -------------------------------------------------------------------
  it('near_tie is WITHHELD when no option is eligible, and kept in every other state', async () => {
    PROB_OVERRIDE.set('opt_under', 0);
    PROB_OVERRIDE.set('opt_over', 0);
    const none = await run({
      graph: { nodes: CAP_NODES, edges: CAP_EDGES },
      options: OVER_FIRST, goal_node_id: 'goal', seed: '42',
      goal_constraints: CAP_CONSTRAINT,
    });
    expect(none.robustness.recommended_option_compliance).toBe('no_eligible_option');
    expect(none.robustness.near_tie).toBeUndefined();

    // CONTRAST CONTROL, same fixture minus the breach: near_tie is untouched,
    // so the assertion above passes because of the GATE, not because this
    // payload never had a near_tie to begin with.
    PROB_OVERRIDE.clear();
    const ok = await run({
      graph: { nodes: CAP_NODES, edges: CAP_EDGES },
      options: UNDER_FIRST, goal_node_id: 'goal', seed: '42',
      goal_constraints: CAP_CONSTRAINT,
    });
    expect(ok.robustness.recommended_option_compliance).toBe('compliant');
    expect(ok.robustness.near_tie).toBeDefined();
  });

  // -------------------------------------------------------------------
  // NO CONSTRAINTS ⇒ today's behaviour, unchanged. The common case must not
  // regress.
  // -------------------------------------------------------------------
  it('with NO constraints stated the crown is unchanged and compliance is not_applicable', async () => {
    const body = await run({
      graph: { nodes: CAP_NODES, edges: CAP_EDGES },
      options: OVER_FIRST, goal_node_id: 'goal', seed: '42',
    });
    expect(optionEntry(body, 'opt_over').constraint_probabilities).toBeUndefined();
    expect(body.robustness.recommended_option_id).toBe('opt_over');
    expect(body.robustness.recommended_option_compliance).toBe('not_applicable');
  });
});
