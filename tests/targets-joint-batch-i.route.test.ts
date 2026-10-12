/**
 * Batch I — the TARGET-ONLY joint (AIE olumi-programme-docs#94 6130197656 item 1; DL 6132232654).
 *
 * PLoT carries `role: 'goal_target'` by presence from the request to ISL (through the temporal
 * filter's rebuild, the normaliser's rebuilds and the translator), and maps ISL's
 * `targets_joint_probability` to a SEPARATELY NAMED per-option `probability_of_targets_joint`,
 * gated on the TARGETS only:
 *   - at least two target ids;
 *   - no target unscored for the run (suppressed, unreturned, filtered or refused);
 *   - no target range-withheld for this option;
 * and stripped, like the existing joint, wherever an option's range was not confirmed sampled.
 * `probability_of_joint_goal` is unchanged. With no role on any row nothing changes at all.
 *
 * The mock ISL below mimics ISL's own rule (emit the figure when the request carries at least
 * two role rows), but deliberately KEEPS emitting it when a row is dropped, so every withhold
 * asserted here is PLoT's own gate, not the mock's.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { writeFileSync } from 'node:fs';

const JOINT = 0.3;
const TARGETS = 0.5;
const TARGETS_PRECISION = { n_informative: 1000, standard_error: 0.0158 };

let captured: any;
/** Constraint ids whose ISL row is dropped (ISL refused them, per B5). */
let dropRows: string[] = [];
/** Echo sampled_intervention_ranges (true) or not (false → PLoT withholds those limits). */
let echoRanges = true;

const outcome = (i: number) => ({
  mean: 0.6 + i * 0.1, std: 0.1, p10: 0.4, p50: 0.6, p90: 0.8,
  n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1,
});
const mockISL = {
  isEnabled: () => true,
  isAvailable: async () => true,
  async callAnalysisEndpoint(_endpoint: string, body: any) {
    captured = structuredClone(body);
    const sent: any[] = body.goal_constraints ?? [];
    const targetsSent = sent.filter((c) => c.role === 'goal_target').length >= 2;
    return {
      error: null,
      data: {
        options: (body.options ?? []).map((o: any, i: number) => {
          const ranged = o.intervention_ranges ? Object.entries(o.intervention_ranges) : [];
          return {
            option_id: o.id, rank: i + 1, outcome: outcome(i),
            ...(echoRanges && ranged.length > 0 && {
              sampled_intervention_ranges: ranged.map(([nodeId, r]: [string, any]) => ({
                node_id: nodeId, meaning: r.meaning, family: 'lognormal', coverage: 0.5, low: r.low, high: r.high,
              })),
            }),
            ...(sent.length > 0 && {
              constraint_analysis: {
                ...(dropRows.length === 0 && {
                  joint_probability: JOINT,
                  joint_probability_precision: { n_informative: 1000, standard_error: 0.0145 },
                }),
                ...(targetsSent && {
                  targets_joint_probability: TARGETS,
                  targets_joint_probability_precision: TARGETS_PRECISION,
                }),
                constraints: sent
                  .filter((c) => !dropRows.includes(c.constraint_id))
                  .map((c) => ({
                    constraint_id: c.constraint_id, node_id: c.node_id, operator: c.operator,
                    threshold: c.value, prob_satisfied: 0.6,
                  })),
              },
            }),
          };
        }),
        edges: [], factors: [], value_of_information: [], overall_robustness: 'robust',
        robustness_score: 0.8, fragile_edges: [], robust_edges: [],
      },
    };
  },
};
vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISL, islService: mockISL };
});
const { createServer } = await import('../src/createServer.js');

const CONVERSION = 'conversion-target';
const CUSTOMERS = 'customers-target';
const BUDGET = 'budget-limit';

const iv = (value: number) => ({ value, source: 'user_specified' });

/** Marketing-shaped: two targets (conversion above 15 %, at least 20 customers) and a budget limit. */
function payload(opts: { roles?: boolean; extra?: any[]; ranged?: boolean; roleOn?: string[] } = {}) {
  const { roles = true, extra = [], ranged = false, roleOn = [CONVERSION, CUSTOMERS] } = opts;
  const role = (id: string) => (roles && roleOn.includes(id) ? { role: 'goal_target' } : {});
  return {
    request_id: 'batch-i-targets-joint', seed: '42', goal_node_id: 'conversion',
    graph: {
      nodes: [
        { id: 'conversion', kind: 'goal', label: 'Conversion', observed_state: { value: 0.1, raw_value: 10, cap: 100, unit: '%', baseline: 0.1 } },
        { id: 'customers', kind: 'factor', label: 'Customers', observed_state: { value: 0.3, raw_value: 30, cap: 100, baseline: 0.3 } },
        { id: 'spend', kind: 'factor', label: 'Spend', observed_state: { value: 0.5 } },
        { id: 'budget', kind: 'factor', label: 'Campaign budget', observed_state: { value: 10 } },
      ],
      edges: [
        { from: 'spend', to: 'customers', strength: { mean: 0.5, std: 0.1 } },
        { from: 'customers', to: 'conversion', strength: { mean: 0.5, std: 0.1 } },
        { from: 'budget', to: 'conversion', strength: { mean: 0.2, std: 0.1 } },
      ],
    },
    options: [
      { id: 'status_quo', label: 'Status quo', interventions: { spend: 0.5, budget: iv(10) } },
      {
        id: 'campaign', label: 'Campaign', interventions: { spend: 0.8, budget: iv(12) },
        ...(ranged && { intervention_ranges: { budget: { low: 8, high: 16, meaning: 'likely_range' } } }),
      },
    ],
    goal_constraints: [
      { constraint_id: CONVERSION, node_id: 'conversion', operator: '>', value: 15, value_frame: 'level', unit: '%', ...role(CONVERSION) },
      { constraint_id: CUSTOMERS, node_id: 'customers', operator: '>=', value: 20, value_frame: 'level', ...role(CUSTOMERS) },
      { constraint_id: BUDGET, node_id: 'budget', operator: '<=', value: 11, value_frame: 'level' },
      ...extra,
    ],
  };
}

describe('Batch I: PLoT carries role and maps the target-only joint, gated on targets only', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubEnv('RATE_LIMIT_ENABLED', '0');
    vi.stubEnv('CEE_ORCHESTRATOR_ENABLED', '0');
    vi.stubEnv('DECISION_REVIEW_ENABLE', '0');
    vi.stubEnv('ENABLE_REVIEW_PASS', '0');
    app = await createServer();
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); vi.unstubAllEnvs(); });
  beforeEach(() => { captured = undefined; dropRows = []; echoRanges = true; });

  async function run(body: any) {
    const response = await app.inject({ method: 'POST', url: '/v2/run', payload: body });
    expect(response.statusCode, response.body).toBe(200);
    expect(captured, 'ISL was called').toBeDefined();
    return { json: response.json(), raw: response.body };
  }
  const row = (json: any, id: string) => {
    const rows = json.option_comparison.filter((o: any) => o.option_id === id);
    expect(rows).toHaveLength(1);
    return rows[0];
  };
  const sent = (id: string) => captured.goal_constraints.find((c: any) => c.constraint_id === id);

  it('forwards role by presence through the filter, the normaliser and the translator', async () => {
    await run(payload());
    // The '%' target is normalised (15 % → 0.15): the row went through the normaliser's rebuild.
    expect(sent(CONVERSION)).toMatchObject({ value: 0.15, value_frame: 'level', role: 'goal_target' });
    expect(sent(CUSTOMERS)).toMatchObject({ value_frame: 'level', role: 'goal_target' });
    expect(sent(BUDGET)).toBeDefined();
    expect(sent(BUDGET)).not.toHaveProperty('role');
  });

  it('every row scored: the target-only joint ships beside the UNCHANGED all-condition joint', async () => {
    const { json } = await run(payload());
    for (const id of ['status_quo', 'campaign']) {
      const r = row(json, id);
      expect(r.probability_of_targets_joint, id).toBe(TARGETS);
      expect(r.probability_of_targets_joint_precision, id).toEqual(TARGETS_PRECISION);
      expect(r.probability_of_joint_goal, id).toBe(JOINT);
    }
  });

  it('an unscored LIMIT withholds the all-condition joint but NOT the target-only joint', async () => {
    dropRows = [BUDGET];
    const { json } = await run(payload());
    expect(json.joint_withheld).toEqual({ reason: 'limit_unscored', constraint_ids: [BUDGET] });
    for (const id of ['status_quo', 'campaign']) {
      const r = row(json, id);
      expect(r.probability_of_joint_goal, id).toBeUndefined();
      expect(r.probability_of_targets_joint, id).toBe(TARGETS);
      expect(r.probability_of_targets_joint_precision, id).toEqual(TARGETS_PRECISION);
    }
  });

  it('a LIMIT refused before ISL (threshold_clamped) withholds the joint but NOT the target-only joint', async () => {
    // 14 lies outside the budget node's scale, so the normaliser refuses this second limit.
    const clamped = { constraint_id: 'budget-cap', node_id: 'budget', operator: '<', value: 14, value_frame: 'level' };
    const { json } = await run(payload({ extra: [clamped] }));
    expect(sent('budget-cap')).toBeUndefined();
    expect(json._meta.filtered_constraints).toEqual([
      { constraint_id: 'budget-cap', node_id: 'budget', reason: 'threshold_clamped' },
    ]);
    expect(json.joint_withheld).toEqual({ reason: 'limit_unscored', constraint_ids: ['budget-cap'] });
    for (const id of ['status_quo', 'campaign']) {
      expect(row(json, id).probability_of_joint_goal, id).toBeUndefined();
      expect(row(json, id).probability_of_targets_joint, id).toBe(TARGETS);
    }
  });

  it('an unscored TARGET withholds it (ISL still answered with one)', async () => {
    dropRows = [CUSTOMERS];
    const { json } = await run(payload());
    for (const id of ['status_quo', 'campaign']) {
      expect(row(json, id).probability_of_targets_joint, id).toBeUndefined();
      expect(row(json, id).probability_of_targets_joint_precision, id).toBeUndefined();
    }
  });

  it('a target refused before ISL withholds it, although ISL saw two targets', async () => {
    // A third target, stated as a 'delta' of 20 on a node scaled by 100: the normaliser refuses
    // it (it cannot be forwarded unaltered). ISL still sees the other two targets and answers.
    // (Its operator differs from the customers target's, so the explicit-duplicate merge keeps it.)
    const refused = { constraint_id: 'customers-delta-target', node_id: 'customers', operator: '>', value: 20, value_frame: 'delta', role: 'goal_target' };
    const { json } = await run(payload({ extra: [refused] }));
    expect(sent('customers-delta-target')).toBeUndefined();
    expect(captured.goal_constraints.filter((c: any) => c.role === 'goal_target')).toHaveLength(2);
    expect((json._meta?.filtered_constraints ?? []).map((f: any) => f.constraint_id)).toContain('customers-delta-target');
    for (const id of ['status_quo', 'campaign']) {
      expect(row(json, id).probability_of_targets_joint, id).toBeUndefined();
    }
  });

  it('one target is not a conjunction', async () => {
    const { json } = await run(payload({ roleOn: [CONVERSION] }));
    for (const id of ['status_quo', 'campaign']) expect(row(json, id).probability_of_targets_joint, id).toBeUndefined();
  });

  it('a range not confirmed sampled strips it with the existing joint for THAT option only', async () => {
    // The campaign states a range for the BUDGET limit's node and ISL does not echo sampling it.
    // The withheld row is a limit, so only the strip (not the target gate) can remove the figure.
    echoRanges = false;
    const { json } = await run(payload({ ranged: true }));
    const campaign = row(json, 'campaign');
    expect(campaign.range_limits_withheld?.map((w: any) => w.constraint_id)).toEqual([BUDGET]);
    expect(campaign.probability_of_joint_goal).toBeUndefined();
    expect(campaign.probability_of_targets_joint).toBeUndefined();
    expect(campaign.probability_of_targets_joint_precision).toBeUndefined();
    // Control: the option with no stated range keeps its figure.
    expect(row(json, 'status_quo').probability_of_targets_joint).toBe(TARGETS);
  });

  it('INERT: with no role on any row, nothing is forwarded and nothing is emitted', async () => {
    const { json, raw } = await run(payload({ roles: false }));
    expect(JSON.stringify(captured)).not.toContain('"role"');
    expect(raw).not.toContain('targets_joint');
    for (const id of ['status_quo', 'campaign']) expect(row(json, id).probability_of_joint_goal, id).toBe(JOINT);
    // Cross-commit witness (run by hand on base and head): the ISL request and the response.
    if (process.env.BI_INERT_OUT) {
      writeFileSync(process.env.BI_INERT_OUT, JSON.stringify({ isl_request: captured, response: json }, null, 1));
    }
  });
});
