/**
 * /v2/run route-level contract for ROADMAP 2.228-F3 — closed-form factor flips.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE UNIT SUITE. The unit suite proves the
 * adapter maps a FactorFlipValueV2 block and that the translator sets
 * `include_factor_flips`. Neither proves the ROUTE calls either one. At
 * `29703ee4` the whole capability was inert precisely because nothing on the
 * live path connected them — the same failure mode the 2.228-F2 contract file
 * was written to catch. This file drives the real route and asserts on the
 * response body.
 *
 * Two RED-at-`29703ee4` claims are pinned here:
 *   1. the request PLoT actually sends to ISL carries `include_factor_flips: true`
 *      (captured off the mocked client, not asserted about a builder in isolation);
 *   2. a FactorFlipValueV2-bearing envelope produces `flip_thresholds[]` rows
 *      with a real, user-unit `flip_value` — at `29703ee4` those rows carried
 *      `flip_value: null` on every run.
 *
 * ISL is mocked (the module-level pattern used by
 * `tests/v2-run.flip-display-scale.contract.test.ts`): a real ISL is unreachable
 * in CI, and without one `analysis_status` is `'failed'` and `flip_thresholds`
 * is `[]`, which would make every assertion below vacuous.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const OPTION_IDS = ['opt_status_quo', 'opt_locum'];

/** Every body PLoT sent to ISL's analysis endpoint, in order. */
const capturedIslRequests: any[] = [];

function mockOptions(options: Array<{ id: string }>): unknown[] {
  return options.map((opt, idx) => ({
    option_id: opt.id,
    label: opt.id,
    win_probability: idx === 0 ? 0.72 : 0.28,
    outcome: {
      mean: 0.7 - idx * 0.2,
      std: 0.1,
      p10: 0.5,
      p50: 0.7,
      p90: 0.9,
      n_samples: 1000,
      n_valid_samples: 1000,
      validity_ratio: 1.0,
    },
    rank: idx + 1,
  }));
}

const MOCK_FACTOR_SENSITIVITY = [
  { node_id: 'fac_annual_staffing_cost', factor_id: 'fac_annual_staffing_cost', factor_label: 'Annual Staffing Cost', sensitivity_score: 0.62, elasticity: -0.62, direction: 'negative', value_of_information: 0.1 },
  { node_id: 'fac_demand', factor_id: 'fac_demand', factor_label: 'Demand', sensitivity_score: 0.41, elasticity: 0.41, direction: 'positive', value_of_information: 0.1 },
];

/**
 * ISL `factor_flip_values`, shaped from `FactorFlipValueV2`
 * (`src/models/response_v2.py:690-771` at ISL `35149dd1`) as
 * `model_dump(by_alias=True, exclude_none=True)` would emit it — absent keys,
 * not explicit nulls, for the optionals ISL leaves as None.
 *
 * Three rows deliberately: a real flip on a CAPPED factor (must reach user
 * units), an attested no-flip (must survive as a row without a direction), and
 * a flip on a CAPLESS factor (must stay normalised — the fail-closed control on
 * the same response).
 */
const MOCK_FACTOR_FLIP_VALUES = [
  {
    factor_id: 'fac_annual_staffing_cost',
    current_value: 0.86,
    flip_value: 0.62,
    direction: 'decrease',
    flip_reason: 'found',
    alternative_winner_id: 'opt_locum',
    baseline_winner_id: 'opt_status_quo',
    stability: {
      n_seeds: 10,
      n_seeds_flipped: 7,
      band_min: 0.58,
      band_median: 0.63,
      band_max: 0.69,
      band_width: 0.11,
      seed_flip_values: [0.58, 0.6, null, 0.63, 0.64, null, 0.66, 0.68, 0.69, null],
    },
  },
  {
    factor_id: 'fac_demand',
    current_value: 0.4,
    flip_reason: 'structurally_invariant',
    baseline_winner_id: 'opt_status_quo',
  },
  {
    factor_id: 'fac_lever',
    current_value: 0.5,
    flip_value: 0.7,
    direction: 'increase',
    flip_reason: 'found',
    alternative_winner_id: 'opt_locum',
    baseline_winner_id: 'opt_status_quo',
  },
];

function islEnvelope(options: any[]): any {
  return {
    options: mockOptions(options),
    edges: [],
    factor_sensitivity: MOCK_FACTOR_SENSITIVITY,
    factor_flip_values: MOCK_FACTOR_FLIP_VALUES,
    conditional_winners: [],
    overall_robustness: 'robust',
    robustness_score: 0.8,
    fragile_edges: [],
    robust_edges: [],
  };
}

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable' as const,
      confidence: 'high' as const,
      adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock', reasoning: 'Test' },
      source: 'isl' as const,
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' as const };
  },
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return {
      options: mockOptions(options),
      edges: [],
      edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factor_sensitivity: MOCK_FACTOR_SENSITIVITY,
      factors: [], value_of_information: [],
      factors_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      factor_sensitivity_status: 'available' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.8,
      fragile_edges: [], robust_edges: [], latency_ms: 10, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    capturedIslRequests.push(body);
    return { data: islEnvelope(body.options || []) as T, error: null };
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
      {
        id: 'fac_annual_staffing_cost',
        kind: 'factor',
        label: 'Annual Staffing Cost',
        observed_state: { value: 0.86, baseline: 0.86, unit: 'GBP', raw_value: 275000, cap: 320000 },
      },
      {
        id: 'fac_demand',
        kind: 'factor',
        label: 'Demand',
        observed_state: { value: 0.4, baseline: 0.4, unit: 'GBP', raw_value: 40, cap: 100 },
      },
      {
        id: 'fac_lever',
        kind: 'factor',
        label: 'Service Model',
        // Deliberately CAPLESS — the fail-closed control on the same response.
        observed_state: { value: 0.5, baseline: 0.5 },
      },
      { id: 'outcome', kind: 'goal', label: 'Net Position' },
    ],
    edges: [
      { from: 'fac_annual_staffing_cost', to: 'outcome', exists_probability: 0.95, strength: { mean: -0.7, std: 0.1 } },
      { from: 'fac_demand', to: 'outcome', exists_probability: 0.9, strength: { mean: 0.6, std: 0.1 } },
      { from: 'fac_lever', to: 'outcome', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
    ],
  },
  options: [
    // Intervention values inside [0,1] ⇒ needsNormalisation false ⇒
    // normalisationContext stays undefined for the whole request (the V5 shape).
    { id: OPTION_IDS[0], label: 'Status quo', interventions: { fac_lever: { value: 0.2, source: 'user_specified' } } },
    { id: OPTION_IDS[1], label: 'Locum cover', interventions: { fac_lever: { value: 0.8, source: 'user_specified' } } },
  ],
  goal_node_id: 'outcome',
};

describe('V2 Run · ISL closed-form factor flips (2.228-F3)', () => {
  let app: FastifyInstance;
  let body: Record<string, unknown>;
  let rows: Array<Record<string, unknown>>;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';

    app = await createServer();
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'content-type': 'application/json' },
      payload: REQUEST_BODY,
    });
    expect(res.statusCode).toBe(200);
    body = JSON.parse(res.body) as Record<string, unknown>;
    rows = (body.flip_thresholds as Array<Record<string, unknown>>) ?? [];
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  it('ANTI-VACUITY: the route reached ISL and produced flip rows at all', () => {
    // Without this, every assertion below could pass over an empty array.
    expect(capturedIslRequests.length).toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('THE REQUEST GATE: the body PLoT actually sent carries include_factor_flips: true', () => {
    // Asserted on the CAPTURED wire body, not on the builder in isolation — a
    // builder can be correct while the route sends a differently-built request.
    const analysisRequest = capturedIslRequests.find((r) => Array.isArray(r?.graph?.nodes));
    expect(analysisRequest).toBeDefined();
    expect(analysisRequest.include_factor_flips).toBe(true);
  });

  it('THE MAPPING: ISL\'s closed-form flip reaches the wire in USER UNITS', () => {
    const staffing = rows.find((r) => r.factor_id === 'fac_annual_staffing_cost');
    expect(staffing).toBeDefined();
    // At 29703ee4 this was null on every run — the probe could not find a flip
    // by construction, and nothing consumed ISL's closed-form answer.
    expect(staffing!.flip_value).not.toBeNull();
    // 0.62 x 320000 = 198400.
    expect(staffing!.flip_value).toBe(198400);
    expect(staffing!.value_scale).toBe('display');
    expect(staffing!.flip_display).toBe('198400 GBP');
    expect(staffing!.direction).toBe('decrease');
    expect(staffing!.alternative_winner_id).toBe('opt_locum');
    expect(staffing!.alternative_winner_label).toBe('Locum cover');
  });

  it('the run reports a computed flip-threshold status', () => {
    // One found + one attested no-flip + one found ⇒ partial_no_effect.
    expect(body.flip_thresholds_status).toBe('partial_no_effect');
  });

  it('AN ATTESTED NO-FLIP survives as a row, with no fabricated numeric or direction', () => {
    const demand = rows.find((r) => r.factor_id === 'fac_demand');
    expect(demand).toBeDefined();
    expect(demand!.flip_reason).toBe('structurally_invariant');
    expect(demand!.flip_value).toBeNull();
    expect(demand!.flip_value).not.toBe(0);
    // The explicit non-claiming token, never a guessed direction.
    expect(demand!.direction).toBe('none');
    expect(demand!.flip_display).toBeUndefined();
    // current_value still lifts: 0.4 x 100 = 40, and raw_value agrees.
    expect(demand!.current_value).toBe(40);
    expect(demand!.value_scale).toBe('display');
  });

  it('FAIL-CLOSED CONTROL on the same response: a capless factor claims no display scale', () => {
    const lever = rows.find((r) => r.factor_id === 'fac_lever');
    expect(lever).toBeDefined();
    expect(lever!.value_scale).not.toBe('display');
    expect(lever!.flip_display).toBeUndefined();
    expect(lever!.current_display).toBeUndefined();
    // The value is still ISL's, unlifted — honest rather than absent.
    expect(lever!.flip_value).toBe(0.7);
  });

  it('THE PROBE IS RETIRED: exactly ONE ISL analysis call, no per-factor probes', () => {
    // The retired bisection search issued one ISL round trip per probe value
    // (Step-0 baseline/min/max plus bisection midpoints, up to 5 factors). The
    // closed-form path adds none: the flip values ride the analysis response.
    const analysisCalls = capturedIslRequests.filter((r) => Array.isArray(r?.graph?.nodes));
    expect(analysisCalls).toHaveLength(1);
  });

  it('no probe depth is disclosed, because no probe ran', () => {
    const meta = body.meta as Record<string, unknown> | undefined;
    expect(meta?.flip_probe_n_samples).toBeUndefined();
  });

  it('THE ENRICHMENT CONTRACT STAYS GREEN over an attested no-flip row', () => {
    // ⚠ REGRESSION PIN FOR A BUG THIS LANE ALMOST SHIPPED. The first cut of the
    // mapping OMITTED `direction` on no-flip rows — the honest rendering of
    // ISL's "a direction for a flip that does not exist would be a fabricated
    // claim". But `@talchain/schemas` 0.30.0 types
    // `EnrichmentFlipThresholdSchema.direction` as a REQUIRED `z.string()`, so
    // every run carrying an attested no-flip raised
    // ENRICHMENT_CONTRACT_MISMATCH and stamped `enrichment_contract_ok: false`
    // — a false alarm on an honest row. Caught only because the egress guard
    // logs the issue PATH (`flip_thresholds.1.direction`).
    //
    // This assertion is what stops a future "simplification" back to an omitted
    // key from silently re-opening it. If the schema field is ever made
    // optional, THIS test is the one to revisit — not the 'none' token alone.
    const meta = body._meta as Record<string, unknown> | undefined;
    const evidence = meta?.evidence as Record<string, unknown> | undefined;
    expect(evidence?.enrichment_contract_ok).toBe(true);

    const warnings = (body.inference_warnings as Array<Record<string, unknown>>) ?? [];
    expect(warnings.map((w) => w.code)).not.toContain('ENRICHMENT_CONTRACT_MISMATCH');
  });

  it('POSITIVE CONTROL: the response really did carry a no-flip row for that guard to see', () => {
    // Without this, the assertion above could pass over a response that never
    // exercised the no-flip path at all (trap 13).
    expect(rows.some((r) => r.flip_value === null && r.direction === 'none')).toBe(true);
  });
});
