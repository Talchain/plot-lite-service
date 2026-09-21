/**
 * ROADMAP 2.920 — the user's attested objective sense reaches ISL.
 *
 * WHY THIS EXISTS, MEASURED NOT REASONED. Deployed `isl-staging` (`build
 * c00f507`) accepts `goal_direction` and honours it. One variable, a goal node
 * that is a quantity to REDUCE, `seed: 7`, 400 samples:
 *
 *     absent      : opt_high 0.98125   ← the option that MAXIMISES churn leads
 *     'minimise'  : opt_low  0.98125   ← the ranking flips
 *     'maximise'  : opt_high 0.98125   ← byte-identical to absent
 *
 * The 'maximise' arm is the CONTROL: it proves absent ⇒ maximise, which is why
 * ISL emits `GOAL_DIRECTION_UNATTESTED` on every unstamped run and states that
 * "the historical rule crowned the worst option" for a reduce-goal. At the time
 * of writing neither CEE nor PLoT sent the field (0 occurrences at deployed
 * shas), so every live analysis of a reduce-goal ranked backwards.
 *
 * This suite pins the PLoT half: the field REACHES the wire when attested, and
 * — the property that makes it safe to land alone — the request is BYTE-
 * IDENTICAL to today when it is not.
 */

import { describe, it, expect } from 'vitest';
import {
  toISLRobustnessRequest,
  parseGoalDirection,
} from '../src/integrations/isl/translator-v3.js';
import type { EngineGraphV3, OptionV3 } from '../src/types/engine-v3.js';

const GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'lever', kind: 'factor', label: 'Spend', observed_state: { value: 0.5, std: 0.1 } },
    { id: 'goal', kind: 'outcome', label: 'Monthly churn' },
  ],
  edges: [
    { from: 'lever', to: 'goal', exists_probability: 0.95, strength: { mean: 0.6, std: 0.05 } },
  ],
} as unknown as EngineGraphV3;

// Intervention shape taken from tests/boundary-plot-to-isl.contract.test.ts, NOT
// invented: PLoT internal `InterventionValueV3` is an object, and the translator
// flattens it to a bare number only at the ISL boundary. A self-authored `0.2`
// here throws `Invalid intervention value` inside `toISLInterventions`.
const OPTIONS: OptionV3[] = [
  { id: 'opt_low', label: 'Low spend', interventions: { lever: { value: 0.2, source: 'user_specified' } } },
  { id: 'opt_high', label: 'High spend', interventions: { lever: { value: 0.8, source: 'user_specified' } } },
] as unknown as OptionV3[];

function build(direction?: 'maximise' | 'minimise' | 'target', threshold?: number, frame?: 'level' | 'delta') {
  return toISLRobustnessRequest(
    GRAPH, OPTIONS, 'goal', 'req-1',
    undefined, threshold, undefined, undefined, undefined,
    undefined, undefined, frame, undefined, direction,
  );
}

describe('goal_direction reaches the ISL wire', () => {
  it('forwards an attested minimise', () => {
    expect(build('minimise').goal_direction).toBe('minimise');
  });

  it('forwards an attested maximise', () => {
    expect(build('maximise').goal_direction).toBe('maximise');
  });

  // ⭐ THE PROPERTY THAT MAKES THIS SAFE TO LAND BEFORE ANY PRODUCER EXISTS.
  // Absent ⇒ the key is not merely undefined, it is NOT PRESENT: ISL's model is
  // `extra: "ignore"`, and a present-but-null key is a different wire fact from
  // an omitted one.
  it('omits the key entirely when unattested, leaving today behaviour unchanged', () => {
    const req = build(undefined);
    expect('goal_direction' in req).toBe(false);
  });
});

describe("the 'target' sense is never forwarded unsatisfiable", () => {
  // ISL: "a target sense with no target is refused at parse, never silently
  // downgraded to maximise" — a 422 that fails the WHOLE analysis. Dropping it
  // yields exactly today outcome instead of an outage.
  it('drops target when goal_threshold is absent', () => {
    expect('goal_direction' in build('target', undefined, 'delta')).toBe(false);
  });

  it('drops target when goal_threshold_frame is absent', () => {
    expect('goal_direction' in build('target', 0.3, undefined)).toBe(false);
  });

  it('forwards target when BOTH are present', () => {
    const req = build('target', 0.3, 'delta');
    expect(req.goal_direction).toBe('target');
    expect(req.goal_threshold).toBe(0.3);
    expect(req.goal_threshold_frame).toBe('delta');
  });

  // Contrast control: the guard is specific to 'target' and must not suppress
  // the two senses that carry no precondition.
  it('CONTROL: minimise is unaffected by the same missing threshold', () => {
    expect(build('minimise', undefined, undefined).goal_direction).toBe('minimise');
  });
});

describe('parseGoalDirection declines rather than guessing', () => {
  it.each(['maximise', 'minimise', 'target'] as const)('accepts %s', (v) => {
    expect(parseGoalDirection(v)).toBe(v);
  });

  // A WRONG direction inverts the ranking and is strictly worse than today
  // error, so everything unrecognised must fall back to the omitted key.
  it.each([
    ['maximize (US spelling)', 'maximize'],
    ['minimize (US spelling)', 'minimize'],
    ['empty string', ''],
    ['unrelated word', 'hold'],
    ['null', null],
    ['undefined', undefined],
    ['number', 1],
    ['object', { direction: 'minimise' }],
  ])('declines %s', (_label, v) => {
    expect(parseGoalDirection(v)).toBeUndefined();
  });
});
