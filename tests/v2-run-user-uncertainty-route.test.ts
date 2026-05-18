/**
 * Route-level integration test for user-supplied uncertainty propagation.
 *
 * Pins the production path: a `/v2/run` request with `observed_state.std = 0.001`
 * on a factor node must result in `parameter_uncertainties[].std = 0.001` in the
 * outbound ISL request body. Complements the direct-translator boundary tests
 * by exercising the full route pipeline (normalisation, route handler, translator,
 * Phase 4b+ injection).
 *
 * Uses vi.mock to intercept the ISL service and capture the request body,
 * mirroring the established pattern in tests/golden/constraint-pipeline.integration.test.ts
 * and tests/cil-constraint-auto-pu.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// ISL mock — captures the outbound request body for assertion
// ---------------------------------------------------------------------------

let capturedISLRequestBody: any = null;

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
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return {
      options: options.map((opt: any, idx: number) => ({
        option_id: opt.id,
        outcome: { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
        rank: idx + 1,
      })),
      edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factors: [], value_of_information: [],
      factors_provenance: 'unavailable' as const,
      factor_sensitivity_status: 'skipped_no_factor_values' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.8,
      fragile_edges: [], robust_edges: [], latency_ms: 50, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    capturedISLRequestBody = body;
    const options = body.options || [];
    return {
      data: {
        options: options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
          rank: idx + 1,
        })),
        edges: [], factors: [], value_of_information: [],
        overall_robustness: 'robust', robustness_score: 0.8,
        fragile_edges: [], robust_edges: [],
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('/v2/run — user-supplied observed_state.std propagates to ISL', () => {
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
    capturedISLRequestBody = null;
  });

  it('observed_state.std = 0.001 on a factor reaches ISL parameter_uncertainties as 0.001', async () => {
    capturedISLRequestBody = null;

    const payload = {
      graph: {
        nodes: [
          { id: 'goal', kind: 'goal', label: 'Revenue' },
          {
            id: 'fac_task_coverage',
            kind: 'factor',
            label: 'Task Coverage',
            observed_state: { value: 0.6, std: 0.001 },
          },
          {
            id: 'fac_team_structure',
            kind: 'factor',
            label: 'Team Structure',
            observed_state: { value: 0.4, std: 0.003 },
          },
        ],
        edges: [
          { from: 'fac_task_coverage', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
          { from: 'fac_team_structure', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
        ],
      },
      options: [
        { id: 'opt1', label: 'A', interventions: { 'fac_task_coverage': 0.7 } },
        { id: 'opt2', label: 'B', interventions: { 'fac_team_structure': 0.5 } },
      ],
      goal_node_id: 'goal',
      seed: '42',
    };

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    expect(capturedISLRequestBody).not.toBeNull();

    const pus = capturedISLRequestBody.parameter_uncertainties ?? [];
    const tc = pus.find((p: any) => p.node_id === 'fac_task_coverage');
    const ts = pus.find((p: any) => p.node_id === 'fac_team_structure');

    expect(tc).toBeDefined();
    expect(ts).toBeDefined();

    // The fix: small user-supplied stds must propagate through the full
    // /v2/run pipeline (normalisation → route → translator → Phase 4b+)
    // to the outbound ISL request body unchanged.
    expect(tc!.std).toBe(0.001);
    expect(ts!.std).toBe(0.003);
  });
});
