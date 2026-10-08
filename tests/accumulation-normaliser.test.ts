import { describe, expect, it } from 'vitest';
import {
  NormalisationError,
  normaliseNode,
  readNonlinearIdentity,
} from '../src/normalisation/graph-normaliser.js';

const carrier = () => ({
  operation: 'accumulation',
  factor_ids: ['stock_today', 'churn_rate', 'inflow'],
  horizon_months: 12,
  rate_scale: 0.01,
  stated_in_brief: false,
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
  });
});
