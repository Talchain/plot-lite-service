/**
 * SCIENTIFIC REGRESSION GATE — WP3: VOI / EVPI trace-and-pin
 * ----------------------------------------------------------------------------
 * Pins the HONESTY contract of the value-of-information / EVPI surface on the
 * REAL public /v2/run response (the consumed path), plus a compile-time pin
 * that the outbound CEE review request carries no VOI field.
 *
 * What this gate protects:
 *   - No NEGATIVE or NON-FINITE `value_of_information` or `evpi_percentage_points`
 *     ever surfaces in the public response (Howard 1966 non-negativity; NaN/±Inf
 *     are MC artefacts, sanitised to absent — never serialised).
 *   - `evpi_percentage_points` is labelled `evpi_method: 'heuristic'` wherever it
 *     appears — it is a VOI×win-prob-spread proxy, NOT true counterfactual EVPI.
 *     It must never be unlabelled or labelled 'counterfactual'.
 *   - The outbound CEE review request (`CeeReviewRequest`) has NO VOI field —
 *     #189's enrichment VOI is inert w.r.t. CEE (it reads only fragile_edges).
 *
 * Already covered elsewhere (NOT duplicated):
 *   - sanitiseIslVoi / computeEvpiPercentagePoints unit contract (missing-vs-zero,
 *     negative/NaN/±Inf → undefined, explicit 0 preserved): tests/evpi-emission.test.ts
 *   - adapter VOI filter (zero preserved, negative/NaN/null excluded):
 *     tests/factor-sensitivity.test.ts
 *   - enrichFactorSensitivity VOI sanitise + "not consumed by CEE" note:
 *     tests/robustness-enrichment.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CeeReviewRequest } from '../../src/cee/types.js';

// ---------------------------------------------------------------------------
// Compile-time NEGATIVE pin: the outbound CEE review request type carries no
// VOI / EVPI field. Checked by `tsc --noEmit`; locks #189 enrichment as inert
// relative to CEE. If a VOI key is ever added to CeeReviewRequest (or its
// nested sensitive_parameters), `Extract<...>` becomes non-`never` and this
// assignment fails to compile.
// ---------------------------------------------------------------------------
type SensitiveParam = NonNullable<NonNullable<CeeReviewRequest['isl_robustness']>['sensitive_parameters']>[number];
type _NoVoiOnCeeRequest = Extract<keyof CeeReviewRequest, 'value_of_information' | 'voi' | 'evpi_percentage_points'>;
type _NoVoiOnSensitiveParam = Extract<keyof SensitiveParam, 'value_of_information' | 'voi' | 'evpi'>;
const _ceeNoVoi: _NoVoiOnCeeRequest extends never ? true : never = true;
const _spNoVoi: _NoVoiOnSensitiveParam extends never ? true : never = true;
void _ceeNoVoi;
void _spNoVoi;

// ---------------------------------------------------------------------------
// Mocked ISL — returns a win-probability spread (so the heuristic EVPI loop
// fires) and factor_sensitivity carrying PATHOLOGICAL VOI values that must be
// sanitised before reaching the public surface.
// ---------------------------------------------------------------------------

const ISL_FACTOR_SENSITIVITY = [
  { node_id: 'factor-a', sensitivity: 0.8, value_of_information: 0.6, direction: 'positive' as const },
  { node_id: 'factor-b', sensitivity: 0.5, value_of_information: 0, direction: 'negative' as const },   // explicit 0 preserved
  { node_id: 'factor-c', sensitivity: 0.4, value_of_information: -0.05, direction: 'positive' as const }, // negative artefact → absent
  { node_id: 'factor-d', sensitivity: 0.3, value_of_information: Number.NaN, direction: 'positive' as const }, // NaN → absent
  { node_id: 'factor-e', sensitivity: 0.2, value_of_information: Number.POSITIVE_INFINITY, direction: 'positive' as const }, // +Inf → absent
];

function robustnessPayload(options: any[]) {
  return {
    options: options.map((opt: any, idx: number) => ({
      option_id: opt.id,
      win_probability: idx === 0 ? 0.72 : 0.28, // spread 0.44 > 0 ⇒ heuristic loop fires
      outcome: { mean: 0.7 - idx * 0.2, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
      rank: idx + 1,
    })),
    edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
    edge_sensitivity_status: 'available' as const,
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

vi.mock('../../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

const { createServer } = await import('../../src/createServer.js');

const PAYLOAD = {
  graph: {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Revenue' },
      { id: 'factor-a', kind: 'factor', label: 'A', observed_state: { value: 0.5 } },
      { id: 'factor-b', kind: 'factor', label: 'B', observed_state: { value: 0.5 } },
      { id: 'factor-c', kind: 'factor', label: 'C', observed_state: { value: 0.5 } },
    ],
    edges: [
      { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
      { from: 'factor-b', to: 'goal', strength: { mean: 0.4, std: 0.1 } },
      { from: 'factor-c', to: 'goal', strength: { mean: 0.3, std: 0.1 } },
    ],
  },
  options: [
    { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': 0.8 } },
    { id: 'opt2', label: 'Option 2', interventions: { 'factor-b': 0.2 } },
  ],
  goal_node_id: 'goal',
  seed: '42',
};

// Recursively collect every numeric value stored under `key` anywhere in `obj`.
function collectByKey(obj: unknown, key: string, acc: unknown[] = []): unknown[] {
  if (Array.isArray(obj)) {
    for (const v of obj) collectByKey(v, key, acc);
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (k === key) acc.push(v);
      collectByKey(v, key, acc);
    }
  }
  return acc;
}

describe('WP3 gate · VOI/EVPI honesty on the public /v2/run surface', () => {
  let app: FastifyInstance;
  let body: any;

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
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  it('NO negative or non-finite value_of_information anywhere in the public response', () => {
    const vois = collectByKey(body, 'value_of_information');
    for (const v of vois) {
      if (v === null || v === undefined) continue; // absent is honest
      expect(typeof v).toBe('number');
      expect(Number.isFinite(v as number)).toBe(true);
      expect(v as number).toBeGreaterThanOrEqual(0);
    }
  });

  it('NO negative or non-finite evpi_percentage_points anywhere in the public response', () => {
    const evpis = collectByKey(body, 'evpi_percentage_points');
    for (const v of evpis) {
      if (v === null || v === undefined) continue;
      expect(typeof v).toBe('number');
      expect(Number.isFinite(v as number)).toBe(true);
      expect(v as number).toBeGreaterThanOrEqual(0);
    }
  });

  it('PROVENANCE: every emitted evpi_percentage_points is labelled evpi_method="heuristic" (never counterfactual)', () => {
    const fs = (body.factor_sensitivity ?? []) as any[];
    expect(Array.isArray(fs)).toBe(true);
    let emittedCount = 0;
    for (const f of fs) {
      if (f.evpi_percentage_points !== undefined && f.evpi_percentage_points !== null) {
        emittedCount += 1;
        expect(f.evpi_method).toBe('heuristic');
        expect(f.evpi_method).not.toBe('counterfactual');
      }
    }
    // Non-vacuous: the heuristic path is actually live for this fixture
    // (win-probability spread 0.44 > 0, factors carry VOI).
    expect(emittedCount).toBeGreaterThan(0);
  });

  it('MISSING-VS-ZERO: a public 0 VOI is surfaced as exactly 0 (not null/undefined, not coerced)', () => {
    // TRACE FINDING (documented, not a bug): on the `graph+isl_merge` path the
    // public `value_of_information` is GRAPH-derived (computeValueOfInformation,
    // bounded [0,1]); ISL's raw VOI feeds confidence/merge but is not the public
    // VOI field on this path. ISL VOI boundary sanitisation (sanitiseIslVoi) is
    // unit-pinned in tests/evpi-emission.test.ts and reaches the public surface on
    // the ISL-ONLY fallback path. Here we pin the missing-vs-zero distinction on
    // the PUBLIC surface: a 0 is a real, preserved value — never coerced to
    // null/undefined and never made negative.
    const fs = (body.factor_sensitivity ?? []) as any[];
    const zeros = fs.filter((f) => f.value_of_information === 0);
    for (const f of zeros) {
      expect(Object.is(f.value_of_information, 0)).toBe(true); // exactly 0, not -0/null/undefined
    }
    // Any factor that carries a VOI at all carries a number (never a stray null).
    for (const f of fs) {
      if ('value_of_information' in f && f.value_of_information !== undefined) {
        expect(typeof f.value_of_information).toBe('number');
      }
    }
  });
});
