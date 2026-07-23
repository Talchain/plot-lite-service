/**
 * D-U structural lever guard — /v2/run egress (ROADMAP 2.20/2.40, D-U adopted 13 Jul).
 *
 * D-U semantics: a factor ANY option intervenes on is a LEVER. Suppress
 * sensitivity/elasticity/VOI/EVPI everywhere, KEEP influence_score, stamp
 * zero_reason='intervention_override' so downstream (UI badge, CEE coaching)
 * renders the honest "controlled by your options" state.
 *
 * The gap this closes (live fac_salary_cost case): ISL stamps
 * intervention_override only for elasticity≈0 first-option pins, so a factor
 * pinned by a NON-first option with NONZERO measured elasticity arrives
 * unstamped — and PLoT's egress guards, keyed only on zero_reason, published
 * its sensitivity (−0.19) and top-ranked EVPI (7.8pp) while CEE coaching
 * correctly suppressed it as a lever (the coaching layer already unions over
 * options[i].interventions in normalise-inputs.ts).
 *
 * Fixture archetypes (all four must hold simultaneously):
 *   - fac_union       union lever (pinned ONLY by the NON-first option) with a
 *                     nonzero ISL sensitivity and NO zero_reason.
 *                     RED today: published sensitivity + EVPI.
 *                     GREEN: zeroed + stamped, influence kept, EVPI absent.
 *   - fac_graph_only  union lever (non-first option) ABSENT from ISL
 *                     factor_sensitivity — exercises the merge's no-ISL-match
 *                     branch, which pre-fix returned the graph entry untouched.
 *   - fac_stamped     first-option pin that ISL already stamped — idempotence
 *                     control: output must be byte-identical pre/post guard.
 *   - fac_plain       non-lever with honest positive EVPI — must survive
 *                     (no over-suppression).
 *
 * The EVPI surface is exercised end-to-end:
 *   Block A: heuristic path (no factor_evpi on the wire; win-prob spread > 0).
 *   Block B: the removed ISL counterfactual path — `factor_evpi` present on the
 *            wire (including a raw NEGATIVE entry) but now IGNORED (ISL #103 /
 *            F3 / D-23.15). The surface falls back to the heuristic; the removed
 *            field's values never surface, and ROADMAP 2.20 rider (b) still
 *            holds (no negative EVPI leaks post-suppression, in any form).
 *
 * Suppression only — no EVPI rename, no new scientific claim, no schema change.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const UNION_ID = 'fac_union';
const GRAPH_ONLY_ID = 'fac_graph_only';
const STAMPED_ID = 'fac_stamped';
const PLAIN_ID = 'fac_plain';

// ISL factor_sensitivity, node_id-keyed ISL shape. fac_union is the D-U gap:
// nonzero sensitivity, NO zero_reason (ISL pre-#73 behaviour for non-first
// option pins). fac_graph_only is deliberately ABSENT. fac_stamped is the
// ISL-stamped idempotence control.
const ISL_FACTOR_SENSITIVITY = [
  { node_id: UNION_ID, sensitivity: -0.19, value_of_information: 0.6, direction: 'negative' as const },
  { node_id: STAMPED_ID, sensitivity: 0, value_of_information: 0.9, direction: 'positive' as const, zero_reason: 'intervention_override' },
  { node_id: PLAIN_ID, sensitivity: 0.5, value_of_information: 0.6, direction: 'positive' as const },
];

// Fragile edges adjacent to fac_union / fac_graph_only / fac_plain so the
// graph-side VOI (|sens| × (1−conf) × max marginal_switch_probability) is
// strictly positive → the heuristic EVPI loop has something to leak pre-fix.
const FRAGILE_EDGES = [
  { edge_id: `${UNION_ID}::goal`, from_id: UNION_ID, to_id: 'goal', switch_probability: 0.3, marginal_switch_probability: 0.25 },
  { edge_id: `${GRAPH_ONLY_ID}::goal`, from_id: GRAPH_ONLY_ID, to_id: 'goal', switch_probability: 0.2, marginal_switch_probability: 0.2 },
  { edge_id: `${PLAIN_ID}::goal`, from_id: PLAIN_ID, to_id: 'goal', switch_probability: 0.2, marginal_switch_probability: 0.2 },
];

// Block B wire entries. fac_union carries the live worked example (7.8pp —
// the published top "investigation priority" for a lever). fac_stamped
// carries a raw NEGATIVE (MC sampling artefact) — rider (b): must never
// egress in any form. fac_plain is the honest survivor.
const FACTOR_EVPI = [
  { factor_id: UNION_ID, evpi: 0.078, evpi_percentage_points: 7.8, metric_type: 'win_probability', n_evpi_samples: 1000 },
  { factor_id: GRAPH_ONLY_ID, evpi: 0.05, evpi_percentage_points: 5.0, metric_type: 'win_probability', n_evpi_samples: 1000 },
  { factor_id: STAMPED_ID, evpi: -0.0015, evpi_percentage_points: -0.15, metric_type: 'win_probability', n_evpi_samples: 1000 },
  { factor_id: PLAIN_ID, evpi: 0.032, evpi_percentage_points: 3.2, metric_type: 'win_probability', n_evpi_samples: 1000 },
];

function robustnessPayload(options: any[], opts: { withFactorEvpi: boolean }) {
  return {
    options: options.map((opt: any, idx: number) => ({
      option_id: opt.id,
      win_probability: idx === 0 ? 0.7 : 0.3, // spread 0.4 > 0 ⇒ heuristic EVPI loop fires when factor_evpi absent
      outcome: { mean: 0.7 - idx * 0.2, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
      rank: idx + 1,
    })),
    edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const, edge_sensitivity_status: 'available' as const,
    factors: ISL_FACTOR_SENSITIVITY,
    factor_sensitivity: ISL_FACTOR_SENSITIVITY,
    value_of_information: ISL_FACTOR_SENSITIVITY.map(f => ({ factor_id: f.node_id, voi: f.value_of_information })),
    ...(opts.withFactorEvpi && { factor_evpi: FACTOR_EVPI }),
    factors_provenance: 'isl' as const, factor_sensitivity_status: 'available' as const,
    // Route reads fragile edges for graph-VOI at islResult.robustness.fragile_edges (nested).
    robustness: { score: 0.8, label: 'robust' as const, fragile_edges: FRAGILE_EDGES, robust_edges: [] },
    overall_robustness: 'robust' as const, robustness_score: 0.8, fragile_edges: FRAGILE_EDGES, robust_edges: [],
    latency_ms: 50, source: 'isl' as const,
  };
}

let withFactorEvpi = false; // toggled per describe block; mock reads it at call time

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return { status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [], explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl' };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return robustnessPayload(options, { withFactorEvpi });
  },
  async analyseFactorSensitivity() {
    return { factors: ISL_FACTOR_SENSITIVITY, value_of_information: ISL_FACTOR_SENSITIVITY.map(f => ({ factor_id: f.node_id, voi: f.value_of_information })), robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'isl' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    return { data: robustnessPayload(body.options || [], { withFactorEvpi }) as T, error: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

const { createServer } = await import('../src/createServer.js');

// fac_stamped is pinned by the FIRST option (the case ISL already stamps).
// fac_union and fac_graph_only are pinned ONLY by the NON-first option — the
// D-U gap ISL does not stamp today. fac_plain is pinned by nobody.
const PAYLOAD = {
  graph: {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Goal' },
      { id: UNION_ID, kind: 'factor', label: 'Salary Cost (union lever)', observed_state: { value: 0.6 } },
      { id: GRAPH_ONLY_ID, kind: 'factor', label: 'Graph-only Lever', observed_state: { value: 0.4 } },
      { id: STAMPED_ID, kind: 'factor', label: 'ISL-stamped Lever', observed_state: { value: 0.5 } },
      { id: PLAIN_ID, kind: 'factor', label: 'Background Factor', observed_state: { value: 0.5 } },
    ],
    edges: [
      { from: UNION_ID, to: 'goal', exists_probability: 0.95, strength: { mean: 0.9, std: 0.1 } },
      { from: GRAPH_ONLY_ID, to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
      { from: STAMPED_ID, to: 'goal', exists_probability: 0.9, strength: { mean: 0.8, std: 0.1 } },
      { from: PLAIN_ID, to: 'goal', exists_probability: 0.7, strength: { mean: 0.3, std: 0.1 } },
    ],
  },
  options: [
    { id: 'opt_a', label: 'A', interventions: { [STAMPED_ID]: { value: 1, source: 'user_specified' } } },
    { id: 'opt_b', label: 'B', interventions: { [UNION_ID]: { value: 0.2, source: 'user_specified' }, [GRAPH_ONLY_ID]: { value: 0.4, source: 'user_specified' } } },
  ],
  goal_node_id: 'goal',
  seed: '42',
};

function expectSuppressedLever(f: any, label: string) {
  expect(f, `${label} present in egress`).toBeDefined();
  expect(f.zero_reason, `${label} stamped`).toBe('intervention_override');
  expect(f.sensitivity_score, `${label} sensitivity zeroed`).toBe(0);
  expect(f.elasticity ?? 0, `${label} elasticity zeroed`).toBe(0);
  expect(f.value_of_information ?? 0, `${label} VOI zeroed`).toBe(0);
  expect(typeof f.influence_score, `${label} influence kept`).toBe('number');
  expect(f.influence_score, `${label} influence kept nonzero`).toBeGreaterThan(0);
  expect(f.evpi_percentage_points, `${label} EVPI absent`).toBeUndefined();
  expect(f.evpi_method, `${label} evpi_method absent`).toBeUndefined();
  expect(f.evpi_status, `${label} evpi_status absent`).toBeUndefined();
}

async function runOnce(): Promise<{ body: any; factors: any[] }> {
  process.env.RATE_LIMIT_ENABLED = '0';
  process.env.CEE_ORCHESTRATOR_ENABLED = '0';
  const app: FastifyInstance = await createServer();
  try {
    const res = await app.inject({
      method: 'POST', url: '/v2/run',
      headers: { 'content-type': 'application/json' },
      payload: PAYLOAD,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    return { body, factors: (body.factor_sensitivity ?? []) as any[] };
  } finally {
    await app.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  }
}

describe('D-U guard, Block A — heuristic EVPI path (no factor_evpi on the wire)', () => {
  let factors: any[];

  beforeAll(async () => {
    withFactorEvpi = false;
    ({ factors } = await runOnce());
  });

  afterAll(() => { /* app closed in runOnce */ });

  it('a factor pinned by a NON-first option with nonzero unstamped ISL sensitivity is suppressed + stamped, influence kept', () => {
    // RED pre-guard: sensitivity −0.19 egresses tunable, VOI > 0, heuristic
    // EVPI published — the live fac_salary_cost incoherence.
    expectSuppressedLever(factors.find((f) => f.factor_id === UNION_ID), 'union lever');
  });

  it('a union lever ABSENT from ISL factor_sensitivity (no-ISL-match merge branch) is suppressed + stamped, influence kept', () => {
    expectSuppressedLever(factors.find((f) => f.factor_id === GRAPH_ONLY_ID), 'graph-only lever');
  });

  it('an ISL-stamped first-option lever is unchanged (idempotent — no double-transform)', () => {
    expectSuppressedLever(factors.find((f) => f.factor_id === STAMPED_ID), 'ISL-stamped lever');
  });

  it('a non-lever still carries nonzero sensitivity and STRICTLY POSITIVE heuristic EVPI (no over-suppression)', () => {
    const plain = factors.find((f) => f.factor_id === PLAIN_ID);
    expect(plain, 'non-lever present').toBeDefined();
    expect(plain.zero_reason ?? null).toBeNull();
    expect(Math.abs(plain.sensitivity_score)).toBeGreaterThan(0);
    expect(plain.value_of_information).toBeGreaterThan(0);
    expect(plain.evpi_percentage_points).toBeGreaterThan(0);
    expect(plain.evpi_method).toBe('heuristic');
  });

  it('every factor bearing EVPI is outside the option-intervention union', () => {
    const unionIds = new Set([UNION_ID, GRAPH_ONLY_ID, STAMPED_ID]);
    const withEvpi = factors.filter((f) => f.evpi_percentage_points !== undefined && f.evpi_percentage_points !== null);
    expect(withEvpi.length).toBeGreaterThan(0);
    for (const f of withEvpi) {
      expect(unionIds.has(f.factor_id), `${f.factor_id} must not bear EVPI`).toBe(false);
    }
  });
});

describe('D-U guard, Block B — removed ISL counterfactual path: `factor_evpi` on the wire is IGNORED (F3 / ISL #103 / D-23.15)', () => {
  let body: any;
  let factors: any[];

  beforeAll(async () => {
    withFactorEvpi = true; // present on the wire — and now ignored by PLoT
    ({ body, factors } = await runOnce());
  });

  // With `factor_evpi` ignored the surface is the heuristic path; levers are
  // suppressed there exactly as in Block A, and the removed field's values
  // (7.8 / 5.0 / -0.15 / 3.2 pp) must never appear.

  it('the union lever bears NO EVPI (its ignored wire factor_evpi 7.8pp is never published)', () => {
    expectSuppressedLever(factors.find((f) => f.factor_id === UNION_ID), 'union lever');
  });

  it('the graph-only union lever bears NO EVPI (its ignored wire factor_evpi 5.0pp is never published)', () => {
    expectSuppressedLever(factors.find((f) => f.factor_id === GRAPH_ONLY_ID), 'graph-only lever');
  });

  it('an ISL-stamped lever egresses nothing — rider (b): no negative leak, and the ignored raw wire -0.15 never appears', () => {
    const stamped = factors.find((f) => f.factor_id === STAMPED_ID);
    expectSuppressedLever(stamped, 'ISL-stamped lever');
    // Belt-and-braces sweep: no factor_sensitivity entry anywhere carries a
    // negative EVPI or a negative VOI after suppression.
    for (const f of factors) {
      if (f.evpi_percentage_points !== undefined && f.evpi_percentage_points !== null) {
        expect(f.evpi_percentage_points).toBeGreaterThanOrEqual(0);
      }
      if (f.value_of_information !== undefined && f.value_of_information !== null) {
        expect(f.value_of_information).toBeGreaterThanOrEqual(0);
      }
    }
    expect(JSON.stringify(body.factor_sensitivity)).not.toContain('-0.15');
  });

  it('WITHDRAWN: a non-lever gets the HEURISTIC EVPI, never the ignored counterfactual 3.2pp', () => {
    const plain = factors.find((f) => f.factor_id === PLAIN_ID);
    expect(plain, 'non-lever present').toBeDefined();
    // The removed counterfactual path would have published 3.2pp @ method
    // 'counterfactual'. That path is gone: the non-lever instead carries the
    // self-disclosed heuristic EVPI (win-prob spread 0.4 > 0 in this fixture),
    // and the wire value 3.2 is NOT surfaced verbatim as a counterfactual.
    expect(plain.evpi_method).toBe('heuristic');
    expect(plain.evpi_percentage_points).toBeGreaterThan(0);
    expect(factors.some((f) => f.evpi_method === 'counterfactual')).toBe(false);
  });
});
