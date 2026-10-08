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
const STATED_ACCUMULATION = { ...ACCUMULATION, stated_in_brief: true };

// The cast lets the same contract rows execute against the pre-carrier type for RED evidence.
function carrierNodes(statedInBrief = false): EngineNodeV3[] {
  return [
    { id: 'stock_at_horizon', kind: 'outcome', label: 'Stock at month 12', observed_state: { cap: 10000 }, nonlinear_identity: structuredClone(statedInBrief ? STATED_ACCUMULATION : ACCUMULATION) },
    { id: FACTORS[0], kind: 'factor', label: 'Stock today', observed_state: { value: 0.3, raw_value: 1500, cap: 5000 } },
    { id: FACTORS[1], kind: 'factor', label: 'Monthly churn', observed_state: { value: 0.03, raw_value: 3, unit: '%' } },
    { id: FACTORS[2], kind: 'factor', label: 'Monthly inflow', observed_state: { value: 0.1, raw_value: 100, cap: 1000 } },
  ] as unknown as EngineNodeV3[];
}

describe('accumulation translator — exact carrier and frame decisions', () => {
  it('R1 rule (d) withholds an inferred accumulation with all frames, regardless of domain or licence', () => {
    for (const inGoalDomain of [false, true]) {
      for (const readingLicence of [undefined, 'olumi_reading']) {
        const engine = carrierNodes();
        // Even malformed pre-normaliser metadata cannot license an accumulation at the translator boundary.
        if (readingLicence) Object.assign(engine[0].nonlinear_identity!, { reading_licence: readingLicence });
        const isl = engine.map(toISLNode);
        expect(attachIdentityExecutionFrames(isl, engine, new Map(), new Map(), [],
          new Set(inGoalDomain ? ['stock_at_horizon'] : []))).toEqual([
          { node_id: 'stock_at_horizon', reason: 'inferred_identity_unconfirmed', frameless_node_ids: [] },
        ]);
        expect(isl[0]).not.toHaveProperty('nonlinear_identity');
        expect(isl.every((node) => node.execution_frame === undefined)).toBe(true);
      }
    }
  });

  it('R2 rule (d) forwards a stated accumulation with every field and all execution frames', () => {
    const engine = carrierNodes();
    const stated = { ...structuredClone(ACCUMULATION), stated_in_brief: true };
    engine[0].nonlinear_identity = stated;
    const isl = engine.map(toISLNode);
    expect(attachIdentityExecutionFrames(isl, engine, new Map())).toEqual([]);
    expect(isl[0].nonlinear_identity).toEqual(stated);
    expect(Object.fromEntries(isl.map((node) => [node.id, node.execution_frame]))).toEqual({
      stock_at_horizon: { frame: 10000, carrier: 'cap' },
      stock_today: { frame: 5000, carrier: 'cap' },
      churn_rate: { frame: 100, carrier: 'pair' },
      monthly_inflow: { frame: 1000, carrier: 'cap' },
    });
  });

  it('R3 rule (d) withholds only the inferred accumulation and forwards the stated goal product', () => {
    const engine = carrierNodes();
    const goalProduct = { operation: 'product' as const, factor_ids: ['price', 'stock_at_horizon'], stated_in_brief: true };
    engine.push(
      { id: 'price', kind: 'factor', label: 'Price', observed_state: { value: 0.245, raw_value: 49, cap: 200 } },
      { id: 'mrr', kind: 'goal', label: 'MRR', nonlinear_identity: goalProduct },
    );
    const isl = engine.map(toISLNode);
    expect(attachIdentityExecutionFrames(isl, engine, new Map(), new Map([['mrr', 250000]]))).toEqual([
      { node_id: 'stock_at_horizon', reason: 'inferred_identity_unconfirmed', frameless_node_ids: [] },
    ]);
    expect(JSON.parse(JSON.stringify(isl.find((node) => node.id === 'mrr')))).toStrictEqual({
      id: 'mrr', kind: 'goal', label: 'MRR', intercept: 0, epsilon_std: 0, nonlinear_identity: goalProduct,
      execution_frame: { frame: 250000, carrier: 'cap' },
    });
    const carrier = isl.find((node) => node.id === 'stock_at_horizon')!;
    expect(carrier).not.toHaveProperty('nonlinear_identity');
    expect(carrier.observed_state).toEqual({ cap: 10000 });
    expect(carrier.observed_state).not.toHaveProperty('value');
    expect(carrier.observed_state).not.toHaveProperty('raw_value');
    expect(carrier.execution_frame).toEqual({ frame: 10000, carrier: 'cap' });
    expect(isl.find((node) => node.id === 'price')?.execution_frame).toEqual({ frame: 200, carrier: 'cap' });
    expect(FACTORS.every((id) => isl.find((node) => node.id === id)?.execution_frame === undefined)).toBe(true);
    // Variant (c) cannot withdraw an identity already removed by (d), nor a stated goal product.
    expect(withdrawInferredUnevaluatedIdentities(isl, [{
      code: 'IDENTITY_NOT_EVALUATED', severity: 'blocker',
      identity: { node_id: 'stock_at_horizon', withheld_reason: 'identity_operand_missing' },
    }])).toBeNull();
    expect(withdrawInferredUnevaluatedIdentities(isl, [{
      code: 'IDENTITY_NOT_EVALUATED', severity: 'blocker',
      identity: { node_id: 'mrr', withheld_reason: 'identity_operand_missing' },
    }])).toBeNull();
    expect(isl.find((node) => node.id === 'mrr')?.nonlinear_identity).toEqual(goalProduct);
  });

  it('R4 rule (d) reports an inferred accumulation with a missing frame exactly once before (b)', () => {
    const engine = carrierNodes();
    engine[2].observed_state = { value: 0.03, unit: '%' };
    const isl = engine.map(toISLNode);
    const derived: IdentityDerivedFrame[] = [];
    expect(attachIdentityExecutionFrames(isl, engine, new Map(), new Map(), derived)).toEqual([
      { node_id: 'stock_at_horizon', reason: 'inferred_identity_unconfirmed', frameless_node_ids: [] },
    ]);
    expect(isl[0]).not.toHaveProperty('nonlinear_identity');
    expect(derived).toEqual([]);
    expect(isl.every((node) => node.execution_frame === undefined)).toBe(true);
  });

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
  ])('T4 stated accumulation frames churn from its $name', ({ observed_state, execution_frame }) => {
    const engine = carrierNodes(true);
    engine[2].observed_state = observed_state;
    const isl = engine.map(toISLNode);
    const derived: IdentityDerivedFrame[] = [];
    expect(attachIdentityExecutionFrames(isl, engine, new Map(), new Map(), derived)).toEqual([]);
    expect(isl[0].nonlinear_identity).toEqual(STATED_ACCUMULATION);
    expect(Object.fromEntries(isl.map((node) => [node.id, node.execution_frame]))).toEqual({
      stock_at_horizon: { frame: 10000, carrier: 'cap' },
      stock_today: { frame: 5000, carrier: 'cap' },
      churn_rate: execution_frame,
      monthly_inflow: { frame: 1000, carrier: 'cap' },
    });
    expect(derived).toEqual([]);
  });

  it.each(['stock_at_horizon', 'stock_today', 'churn_rate', 'monthly_inflow'])('T4 rule (d) withdraws an inferred accumulation before rule (b), with participant frame unresolved: %s', (missingId) => {
    const engine = carrierNodes();
    const missing = engine.find((node) => node.id === missingId)!;
    if (missingId === 'churn_rate') missing.observed_state = { value: 0.03, unit: '%' };
    else delete missing.observed_state;
    const isl = engine.map(toISLNode);
    expect(attachIdentityExecutionFrames(isl, engine, new Map())).toEqual([
      { node_id: 'stock_at_horizon', reason: 'inferred_identity_unconfirmed', frameless_node_ids: [] },
    ]);
    expect(isl[0]).not.toHaveProperty('nonlinear_identity');
  });

  it('T4 contract @9f91807e: a carrier with ONLY a node scale_frame (no observed_state; CEE #4\'s shape) is framed from it and kept', () => {
    const engine = carrierNodes(true);
    delete (engine[0] as { observed_state?: unknown }).observed_state;
    const isl = engine.map(toISLNode);
    // ISL reads node.execution_frame (robustness_analyzer_v2.py:1814 @61d6bd68); ExecutionFrameV2.carrier accepts 'scale_frame'.
    expect(attachIdentityExecutionFrames(isl, engine, new Map([['stock_at_horizon', 1000]]))).toEqual([]);
    expect(isl[0].nonlinear_identity).toEqual(STATED_ACCUMULATION);
    expect(isl[0].execution_frame).toEqual({ frame: 1000, carrier: 'scale_frame' });
    // An unconfirmed carrier with no scale_frame is withdrawn by (d) before the frame gate.
    const bare = carrierNodes();
    delete (bare[0] as { observed_state?: unknown }).observed_state;
    const bareIsl = bare.map(toISLNode);
    expect(attachIdentityExecutionFrames(bareIsl, bare, new Map())).toEqual([
      { node_id: 'stock_at_horizon', reason: 'inferred_identity_unconfirmed', frameless_node_ids: [] },
    ]);
  });

  it.each([false, true])('T4 rule (d) protects the goal product over [price, accumulation carrier], confirmed=%j', (confirmed) => {
    const engine = carrierNodes(true);
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
    expect(isl.find((node) => node.id === 'stock_at_horizon')?.nonlinear_identity).toEqual(STATED_ACCUMULATION);
    expect(isl.find((node) => node.id === 'churn_rate')?.execution_frame).toEqual({ frame: 100, carrier: 'pair' });
  });

  it('T4 generic participant cleanup retains all three distinct positional factor IDs', () => {
    // Exercise the generic participantsOf reader through its existing public caller:
    // removing an unrelated identity must preserve exactly the carrier and its three participants.
    const ids = ['stock_at_horizon', ...FACTORS, 'withdrawn', 'unrelated_factor'];
    const isl = ids.map((id) => ({
      id,
      execution_frame: { frame: 10, carrier: 'cap' as const },
      ...(id === 'stock_at_horizon' ? { nonlinear_identity: structuredClone(STATED_ACCUMULATION) } : {}),
      ...(id === 'withdrawn' ? { nonlinear_identity: { operation: 'sum', factor_ids: ['unrelated_factor', 'stock_today'], stated_in_brief: false } } : {}),
    })) as unknown as ISLNodeV3[];
    expect(withdrawInferredUnevaluatedIdentities(isl, [{
      code: 'IDENTITY_NOT_EVALUATED', severity: 'blocker',
      identity: { node_id: 'withdrawn', withheld_reason: 'identity_operand_missing' },
    }])).toEqual([{ node_id: 'withdrawn', reason: 'inferred_identity_operand_missing', frameless_node_ids: [] }]);
    expect(isl.filter((node) => node.execution_frame).map((node) => node.id)).toEqual(['stock_at_horizon', ...FACTORS]);
    expect(isl[0].nonlinear_identity).toEqual(STATED_ACCUMULATION);
  });

  it('T6 rule (d) withdraws a frameless accumulation without deriving a product frame', () => {
    const engine = carrierNodes();
    delete engine[0].observed_state;
    const isl = engine.map(toISLNode);
    const derived: IdentityDerivedFrame[] = [];
    expect(attachIdentityExecutionFrames(isl, engine, new Map(), new Map(), derived)).toEqual([
      { node_id: 'stock_at_horizon', reason: 'inferred_identity_unconfirmed', frameless_node_ids: [] },
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
