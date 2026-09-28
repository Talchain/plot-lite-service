/**
 * T7b — unit contract of `buildParameterUncertaintiesV3(nodes, options)` for a
 * ZERO-valued continuous factor with no user std (AIQ #72 5867008723), and of
 * the AMENDED rule's PINNED levers (AIQ #72 5867604513 + 5867934055).
 *
 * Route-level rows (AIQ's served GT1 request, frame invariance) live in
 * `default-spread-frame-invariant.route.test.ts`. This file pins the rule's
 * branches by node id, each against a contrast in the same call.
 */
import { describe, it, expect } from 'vitest';
import {
  buildParameterUncertaintiesV3,
  pinnedLeverIds,
  toISLRobustnessRequest,
} from '../src/integrations/isl/translator-v3.js';
import {
  MIN_USER_STD,
  VALUE_BASED_STD_FRACTION,
  BINARY_DEFAULT_STD,
  DEFAULT_STD_FLOOR,
  FALLBACK_STD,
} from '../src/integrations/isl/parameter-uncertainty-bounds.js';
import type { EngineNodeV3, OptionV3 } from '../src/types/engine-v3.js';

function factor(id: string, value: number, extra: Record<string, unknown> = {}): EngineNodeV3 {
  return { id, kind: 'factor', label: id, observed_state: { value, ...extra } } as EngineNodeV3;
}

/** A controllable lever — the only kind the amended rule can pin. */
function lever(id: string, value: number, source: string | undefined, extra: Record<string, unknown> = {}): EngineNodeV3 {
  return {
    id,
    kind: 'factor',
    label: id,
    category: 'controllable',
    observed_state: { value, ...(source !== undefined ? { source } : {}), ...extra },
  } as EngineNodeV3;
}

function option(id: string, levels: Record<string, number>): OptionV3 {
  return {
    id,
    label: id,
    interventions: Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, { value: v }])),
  };
}

function puOf(result: ReturnType<typeof buildParameterUncertaintiesV3>, id: string): Record<string, unknown> {
  const hits = (result ?? []).filter((p) => p.node_id === id);
  expect(hits.length, `one PU entry for ${id}`).toBe(1);
  return hits[0] as Record<string, unknown>;
}

function stdOf(result: ReturnType<typeof buildParameterUncertaintiesV3>, id: string): number | undefined {
  const pu = puOf(result, id);
  expect(pu.distribution, `${id} is a normal`).toBe('normal');
  return pu.std as number | undefined;
}

const POINT_MASS = (id: string) => ({ node_id: id, distribution: 'point_mass' });

describe('buildParameterUncertaintiesV3 — a zero estimate never takes its spread from the frame', () => {
  it('zero lever set by options → 0.15 × the largest |level| any option sets for it (no 0.1 floor)', () => {
    // No `category`: these cannot be pinned, so the status-quo 0 does not hold them.
    const nodes = [factor('spend', 0), factor('other_spend', 0)];
    const options = [
      option('a', { spend: 0.2 }),
      option('b', { spend: 0.05, other_spend: -0.4 }),
      option('status_quo', { spend: 0, other_spend: 0 }),
    ];
    const result = buildParameterUncertaintiesV3(nodes, options);
    expect(stdOf(result, 'spend')).toBe(VALUE_BASED_STD_FRACTION * 0.2);
    // |level|: a negative level scales the same way.
    expect(stdOf(result, 'other_spend')).toBe(VALUE_BASED_STD_FRACTION * 0.4);
    // The synthesised-default floor would have widened 0.03 to 0.1 (a frame fraction).
    expect(stdOf(result, 'spend')).toBeLessThan(DEFAULT_STD_FLOOR);
  });

  it('VERIFIER ROW — a zero factor NO option touches keeps the BASE path (FALLBACK_STD 0.5), never a silent 1e-4 hold', () => {
    // Golden `fac_hiring_cost` shape: value 0, no std, no option intervenes on it.
    // Contrast in the same call: a sibling the options DO set keeps the T7b rule.
    const nodes = [factor('fac_hiring_cost', 0), factor('set', 0)];
    const options = [option('a', { set: 0.1 }), option('status_quo', { set: 0 })];
    const result = buildParameterUncertaintiesV3(nodes, options);
    expect(puOf(result, 'fac_hiring_cost')).toStrictEqual({ node_id: 'fac_hiring_cost', distribution: 'normal', std: FALLBACK_STD });
    expect(stdOf(result, 'fac_hiring_cost')).not.toBe(MIN_USER_STD);
    expect(stdOf(result, 'set')).toBe(VALUE_BASED_STD_FRACTION * 0.1);
  });

  it('a zero factor that cannot be pinned, set by options ONLY to 0 → the base path too (no scale, no silent hold)', () => {
    const nodes = [factor('zero_only', 0), factor('observable_zero', 0, {})];
    (nodes[1] as { category?: string }).category = 'observable';
    const options = [option('a', { zero_only: 0, observable_zero: 0 }), option('b', { zero_only: 0 })];
    const result = buildParameterUncertaintiesV3(nodes, options);
    expect(stdOf(result, 'zero_only')).toBe(FALLBACK_STD);
    expect(stdOf(result, 'observable_zero')).toBe(FALLBACK_STD);
  });

  it('no options passed at all → the base path, never a hold', () => {
    expect(stdOf(buildParameterUncertaintiesV3([factor('spend', 0)]), 'spend')).toBe(FALLBACK_STD);
  });

  it('toISLRobustnessRequest without a prebuilt PU list scales and pins by the options it is sending', () => {
    const graph = {
      nodes: [
        factor('spend', 0),
        factor('unset', 0),
        lever('pinned_zero', 0, 'cee_inference'),
        { id: 'goal', kind: 'goal', label: 'goal' } as EngineNodeV3,
      ],
      edges: [],
    };
    const req = toISLRobustnessRequest(
      graph,
      [option('a', { spend: 0.2, pinned_zero: 0.2 }), option('b', { spend: 0.05, pinned_zero: 0 })],
      'goal',
      'req-t7b',
    );
    expect(stdOf(req.parameter_uncertainties, 'spend')).toBe(VALUE_BASED_STD_FRACTION * 0.2);
    expect(stdOf(req.parameter_uncertainties, 'unset')).toBe(FALLBACK_STD);
    expect(puOf(req.parameter_uncertainties, 'pinned_zero')).toStrictEqual(POINT_MASS('pinned_zero'));
  });

  it('CONTROLS: user std wins; non-zero keeps max(0.1, 0.15·|value|); binary keeps 0.3 — options ignored for all three (none controllable)', () => {
    const nodes = [
      factor('user_std', 0, { std: 0.07 }),
      factor('nonzero_big', 0.8),
      factor('nonzero_small', 0.3),
      { id: 'switch', kind: 'factor', label: 'switch', observed_state: { value: 0 }, state_space: { range: { min: 0, max: 1 } } } as unknown as EngineNodeV3,
    ];
    const options = [option('a', { user_std: 0.9, nonzero_big: 0.9, nonzero_small: 0.9, switch: 1 })];
    const result = buildParameterUncertaintiesV3(nodes, options);
    expect(stdOf(result, 'user_std')).toBe(0.07);
    expect(stdOf(result, 'nonzero_big')).toBe(0.8 * VALUE_BASED_STD_FRACTION);
    expect(stdOf(result, 'nonzero_small')).toBe(DEFAULT_STD_FLOOR);
    expect(stdOf(result, 'switch')).toBe(BINARY_DEFAULT_STD);
  });
});

describe('T7b amended rule — a PINNED lever is held EXACT (point_mass)', () => {
  it('GT1 shape: a controllable zero lever (cee_inference) the carry-on option sets to 0 → point_mass; the rise option does not unpin it', () => {
    const nodes = [
      lever('feature_development_spend', 0, 'cee_inference'),
      lever('additional_advertising_spend', 0, 'cee_inference'),
    ];
    const options = [
      option('features_pro_price_rise', { feature_development_spend: 0.2 }),
      option('additional_advertising', { additional_advertising_spend: 0.2 }),
      option('carry_on_as_now', { feature_development_spend: 0, additional_advertising_spend: 0 }),
      option('split', { feature_development_spend: 0.05, additional_advertising_spend: 0.05 }),
    ];
    const result = buildParameterUncertaintiesV3(nodes, options);
    expect(puOf(result, 'feature_development_spend')).toStrictEqual(POINT_MASS('feature_development_spend'));
    expect(puOf(result, 'additional_advertising_spend')).toStrictEqual(POINT_MASS('additional_advertising_spend'));
  });

  it('AIQ CONTROL 1: a user-stated today (brief_extraction) echoed by an option → point_mass, EVEN WITH a CEE-sent std', () => {
    const nodes = [
      lever('pro_plan_price', 0.245, 'brief_extraction', { std: 1e-4 }),
      // Contrast in the same call: the same shape with no option echoing today keeps the CEE std.
      lever('other_price', 0.245, 'brief_extraction', { std: 1e-4 }),
    ];
    const options = [
      option('rise', { pro_plan_price: 0.295, other_price: 0.295 }),
      option('carry_on', { pro_plan_price: 0.245 }),
    ];
    const result = buildParameterUncertaintiesV3(nodes, options);
    expect(puOf(result, 'pro_plan_price')).toStrictEqual(POINT_MASS('pro_plan_price'));
    expect(stdOf(result, 'other_price')).toBe(1e-4);
  });

  it('AIQ CONTROL 2: an option-set zero lever with NO option at today\'s level → 0.15 × max (normal)', () => {
    const nodes = [lever('spend', 0, 'cee_inference')];
    const options = [option('a', { spend: 0.2 }), option('b', { spend: 0.05 })];
    const result = buildParameterUncertaintiesV3(nodes, options);
    expect(stdOf(result, 'spend')).toBe(VALUE_BASED_STD_FRACTION * 0.2);
  });

  it('AIQ MUTANT ROW: an Olumi NON-zero estimate (cee_inference £10,000) an option merely echoes is NOT pinned — it keeps max(0.1, 0.15|v|)', () => {
    // £10,000 on a £100k frame = 0.1 normalised; "keep marketing as is" at £10,000.
    const nodes = [
      lever('marketing_spend', 0.1, 'cee_inference'),
      // Contrast: the SAME number, stated by the user → pinned.
      lever('user_marketing_spend', 0.1, 'user_edited'),
    ];
    const options = [
      option('keep_as_is', { marketing_spend: 0.1, user_marketing_spend: 0.1 }),
      option('double', { marketing_spend: 0.2, user_marketing_spend: 0.2 }),
    ];
    const result = buildParameterUncertaintiesV3(nodes, options);
    expect(puOf(result, 'marketing_spend')).toStrictEqual({
      node_id: 'marketing_spend',
      distribution: 'normal',
      std: Math.max(DEFAULT_STD_FLOOR, VALUE_BASED_STD_FRACTION * 0.1),
    });
    expect(puOf(result, 'user_marketing_spend')).toStrictEqual(POINT_MASS('user_marketing_spend'));
  });

  it('a pinned lever NAMED in factor_correlations stays a normal at MIN_USER_STD (ISL rejects a correlated point_mass); an unnamed sibling is point_mass', () => {
    const nodes = [lever('a_spend', 0, 'cee_inference'), lever('b_spend', 0, 'cee_inference'), factor('driver', 0.8)];
    const options = [option('go', { a_spend: 0.2, b_spend: 0.2 }), option('carry_on', { a_spend: 0, b_spend: 0 })];
    const result = buildParameterUncertaintiesV3(nodes, options, new Set(['a_spend', 'driver']));
    expect(puOf(result, 'a_spend')).toStrictEqual({ node_id: 'a_spend', distribution: 'normal', std: MIN_USER_STD });
    expect(puOf(result, 'b_spend')).toStrictEqual(POINT_MASS('b_spend'));
    // Correlation membership changes nothing for a factor that is not pinned.
    expect(stdOf(result, 'driver')).toBe(0.8 * VALUE_BASED_STD_FRACTION);
  });

  it('toISLRobustnessRequest derives the correlated set from factorCorrelations when it builds the PU list itself', () => {
    const graph = {
      nodes: [lever('a_spend', 0, 'cee_inference'), lever('b_spend', 0, 'cee_inference'), { id: 'goal', kind: 'goal', label: 'goal' } as EngineNodeV3],
      edges: [],
    };
    const options = [option('go', { a_spend: 0.2, b_spend: 0.2 }), option('carry_on', { a_spend: 0, b_spend: 0 })];
    const req = toISLRobustnessRequest(
      graph, options, 'goal', 'req-t7b-corr',
      undefined, undefined, undefined, undefined, undefined, undefined,
      [{ factor_a: 'a_spend', factor_b: 'b_spend', rho: 0.3 }],
    );
    expect(puOf(req.parameter_uncertainties, 'a_spend')).toStrictEqual({ node_id: 'a_spend', distribution: 'normal', std: MIN_USER_STD });
    expect(puOf(req.parameter_uncertainties, 'b_spend')).toStrictEqual({ node_id: 'b_spend', distribution: 'normal', std: MIN_USER_STD });
    expect(req.factor_correlations).toHaveLength(1);
  });
});

describe('pinnedLeverIds — the amended rule\'s membership, by id', () => {
  const USER_OWN = [
    'brief_extraction', 'explicit', 'user', 'user_override', 'user_edited',
    'user_calibration', 'panel_elicited', 'user_confirmed', 'user_assumption',
  ];

  it('every user-own stamp pins a NON-zero echoed today; Olumi/absent stamps do not', () => {
    const own = USER_OWN.map((s) => lever(`own_${s}`, 0.3, s));
    const notOwn = ['cee_inference', 'inferred', 'cee_repair', 'USER', undefined].map((s, i) => lever(`not_own_${i}`, 0.3, s));
    const nodes = [...own, ...notOwn];
    const echo = option('carry_on', Object.fromEntries(nodes.map((n) => [n.id, 0.3])));
    expect([...pinnedLeverIds(nodes, [echo])].sort()).toStrictEqual(own.map((n) => n.id).sort());
  });

  it('a zero today pins whatever its source; a non-controllable factor never pins', () => {
    const nodes = [
      lever('zero_inferred', 0, 'cee_inference'),
      lever('zero_unstamped', 0, undefined),
      { ...factor('observable_zero', 0, { source: 'brief_extraction' }), category: 'observable' } as EngineNodeV3,
      { ...factor('external_own', 0.3, { source: 'brief_extraction' }), category: 'external' } as EngineNodeV3,
      factor('uncategorised_own', 0.3, { source: 'brief_extraction' }),
    ];
    const echo = option('carry_on', { zero_inferred: 0, zero_unstamped: 0, observable_zero: 0, external_own: 0.3, uncategorised_own: 0.3 });
    expect([...pinnedLeverIds(nodes, [echo])].sort()).toStrictEqual(['zero_inferred', 'zero_unstamped']);
  });

  it('"exactly" = |level − today| ≤ 1e-9 × max(1, |today|)', () => {
    const nodes = [
      lever('in_small', 0.3, 'user'),
      lever('out_small', 0.3, 'user'),
      lever('in_big', 5000, 'user'),
      lever('out_big', 5000, 'user'),
      lever('zero_in', 0, 'cee_inference'),
      lever('zero_out', 0, 'cee_inference'),
    ];
    const echo = option('carry_on', {
      in_small: 0.3 + 0.9e-9,
      out_small: 0.3 + 1.1e-9,
      in_big: 5000 + 5000 * 0.9e-9,
      out_big: 5000 + 5000 * 1.1e-9,
      zero_in: 0.9e-9,
      zero_out: 1.1e-9,
    });
    expect([...pinnedLeverIds(nodes, [echo])].sort()).toStrictEqual(['in_big', 'in_small', 'zero_in']);
  });

  it('no option at today\'s level, or no options → nothing pinned', () => {
    const nodes = [lever('spend', 0, 'cee_inference'), lever('price', 0.245, 'brief_extraction')];
    expect(pinnedLeverIds(nodes, [option('a', { spend: 0.2, price: 0.3 })]).size).toBe(0);
    expect(pinnedLeverIds(nodes, []).size).toBe(0);
  });
});
