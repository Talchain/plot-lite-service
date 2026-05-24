/**
 * Safe-failure regression pin for `deriveReadinessTone` inside `generateM1Coaching`.
 *
 * Verifies that when the tone classifier itself throws, the orchestrator's
 * `safeCompute` wrapper catches it and the rest of `m1_coaching` still emits.
 * The downstream prose generators (generateExecutiveSummary / generateNextActions)
 * are themselves wrapped in `safeCompute`, so their fallback recomputation also
 * throws and is caught at their own boundary — net effect:
 *
 *   - m1_coaching is NOT null
 *   - legacy `readiness` is unchanged
 *   - legacy `confidence_tier` mapping (readiness → tier) is preserved
 *   - new `readiness_tone` / `readiness_reasons` keys are ABSENT (not present
 *     with `undefined` — see the conditional-spread emission in m1-coaching.ts)
 *   - executive_summary → undefined, next_actions → [] (their own safeCompute)
 *   - story_headlines, evidence_gaps, model_critiques, key_drivers all emit
 *
 * Lives in its own file because the `vi.mock` of `readiness-tone.js` is
 * hoisted to module top and would also affect the happy-path tests in
 * `m1-readiness-tone-emission.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';

// Force the classifier to throw for every call (orchestrator + any downstream
// recomputation). The downstream functions are themselves wrapped in
// safeCompute at the orchestrator, so their re-throws are also caught.
vi.mock('../../src/coaching/readiness-tone.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/coaching/readiness-tone.js')>(
      '../../src/coaching/readiness-tone.js',
    );
  return {
    ...actual,
    deriveReadinessTone: () => {
      throw new Error('forced test failure — deriveReadinessTone unavailable');
    },
  };
});

import { generateM1Coaching } from '../../src/coaching/m1-coaching.js';
import { deriveConfidenceTier } from '../../src/trust/confidence-tier.js';
import type { EngineGraphV3, OptionV3 } from '../../src/types/engine-v3.js';

const graph = (): EngineGraphV3 => ({
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'f1', kind: 'factor', label: 'Brand awareness', category: 'controllable' },
    { id: 'f2', kind: 'factor', label: 'Market risk', category: 'external' },
  ],
  edges: [
    { from: 'f1', to: 'goal', strength: { mean: 0.7, std: 0.1 } },
    { from: 'f2', to: 'goal', strength: { mean: -0.4, std: 0.1 } },
  ],
});

const options = (): OptionV3[] => [
  { id: 'opt_a', label: 'Option A', winProbability: 0.80, expectedOutcome: 120 },
  { id: 'opt_b', label: 'Option B', winProbability: 0.15, expectedOutcome: 80 },
  { id: 'opt_status_quo', label: 'Status quo', winProbability: 0.05, expectedOutcome: 50 },
];

const islResult = () => ({
  options: [
    { id: 'opt_a', label: 'Option A', win_probability: 0.80, outcome: { mean: 120, p10: 100, p90: 140 } },
    { id: 'opt_b', label: 'Option B', win_probability: 0.15, outcome: { mean: 80, p10: 60, p90: 100 } },
    { id: 'opt_status_quo', label: 'Status quo', win_probability: 0.05, outcome: { mean: 50, p10: 40, p90: 60 } },
  ],
  factor_sensitivity: [
    {
      node_id: 'f1',
      label: 'Brand awareness',
      importance_rank: 1,
      elasticity: 0.7,
      influence_score: 0.85,
      confidence: 0.90,
      direction: 'positive',
    },
    {
      node_id: 'f2',
      label: 'Market risk',
      importance_rank: 2,
      elasticity: -0.3,
      influence_score: 0.40,
      confidence: 0.85,
      direction: 'negative',
    },
  ],
  robustness: {
    level: 'high',
    is_robust: true,
    fragile_edges: [],
    recommendation_stability: 0.90,
  },
});

describe('m1_coaching safe-failure path when deriveReadinessTone throws', () => {
  it('returns a non-null m1_coaching with legacy fields intact and tone fields absent', () => {
    const logger = { warn: vi.fn(), error: vi.fn() };

    const m1 = generateM1Coaching(graph(), options(), islResult(), logger);

    // Outer block survives: m1 is NOT null, the whole-block try/catch was NOT
    // tripped. This is the contract the safeCompute wrapper is buying us.
    expect(m1).not.toBeNull();

    // Legacy readiness is unchanged for a clear_winner-shaped fixture.
    expect(m1!.readiness).toBe('ready');
    expect(m1!.headline_type).toBe('clear_winner');

    // Confidence_tier mapping is preserved (readiness 'ready' → 'strong').
    // Pins the run.ts:2008 derivation against any drift caused by this PR.
    expect(deriveConfidenceTier(m1!.readiness)).toBe('strong');

    // New tone fields must be ABSENT (not own-properties with `undefined`).
    // Validates the conditional-spread emission pattern in m1-coaching.ts.
    expect('readiness_tone' in m1!).toBe(false);
    expect('readiness_reasons' in m1!).toBe(false);

    // Tone-dependent prose components degrade via their own safeCompute:
    //   next_actions  → []          (fallback in m1-coaching.ts)
    //   executive_summary → undefined (fallback in m1-coaching.ts)
    expect(m1!.next_actions).toEqual([]);
    expect(m1!.executive_summary).toBeUndefined();

    // Other phase-2/3/4 components are independent of tone and still emit.
    expect(m1!.story_headlines).toBeTypeOf('object');
    expect(Array.isArray(m1!.evidence_gaps)).toBe(true);
    expect(Array.isArray(m1!.model_critiques)).toBe(true);
    expect(Array.isArray(m1!.key_drivers)).toBe(true);
    expect(m1!.coaching_version).toBe('1.2.0');

    // safeCompute should have logged the classifier failure under the
    // 'readiness_tone' component name (plus separate logs for next_actions
    // and executive_summary when their fallback recomputations also threw).
    const warnCalls = logger.warn.mock.calls.map((c: any[]) => c[0]);
    const toneWarn = warnCalls.find(
      (event: any) => event?.event === 'm1_coaching_component_error' && event?.component === 'readiness_tone',
    );
    expect(toneWarn).toBeDefined();
  });
});
