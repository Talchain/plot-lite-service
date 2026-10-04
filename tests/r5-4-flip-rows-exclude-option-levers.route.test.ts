/**
 * R5-4 (R5 handed to R&C whole, MG #72 5871363476; DL order): NO FLIP ROW ON AN OPTION-SET LEVER.
 *
 * The served defect (DL FINDINGS for 28 Sep, R5 row: "a flip at 0.2516 hires"). A headcount the options SET was
 * published as a tipping point: `new_tech_lead_hires` · current 0 hires · `flip_reason: 'found'` · `flip_display:
 * "0.2516 hires"`. Its two sibling levers were published as attested no-flips. From those three lever rows the brief's
 * claim 2 read "Changing at least one tested factor on its own could change … The other factors we could test could
 * not." Every tested factor was a CHOICE.
 *
 * The mechanism, as an engine fact. ISL's closed-form flip phase makes every root factor eligible
 * (`_compute_factor_flip_values`) and varies its BASE value. A lever's base is read only by the options that leave it
 * untouched: an option's do() overrides it for the options that set it. So a lever row answers "if the options that
 * do not hire a tech lead hired 0.25 of one anyway …". That is not an assumption a user can revise, and it is
 * fractional because the probe is continuous. A lever that EVERY option sets is structurally invariant by
 * construction, so its "no effect" attests nothing about the user's assumptions.
 *
 * The rule is eligibility, not absence. An option-controlled lever (the structural union of intervention targets, ∪
 * ISL's `intervention_override` stamp: the combined D-U predicate `isOptionControlledLever`) is not an assumption, so it
 * gets no flip row. ISL already leaves non-root nodes out the same way, and PLoT's pre-2.228 probe suppressed levers
 * too. The exclusion happens ONCE, at the ISL → PLoT adapter, so every reader of the one `flip_thresholds` array
 * agrees: the published rows, `flip_thresholds_status`, the brief's claims 1 and 2, the display verdict and the M2
 * prompt input.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const OPTION_IDS = ['opt_tech_lead', 'opt_two_devs'];

function mockOptions(options: Array<{ id: string }>): unknown[] {
  return options.map((opt, idx) => ({
    option_id: opt.id,
    label: opt.id,
    win_probability: idx === 0 ? 0.64 : 0.36,
    outcome: { mean: 0.6 - idx * 0.1, std: 0.1, p10: 0.45, p50: 0.6, p90: 0.75, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
    rank: idx + 1,
  }));
}

// ISL stamps a lever `intervention_override` (elasticity 0), as it did on the served run.
const MOCK_FACTOR_SENSITIVITY = [
  { node_id: 'fac_onboarding_drag', factor_id: 'fac_onboarding_drag', sensitivity_score: 0.5, elasticity: -0.5, direction: 'negative', value_of_information: 0.1 },
  { node_id: 'fac_tech_lead_hires', factor_id: 'fac_tech_lead_hires', sensitivity_score: 0, elasticity: 0, direction: 'positive', value_of_information: 0, zero_reason: 'intervention_override' },
  { node_id: 'fac_dev_hires', factor_id: 'fac_dev_hires', sensitivity_score: 0, elasticity: 0, direction: 'positive', value_of_information: 0, zero_reason: 'intervention_override' },
];

// ISL `FactorFlipValueV2` rows, `exclude_none` serialisation (an absent optional is an absent key).
const LEVER_ROWS = [
  // The served row: a lever only ONE option sets, so its base (0) is read by the other option.
  { factor_id: 'fac_tech_lead_hires', current_value: 0, flip_value: 0.2516, direction: 'increase', flip_reason: 'found', alternative_winner_id: 'opt_two_devs', baseline_winner_id: 'opt_tech_lead' },
  { factor_id: 'fac_dev_hires', current_value: 0, flip_reason: 'no_effect_within_bounds', baseline_winner_id: 'opt_tech_lead' },
];
const ASSUMPTION_ROW = { factor_id: 'fac_onboarding_drag', current_value: 0.4, flip_value: 0.7, direction: 'increase', flip_reason: 'found', alternative_winner_id: 'opt_two_devs', baseline_winner_id: 'opt_tech_lead' };

let flipValues: unknown[] = [];
let capturedIslRequest: any;

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return { status: 'identifiable' as const, confidence: 'high' as const, adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [], explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl' as const };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' as const };
  },
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return {
      options: mockOptions(options), edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const, factor_sensitivity: MOCK_FACTOR_SENSITIVITY, factors: [], value_of_information: [],
      factors_provenance: 'isl:/api/v1/robustness/analyze/v2' as const, factor_sensitivity_status: 'available' as const,
      overall_robustness: 'fragile' as const, robustness_score: 0.3, fragile_edges: [], robust_edges: [], latency_ms: 10, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    capturedIslRequest = body;
    return {
      data: {
        options: mockOptions(body.options || []), edges: [], factor_sensitivity: MOCK_FACTOR_SENSITIVITY,
        factor_flip_values: flipValues, conditional_winners: [],
        overall_robustness: 'fragile', robustness_score: 0.3, fragile_edges: [], robust_edges: [],
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

const REQUEST_BODY = {
  graph: {
    nodes: [
      { id: 'fac_tech_lead_hires', kind: 'factor', label: 'New Tech lead hires', observed_state: { value: 0, baseline: 0 } },
      { id: 'fac_dev_hires', kind: 'factor', label: 'New developer hires', observed_state: { value: 0, baseline: 0 } },
      { id: 'fac_onboarding_drag', kind: 'factor', label: 'Onboarding drag', observed_state: { value: 0.4, baseline: 0.4 } },
      { id: 'goal_productivity', kind: 'goal', label: 'Team productivity' },
    ],
    edges: [
      { from: 'fac_tech_lead_hires', to: 'goal_productivity', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
      { from: 'fac_dev_hires', to: 'goal_productivity', exists_probability: 0.9, strength: { mean: 0.4, std: 0.1 } },
      { from: 'fac_onboarding_drag', to: 'goal_productivity', exists_probability: 0.8, strength: { mean: -0.5, std: 0.1 } },
    ],
  },
  // Each lever is set by ONE option only: the served shape.
  options: [
    { id: OPTION_IDS[0], label: 'Hire a Tech lead', interventions: { fac_tech_lead_hires: { value: 1, source: 'user_specified' } } },
    { id: OPTION_IDS[1], label: 'Hire two developers', interventions: { fac_dev_hires: { value: 1, source: 'user_specified' } } },
  ],
  goal_node_id: 'goal_productivity',
};

type Body = Record<string, any>;

const MIXED_REQUEST_BODY = {
  ...REQUEST_BODY,
  graph: {
    nodes: REQUEST_BODY.graph.nodes.filter((n) => n.id !== 'fac_dev_hires'),
    edges: REQUEST_BODY.graph.edges.filter((e) => e.from !== 'fac_dev_hires'),
  },
  options: [
    { id: OPTION_IDS[0], label: 'Hire a Tech lead', interventions: { fac_tech_lead_hires: { value: 1 } } },
    { id: OPTION_IDS[1], label: 'Keep current headcount', interventions: { fac_tech_lead_hires: { value: 0 } } },
  ],
};

const SPRINT_REQUEST_BODY = {
  graph: {
    nodes: [
      { id: 'sprint_capacity_for_ai_reporting', kind: 'factor', label: 'AI reporting capacity', observed_state: { value: 0, baseline: 0 } },
      { id: 'sprint_capacity_for_integration_fix', kind: 'factor', label: 'Integration fix capacity', observed_state: { value: 0, baseline: 0 } },
      { id: 'goal_productivity', kind: 'goal', label: 'Team productivity' },
    ],
    edges: [
      { from: 'sprint_capacity_for_ai_reporting', to: 'goal_productivity', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
      { from: 'sprint_capacity_for_integration_fix', to: 'goal_productivity', exists_probability: 0.9, strength: { mean: 0.4, std: 0.1 } },
    ],
  },
  options: [
    { id: 'opt_a', label: 'AI reporting', interventions: { sprint_capacity_for_ai_reporting: { value: 1 }, sprint_capacity_for_integration_fix: { value: 0 } } },
    { id: 'opt_b', label: 'Integration fix', interventions: { sprint_capacity_for_ai_reporting: { value: 0 }, sprint_capacity_for_integration_fix: { value: 1 } } },
    { id: 'opt_c', label: 'Split capacity', interventions: { sprint_capacity_for_ai_reporting: { value: 0.5 }, sprint_capacity_for_integration_fix: { value: 0.5 } } },
    { id: 'opt_status_quo', label: 'Status quo', interventions: { sprint_capacity_for_ai_reporting: { value: 0 }, sprint_capacity_for_integration_fix: { value: 0 } } },
  ],
  goal_node_id: 'goal_productivity',
};

describe('R5-4 — no flip row on an option-set lever (/v2/run)', () => {
  let app: FastifyInstance;
  let mixed: Body; // the lever rows + one assumption row
  let leverOnly: Body; // the served case: every probed factor is a lever

  async function run(rows: unknown[], payload: object = REQUEST_BODY): Promise<Body> {
    flipValues = rows;
    capturedIslRequest = undefined;
    const res = await app.inject({ method: 'POST', url: '/v2/run', headers: { 'content-type': 'application/json' }, payload });
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as Body;
  }

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.ready();
    mixed = await run([...LEVER_ROWS, ASSUMPTION_ROW]);
    leverOnly = await run(LEVER_ROWS);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  it('R1: sprint-planning levers publish no rows, unavailable, and no status reason', async () => {
    const body = await run([
      { factor_id: 'sprint_capacity_for_ai_reporting', current_value: 0, flip_value: 0.4, direction: 'increase', flip_reason: 'found', baseline_winner_id: 'opt_a', alternative_winner_id: 'opt_b' },
      { factor_id: 'sprint_capacity_for_integration_fix', current_value: 0, flip_reason: 'no_effect_within_bounds', baseline_winner_id: 'opt_a' },
    ], SPRINT_REQUEST_BODY);
    expect(capturedIslRequest.options.map((o: any) => ({ id: o.id, interventions: o.interventions }))).toEqual([
      { id: 'opt_a', interventions: { sprint_capacity_for_ai_reporting: 1, sprint_capacity_for_integration_fix: 0 } },
      { id: 'opt_b', interventions: { sprint_capacity_for_ai_reporting: 0, sprint_capacity_for_integration_fix: 1 } },
      { id: 'opt_c', interventions: { sprint_capacity_for_ai_reporting: 0.5, sprint_capacity_for_integration_fix: 0.5 } },
      { id: 'opt_status_quo', interventions: { sprint_capacity_for_ai_reporting: 0, sprint_capacity_for_integration_fix: 0 } },
    ]);
    expect(body.flip_thresholds).toEqual([]);
    expect(body.flip_thresholds_status).toBe('unavailable');
    expect(body).not.toHaveProperty('flip_thresholds_status_reason');
  });

  it('R2: mixed lever and non-lever no-effect rows classify only the surviving factor', async () => {
    const body = await run([
      LEVER_ROWS[0],
      { factor_id: 'fac_onboarding_drag', current_value: 0.4, flip_reason: 'no_effect_within_bounds', baseline_winner_id: 'opt_tech_lead' },
    ], MIXED_REQUEST_BODY);
    expect(body.flip_thresholds.map((row: Body) => row.factor_id)).toEqual(['fac_onboarding_drag']);
    expect(body.flip_thresholds[0].flip_reason).toBe('no_effect_within_bounds');
    expect(body.flip_thresholds_status).toBe('all_no_effect');
    expect(body).not.toHaveProperty('flip_thresholds_status_reason');
  });

  it('R3: a non-lever computed flip survives with its value and computed status', async () => {
    const body = await run([ASSUMPTION_ROW], MIXED_REQUEST_BODY);
    expect(body.flip_thresholds.map((row: Body) => row.factor_id)).toEqual(['fac_onboarding_drag']);
    expect(body.flip_thresholds[0].flip_value).toBe(ASSUMPTION_ROW.flip_value);
    expect(body.flip_thresholds_status).toBe('computed');
  });

  it('R4: a factor set only by a clamp-withheld option keeps its flip row', async () => {
    // Declared [0,1] range + out-of-range intervention: constraint-margin-plumbing.test.ts:537-603.
    const payload = {
      graph: {
        nodes: [
          { id: 'goal', kind: 'goal', label: 'Goal', observed_state: { value: 0.4 } },
          { id: 'fac_x', kind: 'factor', label: 'Factor X', state_space: { range: { min: 0, max: 1 } }, observed_state: { value: 0.4 } },
          { id: 'fac_other', kind: 'factor', label: 'Other factor', state_space: { range: { min: 0, max: 1 } }, observed_state: { value: 0.3 } },
        ],
        edges: [
          { from: 'fac_x', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
          { from: 'fac_other', to: 'goal', strength: { mean: 0.3, std: 0.1 } },
        ],
      },
      options: [
        { id: 'opt_a', label: 'A', interventions: { fac_other: 0.4 } },
        { id: 'opt_b', label: 'B', interventions: { fac_other: 0.6 } },
        { id: 'opt_c', label: 'C', interventions: { fac_x: 10 } },
      ],
      goal_node_id: 'goal',
    };
    const flipRow = { factor_id: 'fac_x', current_value: 0.4, flip_value: 0.7, direction: 'increase', flip_reason: 'found', alternative_winner_id: 'opt_b', baseline_winner_id: 'opt_a' };
    const body = await run([flipRow], payload);

    expect(capturedIslRequest, 'PRECONDITION: ISL was called').toBeDefined();
    const scoredIds = capturedIslRequest.options.map((option: Body) => option.id);
    expect(scoredIds, 'PRECONDITION: C was withheld before ISL').not.toContain('opt_c');
    expect(scoredIds).toEqual(['opt_a', 'opt_b']);
    expect(body._meta?.withheld_options).toEqual([
      { option_id: 'opt_c', reason: 'intervention_clamped', factor_id: 'fac_x', stated: 10, applied: 1 },
    ]);
    const row = (body.flip_thresholds as Body[]).find((entry) => entry.factor_id === 'fac_x');
    expect(row, 'the factor only the withheld option sets retains its ISL flip').toBeDefined();
    expect(row!.flip_value).toBe(flipRow.flip_value);
    expect(body.flip_thresholds_status).toBe('computed');
  });

  it('ANTI-VACUITY + CONTRAST: the assumption row is published as found', () => {
    const row = (mixed.flip_thresholds as Body[]).find((r) => r.factor_id === 'fac_onboarding_drag');
    expect(row, 'the non-lever row reaches the wire').toBeDefined();
    expect(row!.flip_reason).toBe('found');
  });

  it('RED: neither lever gets a flip row (the "0.2516 hires" tipping point is gone)', () => {
    const ids = (mixed.flip_thresholds as Body[]).map((r) => r.factor_id);
    expect(ids).not.toContain('fac_tech_lead_hires');
    expect(ids).not.toContain('fac_dev_hires');
  });

  it('RED: the status is classified over the assumption row only (computed, not partial_no_effect)', () => {
    expect(mixed.flip_thresholds_status).toBe('computed');
  });

  it('RED, the served case: with only levers probed, no flip claim is made about "tested factors"', () => {
    expect(leverOnly.flip_thresholds).toEqual([]);
    expect(leverOnly.flip_thresholds_status).toBe('unavailable');
    const caveat = leverOnly.decision_brief?.robustness_caveat;
    expect(caveat, 'PRECONDITION: the brief carries a robustness caveat').toBeDefined();
    expect(caveat.flip_evidence).toBeUndefined();
  });
});
