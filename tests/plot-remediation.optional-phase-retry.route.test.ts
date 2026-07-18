/**
 * F9 + F3 (Codex) — the OPTIONAL ISL phases pass maxRetries = 1 at the route.
 *
 * Structural capture (mirror of tests/plot-remediation.base-call-budget.route.test.ts):
 * a mock islService records the per-call (endpoint, requestId, timeoutMs,
 * maxRetries) for every callAnalysisEndpoint. We then assert:
 *   • F9 — the threshold call (/api/v1/analysis/thresholds) passes maxRetries = 1.
 *   • F3 — every flip-probe call (requestId contains '__flip') passes maxRetries = 1.
 *
 * RED against the pre-fix code: both call sites OMITTED maxRetries (undefined →
 * config default 3). See the mutation transcript. The flip-triggering graph is
 * taken from tests/lane2-flip-block-disclosure.test.ts (two factors, each
 * intervened by a different option → both stay flip candidates → probes run).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const THRESHOLDS_ENDPOINT = '/api/v1/analysis/thresholds';

interface Capture { endpoint: string; requestId: string; timeoutMs?: number; maxRetries?: number }
const captured: Capture[] = [];

function optionComparison(options: any[]) {
  return (options ?? []).map((opt: any, idx: number) => ({
    option_id: opt.id ?? opt.option_id,
    win_probability: 0.6 - idx * 0.2,
    outcome: { mean: 0.65 + idx * 0.12, std: 0.08, p10: 0.45, p50: 0.65, p90: 0.85, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
    rank: idx + 1,
  }));
}

function robustnessData(options: any[]) {
  return {
    options: optionComparison(options),
    edges: [
      { from: 'factor-a', to: 'goal', sensitivity: 0.5, confidence: 0.8, direction: 'positive' },
      { from: 'factor-b', to: 'goal', sensitivity: -0.3, confidence: 0.7, direction: 'negative' },
    ],
    factors: [
      { node_id: 'factor-a', sensitivity: 0.5, confidence: 0.8, direction: 'positive' },
      { node_id: 'factor-b', sensitivity: -0.3, confidence: 0.7, direction: 'negative' },
    ],
    value_of_information: [],
    overall_robustness: 'robust', robustness_score: 0.82,
    fragile_edges: [], robust_edges: [],
  };
}

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return { status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [], explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl' };
  },
  async analyseSensitivity() { return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' }; },
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return { ...robustnessData(options), edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const, edge_sensitivity_status: 'available' as const, factors_provenance: 'isl:/api/v1/robustness/analyze/v2' as const, factor_sensitivity_status: 'available' as const, latency_ms: 42, source: 'isl' as const };
  },
  async analyseFactorSensitivity() { return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.82, latency_ms: 0, source: 'unavailable' as const }; },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(endpoint: string, body: any, requestId: string, timeoutMs?: number, maxRetries?: number, _signal?: AbortSignal): Promise<{ data: T | null; error: string | null }> {
    captured.push({ endpoint, requestId, timeoutMs, maxRetries });
    if (endpoint === THRESHOLDS_ENDPOINT) {
      return { data: { thresholds: [] } as T, error: null };
    }
    return { data: robustnessData(body?.options ?? []) as T, error: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, get islService() { return mockISLService; } };
});

import { createServer } from '../src/createServer.js';

const PAYLOAD = {
  graph: {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Revenue' },
      { id: 'factor-a', kind: 'factor', label: 'Marketing Spend', observed_state: { value: 0.6 } },
      { id: 'factor-b', kind: 'factor', label: 'Customer Churn', observed_state: { value: 0.5 } },
    ],
    edges: [
      { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
      { from: 'factor-b', to: 'goal', strength: { mean: -0.3, std: 0.1 } },
    ],
  },
  options: [
    { id: 'opt1', label: 'Increase Marketing', interventions: { 'factor-a': 0.8 } },
    { id: 'opt2', label: 'Reduce Churn', interventions: { 'factor-b': 0.3 } },
  ],
  goal_node_id: 'goal',
  seed: '424242',
  include_thresholds: true,
};

describe('optional ISL phases pass maxRetries = 1 (F9 threshold, F3 flip probes)', () => {
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
  beforeEach(() => { captured.length = 0; });

  async function run() {
    const res = await app.inject({
      method: 'POST', url: '/v2/run',
      headers: { 'content-type': 'application/json' },
      payload: PAYLOAD,
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  it('F9 — the threshold call passes maxRetries = 1 (was undefined → default 3)', async () => {
    await run();
    const thresholdCall = captured.find((c) => c.endpoint === THRESHOLDS_ENDPOINT);
    expect(thresholdCall, 'threshold call was made').toBeDefined();
    expect(thresholdCall!.maxRetries).toBe(1);
    expect(typeof thresholdCall!.timeoutMs).toBe('number'); // still clamped to remaining budget
  });

  it('F3 — every flip-probe call passes maxRetries = 1 (was undefined → default 3)', async () => {
    await run();
    const flipProbes = captured.filter((c) => c.requestId.includes('__flip'));
    expect(flipProbes.length, 'flip probes ran').toBeGreaterThan(0);
    for (const probe of flipProbes) {
      expect(probe.maxRetries).toBe(1);
    }
  });
});
