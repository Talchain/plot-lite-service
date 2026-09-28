/**
 * T7b — unit contract of `buildParameterUncertaintiesV3(nodes, options)` for a
 * ZERO-valued continuous factor with no user std (AIQ #72 5867008723).
 *
 * Route-level rows (AIQ's served GT1 request, frame invariance) live in
 * `default-spread-frame-invariant.route.test.ts`. This file pins the rule's
 * branches by node id, each against a contrast in the same call.
 */
import { describe, it, expect } from 'vitest';
import { buildParameterUncertaintiesV3, toISLRobustnessRequest } from '../src/integrations/isl/translator-v3.js';
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

function option(id: string, levels: Record<string, number>): OptionV3 {
  return {
    id,
    label: id,
    interventions: Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, { value: v }])),
  };
}

function stdOf(result: ReturnType<typeof buildParameterUncertaintiesV3>, id: string): number | undefined {
  const hits = (result ?? []).filter((p) => p.node_id === id);
  expect(hits.length, `one PU entry for ${id}`).toBe(1);
  return (hits[0] as { std?: number }).std;
}

describe('buildParameterUncertaintiesV3 — a zero estimate never takes its spread from the frame', () => {
  it('zero lever set by options → 0.15 × the largest |level| any option sets for it (no 0.1 floor)', () => {
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

  it('zero lever no option sets (or sets only to 0) → held at MIN_USER_STD; a set sibling keeps the rule', () => {
    const nodes = [factor('unset', 0), factor('zero_only', 0), factor('set', 0)];
    const options = [option('a', { set: 0.1 }), option('status_quo', { zero_only: 0, set: 0 })];
    const result = buildParameterUncertaintiesV3(nodes, options);
    expect(stdOf(result, 'unset')).toBe(MIN_USER_STD);
    expect(stdOf(result, 'zero_only')).toBe(MIN_USER_STD);
    expect(stdOf(result, 'set')).toBe(VALUE_BASED_STD_FRACTION * 0.1);
  });

  it('no options passed at all → held, never FALLBACK 0.5', () => {
    expect(stdOf(buildParameterUncertaintiesV3([factor('spend', 0)]), 'spend')).toBe(MIN_USER_STD);
  });

  it('toISLRobustnessRequest without a prebuilt PU list scales by the options it is sending', () => {
    const graph = {
      nodes: [factor('spend', 0), factor('unset', 0), { id: 'goal', kind: 'goal', label: 'goal' } as EngineNodeV3],
      edges: [],
    };
    const req = toISLRobustnessRequest(graph, [option('a', { spend: 0.2 }), option('b', { spend: 0.05 })], 'goal', 'req-t7b');
    expect(stdOf(req.parameter_uncertainties, 'spend')).toBe(VALUE_BASED_STD_FRACTION * 0.2);
    expect(stdOf(req.parameter_uncertainties, 'unset')).toBe(MIN_USER_STD);
  });

  it('CONTROLS: user std wins; non-zero keeps max(0.1, 0.15·|value|); binary keeps 0.3 — options ignored for all three', () => {
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
