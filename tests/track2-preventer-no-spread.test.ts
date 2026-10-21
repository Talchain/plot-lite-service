/**
 * TRACK 2 (21 Oct 2026): ISL refuses ANY parameter_uncertainty on an event_risk preventer (EVENT_RISK_ROLE_REFUSED). PLoT
 * sends none, from either pass: a preventer with a stated level, or one with only a prior (buddy r1).
 */
import { describe, it, expect } from 'vitest';
import { buildParameterUncertaintiesV3 } from '../src/integrations/isl/translator-v3.js';

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
});
