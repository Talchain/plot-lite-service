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
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

let capturedISLRequest: any = null;

function evalConstraint(sample: number, threshold: number, operator: string): { sat: boolean; margin: number } {
  const sat = operator === '<=' ? sample <= threshold : sample >= threshold;
  const margin = operator === '<=' ? sample - threshold : threshold - sample;
  return { sat, margin };
}

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
            return {
              node_id: c.node_id,
              operator: c.operator,
              value: c.value,
              prob_satisfied: sat ? 1 : 0,
              ...(sat ? {} : { failure_margin_median: Math.max(0, margin), near_miss_fraction: 0 }),
            };
          }),
          joint_probability: constraints.every((c: any) => {
            const s = opt.interventions?.[c.node_id];
            return typeof s !== 'number' || evalConstraint(s, c.value, c.operator).sat;
          })
            ? 1
            : 0,
        }
      : undefined;
    return {
      option_id: opt.id,
      outcome: { mean: 0.7 - idx * 0.05, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
      rank: idx + 1,
      win_probability: 0.5 - idx * 0.1,
      status: 'computed',
      ...(analysis !== undefined && { constraint_analysis: analysis }),
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

describe('A3 constraint trust marker · scale_provenance + constraints_decision_grade', () => {
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
  }, 30000); // generous cold-start budget (server-spawn transform race, per CLAUDE.md)
  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });
  beforeEach(() => { capturedISLRequest = null; });

  async function run(payload: object): Promise<any> {
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
    return res.json();
  }

  // (a) #239 probe: measured spread + a cap BELOW the floor → clamped threshold.
  it('(a) inferred_spread + clamped-low threshold ⇒ decision_grade false; aggregate false on both options', async () => {
    const body = await run({
      graph: { nodes: [NODES[0], NODES[1]], edges: [EDGES[0]] },
      options: OPTIONS_SPREAD, goal_node_id: 'goal', seed: '42',
      goal_constraints: [{ constraint_id: 'c1', node_id: 'cost', operator: '<=', value: 20000 }],
    });
    const sp = topLevelConstraint(body, 'c1')?.scale_provenance;
    expect(sp).toBeDefined();
    expect(sp.source).toBe('inferred_spread');
    expect(sp.range_unified).toBe(true);
    expect(sp.threshold_clamped).toBe('low');
    expect(sp.decision_grade).toBe(false);
    // Aggregate: the ONLY participating constraint is non-decision-grade → false.
    expect(optionEntry(body, 'opt_a').constraints_decision_grade).toBe(false);
    expect(optionEntry(body, 'opt_b').constraints_decision_grade).toBe(false);
  });

  // (b) producer-declared clean ('%' unit, unclamped) ⇒ decision_grade true.
  it('(b) unit_percent, unclamped ⇒ decision_grade true; aggregate true on both options', async () => {
    const body = await run({
      graph: { nodes: [NODES[0], NODES[1]], edges: [EDGES[0]] },
      options: OPTIONS_UNIT, goal_node_id: 'goal', seed: '42',
      goal_constraints: [{ constraint_id: 'c_pct', node_id: 'cost', operator: '<=', value: 50, unit: '%' }],
    });
    const sp = topLevelConstraint(body, 'c_pct')?.scale_provenance;
    expect(sp).toBeDefined();
    expect(sp.source).toBe('unit_percent');
    expect(sp.decision_grade).toBe(true);
    expect('threshold_clamped' in sp).toBe(false); // unclamped ⇒ key omitted
    expect(optionEntry(body, 'opt_a').constraints_decision_grade).toBe(true);
    expect(optionEntry(body, 'opt_b').constraints_decision_grade).toBe(true);
  });

  // (c) never-intervened node resolving via chain to inferred_value:
  //     range_unified TRUE (never intervened) but decision_grade FALSE (D-5).
  it('(c) never-intervened inferred_value ⇒ range_unified true, decision_grade false', async () => {
    const body = await run({
      graph: GRAPH, options: OPTIONS_UNIT, goal_node_id: 'goal', seed: '42',
      goal_constraints: [{ constraint_id: 'c_churn', node_id: 'churn', operator: '<=', value: 5000 }],
    });
    const sp = topLevelConstraint(body, 'c_churn')?.scale_provenance;
    expect(sp).toBeDefined();
    expect(sp.source).toBe('inferred_value');
    expect(sp.range_unified).toBe(true);
    expect('threshold_clamped' in sp).toBe(false);
    expect(sp.decision_grade).toBe(false);
    expect(optionEntry(body, 'opt_a').constraints_decision_grade).toBe(false);
  });

  // (d) multi-constraint option: one decision_grade true (%), one false (inferred_value)
  //     ⇒ AND aggregate is false, while each constraint keeps its own grade.
  it('(d) mixed option: decision_grade true AND false ⇒ aggregate false', async () => {
    const body = await run({
      graph: GRAPH, options: OPTIONS_UNIT, goal_node_id: 'goal', seed: '42',
      goal_constraints: [
        { constraint_id: 'c_pct', node_id: 'cost', operator: '<=', value: 50, unit: '%' },
        { constraint_id: 'c_churn', node_id: 'churn', operator: '<=', value: 5000 },
      ],
    });
    expect(topLevelConstraint(body, 'c_pct')?.scale_provenance.decision_grade).toBe(true);
    expect(topLevelConstraint(body, 'c_churn')?.scale_provenance.decision_grade).toBe(false);
    // Both constraints participate for each option → AND = true && false = false.
    expect(optionEntry(body, 'opt_a').constraints_decision_grade).toBe(false);
    expect(optionEntry(body, 'opt_b').constraints_decision_grade).toBe(false);
  });

  // (e) absence: an option with zero participating constraints (no constraints
  //     sent) ⇒ constraints_decision_grade is GENUINELY OMITTED, not null/false.
  it('(e) zero participating constraints ⇒ constraints_decision_grade absent (not false, not null)', async () => {
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: { nodes: [NODES[0], NODES[1]], edges: [EDGES[0]] },
        options: OPTIONS_SPREAD, goal_node_id: 'goal', seed: '42',
      }),
    });
    expect(res.status).toBe(200);
    const raw = await res.text();
    const body = JSON.parse(raw);
    const a = optionEntry(body, 'opt_a');
    expect(a).toBeDefined();
    // Genuinely omitted: key absent (Fastify drops undefined) — NOT a vacuous true,
    // NOT null. Assert on the parsed object AND the raw wire bytes.
    expect('constraints_decision_grade' in a).toBe(false);
    expect(raw).not.toMatch(/"constraints_decision_grade"/);
  });

  // (f) A3 R1 FALSE-DIVERGENCE FIX: a MEASURED intervention spread that is
  //     NUMERICALLY EQUAL to the node's producer cap is NOT a divergence — the
  //     threshold sits on the samples' own scale. Interventions 10000/70000 →
  //     spread [0,82000] (source inferred_spread); node goal_threshold_cap 82000 →
  //     producer scale [0,82000]. Equal bounds ⇒ range_unified TRUE ⇒
  //     decision_grade TRUE. Threshold 40000 sits INSIDE [0,82000] (unclamped).
  //     RED at HEAD (graded range_unified:false / decision_grade:false); GREEN after.
  it('(f) equal-range: measured spread == producer cap ⇒ range_unified true, decision_grade true (R1 fix)', async () => {
    const COST_CAP_82K = {
      id: 'cost', kind: 'factor', label: 'First-year cost',
      observed_state: { value: 30000 }, goal_threshold_cap: 82000,
    };
    const body = await run({
      graph: { nodes: [NODES[0], COST_CAP_82K], edges: [EDGES[0]] },
      options: [
        { id: 'opt_a', label: 'A', interventions: { cost: 10000 } },
        { id: 'opt_b', label: 'B', interventions: { cost: 70000 } },
      ],
      goal_node_id: 'goal', seed: '42',
      goal_constraints: [{ constraint_id: 'c_eq', node_id: 'cost', operator: '<=', value: 40000 }],
    });
    const sp = topLevelConstraint(body, 'c_eq')?.scale_provenance;
    expect(sp).toBeDefined();
    expect(sp.source).toBe('inferred_spread');
    expect(sp.range_unified).toBe(true);
    expect('threshold_clamped' in sp).toBe(false); // 40000 ∈ [0,82000] ⇒ unclamped
    expect(sp.decision_grade).toBe(true);
    // Sole participating constraint is decision-grade ⇒ aggregate true on both.
    expect(optionEntry(body, 'opt_a').constraints_decision_grade).toBe(true);
    expect(optionEntry(body, 'opt_b').constraints_decision_grade).toBe(true);
  });

  // (g) POSITIVE CONTROL: a GENUINE divergence must STILL grade false — proves the
  //     R1 fix narrows divergence to a NUMERIC inequality, it does NOT flip
  //     everything true. Interventions 25000/45000 → spread [21000,49000]; node
  //     goal_threshold_cap 40000 → producer scale [0,40000]. Unequal ⇒ diverged ⇒
  //     range_unified FALSE ⇒ decision_grade FALSE. Threshold 30000 is INSIDE
  //     [21000,49000] (unclamped), so range_unified is the SOLE cause (not a clamp).
  //     GREEN before AND after the fix, and GREEN after a mutation-revert.
  it('(g) POSITIVE CONTROL genuine divergence (spread != cap) ⇒ range_unified false, decision_grade false', async () => {
    const COST_CAP_40K = {
      id: 'cost', kind: 'factor', label: 'First-year cost',
      observed_state: { value: 30000 }, goal_threshold_cap: 40000,
    };
    const body = await run({
      graph: { nodes: [NODES[0], COST_CAP_40K], edges: [EDGES[0]] },
      options: OPTIONS_SPREAD, // interventions 25000/45000 → spread [21000,49000]
      goal_node_id: 'goal', seed: '42',
      goal_constraints: [{ constraint_id: 'c_div', node_id: 'cost', operator: '<=', value: 30000 }],
    });
    const sp = topLevelConstraint(body, 'c_div')?.scale_provenance;
    expect(sp).toBeDefined();
    expect(sp.source).toBe('inferred_spread');
    expect(sp.range_unified).toBe(false);
    expect('threshold_clamped' in sp).toBe(false); // 30000 ∈ [21000,49000] ⇒ unclamped
    expect(sp.decision_grade).toBe(false);
    expect(optionEntry(body, 'opt_a').constraints_decision_grade).toBe(false);
    expect(optionEntry(body, 'opt_b').constraints_decision_grade).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // D-8 (A3-DOCTRINE-DECISIONS-2026-07-21): extend the divergence check to
  // NODE-level producer declarations (explicit_cap = observed_state.cap;
  // explicit = state_space.range).
  //
  // ⚠ NO RED-FIRST CASE EXISTS. The D-8 gate asked for a node with an
  // explicit_cap/state_space range [0,X] whose MEASURED intervention spread is a
  // DIFFERENT range [a,b] ≠ [0,X] (branch-1) — asserting range_unified:false.
  // That input is NOT CONSTRUCTIBLE: deriveRange gives explicit_cap/explicit TOP
  // priority (branches 0/1), so a node that declares [0,X] has its INTERVENTIONS
  // normalised against [0,X] too — the intervention scale IS the declaration, never
  // a divergent spread. The extension is therefore a PROVABLE NO-OP (see D8-NOTES).
  // The tests below are POSITIVE CONTROLS (must-stay-TRUE) — the mirror-of-R1
  // concern is OVER-tightening, and these prove the node-level extension does NOT
  // over-tighten. They pass at HEAD AND after the extension (that invariance is the
  // no-op proof); reverting the extension keeps them green.

  // (h) POSITIVE CONTROL — node-level explicit_cap. observed_state.cap=40000 ⇒ the
  //     INTERVENTIONS (25000/45000) normalise against [0,40000] (source
  //     explicit_cap), so interventionScale == the node's declared cap. Equal ⇒
  //     range_unified TRUE, decision_grade TRUE. An explicit_cap is NOT a
  //     divergence — it DEFINES the samples' scale.
  it('(h) node explicit_cap ⇒ intervention scale IS the cap ⇒ range_unified true (no over-tighten)', async () => {
    const COST_CAP_NODE = {
      id: 'cost', kind: 'factor', label: 'First-year cost',
      observed_state: { value: 30000, cap: 40000 },
    };
    const body = await run({
      graph: { nodes: [NODES[0], COST_CAP_NODE], edges: [EDGES[0]] },
      options: OPTIONS_SPREAD, // interventions 25000/45000
      goal_node_id: 'goal', seed: '42',
      goal_constraints: [{ constraint_id: 'c_cap', node_id: 'cost', operator: '<=', value: 30000 }],
    });
    const sp = topLevelConstraint(body, 'c_cap')?.scale_provenance;
    expect(sp).toBeDefined();
    expect(sp.source).toBe('explicit_cap');
    expect(sp.range_unified).toBe(true);
    expect('threshold_clamped' in sp).toBe(false); // 30000 ∈ [0,40000] ⇒ unclamped
    expect(sp.decision_grade).toBe(true);
    expect(optionEntry(body, 'opt_a').constraints_decision_grade).toBe(true);
    expect(optionEntry(body, 'opt_b').constraints_decision_grade).toBe(true);
  });

  // (i) POSITIVE CONTROL — node-level explicit (state_space.range). Same mechanism:
  //     the interventions normalise against the declared [0,40000] (source
  //     explicit), so interventionScale == the declaration ⇒ range_unified TRUE.
  it('(i) node state_space.range ⇒ intervention scale IS the range ⇒ range_unified true', async () => {
    const COST_RANGE_NODE = {
      id: 'cost', kind: 'factor', label: 'First-year cost',
      observed_state: { value: 30000 }, state_space: { range: { min: 0, max: 40000 } },
    };
    const body = await run({
      graph: { nodes: [NODES[0], COST_RANGE_NODE], edges: [EDGES[0]] },
      options: OPTIONS_SPREAD, // interventions 25000/45000
      goal_node_id: 'goal', seed: '42',
      goal_constraints: [{ constraint_id: 'c_ss', node_id: 'cost', operator: '<=', value: 30000 }],
    });
    const sp = topLevelConstraint(body, 'c_ss')?.scale_provenance;
    expect(sp).toBeDefined();
    expect(sp.source).toBe('explicit');
    expect(sp.range_unified).toBe(true);
    expect('threshold_clamped' in sp).toBe(false);
    expect(sp.decision_grade).toBe(true);
    expect(optionEntry(body, 'opt_a').constraints_decision_grade).toBe(true);
    expect(optionEntry(body, 'opt_b').constraints_decision_grade).toBe(true);
  });

  // (j) CHARACTERIZATION — BOTH declarations present, MUTUALLY DIFFERENT. Node has
  //     observed_state.cap=40000 (⇒ interventionScale explicit_cap [0,40000]) AND a
  //     CONSTRAINT-level goal_threshold_cap=100000 ([0,100000]). interventionScale
  //     equals the node-level declaration but NOT the constraint-level one ⇒
  //     divergence ⇒ range_unified FALSE. This fires via the EXISTING R1
  //     constraint-level check (goal_threshold_cap), NOT the D-8 node-level
  //     extension — it is FALSE at HEAD too. Pins the "divergence from EITHER"
  //     behaviour and proves the both-exist path is already covered.
  it('(j) both declarations, constraint-level differs ⇒ range_unified false (existing R1 path)', async () => {
    const COST_BOTH_NODE = {
      id: 'cost', kind: 'factor', label: 'First-year cost',
      observed_state: { value: 30000, cap: 40000 }, goal_threshold_cap: 100000,
    };
    const body = await run({
      graph: { nodes: [NODES[0], COST_BOTH_NODE], edges: [EDGES[0]] },
      options: OPTIONS_SPREAD, // interventions 25000/45000
      goal_node_id: 'goal', seed: '42',
      goal_constraints: [{ constraint_id: 'c_both', node_id: 'cost', operator: '<=', value: 30000 }],
    });
    const sp = topLevelConstraint(body, 'c_both')?.scale_provenance;
    expect(sp).toBeDefined();
    expect(sp.source).toBe('explicit_cap'); // interventionScale wins the ladder (branch-1)
    expect(sp.range_unified).toBe(false); // diverges from constraint-level goal_threshold_cap [0,100000]
    expect('threshold_clamped' in sp).toBe(false); // 30000 ∈ [0,40000] ⇒ unclamped
    expect(sp.decision_grade).toBe(false);
    expect(optionEntry(body, 'opt_a').constraints_decision_grade).toBe(false);
    expect(optionEntry(body, 'opt_b').constraints_decision_grade).toBe(false);
  });
});
