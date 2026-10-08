import { describe, expect, it } from 'vitest';
import {
  NormalisationError,
  normaliseGraph,
  normaliseNode,
  readNonlinearIdentity,
} from '../src/normalisation/graph-normaliser.js';
import {
  attachIdentityExecutionFrames,
  toISLNode,
  type IdentityDerivedFrame,
} from '../src/integrations/isl/translator-v3.js';

const carrier = () => ({
  operation: 'accumulation',
  factor_ids: ['stock_today', 'churn_rate', 'inflow'],
  horizon_months: 12,
  rate_scale: 0.01,
  stated_in_brief: false,
});

describe('Round 2 cap-only accumulation carrier after normalisation', () => {
  const goalProduct = {
    operation: 'product',
    factor_ids: ['price', 'stock_at_horizon'],
    stated_in_brief: true,
  };

  function normalisedCarrier(withValue: boolean, statedInBrief = false) {
    const input = {
      nodes: [
        {
          id: 'stock_at_horizon', kind: 'outcome', label: 'Stock at month 12',
          observed_state: { cap: 10000, ...(withValue ? { value: 0.5 } : {}) },
          nonlinear_identity: { ...carrier(), stated_in_brief: statedInBrief },
        },
        { id: 'stock_today', kind: 'factor', observed_state: { value: 0.3, raw_value: 1500, cap: 5000 } },
        { id: 'churn_rate', kind: 'factor', observed_state: { value: 0.03, raw_value: 3, unit: '%' } },
        { id: 'inflow', kind: 'factor', observed_state: { value: 0.1, raw_value: 100, cap: 1000 } },
        { id: 'price', kind: 'factor', observed_state: { value: 0.245, raw_value: 49, cap: 200 } },
        {
          id: 'mrr', kind: 'goal', label: 'MRR',
          observed_state: { value: 0.49, raw_value: 245000, cap: 500000 },
          nonlinear_identity: goalProduct,
        },
      ],
      edges: [
        ...carrier().factor_ids.map((from) => ({ from, to: 'stock_at_horizon' })),
        ...goalProduct.factor_ids.map((from) => ({ from, to: 'mrr' })),
      ],
    };
    const { graph } = normaliseGraph(input as any);
    return { input, graph, isl: graph.nodes.map(toISLNode) };
  }

  it('withdraws the unconfirmed cap-only carrier by rule (d) before (b), preserving the confirmed goal product', () => {
    const { input, graph, isl } = normalisedCarrier(false);
    expect(input.nodes[0].observed_state).toEqual({ cap: 10000 });
    // Pin today's ingress: a cap without a value is not a normalised observed state.
    expect(graph.nodes[0].observed_state).toBeUndefined();
    expect(graph.nodes[0].nonlinear_identity).toEqual(carrier());
    expect(graph.nodes.find((node) => node.id === 'stock_today')?.observed_state?.cap).toBe(5000);
    expect(graph.nodes.find((node) => node.id === 'inflow')?.observed_state?.cap).toBe(1000);

    const derived: IdentityDerivedFrame[] = [];
    expect(attachIdentityExecutionFrames(isl, graph.nodes, new Map(), new Map(), derived)).toEqual([
      {
        node_id: 'stock_at_horizon',
        reason: 'inferred_identity_unconfirmed',
        frameless_node_ids: [],
      },
    ]);
    expect(isl[0]).not.toHaveProperty('nonlinear_identity');
    expect(isl[0]).not.toHaveProperty('execution_frame');
    expect(isl.find((node) => node.id === 'mrr')?.nonlinear_identity).toEqual(goalProduct);
    expect(derived).toEqual([]);
    expect(input.nodes[0].observed_state).toEqual({ cap: 10000 });
  });

  it('CONTROL: the same stated carrier with a value keeps the accumulation and confirmed goal identities', () => {
    const { input, graph, isl } = normalisedCarrier(true, true);
    expect(input.nodes[0].observed_state).toEqual({ cap: 10000, value: 0.5 });
    expect(graph.nodes[0].observed_state).toMatchObject({ cap: 10000, value: 0.5 });

    const derived: IdentityDerivedFrame[] = [];
    expect(attachIdentityExecutionFrames(isl, graph.nodes, new Map(), new Map(), derived)).toEqual([]);
    expect(isl[0].nonlinear_identity).toEqual({ ...carrier(), stated_in_brief: true });
    expect(isl[0].execution_frame).toEqual({ frame: 10000, carrier: 'cap' });
    expect(isl.find((node) => node.id === 'stock_today')?.execution_frame).toEqual({ frame: 5000, carrier: 'cap' });
    expect(isl.find((node) => node.id === 'inflow')?.execution_frame).toEqual({ frame: 1000, carrier: 'cap' });
    expect(isl.find((node) => node.id === 'mrr')?.nonlinear_identity).toEqual(goalProduct);
    expect(derived).toEqual([]);
    expect(input.nodes[0].observed_state).toEqual({ cap: 10000, value: 0.5 });
  });
});

function expectRefused(identity: unknown, field: string): void {
  let caught: unknown;
  try {
    readNonlinearIdentity({ id: 'stock_at_horizon', nonlinear_identity: identity } as any);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(NormalisationError);
  expect(caught).toMatchObject({
    name: 'NormalisationError',
    field: `nonlinear_identity.${field}`,
    nodeId: 'stock_at_horizon',
  });
  expect((caught as Error).message).toContain(`nonlinear_identity.${field}`);
}

describe('T2 accumulation carrier ingress is strict and positional', () => {
  it.each([[0.136, 0.246], [0, 0], [Number.MIN_VALUE, Number.MAX_VALUE]])(
    'preserves the exact positional rate spread %j without sharing the input array',
    (churn, inflow) => {
      const identity = { ...carrier(), rate_sigma_log: [churn, inflow] };
      const result = normaliseNode({ id: 'stock_at_horizon', nonlinear_identity: identity } as any).nonlinear_identity;
      expect(JSON.stringify(result)).toBe(JSON.stringify(identity));
      expect(result).toHaveProperty('rate_sigma_log', identity.rate_sigma_log);
      expect((result as any).rate_sigma_log).not.toBe(identity.rate_sigma_log);
    },
  );

  it('keeps an absent rate spread absent through normalisation and projection', () => {
    const identity = carrier();
    const node = normaliseNode({ id: 'stock_at_horizon', nonlinear_identity: identity } as any);
    for (const result of [node.nonlinear_identity, toISLNode(node).nonlinear_identity]) {
      expect(JSON.stringify(result)).toBe(JSON.stringify(identity));
      expect(result).not.toHaveProperty('rate_sigma_log');
    }
  });

  it.each([
    ['negative churn', [-0.1, 0.2]],
    ['negative inflow', [0.1, -0.2]],
    ['one entry', [0.1]],
    ['three entries', [0.1, 0.2, 0.3]],
    ['NaN', [NaN, 0.1]],
    ['Infinity', [0.1, Infinity]],
    ['negative Infinity', [-Infinity, 0.1]],
    ['non-array', 'x'],
    ['non-number entry', [0.1, '0.2']],
    ['null', null],
    ['explicit undefined', undefined],
    ['sparse array', new Array(2)],
  ])('refuses %s and names the exact rate_sigma_log field', (_label, rate_sigma_log) => {
    expectRefused({ ...carrier(), rate_sigma_log }, 'rate_sigma_log');
  });

  it('accepts the contract example with every exact field and returns a fresh carrier', () => {
    const identity = carrier();
    const result = normaliseNode({
      id: 'stock_at_horizon',
      kind: 'factor',
      nonlinear_identity: identity,
    } as any).nonlinear_identity;

    expect(result).toEqual({
      operation: 'accumulation',
      factor_ids: ['stock_today', 'churn_rate', 'inflow'],
      horizon_months: 12,
      rate_scale: 0.01,
      stated_in_brief: false,
    });
    expect(result).not.toBe(identity);
    expect(result?.factor_ids).not.toBe(identity.factor_ids);
  });

  it('reads a nested carrier without reordering positional ids', () => {
    const identity = { ...carrier(), factor_ids: ['z_stock', 'a_churn', 'm_inflow'] };
    expect(readNonlinearIdentity({ id: 'stock_at_horizon', data: { nonlinear_identity: identity } } as any))
      .toEqual(identity);
  });

  it.each([
    { source: 'kind', kindFields: { kind: 'goal' } },
    { source: 'type', kindFields: { type: 'goal' } },
    { source: 'data.kind', kindFields: { data: { kind: 'GOAL' } } },
    { source: 'data.type', kindFields: { data: { type: 'goal' } } },
  ])('refuses accumulation on a goal resolved from $source and names nonlinear_identity', ({ kindFields }) => {
    const node = { id: 'goal', ...kindFields, nonlinear_identity: carrier() };
    for (const read of [readNonlinearIdentity, normaliseNode]) {
      let caught: unknown;
      try {
        read(node as any);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(NormalisationError);
      expect(caught).toMatchObject({
        name: 'NormalisationError',
        field: 'nonlinear_identity',
        nodeId: 'goal',
      });
      expect((caught as Error).message).toContain('nonlinear_identity');
    }
  });

  it.each(['outcome', 'factor'])('accepts accumulation on a %s node with every exact carrier field', (kind) => {
    const identity = carrier();
    const node = { id: 'stock_at_horizon', kind, nonlinear_identity: identity };
    expect(readNonlinearIdentity(node as any)).toEqual(identity);
    expect(normaliseNode(node as any).nonlinear_identity).toEqual(identity);
  });

  it('keeps an ordinary goal product accepted with every exact carrier field', () => {
    const identity = {
      operation: 'product',
      factor_ids: ['price', 'stock_at_horizon'],
      stated_in_brief: true,
    };
    const node = { id: 'goal', kind: 'goal', nonlinear_identity: identity };
    expect(readNonlinearIdentity(node as any)).toEqual(identity);
    expect(normaliseNode(node as any).nonlinear_identity).toEqual(identity);
  });

  it.each([
    { horizon_months: 1, rate_scale: Number.MIN_VALUE, stated_in_brief: false },
    { horizon_months: 120, rate_scale: 1, stated_in_brief: true },
  ])('accepts valid boundary carrier %j', (values) => {
    const identity = { ...carrier(), ...values };
    expect(readNonlinearIdentity({ id: 'stock_at_horizon', nonlinear_identity: identity } as any))
      .toEqual(identity);
  });

  it.each([
    ['two ids', ['stock_today', 'churn_rate']],
    ['four ids', ['stock_today', 'churn_rate', 'inflow', 'extra']],
    ['duplicate ids', ['stock_today', 'churn_rate', 'stock_today']],
    ['empty id', ['stock_today', '', 'inflow']],
    ['non-string id', ['stock_today', 7, 'inflow']],
  ])('refuses %s and names factor_ids', (_label, factor_ids) => {
    expectRefused({ ...carrier(), factor_ids }, 'factor_ids');
  });

  it.each([0, 121, 12.5, '12', undefined, null, NaN, Infinity])(
    'refuses horizon_months %j and names horizon_months',
    (horizon_months) => expectRefused({ ...carrier(), horizon_months }, 'horizon_months'),
  );

  it.each([0, 1.5, NaN, -0.01, Infinity, -Infinity, '0.01', undefined, null])(
    'refuses rate_scale %j and names rate_scale',
    (rate_scale) => expectRefused({ ...carrier(), rate_scale }, 'rate_scale'),
  );

  it.each([undefined, null, [], ['bonus']])(
    'refuses addends by presence, even value %j',
    (addends) => expectRefused({ ...carrier(), addends }, 'addends'),
  );

  it.each([undefined, null, 'olumi_reading'])(
    'refuses reading_licence by presence, even value %j',
    (reading_licence) => expectRefused({ ...carrier(), reading_licence }, 'reading_licence'),
  );

  it('refuses an unknown key by its exact name', () => {
    expectRefused({ ...carrier(), forecast_months: 12 }, 'forecast_months');
  });

  it.each([undefined, null, 'false', 0])(
    'refuses non-boolean stated_in_brief %j',
    (stated_in_brief) => expectRefused({ ...carrier(), stated_in_brief }, 'stated_in_brief'),
  );

  it.each(['product', 'sum'])('keeps %s unchanged and rejects accumulation-only keys by presence', (operation) => {
    const identity = {
      operation,
      factor_ids: ['price', 'stock_at_horizon'],
      stated_in_brief: false,
      addends: ['bonus'],
      ...(operation === 'product' ? { reading_licence: 'olumi_reading' } : {}),
    };
    expect(readNonlinearIdentity({ id: 'stock_at_horizon', nonlinear_identity: identity } as any))
      .toEqual(identity);
    for (const horizon_months of [12, undefined]) {
      expectRefused({ ...identity, horizon_months }, 'horizon_months');
    }
    for (const rate_scale of [0.01, undefined]) {
      expectRefused({ ...identity, rate_scale }, 'rate_scale');
    }
    for (const rate_sigma_log of [[0.136, 0.246], undefined]) {
      expectRefused({ ...identity, rate_sigma_log }, 'rate_sigma_log');
    }
    // An operation edit can leave other carrier-only fields behind; sigma still names its refusal.
    expectRefused({ ...carrier(), operation, rate_sigma_log: [0.136, 0.246] }, 'rate_sigma_log');
  });
});
