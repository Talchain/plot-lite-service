/**
 * Lane A1 — intervention_override sensitivity preservation at the /v2/run egress.
 *
 * RED-before / GREEN-after at the PUBLIC PLoT egress boundary. ISL marks the
 * three intervention-controlled levers (fac_leadership_capacity, fac_dev_capacity,
 * fac_hiring_cost) as sensitivity_score:0 + zero_reason:'intervention_override'.
 * Those factors are ALSO graph factors (they have causal paths to the goal), so
 * they flow through the graph+ISL merge. PLoT must preserve the ISL semantics on
 * the public factor_sensitivity rather than overwriting them with graph-derived
 * sensitivity.
 *
 *   RED  (pre-fix): public levers egress with non-zero graph sensitivity,
 *                   source:'graph', zero_reason:null → the lever assertions FAIL.
 *   GREEN (post-fix): public levers egress with sensitivity_score:0 +
 *                   zero_reason:'intervention_override'; non-levers and
 *                   influence_score (graph structural importance) unchanged.
 *
 * Fixture provenance: shared active Supabase project etmmuzwxtcjipwphdola,
 * v5_handler_facts fact b451605e-c1f5-4585-a563-8280c523b208 (scenario
 * c5eeee8a, run_analysis turn 313456e4, raw ISL request 77b2891a). The raw ISL
 * factor_sensitivity is loaded verbatim from the extracted fixture and fed
 * through the mocked ISL service exactly as ISL returned it.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'lane-a1', 'isl-factor-sensitivity-77b2891a.json'), 'utf8'),
);
// Raw ISL factor_sensitivity, verbatim (node_id-keyed, levers carry
// sensitivity_score:0 + zero_reason:'intervention_override').
const RAW_ISL_FACTOR_SENSITIVITY = fixture.factor_sensitivity as any[];

// Graph where every ISL factor is also a graph factor (direct causal path to the
// goal), so computeFactorSensitivityFromGraph yields them and the graph+ISL merge
// path fires (the production code path for this scenario).
const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Deliver Productive, Quality Launch Within Budget' },
    { id: 'fac_leadership_capacity', kind: 'factor', label: 'Technical Leadership Capacity', observed_state: { value: 0.6 } },
    { id: 'fac_dev_capacity', kind: 'factor', label: 'Additional Developer Capacity', observed_state: { value: 0.5 } },
    { id: 'fac_hiring_cost', kind: 'factor', label: 'Annual Hiring Cost', observed_state: { value: 0.4 } },
    { id: 'fac_time_pressure', kind: 'factor', label: 'Launch Deadline Pressure', observed_state: { value: 0.5 } },
    { id: 'fac_team_size', kind: 'factor', label: 'Existing Team Size', observed_state: { value: 0.5 } },
  ],
  edges: [
    { from: 'fac_leadership_capacity', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
    { from: 'fac_dev_capacity', to: 'goal', exists_probability: 0.85, strength: { mean: 0.5, std: 0.1 } },
    { from: 'fac_hiring_cost', to: 'goal', exists_probability: 0.8, strength: { mean: -0.4, std: 0.1 } },
    { from: 'fac_time_pressure', to: 'goal', exists_probability: 0.8, strength: { mean: -0.5, std: 0.1 } },
    { from: 'fac_team_size', to: 'goal', exists_probability: 0.7, strength: { mean: 0.3, std: 0.1 } },
  ],
};

// Both options pin the three levers (option-controlled), matching the production
// scenario where these factors are intervention_override.
const OPTIONS = [
  {
    id: 'opt_hire', label: 'Hire leadership + devs',
    interventions: {
      fac_leadership_capacity: { value: 1, source: 'user_specified' },
      fac_dev_capacity: { value: 1, source: 'user_specified' },
      fac_hiring_cost: { value: 1, source: 'user_specified' },
    },
  },
  {
    id: 'opt_hold', label: 'Hold current team',
    interventions: {
      fac_leadership_capacity: { value: 0, source: 'user_specified' },
      fac_dev_capacity: { value: 0, source: 'user_specified' },
      fac_hiring_cost: { value: 0, source: 'user_specified' },
    },
  },
];

function mockOptions(options: any[]) {
  return options.map((opt: any, idx: number) => ({
    option_id: opt.id,
    outcome: { mean: 0.7 - idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
    rank: idx + 1,
    win_probability: idx === 0 ? 0.62 : 0.38,
  }));
}

// ISL mock returns the verbatim raw ISL factor_sensitivity (with the three
// intervention_override levers). run.ts consumes factor_sensitivity via
// callAnalysisEndpoint; analyseRobustness is mocked for completeness.
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
    return {
      options: mockOptions(options),
      edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const, edge_sensitivity_status: 'available' as const,
      factor_sensitivity: RAW_ISL_FACTOR_SENSITIVITY,
      factors: [], value_of_information: [], factors_provenance: 'isl:/api/v1/robustness/analyze/v2' as const, factor_sensitivity_status: 'available' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.8, fragile_edges: [], robust_edges: [], latency_ms: 50, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    const options = body.options || [];
    return {
      data: {
        options: mockOptions(options),
        edges: [],
        factor_sensitivity: RAW_ISL_FACTOR_SENSITIVITY,
        overall_robustness: 'robust', robustness_score: 0.8, fragile_edges: [], robust_edges: [],
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

describe('Lane A1 — /v2/run egress preserves intervention_override lever sensitivity', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  const LEVERS = ['fac_leadership_capacity', 'fac_dev_capacity', 'fac_hiring_cost'];
  const NON_LEVERS = ['fac_time_pressure', 'fac_team_size'];

  // Save/restore (not delete) so an ambient value — e.g. under CI — is preserved
  // and we don't leak an env change to other tests sharing the worker.
  const ENV_KEYS = ['RATE_LIMIT_ENABLED', 'CEE_ORCHESTRATOR_ENABLED'] as const;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app?.close();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('levers egress sensitivity_score:0 + zero_reason:intervention_override; non-levers + influence_score unchanged', async () => {
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: '42' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const factors = body.factor_sensitivity;
    expect(Array.isArray(factors)).toBe(true);

    // All five factors flow through the graph+ISL merge (source 'graph').
    for (const id of [...LEVERS, ...NON_LEVERS]) {
      const f = factors.find((x: any) => x.factor_id === id);
      expect(f, `factor ${id} present in egress`).toBeDefined();
      expect(f.source).toBe('graph');
      // Graph structural importance is retained (influence_score is graph-derived).
      expect(typeof f.influence_score).toBe('number');
    }

    // GREEN-after (RED pre-fix): intervention levers are NOT exposed as tunable.
    for (const id of LEVERS) {
      const f = factors.find((x: any) => x.factor_id === id);
      expect(f.sensitivity_score, `${id} sensitivity_score`).toBe(0);
      expect(f.zero_reason, `${id} zero_reason`).toBe('intervention_override');
      // influence_score (graph) is non-zero for these connected factors and is
      // preserved by the fix — the lever keeps its structural importance.
      expect(f.influence_score).toBeGreaterThan(0);
    }

    // Non-levers keep graph-derived non-zero sensitivity and no override reason.
    for (const id of NON_LEVERS) {
      const f = factors.find((x: any) => x.factor_id === id);
      expect(f.sensitivity_score).not.toBe(0);
      expect(f.zero_reason ?? null).not.toBe('intervention_override');
    }
  });
});
