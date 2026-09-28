/**
 * R1 S3 — ROUTE rows: the typed change frames reach ISL's wire as ruled (wire R3 #72 5872798858,
 * meaning AIQ #72 5872801411), and a request with no change frame is byte-for-byte unchanged.
 * Rows bind by node id / constraint id (trap 19). ISL is mocked only to CAPTURE the request.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { islConstraintAnalysis, assertCapturedContract } from './helpers/isl-constraint-contract.js';

let capturedISLRequestBody: any = null;

// ---------------------------------------------------------------------------
// ISL mock — models the CAPTURED fail-closed contract rather than fabricating.
// The rule is SHARED (tests/helpers/isl-constraint-contract.ts) and derived from
// the dated corpus, so it cannot be fixed here and quietly left fabricating in
// tests/goal-threshold-frame-synthesis-gate.test.ts, which is where it hid.
// ---------------------------------------------------------------------------
// R1 S2's ISL resolves change frames and stamps a frame verdict on each limit row (R3 5872798858).
// The mock answers ONLY change-frame limits this way; everything else follows the captured contract.
function changeFrameAnalysis(constraints: any[]) {
  const rows = constraints.filter((c) => c.value_frame === 'change_abs' || c.value_frame === 'change_rel');
  if (rows.length === 0) return undefined;
  return {
    constraints: rows.map((c) => ({
      constraint_id: c.constraint_id, node_id: c.node_id, operator: c.operator,
      threshold: c.value, value: c.value, prob_satisfied: 0.42, binding: false,
      frame_verdict: c.label === 'JUNK VERDICT' ? 'scored_ish' : c.value_frame === 'change_rel' ? 'estimate_only' : 'scored',
    })),
    joint_probability: 0.42,
  };
}

function mockResultRows(body: any) {
  const options = body.options || [];
  const analysis = islConstraintAnalysis(body.goal_constraints || []) ?? changeFrameAnalysis(body.goal_constraints || []);
  return options.map((opt: any, idx: number) => ({
    option_id: opt.id,
    outcome: {
      mean: 0.2915, std: 0.2048, p10: 0.05, p50: 0.294, p90: 0.555,
      n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0,
    },
    rank: idx + 1,
    ...(analysis !== undefined ? { constraint_analysis: analysis } : {}),
  }));
}

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
        outcome: {
          mean: 0.2915, std: 0.2048, p10: 0.05, p50: 0.294, p90: 0.555,
          n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0,
        },
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
    return {
      data: {
        options: mockResultRows(body),
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

const { createServer } = await import('../src/createServer.js');

const OPTIONS = [
  { id: 'reserved', label: 'Reserved instances', interventions: { commitment: 0.8 } },
  { id: 'renegotiate', label: 'Renegotiate', interventions: { commitment: 0.2 } },
];

function cloudGraph(goalExtras: Record<string, unknown> = {}, extraNodes: Record<string, unknown>[] = [], extraEdges: Record<string, unknown>[] = []) {
  return {
    nodes: [
      {
        id: 'monthly_cloud_bill', kind: 'goal', label: 'monthly cloud bill',
        observed_state: { value: 0.9, baseline: 0.9, raw_value: 45000, cap: 50000, unit: 'GBP/month', source: 'brief_extraction' },
        ...goalExtras,
      },
      { id: 'commitment', kind: 'factor', label: 'Commitment level', observed_state: { value: 0.5 } },
      {
        id: 'egress', kind: 'factor', label: 'Egress spend',
        observed_state: { value: 0.3, raw_value: 3000, cap: 10000, unit: 'GBP/month', source: 'cee_inference' },
      },
      ...extraNodes,
    ],
    edges: [
      { from: 'commitment', to: 'monthly_cloud_bill', strength: { mean: -0.5, std: 0.1 } },
      { from: 'egress', to: 'monthly_cloud_bill', strength: { mean: 0.4, std: 0.1 } },
      { from: 'commitment', to: 'egress', strength: { mean: -0.2, std: 0.1 } },
      ...extraEdges,
    ],
  };
}

const nodeOf = (isl: any, id: string) => (isl?.graph?.nodes ?? []).find((n: any) => n.id === id);

describe('R1 S3 route — the goal channel carries a change from today', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
    capturedISLRequestBody = null;
  });
  async function run(payload: Record<string, unknown>) {
    capturedISLRequestBody = null;
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload });
    return { res, isl: capturedISLRequestBody };
  }
  const payload = (graph: unknown, extra: Record<string, unknown> = {}) =>
    ({ graph, options: OPTIONS, goal_node_id: 'monthly_cloud_bill', seed: 'r1-s3-route', ...extra });

  it('SR-1 "maintain" (change_abs 0) is a real target: sent with its frame, not dropped as a scale floor', async () => {
    const { isl } = await run(payload(cloudGraph({ goal_threshold: 0, goal_threshold_cap: 50000, goal_threshold_frame: 'change_abs' })));
    expect(isl).not.toBeNull();
    expect(isl.goal_threshold).toBe(0);
    expect(isl.goal_threshold_frame).toBe('change_abs');
    // No >= constraint is synthesised from a change target.
    expect((isl.goal_constraints ?? []).map((c: any) => c.constraint_id)).not.toContain('auto_goal_threshold');
  });

  it('SR-2 "cut by 20%" (change_rel −0.2): r on the wire, the goal node carries raw_range; whose base rides source', async () => {
    const { isl } = await run(payload(cloudGraph({ goal_threshold: -0.2, goal_threshold_cap: 50000, goal_threshold_frame: 'change_rel' }), { goal_direction: 'minimise' }));
    expect(isl.goal_threshold).toBe(-0.2);
    expect(isl.goal_threshold_frame).toBe('change_rel');
    const goal = nodeOf(isl, 'monthly_cloud_bill');
    expect(goal.raw_range).toEqual({ min: 0, max: 50000 });
    expect(goal.observed_state.source).toBe('brief_extraction'); // ISL derives the owner from it (decision (b))
    expect('baseline_owner' in goal.observed_state).toBe(false);
    // Only the target: every other node is untouched.
    for (const id of ['commitment', 'egress']) {
      expect('raw_range' in nodeOf(isl, id), id).toBe(false);
    }
  });

  it('SR-3 a change_rel LIMIT: r untouched, its node carries the range it was read on; its source says Olumi\'s', async () => {
    const { isl } = await run(payload(cloudGraph(), {
      goal_constraints: [{ constraint_id: 'egress_cut', node_id: 'egress', operator: '<=', value: -0.1, value_frame: 'change_rel' }],
    }));
    const sent = (isl.goal_constraints ?? []).find((c: any) => c.constraint_id === 'egress_cut');
    expect(sent).toBeDefined();
    expect(sent.value).toBe(-0.1);
    expect(sent.value_frame).toBe('change_rel');
    const egress = nodeOf(isl, 'egress');
    expect(egress.raw_range).toEqual({ min: 0, max: 10000 });
    expect(egress.observed_state.source).toBe('cee_inference');
    expect('raw_range' in nodeOf(isl, 'monthly_cloud_bill')).toBe(false);
  });

  it('SR-4 a change_abs LIMIT is scaled with no offset on its node scale', async () => {
    const { isl } = await run(payload(cloudGraph(), {
      goal_constraints: [{ constraint_id: 'egress_down', node_id: 'egress', operator: '<=', value: -500, value_frame: 'change_abs' }],
    }));
    const sent = (isl.goal_constraints ?? []).find((c: any) => c.constraint_id === 'egress_down');
    expect(sent.value).toBeCloseTo(-0.05, 12);
    expect(sent.value_frame).toBe('change_abs');
  });

  it('SR-5 a non-zero change_abs on a node with no scale is refused BY NAME, and says so', async () => {
    const { res, isl } = await run(payload(cloudGraph(), {
      goal_constraints: [{ constraint_id: 'commit_up', node_id: 'commitment', operator: '>=', value: 3, value_frame: 'change_abs' }],
    }));
    expect((isl?.goal_constraints ?? []).map((c: any) => c.constraint_id)).not.toContain('commit_up');
    const body = JSON.stringify(res.json());
    expect(body).toContain('CONSTRAINT_REFUSED_FRAME_FIDELITY');
    expect(body).toContain('commit_up');
  });

  it('SR-6 CONTROL: a level request carries no raw_range, no baseline_owner and no quantity_frame anywhere', async () => {
    const { isl } = await run(payload(cloudGraph({ goal_threshold: 0.8, goal_threshold_cap: 50000, goal_threshold_frame: 'level' }), {
      goal_constraints: [{ constraint_id: 'egress_cap', node_id: 'egress', operator: '<=', value: 4000, value_frame: 'level' }],
    }));
    const text = JSON.stringify(isl);
    expect(text).not.toContain('raw_range');
    expect(text).not.toContain('baseline_owner');
    expect(text).not.toContain('quantity_frame');
  });

  it('SR-8 ISL\'s frame verdict reaches CEE on constraint_results, by presence; an unknown token is dropped', async () => {
    // One limit per node: limits sharing a node and operator are merged before ISL.
    const spendNode = (id: string, cap: number) => ({
      id, kind: 'factor', label: id,
      observed_state: { value: 0.3, raw_value: 0.3 * cap, cap, unit: 'GBP/month', source: 'brief_extraction' },
    });
    const { res } = await run(payload(
      cloudGraph({}, [spendNode('support_spend', 20000), spendNode('licence_spend', 5000)], [
        { from: 'commitment', to: 'support_spend', strength: { mean: -0.2, std: 0.1 } },
        { from: 'support_spend', to: 'monthly_cloud_bill', strength: { mean: 0.2, std: 0.1 } },
        { from: 'commitment', to: 'licence_spend', strength: { mean: -0.2, std: 0.1 } },
        { from: 'licence_spend', to: 'monthly_cloud_bill', strength: { mean: 0.2, std: 0.1 } },
      ]),
      {
        goal_constraints: [
          { constraint_id: 'egress_cut', node_id: 'egress', operator: '<=', value: -0.1, value_frame: 'change_rel' },
          { constraint_id: 'support_down', node_id: 'support_spend', operator: '<=', value: -500, value_frame: 'change_abs' },
          { constraint_id: 'licence_junk', node_id: 'licence_spend', operator: '<=', value: -400, value_frame: 'change_abs', label: 'JUNK VERDICT' },
        ],
      },
    ));
    const body = res.json() as any;
    const rows = (body.constraint_results ?? []) as any[];
    const byId = (id: string) => rows.find((r) => r.constraint_id === id);
    expect(byId('egress_cut')?.frame_verdict).toBe('estimate_only');
    expect(byId('support_down')?.frame_verdict).toBe('scored');
    expect(byId('licence_junk')).toBeDefined();
    expect('frame_verdict' in byId('licence_junk')).toBe(false);
  });

  it('SR-7 a node the producer typed as a CHANGE reaches ISL as one', async () => {
    const { isl } = await run(payload(cloudGraph({}, [
      { id: 'code_quality_change', kind: 'factor', label: 'Code quality change', quantity_frame: 'change', observed_state: { value: 0 } },
    ], [{ from: 'code_quality_change', to: 'monthly_cloud_bill', strength: { mean: 0.1, std: 0.05 } }])));
    expect(nodeOf(isl, 'code_quality_change')?.quantity_frame).toBe('change');
  });

  it('SR-9 MIXED GRADE on one node, on the real ISL egress: no raw_range when one change_rel limit on it is not decision-grade (Codex #403 5878770045)', async () => {
    // Churn with no cap: the bare limit can only derive its range; the '%' limit reads the percent rung.
    const churn = { id: 'churn', kind: 'factor', label: 'Monthly churn', observed_state: { value: 0.035, unit: '%', source: 'brief_extraction' } };
    const edge = { from: 'churn', to: 'monthly_cloud_bill', strength: { mean: 0.2, std: 0.05 } };
    const bare = { constraint_id: 'churn_bare', node_id: 'churn', operator: '<=', value: -0.2, value_frame: 'change_rel' };
    // A two-sided band: the route keeps only the tighter of two same-operator limits on one node, so both
    // reach ISL only as a band (<= and >=), which is where the shared raw_range leaked.
    const pct = { constraint_id: 'churn_pct', node_id: 'churn', operator: '>=', value: -0.3, value_frame: 'change_rel', unit: '%' };
    // CONTROL: the '%' limit alone qualifies, so the egress probe can see a raw_range on this node.
    const alone = await run(payload(cloudGraph({}, [churn], [edge]), { goal_constraints: [pct] }));
    expect(nodeOf(alone.isl, 'churn')?.raw_range).toEqual({ min: 0, max: 1 });
    for (const constraints of [[bare, pct], [pct, bare]]) {
      const { isl } = await run(payload(cloudGraph({}, [churn], [edge]), { goal_constraints: constraints }));
      const sent = (isl.goal_constraints ?? []).map((c: any) => c.constraint_id).sort();
      expect(sent).toEqual(['churn_bare', 'churn_pct']);
      expect('raw_range' in nodeOf(isl, 'churn'), constraints.map((c) => c.constraint_id).join(',')).toBe(false);
    }
  });
});
