/**
 * A3 / Codex F5 (ruling A3-DOCTRINE-DECISIONS-2026-07-21 D-4): the top-level
 * constraint_results block is derived from the FIRST option carrying a non-empty
 * constraint_analysis. That first-option derivation was silent. This pins the
 * ADDITIVE `option_id` disclosure: each top-level constraint_result names the
 * option its probability was taken from.
 *
 * Discriminator: reversing the request options array yields a DIFFERENT disclosed
 * option_id (the first-option-with-constraints changed) while the per-option
 * constraint_probabilities maps are unchanged — this pins the DISCLOSURE, not the
 * first-option ambiguity itself (D-4 keeps the derivation, discloses it).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

let capturedISLRequest: any = null;

function evalConstraint(sample: number, threshold: number, operator: string): { sat: boolean; margin: number } {
  const sat = operator === '<=' ? sample <= threshold : sample >= threshold;
  const margin = operator === '<=' ? sample - threshold : threshold - sample;
  return { sat, margin };
}

function buildSurrogateOptions(body: any) {
  const constraints: any[] = body.goal_constraints ?? [];
  return (body.options ?? []).map((opt: any, idx: number) => {
    const analysis = constraints.length
      ? {
          constraints: constraints.map((c: any) => {
            const sample = opt.interventions?.[c.node_id];
            if (typeof sample !== 'number') {
              return { node_id: c.node_id, operator: c.operator, value: c.value, prob_satisfied: 1 };
            }
            const { sat, margin } = evalConstraint(sample, c.value, c.operator);
            return {
              node_id: c.node_id,
              operator: c.operator,
              value: c.value,
              prob_satisfied: sat ? 1 : 0,
              ...(sat ? {} : { failure_margin_median: Math.max(0, margin), near_miss_fraction: 0 }),
            };
          }),
          joint_probability: constraints.every((c: any) => {
            const s = opt.interventions?.[c.node_id];
            return typeof s !== 'number' || evalConstraint(s, c.value, c.operator).sat;
          })
            ? 1
            : 0,
        }
      : undefined;
    return {
      option_id: opt.id,
      outcome: { mean: 0.7 - idx * 0.05, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
      rank: idx + 1,
      win_probability: 0.5 - idx * 0.1,
      status: 'computed',
      ...(analysis !== undefined && { constraint_analysis: analysis }),
    };
  });
}

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return { status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [], explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl' };
  },
  async analyseSensitivity() { return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' }; },
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return {
      options: buildSurrogateOptions(capturedISLRequest ?? { options }),
      edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const, factors: [], value_of_information: [],
      factors_provenance: 'unavailable' as const, factor_sensitivity_status: 'skipped_no_factor_values' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.8, fragile_edges: [], robust_edges: [],
      latency_ms: 50, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() { return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const }; },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    capturedISLRequest = body;
    return {
      data: {
        options: buildSurrogateOptions(body),
        edges: [], factors: [], value_of_information: [], overall_robustness: 'robust', robustness_score: 0.8, fragile_edges: [], robust_edges: [],
      } as T,
      error: null,
    };
  },
};

vi.mock('../../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

const { createServer } = await import('../../src/createServer.js');

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Programme value', observed_state: { value: 0.4 } },
    { id: 'cost', kind: 'factor', label: 'First-year cost', observed_state: { value: 30000 } },
  ],
  edges: [{ from: 'cost', to: 'goal', strength: { mean: -0.5, std: 0.1 } }],
};
// Both options intervene cost out of [0,1] → both carry a constraint_analysis, so
// the "first option with constraints" is genuinely order-dependent.
const OPT_A = { id: 'opt_a', label: 'A', interventions: { cost: 25000 } };
const OPT_B = { id: 'opt_b', label: 'B', interventions: { cost: 45000 } };
const CONSTRAINTS = [{ constraint_id: 'c1', node_id: 'cost', operator: '<=', value: 30000 }];

function optionEntry(body: any, id: string): any {
  return (body.option_comparison ?? []).find((o: any) => o.option_id === id);
}

describe('A3/F5 · top-level constraint_results discloses its deriving option_id (D-4)', () => {
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
  }, 30000);
  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });
  beforeEach(() => { capturedISLRequest = null; });

  async function run(payload: object): Promise<any> {
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
    return res.json();
  }

  it('names the first-option-with-constraints, and reversing options flips it while per-option maps are unchanged', async () => {
    const forward = await run({
      graph: GRAPH, options: [OPT_A, OPT_B], goal_node_id: 'goal', seed: '42',
      goal_constraints: CONSTRAINTS,
    });
    const reversed = await run({
      graph: GRAPH, options: [OPT_B, OPT_A], goal_node_id: 'goal', seed: '42',
      goal_constraints: CONSTRAINTS,
    });

    const fwdCr = forward.constraint_results ?? [];
    const revCr = reversed.constraint_results ?? [];
    expect(fwdCr.length).toBeGreaterThan(0);
    expect(revCr.length).toBeGreaterThan(0);

    // Disclosure: the top-level block names the option it derives from — the
    // FIRST option carrying constraints. Forward ⇒ opt_a; reversed ⇒ opt_b.
    expect(fwdCr[0].option_id).toBe('opt_a');
    expect(revCr[0].option_id).toBe('opt_b');
    expect(fwdCr[0].option_id).not.toBe(revCr[0].option_id);

    // The DISCLOSURE moved; the per-option maps did NOT. opt_a's own
    // constraint_probabilities are identical regardless of array order (this pins
    // the disclosure, not the first-option ambiguity).
    expect(optionEntry(forward, 'opt_a').constraint_probabilities).toEqual(
      optionEntry(reversed, 'opt_a').constraint_probabilities,
    );
    expect(optionEntry(forward, 'opt_b').constraint_probabilities).toEqual(
      optionEntry(reversed, 'opt_b').constraint_probabilities,
    );
  });
});
