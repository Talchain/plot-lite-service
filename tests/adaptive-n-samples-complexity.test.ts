/**
 * ROADMAP 1.54 — Adaptive n_samples vs the ISL complexity cap (density wall).
 *
 * ISL enforces `n_samples × nodes × edges ≤ ISL_MAX_COMPUTE_COMPLEXITY`
 * (default 10,000,000) and returns a raw 422 when exceeded
 * (Inference-Service-Layer src/api/robustness.py — strict `>` comparison on
 * the request's node/edge array lengths). PLoT's standard depth is 4,000, so
 * any causal graph with nodes × edges > 2,500 hit the wall on the live path
 * (verified: acceptance-evidence/dense-graph-test attempt 6, 43×70 causal =
 * 12,040,000 > 10,000,000).
 *
 * The fix (binding design):
 *  1. ADAPTIVE: before calling ISL, if n_samples × nodes × edges exceeds the
 *     budget, reduce n_samples to floor(budget / (nodes × edges)).
 *  2. WARN: attach SAMPLES_REDUCED_FOR_COMPLEXITY (inference_warnings, the
 *     CONSTRAINT_DIRECTION_SUSPECT carrier pattern) naming original and
 *     reduced depths.
 *  3. FLOOR + REFUSE: never send below 1,000 samples. If even 1,000 exceeds
 *     the budget (nodes × edges > 10,000) refuse BEFORE calling ISL with a
 *     GRAPH_TOO_COMPLEX blocker (422) — never a raw ISL 422 passthrough.
 *  4. Explicit caller n_samples gets the same treatment (reduce + warn, or
 *     refuse) — never silently overridden without the warning.
 *  5. Anywhere the response reports n_samples, it reports the TRUE depth used.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  applyComplexityBudget,
  resolveComplexityBudget,
  ISL_COMPLEXITY_BUDGET_DEFAULT,
  ADAPTIVE_N_SAMPLES_FLOOR,
} from '../src/config/sampling.js';

// ---------------------------------------------------------------------------
// Unit tests — applyComplexityBudget
// ---------------------------------------------------------------------------

describe('applyComplexityBudget (unit)', () => {
  it('leaves depth unchanged when complexity is within the ISL budget', () => {
    // 4000 × 3 × 2 = 24,000 ≪ 10,000,000
    const d = applyComplexityBudget(4000, 3, 2);
    expect(d.kind).toBe('unchanged');
    if (d.kind === 'unchanged') expect(d.nSamples).toBe(4000);
  });

  it('allows complexity exactly at the budget (ISL blocks only strictly above the limit)', () => {
    // 1000 × 100 × 100 = 10,000,000 == budget → allowed, unchanged
    const d = applyComplexityBudget(1000, 100, 100);
    expect(d.kind).toBe('unchanged');
  });

  it('reduces depth to floor(budget / (nodes × edges)) when over budget', () => {
    // 4000 × 52 × 51 = 10,608,000 > 10,000,000
    // floor(10,000,000 / 2,652) = 3,770 → 3,770 × 2,652 = 9,998,040 ≤ budget
    const d = applyComplexityBudget(4000, 52, 51);
    expect(d.kind).toBe('reduced');
    if (d.kind === 'reduced') {
      expect(d.nSamples).toBe(3770);
      expect(d.originalNSamples).toBe(4000);
      expect(d.nSamples * 52 * 51).toBeLessThanOrEqual(ISL_COMPLEXITY_BUDGET_DEFAULT);
      // One more sample would breach the budget — maximal honest depth.
      expect((d.nSamples + 1) * 52 * 51).toBeGreaterThan(ISL_COMPLEXITY_BUDGET_DEFAULT);
    }
  });

  it('reduces to exactly the 1,000-sample floor when that is what fits', () => {
    // nodes × edges = 10,000 → floor(10,000,000 / 10,000) = 1,000 == floor
    const d = applyComplexityBudget(4000, 100, 100);
    expect(d.kind).toBe('reduced');
    if (d.kind === 'reduced') expect(d.nSamples).toBe(ADAPTIVE_N_SAMPLES_FLOOR);
  });

  it('refuses when even the 1,000-sample floor exceeds the budget', () => {
    // nodes × edges = 10,302 → floor(10,000,000 / 10,302) = 970 < 1,000
    const d = applyComplexityBudget(4000, 102, 101);
    expect(d.kind).toBe('refused');
  });

  it('respects an explicit low depth that already fits (no raise, no reduction)', () => {
    // 500 × 100 × 150 = 7,500,000 ≤ budget — even though nodes × edges > 10,000
    // would refuse AT the floor, the caller's smaller explicit depth fits as-is.
    const d = applyComplexityBudget(500, 100, 150);
    expect(d.kind).toBe('unchanged');
    if (d.kind === 'unchanged') expect(d.nSamples).toBe(500);
  });

  it('refuses an explicit depth whose graph cannot fit even at the floor', () => {
    // 1500 × 102 × 101 = 15,453,000 > budget; fitting depth 970 < floor → refuse
    const d = applyComplexityBudget(1500, 102, 101);
    expect(d.kind).toBe('refused');
  });

  it('treats a zero node/edge product as unchanged (nothing to bound)', () => {
    const d = applyComplexityBudget(4000, 5, 0);
    expect(d.kind).toBe('unchanged');
  });

  it('honours the ISL_MAX_COMPUTE_COMPLEXITY env override at call time', () => {
    const prev = process.env.ISL_MAX_COMPUTE_COMPLEXITY;
    try {
      process.env.ISL_MAX_COMPUTE_COMPLEXITY = '20000000';
      expect(resolveComplexityBudget()).toBe(20_000_000);
      // 4000 × 52 × 51 = 10,608,000 ≤ 20,000,000 → unchanged under the raised budget
      expect(applyComplexityBudget(4000, 52, 51).kind).toBe('unchanged');
    } finally {
      if (prev === undefined) delete process.env.ISL_MAX_COMPUTE_COMPLEXITY;
      else process.env.ISL_MAX_COMPUTE_COMPLEXITY = prev;
    }
  });
});

// ---------------------------------------------------------------------------
// Route-level tests: /v2/run with a mocked ISL service
// (harness mirrors tests/duplicate-edge-preflight.test.ts)
// ---------------------------------------------------------------------------

/**
 * Every ISL call body, in order. The BASE analysis call is always first;
 * flip-threshold probes (their own decoupled depth) follow it — so base-call
 * assertions must read islCalls[0], never the last call.
 */
let islCalls: any[] = [];

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
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    islCalls.push(body);
    const options = body.options || [];
    return {
      data: {
        analysis_status: 'computed',
        options: options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: { mean: 0.6 + idx * 0.1, std: 0.05, p10: 0.4, p50: 0.6, p90: 0.8, n_samples: 100, n_valid_samples: 100, validity_ratio: 1.0 },
          win_probability: idx === 0 ? 0.7 : 0.3,
          status: 'computed',
        })),
        factor_sensitivity: [],
        robustness: { confidence: 0.8, level: 'high', is_robust: true, fragile_edges: [], robust_edges: [] },
        inference_warnings: [],
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

/**
 * Build a fully-connected star graph: `factorCount` factors, each with a
 * directed edge into a single goal node. Causal size seen by ISL:
 * (factorCount + 1) nodes × factorCount edges.
 * Small strength means keep the inbound-strength-sum warning quiet.
 */
function starGraph(factorCount: number) {
  const factors = Array.from({ length: factorCount }, (_, i) => ({
    id: `factor-${i}`,
    kind: 'factor',
    label: `Factor ${i}`,
    observed_state: { value: 0.5 },
  }));
  const goal = { id: 'goal', kind: 'goal', label: 'Goal' };
  const edges = factors.map((f) => ({
    from: f.id,
    to: 'goal',
    exists_probability: 0.8,
    strength: { mean: 0.005, std: 0.01 },
  }));
  return { nodes: [...factors, goal], edges };
}

const OPTIONS = [
  { id: 'opt-a', label: 'Option A', interventions: { 'factor-0': { value: 0.8, source: 'user_specified' } } },
  { id: 'opt-b', label: 'Option B', interventions: { 'factor-1': { value: 0.7, source: 'user_specified' } } },
];

function findSamplesReducedWarnings(body: any): any[] {
  return (body.inference_warnings ?? []).filter(
    (w: any) => w.code === 'SAMPLES_REDUCED_FOR_COMPLEXITY',
  );
}

describe('adaptive n_samples via /v2/run', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    delete process.env.STANDARD_N_SAMPLES;
    delete process.env.ISL_MAX_COMPUTE_COMPLEXITY;
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('dense graph: reduces n_samples before calling ISL and attaches SAMPLES_REDUCED_FOR_COMPLEXITY naming original and reduced depths', async () => {
    islCalls = [];
    // 51 factors + goal = 52 nodes, 51 edges → 4000 × 2652 = 10,608,000 > 10M
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        graph: starGraph(51),
        options: OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
      },
    });

    expect(res.statusCode).toBe(200);

    // ISL received the reduced depth — floor(10,000,000 / (52 × 51)) = 3,770
    expect(islCalls.length).toBeGreaterThan(0);
    expect(islCalls[0].graph.nodes).toHaveLength(52);
    expect(islCalls[0].graph.edges).toHaveLength(51);
    expect(islCalls[0].n_samples).toBe(3770);
    // No ISL call of any kind (base or probe) may breach the budget.
    for (const call of islCalls) {
      expect(call.n_samples * call.graph.nodes.length * call.graph.edges.length)
        .toBeLessThanOrEqual(ISL_COMPLEXITY_BUDGET_DEFAULT);
    }

    const body = JSON.parse(res.body);
    // The response reports the TRUE depth used, not the requested default.
    expect(body.meta?.n_samples).toBe(3770);

    // Exactly one warning, carried on the inference_warnings surface
    // (the CONSTRAINT_DIRECTION_SUSPECT pattern), naming both depths.
    const warnings = findSamplesReducedWarnings(body);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warning');
    expect(warnings[0].message).toContain('4000');
    expect(warnings[0].message).toContain('3770');
  });

  it('ultra-dense graph: refuses with GRAPH_TOO_COMPLEX before calling ISL — never a raw ISL 422 passthrough', async () => {
    islCalls = [];
    // 101 factors + goal = 102 nodes, 101 edges → 10,302 > 10,000: even
    // 1,000 samples would breach the budget (1,000 × 10,302 = 10,302,000).
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        graph: starGraph(101),
        options: OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
      },
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.analysis_status).toBe('blocked');
    const critique = (body.critiques ?? []).find((c: any) => c.code === 'GRAPH_TOO_COMPLEX');
    expect(critique).toBeDefined();
    expect(critique.severity).toBe('blocker');
    expect(critique.blocks_analysis).toBe(true);
    // Actionable: names the causal size and the budget so the caller can act.
    expect(critique.message).toMatch(/102/);
    expect(critique.message).toMatch(/101/);

    // ISL was NEVER called — the refusal is PLoT-originated, not a passthrough.
    expect(islCalls).toHaveLength(0);
  });

  it('normal graph: default depth passes through untouched with no reduction warning', async () => {
    islCalls = [];
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        graph: starGraph(2), // 3 nodes × 2 edges → 4000 × 6 = 24,000
        options: OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(islCalls[0].n_samples).toBe(4000);
    const body = JSON.parse(res.body);
    expect(body.meta?.n_samples).toBe(4000);
    expect(findSamplesReducedWarnings(body)).toHaveLength(0);
  });

  it('explicit caller n_samples over budget is reduced with the warning — not silently overridden', async () => {
    islCalls = [];
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        graph: starGraph(51), // 52 × 51 = 2,652 → floor(10M / 2,652) = 3,770
        options: OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
        n_samples: 8000,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(islCalls[0].n_samples).toBe(3770);
    const body = JSON.parse(res.body);
    expect(body.meta?.n_samples).toBe(3770);
    const warnings = findSamplesReducedWarnings(body);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('8000');
    expect(warnings[0].message).toContain('3770');
  });

  it('explicit caller n_samples within budget is respected exactly, with no warning', async () => {
    islCalls = [];
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        graph: starGraph(2),
        options: OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
        n_samples: 8000,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(islCalls[0].n_samples).toBe(8000);
    const body = JSON.parse(res.body);
    expect(body.meta?.n_samples).toBe(8000);
    expect(findSamplesReducedWarnings(body)).toHaveLength(0);
  });
});
