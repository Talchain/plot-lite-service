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
  exactInputOptionIds,
  pinnedLeverIds,
  toISLRobustnessRequest,
  zeroFactorHeldWarnings,
  zeroFactorsHeldExact,
} from '../src/integrations/isl/translator-v3.js';
import { withExactInputZeroVarianceWording, ZERO_VARIANCE_EXACT_INPUTS_MESSAGE } from '../src/critique-humaniser.js';
import {
  MIN_USER_STD,
  VALUE_BASED_STD_FRACTION,
  BINARY_DEFAULT_STD,
  DEFAULT_STD_FLOOR,
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

  // 4b AMENDED (AIQ #72 5869679096, measured on served journey E): FALLBACK_STD was half the FRAME — doubling a frame
  // moved E's goal sd +30%. A zero nothing gives a scale is HELD at 0 (point_mass) and NAMED (`zeroFactorsHeldExact`).
  it('VERIFIER ROW, re-ruled — a zero factor NO option touches is held at 0 (point_mass) and named, never FALLBACK_STD', () => {
    // Golden `fac_hiring_cost` shape: value 0, no std, no option intervenes on it.
    // Contrast in the same call: a sibling the options DO set keeps the T7b rule.
    const nodes = [factor('fac_hiring_cost', 0), factor('set', 0)];
    const options = [option('a', { set: 0.1 }), option('status_quo', { set: 0 })];
    const result = buildParameterUncertaintiesV3(nodes, options);
    expect(puOf(result, 'fac_hiring_cost')).toStrictEqual(POINT_MASS('fac_hiring_cost'));
    expect(stdOf(result, 'set')).toBe(VALUE_BASED_STD_FRACTION * 0.1);
    expect(zeroFactorsHeldExact(nodes, options).map((h) => h.node_id)).toEqual(['fac_hiring_cost']);
  });

  it('a zero factor that cannot be pinned, set by options ONLY to 0 → held at 0 too (no scale), and named', () => {
    const nodes = [factor('zero_only', 0), factor('observable_zero', 0, {})];
    (nodes[1] as { category?: string }).category = 'observable';
    const options = [option('a', { zero_only: 0, observable_zero: 0 }), option('b', { zero_only: 0 })];
    const result = buildParameterUncertaintiesV3(nodes, options);
    expect(puOf(result, 'zero_only')).toStrictEqual(POINT_MASS('zero_only'));
    expect(puOf(result, 'observable_zero')).toStrictEqual(POINT_MASS('observable_zero'));
    expect(zeroFactorsHeldExact(nodes, options).map((h) => h.node_id)).toEqual(['zero_only', 'observable_zero']);
  });

  it('no options passed at all → held at 0, named — never a frame-sized spread', () => {
    expect(puOf(buildParameterUncertaintiesV3([factor('spend', 0)]), 'spend')).toStrictEqual(POINT_MASS('spend'));
    expect(zeroFactorsHeldExact([factor('spend', 0)]).map((h) => h.node_id)).toEqual(['spend']);
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
    expect(puOf(req.parameter_uncertainties, 'unset')).toStrictEqual(POINT_MASS('unset'));
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

/**
 * ⛔ 4b AMENDED — a zero nothing gives a scale is held at 0 and SAID (AIQ #72 5869679096). Served journey E
 * (PLoT ccd602c · ISL a1fa8ae): `engineering_delivery_capacity` (0 FTE) and `annual_salary_spend` (£0) are zero and no
 * option sets them; FALLBACK_STD sampled salary at ±£500,000 on a £1m frame, and doubling either frame moved the goal
 * sd 0.344 → 0.445 (+30%). Held exact, the wire no longer depends on the frame, and the user is told.
 */
describe('4b amended — held at 0, frame-free, and named', () => {
  const E = (): EngineNodeV3[] => [
    { ...factor('engineering_delivery_capacity', 0, { unit: 'FTE' }), label: 'Engineering delivery capacity' } as EngineNodeV3,
    { ...factor('annual_salary_spend', 0, { unit: 'GBP per year' }), label: 'Annual salary spend' } as EngineNodeV3,
    lever('hires', 0.2, 'brief_extraction'),
  ];
  const E_OPTIONS = [option('seniors', { hires: 0.2 }), option('juniors', { hires: 0.4 })];

  it('⭐ RED (E): both untouched zeros go out as point_mass, whatever the frame (×1 and ×2 byte-identical)', () => {
    const at = (frame: number) => {
      const nodes = E().map((n) => (n.id === 'hires' ? n : ({ ...n, scale_frame: frame } as EngineNodeV3)));
      const r = buildParameterUncertaintiesV3(nodes, E_OPTIONS);
      return [puOf(r, 'engineering_delivery_capacity'), puOf(r, 'annual_salary_spend')];
    };
    expect(at(1_000_000)).toStrictEqual([POINT_MASS('engineering_delivery_capacity'), POINT_MASS('annual_salary_spend')]);
    expect(at(2_000_000)).toStrictEqual(at(1_000_000));
  });

  it('⭐ RED (E): the typed warning names BOTH factors, each as the user writes the figure', () => {
    const held = zeroFactorsHeldExact(E(), E_OPTIONS);
    expect(held.map((h) => h.node_id)).toEqual(['engineering_delivery_capacity', 'annual_salary_spend']);
    expect(zeroFactorHeldWarnings(held)).toEqual([
      { code: 'ZERO_FACTOR_HELD_EXACT', severity: 'info', node_label: 'Engineering delivery capacity',
        message: 'Olumi holds "Engineering delivery capacity" at 0 FTE with no uncertainty; give a range if it can vary.' },
      { code: 'ZERO_FACTOR_HELD_EXACT', severity: 'info', node_label: 'Annual salary spend',
        message: 'Olumi holds "Annual salary spend" at £0 with no uncertainty; give a range if it can vary.' },
    ]);
  });

  it('a held zero named in factor_correlations goes out as a normal at MIN_USER_STD (ISL rejects a correlated point_mass) — still named', () => {
    const r = buildParameterUncertaintiesV3(E(), E_OPTIONS, new Set(['annual_salary_spend']));
    expect(puOf(r, 'annual_salary_spend')).toStrictEqual({ node_id: 'annual_salary_spend', distribution: 'normal', std: MIN_USER_STD });
    expect(zeroFactorsHeldExact(E(), E_OPTIONS).map((h) => h.node_id)).toContain('annual_salary_spend');
  });

  it('CONTROLS — never held: a user std, a binary, an option-set zero (4a), a pinned lever (its own named rule)', () => {
    const nodes = [
      factor('user_std', 0, { std: 0.2 }),
      factor('binary_zero', 0, { unit: 'boolean' }),
      factor('set_zero', 0),
      lever('pinned_zero', 0, 'cee_inference'),
    ];
    const options = [option('a', { set_zero: 0.1, pinned_zero: 0.2 }), option('sq', { set_zero: 0, pinned_zero: 0 })];
    const held = zeroFactorsHeldExact(nodes, options).map((h) => h.node_id);
    expect(held).not.toContain('user_std');
    expect(held).not.toContain('binary_zero');
    expect(held).not.toContain('set_zero');
    expect(held).not.toContain('pinned_zero');
    const r = buildParameterUncertaintiesV3(nodes, options);
    expect(stdOf(r, 'set_zero')).toBe(VALUE_BASED_STD_FRACTION * 0.1);
    expect(stdOf(r, 'user_std')).toBe(0.2);
    // The held list is the builder's own 4b set: every held id went out exact, and nothing else did under 4b.
    for (const id of held) expect(puOf(r, id)).toStrictEqual(POINT_MASS(id));
  });
});

/** (b) wording (AIQ #72 5869679096): zero variance on an option whose every goal ancestor it sets is exact. */
describe('exact-input zero variance — the true sentence, only when it is true', () => {
  // GT1 shape: goal = the spend tally; both levers pinned (today £0, the carry-on option sets £0).
  const nodes = [lever('features', 0, 'cee_inference'), lever('ads', 0, 'cee_inference'), factor('tally', 0), factor('elsewhere', 0.5)];
  const edges = [{ from: 'features', to: 'tally' }, { from: 'ads', to: 'tally' }];
  const options = [
    option('features_opt', { features: 0.1 }), option('ads_opt', { ads: 0.1 }),
    option('carry_on', { features: 0, ads: 0 }), option('off_path', { elsewhere: 0.9 }),
  ];
  const pus = buildParameterUncertaintiesV3(nodes, options) ?? [];

  it('options that set only exact goal ancestors are named; one that sets nothing on the path is not', () => {
    expect([...exactInputOptionIds(nodes, edges, 'tally', options, pus)].sort()).toEqual(['ads_opt', 'carry_on', 'features_opt']);
  });

  it('an option that sets a goal ancestor sent as a NORMAL is not exact-input', () => {
    const sampled = pus.map((p) => (p.node_id === 'ads' ? { node_id: 'ads', distribution: 'normal', std: 0.1 } : p));
    expect(exactInputOptionIds(nodes, edges, 'tally', options, sampled).has('ads_opt')).toBe(false);
  });

  it('the critique text swaps ONLY for DEGENERATE_OPTION_ZERO_VARIANCE whose every named option is exact-input', () => {
    const exact = exactInputOptionIds(nodes, edges, 'tally', options, pus);
    const c = (code: string, ids: string[]) => ({ code, user_message: 'orig', affected_option_ids: ids });
    const out = withExactInputZeroVarianceWording([
      c('DEGENERATE_OPTION_ZERO_VARIANCE', ['features_opt']),
      c('DEGENERATE_OPTION_ZERO_VARIANCE', ['off_path']),
      c('DEGENERATE_OPTION_ZERO_VARIANCE', ['features_opt', 'off_path']),
      c('HIGH_TIE_RATE', ['features_opt']),
    ], exact);
    expect(out.map((x) => x.user_message)).toEqual([ZERO_VARIANCE_EXACT_INPUTS_MESSAGE, 'orig', 'orig', 'orig']);
    expect(ZERO_VARIANCE_EXACT_INPUTS_MESSAGE).toBe("This option's result has no spread: every figure it depends on is set exactly.");
  });
});

