import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

let capturedISLRequestBody: any = null;
/** When false, the mock behaves like an ISL that silently drops the field (no echo). */
let islEchoesRanges = true;
/** The coverage the mock ISL echoes (ISL's RATIFIED_COVERAGE is 0.5). */
let islEchoCoverage = 0.5;

let PROB: Record<string, number> = { opt_liftshift: 0.628, opt_phased: 0.905, opt_booked: 0.0 };

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [],
      backdoor_paths: [], issues: [], explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl',
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
    capturedISLRequestBody = JSON.parse(JSON.stringify(body));
    const constraints = body.goal_constraints || [];
    return {
      data: {
        options: (body.options || []).map((opt: any, idx: number) => {
          const ranged = opt.intervention_ranges ? Object.entries(opt.intervention_ranges) : [];
          return {
            option_id: opt.id,
            outcome: { mean: 0.1 + idx * 0.02, std: 0.05, p10: 0.04, p50: 0.1, p90: 0.16, n_samples: 2000, n_valid_samples: 2000, validity_ratio: 1.0 },
            win_probability: 1 / (body.options.length || 1),
            rank: idx + 1,
            ...(islEchoesRanges && ranged.length > 0
              ? {
                  sampled_intervention_ranges: ranged.map(([nodeId, r]: [string, any]) => ({
                    node_id: nodeId, meaning: r.meaning, family: 'lognormal', coverage: islEchoCoverage, low: r.low, high: r.high,
                  })),
                }
              : {}),
            ...(constraints.length > 0
              ? {
                  constraint_analysis: {
                    joint_probability: PROB[opt.id] ?? 0.5,
                    constraints: constraints.map((c: any) => ({
                      constraint_id: c.constraint_id, node_id: c.node_id, operator: c.operator,
                      threshold: c.value, prob_satisfied: PROB[opt.id] ?? 0.5,
                    })),
                  },
                }
              : {}),
          };
        }),
        factor_sensitivity: [],
        robustness: { label: 'moderate', score: 0.6, fragile_edges: [], robust_edges: [] },
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

const { createServer } = await import('../src/createServer.js');
import fs from 'node:fs';
const PW = '/private/tmp/claude-502/-Users-paulslee-Documents-GitHub/b6344757-8e32-4ddc-8e84-77f3614373f5/scratchpad/prewitness';
describe('C5 replay: the served CEE→PLoT payload, as PLoT sends it to ISL', () => {
  it('captures the ISL request', async () => {
    process.env.RATE_LIMIT_ENABLED = '0'; process.env.CEE_ORCHESTRATOR_ENABLED = '0'; process.env.DECISION_REVIEW_ENABLE = '0'; process.env.ENABLE_REVIEW_PASS = '0';
    const app = await createServer(); await app.ready();
    const payload = JSON.parse(fs.readFileSync(`${PW}/plot-payload.json`, 'utf8')).payload;
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload });
    fs.writeFileSync(`${PW}/c5-plot-to-isl.json`, JSON.stringify(capturedISLRequestBody, null, 1));
    console.log('STATUS', res.statusCode, 'ISL_OPTIONS', JSON.stringify((capturedISLRequestBody?.options ?? []).map((o: any) => ({ id: o.id, interventions: o.interventions, intervention_ranges: o.intervention_ranges }))));
    console.log('ISL_KEYS', JSON.stringify(Object.keys(capturedISLRequestBody ?? {})), 'CONSTRAINTS', JSON.stringify(capturedISLRequestBody?.goal_constraints ?? null), 'THRESHOLD', JSON.stringify(capturedISLRequestBody?.goal_threshold ?? null));
    await app.close();
    expect(capturedISLRequestBody).not.toBeNull();
  }, 120_000);
});
