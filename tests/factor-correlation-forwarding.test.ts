/**
 * Capability #100 — client-supplied factor correlations THROUGH PLoT.
 * Doctrine D-23.4 (A3-DECISIONS-2026-07-23). PLoT forwards `factor_correlations`
 * verbatim into the ISL robustness request and passes ISL's correlated-factors
 * outputs back through additively. Deep semantics stay ISL-side.
 *
 * Coverage:
 *  1. FORWARDING (translator unit): present → verbatim on the ISL request;
 *     absent → key omitted (request-gated, no default payload growth).
 *  2. ALLOWLIST: /v2/run ACCEPTS factor_correlations (both gates — preValidation
 *     allowlist + runV3Schema Ajv). Control: an unknown key is still rejected.
 *     (Mutation-checked out-of-band: removing the V2_RUN_ALLOWED_KEYS entry
 *     turns the acceptance case RED — see NOTES.md.)
 *  3. RESPONSE PASSTHROUGH: an ISL response carrying correlation_model +
 *     decision_evpi + factor_evppi + p_win_sensitivity emerges VERBATIM in the
 *     public /v2/run body; when ISL omits them the keys are ABSENT (the
 *     buildResponse rebuild would otherwise silently drop them).
 *  4. ISL 422 PASSTHROUGH: ISL's semantic rejection of a bad correlation
 *     (unknown-factor / |rho|>1 / self-pair / duplicate) surfaces through PLoT
 *     as a 422 with the ISL critique preserved.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  toISLRobustnessRequest,
} from '../src/integrations/isl/translator-v3.js';
import type { EngineGraphV3, OptionV3, FactorCorrelation } from '../src/types/engine-v3.js';

// ---------------------------------------------------------------------------
// (1) FORWARDING — translator unit (no server, byte-precise)
// ---------------------------------------------------------------------------

const UNIT_GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'factor-a', kind: 'factor', label: 'Factor A', observed_state: { value: 50 } },
    { id: 'factor-b', kind: 'factor', label: 'Factor B', observed_state: { value: 30 } },
    { id: 'goal', kind: 'goal', label: 'Goal' },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
    { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.15 } },
  ],
} as unknown as EngineGraphV3;

const UNIT_OPTIONS: OptionV3[] = [
  { id: 'opt-a', label: 'A', interventions: { 'factor-a': { value: 0.8, source: 'user_specified' } } },
  { id: 'opt-b', label: 'B', interventions: { 'factor-b': { value: 0.7, source: 'user_specified' } } },
] as unknown as OptionV3[];

const CORRELATIONS: FactorCorrelation[] = [
  { factor_a: 'factor-a', factor_b: 'factor-b', rho: 0.4 },
  { factor_a: 'factor-b', factor_b: 'factor-a', rho: -0.2 },
];

describe('capability #100 — factor_correlations forwarding (translator)', () => {
  it('forwards factor_correlations VERBATIM when supplied', () => {
    const req = toISLRobustnessRequest(
      UNIT_GRAPH, UNIT_OPTIONS, 'goal', 'req-1',
      1000, undefined, undefined, '42', undefined, undefined,
      CORRELATIONS,
    );
    expect(req.factor_correlations).toEqual(CORRELATIONS);
    // Verbatim: same reference contents, no reshaping.
    expect(req.factor_correlations).toStrictEqual(CORRELATIONS);
  });

  it('OMITS factor_correlations when not supplied (request-gated)', () => {
    const req = toISLRobustnessRequest(
      UNIT_GRAPH, UNIT_OPTIONS, 'goal', 'req-2', 1000,
    );
    expect('factor_correlations' in req).toBe(false);
    expect(req.factor_correlations).toBeUndefined();
  });

  it('OMITS factor_correlations for an empty array (no empty payload to ISL)', () => {
    const req = toISLRobustnessRequest(
      UNIT_GRAPH, UNIT_OPTIONS, 'goal', 'req-3',
      1000, undefined, undefined, undefined, undefined, undefined,
      [],
    );
    expect('factor_correlations' in req).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Route-level coverage (2)(3)(4) — in-process server with a mocked ISL.
// ---------------------------------------------------------------------------

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'isl-v2-live-20260706',
);
const captureA = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'isl-staging-capture.json'), 'utf8'),
);
const requestA = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'isl-v2-request.json'), 'utf8'),
);

// ISL-shaped correlated-factors outputs used by the passthrough proof.
const CORRELATION_MODEL = {
  model: 'gaussian_copula',
  psd: { status: 'valid', method: 'none' },
  tail_independence_disclosed: true,
};
const DECISION_EVPI = { value: 0.042, method: 'joint_samples', units: 'outcome' };
const FACTOR_EVPPI = [
  { factor_id: 'fac_dev_headcount', evppi: 0.031, method: 'strong_oakley' },
];
const P_WIN_SENSITIVITY = [
  { factor_id: 'fac_dev_headcount', p_win_sensitivity: 0.12 },
];

// Mutable mock state (mock-prefixed so Vitest permits it inside the factory).
const mockState: { augment: boolean; error: unknown | null } = { augment: false, error: null };

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
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async analyseRobustness(): Promise<never> { throw new Error('not called'); },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(): Promise<{ data: T | null; error: unknown | null; latency_ms: number }> {
    if (mockState.error) {
      return { data: null, error: mockState.error, latency_ms: 0 };
    }
    const payload = JSON.parse(JSON.stringify(captureA));
    if (mockState.augment) {
      payload.correlation_model = CORRELATION_MODEL;
      payload.decision_evpi = DECISION_EVPI;
      payload.factor_evppi = FACTOR_EVPPI;
      payload.p_win_sensitivity = P_WIN_SENSITIVITY;
    }
    return { data: payload as T, error: null, latency_ms: 0 };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';

/** PLoT /v2/run body derived from the captured ISL request. */
function buildPlotBody(extra: Record<string, unknown> = {}) {
  return {
    graph: {
      nodes: requestA.graph.nodes.map((n: any) => ({
        id: n.id,
        kind: n.kind,
        label: n.label,
        ...(n.observed_state?.value !== undefined && n.observed_state?.value !== null
          ? { observed_state: { value: n.observed_state.value } }
          : {}),
      })),
      edges: requestA.graph.edges.map((e: any) => ({
        from: e.from,
        to: e.to,
        exists_probability: e.exists_probability,
        strength: { mean: e.strength.mean, std: e.strength.std },
      })),
    },
    options: requestA.options.map((o: any) => ({
      id: o.id,
      label: o.label,
      interventions: Object.fromEntries(
        Object.entries(o.interventions).map(([nodeId, value]) => [
          nodeId,
          { value, source: 'user_specified' },
        ]),
      ),
    })),
    goal_node_id: requestA.goal_node_id,
    seed: String(requestA.seed),
    ...extra,
  };
}

describe('capability #100 — /v2/run route (allowlist, passthrough, 422)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    delete process.env.ISL_FACTOR_EVPI_INTERNAL;
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    mockState.augment = false;
    mockState.error = null;
    await app.close();
  });

  // (2) ALLOWLIST -----------------------------------------------------------

  it('ACCEPTS factor_correlations on /v2/run (not rejected as unknown key)', async () => {
    mockState.augment = false;
    mockState.error = null;
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: buildPlotBody({
        factor_correlations: [
          { factor_a: 'fac_dev_headcount', factor_b: 'fac_tech_lead', rho: 0.3 },
        ],
      }),
    });
    // Accepted → reaches ISL → 200. The point is it is NOT a 400 unknown-key
    // rejection (which is what the mutation restores).
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.analysis_status).not.toBe('blocked');
  });

  it('control: an unknown top-level key IS still rejected with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: buildPlotBody({ not_a_real_key: true }),
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toContain('not_a_real_key');
  });

  // (3) RESPONSE PASSTHROUGH -------------------------------------------------

  it('passes correlated-factors outputs through VERBATIM when ISL emits them', async () => {
    mockState.augment = true;
    mockState.error = null;
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: buildPlotBody({
        factor_correlations: [
          { factor_a: 'fac_dev_headcount', factor_b: 'fac_tech_lead', rho: 0.3 },
        ],
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // presence-in ⇒ presence-out, verbatim.
    expect(body.correlation_model).toEqual(CORRELATION_MODEL);
    expect(body.decision_evpi).toEqual(DECISION_EVPI);
    expect(body.factor_evppi).toEqual(FACTOR_EVPPI);
    expect(body.p_win_sensitivity).toEqual(P_WIN_SENSITIVITY);
  });

  it('OMITS the correlated-factors keys when ISL does not emit them', async () => {
    mockState.augment = false;
    mockState.error = null;
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: buildPlotBody(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // absence-in ⇒ absence-out (buildResponse must not fabricate them).
    expect('correlation_model' in body).toBe(false);
    expect('decision_evpi' in body).toBe(false);
    expect('factor_evppi' in body).toBe(false);
    expect('p_win_sensitivity' in body).toBe(false);
  });

  // (4) ISL 422 PASSTHROUGH --------------------------------------------------

  it('surfaces ISL\'s semantic correlation rejection as a 422 with the critique preserved', async () => {
    mockState.augment = false;
    mockState.error = {
      code: 'ISL_REJECTED',
      message: 'factor_correlations references unknown factor "ghost"',
      retryable: false,
      status: 422,
      critiques: [
        {
          code: 'CORRELATION_UNKNOWN_FACTOR',
          severity: 'blocker',
          message: 'factor_correlations references unknown factor "ghost"',
          suggestion: 'Reference only factor node ids present in the graph.',
          affected_nodes: ['ghost'],
        },
      ],
    };
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: buildPlotBody({
        factor_correlations: [
          { factor_a: 'ghost', factor_b: 'fac_tech_lead', rho: 0.3 },
        ],
      }),
    });
    mockState.error = null;
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    const codes = (body.critiques ?? []).map((c: any) => c.code);
    expect(codes).toContain('CORRELATION_UNKNOWN_FACTOR');
    const critique = body.critiques.find((c: any) => c.code === 'CORRELATION_UNKNOWN_FACTOR');
    expect(critique.source).toBe('isl');
    expect(critique.message).toContain('unknown factor');
  });
});
