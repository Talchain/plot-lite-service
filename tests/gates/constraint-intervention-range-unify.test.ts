/**
 * A3 / SCIENCE — Constraint vs intervention normalisation range UNIFY.
 * ----------------------------------------------------------------------------
 * Verified HIGH-severity defect (see acceptance-evidence/a3-verify-2026-07-16/
 * constraint-norm-split/FINDINGS.md): interventions and the constraint threshold
 * on the SAME node normalise against DIFFERENT ranges whenever the node lacks an
 * explicit/producer-declared scale. Interventions get
 * `deriveRange(node, hints, interventionValues)` (spread-capable → e.g.
 * [21000,49000]); the constraint threshold got a BARE `deriveRange(targetNode)`
 * (→ e.g. [0,60000]). ISL then evaluates `prob_satisfied` and margins ACROSS the
 * two scales → a violated cap can score probability 1, and margins are on a
 * phantom width.
 *
 * INVARIANT under test: ONE range per node — the constraint threshold must be
 * normalised against the EXACT range that node's interventions used, in EVERY
 * gate combination.
 *
 * Two layers:
 *   A. Pure-function pins on `normaliseGoalConstraints` (drives the new
 *      `interventionScaleByNodeId` extra) — asserts SHARED ARGUMENTS, not just
 *      shared functions.
 *   B. Route-level pins with a FAITHFUL ISL surrogate that computes
 *      `prob_satisfied` / `failure_margin_median` from the normalised threshold
 *      it actually receives — so the probability inversion and phantom margin are
 *      reproduced end-to-end, and the four gate combinations are each documented.
 */

import { makeOptionResultV2 } from '../helpers/isl-option-fixture.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import {
  normaliseOptionsForISL,
  normaliseGoalConstraints,
} from '../../src/lib/intervention-normaliser.js';
import type {
  EngineNodeV3,
  OptionV3,
  GoalConstraint,
} from '../../src/types/engine-v3.js';

// ===========================================================================
// Layer A — pure-function pins: shared ARGUMENTS (same node → same range)
// ===========================================================================

describe('A3 range-unify · pure function · constraint shares the intervention range', () => {
  // Live-probe node: cost, observed value 30000, NO cap, NO state_space.range.
  const nodes: EngineNodeV3[] = [
    { id: 'goal', kind: 'goal', label: 'Goal', observed_state: { value: 0.4 } },
    { id: 'cost', kind: 'factor', label: 'First-year cost', observed_state: { value: 30000 } },
  ] as unknown as EngineNodeV3[];

  const options: OptionV3[] = [
    { id: 'opt_a', label: 'A', interventions: { cost: { value: 25000, source: 'user_specified' } } },
    { id: 'opt_b', label: 'B', interventions: { cost: { value: 45000, source: 'user_specified' } } },
  ] as unknown as OptionV3[];

  it('interventions derive the spread range [21000,49000] (source inferred_spread)', () => {
    const { context } = normaliseOptionsForISL(options, nodes, 'goal');
    const range = context.factors.get('cost')?.range;
    expect(range).toBeDefined();
    expect(range!.min).toBeCloseTo(21000, 6);
    expect(range!.max).toBeCloseTo(49000, 6);
    expect(range!.source).toBe('inferred_spread');
  });

  it('THE SPLIT (documented at HEAD): a BARE constraint derivation lands on a DIFFERENT range', () => {
    // This is what run.ts did before the fix (deriveRange(targetNode), no scale).
    // Pinned so the regression is legible: the constraint fell to [0,60000].
    const { diagnostics } = normaliseGoalConstraints(
      [{ constraint_id: 'c1', node_id: 'cost', operator: '<=', value: 20000 }],
      nodes,
    );
    const range = diagnostics[0].range;
    expect(range.min).toBe(0);
    expect(range.max).toBe(60000); // 2 × observed value 30000
    // ...which is NOT the intervention range [21000,49000]. That is the bug.
    expect(range.max).not.toBeCloseTo(49000, 0);
  });

  it('FIX: given the intervention scale, the constraint uses the SAME range (shared arguments)', () => {
    const { context } = normaliseOptionsForISL(options, nodes, 'goal');
    const interventionRange = context.factors.get('cost')!.range;

    const { constraints, diagnostics } = normaliseGoalConstraints(
      [{ constraint_id: 'c1', node_id: 'cost', operator: '<=', value: 20000 }],
      nodes,
      { interventionScaleByNodeId: new Map([['cost', interventionRange]]) },
    );

    // The constraint's normalisation range is now IDENTICAL to the intervention range.
    expect(diagnostics[0].range.min).toBeCloseTo(interventionRange.min, 6);
    expect(diagnostics[0].range.max).toBeCloseTo(interventionRange.max, 6);

    // Threshold 20000 sits BELOW the range floor (21000) → clamps to 0 on the
    // shared scale, so an intervention sample of 0.142857 (opt_a 25000) is NOT
    // `<= threshold` → the '<=' constraint is correctly VIOLATED (was prob 1).
    expect(constraints[0].value).toBe(0);
    expect(constraints[0].original_value).toBe(20000);
  });

  it('FIX: a threshold INSIDE the spread normalises exactly on the shared range', () => {
    const { context } = normaliseOptionsForISL(options, nodes, 'goal');
    const interventionRange = context.factors.get('cost')!.range;
    const { constraints } = normaliseGoalConstraints(
      [{ constraint_id: 'c1', node_id: 'cost', operator: '<=', value: 30000 }],
      nodes,
      { interventionScaleByNodeId: new Map([['cost', interventionRange]]) },
    );
    // (30000 - 21000) / 28000 = 0.321428...
    expect(constraints[0].value).toBeCloseTo(0.32142857, 6);
  });

  it('DOCTRINE-PENDING: the intervention scale wins over a producer goal_threshold_cap', () => {
    const { constraints, diagnostics } = normaliseGoalConstraints(
      [{ constraint_id: 'c1', node_id: 'cost', operator: '<=', value: 30000 }],
      nodes,
      {
        interventionScaleByNodeId: new Map([['cost', { min: 21000, max: 49000, source: 'inferred_spread' }]]),
        goalThresholdMetaByNodeId: new Map([['cost', { goal_threshold_cap: 100000 }]]),
      },
    );
    // Not [0,100000]: the intervention range is the scale the samples live on.
    expect(diagnostics[0].range.max).toBeCloseTo(49000, 6);
    expect(constraints[0].value).toBeCloseTo(0.32142857, 6);
  });
});

// ===========================================================================
// Layer A2 — F1 regression pin: non-intervened node, gate FALSE, forwarded RAW
// ===========================================================================
// F1 (adversarial review, MEDIUM): when the global gate is FALSE (all constraint
// values already in [0,1]) but the function is called anyway because some OTHER
// node has a non-identity intervention scale, a constraint on a DIFFERENT,
// NON-intervened node carrying a producer-declared scale ('%' unit or
// goal_threshold_cap) was NEWLY normalised (0.5 → 0.005 / ×1/cap) with a new
// repair — where HEAD forwarded it RAW (HEAD only called the function when the
// gate fired). This pins the restored HEAD parity: forwarded raw, NO repair.
describe('A3 range-unify · F1 · producer-scale constraint on a non-intervened node, gate FALSE', () => {
  // 'cost' is the intervened node with a non-identity scale (forces the caller to
  // invoke the function via anyNonIdentityScale). 'churn' is a DIFFERENT,
  // NON-intervened node — it has NO entry in interventionScaleByNodeId.
  const nodes: EngineNodeV3[] = [
    { id: 'goal', kind: 'goal', label: 'Goal', observed_state: { value: 0.4 } },
    { id: 'cost', kind: 'factor', label: 'First-year cost', observed_state: { value: 30000 } },
    { id: 'churn', kind: 'factor', label: 'Churn rate', observed_state: { value: 0.1 } },
  ] as unknown as EngineNodeV3[];

  // The OTHER node's scale — its mere presence is what forces the call in the route
  // (anyNonIdentityScale) and reproduces the F1 combo. 'churn' is absent from it.
  const interventionScaleByNodeId = new Map([
    ['cost', { min: 21000, max: 49000, source: 'inferred_spread' as const }],
  ]);

  it("'%'-unit constraint on the non-intervened node is FORWARDED RAW (not 0.005), no repair", () => {
    const { constraints, repairs, diagnostics } = normaliseGoalConstraints(
      [{ constraint_id: 'c_pct', node_id: 'churn', operator: '<=', value: 0.5 }],
      nodes,
      {
        unitsByConstraintId: new Map([['c_pct', '%']]),
        interventionScaleByNodeId,
        normaliseWithoutScale: false, // global gate did NOT fire
      },
    );
    // HEAD forwarded 0.5 raw (function not called for non-intervened nodes). The
    // fix must reproduce that EXACTLY — NOT re-scale it to 0.005 via unit_percent.
    expect(constraints[0].value).toBe(0.5);
    expect(constraints[0].original_value).toBe(0.5);
    // Forwarded-raw ⇒ identity no-op ⇒ NO repair, NO diagnostic (so it cannot trip
    // the reliability gate or margin denorm — byte-identical to HEAD).
    expect(repairs.filter(r => r.field === 'constraint.value.c_pct')).toHaveLength(0);
    expect(diagnostics.filter(d => d.constraint_id === 'c_pct')).toHaveLength(0);
  });

  it('goal_threshold_cap constraint on the non-intervened node is FORWARDED RAW, no repair', () => {
    const { constraints, repairs, diagnostics } = normaliseGoalConstraints(
      [{ constraint_id: 'c_cap', node_id: 'churn', operator: '<=', value: 0.5 }],
      nodes,
      {
        goalThresholdMetaByNodeId: new Map([['churn', { goal_threshold_cap: 100000 }]]),
        interventionScaleByNodeId,
        normaliseWithoutScale: false, // global gate did NOT fire
      },
    );
    // HEAD forwarded 0.5 raw; the fix must NOT re-scale it to 0.000005 via the cap.
    expect(constraints[0].value).toBe(0.5);
    expect(repairs.filter(r => r.field === 'constraint.value.c_cap')).toHaveLength(0);
    expect(diagnostics.filter(d => d.constraint_id === 'c_cap')).toHaveLength(0);
  });

  it('parity control: gate TRUE ⇒ the producer scale STILL applies (no over-broad guard)', () => {
    // The reorder must ONLY forward-raw when the gate is FALSE. With the gate TRUE
    // (or default), a '%'-unit constraint on a non-intervened node must still be
    // normalised via unit_percent exactly as before the F1 fix.
    const { constraints, repairs } = normaliseGoalConstraints(
      [{ constraint_id: 'c_pct', node_id: 'churn', operator: '<=', value: 50 }],
      nodes,
      {
        unitsByConstraintId: new Map([['c_pct', '%']]),
        interventionScaleByNodeId,
        normaliseWithoutScale: true, // global gate DID fire
      },
    );
    expect(constraints[0].value).toBeCloseTo(0.5, 6); // 50 / 100
    expect(repairs.filter(r => r.field === 'constraint.value.c_pct')).toHaveLength(1);
  });
});

// ===========================================================================
// Layer A3 — F4 regression pin: producer '%'/cap must OUTRANK an IDENTITY scale
// ===========================================================================
// F4 (Codex-confirmed): interventions already in [0,1] (Phase 4a SKIPPED) install
// an IDENTITY [0,1] intervention scale for the intervened node. A public
// constraint {value:50, unit:'%'} (or goal_threshold_cap:100) on that node then
// hit the (top-priority) interventionScale branch → 50 CLAMPED to 1, source
// 'default' → the reliability gate (threshold_normalisation_defaulted) SUPPRESSED
// a constraint HEAD evaluated correctly. The fix ranks producer declarations
// ABOVE an identity scale (but BELOW a measured non-identity spread). The
// discriminator: value 50 must land 0.5 on [0,100] with a NON-'default' source.
describe('A3 range-unify · F4 · producer scale outranks an identity intervention scale', () => {
  const nodes: EngineNodeV3[] = [
    { id: 'goal', kind: 'goal', label: 'Goal', observed_state: { value: 0.4 } },
    { id: 'cost', kind: 'factor', label: 'First-year cost', observed_state: { value: 30000 } },
  ] as unknown as EngineNodeV3[];

  // Phase-4a-skipped node ⇒ carried as an IDENTITY [0,1] scale by the route.
  const identityScale = new Map([['cost', { min: 0, max: 1, source: 'default' as const }]]);

  it("'%' unit OUTRANKS the identity scale: 50 → 0.5 on [0,100], source unit_percent (not clamped to 1/default)", () => {
    const { constraints, diagnostics } = normaliseGoalConstraints(
      [{ constraint_id: 'c_pct', node_id: 'cost', operator: '<=', value: 50 }],
      nodes,
      {
        unitsByConstraintId: new Map([['c_pct', '%']]),
        interventionScaleByNodeId: identityScale,
        normaliseWithoutScale: true, // gate fired (50 is out of [0,1])
      },
    );
    // At HEAD (before F4): identity branch → 50 clamps to 1, source 'default'.
    expect(constraints[0].value).toBeCloseTo(0.5, 6);
    expect(diagnostics[0].range.min).toBe(0);
    expect(diagnostics[0].range.max).toBe(100);
    expect(diagnostics[0].range.source).toBe('unit_percent');
  });

  it('goal_threshold_cap OUTRANKS the identity scale: 50 → 0.5 on [0,100], source goal_threshold_cap', () => {
    const { constraints, diagnostics } = normaliseGoalConstraints(
      [{ constraint_id: 'c_cap', node_id: 'cost', operator: '<=', value: 50 }],
      nodes,
      {
        goalThresholdMetaByNodeId: new Map([['cost', { goal_threshold_cap: 100 }]]),
        interventionScaleByNodeId: identityScale,
        normaliseWithoutScale: true,
      },
    );
    expect(constraints[0].value).toBeCloseTo(0.5, 6);
    expect(diagnostics[0].range.max).toBe(100);
    expect(diagnostics[0].range.source).toBe('goal_threshold_cap');
  });

  it('CONTROL: identity scale is STILL honoured when there is NO producer declaration (branch 5)', () => {
    // Proves the reorder did not blanket-replace the identity scale with the
    // chain — an identity scale with no '%'/cap still applies (50 → clamp 1,
    // source default), ranking BELOW producers but ABOVE the node heuristic.
    const { constraints, diagnostics } = normaliseGoalConstraints(
      [{ constraint_id: 'c_plain', node_id: 'cost', operator: '<=', value: 50 }],
      nodes,
      {
        interventionScaleByNodeId: identityScale,
        normaliseWithoutScale: true,
      },
    );
    expect(constraints[0].value).toBe(1); // clamped onto identity [0,1]
    expect(diagnostics[0].range.source).toBe('default');
    // NOT the node heuristic [0,60000] (that would be source 'inferred_value'/
    // 'default' via deriveRange — here it is the identity scale, max 1).
    expect(diagnostics[0].range.max).toBe(1);
  });

  it('CONTROL: a measured NON-identity spread still OUTRANKS a producer cap (branch 1, doctrine-pending)', () => {
    // The reorder must only demote the IDENTITY scale — a real measured spread
    // still wins over the producer cap (the DOCTRINE-PENDING pick), unchanged.
    const { constraints, diagnostics } = normaliseGoalConstraints(
      [{ constraint_id: 'c_cap', node_id: 'cost', operator: '<=', value: 30000 }],
      nodes,
      {
        goalThresholdMetaByNodeId: new Map([['cost', { goal_threshold_cap: 100 }]]),
        interventionScaleByNodeId: new Map([['cost', { min: 21000, max: 49000, source: 'inferred_spread' as const }]]),
        normaliseWithoutScale: true,
      },
    );
    expect(diagnostics[0].range.max).toBeCloseTo(49000, 6);
    expect(constraints[0].value).toBeCloseTo(0.32142857, 6);
  });
});

// ===========================================================================
// Layer B — route-level pins with a FAITHFUL ISL surrogate
// ===========================================================================
// The surrogate computes prob_satisfied / failure_margin_median from the
// NORMALISED threshold it receives and each option's NORMALISED intervention on
// the constraint's node — exactly the cross-scale comparison the real ISL does.
// This is what makes the probability inversion observable end-to-end.

let capturedISLRequest: any = null;

function evalConstraint(sample: number, threshold: number, operator: string): { sat: boolean; margin: number } {
  // Point "sample" = the option's single normalised intervention on the node.
  const sat = operator === '<=' ? sample <= threshold : sample >= threshold;
  // Breach distance in normalised space (ISL convention); undefined-when-satisfied
  // is modelled by the caller.
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
    return makeOptionResultV2({
      // ROADMAP 2.744 sweep — RAW ISL V2 wire, routed through the contract-derived
      // builder. `option_id` was V1's identity name (V2 declares `id`) and `rank`
      // is declared on NEITHER ISL option schema; both were inert at the consumer
      // (run.ts reads `r.option_id ?? r.id`, and nothing reads `rank` on the V2
      // path) — but the literal was a hand-maintained mirror, which is the defect.
      id: opt.id,
      outcome: { mean: 0.7 - idx * 0.05, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
      win_probability: 0.5 - idx * 0.1,
      status: 'computed',
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
    // analyseRobustness is called with already-normalised options; reconstruct a
    // body-shaped object so the surrogate can read interventions + constraints.
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

// Live-probe graph: cost node with NO cap / NO state_space.range.
const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Programme value', observed_state: { value: 0.4 } },
    { id: 'cost', kind: 'factor', label: 'First-year cost', observed_state: { value: 30000 } },
  ],
  edges: [{ from: 'cost', to: 'goal', strength: { mean: -0.5, std: 0.1 } }],
};

// Interventions 25000 / 45000 → spread range [21000,49000].
const OPTIONS_RAW = [
  { id: 'opt_a', label: 'A', interventions: { cost: 25000 } },
  { id: 'opt_b', label: 'B', interventions: { cost: 45000 } },
];
// Interventions already in [0,1] → Phase 4a SKIPPED (Caveat A combos 3 & 4).
const OPTIONS_UNIT = [
  { id: 'opt_a', label: 'A', interventions: { cost: 0.3 } },
  { id: 'opt_b', label: 'B', interventions: { cost: 0.7 } },
];

function optionEntry(body: any, id: string): any {
  return (body.option_comparison ?? []).find((o: any) => o.option_id === id);
}
function constraintValueSentToISL(cid: string): number | undefined {
  return (capturedISLRequest?.goal_constraints ?? []).find((c: any) => c.constraint_id === cid)?.value;
}

describe('A3 range-unify · route level · faithful ISL surrogate', () => {
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
  });
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

  // ---- COMBO 1: interventions out of [0,1], constraint out of [0,1] (the defect) ----
  it('COMBO 1: a violated <= cap scores prob 0, not 1 (probability inversion fixed)', async () => {
    const body = await run({
      graph: GRAPH, options: OPTIONS_RAW, goal_node_id: 'goal', seed: '42',
      goal_constraints: [{ constraint_id: 'c1', node_id: 'cost', operator: '<=', value: 20000 }],
    });
    // Threshold 20000 is below the intervention floor 21000 → clamps to 0 on the
    // SHARED scale (was 0.333 on the phantom [0,60000] scale).
    expect(constraintValueSentToISL('c1')).toBe(0);

    // opt_a intervenes cost=25000 (> 20000): the '<=' cap is VIOLATED.
    const a = optionEntry(body, 'opt_a');
    expect(a.constraint_probabilities?.c1).toBe(0); // was wrongly 1 at HEAD
  });

  it('COMBO 1: opt_b margin is denormalised on the intervention width, not [0,60000]', async () => {
    const body = await run({
      graph: GRAPH, options: OPTIONS_RAW, goal_node_id: 'goal', seed: '42',
      goal_constraints: [{ constraint_id: 'c1', node_id: 'cost', operator: '<=', value: 20000 }],
    });
    // opt_b 45000 → normalised 0.857143; threshold clamped 0; surrogate margin
    // 0.857143; × intervention width 28000 = 24000 (was 31428.57 on width 60000).
    const b = optionEntry(body, 'opt_b');
    const m = b.constraint_margins?.find((x: any) => x.constraint_id === 'c1');
    expect(m).toBeDefined();
    expect(m.failure_margin_median).toBeCloseTo(24000, 0);
    expect(m.failure_margin_median).not.toBeCloseTo(31428.57, 0);
    // Codex F2a: the THRESHOLD 20000 clamped to 0 on the shared scale (below the
    // [21000,49000] floor), so the emitted 24000 UNDERSTATES the true breach
    // (true threshold −1000/28000 → true breach ≈ 25000). A '<=' threshold
    // clamped at the range floor is a strict lower bound → NOT 'exact'.
    // (At branch HEAD, before F2a, this read 'exact' — the RED assertion.)
    expect(m.margin_precision).toBe('lower_bound');
  });

  it('COMBO 1: a threshold INSIDE the spread yields the EXACT user-unit margin', async () => {
    const body = await run({
      graph: GRAPH, options: OPTIONS_RAW, goal_node_id: 'goal', seed: '42',
      goal_constraints: [{ constraint_id: 'c1', node_id: 'cost', operator: '<=', value: 30000 }],
    });
    // opt_b 45000 → 0.857143; threshold 30000 → 0.321429; margin 0.535714 × 28000
    // = 15000 EXACT (true 45000-30000). Was 21428.57 on the phantom width.
    const b = optionEntry(body, 'opt_b');
    const m = b.constraint_margins?.find((x: any) => x.constraint_id === 'c1');
    expect(m.failure_margin_median).toBeCloseTo(15000, 0);
    // Codex F2a CONTROL: threshold 30000 sits INSIDE the spread → it does NOT
    // clamp, and opt_b's intervention (45000) is inside too → neither side
    // clamps → the margin is genuinely 'exact'. This must stay 'exact' after
    // F2a (proves the threshold-clamp gate discriminates, not a blanket demote).
    expect(m.margin_precision).toBe('exact');
  });

  // ---- COMBO 2: interventions out of [0,1], constraint value in [0,1] ----
  it('COMBO 2: an in-[0,1] constraint on an intervened non-[0,1] node is RE-SCALED, not forwarded raw', async () => {
    const body = await run({
      graph: GRAPH, options: OPTIONS_RAW, goal_node_id: 'goal', seed: '42',
      goal_constraints: [{ constraint_id: 'c1', node_id: 'cost', operator: '<=', value: 0.5 }],
    });
    // 0.5 is a raw user value on a node whose samples live on [21000,49000];
    // it must be normalised on that scale (→ clamp 0), NOT forwarded as 0.5.
    expect(constraintValueSentToISL('c1')).toBe(0);
    // Both options (25000, 45000) exceed 0.5 cost → both violate.
    expect(optionEntry(body, 'opt_a').constraint_probabilities?.c1).toBe(0);
  });

  // ---- COMBO 3: interventions in [0,1] (Phase 4a skipped), constraint out of [0,1] ----
  it('COMBO 3: raw-[0,1] interventions + a >1 threshold — same identity scale, then honestly suppressed (no phantom heuristic verdict)', async () => {
    const body = await run({
      graph: GRAPH, options: OPTIONS_UNIT, goal_node_id: 'goal', seed: '42',
      goal_constraints: [{ constraint_id: 'c1', node_id: 'cost', operator: '<=', value: 20000 }],
    });
    // Interventions 0.3/0.7 were forwarded RAW ([0,1] identity scale, Phase 4a
    // skipped). The 20000 threshold must NOT be normalised via a node heuristic
    // ([0,60000] → 0.333, which at HEAD produced a CONFIDENT but phantom
    // prob-1 verdict for opt_a); on the shared identity scale it clamps to 1.
    expect(constraintValueSentToISL('c1')).toBe(1);
    // Because the shared scale is the DEFAULT [0,1] range (no reliable node
    // scale exists — the input is self-contradictory: [0,1] samples vs a 20000
    // threshold), the pre-existing reliability gate honestly SUPPRESSES the
    // result rather than emit a fabricated confident probability. This is the
    // correct outcome: threshold and samples share one scale, and an
    // unreliable-scale verdict is withheld, not invented.
    expect(optionEntry(body, 'opt_a').constraint_probabilities?.c1).toBeUndefined();
    expect(body.constraints_status).toBe('unavailable');
  });

  // ---- COMBO 4: interventions in [0,1], constraint in [0,1] (already consistent) ----
  it('COMBO 4: all in [0,1] — threshold forwarded unchanged, both sides on the same scale', async () => {
    const body = await run({
      graph: GRAPH, options: OPTIONS_UNIT, goal_node_id: 'goal', seed: '42',
      goal_constraints: [{ constraint_id: 'c1', node_id: 'cost', operator: '<=', value: 0.5 }],
    });
    expect(constraintValueSentToISL('c1')).toBe(0.5);
    // cost 0.3 <= 0.5 satisfied; cost 0.7 <= 0.5 violated.
    expect(optionEntry(body, 'opt_a').constraint_probabilities?.c1).toBe(1);
    expect(optionEntry(body, 'opt_b').constraint_probabilities?.c1).toBe(0);
  });

  // ---- F4: a '%' constraint on a Phase-4a-skipped (identity-scale) node ----
  it('F4: a public %-constraint on an identity-scale node is NORMALISED via [0,100], NOT suppressed', async () => {
    const body = await run({
      graph: GRAPH, options: OPTIONS_UNIT, goal_node_id: 'goal', seed: '42',
      // Interventions 0.3/0.7 are already in [0,1] → Phase 4a SKIPPED → cost
      // carries an IDENTITY [0,1] intervention scale. The '%' unit must OUTRANK
      // it: 50 → 0.5 on [0,100] (source unit_percent), NOT clamp to 1 on the
      // identity scale with source 'default' (which the reliability gate
      // suppresses — the regression this pins).
      goal_constraints: [{ constraint_id: 'c_pct', node_id: 'cost', operator: '<=', value: 50, unit: '%' }],
    });
    // At HEAD (before F4): value 1, source 'default' → suppressed → 'unavailable'.
    expect(constraintValueSentToISL('c_pct')).toBeCloseTo(0.5, 6);
    expect(body.constraints_status).not.toBe('unavailable');
    // cost 0.3 <= 0.5 satisfied; cost 0.7 <= 0.5 violated — the verdict is
    // DELIVERED (the suppression half is lifted).
    expect(optionEntry(body, 'opt_a').constraint_probabilities?.c_pct).toBe(1);
    expect(optionEntry(body, 'opt_b').constraint_probabilities?.c_pct).toBe(0);
  });

  // NOTE (F1): the F1 corner (gate FALSE + a producer-'%'/cap constraint on a
  // NON-intervened node while another node forces the call via a non-identity
  // scale) is pinned deterministically at the pure-function layer above
  // ("A3 range-unify · F1 …"), which is the exact unit the reorder lives in. An
  // end-to-end route pin was prototyped and manually confirmed (the churn '%'
  // constraint reaches ISL with value 0.5 forwarded raw, only the pre-existing
  // STRIP_RAW_CONSTRAINT_FIELDS unit-strip repair, no normalisation repair), but
  // the module-level `capturedISLRequest` is overwritten by the additional ISL
  // calls this multi-factor graph triggers, so a stable route assertion would
  // test the harness, not the fix. Kept as pure-function pins to avoid theatre.
});
