/**
 * ROADMAP 2.919 — Baseline in the canonical request hash (v7 amendment)
 *
 * The goal baseline changes `probability_of_goal`: ISL converts a `'level'`
 * goal threshold via `threshold − goal_baseline + goal_intercept`
 * (translator-v3.ts, `ISL_DECLARED_OBSERVED_STATE_FIELDS` — `baseline` is
 * load-bearing on that list), and evaluates goal_constraints against
 * change-from-baseline samples. Two requests differing ONLY in a baseline are
 * genuinely different computations and MUST hash differently. Before this
 * change they shared a response_hash, so the UI's run-identity gates
 * (applyV5State.ts dedupe / dirty-overlay clearing) could mistake a
 * baseline-only rerun for a re-delivered echo.
 *
 * Bounded-flip guarantee (the load-bearing property of this amendment):
 * an ABSENT baseline contributes no key to the canonical form, so every
 * baseline-free request canonicalises BYTE-IDENTICALLY to pre-change v7 —
 * only baseline-BEARING requests change hash. Witnessed at the integration
 * level by tests/isl-v2-golden-response.pin.test.ts, whose live-capture
 * fixture carries no baseline and whose pinned hash 60e3ac213554be4f must
 * NOT move under this change.
 *
 * Trap-13b discipline: the discrimination tests pin their own precondition
 * (the fixtures provably differ in baseline before hashing), so a fixture
 * tidy-up cannot hollow them into always-green.
 */

import { describe, it, expect } from 'vitest';
import {
  canonicaliseRequest,
  computeResponseHash,
  HASH_VERSION,
} from '../src/normalisation/canonicalise.js';
import type { RunRequestV3, EngineGraphV3 } from '../src/types/engine-v3.js';

/**
 * Build a graph whose goal node and one factor node can carry
 * observed_state.baseline. Mirrors the post-normalisation EngineGraphV3 shape
 * hashRequest receives (run.ts:6306/7808 pass filteredGraph = normaliser
 * output with option nodes filtered).
 */
function makeGraph(opts: {
  goalBaseline?: number;
  factorABaseline?: number;
  goalValue?: number;
} = {}): EngineGraphV3 {
  const goalObserved: { value: number; baseline?: number } = {
    value: opts.goalValue ?? 100,
  };
  if (opts.goalBaseline !== undefined) goalObserved.baseline = opts.goalBaseline;

  const factorAObserved: { value: number; baseline?: number } = { value: 10 };
  if (opts.factorABaseline !== undefined) factorAObserved.baseline = opts.factorABaseline;

  return {
    nodes: [
      { id: 'factor-a', kind: 'factor', label: 'Factor A', observed_state: factorAObserved },
      { id: 'factor-b', kind: 'factor', label: 'Factor B' },
      { id: 'goal', kind: 'goal', label: 'Goal', observed_state: goalObserved },
    ],
    edges: [
      { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
      { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
    ],
  } as EngineGraphV3;
}

const OPTIONS = [
  { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': { value: 1.5, source: 'user_specified' } } },
  { id: 'opt2', label: 'Option 2', interventions: { 'factor-b': { value: 2.0, source: 'user_specified' } } },
];

function makeRequest(graph: EngineGraphV3): RunRequestV3 {
  return {
    graph,
    options: OPTIONS,
    goal_node_id: 'goal',
    seed: '42',
  } as unknown as RunRequestV3;
}

const canonOf = (graph: EngineGraphV3) =>
  canonicaliseRequest(makeRequest(graph), graph, '42');
const hashOf = (graph: EngineGraphV3) => computeResponseHash(canonOf(graph));

/** Pull a node's canonical observed_state out of the serialised canonical form. */
function canonicalNode(canonical: string, id: string): any {
  const parsed = JSON.parse(canonical);
  return parsed.graph.nodes.find((n: any) => n.id === id);
}

describe('Hash baseline-awareness (2.919, v7 amendment)', () => {
  it('B1: two requests differing ONLY in the goal node baseline → different hashes, identity-bound to the exact values', () => {
    const gA = makeGraph({ goalBaseline: 0.42 });
    const gB = makeGraph({ goalBaseline: 0.58 });

    // Trap-13b: pin the precondition — the fixtures genuinely differ in
    // baseline, on the goal node, and in nothing else the hash can see.
    const goalA = gA.nodes.find((n) => n.id === 'goal')!;
    const goalB = gB.nodes.find((n) => n.id === 'goal')!;
    expect(goalA.observed_state?.baseline).toBe(0.42);
    expect(goalB.observed_state?.baseline).toBe(0.58);
    expect(goalA.observed_state?.baseline).not.toBe(goalB.observed_state?.baseline);

    // Identity binding: the canonical form must carry EACH exact baseline
    // (not merely "some difference somewhere").
    expect(canonicalNode(canonOf(gA), 'goal').observed_state.baseline).toBe(0.42);
    expect(canonicalNode(canonOf(gB), 'goal').observed_state.baseline).toBe(0.58);

    expect(hashOf(gA)).not.toBe(hashOf(gB));
  });

  it('B2 (discriminating control): two requests identical INCLUDING baseline → SAME hash', () => {
    const gA = makeGraph({ goalBaseline: 0.42, factorABaseline: 7 });
    const gB = makeGraph({ goalBaseline: 0.42, factorABaseline: 7 });
    expect(hashOf(gA)).toBe(hashOf(gB));
  });

  it('B3: baseline present vs absent on the SAME node → different hashes (absent is NOT coerced to 0)', () => {
    // A baseline of 0 and no baseline are different computations: ISL refuses
    // a 'level' threshold as missing_goal_baseline when absent, but computes
    // with baseline=0 when stated. They must not share a hash.
    const gAbsent = makeGraph({});
    const gZero = makeGraph({ goalBaseline: 0 });
    expect(canonicalNode(canonOf(gAbsent), 'goal').observed_state).not.toHaveProperty('baseline');
    expect(canonicalNode(canonOf(gZero), 'goal').observed_state.baseline).toBe(0);
    expect(hashOf(gAbsent)).not.toBe(hashOf(gZero));
  });

  it('B4: a NON-goal factor node baseline also participates (translator forwards baseline for every node)', () => {
    const gA = makeGraph({ factorABaseline: 5 });
    const gB = makeGraph({ factorABaseline: 9 });
    // Precondition pin (trap 13b)
    expect(gA.nodes.find((n) => n.id === 'factor-a')!.observed_state?.baseline).toBe(5);
    expect(gB.nodes.find((n) => n.id === 'factor-a')!.observed_state?.baseline).toBe(9);
    expect(hashOf(gA)).not.toBe(hashOf(gB));
  });

  it('B5: absent baseline contributes NO key — canonical form is byte-identical to a graph that never mentions baseline', () => {
    // The bounded-flip guarantee at unit grain: an absent baseline must
    // canonicalise exactly as today's absent case does. Structural half:
    // no `baseline` key anywhere in the canonical form.
    const canonical = canonOf(makeGraph({}));
    expect(canonical).not.toContain('"baseline"');
    // Byte-stability against the pre-change serialisation is witnessed at
    // integration grain by isl-v2-golden-response.pin.test.ts (pinned hash
    // 60e3ac213554be4f over a baseline-free live capture, untouched here).
  });

  it('B6: baseline is float-normalised (12dp) — representationally-equal values share a hash', () => {
    const gA = makeGraph({ goalBaseline: 0.5 });
    const gB = makeGraph({ goalBaseline: 0.5000000000001 }); // beyond 12dp → rounds to 0.5
    expect(hashOf(gA)).toBe(hashOf(gB));
    const gC = makeGraph({ goalBaseline: 0.500000000001 }); // within 12dp → distinct
    expect(hashOf(gA)).not.toBe(hashOf(gC));
  });

  it('B7: a null/non-finite baseline hashes as absent (defensive: JSON can deliver null; NaN/Infinity cannot)', () => {
    const gNull = makeGraph({});
    (gNull.nodes.find((n) => n.id === 'goal')!.observed_state as any).baseline = null;
    const gAbsent = makeGraph({});
    expect(hashOf(gNull)).toBe(hashOf(gAbsent));
    expect(canonOf(gNull)).not.toContain('"baseline"');
  });

  it('B8: the 2.919 baseline amendment did not itself bump the version (now 8, bumped later by 2.1024)', () => {
    // ORIGINAL INTENT, UNCHANGED AND STILL THE POINT: a version bump puts a new
    // number in EVERY canonical form and flips every stored hash. The 2.919
    // amendment deliberately avoided one by making `baseline` PRESENCE-
    // CONDITIONAL, bounding the flip to baseline-BEARING requests. That property
    // is what B6/B7 above actually verify, and it is untouched.
    //
    // ⚠ THE CONSTANT HAS SINCE MOVED, FOR A DIFFERENT REASON. ROADMAP 2.1024
    // bumped 7 → 8 because the canonical form is now derived from the EFFECTIVE
    // ISL REQUEST rather than a parallel projection — a universal flip that IS
    // intended and IS the change. Updating this literal does not weaken 2.919's
    // claim; it records that a later, deliberate bump happened. The title was
    // rewritten rather than left saying 'stays 7', which is no longer true and
    // would have read as a false statement about the current code.
    expect(HASH_VERSION).toBe(8);
  });
});
