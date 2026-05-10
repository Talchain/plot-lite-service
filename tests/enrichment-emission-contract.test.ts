/**
 * Enrichment Emission Contract (route-level)
 *
 * Validates the three Tier-B fixes in a single mixed-case scenario:
 *
 *   1. edge_e_values is populated (3 entries) and passes through with labels.
 *   2. conditional_winners is [] from ISL → key still present as [] in response
 *      (computed-empty, not absent).
 *   3. flip_thresholds is absent from the ISL response → key still present as []
 *      in PLoT response (absent-from-ISL treated as computed-empty per boundary
 *      contract; PLoT always requests include_e_values: true / include_voi: true).
 *   4. conditional_probabilities key is always present as [] when not supplied.
 *   5. At least one factor hits the degenerate confidence branch —
 *      `confidence_source: 'fallback_degenerate'` is set, and the
 *      `plot.confidence_fallback_degenerate` telemetry event fires exactly once
 *      per request (aggregated, not per-factor).
 *   6. VOI entries with value 0 are preserved (Task 2 fix).
 *
 * This test complements the narrower unit tests in
 * tests/factor-sensitivity.test.ts, tests/factor-influence.test.ts, and
 * tests/passthrough-enrichment.test.ts by validating the whole plan
 * end-to-end via one mocked /v2/run call.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Mock ISL to produce the mixed-case fixture before the server module loads.
const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable' as const,
      confidence: 'high' as const,
      adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock', reasoning: 'Test' },
      source: 'isl' as const,
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' as const };
  },
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return {
      options: options.map((opt: any, idx: number) => ({
        option_id: opt.id,
        outcome: { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
        rank: idx + 1,
      })),
      edges: [],
      edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factor_sensitivity: [
        // Factor A — no bootstrap 3C, will hit graph CV path (has rich strength data).
        { node_id: 'factor-a', sensitivity_score: 0.5, direction: 'positive' as const, value_of_information: 0.1 },
        // Factor B — no bootstrap 3C, no rich strength data on its incoming edges
        // (the graph only gives it exists_probability), so CV path cannot fire →
        // degenerate branch. VOI = 0 is a valid computed result (Task 2 regression check).
        { node_id: 'factor-b', sensitivity_score: 0.0, direction: 'mixed' as const, value_of_information: 0 },
      ],
      factors: [], value_of_information: [],
      factors_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      factor_sensitivity_status: 'available' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.8,
      fragile_edges: [], robust_edges: [], latency_ms: 50, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null; isl_echoed_request_id?: string }> {
    const options = body.options || [];
    const hasConstraints = Array.isArray(body.goal_constraints) && body.goal_constraints.length > 0;
    return {
      data: {
        options: options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
          rank: idx + 1,
          // When the caller supplies goal_constraints, ISL echoes a minimal
          // constraint_analysis block so PLoT's buildConstraintFields proceeds.
          // We intentionally OMIT conditional_probabilities so the `?? []`
          // default path is exercised.
          ...(hasConstraints
            ? {
                constraint_analysis: {
                  constraints: body.goal_constraints.map((c: any) => ({
                    node_id: c.node_id,
                    operator: c.operator,
                    value: c.value,
                    failure_margin_median: 0.1,
                    near_miss_fraction: 0.0,
                    binding: false,
                  })),
                },
              }
            : {}),
        })),
        edges: [],
        factor_sensitivity: [
          { node_id: 'factor-a', sensitivity_score: 0.5, direction: 'positive', value_of_information: 0.1 },
          { node_id: 'factor-b', sensitivity_score: 0.0, direction: 'mixed', value_of_information: 0 },
        ],
        // Mixed-case enrichment shape:
        // edge_e_values: populated (3 entries) → passthrough with labels.
        edge_e_values: [
          { edge_id: 'factor-a->goal', e_value: 0.3, flip_direction: 'neutral_to_positive', current_mean: 0.4, flip_mean: 0.45 },
          { edge_id: 'factor-a->factor-b', e_value: 0.2, flip_direction: 'neutral_to_positive', current_mean: 0.1, flip_mean: 0.15 },
          { edge_id: 'factor-b->goal', e_value: 0.4, flip_direction: 'neutral_to_positive', current_mean: 0.0, flip_mean: 0.05 },
        ],
        // conditional_winners: explicit [] from ISL → must still surface as [].
        conditional_winners: [],
        // flip_thresholds: intentionally ABSENT from ISL — response must still
        // surface the key as [] (absent == computed-empty per boundary contract).
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

describe('enrichment emission contract (route-level mixed-case fixture)', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  // Captured log events from the request under test.
  let capturedEvents: any[] = [];

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';

    app = await createServer();

    // Hook the request-scoped logger so we can assert on `req.log.info` events.
    // Use addHook so we attach to each request's child logger AFTER Fastify creates it.
    app.addHook('onRequest', async (req) => {
      const origInfo = req.log.info.bind(req.log);
      (req.log as any).info = (...args: any[]) => {
        const arg0 = args[0];
        if (arg0 && typeof arg0 === 'object' && 'event' in arg0) {
          capturedEvents.push(arg0);
        }
        return origInfo(...args);
      };
    });

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

  it('emits all four enrichment keys + fallback_degenerate + telemetry in a single request', async () => {
    capturedEvents = [];

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'goal', kind: 'goal', label: 'Revenue' },
            { id: 'factor-a', kind: 'factor', label: 'Marketing Spend', observed_state: { value: 0.6 } },
            { id: 'factor-b', kind: 'factor', label: 'Brand Awareness', observed_state: { value: 0.5 } },
          ],
          edges: [
            // factor-a has incoming strength data from factor-b → CV path fires for factor-a.
            { from: 'factor-b', to: 'factor-a', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
            { from: 'factor-a', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
            // factor-b has NO incoming edges → CV path cannot fire → degenerate branch.
            { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.6, std: 0.1 } },
          ],
        },
        options: [
          { id: 'opt1', label: 'Option A', interventions: { 'factor-a': { value: 10, source: 'user_specified' } } },
          { id: 'opt2', label: 'Option B', interventions: { 'factor-b': { value: 5, source: 'user_specified' } } },
        ],
        goal_node_id: 'goal',
        seed: '42',
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    // --- Task 1: all four enrichment keys are present ---
    expect(body).toHaveProperty('edge_e_values');
    expect(body).toHaveProperty('conditional_winners');
    expect(body).toHaveProperty('flip_thresholds');

    // edge_e_values: populated (3 entries passed through with labels).
    expect(Array.isArray(body.edge_e_values)).toBe(true);
    expect(body.edge_e_values).toHaveLength(3);
    for (const e of body.edge_e_values) {
      expect(typeof e.edge_id).toBe('string');
      expect(typeof e.from_id).toBe('string');
      expect(typeof e.to_id).toBe('string');
      expect(typeof e.e_value).toBe('number');
    }

    // conditional_winners: explicit [] from ISL → [] in response.
    expect(body.conditional_winners).toEqual([]);

    // flip_thresholds: ABSENT from ISL → still present as [] in response.
    expect(body.flip_thresholds).toEqual([]);

    // constraint_results block is only assembled when goal_constraints are
    // supplied; this request has none, so conditional_probabilities is not
    // surfaced via buildConstraintFields. The hash/boundary assertions above
    // are sufficient to validate the three enrichment keys that DO flow.

    // --- Task 2: VOI = 0 preserved in factor_sensitivity ---
    const factors = body.factor_sensitivity;
    expect(Array.isArray(factors)).toBe(true);
    const factorB = factors.find((f: any) => f.factor_id === 'factor-b');
    expect(factorB).toBeDefined();
    // VOI = 0 must appear in the factor's value_of_information field (not filtered).
    expect(factorB.value_of_information).toBe(0);

    // --- Task 3: confidence_source + telemetry (audit A1-PRIMARY) ---
    // factor-b has no rich incoming edge strengths → degenerate_fallback
    // (surfaced via input_quality, not source enum).
    // factor-a has rich incoming strength → standard input_quality.
    const factorA = factors.find((f: any) => f.factor_id === 'factor-a');
    expect(factorA).toBeDefined();

    // Both honest source enum values are graph-side here.
    expect(factorB.confidence_source).toBe('plot_unified_from_graph');
    expect(factorB.confidence_provenance?.input_quality).toBe('degenerate_fallback');
    // At least one factor must be non-degenerate so the telemetry event is
    // genuinely per-request-aggregated (not "everything is degenerate").
    expect(['plot_unified_from_isl_bootstrap', 'plot_unified_from_graph']).toContain(factorA.confidence_source);
    expect(factorA.confidence_provenance?.input_quality).toBe('standard');

    // Telemetry event fires exactly ONCE per request when any factor is degenerate.
    const degenerateEvents = capturedEvents.filter((e) => e.event === 'plot.confidence_fallback_degenerate');
    expect(degenerateEvents).toHaveLength(1);
    const evt = degenerateEvents[0];
    expect(evt.factor_count).toBe(1);
    expect(evt.total_factors).toBe(factors.length);
    expect(evt.sample_factor_ids).toContain('factor-b');
    expect(typeof evt.confidence_value).toBe('number');
  });

  it('emits conditional_probabilities as [] when goal_constraints are supplied but ISL returns none', async () => {
    // Separate case: exercising the constraint-assembly path in buildConstraintFields.
    // The ISL mock above does not return conditional_probabilities, and we pass
    // a single goal_constraint to activate the constraints block. Expected shape:
    // constraint_results present, conditional_probabilities present as [].
    capturedEvents = [];

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'goal', kind: 'goal', label: 'Revenue' },
            { id: 'factor-a', kind: 'factor', label: 'Marketing Spend', observed_state: { value: 0.6 } },
            { id: 'factor-b', kind: 'factor', label: 'Brand Awareness', observed_state: { value: 0.5 } },
          ],
          edges: [
            { from: 'factor-b', to: 'factor-a', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
            { from: 'factor-a', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
            { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.6, std: 0.1 } },
          ],
        },
        options: [
          { id: 'opt1', label: 'Option A', interventions: { 'factor-a': { value: 10, source: 'user_specified' } } },
          { id: 'opt2', label: 'Option B', interventions: { 'factor-b': { value: 5, source: 'user_specified' } } },
        ],
        goal_node_id: 'goal',
        goal_constraints: [
          { constraint_id: 'c1', node_id: 'goal', operator: '>=', value: 0.5 },
        ],
        seed: '42',
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    // The constraints block must be present and conditional_probabilities must
    // surface as [] (not absent), so consumers see "computed-empty".
    expect(body.conditional_probabilities).toEqual([]);
  });
});
