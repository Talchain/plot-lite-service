/**
 * A3 remediation item 4 (2026-07-18) — the base /v2/run ISL robustness call must
 * not outlive the caller. Unclamped it was ISL_TIMEOUT_MS (60s) per attempt ×
 * ISL_MAX_RETRIES (3) ≈ 180s worst case, past the UI's 120s client timeout —
 * losing the WHOLE analysis.
 *
 * ⚠ RE-POINTED 2026-07-31 (ROADMAP 2.202). THE INVARIANT IS UNCHANGED; THE
 * MECHANISM THAT ENFORCES IT CHANGED, AND THIS FILE PINNED THE MECHANISM.
 *
 * As written, this file asserted `worstCaseMs(maxRetries, timeoutMs) <= 70_000`
 * on the attempt count the route passed up front. That is exactly the
 * duration-blind, worst-case accounting 2.202 removes: it priced a 133 ms ISL
 * 429 at a full 60 s per-attempt timeout, so the count resolved to 1, the
 * (correct) 429 retry was structurally unreachable, and /v2/run returned a
 * typed-failure envelope with ~69.8 s of budget unspent — the HTTP 500 the
 * tester saw (diagnosis-run-analysis-500s.md §4).
 *
 * Left unchanged this file would have gone RED against its own fix while
 * appearing to defend it — the mutant the diagnosis warned about for ISL's
 * fix ② ("re-point it in the same change or it blocks the fix"). So it is
 * re-pointed to the NEW enforcement, which is strictly stronger because it is
 * checked at runtime against the live budget rather than by static arithmetic:
 *
 *   • the route still passes a per-attempt timeout clamped to the budget;
 *   • the route now also passes a `budget`, never larger than the request
 *     budget, and the client starts an attempt only when its FULL per-attempt
 *     timeout still fits — so the base call still cannot outlive the caller;
 *   • ONE attempt's worst case still fits the budget and the UI's 120s.
 *
 * The wall-clock proof that the runtime bound actually bites (a slow failure
 * gets no retry; total never exceeds the budget) is in
 * tests/plot-2202-isl-retry-after.client.test.ts, which drives the real client.
 *
 * Harness modelled on tests/lane3-stability-bands-carrythrough.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ISL_TIMEOUT_MS, worstCaseMs } from '../src/config/timeouts.js';

const BASE_ROBUSTNESS_ENDPOINT = '/api/v1/robustness/analyze/v2';
const UI_CLIENT_TIMEOUT_MS = 120_000; // the binding caller hop

// Records the per-call (timeoutMs, maxRetries, budget) for the base robustness call.
interface Budget { remainingMs: number; safetyMarginMs?: number }
const captured: Array<{ endpoint: string; timeoutMs?: number; maxRetries?: number; budget?: Budget }> = [];

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
  async callAnalysisEndpoint<T>(endpoint: string, _body: unknown, _requestId: string, timeoutMs?: number, maxRetries?: number, _signal?: AbortSignal, budget?: Budget): Promise<{ data: T | null; error: string | null }> {
    captured.push({ endpoint, timeoutMs, maxRetries, budget });
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

  it('ONE attempt still fits the budget and the UI 120s timeout', async () => {
    delete process.env.REQUEST_BUDGET_MS; // default 70s
    await run();
    const c = baseCall();
    // Honest accounting (F11): worstCaseMs includes the backoff slept BETWEEN
    // attempts. For a single attempt that is just the per-attempt timeout — the
    // only total that is guaranteed up front now that further attempts are
    // gated on the LIVE budget (2.202) rather than counted in advance.
    const singleAttempt = worstCaseMs(1, c.timeoutMs!);
    // Pre-clamp this was the unclamped 60s default against whatever remained.
    expect(singleAttempt).toBeLessThan(UI_CLIENT_TIMEOUT_MS);
    expect(singleAttempt).toBeLessThanOrEqual(70_000);
  });

  it('⭐ 2.202 — the route hands the client the budget that actually remains', async () => {
    // The replacement for the up-front worst-case attempt count. Without this
    // the client falls back to count-only bounding and the 429 retry is
    // unreachable again — the exact defect 2.202 removes.
    delete process.env.REQUEST_BUDGET_MS; // default 70s
    await run();
    const c = baseCall();
    expect(c.budget, 'base call must receive a retry budget').toBeDefined();
    expect(typeof c.budget!.remainingMs).toBe('number');
    expect(Number.isFinite(c.budget!.remainingMs)).toBe(true);
    // Derived from the request budget, never invented: it is what is LEFT of the
    // 70s default after the work already done, so ≤ 70s and > 0.
    expect(c.budget!.remainingMs).toBeGreaterThan(0);
    expect(c.budget!.remainingMs).toBeLessThanOrEqual(70_000);
    // A reserve is kept unspent so the route can still build its response.
    expect(c.budget!.safetyMarginMs).toBeGreaterThan(0);
    // And one full attempt plus the margin fits inside it — the invariant that
    // makes overrunning the caller impossible by construction.
    expect(c.timeoutMs! + c.budget!.safetyMarginMs!).toBeLessThanOrEqual(c.budget!.remainingMs);
  });

  it('a tighter runtime budget clamps harder (mirror of the flip-block clamp)', async () => {
    process.env.REQUEST_BUDGET_MS = '30000';
    await run();
    const c = baseCall();
    expect(c.timeoutMs!).toBeLessThanOrEqual(30_000);
    expect(worstCaseMs(1, c.timeoutMs!)).toBeLessThanOrEqual(30_000);
    expect(worstCaseMs(1, c.timeoutMs!)).toBeLessThan(UI_CLIENT_TIMEOUT_MS);
    // The budget the client is given shrinks with it — so the retry bound
    // tracks the real budget rather than a value fixed at the default.
    expect(c.budget!.remainingMs).toBeLessThanOrEqual(30_000);
    delete process.env.REQUEST_BUDGET_MS;
  });
});
