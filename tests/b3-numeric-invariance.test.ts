/**
 * Numeric invariance for B3 auto-noise disclosure.
 *
 * The B3 work is strictly metadata + UI: it adds `auto_noise_applied` and
 * `auto_noise_provenance` to the V3 response, surfaces a UI marker, and
 * rewrites accordion copy. It must NOT change any numeric output of the
 * inference engine — outcome distributions (`mean`, `std`, `p10`, `p50`,
 * `p90`, `n_samples`, `validity_ratio`), win/goal probabilities, factor
 * confidence/influence, robustness scores, etc.
 *
 * This spec proves the invariant by running the same request through the
 * full Fastify route three times with the only varying state being how
 * ISL emits `auto_noise_applied` — under the canonical `_metadata` wire
 * shape (true), the same shape with `false`, and omitted entirely. The
 * numeric fields of every response are diffed byte-for-byte; any
 * non-empty diff is a regression.
 *
 * Why three states (not just before/after): the implementation has three
 * code branches in `extractIslAutoNoiseApplied` plus the
 * `buildAutoNoiseProvenance(applied: bool)` builder. If any branch
 * accidentally injected numeric work, this test catches it.
 *
 * @regression
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Shared mock — same fixture as b3-auto-noise-disclosure.test.ts, with the
// auto-noise wire-shape parameterised so we can compare across states.
// ---------------------------------------------------------------------------

const islState = {
  autoNoiseApplied: true as boolean | undefined,
  wireKey: '_metadata' as '_metadata' | 'metadata' | 'top_level' | 'omitted',
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
      overall_robustness: 'robust' as const,
      robustness_score: 0.82,
      fragile_edges: [],
      robust_edges: [],
      latency_ms: 42,
      source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.82, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: { options?: Array<{ id: string }> }): Promise<{ data: T | null; error: string | null }> {
    const options = body.options ?? [];
    const data: Record<string, unknown> = {
      // Numeric outputs are intentionally fixed (no Math.random; no time-
      // dependent values) so the byte-for-byte diff is meaningful.
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
      if (islState.wireKey === '_metadata') data._metadata = flag;
      else if (islState.wireKey === 'metadata') data.metadata = flag;
      else if (islState.wireKey === 'top_level') data.auto_noise_applied = islState.autoNoiseApplied;
    }
    return { data: data as T, error: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';

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

/**
 * Project the response onto its numeric "engine output" fields. Anything
 * NOT in this projection (auto_noise_*, request_id, response_hash,
 * processing_time_ms, isl_status_*, ceeTrace, identifiability methods,
 * etc.) may legitimately differ between runs. Anything in this projection
 * MUST NOT differ — it is the engine's numeric contract.
 */
function projectNumericOutput(body: Record<string, unknown>) {
  const f = body as any;
  return {
    analysis_status: f.analysis_status,
    option_comparison: (f.option_comparison ?? []).map((o: any) => ({
      option_id: o.option_id,
      expected_outcome: o.expected_outcome,
      confidence_interval: o.confidence_interval,
      outcome: o.outcome,
      probability_of_goal: o.probability_of_goal,
      win_probability: o.win_probability,
      rank: o.rank,
      goal_probability: o.goal_probability,
    })),
    factor_sensitivity: (f.factor_sensitivity ?? []).map((fs: any) => ({
      factor_id: fs.factor_id,
      sensitivity_score: fs.sensitivity_score,
      elasticity: fs.elasticity,
      confidence: fs.confidence,
      influence_score: fs.influence_score,
      direction: fs.direction,
      attribution_stability: fs.attribution_stability,
      elasticity_std: fs.elasticity_std,
      rank_flip_rate: fs.rank_flip_rate,
    })),
    robustness: f.robustness,
    edge_sensitivity: f.edge_sensitivity,
    edge_e_values: f.edge_e_values,
    flip_thresholds: f.flip_thresholds,
    factor_stability: f.factor_stability,
  };
}

describe('B3: numeric invariance under auto-noise disclosure (audit-feedback brief-3)', () => {
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

  beforeEach(() => {
    islState.autoNoiseApplied = true;
    islState.wireKey = '_metadata';
  });

  async function runOnceProjected() {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: { graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: '42' },
    });
    expect(res.statusCode).toBe(200);
    return projectNumericOutput(JSON.parse(res.body));
  }

  it('numeric output is byte-for-byte identical across applied=true / applied=false / ISL-omitted', async () => {
    islState.autoNoiseApplied = true;
    islState.wireKey = '_metadata';
    const applied = await runOnceProjected();

    islState.autoNoiseApplied = false;
    islState.wireKey = '_metadata';
    const notApplied = await runOnceProjected();

    islState.autoNoiseApplied = undefined;
    islState.wireKey = 'omitted';
    const omitted = await runOnceProjected();

    // The strongest single regression check for B3: the metadata change
    // must not perturb a single numeric field. If this fails, it means
    // the extractor / builder / response-merge code path injected work
    // into the engine output rather than staying additive.
    expect(JSON.stringify(notApplied)).toBe(JSON.stringify(applied));
    expect(JSON.stringify(omitted)).toBe(JSON.stringify(applied));

    // Spot-check that the projection actually carries content (so a bug
    // that emptied the projection wouldn't trivially pass).
    expect(applied.option_comparison.length).toBeGreaterThan(0);
    expect(applied.option_comparison[0].outcome).toMatchObject({
      mean: expect.any(Number),
      std: expect.any(Number),
      p10: expect.any(Number),
      p50: expect.any(Number),
      p90: expect.any(Number),
    });
    expect(applied.factor_sensitivity.length).toBeGreaterThan(0);
    expect(typeof applied.factor_sensitivity[0].confidence).toBe('number');
  });

  it('outcome p10/p50/p90 match the ISL-emitted values verbatim (no auto-noise post-processing on PLoT side)', async () => {
    islState.autoNoiseApplied = true;
    const projected = await runOnceProjected();
    // ISL fixture emits outcome.p10 = 0.45, p50 = 0.65, p90 = 0.85 for both
    // options. PLoT must pass these through unchanged regardless of auto-
    // noise state (auto-noise is applied INSIDE ISL; PLoT only echoes the
    // disclosure, never re-noises the distribution).
    for (const opt of projected.option_comparison) {
      expect(opt.outcome.p10).toBe(0.45);
      expect(opt.outcome.p50).toBe(0.65);
      expect(opt.outcome.p90).toBe(0.85);
    }
  });

  it('B3 is purely additive: only differences across auto-noise states are the two new B3 fields (and ambient per-call fields)', async () => {
    // Audit-feedback brief-4 (P2-1): the existing engine-numeric
    // projection above proves B3 doesn't move numbers; this test
    // proves B3 doesn't move ANYTHING outside of the two new metadata
    // fields. Recursively mask the legitimately-varying ambient fields
    // (per-call UUIDs, wall-clock timings, ISO timestamps) plus the
    // two new B3 fields, then assert the remainder is byte-for-byte
    // identical across all three auto-noise states.
    //
    // What this catches that the engine-numeric projection misses:
    // any unintended side effect outside `option_comparison` /
    // `factor_sensitivity` / `robustness` / etc. — e.g. a stray
    // critique, a flag, an enrichment field, an extra coaching nudge —
    // that the B3 code path accidentally introduced. There should be
    // exactly zero such side effects.
    async function fullResponse(): Promise<Record<string, unknown>> {
      const res = await app.inject({
        method: 'POST',
        url: '/v2/run',
        headers: { 'Content-Type': 'application/json' },
        payload: { graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: '42' },
      });
      expect(res.statusCode).toBe(200);
      return JSON.parse(res.body) as Record<string, unknown>;
    }

    // Keys whose VALUES vary per-call (uuids, timestamps, wall-clock
    // timings) and which are matched at any nesting depth. The B3 keys
    // are the two new fields whose presence/contents are exactly what
    // we expect to differ between states.
    const AMBIENT_KEYS = new Set([
      // Per-request identifiers (UUIDs).
      'request_id',
      'requestId',
      'isl_request_id',
      'fact_id',
      'request_id_chain',
      // Per-call ISO timestamps.
      'computed_at',
      'created_at',
      'timestamp',
      // Wall-clock timings.
      'latency_ms',
      'normalization_ms',
      'validation_ms',
      'isl_ms',
      'cee_ms',
      'duration_ms',
      'processing_time_ms',
      // ISL status text varies if ISL provides one.
      'isl_status_reason',
    ]);
    const B3_KEYS = new Set(['auto_noise_applied', 'auto_noise_provenance']);

    function maskAmbient(value: unknown): unknown {
      if (value === null || typeof value !== 'object') return value;
      if (Array.isArray(value)) return value.map(maskAmbient);
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (B3_KEYS.has(k)) continue; // exclude B3 fields entirely
        out[k] = AMBIENT_KEYS.has(k) ? '<ambient>' : maskAmbient(v);
      }
      return out;
    }

    islState.autoNoiseApplied = true;
    islState.wireKey = '_metadata';
    const applied = maskAmbient(await fullResponse()) as Record<string, unknown>;

    islState.autoNoiseApplied = false;
    islState.wireKey = '_metadata';
    const notApplied = maskAmbient(await fullResponse());

    islState.autoNoiseApplied = undefined;
    islState.wireKey = 'omitted';
    const omitted = maskAmbient(await fullResponse());

    // Sanity: masked response still carries the engine-output content.
    expect(Object.keys(applied).length).toBeGreaterThan(10);
    expect(applied).not.toHaveProperty('auto_noise_applied');
    expect(applied).not.toHaveProperty('auto_noise_provenance');
    // Sanity: ambient masking actually fired (proves the mask is wired).
    expect(JSON.stringify(applied)).toContain('"<ambient>"');

    // The proof: outside the two B3 fields and the ambient per-call
    // fields, the response is byte-for-byte identical across all three
    // auto-noise states. If this fails, the B3 code path side-effected
    // something it shouldn't have.
    expect(JSON.stringify(notApplied)).toBe(JSON.stringify(applied));
    expect(JSON.stringify(omitted)).toBe(JSON.stringify(applied));
  });
});
