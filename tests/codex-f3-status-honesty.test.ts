/**
 * Codex F3 — `partial` (→ `approximate: true`) must never mean "no usable options".
 *
 * determineTopLevelStatus's fallback returned 'partial' whenever any secondary
 * feature computed and none errored, even when option_comparison was unusable —
 * contradicting the documented rule that partial REQUIRES usable option
 * outcomes. Compounding it, the caller derived option usability from the stale
 * V1 field `expected_outcome` while V2 usability lives in the nested `outcome`
 * stats.
 *
 * RED scenario: ISL returns options that are present but carry NO usable
 * `outcome` stats, while robustness computed fine. The primary deliverable is
 * missing → analysis_status must be 'failed' (and `approximate` false — a
 * "usable but rough" badge over zero usable options inverts the truth).
 *
 * Positive control: options WITH usable outcomes + a degraded secondary
 * feature stays 'partial' (approximate true) — guards against over-rotating
 * every degradation to 'failed'.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

/** When true, mocked ISL options omit the nested `outcome` stats entirely. */
let mockOmitOutcomes = false;

function buildMockOption(opt: any, idx: number) {
  return {
    option_id: opt.id,
    ...(mockOmitOutcomes
      ? {}
      : {
          outcome: {
            mean: 0.7 - idx * 0.1,
            std: 0.1,
            p10: 0.5,
            p50: 0.7,
            p90: 0.9,
            n_samples: 1000,
            n_valid_samples: 1000,
            validity_ratio: 1.0,
          },
        }),
    rank: idx + 1,
    win_probability: 0.5,
    status: 'computed',
  };
}

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable',
      confidence: 'high',
      adjustment_sets: [],
      minimal_set: [],
      backdoor_paths: [],
      issues: [],
      explanation: { summary: 'Mock validation', reasoning: 'Test' },
      source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return {
      options: options.map(buildMockOption),
      edges: [],
      edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factors: [],
      value_of_information: [],
      factors_provenance: 'unavailable' as const,
      factor_sensitivity_status: 'skipped_no_factor_values' as const,
      overall_robustness: 'robust' as const,
      robustness_score: 0.8,
      fragile_edges: [],
      robust_edges: [],
      latency_ms: 50,
      source: 'isl' as const,
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
        options: options.map(buildMockOption),
        edges: [],
        factors: [],
        value_of_information: [],
        overall_robustness: 'robust',
        robustness_score: 0.8,
        // hasRobustness in run.ts reads the nested V2 shape: robustness.score /
        // robustness.confidence — this is what makes robustness_status 'computed'.
        robustness: { score: 0.8, confidence: 0.9 },
        fragile_edges: [],
        robust_edges: [],
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

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Goal', observed_state: { value: 0.4 } },
    { id: 'fac_a', kind: 'factor', label: 'Factor A', observed_state: { value: 0.4 } },
  ],
  edges: [{ from: 'fac_a', to: 'goal', strength: { mean: 0.5, std: 0.1 } }],
};

const OPTIONS = [
  { id: 'opt_1', label: 'One', interventions: { fac_a: 0.3 } },
  { id: 'opt_2', label: 'Two', interventions: { fac_a: 0.6 } },
];

describe('Codex F3: top-level status honesty when no option outcome is usable', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
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
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  beforeEach(() => {
    mockOmitOutcomes = false;
  });

  async function run(): Promise<any> {
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: '42' }),
    });
    expect(res.status).toBe(200);
    return res.json();
  }

  it('RED (mandated): options present but NO usable outcome stats + robustness computed → failed, approximate false', async () => {
    mockOmitOutcomes = true;
    const body = await run();

    expect(body.option_comparison_status).toBe('unavailable');
    expect(body.robustness_status).toBe('computed');
    // THE FINDING: this read 'partial' (→ approximate true) on unmodified code.
    expect(body.analysis_status).toBe('failed');
    expect(body.approximate).toBe(false);
  });

  it('POSITIVE CONTROL: usable outcomes on the same mock do NOT read failed', async () => {
    // Same ISL shape with outcomes restored: everything computes cleanly.
    // Guards against the fix over-rotating usable runs into 'failed'.
    // (The 'partial'-stays-'partial' case is pinned by
    // tests/b3-auto-noise-disclosure.test.ts and the Part 1.1 approximate pin
    // in tests/constraint-margin-plumbing.test.ts.)
    mockOmitOutcomes = false;
    const body = await run();

    expect(body.option_comparison_status).toBe('computed');
    expect(body.analysis_status).toBe('computed');
    expect(body.approximate).toBe(false);
  });
});
