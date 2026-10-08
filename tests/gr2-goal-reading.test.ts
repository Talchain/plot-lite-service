import { describe, expect, it } from 'vitest';
import {
  attachIdentityExecutionFrames,
  goalCarrierIds,
  toISLRobustnessRequest,
  withdrawInferredUnevaluatedIdentities,
} from '../src/integrations/isl/translator-v3.js';
import { goalIdentitiesNotEvaluated } from '../src/lib/goal-identity-withhold.js';
import type { EngineGraphV3, IdentityEvaluationV3 } from '../src/types/engine-v3.js';

const FACTORS = ['pro_plan_price', 'pro_paying_subscribers'];
const ADDENDS = ['churn_loss'];
const PRODUCT = { operation: 'product' as const, factor_ids: FACTORS, addends: ADDENDS, stated_in_brief: false };
const LICENSED = { ...PRODUCT, reading_licence: 'olumi_reading' as const };

/** Paul's Run-1 shape; no current MRR, price from the brief, subscribers Olumi's. */
function graph(licensed = true): EngineGraphV3 {
  return {
    nodes: [
      { id: 'mrr', kind: 'goal', label: 'MRR', nonlinear_identity: licensed ? LICENSED : PRODUCT },
      { id: FACTORS[0], kind: 'factor', label: 'Pro plan price', observed_state: { value: 0.245, raw_value: 49, cap: 200, unit: 'GBP/month', source: 'brief_extraction' } },
      { id: FACTORS[1], kind: 'factor', label: 'Pro paying subscribers', observed_state: { value: 0.15, raw_value: 300, cap: 2000, unit: 'subscribers', source: 'cee_inference' } },
      { id: 'churn_loss', kind: 'risk', label: 'MRR lost to price-driven churn', observed_state: { value: -0.1, raw_value: -100, cap: 1000 } },
    ],
    edges: [...FACTORS, ...ADDENDS].map((from) => ({ from, to: 'mrr', exists_probability: 1, strength: { mean: from === 'churn_loss' ? -0.8 : 0.5, std: 0.1 } })),
  };
}

function forwarded(g = graph(), caps = new Map([['mrr', 25000]])) {
  const request = toISLRobustnessRequest(g, [], 'mrr', 'gr2-unit');
  const derived: Parameters<typeof attachIdentityExecutionFrames>[4] = [];
  const notForwarded = attachIdentityExecutionFrames(request.graph.nodes, g.nodes, new Map(), caps, derived, goalCarrierIds(g.nodes, g.edges));
  return { request, notForwarded, derived };
}

const evaluation = (evaluated: boolean, node_id = 'mrr'): IdentityEvaluationV3 => ({ ...PRODUCT, node_id, evaluated });

describe('GOAL-REACH build 2 — exact identity rows', () => {
  it('L1 licensed mrr product reaches the ISL request with both factors and churn_loss', () => {
    const g = graph();
    const before = structuredClone(g);
    const { request, notForwarded } = forwarded(g);
    expect(request.graph.nodes.find((n) => n.id === 'mrr')?.nonlinear_identity).toEqual(PRODUCT);
    expect(notForwarded).toEqual([]);
    expect(Object.fromEntries(request.graph.nodes.map((n) => [n.id, n.execution_frame]))).toEqual({
      mrr: { frame: 25000, carrier: 'cap' },
      pro_plan_price: { frame: 200, carrier: 'cap' },
      pro_paying_subscribers: { frame: 2000, carrier: 'cap' },
      churn_loss: { frame: 1000, carrier: 'cap' },
    });
    expect(g).toEqual(before);
  });

  it('L2 no licence still deletes mrr and names inferred_identity_unconfirmed', () => {
    const { request, notForwarded } = forwarded(graph(false));
    expect(request.graph.nodes.find((n) => n.id === 'mrr')).not.toHaveProperty('nonlinear_identity');
    expect(notForwarded).toEqual([{ node_id: 'mrr', reason: 'inferred_identity_unconfirmed', frameless_node_ids: [] }]);
    expect(request.graph.nodes.every((n) => n.execution_frame === undefined)).toBe(true);
  });

  it.each(['mrr', ...FACTORS, ...ADDENDS])('L3 licensed product with frameless %s loses to variant (b)', (id) => {
    const g = graph();
    delete g.nodes.find((n) => n.id === id)!.observed_state;
    const { request, notForwarded } = forwarded(g, id === 'mrr' ? new Map() : new Map([['mrr', 25000]]));
    expect(request.graph.nodes.find((n) => n.id === 'mrr')).not.toHaveProperty('nonlinear_identity');
    expect(notForwarded).toEqual([{ node_id: 'mrr', reason: 'inferred_identity_frame_unresolved', frameless_node_ids: [id] }]);
    expect(request.graph.nodes.every((n) => n.execution_frame === undefined)).toBe(true);
  });

  it('L5 evaluated:true on licensed mrr keeps the chance', () => {
    expect(goalIdentitiesNotEvaluated(graph(), [evaluation(true)], [])).toEqual([]);
  });
  it('L5 silence on licensed mrr withholds, bound to mrr', () => {
    expect(goalIdentitiesNotEvaluated(graph(), undefined, []).map((n) => n.node_id)).toEqual(['mrr']);
  });
  it('L5 evaluated:false on licensed mrr withholds, bound to mrr', () => {
    expect(goalIdentitiesNotEvaluated(graph(), [evaluation(false)], []).map((n) => n.node_id)).toEqual(['mrr']);
  });
  it('L5 another evaluated node cannot license mrr', () => {
    expect(goalIdentitiesNotEvaluated(graph(), [evaluation(true, 'other_mrr')], []).map((n) => n.node_id)).toEqual(['mrr']);
  });

  it('L6 reading_licence is absent from the entire ISL request, identity calculation unchanged', () => {
    const { request } = forwarded();
    expect(JSON.stringify(request)).not.toContain('reading_licence');
    expect(request.graph.nodes.find((n) => n.id === 'mrr')?.nonlinear_identity).toEqual(PRODUCT);
  });

  it('licensed carrier bypasses old three-user-level recognition, still using canonical frames', () => {
    const g = graph();
    g.nodes[0] = { ...g.nodes[0], id: 'pro_plan_mrr', kind: 'outcome', observed_state: { cap: 25000 } };
    g.nodes.push({ id: 'mrr', kind: 'goal', label: 'MRR' });
    g.edges.forEach((e) => { e.to = 'pro_plan_mrr'; });
    g.edges.push({ from: 'pro_plan_mrr', to: 'mrr', strength: { mean: 1, std: 0.01 }, exists_probability: 1 });
    expect([...goalCarrierIds(g.nodes, g.edges)]).toEqual([]);
    const { request, notForwarded } = forwarded(g);
    expect(request.graph.nodes.find((n) => n.id === 'pro_plan_mrr')?.nonlinear_identity).toEqual(PRODUCT);
    expect(notForwarded).toEqual([]);
  });

  it.each([true, false])('card-domain carrier with licence %j preserves the old reconciliation recognition', (licensed) => {
    const g = graph(licensed);
    g.nodes[0] = { ...g.nodes[0], id: 'pro_plan_mrr', kind: 'outcome', observed_state: { value: 0.584, raw_value: 14600, cap: 25000 } };
    g.nodes[2].observed_state!.source = 'user_set';
    g.nodes.push({ id: 'mrr', kind: 'goal', label: 'MRR', observed_state: { value: 0.584, raw_value: 14600, cap: 25000, unit: 'GBP/month', source: 'brief_extraction' } });
    g.edges.forEach((e) => { e.to = 'pro_plan_mrr'; });
    g.edges.push({ from: 'pro_plan_mrr', to: 'mrr', strength: { mean: 1, std: 0.01 }, exists_probability: 1 });
    expect([...goalCarrierIds(g.nodes, g.edges)]).toEqual(['pro_plan_mrr']);
    const { request, notForwarded } = forwarded(g);
    expect(request.graph.nodes.find((n) => n.id === 'pro_plan_mrr')?.nonlinear_identity).toEqual(licensed ? PRODUCT : undefined);
    expect(notForwarded).toEqual(licensed ? [] : [{ node_id: 'pro_plan_mrr', reason: 'inferred_identity_unconfirmed', frameless_node_ids: [] }]);
  });

  it('stated frameless product and inferred sum still follow their existing rules', () => {
    const g = graph();
    g.nodes[0].nonlinear_identity = { ...PRODUCT, stated_in_brief: true };
    expect(forwarded(g, new Map()).request.graph.nodes[0].nonlinear_identity).toEqual({ ...PRODUCT, stated_in_brief: true });
    g.nodes[0].nonlinear_identity = { ...PRODUCT, operation: 'sum' };
    expect(forwarded(g).request.graph.nodes[0].nonlinear_identity).toEqual({ ...PRODUCT, operation: 'sum' });
  });

  it('variant (a) may derive a licensed no-addend outcome frame, never a goal frame', () => {
    const g = graph();
    g.nodes[0] = { ...g.nodes[0], id: 'pro_plan_mrr', kind: 'outcome', nonlinear_identity: { ...LICENSED, addends: undefined } };
    g.nodes.push({ id: 'mrr', kind: 'goal' });
    g.edges = [{ from: 'pro_plan_mrr', to: 'mrr', exists_probability: 1, strength: { mean: 1, std: 0.01 } }];
    const { request, notForwarded, derived } = forwarded(g);
    expect(notForwarded).toEqual([]);
    expect(request.graph.nodes.find((n) => n.id === 'pro_plan_mrr')?.execution_frame).toEqual({ frame: 400000, carrier: 'cap' });
    expect(derived).toEqual([{ node_id: 'pro_plan_mrr', frame: 400000, source: 'olumi_derived_product_of_factor_frames', factor_frames: [{ node_id: FACTORS[0], frame: 200 }, { node_id: FACTORS[1], frame: 2000 }] }]);
  });

  it('variant (a) cannot invent a licensed addend carrier frame', () => {
    const g = graph();
    g.nodes[0].kind = 'outcome';
    const { request, notForwarded, derived } = forwarded(g, new Map());
    expect(request.graph.nodes[0]).not.toHaveProperty('nonlinear_identity');
    expect(notForwarded).toEqual([{ node_id: 'mrr', reason: 'inferred_identity_frame_unresolved', frameless_node_ids: ['mrr'] }]);
    expect(derived).toEqual([]);
  });

  it('goal observed cap precedes the goal-threshold cap fallback', () => {
    const g = graph();
    g.nodes[0].observed_state = { value: 0.588, raw_value: 14700, cap: 30000 };
    expect(forwarded(g).request.graph.nodes[0].execution_frame).toEqual({ frame: 30000, carrier: 'cap' });
  });

  it('variant (c) keeps ISL reconciliation authoritative on a licensed product', () => {
    const { request } = forwarded();
    const result = withdrawInferredUnevaluatedIdentities(request.graph.nodes, [{ code: 'IDENTITY_NOT_EVALUATED', severity: 'blocker', identity: { node_id: 'mrr', withheld_reason: 'identity_inconsistent', reconstructed: 14600, stated: 30000, mismatch_share: 0.513333 } }]);
    expect(result).toEqual([{ node_id: 'mrr', reason: 'inferred_identity_inconsistent', frameless_node_ids: [], reconciliation: { reconstructed: 14600, stated: 30000, mismatch_share: 0.513333 } }]);
    expect(request.graph.nodes[0]).not.toHaveProperty('nonlinear_identity');
    expect(request.graph.nodes.every((n) => n.execution_frame === undefined)).toBe(true);
  });
});
