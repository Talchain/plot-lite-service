import { describe, expect, it } from 'vitest';
import {
  attachIdentityExecutionFrames,
  goalCarrierIds,
  toISLNode,
  withdrawInferredUnevaluatedIdentities,
  type IdentityDerivedFrame,
  type ISLNodeV3,
} from '../src/integrations/isl/translator-v3.js';
import type { EngineNodeV3 } from '../src/types/engine-v3.js';

const FACTORS = ['stock_today', 'churn_rate', 'monthly_inflow'];
const ACCUMULATION = {
  operation: 'accumulation' as const,
  factor_ids: FACTORS,
  horizon_months: 12,
  rate_scale: 0.01,
  stated_in_brief: false,
};

// The cast lets the same contract rows execute against the pre-carrier type for RED evidence.
function carrierNodes(): EngineNodeV3[] {
  return [
    { id: 'stock_at_horizon', kind: 'outcome', label: 'Stock at month 12', observed_state: { cap: 10000 }, nonlinear_identity: structuredClone(ACCUMULATION) },
    { id: FACTORS[0], kind: 'factor', label: 'Stock today', observed_state: { value: 0.3, raw_value: 1500, cap: 5000 } },
    { id: FACTORS[1], kind: 'factor', label: 'Monthly churn', observed_state: { value: 0.03, raw_value: 3, unit: '%' } },
    { id: FACTORS[2], kind: 'factor', label: 'Monthly inflow', observed_state: { value: 0.1, raw_value: 100, cap: 1000 } },
  ] as unknown as EngineNodeV3[];
}

describe('accumulation translator — exact carrier and frame decisions', () => {
  it.each(['product', 'sum'] as const)('T1 %s keeps the existing wire fields and omits the PLoT-only licence', (operation) => {
    const identity = { operation, factor_ids: ['price', 'stock_today'], stated_in_brief: false,
      addends: ['bonus'], ...(operation === 'product' ? { reading_licence: 'olumi_reading' as const } : {}) };
    const engine = { id: 'old_carrier', kind: 'outcome', label: 'Existing identity', nonlinear_identity: identity } as EngineNodeV3;
    expect(toISLNode(engine).nonlinear_identity).toEqual({ operation,
      factor_ids: ['price', 'stock_today'], stated_in_brief: false, addends: ['bonus'] });
  });

  it.each([false, true])('T1 forwards every carrier field byte-for-byte, stated_in_brief=%j', (stated_in_brief) => {
    const engine = carrierNodes()[0];
    const expected = { ...structuredClone(ACCUMULATION), stated_in_brief };
    engine.nonlinear_identity = expected as unknown as NonNullable<EngineNodeV3['nonlinear_identity']>;
    const before = structuredClone(engine);
    const actual = toISLNode(engine).nonlinear_identity;
    expect(actual).toEqual(expected);
    expect(actual?.factor_ids).toEqual(['stock_today', 'churn_rate', 'monthly_inflow']);
    expect(actual?.factor_ids).not.toBe(engine.nonlinear_identity.factor_ids);
    expect(engine).toEqual(before);
  });

  it.each([
    { name: 'value/raw_value pair', observed_state: { value: 0.03, raw_value: 3, unit: '%' }, execution_frame: { frame: 100, carrier: 'pair' } },
    { name: 'declared cap', observed_state: { value: 0.15, cap: 20 }, execution_frame: { frame: 20, carrier: 'cap' } },
  ])('T4 inferred accumulation frames churn from its $name', ({ observed_state, execution_frame }) => {
    const engine = carrierNodes();
    engine[2].observed_state = observed_state;
    const isl = engine.map(toISLNode);
    const derived: IdentityDerivedFrame[] = [];
    expect(attachIdentityExecutionFrames(isl, engine, new Map(), new Map(), derived)).toEqual([]);
    expect(isl[0].nonlinear_identity).toEqual(ACCUMULATION);
    expect(Object.fromEntries(isl.map((node) => [node.id, node.execution_frame]))).toEqual({
      stock_at_horizon: { frame: 10000, carrier: 'cap' },
      stock_today: { frame: 5000, carrier: 'cap' },
      churn_rate: execution_frame,
      monthly_inflow: { frame: 1000, carrier: 'cap' },
    });
    expect(derived).toEqual([]);
  });

  it.each(['stock_at_horizon', 'stock_today', 'churn_rate', 'monthly_inflow'])('T4 rule (b) withdraws an inferred accumulation with the required participant frame unresolved: %s', (missingId) => {
    const engine = carrierNodes();
    const missing = engine.find((node) => node.id === missingId)!;
    if (missingId === 'churn_rate') missing.observed_state = { value: 0.03, unit: '%' };
    else delete missing.observed_state;
    const isl = engine.map(toISLNode);
    expect(attachIdentityExecutionFrames(isl, engine, new Map())).toEqual([
      { node_id: 'stock_at_horizon', reason: 'inferred_identity_frame_unresolved', frameless_node_ids: [missingId] },
    ]);
    expect(isl[0]).not.toHaveProperty('nonlinear_identity');
  });

  it('T4 contract @9f91807e: a carrier with ONLY a node scale_frame (no observed_state; CEE #4\'s shape) is framed from it and kept', () => {
    const engine = carrierNodes();
    delete (engine[0] as { observed_state?: unknown }).observed_state;
    const isl = engine.map(toISLNode);
    // ISL reads node.execution_frame (robustness_analyzer_v2.py:1814 @61d6bd68); ExecutionFrameV2.carrier accepts 'scale_frame'.
    expect(attachIdentityExecutionFrames(isl, engine, new Map([['stock_at_horizon', 1000]]))).toEqual([]);
    expect(isl[0].nonlinear_identity).toEqual(ACCUMULATION);
    expect(isl[0].execution_frame).toEqual({ frame: 1000, carrier: 'scale_frame' });
    // Control (the rule (b) row above): the same carrier with no scale_frame is withdrawn.
    const bare = carrierNodes();
    delete (bare[0] as { observed_state?: unknown }).observed_state;
    const bareIsl = bare.map(toISLNode);
    expect(attachIdentityExecutionFrames(bareIsl, bare, new Map())).toEqual([
      { node_id: 'stock_at_horizon', reason: 'inferred_identity_frame_unresolved', frameless_node_ids: ['stock_at_horizon'] },
    ]);
  });

  it.each([false, true])('T4 rule (d) protects the goal product over [price, accumulation carrier], confirmed=%j', (confirmed) => {
    const engine = carrierNodes();
    const goalProduct = { operation: 'product' as const, factor_ids: ['price', 'stock_at_horizon'], stated_in_brief: confirmed };
    engine.push(
      { id: 'price', kind: 'factor', label: 'Price', observed_state: { value: 0.245, raw_value: 49, cap: 200 } },
      { id: 'mrr', kind: 'goal', label: 'MRR', nonlinear_identity: goalProduct },
    );
    const isl = engine.map(toISLNode);
    const notForwarded = attachIdentityExecutionFrames(isl, engine, new Map(), new Map([['mrr', 250000]]));
    expect(notForwarded).toEqual(confirmed ? [] : [
      { node_id: 'mrr', reason: 'inferred_identity_unconfirmed', frameless_node_ids: [] },
    ]);
    expect(isl.find((node) => node.id === 'mrr')?.nonlinear_identity).toEqual(confirmed ? goalProduct : undefined);
    expect(isl.find((node) => node.id === 'stock_at_horizon')?.nonlinear_identity).toEqual(ACCUMULATION);
    expect(isl.find((node) => node.id === 'churn_rate')?.execution_frame).toEqual({ frame: 100, carrier: 'pair' });
  });

  it('T4 generic participant cleanup retains all three distinct positional factor IDs', () => {
    // Exercise the generic participantsOf reader through its existing public caller:
    // removing an unrelated identity must preserve exactly the carrier and its three participants.
    const ids = ['stock_at_horizon', ...FACTORS, 'withdrawn', 'unrelated_factor'];
    const isl = ids.map((id) => ({
      id,
      execution_frame: { frame: 10, carrier: 'cap' as const },
      ...(id === 'stock_at_horizon' ? { nonlinear_identity: structuredClone(ACCUMULATION) } : {}),
      ...(id === 'withdrawn' ? { nonlinear_identity: { operation: 'sum', factor_ids: ['unrelated_factor', 'stock_today'], stated_in_brief: false } } : {}),
    })) as unknown as ISLNodeV3[];
    expect(withdrawInferredUnevaluatedIdentities(isl, [{
      code: 'IDENTITY_NOT_EVALUATED', severity: 'blocker',
      identity: { node_id: 'withdrawn', withheld_reason: 'identity_operand_missing' },
    }])).toEqual([{ node_id: 'withdrawn', reason: 'inferred_identity_operand_missing', frameless_node_ids: [] }]);
    expect(isl.filter((node) => node.execution_frame).map((node) => node.id)).toEqual(['stock_at_horizon', ...FACTORS]);
    expect(isl[0].nonlinear_identity).toEqual(ACCUMULATION);
  });

  it('T6 rule (a) refuses to derive an accumulation carrier frame as a product of factor frames', () => {
    const engine = carrierNodes();
    delete engine[0].observed_state;
    const isl = engine.map(toISLNode);
    const derived: IdentityDerivedFrame[] = [];
    expect(attachIdentityExecutionFrames(isl, engine, new Map(), new Map(), derived)).toEqual([
      { node_id: 'stock_at_horizon', reason: 'inferred_identity_frame_unresolved', frameless_node_ids: ['stock_at_horizon'] },
    ]);
    expect(derived).toEqual([]);
    expect(isl[0]).not.toHaveProperty('execution_frame');
  });

  it('T6 goalCarrierIds explicitly excludes accumulation from binary product reconciliation', () => {
    const engine = carrierNodes();
    engine[0].observed_state = { value: 0.5, raw_value: 5000, cap: 10000, unit: 'GBP/month', source: 'brief_extraction' };
    engine.push({ id: 'mrr', kind: 'goal', label: 'MRR', observed_state: { raw_value: 5000, unit: 'GBP/month', source: 'brief_extraction' } });
    expect([...goalCarrierIds(engine, [{ from: 'stock_at_horizon', to: 'mrr' }])]).toEqual([]);
  });
});
