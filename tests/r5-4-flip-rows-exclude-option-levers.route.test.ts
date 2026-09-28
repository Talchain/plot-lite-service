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

describe('R5-4 — no flip row on an option-set lever (/v2/run)', () => {
  let app: FastifyInstance;
  let mixed: Body; // the lever rows + one assumption row
  let leverOnly: Body; // the served case: every probed factor is a lever

  async function run(rows: unknown[]): Promise<Body> {
    flipValues = rows;
    const res = await app.inject({ method: 'POST', url: '/v2/run', headers: { 'content-type': 'application/json' }, payload: REQUEST_BODY });
    expect(res.statusCode).toBe(200);
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
