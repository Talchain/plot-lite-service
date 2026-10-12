import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildConstraintProbabilityPrecision } from '../src/routes/v2/numeric-egress-guards.js';
import { compileConstraintNodes } from '../src/normalisation/constraint-compiler.js';
import { validateGoalConstraints } from '../src/validation/preflight-v2.js';

let captured: any;
let includePrecision = true;
let invalidProbability = false;
const precision = { n_informative: 800, standard_error: 0.0125 };
const mockISL = {
  isEnabled: () => true,
  isAvailable: async () => true,
  async callAnalysisEndpoint(_endpoint: string, body: any) {
    captured = structuredClone(body);
    return { error: null, data: {
      options: body.options.map((o: any, i: number) => ({
        option_id: o.id, rank: i + 1,
        outcome: { mean: 0.7, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1 },
        constraint_analysis: {
          joint_probability: invalidProbability ? 2 : 0.6,
          ...(includePrecision && { joint_probability_precision: precision }),
          // Reverse the response order to prove precision follows echoed identity.
          constraints: [...(body.goal_constraints ?? [])].reverse().map((c: any, j: number) => ({
            constraint_id: c.constraint_id, node_id: c.node_id, operator: c.operator,
            threshold: c.value, prob_satisfied: invalidProbability ? 2 : 0.75,
            ...(includePrecision && { prob_satisfied_precision: { ...precision, n_informative: 800 + j } }),
          })),
        },
      })),
      edges: [], factors: [], value_of_information: [], overall_robustness: 'robust',
      robustness_score: 0.8, fragile_edges: [], robust_edges: [],
    } };
  },
};
vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISL, islService: mockISL };
});
const { createServer } = await import('../src/createServer.js');
function payload(operator = '>=') {
  return {
    request_id: 'batch-c-wire', seed: '42', goal_node_id: 'conversion',
    graph: {
      nodes: [
        { id: 'conversion', kind: 'goal', label: 'Conversion', observed_state: { value: 0.1, raw_value: 10, cap: 100, unit: '%', baseline: 0.1 } },
        { id: 'customers', kind: 'factor', label: 'Customers', observed_state: { value: 0.3, raw_value: 30, cap: 100, baseline: 0.3 } },
        { id: 'spend', kind: 'factor', label: 'Spend', observed_state: { value: 0.5 } },
      ],
      edges: [
        { from: 'spend', to: 'customers', strength: { mean: 0.5, std: 0.1 } },
        { from: 'customers', to: 'conversion', strength: { mean: 0.5, std: 0.1 } },
      ],
    },
    options: [
      { id: 'status_quo', label: 'Status quo', interventions: { spend: 0.5 } },
      { id: 'campaign', label: 'Campaign', interventions: { spend: 0.8 } },
    ],
    goal_constraints: [
      { constraint_id: 'conversion-target', node_id: 'conversion', operator, value: 15, value_frame: 'level', unit: '%' },
      { constraint_id: 'customers-target', node_id: 'customers', operator: '>=', value: 20, value_frame: 'level' },
    ],
  };
}
describe('Recovery Batch C: strict wire and precision', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubEnv('RATE_LIMIT_ENABLED', '0');
    vi.stubEnv('CEE_ORCHESTRATOR_ENABLED', '0');
    app = await createServer();
    await app.ready();
  });
  afterAll(async () => { await app?.close(); vi.unstubAllEnvs(); });
  beforeEach(() => { captured = undefined; includePrecision = true; invalidProbability = false; });
  async function run(operator = '>=') {
    const response = await app.inject({ method: 'POST', url: '/v2/run', payload: payload(operator) });
    expect(response.statusCode, response.body).toBe(200);
    expect(captured).toBeDefined();
    return response.json();
  }
  it.each(['>', '<', '>=', '<='])('preserves %s through route validation, scaling and ISL translation', async operator => {
    await run(operator);
    expect(captured.goal_constraints.find((c: any) => c.constraint_id === 'conversion-target')).toMatchObject({ operator, value: 0.15, value_frame: 'level' });
    expect(captured.goal_constraints.find((c: any) => c.constraint_id === 'customers-target')).toMatchObject({ operator: '>=', value: 0.2, value_frame: 'level' });
    expect(captured.options.find((o: any) => o.id === 'status_quo').interventions).toEqual({ spend: 0.5 });
    expect(captured.graph.nodes.find((n: any) => n.id === 'conversion').observed_state.baseline).toBe(0.1);
  });
  // The synthesized constraint states the SAME comparison ISL's single-goal chance makes from
  // goal_direction + goal_threshold_strict: minimise reads below the target, maximise above it.
  it.each([
    ['maximise', undefined, '>='],
    ['maximise', false, '>='],
    ['maximise', true, '>'],
    ['minimise', undefined, '<='],
    ['minimise', false, '<='],
    ['minimise', true, '<'],
  ] as const)('synthesizes a scalar %s goal (strict: %s) as %s', async (direction, strict, operator) => {
    const request = payload() as any;
    delete request.goal_constraints;
    request.goal_threshold = 0.15;
    if (strict !== undefined) request.goal_threshold_strict = strict;
    request.goal_direction = direction;
    request.graph.nodes[0].goal_threshold_frame = 'delta';
    const response = await app.inject({ method: 'POST', url: '/v2/run', payload: request });
    expect(response.statusCode, response.body).toBe(200);
    const auto = captured.goal_constraints.find((c: any) => c.constraint_id === 'auto_goal_threshold');
    expect(auto).toMatchObject({ operator, value: 0.15, value_frame: 'delta' });
    expect(captured.goal_direction).toBe(direction);
    expect(captured.goal_threshold_strict === true).toBe(strict === true);
  });
  it('keeps legacy serialized ISL request bytes frozen before the fix', async () => {
    includePrecision = false;
    await run();
    expect(JSON.stringify(captured)).toMatchSnapshot();
  });
  it('returns joint and per-constraint precision beside existing probabilities by identity', async () => {
    const result = await run();
    for (const row of result.option_comparison) {
      expect(row.probability_of_joint_goal).toBe(0.6);
      expect(row.probability_of_joint_goal_precision).toEqual(precision);
      expect(row.constraint_probabilities).toEqual({ 'conversion-target': 0.75, 'customers-target': 0.75 });
      expect(row.constraint_probabilities_precision).toEqual({
        'conversion-target': { ...precision, n_informative: 801 }, 'customers-target': precision,
      });
    }
    expect(result.constraint_results.find((c: any) => c.constraint_id === 'conversion-target').probability_precision)
      .toEqual({ ...precision, n_informative: 801 });
  });
  it('omits precision for old ISL responses', async () => {
    includePrecision = false;
    const result = await run();
    for (const row of result.option_comparison) {
      expect(row).not.toHaveProperty('probability_of_joint_goal_precision');
      expect(row).not.toHaveProperty('constraint_probabilities_precision');
    }
  });
  it('does not publish precision when its probability is invalid', async () => {
    invalidProbability = true;
    const result = await run();
    for (const row of result.option_comparison) {
      expect(row).not.toHaveProperty('probability_of_joint_goal_precision');
      expect(row).not.toHaveProperty('constraint_probabilities_precision');
    }
  });
  it.each(['>', '<'])('compiles strict constraint nodes and retains stricter duplicate %s thresholds', operator => {
    const request = payload(operator);
    const graph = structuredClone(request.graph) as any;
    for (const value of [25, 15, 20]) {
      const id = `limit-${value}`;
      graph.nodes.push({ id, kind: 'constraint', label: id, observed_state: { value, metadata: { operator } } });
      graph.edges.push({ from: 'customers', to: id, strength: { mean: 1, std: 0.1 } });
    }
    const compiled = compileConstraintNodes(graph);
    expect(compiled.constraints).toHaveLength(1);
    expect(compiled.constraints[0]).toMatchObject({ operator, value: operator === '>' ? 25 : 15 });
    expect(validateGoalConstraints(request.goal_constraints as any, graph).blockers).toEqual([]);
    const duplicateLimits = [25, 15].map(value => ({
      constraint_id: `limit-${value}`, node_id: 'customers', operator, value,
    }));
    const warning = validateGoalConstraints(duplicateLimits as any, graph).warnings
      .find(w => w.code === 'CONSTRAINT_DUPLICATE_TARGET');
    expect(warning?.message).toContain(`Keeping "limit-${operator === '>' ? 25 : 15}"`);
  });
});

// Invalid precision cannot become a fabricated measurement at JSON serialization.
describe('constraint precision ingress', () => {
  it.each([undefined, null, {}, [], { n_informative: 0, standard_error: 0 },
    { n_informative: 1.5, standard_error: 0.1 }, { n_informative: 10, standard_error: NaN },
    { n_informative: 10, standard_error: Infinity }, { n_informative: 10, standard_error: -0.1 },
    { n_informative: 10, standard_error: 0.6 }, { n_informative: '10', standard_error: 0.1 },
  ])('omits invalid precision %#', raw => {
    expect(buildConstraintProbabilityPrecision(raw)).toBeUndefined();
  });
  it('retains measured zero error', () => {
    expect(buildConstraintProbabilityPrecision({ n_informative: 1, standard_error: 0 }))
      .toEqual({ n_informative: 1, standard_error: 0 });
  });
});
