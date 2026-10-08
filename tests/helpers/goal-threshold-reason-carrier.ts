import { afterAll, beforeAll, expect, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Independent contract fixtures: do not derive expected reasons from the mapper.
export const REASONS = [
  'missing_goal_baseline',
  'root_goal',
  'goal_pinned_by_intervention',
  'goal_values_outside_normalised_domain',
  'non_finite_conversion_input',
  'epsilon_breaks_status_quo_reference',
  'auto_scaled_noise_breaks_status_quo_reference',
  'change_rel_raw_range_missing',
  'change_rel_base_zero',
  'goal_node_missing',
] as const;

export const CODE = 'GOAL_THRESHOLD_NOT_CONVERTIBLE';
export const MESSAGE = 'Goal threshold conversion refused.  Existing copy stays byte-identical.\n';
export interface WarningStub {
  code: string;
  severity: string;
  message?: string;
  detail?: Record<string, unknown>;
}

export function refusal(detail: Record<string, unknown> = {}): WarningStub {
  return { code: CODE, severity: 'warning', detail: { message: MESSAGE, ...detail } };
}

let sourceWarnings: WarningStub[] = [];
function islResponse() {
  return {
    options: [
      { option_id: 'opt1', outcome: { mean: 0.8, std: 0.1, p10: 0.6, p50: 0.8, p90: 0.95, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1 }, rank: 1, win_probability: 0.7 },
      { option_id: 'opt2', outcome: { mean: 0.7, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1 }, rank: 2, win_probability: 0.3 },
    ],
    factor_sensitivity: [],
    robustness: { score: 0.82, label: 'robust', fragile_edges: [], robust_edges: ['factor::goal'], edge_e_values: [] },
    inference_warnings: sourceWarnings,
  };
}

const mockISLService = {
  isEnabled: () => true,
  isAvailable: async () => true,
  validateCausal: async () => ({ status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [], explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl' }),
  analyseSensitivity: async () => ({ overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' }),
  analyseRobustness: async () => ({ ...islResponse(), source: 'isl', latency_ms: 1 }),
  analyseFactorSensitivity: async () => ({ factors: [], value_of_information: [], robustness_label: 'robust', robustness_score: 0.82, latency_ms: 0, source: 'unavailable' }),
  computeCounterfactual: async () => { throw new Error('not called'); },
  callAnalysisEndpoint: async () => ({ data: islResponse(), error: null }),
};

vi.mock('../../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, get islService() { return mockISLService; } };
});

import { createServer } from '../../src/createServer.js';

/** Real /v2/run egress, with the ISL response stub as the only upstream substitution. */
export function useGoalThresholdHarness() {
  let app: FastifyInstance;
  let events: object[] = [];
  const envKeys = ['RATE_LIMIT_ENABLED', 'CEE_ORCHESTRATOR_ENABLED'] as const;
  const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    app.addHook('onRequest', (request, _reply, done) => {
      const original = request.log.warn.bind(request.log);
      request.log.warn = ((obj: object, ...args: unknown[]) => {
        if ((obj as { event?: unknown })?.event === 'goal_threshold_not_convertible') events.push(obj);
        original(obj, ...args);
      }) as typeof request.log.warn;
      done();
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  });

  return async (warnings: WarningStub[]) => {
    sourceWarnings = warnings;
    events = [];
    const response = await app.inject({
      method: 'POST', url: '/v2/run',
      payload: {
        graph: {
          nodes: [
            { id: 'goal', kind: 'goal', label: 'Revenue' },
            { id: 'factor', kind: 'factor', label: 'Price', observed_state: { value: 0.6 } },
          ],
          edges: [{ from: 'factor', to: 'goal', strength: { mean: 0.5, std: 0.1 } }],
        },
        options: [
          { id: 'opt1', label: 'Raise price', interventions: { factor: 0.8 } },
          { id: 'opt2', label: 'Hold price', interventions: { factor: 0.3 } },
        ],
        goal_node_id: 'goal', goal_threshold: 0.9, seed: 'goal-reason-carrier',
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    return {
      body,
      warnings: body.inference_warnings.filter((warning: { code: string }) => warning.code === CODE),
      events,
    };
  };
}
