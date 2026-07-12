/**
 * D-U structural lever guard — unit coverage for the shared lever-identity
 * leaf and the merge paths the integration fixture cannot reach.
 *
 * The integration test (du-structural-lever-guard.integration.test.ts) drives
 * /v2/run end-to-end; this file pins:
 *   1. interventionTargetIdsFromOptions — the ONE union definition (D-U /
 *      ROADMAP 2.40), including the plain-object guard extracted verbatim
 *      from coaching's normalise-inputs.ts.
 *   2. isOptionControlledLever — stamp OR union membership.
 *   3. mergeIslConfidenceIntoGraphFactors with EMPTY islFactors — the early
 *      return that pre-D-U let a union-member graph factor egress a tunable
 *      sensitivity whenever ISL returned no factor_sensitivity at all.
 *   4. Idempotence at the merge level: an ISL-stamped union member produces
 *      byte-identical output with and without the structural set (the
 *      suppression fields are constants; no double-transform).
 */
import { describe, it, expect } from 'vitest';
import {
  interventionTargetIdsFromOptions,
  isOptionControlledLever,
} from '../src/lib/intervention-override.js';
import { mergeIslConfidenceIntoGraphFactors } from '../src/lib/factor-influence.js';
import type { FactorSensitivityResultV3 } from '../src/types/engine-v3.js';

function graphFactor(id: string, over: Partial<FactorSensitivityResultV3> = {}): FactorSensitivityResultV3 {
  return {
    factor_id: id,
    factor_label: id,
    influence_score: 0.8,
    influence_rank: 1,
    sensitivity_score: 0.7,
    elasticity: 0.8,
    direction: 'positive',
    importance_rank: 1,
    value_of_information: 0.4,
    confidence: 0.6,
    confidence_source: 'plot_unified_from_graph',
    confidence_components: { structural_certainty: 0.9, sampling_stability: null },
    source: 'graph',
    ...over,
  } as FactorSensitivityResultV3;
}

describe('interventionTargetIdsFromOptions — the single union definition', () => {
  it('unions targets across ALL options (not just the first)', () => {
    const ids = interventionTargetIdsFromOptions([
      { interventions: { fac_a: 1 } },
      { interventions: { fac_b: { value: 0.2 }, fac_c: 0 } },
    ]);
    expect([...ids].sort()).toEqual(['fac_a', 'fac_b', 'fac_c']);
  });

  it('guards malformed inputs: array interventions must not pollute the set with indices', () => {
    const ids = interventionTargetIdsFromOptions([
      { interventions: [0.1, 0.2] as unknown },
      { interventions: null as unknown },
      { interventions: undefined },
      {},
    ]);
    expect(ids.size).toBe(0);
  });

  it('handles absent options', () => {
    expect(interventionTargetIdsFromOptions(undefined).size).toBe(0);
    expect(interventionTargetIdsFromOptions(null).size).toBe(0);
    expect(interventionTargetIdsFromOptions([]).size).toBe(0);
  });
});

describe('isOptionControlledLever — stamp OR structural membership', () => {
  const union = new Set(['fac_union']);
  it('fires on the ISL stamp alone', () => {
    expect(isOptionControlledLever({ factor_id: 'x', zero_reason: 'intervention_override' })).toBe(true);
  });
  it('fires on union membership alone (the D-U gap: unstamped non-first-option pin)', () => {
    expect(isOptionControlledLever({ factor_id: 'fac_union' }, union)).toBe(true);
    expect(isOptionControlledLever({ node_id: 'fac_union' }, union)).toBe(true);
  });
  it('does not fire for non-levers or other zero_reasons', () => {
    expect(isOptionControlledLever({ factor_id: 'fac_other' }, union)).toBe(false);
    expect(isOptionControlledLever({ factor_id: 'fac_other', zero_reason: 'no_path_to_goal' }, union)).toBe(false);
    expect(isOptionControlledLever({ factor_id: 'fac_other' })).toBe(false);
  });
});

describe('mergeIslConfidenceIntoGraphFactors — D-U guard on paths the route fixture cannot reach', () => {
  it('EMPTY islFactors: a union-member graph factor is still suppressed + stamped, influence kept', () => {
    const [lever, plain] = mergeIslConfidenceIntoGraphFactors(
      [graphFactor('fac_union'), graphFactor('fac_plain')],
      [], // ISL returned nothing — pre-D-U early return leaked the lever
      [],
      new Set(['fac_union']),
    );
    expect(lever.zero_reason).toBe('intervention_override');
    expect(lever.sensitivity_score).toBe(0);
    expect(lever.elasticity).toBe(0);
    expect(lever.value_of_information).toBe(0);
    expect(lever.influence_score).toBe(0.8); // structural importance preserved
    // non-lever untouched
    expect(plain.zero_reason).toBeUndefined();
    expect(plain.sensitivity_score).toBe(0.7);
  });

  it('EMPTY islFactors + no union: graph factors pass through untouched (pre-D-U behaviour preserved)', () => {
    const gf = graphFactor('fac_plain');
    const [out] = mergeIslConfidenceIntoGraphFactors([gf], [], []);
    expect(out).toBe(gf);
  });

  it('idempotence: an ISL-stamped union member is byte-identical with and without the structural set', () => {
    const graph = () => [graphFactor('fac_lever')];
    const isl = () => [
      {
        factor_id: 'fac_lever',
        sensitivity_score: 0,
        zero_reason: 'intervention_override',
        value_of_information: 0,
        source: 'isl',
      } as unknown as FactorSensitivityResultV3,
    ];
    const withoutSet = mergeIslConfidenceIntoGraphFactors(graph(), isl(), []);
    const withSet = mergeIslConfidenceIntoGraphFactors(graph(), isl(), [], new Set(['fac_lever']));
    expect(withSet).toEqual(withoutSet);
    expect(withSet[0].zero_reason).toBe('intervention_override');
    expect(withSet[0].sensitivity_score).toBe(0);
    expect(withSet[0].value_of_information).toBe(0);
  });

  it('append path: an UNSTAMPED ISL-only union member is skipped, exactly like a stamped one', () => {
    const islOnly = [
      {
        factor_id: 'fac_union',
        sensitivity_score: -0.19,
        value_of_information: 0.6,
        source: 'isl',
      } as unknown as FactorSensitivityResultV3,
      {
        factor_id: 'fac_keep',
        sensitivity_score: 0.5,
        value_of_information: 0.6,
        source: 'isl',
      } as unknown as FactorSensitivityResultV3,
    ];
    const out = mergeIslConfidenceIntoGraphFactors([], islOnly, [], new Set(['fac_union']));
    expect(out.map((f) => f.factor_id)).toEqual(['fac_keep']);
  });
});
