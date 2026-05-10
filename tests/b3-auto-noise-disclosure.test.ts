/**
 * Public-boundary regression: B3 auto-noise disclosure (P0).
 *
 * Asserts that PLoT's V3 response carries `auto_noise_applied` and
 * structured `auto_noise_provenance` whenever analysis ran (analysis_status
 * in {computed, partial}) and omits both on blocked / failed responses.
 * The provenance object's enum surface must match the v1 declaration
 * exactly — drift here is a public-API change.
 *
 * Magnitude is pinned at multiplier=1.0 (Neil-approved heuristic, Jinghui
 * calibration pending). `applied:false` must still carry full formula
 * metadata so consumers can disclose calibration status regardless of
 * whether noise fired this run.
 *
 * @regression
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// ISL Mock — auto_noise_applied is parameterised via a shared variable so
// each test can flip ISL's flag without rewriting the mock.
//
// `wireKey` mirrors the real ISL serialisation: ISL's RobustnessResponseV2
// declares the metadata object with `alias="_metadata"` and serialises
// with `by_alias=True`, so the wire shape is `_metadata.auto_noise_applied`.
// Pydantic also accepts `metadata.auto_noise_applied` inbound
// (`populate_by_name=True`); some fixtures use that. We test both keys
// plus a top-level fallback so the read site exercises every branch of
// `extractIslAutoNoiseApplied`.
// ---------------------------------------------------------------------------

type AutoNoiseWireKey = '_metadata' | 'metadata' | 'top_level' | 'omitted';
const islState = {
  autoNoiseApplied: true as boolean | undefined,
  wireKey: '_metadata' as AutoNoiseWireKey,
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
  async analyseRobustness(_graph: unknown, _goalNodeId: string, options: Array<{ id: string }>) {
    return {
      options: options.map((opt, idx) => ({
        option_id: opt.id,
        outcome: { mean: 0.65 + idx * 0.12, std: 0.08, p10: 0.45, p50: 0.65, p90: 0.85, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
        rank: idx + 1,
      })),
      edges: [
        { from: 'factor-a', to: 'goal', sensitivity: 0.5, confidence: 0.8, direction: 'positive' },
      ],
      factors: [
        { node_id: 'factor-a', sensitivity: 0.5, confidence: 0.8, direction: 'positive' },
      ],
      value_of_information: [],
      overall_robustness: 'robust' as const, robustness_score: 0.82,
      fragile_edges: [], robust_edges: [],
      latency_ms: 42, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.82, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: { options?: Array<{ id: string }> }): Promise<{ data: T | null; error: string | null; isl_echoed_request_id?: string }> {
    const options = body.options ?? [];
    const data: Record<string, unknown> = {
      options: options.map((opt, idx) => ({
        option_id: opt.id,
        outcome: { mean: 0.65 + idx * 0.12, std: 0.08, p10: 0.45, p50: 0.65, p90: 0.85, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
        rank: idx + 1,
      })),
      edges: [{ from: 'factor-a', to: 'goal', sensitivity: 0.5, confidence: 0.8, direction: 'positive' }],
      factors: [{ node_id: 'factor-a', sensitivity: 0.5, confidence: 0.8, direction: 'positive' }],
      factor_sensitivity: [
        { factor_id: 'factor-a', factor_label: 'Factor A', elasticity: 0.85, direction: 'positive' },
      ],
      value_of_information: [],
      overall_robustness: 'robust',
      robustness_score: 0.82,
      fragile_edges: [],
      robust_edges: [],
    };
    if (islState.autoNoiseApplied !== undefined && islState.wireKey !== 'omitted') {
      const flag = { auto_noise_applied: islState.autoNoiseApplied };
      if (islState.wireKey === '_metadata') {
        // Real ISL wire shape (Pydantic alias + by_alias=True).
        data._metadata = flag;
      } else if (islState.wireKey === 'metadata') {
        // Fixture/older capture using the field name (populate_by_name).
        data.metadata = flag;
      } else if (islState.wireKey === 'top_level') {
        // Backward-compat passthrough — accepted but not the canonical shape.
        data.auto_noise_applied = islState.autoNoiseApplied;
      }
    }
    return { data: data as T, error: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GRAPH = {
  nodes: [
    { id: 'factor-a', kind: 'factor', label: 'Factor A', observed_state: { value: 50 } },
    { id: 'goal', kind: 'goal', label: 'Goal' },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt-a', label: 'Option A', interventions: { 'factor-a': { value: 0.8, source: 'user_specified' } } },
  { id: 'opt-b', label: 'Option B', interventions: { 'factor-a': { value: 0.5, source: 'user_specified' } } },
];

const PROVENANCE_KEYS = [
  'applied',
  'effect',
  'formula_version',
  'multiplier',
  'noise_distribution',
  'filter_scope',
  'is_provisional',
  'calibration_status',
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('B3: auto-noise disclosure on /v2/run response', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function runOnce() {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: { graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: '42' },
    });
    return { status: res.statusCode, body: JSON.parse(res.body) };
  }

  it('analysis_status=computed with applied=true (live ISL `_metadata` wire shape): provenance present, all enums match', async () => {
    islState.autoNoiseApplied = true;
    islState.wireKey = '_metadata';
    const { status, body } = await runOnce();
    expect(status).toBe(200);
    expect(['computed', 'partial']).toContain(body.analysis_status);

    expect(body.auto_noise_applied).toBe(true);
    expect(body.auto_noise_provenance).toBeDefined();
    expect(Object.keys(body.auto_noise_provenance).sort()).toEqual([...PROVENANCE_KEYS].sort());

    expect(body.auto_noise_provenance.applied).toBe(true);
    expect(body.auto_noise_provenance.effect).toBe('widens_outcome_and_risk_uncertainty');
    expect(body.auto_noise_provenance.formula_version).toBe('plot_auto_v1');
    expect(body.auto_noise_provenance.multiplier).toBe(1.0);
    expect(body.auto_noise_provenance.noise_distribution).toBe('normal_zero_mean_outcome_std');
    expect(body.auto_noise_provenance.filter_scope).toBe('outcome_and_risk_nodes');
    expect(body.auto_noise_provenance.is_provisional).toBe(true);
    expect(body.auto_noise_provenance.calibration_status).toBe('provisional_pending_pilot_calibration');
  });

  it('applied=false (under `_metadata`): provenance still present with full formula metadata intact', async () => {
    islState.autoNoiseApplied = false;
    islState.wireKey = '_metadata';
    const { status, body } = await runOnce();
    expect(status).toBe(200);

    expect(body.auto_noise_applied).toBe(false);
    expect(body.auto_noise_provenance).toBeDefined();
    expect(body.auto_noise_provenance.applied).toBe(false);
    // The brief: applied:false must still carry full formula metadata so
    // consumers can disclose calibration status regardless of whether
    // noise fired this run.
    expect(body.auto_noise_provenance.effect).toBe('widens_outcome_and_risk_uncertainty');
    expect(body.auto_noise_provenance.formula_version).toBe('plot_auto_v1');
    expect(body.auto_noise_provenance.multiplier).toBe(1.0);
    expect(body.auto_noise_provenance.is_provisional).toBe(true);
    expect(body.auto_noise_provenance.calibration_status).toBe('provisional_pending_pilot_calibration');
  });

  it('reads `metadata.auto_noise_applied` (Pydantic field-name alias) as well as `_metadata.*`', async () => {
    islState.autoNoiseApplied = true;
    islState.wireKey = 'metadata';
    const { status, body } = await runOnce();
    expect(status).toBe(200);
    expect(body.auto_noise_applied).toBe(true);
    expect(body.auto_noise_provenance.applied).toBe(true);
  });

  it('reads top-level `auto_noise_applied` for backward-compat with cached payloads', async () => {
    islState.autoNoiseApplied = true;
    islState.wireKey = 'top_level';
    const { status, body } = await runOnce();
    expect(status).toBe(200);
    expect(body.auto_noise_applied).toBe(true);
    expect(body.auto_noise_provenance.applied).toBe(true);
  });

  it('ISL omits the flag entirely: top-level is null, provenance present with `applied: false`', async () => {
    islState.autoNoiseApplied = undefined;
    islState.wireKey = 'omitted';
    const { status, body } = await runOnce();
    expect(status).toBe(200);

    // Top-level mirrors ISL's silence as null, distinguishing it from false.
    expect(body.auto_noise_applied).toBeNull();
    // Provenance still emitted so the calibration-pending disclosure is
    // never lost on legacy ISL responses; applied conservatively defaults
    // to false (we only confirm provenance when ISL emits true).
    expect(body.auto_noise_provenance).toBeDefined();
    expect(body.auto_noise_provenance.applied).toBe(false);
    expect(body.auto_noise_provenance.is_provisional).toBe(true);
  });

  it('analysis_status=blocked (preflight rejection): provenance and applied both omitted', async () => {
    // goal_node_id absent from graph triggers GOAL_NODE_NOT_IN_GRAPH preflight
    // blocker → 422 with analysis_status='blocked'. Blocked responses are
    // built by buildBlockedResponse → V2RunError, which by type cannot
    // carry auto_noise_* fields; this test pins the runtime behaviour.
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        graph: GRAPH,
        options: OPTIONS,
        goal_node_id: 'goal-does-not-exist',
        seed: '42',
      },
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.analysis_status).toBe('blocked');
    expect(body.auto_noise_provenance).toBeUndefined();
    expect(body.auto_noise_applied).toBeUndefined();
  });

  it('payload-only fields never appear inside critiques or status_reason text', async () => {
    islState.autoNoiseApplied = true;
    islState.wireKey = '_metadata';
    const { body } = await runOnce();
    const serialised = JSON.stringify({
      critiques: body.critiques,
      status_reason: body.status_reason,
      isl_status_reason: body.isl_status_reason,
    });
    // These enum literals are payload-only debug metadata; if they ever
    // leak into user-facing copy, this test catches it.
    expect(serialised).not.toMatch(/plot_auto_v1/);
    expect(serialised).not.toMatch(/normal_zero_mean_outcome_std/);
    expect(serialised).not.toMatch(/outcome_and_risk_nodes/);
    expect(serialised).not.toMatch(/widens_outcome_and_risk_uncertainty/);
  });
});
