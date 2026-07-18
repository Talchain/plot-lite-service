/**
 * NIT 1 (post-#232 review) — EDGE_E_VALUE_NON_FINITE_DROPPED must attribute the
 * drop CAUSE accurately.
 *
 * Two distinct causes share the code:
 *  (a) UNFLIPPABLE / input-null: ISL sends e_value:null (current_mean==flip_mean,
 *      no evidence ratio) — a NORMAL, common case. It must NOT be described as a
 *      transformation overflow.
 *  (b) OVERFLOW: a finite value became non-finite AFTER range denormalisation
 *      (the pathological F14 case) — covered by the unit test in
 *      finite-range-overflow-guard.test.ts (unreachable via the route now that the
 *      range-source guard rejects overflow-width ranges).
 *
 * RED-first (this file, route level): an unflippable-null edge is dropped and the
 * wire disclosure names the INPUT/unflippable cause — it must NOT claim
 * "after transformation" / overflow. Pre-fix the single message misattributes it.
 * The dropped edge SET and drop BEHAVIOUR are unchanged — only the wording.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

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
    robust_edges: [],
    edge_e_values: [
      // UNFLIPPABLE: ISL sends e_value:null with current_mean == flip_mean.
      { edge_id: 'factor-a->goal', e_value: null, current_mean: 0.5, flip_mean: 0.5, flip_direction: 'increase' },
      // NORMAL: kept.
      { edge_id: 'factor-b->goal', e_value: 1.4, current_mean: 0.3, flip_mean: 0.5, flip_direction: 'increase' },
    ],
  },
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
  async callAnalysisEndpoint<T>(_endpoint: string, _body: unknown): Promise<{ data: T | null; error: string | null }> { return { data: ISL_DATA as T, error: null }; },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, get islService() { return mockISLService; } };
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

describe('NIT 1 — edge E-value drop cause attribution (unflippable input-null)', () => {
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
      method: 'POST', url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({ graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: 'nit1-drop-cause' }),
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body);
  }

  it('drops only the unflippable edge (behaviour unchanged) and discloses it', async () => {
    const body = await run();
    // The normal edge is kept; the unflippable one is dropped — SET unchanged.
    expect(body.edge_e_values.length).toBe(1);
    const w = (body.inference_warnings ?? []).find((x: { code: string }) => x.code === 'EDGE_E_VALUE_NON_FINITE_DROPPED');
    expect(w, 'drop disclosure present').toBeDefined();
    expect(w.severity).toBe('info');
  });

  it('names the UNFLIPPABLE/input cause, never a transformation overflow', async () => {
    const body = await run();
    const w = (body.inference_warnings ?? []).find((x: { code: string }) => x.code === 'EDGE_E_VALUE_NON_FINITE_DROPPED');
    const msg: string = w.message;
    // RED-first: pre-fix the single message says "non-finite after transformation".
    expect(msg.toLowerCase()).not.toContain('after transformation');
    expect(msg.toLowerCase()).not.toContain('denormalisation');
    expect(msg.toLowerCase()).not.toContain('overflow');
    // Accurate: the value simply had no finite E-value from the engine.
    expect(msg.toLowerCase()).toContain('unflippable');
    expect(msg).toContain('no finite E-value');
  });
});
