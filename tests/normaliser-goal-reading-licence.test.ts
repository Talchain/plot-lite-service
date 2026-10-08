import { describe, expect, it } from 'vitest';
import {
  NormalisationError,
  normaliseNode,
  readNonlinearIdentity,
} from '../src/normalisation/graph-normaliser.js';
import { normaliseGraphWithRepairs } from '../src/normalisation/normalise-and-repair.js';

const product = () => ({
  operation: 'product',
  factor_ids: ['pro_plan_price', 'pro_paying_subscribers'],
  stated_in_brief: false,
  addends: ['churn_loss'],
});
const licensed = () => ({ ...product(), reading_licence: 'olumi_reading' });
const goal = (identity: unknown) => ({ id: 'mrr', kind: 'goal', nonlinear_identity: identity });

function expectRefused(identity: unknown, field = 'nonlinear_identity.reading_licence'): void {
  let caught: unknown;
  try {
    normaliseNode(goal(identity));
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(NormalisationError);
  expect(caught).toMatchObject({ name: 'NormalisationError', field, nodeId: 'mrr' });
}

describe('L4 — goal mrr reading_licence ingress is explicit and fail closed', () => {
  it('retains olumi_reading, exact factor ids and definitional addend through the run normaliser', () => {
    const identity = licensed();
    const result = normaliseGraphWithRepairs({
      nodes: [
        goal(identity),
        { id: 'pro_plan_price', kind: 'factor' },
        { id: 'pro_paying_subscribers', kind: 'factor' },
        { id: 'churn_loss', kind: 'risk' },
      ],
      edges: [
        { from: 'pro_plan_price', to: 'mrr' },
        { from: 'pro_paying_subscribers', to: 'mrr' },
        { from: 'churn_loss', to: 'mrr' },
      ],
    });
    const normalised = result.graph.nodes.find((node) => node.id === 'mrr')!.nonlinear_identity;
    expect(normalised).toEqual(identity);
    expect(normalised).not.toBe(identity);
    expect(normalised!.factor_ids).not.toBe(identity.factor_ids);
    expect(normalised!.addends).not.toBe(identity.addends);
  });

  it('also retains the licence in the React Flow data carrier', () => {
    expect(readNonlinearIdentity({ id: 'mrr', data: { nonlinear_identity: licensed() } })).toEqual(licensed());
  });

  it('accepts an absent licence without manufacturing a stamp', () => {
    const normalised = normaliseNode(goal(product())).nonlinear_identity;
    expect(normalised).toEqual(product());
    expect(Object.hasOwn(normalised!, 'reading_licence')).toBe(false);
  });

  it('still accepts an unlicensed stated sum', () => {
    const identity = { ...product(), operation: 'sum', stated_in_brief: true };
    expect(normaliseNode(goal(identity)).nonlinear_identity).toEqual(identity);
  });

  it('refuses the licence with stated_in_brief:true on node mrr', () => {
    expectRefused({ ...licensed(), stated_in_brief: true });
  });

  it('refuses the licence with operation:sum on node mrr', () => {
    expectRefused({ ...licensed(), operation: 'sum' });
  });

  it.each(['yes', null, undefined, false, 1, {}, []].map((value) => [value]))(
    'refuses present reading_licence value %j on node mrr, never drops it',
    (reading_licence) => expectRefused({ ...product(), reading_licence }),
  );

  it.each([licensed(), product()])('still refuses unknown identity keys, never drops them (%j)', (identity) => {
    expectRefused({ ...identity, surprise: 'unknown' }, 'nonlinear_identity.surprise');
  });
});
