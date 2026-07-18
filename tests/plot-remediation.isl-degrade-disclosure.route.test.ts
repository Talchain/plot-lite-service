/**
 * A3 remediation item 5 (ALTITUDE Hunt 2, 2026-07-18; expanded per coordinator
 * — ISL PR #78 emits FOUR budget-degradation codes) — PLoT carries ISL's
 * degrade disclosures STABILITY_BANDS_UNAVAILABLE, E_VALUES_UNAVAILABLE,
 * EVPI_UNAVAILABLE, PATH_DECOMPOSITION_UNAVAILABLE through to the /v2/run wire
 * as inference_warnings, exactly the way FLIP_THRESHOLDS_UNAVAILABLE rides. Each
 * carries elapsed_ms (how long the phase ran before degrading), which PLoT
 * preserves on the wire. PLoT's generic ISL-warning merge (run.ts) forwards any
 * {code, message, severity, elapsed_ms?} entry, and the egress enrichment
 * guard's inference_warnings element is passthrough with an open
 * `code: z.string().min(1)`, so enrichment_contract_ok stays true.
 *
 * Harness modelled on tests/lane3-stability-bands-carrythrough.test.ts (single
 * vi.mock of the ISL service so the mocked envelope reaches the route).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const ISL_INFERENCE_WARNINGS = [
  {
    code: 'STABILITY_BANDS_UNAVAILABLE',
    message:
      'Seed-sweep flip-stability bands were attempted but the band computation ' +
      'exceeded its budget for this analysis — bands are omitted; all other analyses are unaffected.',
    severity: 'warning',
    elapsed_ms: 2013,
  },
  {
    code: 'E_VALUES_UNAVAILABLE',
    message:
      'Edge E-values were attempted but the E-value computation exceeded its ' +
      'budget for this analysis — edge_e_values are omitted; all other analyses are unaffected.',
    severity: 'warning',
    elapsed_ms: 8041,
  },
  {
    code: 'EVPI_UNAVAILABLE',
    message:
      'Per-factor EVPI (value of information) was attempted but exceeded its ' +
      'budget for this analysis — EVPI is omitted; all other analyses are unaffected.',
    severity: 'warning',
    elapsed_ms: 1502,
  },
  {
    code: 'PATH_DECOMPOSITION_UNAVAILABLE',
    message:
      'Structural path decomposition was attempted but exceeded its budget for ' +
      'this analysis — path_decomposition is omitted; all other analyses are unaffected.',
    severity: 'warning',
    elapsed_ms: 3300,
  },
];

const EXPECTED_CODES = [
  'STABILITY_BANDS_UNAVAILABLE',
  'E_VALUES_UNAVAILABLE',
  'EVPI_UNAVAILABLE',
  'PATH_DECOMPOSITION_UNAVAILABLE',
] as const;

const ISL_DATA = {
  options: [
    { option_id: 'opt1', outcome: { mean: 0.8, std: 0.1, p10: 0.6, p50: 0.8, p90: 0.95, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 }, rank: 1, win_probability: 0.7, probability_of_goal: 0.65 },
    { option_id: 'opt2', outcome: { mean: 0.7, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 }, rank: 2, win_probability: 0.3, probability_of_goal: 0.55 },
  ],
  factor_sensitivity: [],
  robustness: {
    score: 0.82,
    label: 'robust',
    fragile_edges: [],
    robust_edges: ['factor-a::goal'],
    edge_e_values: [],
  },
  // ISL-originated degrade disclosures (the ISL lane emits these on budget trip).
  inference_warnings: ISL_INFERENCE_WARNINGS,
};

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
    return { ...ISL_DATA, source: 'isl' as const, latency_ms: 42 };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.82, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, _body: unknown): Promise<{ data: T | null; error: string | null }> {
    return { data: ISL_DATA as T, error: null };
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

describe('item 5 — ISL degrade disclosures carried through to the wire', () => {
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

  async function run() {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({ graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: 'item5-degrade' }),
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body);
  }

  it('all FOUR ISL degrade codes appear on inference_warnings, severity + elapsed_ms preserved', async () => {
    const body = await run();
    const warnings = body.inference_warnings ?? [];
    const byCode = new Map<string, { code: string; message: string; severity: string; elapsed_ms?: number }>(
      warnings.map((w: { code: string }) => [w.code, w]),
    );

    for (const source of ISL_INFERENCE_WARNINGS) {
      const got = byCode.get(source.code);
      expect(got, `wire warning for ${source.code}`).toBeDefined();
      expect(got!.severity).toBe('warning');
      // elapsed_ms is carried through verbatim (a slow degrade stays diagnosable).
      expect(got!.elapsed_ms).toBe(source.elapsed_ms);
    }
    // spot-check the message routing survives too
    expect(byCode.get('STABILITY_BANDS_UNAVAILABLE')!.message).toContain('bands are omitted');
    expect(byCode.get('PATH_DECOMPOSITION_UNAVAILABLE')!.message).toContain('path_decomposition is omitted');
  });

  it('carrying the four codes keeps enrichment_contract_ok true (open, passthrough schema)', async () => {
    const body = await run();
    // Non-vacuous: the codes are genuinely on this wire…
    const codes = (body.inference_warnings ?? []).map((w: { code: string }) => w.code);
    for (const code of EXPECTED_CODES) {
      expect(codes).toContain(code);
    }
    // …and the egress guard still assesses the envelope as conformant, even with
    // the additive elapsed_ms field on each forwarded warning.
    expect(body._meta?.evidence?.enrichment_contract_ok).toBe(true);
    expect(codes).not.toContain('ENRICHMENT_CONTRACT_MISMATCH');
  });
});
