/**
 * B5 — ONE LIMIT'S REFUSAL NEVER SILENCES ANOTHER (PLoT half).
 *
 * RULING (AI Quality, olumi-programme-docs#70 5855345225 and 5855511541; placed by
 * the Delivery Lead in 5855324470):
 *   - each limit is scored or refused ON ITS OWN, with its own typed cause;
 *   - `probability_of_joint_goal` ("all your limits met") is WITHHELD while any
 *     limit is unscored, with `joint_withheld: {reason: 'limit_unscored',
 *     constraint_ids}` — never computed over the scored subset;
 *   - a graph where every limit is scoreable is byte-identical to today.
 * Exit: on Paul's `0e19bb82` the churn limit is scored even though the spend limit
 * cannot be.
 *
 * THE MEASUREMENT (MG, 27 Sep, executed — local PLoT a6da42b → capture proxy →
 * local ISL): the CEE egress body for graph 0e19bb82 (real
 * `createRunAnalysisHandler`, CEE 6e4f964, graph hash 0e19bb826dd6fde4 matched)
 * carries two level limits — churn <= 4 % on a user-set factor, and spend <= 20000
 * GBP on a CALCULATED outcome with no observed_state. BOTH layers silenced churn:
 *   1. ISL 3717e36 omitted `constraint_analysis` on all 5 options (2.798
 *      all-or-nothing: the spend limit is CONSTRAINT_NOT_CONVERTIBLE /
 *      missing_target_baseline). Fixed by ISL 476b543 (per-limit scoring).
 *   2. With ISL 476b543 scoring churn, PLoT a6da42b still withheld EVERYTHING:
 *      spend is suppressed-unreliable (threshold_normalisation_defaulted +
 *      target_base_defaulted + sample_frame_unanchored), and that partition was
 *      applied to the whole RUN — `constraints_status: 'unavailable'`, no churn P
 *      on any option, and a CONSTRAINT_TARGET_UNRELIABLE naming no limit.
 *
 * FIXTURES (`fixtures/b5-per-limit-0e19bb82/`, captured bytes, not authored):
 *   - `cee-to-plot.request.json` — the CEE egress body above (request_id fixed);
 *   - `isl-476b543.two-limits.response.json` — ISL with per-limit scoring, answering
 *     the ISL request PLoT built from that body (churn rows, no joint, spend named
 *     by CONSTRAINT_NOT_CONVERTIBLE);
 *   - `isl-3717e36.two-limits.response.json` — today's ISL on the same request
 *     (no constraint_analysis at all);
 *   - `isl-3717e36.churn-only.response.json` / `.spend-only.response.json` — the
 *     same body with ONE limit removed (DERIVED in the test by dropping it).
 * The ISL request PLoT built was byte-identical across the two ISL builds, so the
 * canned responses answer the request this route sends.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIX = resolve(__dirname, 'fixtures/b5-per-limit-0e19bb82');
const read = (name: string): any => JSON.parse(readFileSync(resolve(FIX, name), 'utf8'));

const SPEND = 'agent-lane:six_month_decision_spend:<=';
const CHURN = 'agent-lane:monthly_churn:<=';

/** The ISL response the mock returns for the next call(s). */
let islResponse: any;

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [],
      backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock validation', reasoning: 'Test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseFactorSensitivity() {
    return {
      factors: [], value_of_information: [], robustness_label: 'robust' as const,
      robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const,
    };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(): Promise<{ data: T | null; error: string | null }> {
    return { data: JSON.parse(JSON.stringify(islResponse)) as T, error: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';

/** The served body, optionally with ONE limit removed (a labelled derivation). */
function body(keep: string[] = [SPEND, CHURN]): any {
  const b = read('cee-to-plot.request.json');
  b.goal_constraints = b.goal_constraints.filter((c: any) => keep.includes(c.constraint_id));
  expect(b.goal_constraints.map((c: any) => c.constraint_id)).toEqual(
    [SPEND, CHURN].filter((id) => keep.includes(id)),
  );
  return b;
}

/** ISL's own prob_satisfied for (option, constraint), by identity. */
function islProb(response: any, optionId: string, constraintId: string): number | undefined {
  const option = response.options.find((o: any) => o.id === optionId);
  expect(option, `ISL fixture carries option ${optionId}`).toBeDefined();
  const row = option.constraint_analysis?.constraints?.find((c: any) => c.constraint_id === constraintId);
  return row?.prob_satisfied;
}

function warningsOf(response: any, code: string): any[] {
  return (response.inference_warnings ?? []).filter((w: any) => w.code === code);
}

describe('B5: one limit\'s refusal never silences another — PLoT /v2/run on Paul\'s 0e19bb82', () => {
  let app: FastifyInstance;

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
  });

  async function run(payload: any, isl: any): Promise<any> {
    islResponse = isl;
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify(payload),
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body);
  }

  it('EXIT 0e19bb82: churn is scored on every option although spend cannot be', async () => {
    const isl = read('isl-476b543.two-limits.response.json');
    const out = await run(body(), isl);

    expect(out.option_comparison).toHaveLength(5);
    for (const option of out.option_comparison) {
      const expected = islProb(isl, option.option_id, CHURN);
      expect(expected, `ISL scored churn for ${option.option_id}`).toBeTypeOf('number');
      expect(option.constraint_probabilities, option.option_id).toEqual({ [CHURN]: expected });
      expect(option.constraint_probabilities, option.option_id).not.toHaveProperty(SPEND);
    }
    expect(out.constraints_status).toBe('computed');
    expect((out.constraint_results ?? []).map((r: any) => r.constraint_id)).toEqual([CHURN]);
  });

  it('EXIT 0e19bb82: churn P equals the churn-only control, option by option (the magnitude, not just presence)', async () => {
    const both = await run(body(), read('isl-476b543.two-limits.response.json'));
    const alone = await run(body([CHURN]), read('isl-3717e36.churn-only.response.json'));

    const churnOf = (out: any) =>
      Object.fromEntries(out.option_comparison.map((o: any) => [o.option_id, o.constraint_probabilities?.[CHURN]]));
    expect(churnOf(both)).toEqual(churnOf(alone));
    expect(Object.values(churnOf(alone)).every((p) => typeof p === 'number')).toBe(true);
  });

  it('JOINT: probability_of_joint_goal is ABSENT on every option and joint_withheld names the spend limit', async () => {
    const out = await run(body(), read('isl-476b543.two-limits.response.json'));

    for (const option of out.option_comparison) {
      expect(option, option.option_id).not.toHaveProperty('probability_of_joint_goal');
    }
    expect(out.joint_withheld).toEqual({ reason: 'limit_unscored', constraint_ids: [SPEND] });
  });

  it('REASON: the unscored spend limit keeps its own typed causes, each naming it', async () => {
    const out = await run(body(), read('isl-476b543.two-limits.response.json'));

    const unreliable = warningsOf(out, 'CONSTRAINT_TARGET_UNRELIABLE');
    expect(unreliable).toHaveLength(1);
    expect(unreliable[0].constraint_ids).toEqual([SPEND]);
    const notConvertible = warningsOf(out, 'CONSTRAINT_NOT_CONVERTIBLE');
    expect(notConvertible).toHaveLength(1);
    expect(notConvertible[0].field).toMatch(/^nodes\[six_month_decision_spend\]/);
  });

  it('TODAY\'S ISL (block absent): nothing is scored, and the joint is withheld naming BOTH limits in request order', async () => {
    const out = await run(body(), read('isl-3717e36.two-limits.response.json'));

    for (const option of out.option_comparison) {
      expect(option, option.option_id).not.toHaveProperty('constraint_probabilities');
      expect(option, option.option_id).not.toHaveProperty('probability_of_joint_goal');
    }
    expect(out.constraints_status).toBe('unavailable');
    expect(out.joint_withheld).toEqual({ reason: 'limit_unscored', constraint_ids: [SPEND, CHURN] });
  });

  it('SINGLE UNSCOREABLE LIMIT: its own reason, no P, no joint', async () => {
    const out = await run(body([SPEND]), read('isl-3717e36.spend-only.response.json'));

    for (const option of out.option_comparison) {
      expect(option, option.option_id).not.toHaveProperty('constraint_probabilities');
      expect(option, option.option_id).not.toHaveProperty('probability_of_joint_goal');
    }
    expect(out.constraints_status).toBe('unavailable');
    expect(out.joint_withheld).toEqual({ reason: 'limit_unscored', constraint_ids: [SPEND] });
    expect(warningsOf(out, 'CONSTRAINT_TARGET_UNRELIABLE').map((w: any) => w.constraint_ids)).toEqual([[SPEND]]);
  });

  it('CONTRAST, ALL SCOREABLE: the joint is delivered and nothing is withheld', async () => {
    const isl = read('isl-3717e36.churn-only.response.json');
    const out = await run(body([CHURN]), isl);

    for (const option of out.option_comparison) {
      const islOption = isl.options.find((o: any) => o.id === option.option_id);
      expect(option.probability_of_joint_goal, option.option_id).toBe(islOption.constraint_analysis.joint_probability);
      expect(option.constraint_probabilities, option.option_id).toEqual({ [CHURN]: islProb(isl, option.option_id, CHURN) });
      expect(option.constraints_decision_grade, option.option_id).toBe(true);
    }
    expect(out).not.toHaveProperty('joint_withheld');
    expect(out.constraints_status).toBe('computed');
    expect(warningsOf(out, 'CONSTRAINT_TARGET_UNRELIABLE')).toHaveLength(0);
  });
});
