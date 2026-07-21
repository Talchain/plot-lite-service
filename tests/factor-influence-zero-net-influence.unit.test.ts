/**
 * A3 adjacent-hunt FIX #4 — false 'no_path_to_goal' on a connected zero-strength factor.
 *
 * CONFIRMED PRE-EXISTING MISLABEL (RED before the fix):
 *
 * computeFactorSensitivityFromGraph stamps `zero_reason: 'no_path_to_goal'`
 * whenever `f.influence === 0 && f.confidence === 0`. But those two path-based
 * values collapse to {0, 0} for TWO structurally-distinct cases:
 *   (a) a TRULY disconnected factor — findAllPathsToGoal returns [] (early
 *       return in computeInfluenceFromPaths); and
 *   (b) a CONNECTED factor whose only path carries zero net effect — e.g. a
 *       single edge with strength.mean = 0 (exists_probability high enough to
 *       survive buildEdgeLookup). The path IS found, but every path effect is 0,
 *       so totalWeight = 0 and the weighted-confidence branch yields 0.
 *
 * Case (b) is CONNECTED, yet it lands on the same {0,0} and is falsely labelled
 * "no path to goal". The correct label distinguishes the two: 'no_path_to_goal'
 * only when paths.length === 0; a connected-but-zero factor gets a distinct
 * reason ('zero_net_influence'). `zero_reason` is an open-vocabulary string
 * (src/types/engine-v3.ts, contracts/schemas/plot-response.schema.json — plain
 * `string`, no enum), and every consumer keys only on 'intervention_override',
 * so the new value is additive.
 */

import { describe, it, expect } from 'vitest';
import { computeFactorSensitivityFromGraph } from '../src/lib/factor-influence.js';
import type { EngineGraphV3 } from '../src/types/engine-v3.js';

/**
 * fac_a → goal via a SINGLE edge whose strength.mean is 0 but whose
 * exists_probability (0.8) clears MIN_EXISTS_PROBABILITY — so the edge is in the
 * lookup and a path IS found (paths.length === 1), but the path effect is 0.
 */
const CONNECTED_ZERO_STRENGTH_GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'fac_a', kind: 'factor', label: 'Factor A' },
    { id: 'goal', kind: 'goal', label: 'Goal' },
  ],
  edges: [
    {
      from: 'fac_a',
      to: 'goal',
      exists_probability: 0.8, // edge EXISTS (survives buildEdgeLookup)
      strength: { mean: 0, std: 0.1 }, // ...but carries zero net effect
    },
  ],
};

/** fac_a exists but has NO edge to the goal at all → paths.length === 0. */
const DISCONNECTED_GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'fac_a', kind: 'factor', label: 'Factor A' },
    { id: 'goal', kind: 'goal', label: 'Goal' },
  ],
  edges: [],
};

describe('factor zero_reason taxonomy (A3 adjacent-hunt FIX #4)', () => {
  it('BUG: a CONNECTED zero-strength factor must NOT be labelled no_path_to_goal', () => {
    const result = computeFactorSensitivityFromGraph(CONNECTED_ZERO_STRENGTH_GRAPH, 'goal');
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);

    const factor = result![0];
    // It has zero net influence (single zero-strength path)...
    expect(factor.sensitivity_score).toBe(0);
    // ...but it IS connected — the label must reflect connected-zero, not disconnection.
    expect(factor.zero_reason).not.toBe('no_path_to_goal');
    expect(factor.zero_reason).toBe('zero_net_influence');
  });

  it('REGRESSION: a truly disconnected factor (no path) stays no_path_to_goal', () => {
    const result = computeFactorSensitivityFromGraph(DISCONNECTED_GRAPH, 'goal');
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);

    const factor = result![0];
    expect(factor.sensitivity_score).toBe(0);
    expect(factor.zero_reason).toBe('no_path_to_goal');
  });
});
