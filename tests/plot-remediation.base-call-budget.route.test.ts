/**
 * A3 remediation item 4 (2026-07-18) — the base /v2/run ISL robustness call is
 * clamped to the remaining request budget so its retries cannot outlive the
 * caller. Unclamped it was ISL_TIMEOUT_MS (60s) per attempt × ISL_MAX_RETRIES
 * (3) ≈ 180s worst case, past the UI's 120s client timeout — losing the WHOLE
 * analysis. This test captures the (timeoutMs, maxRetries) the route passes to
 * callAnalysisEndpoint for the base robustness endpoint and asserts the
 * worst-case total (maxRetries × per-attempt timeout) is bounded.
 *
 * RED against the pre-fix code: the base call passed NO timeoutMs/maxRetries
 * (undefined → config default 60s × 3 = 180s worst case). See mutation transcript.
 *
 * Harness modelled on tests/lane3-stability-bands-carrythrough.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ISL_TIMEOUT_MS, worstCaseMs } from '../src/config/timeouts.js';

const BASE_ROBUSTNESS_ENDPOINT = '/api/v1/robustness/analyze/v2';
const UI_CLIENT_TIMEOUT_MS = 120_000; // the binding caller hop

// Records the per-call (timeoutMs, maxRetries) for the base robustness call.
const captured: Array<{ endpoint: string; timeoutMs?: number; maxRetries?: number }> = [];

const ISL_DATA = {
  options: [
    { option_id: 'opt1', outcome: { mean: 0.8, std: 0.1, p10: 0.6, p50: 0.8, p90: 0.95, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 }, rank: 1, win_probability: 0.7, probability_of_goal: 0.65 },
    { option_id: 'opt2', outcome: { mean: 0.7, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 }, rank: 2, win_probability: 0.3, probability_of_goal: 0.55 },
  ],
  factor_sensitivity: [],
  robustness: { score: 0.82, label: 'robust', fragile_edges: [], robust_edges: [], edge_e_values: [] },
};

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return { status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [], explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl' };
  },
  async analyseSensitivity() { return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' }; },
  async analyseRobustness() { return { ...ISL_DATA, source: 'isl' as const, latency_ms: 42 }; },
  async analyseFactorSensitivity() { return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.82, latency_ms: 0, source: 'unavailable' as const }; },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(endpoint: string, _body: unknown, _requestId: string, timeoutMs?: number, maxRetries?: number): Promise<{ data: T | null; error: string | null }> {
    captured.push({ endpoint, timeoutMs, maxRetries });
    return { data: ISL_DATA as T, error: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, get islService() { return mockISLService; } };
});

import { createServer } from '../src/createServer.js';

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'factor-a', kind: 'factor', label: 'Marketing', observed_state: { value: 0.6 } },
  ],
  edges: [{ from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } }],
};
const OPTIONS = [
  { id: 'opt1', label: 'A', interventions: { 'factor-a': 0.8 } },
  { id: 'opt2', label: 'B', interventions: { 'factor-a': 0.3 } },
];

describe('item 4 — base ISL robustness call clamped to the request budget', () => {
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
    delete process.env.REQUEST_BUDGET_MS;
  });
  beforeEach(() => { captured.length = 0; });

  async function run() {
    const res = await app.inject({
      method: 'POST', url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({ graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: 'item4' }),
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body);
  }

  function baseCall() {
    const c = captured.find((x) => x.endpoint === BASE_ROBUSTNESS_ENDPOINT);
    expect(c, 'base robustness call was made').toBeDefined();
    return c!;
  }

  it('passes a finite per-attempt timeout AND a retry cap (not the unclamped defaults)', async () => {
    delete process.env.REQUEST_BUDGET_MS; // default 70s
    await run();
    const c = baseCall();
    expect(typeof c.timeoutMs).toBe('number');
    expect(Number.isFinite(c.timeoutMs)).toBe(true);
    expect(typeof c.maxRetries).toBe('number');
    expect(c.timeoutMs!).toBeLessThanOrEqual(ISL_TIMEOUT_MS);
    expect(c.maxRetries!).toBeGreaterThanOrEqual(1);
  });

  it('worst-case total (maxRetries × per-attempt) is under the UI 120s timeout at the default budget', async () => {
    delete process.env.REQUEST_BUDGET_MS; // default 70s
    await run();
    const c = baseCall();
    // Honest accounting (F11): include the 1s+2s… backoff the client sleeps
    // between attempts — the previous `maxRetries × timeoutMs` omitted it and so
    // could not see the very omission this cluster fixes.
    const worstCase = worstCaseMs(c.maxRetries!, c.timeoutMs!);
    // Pre-fix worst case was 60_000 × 3 = 180_000 (> 120_000). Now bounded.
    expect(worstCase).toBeLessThan(UI_CLIENT_TIMEOUT_MS);
    // …and within the request budget envelope (70s default).
    expect(worstCase).toBeLessThanOrEqual(70_000);
  });

  it('a tighter runtime budget clamps harder (mirror of the flip-block clamp)', async () => {
    process.env.REQUEST_BUDGET_MS = '30000';
    await run();
    const c = baseCall();
    const worstCase = worstCaseMs(c.maxRetries!, c.timeoutMs!);
    expect(c.timeoutMs!).toBeLessThanOrEqual(30_000);
    expect(worstCase).toBeLessThanOrEqual(30_000);
    expect(worstCase).toBeLessThan(UI_CLIENT_TIMEOUT_MS);
    delete process.env.REQUEST_BUDGET_MS;
  });
});
