import { describe, expect, it } from 'vitest';
import { islDrawStructureKey } from '../src/lib/isl-draw-structure-key.js';
import { canonicaliseISLRequest } from '../src/normalisation/canonicalise.js';
import {
  goalIdentityWithheldMessage,
  goalIdentitiesNotEvaluated,
  limitIdentityWithheldMessage,
  unevaluatedIdentities,
} from '../src/lib/goal-identity-withhold.js';

const ACCUMULATION = {
  operation: 'accumulation',
  factor_ids: ['stock_today', 'churn_rate', 'inflow'],
  horizon_months: 12,
  rate_scale: 0.01,
  stated_in_brief: false,
};

const request = (identity: unknown) => ({
  graph: {
    nodes: [{ id: 'stock_at_horizon', kind: 'outcome', nonlinear_identity: identity }],
    edges: [],
  },
});

const graph = (identity: unknown) => ({
  nodes: [
    { id: 'stock_today', label: 'Stock today' },
    { id: 'churn_rate', label: 'Monthly churn' },
    { id: 'inflow', label: 'Monthly inflow' },
    { id: 'stock_at_horizon', label: 'Subscribers at month 12', nonlinear_identity: identity },
    { id: 'mrr', kind: 'goal', label: 'MRR' },
  ],
  edges: [{ from: 'stock_at_horizon', to: 'mrr' }],
});

describe('T3 accumulation draw structure', () => {
  it('identical carriers have identical non-null keys', () => {
    const key = islDrawStructureKey(request(ACCUMULATION));
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).toBe(islDrawStructureKey(request(structuredClone(ACCUMULATION))));
  });

  it.each([
    ['horizon_months', { ...ACCUMULATION, horizon_months: 24 }],
    ['rate_scale', { ...ACCUMULATION, rate_scale: 1 }],
  ])('a change only to %s changes the key', (_field, changed) => {
    expect(islDrawStructureKey(request(changed))).not.toBe(islDrawStructureKey(request(ACCUMULATION)));
  });

  it.each([
    ['churn spread', [0.246, 0.246]],
    ['inflow spread', [0.136, 0.136]],
    ['spread positions', [0.246, 0.136]],
  ])('a change only to %s changes the key', (_field, rateSigmaLog) => {
    const identity = { ...ACCUMULATION, rate_sigma_log: [0.136, 0.246] };
    const changed = { ...identity, rate_sigma_log: rateSigmaLog };
    expect(islDrawStructureKey(request(changed))).not.toBe(islDrawStructureKey(request(identity)));
  });

  it('absent and explicit zero rate spreads have the same key', () => {
    expect(islDrawStructureKey(request(ACCUMULATION))).toBe(
      islDrawStructureKey(request({ ...ACCUMULATION, rate_sigma_log: [0, 0] })),
    );
  });
});

describe('accumulation canonicalisation keeps positional operands and rate spreads', () => {
  it('preserves churn then inflow spread order alongside stock/churn/inflow factor order', () => {
    const identity = { ...ACCUMULATION, rate_sigma_log: [0.246, 0.136] };
    const canonical = canonicaliseISLRequest(request(identity)) as ReturnType<typeof request>;
    expect(canonical.graph.nodes[0].nonlinear_identity).toEqual(identity);
  });

  it('swapping rate spread positions changes the canonical request', () => {
    const identity = { ...ACCUMULATION, rate_sigma_log: [0.136, 0.246] };
    const changed = { ...identity, rate_sigma_log: [0.246, 0.136] };
    expect(canonicaliseISLRequest(request(changed))).not.toEqual(canonicaliseISLRequest(request(identity)));
  });
});

describe('T6 operation sites: withheld reading refuses accumulation arithmetic', () => {
  it('unevaluatedIdentities preserves withholding but supplies no sum/product reading', () => {
    expect(unevaluatedIdentities(graph(ACCUMULATION), undefined, [])).toEqual([{
      node_id: 'stock_at_horizon',
      label: 'Subscribers at month 12',
      parts: [],
      operation: null,
    }]);
    expect(goalIdentitiesNotEvaluated(graph(ACCUMULATION), undefined, [])).toEqual(
      unevaluatedIdentities(graph(ACCUMULATION), undefined, []),
    );
  });

  it('evaluated accumulation is not withheld', () => {
    const evaluation = { node_id: 'stock_at_horizon', operation: 'accumulation',
      stated_in_brief: true, evaluated: true, horizon_months: 12, reason: null } as any;
    expect(goalIdentitiesNotEvaluated(graph({ ...ACCUMULATION, stated_in_brief: true }), [evaluation], [])).toEqual([]);
  });

  it('goalIdentityWithheldMessage uses the existing generic sentence for a null reading', () => {
    const row = { node_id: 'stock_at_horizon', label: 'Subscribers at month 12',
      operation: null, parts: ['Stock today', 'Monthly churn', 'Monthly inflow'] };
    expect(goalIdentityWithheldMessage([row])).toBe(
      "Not shown. 'Subscribers at month 12' depends on other figures in the model, but this run couldn't calculate it that way, so the figures for each option would be wrong.",
    );
  });

  it('limitIdentityWithheldMessage uses the existing generic sentence for a null reading', () => {
    const row = { node_id: 'stock_at_horizon', label: 'Subscribers at month 12',
      operation: null, parts: ['Stock today', 'Monthly churn', 'Monthly inflow'] };
    expect(limitIdentityWithheldMessage('MRR', [row])).toBe(
      "Not shown for the limit on 'MRR'. 'Subscribers at month 12' depends on other figures in the model, but this run couldn't calculate it that way, so the figures for that limit would be wrong.",
    );
  });

  it.each(['product', 'sum'] as const)('%s keeps its existing parts and reading', (operation) => {
    const [row] = unevaluatedIdentities(graph({ operation, factor_ids: ['stock_today', 'inflow'], stated_in_brief: true }), undefined, []);
    expect(row).toEqual({ node_id: 'stock_at_horizon', label: 'Subscribers at month 12',
      operation, parts: ['Stock today', 'Monthly inflow'] });
    const parts = operation === 'product' ? 'Stock today × Monthly inflow' : 'Stock today + Monthly inflow';
    expect(goalIdentityWithheldMessage([row])).toContain(`depends on ${parts},`);
    expect(limitIdentityWithheldMessage('MRR', [row])).toContain(`depends on ${parts},`);
  });
});
