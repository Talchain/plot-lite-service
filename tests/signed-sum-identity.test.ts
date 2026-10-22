import { describe, expect, it } from 'vitest';
import { normaliseNode } from '../src/normalisation/graph-normaliser.js';
import { toISLNode } from '../src/integrations/isl/translator-v3.js';
import { goalIdentityWithheldMessage } from '../src/lib/goal-identity-withhold.js';

const identity = { operation: 'sum', factor_ids: ['revenue', 'costs'], subtract: ['costs'], stated_in_brief: true };
const node = { id: 'profit', kind: 'outcome', label: 'Profit', nonlinear_identity: identity };

describe('an exact sum carries its explicit subtraction to ISL', () => {
  it('preserves the same carrier at both normalisation and wire construction', () => {
    const engine = normaliseNode(node as any);
    expect(engine.nonlinear_identity).toEqual(identity);
    expect(toISLNode(engine).nonlinear_identity).toEqual(identity);
  });

  it.each([
    { subtract: ['missing'] }, { subtract: ['costs', 'costs'] }, { subtract: [] },
    { subtract: null }, { subtract: undefined }, { operation: 'product' },
    { operation: 'accumulation', factor_ids: ['revenue', 'costs', 'inflow'], horizon_months: 3, rate_scale: 1 },
  ])('refuses invalid subtraction before it could be silently lost: %j', (patch) => {
    expect(() => normaliseNode({ ...node, nonlinear_identity: { ...identity, ...patch } } as any)).toThrow();
  });

  it('does not add a field to a legacy all-positive sum', () => {
    const { subtract: _minus, ...legacy } = identity;
    expect(toISLNode(normaliseNode({ ...node, nonlinear_identity: legacy } as any)).nonlinear_identity).toEqual(legacy);
  });

  it('a withheld signed identity never describes profit as revenue plus costs', () => {
    const message = goalIdentityWithheldMessage([{ node_id: 'profit', label: 'Profit',
      operation: 'sum', parts: ['Revenue', 'Costs'], part_signs: [1, -1] }]);
    expect(message).toContain('Revenue − Costs');
    expect(message).not.toContain('Revenue + Costs');
  });
});
