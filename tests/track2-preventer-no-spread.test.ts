/**
 * TRACK 2 (21 Oct 2026): ISL refuses ANY parameter_uncertainty on an event_risk preventer (EVENT_RISK_ROLE_REFUSED). PLoT
 * sends none, from either pass: a preventer with a stated level, or one with only a prior (buddy r1).
 */
import { describe, it, expect } from 'vitest';
import { buildParameterUncertaintiesV3 } from '../src/integrations/isl/translator-v3.js';
import { injectConstraintParameterUncertainties, selectConstraintInjectedPuNodeIds } from '../src/integrations/isl/constraint-pu-injection.js';

const risk = { id: 'supplier_fails', kind: 'risk', label: 'Supplier fails',
  event_risk: { version: 1, occurrence: { p_low: 0.05, p_high: 0.15, basis: 'user' }, horizon: { months: 12 }, mitigations: [{ factor_id: 'dual', occurrence_reduction: 0.7 }] } } as any;
const prior = { distribution: 'uniform', range_min: 0, range_max: 1 };

describe('Track 2: an event risk\'s preventer carries no parameter uncertainty', () => {
  it('a preventer with a stated level, or with only a prior, gets no entry', () => {
    const stated = { id: 'dual', kind: 'factor', label: 'Dual', category: 'controllable', observed_state: { value: 0, source: 'brief_extraction', std: 1e-4 } } as any;
    expect(buildParameterUncertaintiesV3([risk, stated], [{ id: 'sq', interventions: { dual: 0 } }, { id: 'ds', interventions: { dual: 1 } }] as any) ?? []).toEqual([]);
    const priorOnly = { id: 'dual', kind: 'factor', label: 'Dual', prior } as any;
    expect(buildParameterUncertaintiesV3([risk, priorOnly], []) ?? []).toEqual([]);
  });

  it('CONTROL: the same factors with no event risk naming them keep their entries', () => {
    const priorOnly = { id: 'dual', kind: 'factor', label: 'Dual', prior } as any;
    expect((buildParameterUncertaintiesV3([priorOnly], []) ?? []).map((u) => u.node_id)).toEqual(['dual']);
    const unnamed = { ...risk, event_risk: { ...risk.event_risk, mitigations: undefined } };
    expect((buildParameterUncertaintiesV3([unnamed, priorOnly], []) ?? []).map((u) => u.node_id)).toEqual(['dual']);
  });
  // Codex integration review 5 (21 Oct): a `>=` constraint on a preventer whose level is 0 had the constraint injector add
  // σ 0.001 back (constraint-pu-injection.ts), and ISL refuses the Run. The planner's count and the injector agree.
  it('a constraint on a preventer adds no uncertainty either; the same constraint on a plain factor still does', () => {
    const dual = { id: 'dual', kind: 'factor', label: 'Dual', observed_state: { value: 0, source: 'brief_extraction' } } as any;
    const other = { id: 'spend', kind: 'factor', label: 'Spend', observed_state: { value: 0, source: 'brief_extraction' } } as any;
    const at = (node_id: string) => ({ constraint_id: `c_${node_id}`, node_id, operator: '>=', value: 0 }) as any;
    const request = { parameter_uncertainties: [] } as any;
    const out = injectConstraintParameterUncertainties(request, [at('dual'), at('spend')], [risk, dual, other], 'gp');
    expect(out.injected.map((x) => x.node_id)).toEqual(['spend']);
    expect(out.skipped).toEqual([{ node_id: 'dual', reason: 'event_risk_preventer' }]);
    expect(request.parameter_uncertainties.map((x: any) => x.node_id)).toEqual(['spend']);
    expect([...selectConstraintInjectedPuNodeIds([at('dual'), at('spend')], [risk, dual, other], 'gp', new Set())]).toEqual(['spend']);
  });
});
