/**
 * A3 constraint trust marker — adversarial-round regression pins.
 *
 * Permanent tests for the two CONFIRMED wrong-TRUE classes found by the
 * independent adversarial review (MARKER-ADVERSARIAL.md, probes P1/P4/P5):
 *
 *   F-A1 — `decision_grade` graded TRUE when a node-level declared range
 *          ('explicit' from state_space.range / 'explicit_cap' from
 *          observed_state.cap) is inherited through the range ladder's branch-1
 *          adoption while the constraint's OWN producer declaration ('%' unit /
 *          goal_threshold_cap) is overridden. range_unified correctly recorded
 *          FALSE, yet the frozen OR-disjunct `(range_unified OR producer-source)`
 *          re-granted TRUE. Fixed by the whitelist derivation
 *          `range_unified AND NOT clamped AND source ∈ DECISION_GRADE_SOURCES`.
 *
 *   F-A2 — `constraints_decision_grade` ANDed over only the REDUCED participating
 *          set, so an option whose failing constraint was dropped by ISL (P4) or
 *          removed by the prob01 NaN guard (P5) read a vacuous TRUE. Fixed by
 *          requiring FULL participation (every active constraint present) before
 *          the AND can be true; a proper subset now reads FALSE.
 *
 * Reuses the faithful-ISL-surrogate harness from the marker test; the surrogate
 * computes prob_satisfied from the NORMALISED threshold it receives vs each
 * option's NORMALISED intervention — the exact cross-scale comparison the real
 * ISL does. Adversarial knobs (below) let the surrogate drop / NaN / omit a
 * per-option constraint verdict to reproduce P4/P5 and the zero-participating
 * control.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

let capturedISLRequest: any = null;

// Adversarial surrogate knobs (reset per test).
let dropConstraintNode: string | null = null; // omit this constraint from...
let dropForOption: string | null = null; //        ...this option's analysis (P4)
let nanConstraintNode: string | null = null; // NaN prob_satisfied for this constraint on...
let nanForOption: string | null = null; //         ...this option (P5)
let omitAnalysisForOption: string | null = null; // option participates in ZERO constraints

function evalConstraint(sample: number, threshold: number, operator: string): { sat: boolean; margin: number } {
  const sat = operator === '<=' ? sample <= threshold : sample >= threshold;
  const margin = operator === '<=' ? sample - threshold : threshold - sample;
  return { sat, margin };
}

function buildSurrogateOptions(body: any) {
  const constraints: any[] = body.goal_constraints ?? [];
  return (body.options ?? []).map((opt: any, idx: number) => {
    const base = {
      option_id: opt.id,
      outcome: { mean: 0.7 - idx * 0.05, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
      rank: idx + 1,
      win_probability: 0.5 - idx * 0.1,
      status: 'computed',
    };
    // Zero-participating control: emit NO constraint_analysis for this option.
    if (omitAnalysisForOption === opt.id) {
      return base;
    }
    if (!constraints.length) {
      return base;
    }
    const evaluated = constraints
      // P4: this option's ISL run silently dropped one constraint.
      .filter((c: any) => !(dropForOption === opt.id && c.node_id === dropConstraintNode))
      .map((c: any) => {
        const sample = opt.interventions?.[c.node_id];
        // P5: this option's ISL run emitted a NaN prob_satisfied for one constraint.
        if (nanForOption === opt.id && c.node_id === nanConstraintNode) {
          return { node_id: c.node_id, operator: c.operator, value: c.value, prob_satisfied: NaN };
        }
        if (typeof sample !== 'number') {
          // Never-intervened node: surrogate cannot breach it → satisfied.
          return { node_id: c.node_id, operator: c.operator, value: c.value, prob_satisfied: 1 };
        }
        const { sat, margin } = evalConstraint(sample, c.value, c.operator);
        return {
          node_id: c.node_id,
          operator: c.operator,
          value: c.value,
          prob_satisfied: sat ? 1 : 0,
          ...(sat ? {} : { failure_margin_median: Math.max(0, margin), near_miss_fraction: 0 }),
        };
      });
    return {
      ...base,
      constraint_analysis: {
        constraints: evaluated,
        joint_probability: evaluated.every((e: any) => e.prob_satisfied === 1) ? 1 : 0,
      },
    };
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

const GOAL = { id: 'goal', kind: 'goal', label: 'Programme value', observed_state: { value: 0.4 } };

// F-A1 (P1): cost carries a node-level state_space.range [0,200000]. Two spread
// interventions ⇒ Phase 4a builds a NON-identity scale whose source is 'explicit'
// (state_space outranks inferred_spread in deriveRange). The constraint's own '%'
// declaration is OVERRIDDEN by branch-1 adoption of that scale ⇒ range_unified
// FALSE, threshold mis-scaled (50/200000), yet HEAD graded decision_grade TRUE.
const COST_STATE_SPACE = { id: 'cost', kind: 'factor', label: 'First-year cost', state_space: { range: { min: 0, max: 200000 } }, observed_state: { value: 30000 } };
const OPTIONS_SPREAD = [
  { id: 'opt_a', label: 'A', interventions: { cost: 25000 } },
  { id: 'opt_b', label: 'B', interventions: { cost: 45000 } },
];

// F-A2 (P4/P5): cost with NO node range → '%' constraint resolves via the
// producer unit_percent scale (grade TRUE); churn never intervened → chain
// deriveRange → inferred_value (grade FALSE). Interventions in [0,1] ⇒ identity
// scale, so c_pct is producer-clean and decision-grade.
const COST_PLAIN = { id: 'cost', kind: 'factor', label: 'First-year cost', observed_state: { value: 30000 } };
const CHURN = { id: 'churn', kind: 'factor', label: 'Churn count', observed_state: { value: 10000 } };
const EDGES_2 = [
  { from: 'cost', to: 'goal', strength: { mean: -0.5, std: 0.1 } },
  { from: 'churn', to: 'goal', strength: { mean: -0.3, std: 0.1 } },
];
const OPTIONS_UNIT_3 = [
  { id: 'opt_a', label: 'A', interventions: { cost: 0.3 } },
  { id: 'opt_b', label: 'B', interventions: { cost: 0.7 } },
  { id: 'opt_c', label: 'C', interventions: { cost: 0.5 } },
];

function optionEntry(body: any, id: string): any {
  return (body.option_comparison ?? []).find((o: any) => o.option_id === id);
}
function topLevelConstraint(body: any, cid: string): any {
  return (body.constraint_results ?? []).find((c: any) => c.constraint_id === cid);
}

describe('A3 constraint trust marker · adversarial-round wrong-TRUE pins (F-A1, F-A2)', () => {
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
  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });
  beforeEach(() => {
    capturedISLRequest = null;
    dropConstraintNode = null;
    dropForOption = null;
    nanConstraintNode = null;
    nanForOption = null;
    omitAnalysisForOption = null;
  });

  async function run(payload: object): Promise<any> {
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
    return res.json();
  }

  // ── F-A1 (probe P1): node-declared range inherited over the constraint's own
  //    '%' producer declaration. range_unified FALSE ⇒ decision_grade MUST be
  //    FALSE (whitelist derivation). At HEAD this graded TRUE/TRUE (wrong-true).
  it('F-A1/P1: node state_space range overrides the constraint % declaration ⇒ range_unified false ⇒ decision_grade false; aggregate false', async () => {
    const body = await run({
      graph: { nodes: [GOAL, COST_STATE_SPACE], edges: [EDGES_2[0]] },
      options: OPTIONS_SPREAD, goal_node_id: 'goal', seed: '42',
      goal_constraints: [{ constraint_id: 'c_pct', node_id: 'cost', operator: '<=', value: 50, unit: '%' }],
    });
    const sp = topLevelConstraint(body, 'c_pct')?.scale_provenance;
    expect(sp).toBeDefined();
    // The node-level state_space.range surfaced as source 'explicit'...
    expect(sp.source).toBe('explicit');
    // ...and correctly recorded that the constraint's own '%' declaration was overridden.
    expect(sp.range_unified).toBe(false);
    // Whitelist derivation: range_unified false ⇒ NOT decision-grade, regardless of source.
    expect(sp.decision_grade).toBe(false);
    // The only participating constraint is non-decision-grade ⇒ aggregate false on both options.
    expect(optionEntry(body, 'opt_a').constraints_decision_grade).toBe(false);
    expect(optionEntry(body, 'opt_b').constraints_decision_grade).toBe(false);
  });

  // ── F-A2 (probe P4): ISL drops the failing (non-decision-grade) constraint
  //    from opt_b. Its participating set becomes a PROPER SUBSET of the active
  //    set ⇒ constraints_decision_grade MUST read false. opt_a (full set)
  //    unchanged; opt_c (zero participating) stays absent. opt_a is kept full so
  //    the top-level constraint_results (built from the first option-with-
  //    constraints) carries BOTH constraints' provenance.
  it('F-A2/P4: a dropped constraint (proper subset) ⇒ constraints_decision_grade false; full-set option unchanged; zero-participating absent', async () => {
    dropConstraintNode = 'churn';
    dropForOption = 'opt_b';
    omitAnalysisForOption = 'opt_c';
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: { nodes: [GOAL, COST_PLAIN, CHURN], edges: EDGES_2 },
        options: OPTIONS_UNIT_3, goal_node_id: 'goal', seed: '42',
        goal_constraints: [
          { constraint_id: 'c_pct', node_id: 'cost', operator: '<=', value: 50, unit: '%' },
          { constraint_id: 'c_churn', node_id: 'churn', operator: '<=', value: 5000 },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const raw = await res.text();
    const body = JSON.parse(raw);
    // c_pct is decision-grade, c_churn is not.
    expect(topLevelConstraint(body, 'c_pct')?.scale_provenance.decision_grade).toBe(true);
    expect(topLevelConstraint(body, 'c_churn')?.scale_provenance.decision_grade).toBe(false);
    // opt_a participates in the full set ⇒ AND = true && false = false (unchanged).
    const a = optionEntry(body, 'opt_a');
    expect(Object.keys(a.constraint_probabilities).sort()).toEqual(['c_churn', 'c_pct']);
    expect(a.constraints_decision_grade).toBe(false);
    // opt_b participates only in c_pct (c_churn dropped) — a proper subset of the
    // {c_pct, c_churn} active set. The dropped non-grade constraint must NOT let
    // the aggregate read clean.
    const b = optionEntry(body, 'opt_b');
    expect(Object.keys(b.constraint_probabilities)).toEqual(['c_pct']);
    expect(b.constraints_decision_grade).toBe(false);
    // opt_c participates in zero constraints ⇒ field genuinely absent (not false/null).
    const c = optionEntry(body, 'opt_c');
    expect('constraints_decision_grade' in c).toBe(false);
  });

  // ── F-A2 (probe P5): prob01 NaN guard removes c_churn from opt_b's
  //    constraint_probabilities — same reduced-set hazard as P4, reached via a
  //    degraded (NaN) verdict rather than an outright drop. opt_a stays full.
  it('F-A2/P5: a NaN-guarded constraint (proper subset) ⇒ constraints_decision_grade false; full-set option unchanged', async () => {
    nanConstraintNode = 'churn';
    nanForOption = 'opt_b';
    const body = await run({
      graph: { nodes: [GOAL, COST_PLAIN, CHURN], edges: EDGES_2 },
      options: [OPTIONS_UNIT_3[0], OPTIONS_UNIT_3[1]], goal_node_id: 'goal', seed: '42',
      goal_constraints: [
        { constraint_id: 'c_pct', node_id: 'cost', operator: '<=', value: 50, unit: '%' },
        { constraint_id: 'c_churn', node_id: 'churn', operator: '<=', value: 5000 },
      ],
    });
    // opt_a full ⇒ AND = true && false = false (unchanged).
    const a = optionEntry(body, 'opt_a');
    expect(Object.keys(a.constraint_probabilities).sort()).toEqual(['c_churn', 'c_pct']);
    expect(a.constraints_decision_grade).toBe(false);
    // opt_b: the prob01 guard dropped the NaN c_churn ⇒ participating = {c_pct} only.
    const b = optionEntry(body, 'opt_b');
    expect(Object.keys(b.constraint_probabilities)).toEqual(['c_pct']);
    expect(b.constraints_decision_grade).toBe(false);
  });
});
