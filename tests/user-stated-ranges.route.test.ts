/**
 * ROADMAP 2.720 (pillar P4) — THE ROUTE-LEVEL BINDING.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM
 * `tests/isl-user-stated-ranges.contract.test.ts`
 * ------------------------------------------------
 * That file proves the TRANSLATOR can forward `user_stated_ranges`, that the
 * envelope ACCESSOR can read `range_fit_disclosures`, and that ISL's pinned
 * model declares every member. **None of those touch `/v2/run`.** Delete the
 * argument at the translator call site, or delete the spread in
 * `buildResponse`, and every one of them stays GREEN while the capability is
 * dark end to end — machinery that reads as a guarantee and never executes,
 * which is this estate's dominant defect class.
 *
 * So this file drives the REAL route, through both gates
 * (the preValidation unknown-key allowlist AND the Ajv body schema), with a
 * mocked ISL service, and asserts:
 *   - the body PLoT hands ISL CARRIES the ranges (request half), and
 *   - the body PLoT returns CARRIES the disclosures (response half),
 * each against a CONTROL run of the same route that states no ranges.
 *
 * Both halves are needed and neither implies the other: the request half can
 * work while the response is dropped by buildResponse's field-by-field rebuild
 * (the transformEdgeEValues-class hazard), and the response half can be
 * asserted on an ISL envelope that PLoT never actually asked for anything.
 *
 * Harness modelled on tests/plot-remediation.isl-degrade-disclosure.route.test.ts
 * (single `vi.mock` of the ISL service so the mocked envelope reaches the route).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

/**
 * The ISL bodies PLoT hands to `callAnalysisEndpoint`, captured in call order.
 * This is the REQUEST half's instrument: a route test that only inspected the
 * response could not tell "PLoT forwarded the ranges" from "ISL invented the
 * disclosures".
 */
const capturedIslBodies: Array<Record<string, unknown>> = [];

/**
 * The disclosure ISL returns. Shaped from a REAL capture against deployed ISL
 * build 686fcb7 (`tests/fixtures/isl-range-fit-live-20260807/B-valid-range.response.json`),
 * not invented — a fixture you wrote yourself is not evidence about the wire,
 * so this one is copied from bytes the deployed service actually produced.
 */
const ISL_RANGE_FIT_DISCLOSURES = [
  {
    node_id: 'factor-a',
    lower: 0.2,
    upper: 0.6,
    domain: 'unit_interval',
    fitted: {
      family: 'beta',
      alpha: 1.1864333334848651,
      beta: 1.7124956456865377,
      mean: 0.4092660917219096,
      std: 0.2490153792254106,
      q25: 0.2,
      q75: 0.6000000000000004,
      coverage: 0.5,
      method_version: 'range-iq-fit-v1',
    },
  },
  {
    // The TYPED REFUSAL arm, carried in the same array as an accepted fit —
    // exactly how ISL emits a mixed batch. A consumer that reads only `fitted`
    // silently shows nothing here, which is the state the typed vocabulary
    // exists to make visible.
    node_id: 'factor-b',
    lower: 0.9,
    upper: 0.1,
    domain: 'unit_interval',
    refusal: {
      code: 'RANGE_INVALID_ORDER',
      message:
        'The lower bound is greater than the upper bound. Order is part of what was said — please restate the range.',
      lower: 0.9,
      upper: 0.1,
      domain: 'unit_interval',
    },
  },
];

const ISL_BASE = {
  options: [
    { option_id: 'opt1', outcome: { mean: 0.8, std: 0.1, p10: 0.6, p50: 0.8, p90: 0.95, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 }, rank: 1, win_probability: 0.7 },
    { option_id: 'opt2', outcome: { mean: 0.7, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 }, rank: 2, win_probability: 0.3 },
  ],
  factor_sensitivity: [],
  robustness: {
    score: 0.82,
    label: 'robust',
    fragile_edges: [],
    robust_edges: ['factor-a::goal'],
    edge_e_values: [],
  },
};

/**
 * ISL's own contract: `range_fit_disclosures` is emitted ONLY when the request
 * carried ranges. Mirroring that here is what makes the CONTROL meaningful — a
 * mock that always returned disclosures would make the response assertions pass
 * on a route that forwarded nothing.
 */
function islResponseFor(body: Record<string, unknown>): Record<string, unknown> {
  const stated = body.user_stated_ranges;
  if (Array.isArray(stated) && stated.length > 0) {
    return { ...ISL_BASE, range_fit_disclosures: ISL_RANGE_FIT_DISCLOSURES };
  }
  return { ...ISL_BASE };
}

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high',
      adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseRobustness() {
    return { ...ISL_BASE, source: 'isl' as const, latency_ms: 42 };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.82, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(endpoint: string, body: unknown): Promise<{ data: T | null; error: string | null }> {
    if (endpoint === '/api/v1/robustness/analyze/v2') {
      const b = body as Record<string, unknown>;
      capturedIslBodies.push(b);
      return { data: islResponseFor(b) as T, error: null };
    }
    return { data: ISL_BASE as T, error: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../src/integrations/isl/index.ts');
  return {
    ...actual,
    getISLService: () => mockISLService,
    get islService() { return mockISLService; },
  };
});

import { createServer } from '../src/createServer.js';

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'factor-a', kind: 'factor', label: 'Marketing Spend', observed_state: { value: 0.6 } },
    { id: 'factor-b', kind: 'factor', label: 'Churn Rate', observed_state: { value: 0.4 } },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
    { from: 'factor-b', to: 'goal', strength: { mean: 0.3, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt1', label: 'Increase Marketing', interventions: { 'factor-a': 0.8 } },
  { id: 'opt2', label: 'Reduce Spend', interventions: { 'factor-a': 0.3 } },
];

/** What the caller states. `factor-b`'s row is deliberately INVALID (inverted). */
const STATED_RANGES = [
  {
    node_id: 'factor-a',
    lower: 0.2,
    upper: 0.6,
    domain: 'unit_interval',
    source: 'user',
    stated_at: '2026-08-07T00:00:00Z',
    method_version: 'user-stated-range-v1',
  },
  { node_id: 'factor-b', lower: 0.9, upper: 0.1, domain: 'unit_interval', source: 'user' },
];

describe('ROADMAP 2.720 — /v2/run carries user_stated_ranges out and range_fit_disclosures back', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  beforeEach(() => {
    capturedIslBodies.length = 0;
  });

  async function run(extra: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({
        graph: GRAPH,
        options: OPTIONS,
        goal_node_id: 'goal',
        seed: 'usr-2720',
        ...extra,
      }),
    });
    // A 400 here means one of the two request gates rejected the key, which is
    // the silent-loss failure mode this row exists to prevent. Surface the body.
    expect(res.statusCode, `/v2/run rejected the request: ${res.body.slice(0, 400)}`).toBe(200);
    return JSON.parse(res.body) as Record<string, unknown>;
  }

  /** The ISL body from the MAIN analysis call (the flip probe clones it later). */
  const mainIslBody = (): Record<string, unknown> => {
    expect(capturedIslBodies.length, 'PLoT made no ISL analysis call at all').toBeGreaterThan(0);
    return capturedIslBodies[0]!;
  };

  // ---------------------------------------------------------------------------
  // The REQUEST half
  // ---------------------------------------------------------------------------

  it('R1: BOTH request gates admit the key — the route returns 200, not a 400 unknown-key rejection', async () => {
    const body = await run({ user_stated_ranges: STATED_RANGES });
    // POSITIVE CONTROL (trap 13): the run really produced an analysis, so the
    // assertions below are made over a request that was actually processed
    // rather than over a shape that short-circuited on a rejected key.
    expect(body.endpoint_version).toBe('v2/run');
    expect(body.analysis_status).toBe('computed');
    expect(Array.isArray(body.option_comparison)).toBe(true);
    expect((body.option_comparison as unknown[]).length).toBe(2);
  });

  it('R2: the body PLoT hands ISL CARRIES the stated ranges, bound by node IDENTITY', async () => {
    await run({ user_stated_ranges: STATED_RANGES });
    const ranges = mainIslBody().user_stated_ranges as Array<Record<string, unknown>> | undefined;
    expect(ranges, 'the route did not forward user_stated_ranges to ISL').toBeDefined();
    expect(ranges!.map((r) => r.node_id).sort()).toEqual(['factor-a', 'factor-b']);

    // Found by node_id, never by a value predicate another row could satisfy.
    const a = ranges!.find((r) => r.node_id === 'factor-a')!;
    expect(a.lower).toBe(0.2);
    expect(a.upper).toBe(0.6);
    expect(a.domain).toBe('unit_interval');
    expect(a.source).toBe('user');
    expect(a.stated_at).toBe('2026-08-07T00:00:00Z');
    expect(a.method_version).toBe('user-stated-range-v1');

    // ⚠ THE INVALID ROW IS FORWARDED UNREPAIRED. PLoT must not swap the bounds
    // "helpfully": order is part of what the user SAID, and ISL's typed
    // RANGE_INVALID_ORDER refusal is the honest answer. Silently reordering it
    // would return a confident fit for a statement nobody made.
    const b = ranges!.find((r) => r.node_id === 'factor-b')!;
    expect(b.lower).toBe(0.9);
    expect(b.upper).toBe(0.1);
  });

  it('R3: CONTROL — a run that states no ranges sends no key at all (no default payload growth)', async () => {
    await run({});
    expect('user_stated_ranges' in mainIslBody()).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // The RESPONSE half
  // ---------------------------------------------------------------------------

  it('R4: the disclosures reach PLoT\'s /v2/run response body — fit AND typed refusal, intact', async () => {
    const body = await run({ user_stated_ranges: STATED_RANGES });
    const rows = body.range_fit_disclosures as Array<Record<string, any>> | undefined;
    expect(rows, 'buildResponse dropped range_fit_disclosures').toBeDefined();
    expect(rows!.map((r) => r.node_id).sort()).toEqual(['factor-a', 'factor-b']);

    const fitted = rows!.find((r) => r.node_id === 'factor-a')!;
    expect(fitted.fitted.family).toBe('beta');
    expect(fitted.fitted.method_version).toBe('range-iq-fit-v1');
    expect(fitted.fitted.coverage).toBe(0.5);
    expect(fitted.fitted.q25).toBeCloseTo(0.2, 9);
    expect(fitted.fitted.q75).toBeCloseTo(0.6, 9);
    expect(fitted.refusal).toBeUndefined();

    // The refusal survives as a refusal — not flattened, not defaulted into a
    // fit. A Beta(1,1) minted here would be a fabricated value wearing real
    // provenance.
    const refused = rows!.find((r) => r.node_id === 'factor-b')!;
    expect(refused.refusal.code).toBe('RANGE_INVALID_ORDER');
    expect(refused.fitted).toBeUndefined();
  });

  it('R5: CONTROL — a run that states no ranges returns NO range_fit_disclosures key', async () => {
    const body = await run({});
    expect('range_fit_disclosures' in body).toBe(false);
  });

  it('R6: the enrichment egress guard still assesses the body as contract-conformant', async () => {
    // The disclosure rides as an additive top-level key. If it tripped the
    // egress guard, PLoT would stamp enrichment_contract_ok:false on every run
    // that stated a range — a trust regression bought with a feature.
    const body = await run({ user_stated_ranges: STATED_RANGES });
    const meta = body._meta as Record<string, any> | undefined;
    expect(meta?.evidence?.enrichment_contract_ok).toBe(true);
  });
});
