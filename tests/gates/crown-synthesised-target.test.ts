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
import { mockObjectiveRanking } from '../helpers/objective-fixtures.js';
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
        objective_ranking: mockObjectiveRanking(buildSurrogateOptions(body).map((o: any) => ({ ...o, option_id: o.id }))),
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
  { id: 'goal', kind: 'goal', goal_direction: 'maximise', label: 'Programme value', observed_state: { value: 0.4 } },
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
  { id: 'goal', kind: 'goal', goal_direction: 'maximise', label: 'Programme value', observed_state: { value: 0.4 } },
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


// ---------------------------------------------------------------------------
// A goal node that admits auto-synthesis: `goal_threshold_frame: 'delta'` is
// what the synthesis gate requires, and `goal_threshold` on the request is the
// number it derives the target from.
// ---------------------------------------------------------------------------
const SYNTH_NODES = [
  { id: 'goal', kind: 'goal', goal_direction: 'maximise', label: 'Programme value',
    observed_state: { value: 0.4 }, goal_threshold_frame: 'delta' },
  { id: 'cost', kind: 'factor', label: 'First-year cost', observed_state: { value: 60000 } },
];
const SYNTH_EDGES = [{ from: 'cost', to: 'goal', strength: { mean: -0.5, std: 0.1 } }];
const SYNTH_OPTS = [
  { id: 'opt_a', label: 'A', interventions: { cost: 30000 } },
  { id: 'opt_b', label: 'B', interventions: { cost: 90000 } },
];

/**
 * Every reason that speaks of limits the USER authored — DERIVED from the
 * production map, never hand-listed.
 *
 * ⚠ THIS WAS A HAND-WRITTEN ARRAY OF FIVE LITERALS, which is the
 * hand-maintained-mirror defect sitting INSIDE the guard written to prevent a
 * class defect. A seventh reason would not have been added to it and the list
 * would have gone short silently — the guard would have kept passing while
 * covering less.
 *
 * Deriving it also makes the assertion below honest about its own worth. The
 * class is protected by the `toBe('not_applicable')` value pin, not by this:
 * `CROWN_COMPLIANCE_REASONS` is `Record<CrownCompliance, string>`, so the
 * product map is total BY TYPE and a new member cannot be forgotten there. Only
 * the test's copy could go short — so the copy is the thing that had to go.
 */
const USER_AUTHORED_REASONS = Object.entries(CROWN_COMPLIANCE_REASONS)
  .filter(([verdict]) => verdict !== 'not_applicable')
  .map(([, phrase]) => phrase);

describe('the auto-synthesised Goal target is not a limit the user set', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
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
  // THE DEFECT. `constraintsStated` counted the SYNTHESISED constraint, so a
  // run where the user set no limits at all still produced a verdict whose
  // copy speaks of "your limits" / "every limit you set".
  //
  // ⚠ THE REACHABLE MEMBER IS `unverified`, NOT `compliant`. Measured: the
  // synthesised threshold is already in [0,1], so it forwards raw with range
  // source `default`, which is deliberately outside DECISION_GRADE_SOURCES —
  // so `decision_grade` is false and rung 5 fires. That makes this the DEFAULT
  // outcome of every synthesised-only run, not an edge case.
  // -------------------------------------------------------------------
  it('a synthesised Goal target never produces a "your limits" claim', async () => {
    const body = await run({
      graph: { nodes: SYNTH_NODES, edges: SYNTH_EDGES },
      options: SYNTH_OPTS, goal_node_id: 'goal', seed: '42',
      goal_threshold: 0.2,
      // NOTE: no goal_constraints. That is the whole point.
    });

    // PRECONDITION PINNED IN-TEST: synthesis really did fire, and the
    // constraint really is auto-generated — so this exercises the synthesised
    // path and not simply a run with no constraints at all.
    expect(body._meta?.constraint_sources)
      .toEqual({ auto_goal_threshold: 'auto_from_goal_threshold' });

    // THE PIN: no claim about limits the user did not set.
    expect(body.robustness.recommended_option_compliance).toBe('not_applicable');
    expect(body.robustness.recommended_option_compliance_reason)
      .toBe(CROWN_COMPLIANCE_REASONS.not_applicable);
    // Bind by PROPERTY as well as by value — a new reason added later that
    // speaks of the user's limits must not be able to appear here unnoticed.
    expect(USER_AUTHORED_REASONS)
      .not.toContain(body.robustness.recommended_option_compliance_reason);

    // Not a dead end, and no behaviour change to the crown itself.
    expect(body.robustness.recommended_option_id).toBe('opt_a');
  });

  // OPPOSITE-DIRECTION TWIN, and it provably fires: a REAL user limit must
  // still produce the user-authored copy. A fix that simply silenced the whole
  // path would RED here.
  it('OPPOSITE DIRECTION: a real user-stated limit still yields a user-authored verdict', async () => {
    const body = await run({
      graph: { nodes: SYNTH_NODES, edges: SYNTH_EDGES },
      options: SYNTH_OPTS, goal_node_id: 'goal', seed: '42',
      goal_constraints: [{ constraint_id: 'c_cap', node_id: 'cost', operator: '<=', value: 50000 }],
    });

    // PRECONDITION: this run carries a USER constraint and NO synthesised one —
    // synthesis fires only when the compiled set is empty (run.ts:5866), so the
    // two can never coexist.
    expect(body._meta?.constraint_sources ?? {}).not.toHaveProperty('auto_goal_threshold');

    expect(body.robustness.recommended_option_compliance).not.toBe('not_applicable');
    expect(USER_AUTHORED_REASONS)
      .toContain(body.robustness.recommended_option_compliance_reason);
  });

  // CONTRAST CONTROL: no limits AND no goal_threshold ⇒ nothing synthesised,
  // and the verdict is the same `not_applicable`. This is what makes the pin
  // above a statement about PROVENANCE rather than about the verdict value.
  it('CONTRAST: with no goal_threshold nothing is synthesised, and the verdict matches', async () => {
    const body = await run({
      graph: { nodes: SYNTH_NODES, edges: SYNTH_EDGES },
      options: SYNTH_OPTS, goal_node_id: 'goal', seed: '42',
    });
    expect(body._meta?.constraint_sources).toBeUndefined();
    expect(body.robustness.recommended_option_compliance).toBe('not_applicable');
  });
});
