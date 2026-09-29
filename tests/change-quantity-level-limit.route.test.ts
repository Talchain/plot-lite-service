/**
 * R1 (0.61.0) — a LEVEL limit on a `quantity_frame: 'change'` node reaches ISL as that node's own change (`change_abs`).
 * Served cloud journey (MG #72 5881406690 / 5881501167): "no more than 2 weeks of migration downtime" on a computed
 * node was withheld as a level (CONSTRAINT_TARGET_UNRELIABLE); the same limit as `change_abs` was decision-grade.
 * The marker is typed (CEE's construction drafter; AIQ 5881263293 / 5881419717), never inferred from "computed + 0".
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { changeQuantityLevelLimitsAsChanges } from '../src/lib/change-quantity-limits.js';
import type { GoalConstraint } from '../src/types/engine-v3.js';

let captured: any = null;
const outcome = (i: number) => ({ mean: 0.6 + i * 0.1, std: 0.1, p10: 0.4, p50: 0.6, p90: 0.8, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1 });
const mockISL = {
  isEnabled: () => true,
  isAvailable: async () => true,
  validateCausal: async () => ({ status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [], explanation: { summary: 'm', reasoning: 't' }, source: 'isl' }),
  analyseSensitivity: async () => ({ overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' }),
  analyseRobustness: async (_g: any, _goal: string, options: any[]) => ({
    options: options.map((o: any, i: number) => ({ option_id: o.id, outcome: outcome(i), rank: i + 1 })),
    edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const, edge_sensitivity_status: 'available' as const,
    factors: [], value_of_information: [], factors_provenance: 'unavailable' as const, factor_sensitivity_status: 'skipped_no_factor_values' as const,
    overall_robustness: 'robust' as const, robustness_score: 0.8, fragile_edges: [], robust_edges: [], latency_ms: 1, source: 'isl' as const,
  }),
  analyseFactorSensitivity: async () => ({ factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const }),
  computeCounterfactual: async (): Promise<never> => { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_e: string, body: any): Promise<{ data: T | null; error: string | null }> {
    captured = body;
    return { data: { options: (body.options || []).map((o: any, i: number) => ({ option_id: o.id, outcome: outcome(i), rank: i + 1 })),
      edges: [], factors: [], value_of_information: [], overall_robustness: 'robust', robustness_score: 0.8, fragile_edges: [], robust_edges: [] } as T, error: null };
  },
};
vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISL, islService: mockISL };
});
const { createServer } = await import('../src/createServer.js');

const LIMIT = { constraint_id: 'agent-lane:downtime:<=', node_id: 'downtime', operator: '<=' as const, value: 2, unit: 'weeks', label: 'Migration downtime', provenance: 'explicit', value_frame: 'level' as const };
function graph(downtime: Record<string, unknown>) {
  return {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Cloud savings' },
      { id: 'complexity', kind: 'factor', label: 'Migration complexity', observed_state: { value: 0.5, raw_value: 5, cap: 10 } },
      { id: 'downtime', kind: 'factor', label: 'Migration downtime', observed_state: { value: 0, raw_value: 0, cap: 8, unit: 'weeks', source: 'cee_inference' }, ...downtime },
    ],
    edges: [
      { from: 'complexity', to: 'downtime', strength: { mean: 0.5, std: 0.1 } },
      { from: 'downtime', to: 'goal', strength: { mean: -0.4, std: 0.1 } },
      { from: 'complexity', to: 'goal', strength: { mean: 0.3, std: 0.1 } },
    ],
  };
}
const OPTIONS = [
  { id: 'opt_stay', label: 'Stay on AWS', interventions: { complexity: 0 } },
  { id: 'opt_gcp', label: 'Switch to GCP', interventions: { complexity: 0.9 } },
];

describe('pure: changeQuantityLevelLimitsAsChanges', () => {
  const nodes = (qf?: string, raw = 0) => [{ id: 'downtime', ...(qf ? { quantity_frame: qf } : {}), observed_state: { value: raw / 8, raw_value: raw } }];
  it('Q-1 RED: a level limit on a marked node held at 0 becomes change_abs, id unchanged', () => {
    expect(changeQuantityLevelLimitsAsChanges([LIMIT as GoalConstraint], nodes('change'))).toEqual([{ ...LIMIT, value_frame: 'change_abs' }]);
  });
  it('Q-2 CONTROL: no marker (or quantity_frame level) → untouched, even when held at 0 (never inferred from "0")', () => {
    for (const qf of [undefined, 'level']) expect(changeQuantityLevelLimitsAsChanges([LIMIT as GoalConstraint], nodes(qf))[0]).toBe(LIMIT);
  });
  it('Q-3 CONTROL: a marked node holding a NON-ZERO level contradicts "0 by definition" → untouched (fail closed)', () => {
    expect(changeQuantityLevelLimitsAsChanges([LIMIT as GoalConstraint], nodes('change', 1))[0]).toBe(LIMIT);
  });
  it('Q-4 CONTROL: a limit already framed as a change is untouched', () => {
    const rel = { ...LIMIT, value_frame: 'change_rel' as const } as GoalConstraint;
    expect(changeQuantityLevelLimitsAsChanges([rel], nodes('change'))[0]).toBe(rel);
  });
});

describe('route: the marked limit reaches ISL as change_abs; the unmarked one is withheld as before', () => {
  let app: FastifyInstance;
  beforeAll(async () => { process.env.RATE_LIMIT_ENABLED = 'false'; app = await createServer(); await app.ready(); }, 60_000);
  afterAll(async () => { await app?.close(); });
  const run = async (downtime: Record<string, unknown>) => {
    captured = null;
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload: { graph: graph(downtime), options: OPTIONS, goal_node_id: 'goal', seed: '42', goal_constraints: [LIMIT] } });
    const body = res.json() as any;
    const codes = (body.inference_warnings ?? []).filter((w: any) => w.code === 'CONSTRAINT_TARGET_UNRELIABLE').map((w: any) => w.code);
    return { status: res.statusCode, sent: (captured?.goal_constraints ?? []) as any[], codes };
  };
  it('Q-5 RED (wire): quantity_frame change → ISL receives the limit as change_abs with the same id and value; not withheld', async () => {
    const r = await run({ quantity_frame: 'change' });
    expect(r.status).toBe(200);
    expect(r.sent.find((c) => c.constraint_id === LIMIT.constraint_id)).toMatchObject({ value_frame: 'change_abs', operator: '<=' });
    expect(r.codes).toEqual([]);
  });
  it('Q-6 CONTROL (wire): no marker → the level limit is NOT rewritten (today\'s behaviour: unanchored, withheld)', async () => {
    const r = await run({});
    expect(r.status).toBe(200);
    const sent = r.sent.find((c) => c.constraint_id === LIMIT.constraint_id);
    expect(sent?.value_frame).not.toBe('change_abs');
    expect(r.codes.length).toBeGreaterThan(0);
  });
});
