/**
 * conditional_probabilities[].effective_sample_size — omit, never substitute.
 *
 * DEFECT. `src/routes/v2/run.ts` published
 *
 *     effective_sample_size: cp.effective_sample_size ?? 0
 *
 * on a REQUIRED number field, so a row for which ISL reported no effective
 * sample size shipped as "zero effective samples" — a precision claim PLoT
 * never derived, and the most alarming one available. It errs conservative
 * (understating precision) and is still a fabrication: `0` does not read as
 * "unknown", it reads as a measurement. Same class as the `?? 0` regret default
 * that collapsed the whole-decision EVPI bound (numeric-egress-guards.ts:74-79).
 *
 * A second, quieter defect rode with it. The downstream finiteness filter
 * required `Number.isFinite(cp.effective_sample_size)`, and the `?? ` never
 * caught a non-finite value — so a NaN ESS did not merely lose the diagnostic,
 * it DROPPED THE WHOLE ROW, discarding a `probability` ISL genuinely measured.
 *
 * FIXED SHAPE. `effective_sample_size` is now OPTIONAL and guarded by `nonNeg`
 * (the house guard for non-negative reals; an ESS is a weighted count and
 * legitimately fractional). Absent / non-finite / negative → the key is
 * OMITTED. `probability` alone decides whether the ROW survives: omit the
 * field, keep the row.
 *
 * BLAST RADIUS, derived rather than assumed. `effective_sample_size` on this
 * row is absent from `contracts/openapi.yaml`; it is declared but NOT in the
 * `required` list of `@talchain/schemas` `AnalysisEnrichmentSchema` (which is
 * `additionalProperties: true`); and it reads ZERO files in both consumer repos
 * — `Talchain/DecisionGuideAI` @ staging 04c7c8c and
 * `Talchain/olumi-assistants-service` @ staging de25439, swept 2026-08-29 with
 * contrast controls `factor_sensitivity` (179 / 253 files) and `win_probability`
 * (220 / 283 files) firing in the same command. Making it optional therefore
 * breaks no known consumer.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

/** The conditional_probabilities array ISL returns on the next call. */
let mockConditionalProbabilities: any[] = [];

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
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    const options = body.options || [];
    const goalConstraints = body.goal_constraints || [];

    const constraintAnalysis = goalConstraints.length > 0
      ? {
          constraint_analysis: {
            joint_probability: 0.6,
            constraints: goalConstraints.map((c: any) => ({
              node_id: c.node_id,
              operator: c.operator,
              threshold: c.threshold ?? c.value,
              prob_satisfied: 0.6,
            })),
            conditional_probabilities: mockConditionalProbabilities,
          },
        }
      : {};

    return {
      data: {
        options: options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
          win_probability: idx === 0 ? 0.6 : 0.4,
          rank: idx + 1,
          ...constraintAnalysis,
        })),
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

import { createServer } from '../src/createServer.js';

const GRAPH = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', goal_threshold_frame: 'delta', label: 'Grow revenue' },
    { id: 'out_effectiveness', kind: 'outcome', goal_threshold_frame: 'delta', label: 'Campaign effectiveness', observed_state: { value: 50 } },
    { id: 'out_retention', kind: 'outcome', goal_threshold_frame: 'delta', label: 'Customer retention', observed_state: { value: 50 } },
    { id: 'fac_budget', kind: 'factor', label: 'Marketing budget', observed_state: { value: 0.6 } },
  ],
  edges: [
    { from: 'fac_budget', to: 'out_effectiveness', strength: { mean: 0.5, std: 0.1 } },
    { from: 'fac_budget', to: 'out_retention', strength: { mean: 0.4, std: 0.1 } },
    { from: 'out_effectiveness', to: 'goal_growth', strength: { mean: 0.6, std: 0.1 } },
    { from: 'out_retention', to: 'goal_growth', strength: { mean: 0.3, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt_a', label: 'Push campaign', interventions: { fac_budget: 0.8 } },
  { id: 'opt_b', label: 'Hold steady', interventions: { fac_budget: 0.4 } },
];

const CONSTRAINTS = [
  { constraint_id: 'effectiveness_floor', node_id: 'out_effectiveness', operator: '>=', value: 20, unit: '%', label: 'Effectiveness >= 20%' },
  { constraint_id: 'retention_floor', node_id: 'out_retention', operator: '>=', value: 30, unit: '%', label: 'Retention >= 30%' },
];

/** Indices → ids: 0 = effectiveness_floor, 1 = retention_floor. */
const BASE_ROW = { given_constraint_index: 0, target_constraint_index: 1, probability: 0.5 };

let app: FastifyInstance;

async function run(rows: any[]) {
  mockConditionalProbabilities = rows;
  const res = await app.inject({
    method: 'POST',
    url: '/v2/run',
    headers: { 'Content-Type': 'application/json' },
    payload: JSON.stringify({
      graph: GRAPH,
      options: OPTIONS,
      goal_node_id: 'goal_growth',
      seed: 'conditional-ess-omission',
      goal_constraints: CONSTRAINTS,
    }),
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body);
}

beforeAll(async () => {
  process.env.RATE_LIMIT_ENABLED = '0';
  process.env.CEE_ORCHESTRATOR_ENABLED = '0';
  process.env.DECISION_REVIEW_ENABLE = '0';
  process.env.ENABLE_REVIEW_PASS = '0';
  app = await createServer();
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app.close();
  mockConditionalProbabilities = [];
});

// ───────────────────────────────────────────────────────────────────────────
// POSITIVE CONTROL — run first. An assertion about an omitted key passes
// trivially if the surface is empty (CLAUDE.md trap 13).
// ───────────────────────────────────────────────────────────────────────────
describe('positive control', () => {
  it('the surface under test is POPULATED and carries a REPORTED ESS verbatim', async () => {
    const body = await run([{ ...BASE_ROW, effective_sample_size: 100 }]);
    expect(body.constraints_status).toBe('computed');
    expect(body.conditional_probabilities).toEqual([
      {
        given_constraint_id: 'effectiveness_floor',
        target_constraint_id: 'retention_floor',
        probability: 0.5,
        effective_sample_size: 100,
      },
    ]);
  }, 120_000);
});

// ───────────────────────────────────────────────────────────────────────────
// THE DEFECT. RED at pristine.
// ───────────────────────────────────────────────────────────────────────────
describe('an UNREPORTED effective_sample_size is omitted, never published as 0', () => {
  it('omits the key when ISL did not report it', async () => {
    const body = await run([{ ...BASE_ROW }]); // no effective_sample_size at all
    const rows = body.conditional_probabilities;
    expect(rows, 'the row must survive — probability WAS measured').toHaveLength(1);
    // RED at pristine: the row shipped `effective_sample_size: 0`.
    expect(
      Object.hasOwn(rows[0], 'effective_sample_size'),
      'published an effective_sample_size PLoT never derived',
    ).toBe(false);
    // The measured half is untouched.
    expect(rows[0].probability).toBe(0.5);
    expect(rows[0].given_constraint_id).toBe('effectiveness_floor');
  }, 120_000);

  it('omits the key — and KEEPS the row — when ISL reports a non-finite ESS', async () => {
    // RED at pristine in the OTHER direction: `?? ` did not catch NaN, so the
    // finiteness filter dropped the whole row and the measured probability with it.
    const body = await run([{ ...BASE_ROW, effective_sample_size: Number.NaN }]);
    const rows = body.conditional_probabilities;
    expect(rows, 'a measured probability was discarded over a missing diagnostic').toHaveLength(1);
    expect(Object.hasOwn(rows[0], 'effective_sample_size')).toBe(false);
    expect(rows[0].probability).toBe(0.5);
  }, 120_000);

  it('omits an out-of-domain (negative) ESS rather than publishing it', async () => {
    const body = await run([{ ...BASE_ROW, effective_sample_size: -5 }]);
    const rows = body.conditional_probabilities;
    expect(rows).toHaveLength(1);
    expect(Object.hasOwn(rows[0], 'effective_sample_size')).toBe(false);
    expect(rows[0].probability).toBe(0.5);
  }, 120_000);

  it('still drops the ROW when the measured half — probability — is non-finite', async () => {
    // The row filter's original purpose must survive the change.
    const body = await run([
      { ...BASE_ROW, probability: Number.NaN, effective_sample_size: 100 },
      { given_constraint_index: 1, target_constraint_index: 0, probability: 0.8, effective_sample_size: 90 },
    ]);
    const rows = body.conditional_probabilities;
    expect(rows).toHaveLength(1);
    expect(rows[0].probability).toBe(0.8);
  }, 120_000);
});

// ───────────────────────────────────────────────────────────────────────────
// THE OPPOSITE-DIRECTION TWIN. GREEN at pristine AND after — turning a real
// measurement into an omission is the mirror defect (numeric-egress-guards.ts:81-83).
// ───────────────────────────────────────────────────────────────────────────
describe('a MEASURED zero effective_sample_size still ships', () => {
  it('publishes effective_sample_size: 0 when ISL actually reported 0', async () => {
    const body = await run([{ ...BASE_ROW, effective_sample_size: 0 }]);
    const rows = body.conditional_probabilities;
    expect(rows).toHaveLength(1);
    expect(
      Object.hasOwn(rows[0], 'effective_sample_size'),
      'a MEASURED zero was turned into an omission',
    ).toBe(true);
    expect(rows[0].effective_sample_size).toBe(0);
  }, 120_000);

  it('publishes a fractional ESS verbatim — never rounded or coerced', async () => {
    const body = await run([{ ...BASE_ROW, effective_sample_size: 87.5 }]);
    expect(body.conditional_probabilities[0].effective_sample_size).toBe(87.5);
  }, 120_000);
});
