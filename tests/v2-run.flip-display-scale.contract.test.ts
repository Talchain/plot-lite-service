/**
 * /v2/run route-level contract for ROADMAP 2.228 F2 — display-scale flip rows.
 *
 * The unit suite (`tests/lib/flip-threshold-display-scale.test.ts`) proves the
 * denormaliser lifts a row when it is HANDED the graph. This file proves the
 * route actually hands it over: without the `filteredGraph` argument at
 * `src/routes/v2/run.ts` the whole fix is inert on the live path and every unit
 * test still passes. Closing that gap is the only reason this file exists.
 *
 * The request is deliberately shaped like CEE's V5 payload — intervention values
 * INSIDE [0,1], so `needsNormalisation` is false and Phase 4a never builds a
 * `normalisationContext` (diagnosis §2.1 step 7) — with the scale carried on the
 * node as `observed_state.cap` / `raw_value`, exactly as the live `GRAPH_READY`
 * frame of attempt a7 carries it.
 *
 * ISL is mocked (the module-level pattern used by
 * `tests/enrichment-emission-contract.test.ts`): a real ISL is unreachable in
 * CI, and without one `analysis_status` is `'failed'` and `flip_thresholds` is
 * `[]`, which would make every display assertion below vacuous.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const OPTION_IDS = ['opt_status_quo', 'opt_locum'];

/** Two options with a clear, stable winner so a flip candidate set is produced. */
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

/** Non-zero elasticity on the two CAPPED factors so both become candidates. */
const MOCK_FACTOR_SENSITIVITY = [
  { node_id: 'fac_annual_staffing_cost', factor_id: 'fac_annual_staffing_cost', sensitivity_score: 0.62, elasticity: -0.62, direction: 'negative', value_of_information: 0.1 },
  { node_id: 'fac_demand', factor_id: 'fac_demand', sensitivity_score: 0.41, elasticity: 0.41, direction: 'positive', value_of_information: 0.1 },
];

/**
 * ROADMAP 2.228-F3: flip rows now arrive CLOSED-FORM on the ISL envelope
 * (`factor_flip_values`) instead of being resolved by PLoT's retired bisection
 * probe. Without this block the route produces NO flip rows and every display
 * assertion below is vacuous — which is exactly what the file's own
 * anti-vacuity guard catches.
 *
 * Shaped from ISL `FactorFlipValueV2` (`src/models/response_v2.py:690` @
 * `35149dd1`) under `exclude_none`: the no-flip row OMITS flip_value and
 * direction rather than nulling them.
 *
 * The values are chosen to keep this file's SUBJECT unchanged — display scale,
 * not flip search: `fac_annual_staffing_cost` keeps current_value 0.86 so the
 * raw_value-vs-round-trip assertion (275000, not 275200) still bites.
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
  },
  {
    factor_id: 'fac_demand',
    current_value: 0.4,
    flip_value: 0.55,
    direction: 'increase',
    flip_reason: 'found',
    alternative_winner_id: 'opt_locum',
    baseline_winner_id: 'opt_status_quo',
  },
  {
    factor_id: 'fac_lever',
    current_value: 0.5,
    flip_reason: 'structurally_invariant',
    baseline_winner_id: 'opt_status_quo',
  },
];

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
    const options = body.options || [];
    return {
      data: {
        options: mockOptions(options),
        edges: [],
        factor_sensitivity: MOCK_FACTOR_SENSITIVITY,
        factor_flip_values: MOCK_FACTOR_FLIP_VALUES,
        conditional_winners: [],
        overall_robustness: 'robust', robustness_score: 0.8,
        fragile_edges: [], robust_edges: [],
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
      {
        id: 'fac_annual_staffing_cost',
        kind: 'factor',
        label: 'Annual Staffing Cost',
        // The live a7 shape: normalised value + authoritative cap + the user's
        // own raw number.
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
    // Both intervention values sit inside [0,1] ⇒ needsNormalisation is false ⇒
    // normalisationContext stays undefined for the whole request.
    { id: OPTION_IDS[0], label: 'Status quo', interventions: { fac_lever: { value: 0.2, source: 'user_specified' } } },
    { id: OPTION_IDS[1], label: 'Locum cover', interventions: { fac_lever: { value: 0.8, source: 'user_specified' } } },
  ],
  goal_node_id: 'outcome',
};

/** CEE rung P7, pinned copy — see the unit suite's oracle note. */
function ceeLicenceAgreesWithRawValue(display: string, rawValue: number): boolean {
  const tokens = display.replace(/(?<=\d),(?=\d{3}\b)/g, '').match(/-?\d+(?:\.\d+)?/g);
  if (tokens === null) return false;
  return tokens.some((t) => Number(t) === rawValue);
}

describe('V2 Run · flip-threshold display scale (2.228 F2)', () => {
  let app: FastifyInstance;
  let rows: Array<Record<string, unknown>>;

  beforeAll(async () => {
    // Rate limiting OFF for this suite, and restored afterwards — the same
    // convention `tests/enrichment-emission-contract.test.ts:162,188` uses.
    // Rate-limit slots are a GLOBAL, time-windowed resource shared across
    // parallel workers, so a route test that leaves limiting on spends real
    // slots and makes the rate-limit suites flaky. Omitting this cost two runs
    // to diagnose; see the evidence file §7.7.
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
    const body = JSON.parse(res.body) as Record<string, unknown>;
    rows = (body.flip_thresholds as Array<Record<string, unknown>>) ?? [];
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  it('produces flip rows at all — the anti-vacuity guard for everything below', () => {
    // Without this, an empty array would let every display assertion pass by
    // testing nothing (trap 13).
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.factor_id === 'fac_annual_staffing_cost' || r.factor_id === 'fac_demand')).toBe(true);
  });

  it('THE WIRING: capped factors arrive in user units with a row-level display stamp', () => {
    const capped = rows.filter(
      (r) => r.factor_id === 'fac_annual_staffing_cost' || r.factor_id === 'fac_demand',
    );
    expect(capped.length).toBeGreaterThan(0);

    for (const row of capped) {
      expect(row.value_scale).toBe('display');
      expect(typeof row.current_display).toBe('string');

      const current = row.current_value as number;
      expect(Number.isFinite(current)).toBe(true);
      // Both capped factors have cap >= 100, so a still-normalised value would
      // sit inside [0,1] — the band CEE's cage treats as model-scale.
      expect(Math.abs(current)).toBeGreaterThan(1);

      // The string must DESCRIBE the value the row ships (CEE rung P7).
      expect(ceeLicenceAgreesWithRawValue(row.current_display as string, current)).toBe(true);
    }
  });

  it('the authoritative raw_value wins over the round-trip of the rounded value', () => {
    const staffing = rows.find((r) => r.factor_id === 'fac_annual_staffing_cost');
    expect(staffing).toBeDefined();
    // 0.86 x 320000 = 275200; the user's own number is 275000.
    expect(staffing!.current_value).toBe(275000);
    expect(staffing!.current_display).toBe('275000 GBP');
  });

  it('FAIL-CLOSED CONTROL on the same response: a capless factor claims nothing', () => {
    const lever = rows.find((r) => r.factor_id === 'fac_lever');
    if (lever !== undefined) {
      expect(lever.value_scale).not.toBe('display');
      expect(lever.current_display).toBeUndefined();
    }
  });
});
