/**
 * Lane P0a — option-pinned lever VOI/EVPI suppression at the /v2/run egress.
 *
 * RED-before / GREEN-after at the PUBLIC PLoT egress boundary, with a STRICTLY
 * POSITIVE non-lever EVPI so the contrast is unambiguous (the sibling
 * lane-a1 egress test carries no fragile edges, so its non-lever EVPI is 0).
 *
 * Two producer sites are exercised end-to-end:
 *   1. mergeIslConfidenceIntoGraphFactors forces a lever's value_of_information
 *      to 0 (alongside the A1/A1b sensitivity_score:0 / elasticity:0 invariant).
 *   2. the EVPI enrichment loop in routes/v2/run.ts SKIPS levers, so a lever's
 *      evpi_percentage_points is ABSENT (not a confident 0).
 *
 * Fixture shape:
 *   - `fac_lever` is a GRAPH factor that ISL marks intervention_override (a
 *     decision lever pinned by both options). Its graph influence is the
 *     strongest, so pre-suppression it would be the #1 "investigation priority".
 *   - `fac_isl_voi` is an ISL-ONLY non-lever carrying a finite positive ISL
 *     value_of_information, so the append path (mapIslFactorEntry) gives it a
 *     positive public VOI → positive evpi_percentage_points. It is the honest
 *     EVPI target that MUST survive.
 *
 * Suppression only — no EVPI rename, no new scientific claim, no schema change.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const LEVER_ID = 'fac_lever';
const ISL_VOI_ID = 'fac_isl_voi';

// ISL factor_sensitivity: a graph lever (intervention_override) + an ISL-only
// non-lever with a finite positive VOI. node_id-keyed, ISL shape.
const ISL_FACTOR_SENSITIVITY = [
  { node_id: LEVER_ID, sensitivity: 0, value_of_information: 0.9, direction: 'positive' as const, zero_reason: 'intervention_override' },
  { node_id: ISL_VOI_ID, sensitivity: 0.5, value_of_information: 0.6, direction: 'positive' as const },
];

function robustnessPayload(options: any[]) {
  return {
    options: options.map((opt: any, idx: number) => ({
      option_id: opt.id,
      win_probability: idx === 0 ? 0.7 : 0.3, // spread 0.4 > 0 ⇒ heuristic EVPI loop fires
      outcome: { mean: 0.7 - idx * 0.2, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
      rank: idx + 1,
    })),
    edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const, edge_sensitivity_status: 'available' as const,
    factors: ISL_FACTOR_SENSITIVITY,
    factor_sensitivity: ISL_FACTOR_SENSITIVITY,
    value_of_information: ISL_FACTOR_SENSITIVITY.map(f => ({ factor_id: f.node_id, voi: f.value_of_information })),
    factors_provenance: 'isl' as const, factor_sensitivity_status: 'available' as const,
    overall_robustness: 'robust' as const, robustness_score: 0.8, fragile_edges: [], robust_edges: [],
    latency_ms: 50, source: 'isl' as const,
  };
}

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
    return robustnessPayload(options);
  },
  async analyseFactorSensitivity() {
    return { factors: ISL_FACTOR_SENSITIVITY, value_of_information: ISL_FACTOR_SENSITIVITY.map(f => ({ factor_id: f.node_id, voi: f.value_of_information })), robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'isl' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    return { data: robustnessPayload(body.options || []) as T, error: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

const { createServer } = await import('../src/createServer.js');

// fac_lever is a graph factor (strongest edge to goal); fac_plain is a non-lever
// graph factor. Both options pin fac_lever (option-controlled lever).
const PAYLOAD = {
  graph: {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Goal' },
      { id: LEVER_ID, kind: 'factor', label: 'Pinned Lever', observed_state: { value: 0.6 } },
      { id: 'fac_plain', kind: 'factor', label: 'Background Factor', observed_state: { value: 0.5 } },
    ],
    edges: [
      { from: LEVER_ID, to: 'goal', exists_probability: 0.95, strength: { mean: 0.9, std: 0.1 } },
      { from: 'fac_plain', to: 'goal', exists_probability: 0.7, strength: { mean: 0.3, std: 0.1 } },
    ],
  },
  options: [
    { id: 'opt_a', label: 'A', interventions: { [LEVER_ID]: { value: 1, source: 'user_specified' } } },
    { id: 'opt_b', label: 'B', interventions: { [LEVER_ID]: { value: 0, source: 'user_specified' } } },
  ],
  goal_node_id: 'goal',
  seed: '42',
};

describe('Lane P0a — /v2/run egress suppresses lever VOI/EVPI, preserves non-lever EVPI', () => {
  let app: FastifyInstance;
  let body: any;
  let factors: any[];

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    const res = await app.inject({
      method: 'POST', url: '/v2/run',
      headers: { 'content-type': 'application/json' },
      payload: PAYLOAD,
    });
    expect(res.statusCode).toBe(200);
    body = res.json();
    factors = (body.factor_sensitivity ?? []) as any[];
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  it('the lever egresses with zero_reason intervention_override and value_of_information 0 (site 1)', () => {
    const lever = factors.find((f) => f.factor_id === LEVER_ID);
    expect(lever, 'lever present in egress').toBeDefined();
    expect(lever.zero_reason).toBe('intervention_override');
    expect(lever.value_of_information ?? 0).toBe(0); // RED pre-P0a: graph-derived VOI carried through
  });

  it('the lever has NO evpi_percentage_points — absent, not a confident 0 (site 2)', () => {
    const lever = factors.find((f) => f.factor_id === LEVER_ID);
    expect(lever.evpi_percentage_points, 'lever evpi absent').toBeUndefined();
    expect(lever.evpi_method, 'lever evpi_method absent').toBeUndefined();
  });

  it('a non-lever still carries a STRICTLY POSITIVE evpi_percentage_points (no over-suppression)', () => {
    const nonLever = factors.find((f) => f.factor_id === ISL_VOI_ID);
    expect(nonLever, 'non-lever present in egress').toBeDefined();
    expect(nonLever.value_of_information).toBeGreaterThan(0);
    expect(nonLever.evpi_percentage_points).toBeGreaterThan(0);
    expect(nonLever.evpi_method).toBe('heuristic');
  });

  it('the only factor bearing EVPI is a non-lever — the pinned lever is never the EVPI/investigation priority', () => {
    const withEvpi = factors.filter((f) => f.evpi_percentage_points !== undefined && f.evpi_percentage_points !== null);
    expect(withEvpi.length, 'at least one EVPI target exists').toBeGreaterThan(0);
    for (const f of withEvpi) {
      expect(f.zero_reason).not.toBe('intervention_override');
    }
    // The lever retains its (graph) structural importance — it is suppressed
    // from the EVPI surface specifically, not blanked from the response.
    const lever = factors.find((f) => f.factor_id === LEVER_ID);
    expect(typeof lever.influence_score).toBe('number');
    expect(lever.influence_score).toBeGreaterThan(0);
  });
});
