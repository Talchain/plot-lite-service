/**
 * Lane A1c — /v2/run egress: lever-SOURCED fragile edges are suppressed from the
 * four action-guidance surfaces, with fallback to the non-lever fragile edge.
 * Scope containment: assumptions_ledger STILL names the lever-sourced edges
 * (A1c must NOT touch it). This mirrors the post-deploy runtime replay.
 *
 * ISL mock returns robustness.fragile_edges sourced from levers (the residue) +
 * one non-lever fragile edge. Levers: fac_leadership_capacity / fac_dev_capacity /
 * fac_hiring_cost (option-pinned by all options). Non-lever: fac_time_pressure.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Deliver Productive, Quality Launch Within Budget' },
    { id: 'fac_leadership_capacity', kind: 'factor', label: 'Technical Leadership Capacity', observed_state: { value: 0.6 } },
    { id: 'fac_dev_capacity', kind: 'factor', label: 'Additional Developer Capacity', observed_state: { value: 0.5 } },
    { id: 'fac_hiring_cost', kind: 'factor', label: 'Annual Hiring Cost', observed_state: { value: 0.4 } },
    { id: 'fac_time_pressure', kind: 'factor', label: 'Launch Deadline Pressure', observed_state: { value: 0.5 } },
    { id: 'out_delivery_speed', kind: 'outcome', label: 'On-Time Delivery Likelihood' },
    { id: 'out_code_quality', kind: 'outcome', label: 'Code Quality and Technical Standards' },
    { id: 'risk_launch_miss', kind: 'risk', label: 'Launch Date Miss' },
  ],
  edges: [
    { from: 'fac_leadership_capacity', to: 'out_code_quality', exists_probability: 0.88, strength: { mean: 0.6, std: 0.15 } },
    { from: 'fac_dev_capacity', to: 'out_delivery_speed', exists_probability: 0.8, strength: { mean: 0.45, std: 0.16 } },
    { from: 'fac_hiring_cost', to: 'goal', exists_probability: 0.9, strength: { mean: -0.3, std: 0.1 } },
    { from: 'fac_time_pressure', to: 'risk_launch_miss', exists_probability: 0.9, strength: { mean: 0.55, std: 0.12 } },
    { from: 'out_delivery_speed', to: 'goal', exists_probability: 0.95, strength: { mean: 0.45, std: 0.1 } },
    { from: 'out_code_quality', to: 'goal', exists_probability: 0.92, strength: { mean: 0.3, std: 0.1 } },
    { from: 'risk_launch_miss', to: 'goal', exists_probability: 0.9, strength: { mean: -0.35, std: 0.12 } },
  ],
};
const OPTIONS = [
  { id: 'opt_hire', label: 'Hire', interventions: { fac_leadership_capacity: { value: 1, source: 'user_specified' }, fac_dev_capacity: { value: 1, source: 'user_specified' }, fac_hiring_cost: { value: 1, source: 'user_specified' } } },
  { id: 'opt_tech_lead', label: 'Tech lead', interventions: { fac_leadership_capacity: { value: 1, source: 'user_specified' }, fac_dev_capacity: { value: 0, source: 'user_specified' }, fac_hiring_cost: { value: 0.5, source: 'user_specified' } } },
];

// factor_sensitivity: 3 levers (intervention_override) + non-lever.
const FACTOR_SENSITIVITY = [
  { node_id: 'fac_time_pressure', label: 'Launch Deadline Pressure', sensitivity_score: 1, elasticity: 1, influence_score: 0.53, direction: 'negative', attribution_stability: 'low', importance_rank: 1 },
  { node_id: 'fac_leadership_capacity', label: 'Technical Leadership Capacity', sensitivity_score: 0, elasticity: 0, influence_score: 1, direction: 'negative', zero_reason: 'intervention_override', attribution_stability: 'negligible', importance_rank: 5 },
  { node_id: 'fac_dev_capacity', label: 'Additional Developer Capacity', sensitivity_score: 0, elasticity: 0, influence_score: 0.74, direction: 'negative', zero_reason: 'intervention_override', attribution_stability: 'negligible', importance_rank: 3 },
  { node_id: 'fac_hiring_cost', label: 'Annual Hiring Cost', sensitivity_score: 0, elasticity: 0, influence_score: 0.41, direction: 'negative', zero_reason: 'intervention_override', attribution_stability: 'negligible', importance_rank: 4 },
];
// fragile edges: 2 lever-SOURCED (residue) + 1 non-lever, all above thresholds.
const FRAGILE_EDGES = [
  { edge_id: 'fac_dev_capacity->out_delivery_speed', from_id: 'fac_dev_capacity', to_id: 'out_delivery_speed', switch_probability: 0.6, marginal_switch_probability: 0.6, alternative_winner_id: 'opt_tech_lead', severity: 'high' },
  { edge_id: 'fac_leadership_capacity->out_code_quality', from_id: 'fac_leadership_capacity', to_id: 'out_code_quality', switch_probability: 0.5, marginal_switch_probability: 0.5, alternative_winner_id: 'opt_tech_lead', severity: 'high' },
  { edge_id: 'fac_time_pressure->risk_launch_miss', from_id: 'fac_time_pressure', to_id: 'risk_launch_miss', switch_probability: 0.4, marginal_switch_probability: 0.4, alternative_winner_id: 'opt_tech_lead', severity: 'medium' },
];
const robustness = { level: 'low', is_robust: false, recommendation_stability: 0.4, score: 0.4, fragile_edges: FRAGILE_EDGES, robust_edges: [] };
function mockOpts(options: any[]) {
  return options.map((o: any, i: number) => ({ option_id: o.id, outcome: { mean: 0.7 - i * 0.2, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1 }, rank: i + 1, win_probability: i === 0 ? 0.62 : 0.38 }));
}
const svc: any = {
  isEnabled: () => true, isAvailable: async () => true,
  validateCausal: async () => ({ status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [], explanation: { summary: 'm', reasoning: 't' }, source: 'isl' }),
  analyseSensitivity: async () => ({ overall_robustness: 'low', sensitive_parameters: [], recommendations: [], source: 'isl' }),
  analyseRobustness: async (_g: any, _goal: string, o: any[]) => ({ options: mockOpts(o), edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2', edge_sensitivity_status: 'available', factor_sensitivity: FACTOR_SENSITIVITY, factors: [], value_of_information: [], factors_provenance: 'isl:/api/v1/robustness/analyze/v2', factor_sensitivity_status: 'available', overall_robustness: 'low', robustness_score: 0.4, robustness, fragile_edges: FRAGILE_EDGES, robust_edges: [], latency_ms: 50, source: 'isl' }),
  analyseFactorSensitivity: async () => ({ factors: [], value_of_information: [], robustness_label: 'low', robustness_score: 0.4, latency_ms: 0, source: 'unavailable' }),
  computeCounterfactual: async () => { throw new Error('x'); },
  callAnalysisEndpoint: async (_e: string, b: any) => ({ data: { options: mockOpts(b.options || []), edges: [], factor_sensitivity: FACTOR_SENSITIVITY, robustness, overall_robustness: 'low', robustness_score: 0.4, fragile_edges: FRAGILE_EDGES, robust_edges: [] }, error: null }),
};
vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => svc, islService: svc };
});
import { createServer } from '../src/createServer.js';

describe('Lane A1c — /v2/run egress suppresses lever-sourced fragile edges from 4 action surfaces', () => {
  let app: FastifyInstance; let baseUrl: string;
  const ENV = ['RATE_LIMIT_ENABLED', 'CEE_ORCHESTRATOR_ENABLED'] as const;
  const saved: Record<string, string | undefined> = {};
  const LEVER_LABELS = ['Technical Leadership Capacity', 'Additional Developer Capacity', 'Annual Hiring Cost'];
  const LEVER_IDS = ['fac_leadership_capacity', 'fac_dev_capacity', 'fac_hiring_cost'];
  const namesLever = (s: string) => LEVER_LABELS.some((l) => s.includes(l));

  beforeAll(async () => {
    for (const k of ENV) saved[k] = process.env[k];
    process.env.RATE_LIMIT_ENABLED = '0'; process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer(); await app.listen({ port: 0, host: '127.0.0.1' });
    const a: any = app.server.address(); baseUrl = `http://127.0.0.1:${a.port}`;
  });
  afterAll(async () => { await app?.close(); for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it('4 action surfaces exclude lever-sourced edges (name the non-lever edge); assumptions_ledger STILL names levers', async () => {
    const res = await fetch(`${baseUrl}/v2/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: '42' }) });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const m1 = body.m1_coaching ?? {};

    // Surface 1: decision_brief.what_would_change — no lever; non-lever edge present.
    const wwc = body.decision_brief?.what_would_change ?? [];
    expect(wwc.some((s: string) => namesLever(s))).toBe(false);
    expect(wwc.some((s: string) => s.includes('Launch Deadline Pressure'))).toBe(true); // non-lever fragile edge surfaced

    // Surface 2: high_uncertainty story headline — no lever.
    const headlines = Object.values(m1.story_headlines ?? {}).join(' || ');
    expect(namesLever(headlines)).toBe(false);

    // Surface 3: top_fragile_edge — not a lever-sourced edge.
    expect(m1.top_fragile_edge ? namesLever(m1.top_fragile_edge.label ?? '') : false).toBe(false);

    // Surface 4: next_actions — no edge action names a lever.
    for (const a of (m1.next_actions ?? [])) {
      if (a.target_type === 'edge') expect(namesLever(a.action ?? '')).toBe(false);
    }

    // SCOPE CONTAINMENT (tightening 3): assumptions_ledger STILL names a lever-sourced edge.
    const al = m1.assumptions_ledger?.assumptions ?? [];
    const alText = JSON.stringify(al);
    expect(LEVER_IDS.some((id) => alText.includes(id)), 'assumptions_ledger still names a lever residue (A1c untouched)').toBe(true);
  });
});
