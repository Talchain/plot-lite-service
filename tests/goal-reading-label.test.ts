import { expect, it } from 'vitest';

const READING = { operation: 'product', stated_in_brief: false, reading_licence: 'olumi_reading', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'], addends: ['churn_loss'] };

function rawGraph() {
  return {
    nodes: [
      { id: 'mrr', kind: 'goal', label: 'MRR', goal_threshold_cap: 25000, nonlinear_identity: structuredClone(READING) },
      { id: 'pro_plan_price', kind: 'factor', label: 'Pro plan price', scale_frame: 200, observed_state: { value: 0.245, raw_value: 49, unit: 'GBP/month' } },
      { id: 'pro_paying_subscribers', kind: 'factor', label: 'Pro paying subscribers', scale_frame: 2000, observed_state: { value: 0.15, unit: 'subscribers' } },
      { id: 'churn_loss', kind: 'risk', label: 'MRR lost to price-driven churn', scale_frame: 1000, observed_state: { value: 0.1 } },
    ] as any[],
    edges: [...READING.factor_ids, ...READING.addends].map((from) => ({ from, to: 'mrr', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1 })),
  };
}

// Dynamic import keeps the missing-module HEAD baseline RED at the individual row.
const readings = async (g: ReturnType<typeof rawGraph>) => (await import('../src/lib/goal-reading-label.js')).licensedGoalReadings(g);

it('meta whole reading keeps exact mrr/factor/addend ids, raw scale_frame and goal cap, without mutation', async () => {
  const g = rawGraph();
  const before = structuredClone(g);
  const out = await readings(g);
  expect(out).toEqual([{ node_id: 'mrr', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'], addends: ['churn_loss'] }]);
  expect(g).toEqual(before);
  out[0].factor_ids.push('not_a_factor');
  out[0].addends.push('not_an_addend');
  expect(g).toEqual(before);
});

it('meta excludes an unlicensed product, a stated product and licensed frameless addend', async () => {
  const g = rawGraph();
  delete g.nodes[0].nonlinear_identity.reading_licence;
  expect(await readings(g)).toEqual([]);
  g.nodes[0].nonlinear_identity = { ...READING, stated_in_brief: true, reading_licence: undefined };
  delete g.nodes[0].nonlinear_identity.reading_licence;
  expect(await readings(g)).toEqual([]);
  g.nodes[0].nonlinear_identity = structuredClone(READING);
  delete g.nodes[3].scale_frame;
  expect(await readings(g)).toEqual([]);
});

it('meta includes a licensed carrier on the goal path without the old three-user-level requirement', async () => {
  const g = rawGraph();
  g.nodes[0] = { ...g.nodes[0], id: 'pro_plan_mrr', kind: 'outcome', scale_frame: 25000 };
  g.nodes.push({ id: 'mrr', kind: 'goal' });
  g.edges.forEach((e) => { e.to = 'pro_plan_mrr'; });
  g.edges.push({ from: 'pro_plan_mrr', to: 'mrr', strength: { mean: 1, std: 0.01 }, exists_probability: 1 });
  expect(await readings(g)).toEqual([{ node_id: 'pro_plan_mrr', factor_ids: READING.factor_ids, addends: READING.addends }]);
});

it('meta excludes a licensed product off the directed goal path, including bidirected-only reach', async () => {
  const g = rawGraph();
  g.nodes[0].kind = 'outcome';
  g.nodes[0].scale_frame = 25000;
  g.nodes.push({ id: 'other_goal', kind: 'goal' });
  expect(await readings(g)).toEqual([]);
  g.edges.push({ from: 'mrr', to: 'other_goal', edge_type: 'bidirected', strength: { mean: 1, std: 0.01 }, exists_probability: 1 } as any);
  expect(await readings(g)).toEqual([]);
});

it('meta reuses variant (a) for an eligible licensed no-addend carrier and emits an empty addends array', async () => {
  const g = rawGraph();
  g.nodes[0] = { ...g.nodes[0], id: 'pro_plan_mrr', kind: 'outcome', nonlinear_identity: { ...READING, addends: undefined } };
  g.nodes.push({ id: 'mrr', kind: 'goal' });
  g.edges = [{ from: 'pro_plan_mrr', to: 'mrr', strength: { mean: 1, std: 0.01 }, exists_probability: 1 }];
  expect(await readings(g)).toEqual([{ node_id: 'pro_plan_mrr', factor_ids: READING.factor_ids, addends: [] }]);
});
