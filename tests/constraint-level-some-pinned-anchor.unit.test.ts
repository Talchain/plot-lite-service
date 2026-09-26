/**
 * `observed_baseline_level` when only SOME options set the target — unit half.
 * The /v2/run half is `constraint-level-some-pinned-anchor.route.test.ts`.
 *
 * THE DEFECT (MG's independent review of ISL #179, finding N1, EXECUTED at
 * PLoT #368's head `4638dee`). `isObservedBaselineLevelTarget` returned false
 * when ANY option intervened on the target. So a NON-root level limit that one
 * option sets — a win-back offer that "cuts churn to 3%" beside options that
 * leave churn free — resolved no anchor, took `sample_frame_unanchored`, and
 * `suppressConstraintProbabilities` then withheld EVERY limit on the run.
 *
 * WHY IT IS NOW SCOREABLE (ISL #179, CODE-READ of its diff + EXECUTED
 * engine-direct in MG's review, probe `P1_witness_some_pinned`): an option that
 * sets the target writes `node_values[T] = x` on every draw, so under THAT
 * option the samples ARE the level it sets (`identity_option_ids`); every other
 * option keeps `baseline + (option − status_quo)`. Both halves compare a LEVEL
 * with the threshold, so the comparison is anchored for every option.
 *
 * THE FRAME CONDITION, and why it is a set of node ids. The pinned levels ISL
 * compares are the values PLoT SENT. Phase 4a rescales every intervention when
 * any one is outside [0,1], and then the threshold follows the target's
 * rescaled scale (ladder rung 1) while `observed_state.baseline` travels
 * verbatim — so the unpinned options' `baseline + delta` and the threshold
 * would sit on different frames. The limb therefore opens only for a target
 * whose every intervention reached ISL AS STATED (identity scale, unclamped),
 * proved by the caller from the Phase-4a diagnostics
 * (`collectInterventionsForwardedAsStated`). No proof ⇒ no anchor.
 *
 * RED-FIRST SHAPE. Every function this file calls in (1)–(3) exists at the
 * base; the new behaviour is reached through a trailing argument the base
 * ignores, so on the base those rows fail BY ASSERTION.
 *
 * Assertions bind by IDENTITY (constraint_id, node_id, exact anchor string,
 * exact reason), never by a predicate another object could satisfy.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveConstraintSampleFrameAnchor,
  detectUnanchoredSampleFrameTargets,
  detectUnreliableConstraintTargets,
  collectDirectedEdgeTargets,
  isObservedBaselineLevelTarget,
  partitionConstraintTargets,
} from '../src/lib/constraint-reliability.js';
import * as normaliser from '../src/lib/intervention-normaliser.js';
import type { GoalConstraint, EngineNodeV3 } from '../src/types/engine-v3.js';

// ---------------------------------------------------------------------------
// Fixture — the probe shape of MG's ISL #179 review (isl179_probe.py `witness`):
//   f   factor  ROOT, observed 0.2          f -> c, f -> g, c -> g
//   c   factor  NON-root, the level target (observed baseline 0.6)
//   g   outcome the goal
// ---------------------------------------------------------------------------

const EDGES = [
  { from: 'f', to: 'c' },
  { from: 'f', to: 'g' },
  { from: 'c', to: 'g' },
];
const DIRECTED = collectDirectedEdgeTargets(EDGES);

function nodes(cObserved?: Record<string, unknown>): EngineNodeV3[] {
  return [
    { id: 'f', kind: 'factor', label: 'Driver', observed_state: { value: 0.2 } },
    {
      id: 'c',
      kind: 'factor',
      label: 'Churn',
      ...(cObserved ? { observed_state: cObserved as EngineNodeV3['observed_state'] } : {}),
    },
    { id: 'g', kind: 'outcome', label: 'Goal' },
  ] as EngineNodeV3[];
}

const WITH_BASELINE = { value: 0.6, baseline: 0.6 };
const NO_BASELINE = { value: 0.6 };

/** L1 — no option sets c. */
const OPTIONS_NONE_PIN = [
  { id: 'hold', interventions: { f: { value: 0.2 } } },
  { id: 'push', interventions: { f: { value: 1.0 } } },
];
/** L4 — ONE option (winback) sets c; the others leave it free. */
const OPTIONS_ONE_PINS = [
  { id: 'hold', interventions: { f: { value: 0.2 } } },
  { id: 'winback', interventions: { c: { value: 0.3 } } },
  { id: 'push', interventions: { f: { value: 1.0 } } },
];
/** L3 — EVERY option sets c. */
const OPTIONS_EVERY_PINS = [
  { id: 'hold', interventions: { c: { value: 0.6 } } },
  { id: 'winback', interventions: { c: { value: 0.3 } } },
];

/** The caller's proof: c's pinned levels reached ISL as stated. */
const C_AS_STATED: ReadonlySet<string> = new Set(['f', 'c']);
/** Phase 4a rescaled (or clamped) c: only f reached ISL as stated. */
const C_RESCALED: ReadonlySet<string> = new Set(['f']);

function gc(id: string, nodeId: string, valueFrame: 'level' | 'delta' | undefined): GoalConstraint {
  return {
    constraint_id: id,
    node_id: nodeId,
    operator: '<=',
    value: 0.5,
    ...(valueFrame !== undefined ? { value_frame: valueFrame } : {}),
  } as GoalConstraint;
}

const anchorOf = (
  nodeId: string,
  cObserved: Record<string, unknown> | undefined,
  options: unknown[],
  valueFrame: unknown,
  asStated: ReadonlySet<string> | undefined,
  stamps?: ReadonlyMap<string, string>,
) =>
  resolveConstraintSampleFrameAnchor(
    nodeId,
    nodes(cObserved),
    DIRECTED,
    options as never,
    stamps,
    valueFrame,
    asStated,
  );

// ===========================================================================
// (1) The sample-frame gate
// ===========================================================================

describe('resolveConstraintSampleFrameAnchor — a non-root level target SOME options set', () => {
  it('RED core (L4): one option sets c, baseline present, level frame, pinned levels forwarded as stated → observed_baseline_level', () => {
    expect(anchorOf('c', WITH_BASELINE, OPTIONS_ONE_PINS, 'level', C_AS_STATED)).toBe('observed_baseline_level');
  });

  it('FAILS CLOSED — no proof the pinned levels were forwarded as stated (argument absent): unanchored', () => {
    expect(anchorOf('c', WITH_BASELINE, OPTIONS_ONE_PINS, 'level', undefined)).toBeNull();
  });

  it('FRAME GUARD — c was rescaled or clamped by Phase 4a (absent from the set): unanchored', () => {
    expect(anchorOf('c', WITH_BASELINE, OPTIONS_ONE_PINS, 'level', C_RESCALED)).toBeNull();
  });

  it('CONTROL — L4 without a baseline: unanchored (ISL #179 still refuses missing_target_baseline)', () => {
    expect(anchorOf('c', NO_BASELINE, OPTIONS_ONE_PINS, 'level', C_AS_STATED)).toBeNull();
  });

  it("CONTROL — L4 with a 'delta' frame (no node stamp): unchanged, unanchored", () => {
    expect(anchorOf('c', WITH_BASELINE, OPTIONS_ONE_PINS, 'delta', C_AS_STATED)).toBeNull();
  });

  it('CONTROL — L4 unframed: unchanged, unanchored', () => {
    expect(anchorOf('c', WITH_BASELINE, OPTIONS_ONE_PINS, undefined, C_AS_STATED)).toBeNull();
  });

  it('CONTROL (L1) — no option sets c: observed_baseline_level, with or without the set', () => {
    expect(anchorOf('c', WITH_BASELINE, OPTIONS_NONE_PIN, 'level', C_AS_STATED)).toBe('observed_baseline_level');
    expect(anchorOf('c', WITH_BASELINE, OPTIONS_NONE_PIN, 'level', undefined)).toBe('observed_baseline_level');
    expect(anchorOf('c', WITH_BASELINE, OPTIONS_NONE_PIN, 'level', C_RESCALED)).toBe('observed_baseline_level');
  });

  it('CONTROL (L3) — every option sets c: pinned_by_every_option, baseline or not, set or not', () => {
    expect(anchorOf('c', WITH_BASELINE, OPTIONS_EVERY_PINS, 'level', C_AS_STATED)).toBe('pinned_by_every_option');
    expect(anchorOf('c', undefined, OPTIONS_EVERY_PINS, 'level', undefined)).toBe('pinned_by_every_option');
  });

  it('CONTROL — a ROOT target one option sets keeps root_observed_level (the set is not read on that limb)', () => {
    const rootPinned = [
      { id: 'hold', interventions: { c: { value: 0.6 } } },
      { id: 'setf', interventions: { f: { value: 1.0 } } },
    ];
    expect(anchorOf('f', WITH_BASELINE, rootPinned, 'level', undefined)).toBe('root_observed_level');
    expect(anchorOf('f', WITH_BASELINE, rootPinned, 'level', new Set<string>())).toBe('root_observed_level');
  });

  it("CONTROL — a node stamped 'delta' keeps attested_delta (checked first)", () => {
    expect(
      anchorOf('c', WITH_BASELINE, OPTIONS_ONE_PINS, 'level', C_AS_STATED, new Map([['c', 'delta']])),
    ).toBe('attested_delta');
  });
});

describe('isObservedBaselineLevelTarget — the predicate, called directly', () => {
  it('every option setting the target is NOT this plan (that is pinned_by_every_option), even with the proof', () => {
    expect(
      isObservedBaselineLevelTarget('c', 'level', nodes(WITH_BASELINE), DIRECTED, OPTIONS_EVERY_PINS, C_AS_STATED),
    ).toBe(false);
  });

  it('a ROOT node is never a level-plan target, even when some option sets it and the proof is given', () => {
    expect(
      isObservedBaselineLevelTarget('f', 'level', nodes(WITH_BASELINE), DIRECTED, OPTIONS_NONE_PIN, new Set(['f'])),
    ).toBe(false);
  });
});

// ===========================================================================
// (2) The run-level consequence: one L4 limit no longer withholds its siblings
// ===========================================================================

describe('detectUnanchoredSampleFrameTargets + partitionConstraintTargets — L4 beside an unrelated limit', () => {
  const constraints = [gc('churn', 'c', 'level'), gc('drv', 'f', 'level')];

  it('RED core: with the proof, neither limit is unanchored and nothing is suppressed', () => {
    const unanchored = detectUnanchoredSampleFrameTargets(
      constraints, nodes(WITH_BASELINE), DIRECTED, OPTIONS_ONE_PINS, undefined, C_AS_STATED,
    );
    expect(unanchored).toEqual([]);
    expect(partitionConstraintTargets(unanchored, { edges: EDGES }).suppressed).toEqual([]);
  });

  it('CONTROL — without the proof, ONLY the L4 limit is flagged (by identity), and it suppresses the run', () => {
    const unanchored = detectUnanchoredSampleFrameTargets(
      constraints, nodes(WITH_BASELINE), DIRECTED, OPTIONS_ONE_PINS, undefined, C_RESCALED,
    );
    expect(unanchored).toEqual([
      { constraint_id: 'churn', node_id: 'c', reasons: ['sample_frame_unanchored'] },
    ]);
    expect(partitionConstraintTargets(unanchored, { edges: EDGES }).suppressed.map((t) => t.constraint_id)).toEqual([
      'churn',
    ]);
  });
});

// ===========================================================================
// (3) ISL's CONSTRAINT_NODE_DEFAULT_BASE does not describe an L4 number either
// ===========================================================================

describe('detectUnreliableConstraintTargets — level-plan context covers the L4 target', () => {
  const islDefaultBase = (nodeId: string) => ({
    inference_warnings: [
      {
        code: 'CONSTRAINT_NODE_DEFAULT_BASE',
        field: `nodes[${nodeId}].base`,
        detail: { node_id: nodeId, defaulted_to: 0.0, reason: 'no_parameter_uncertainty' },
      },
    ],
  });

  it('RED core: with the proof, the L4 constraint does NOT take target_base_defaulted', () => {
    expect(
      detectUnreliableConstraintTargets([gc('churn', 'c', 'level')], undefined, islDefaultBase('c'), {
        nodes: nodes(WITH_BASELINE),
        directedEdgeTargets: DIRECTED,
        options: OPTIONS_ONE_PINS,
        interventionsForwardedAsStated: C_AS_STATED,
      }),
    ).toEqual([]);
  });

  it('CONTROL — without the proof the reason is unchanged (same predicate as the gate)', () => {
    expect(
      detectUnreliableConstraintTargets([gc('churn', 'c', 'level')], undefined, islDefaultBase('c'), {
        nodes: nodes(WITH_BASELINE),
        directedEdgeTargets: DIRECTED,
        options: OPTIONS_ONE_PINS,
      }),
    ).toEqual([{ constraint_id: 'churn', node_id: 'c', reasons: ['target_base_defaulted'] }]);
  });
});

// ===========================================================================
// (4) The proof — derived from the Phase-4a diagnostics
// ===========================================================================

describe('collectInterventionsForwardedAsStated — which targets reached ISL at the value stated', () => {
  const collect = (options: unknown[], diagnostics: unknown[]) =>
    // Namespace access so the base (where the export is absent) fails in the row, not at import.
    [...(normaliser as any).collectInterventionsForwardedAsStated(options, diagnostics)].sort();

  const opts = [
    { id: 'hold', label: 'Hold', interventions: { f: { value: 0.2 } } },
    { id: 'winback', label: 'Winback', interventions: { c: { value: 0.3 } } },
  ];
  const diag = (option_id: string, factor_id: string, range: { min: number; max: number }, clamped: boolean) => ({
    option_id,
    factor_id,
    original_value: 0,
    normalised_value: 0,
    range: { ...range, source: 'explicit' },
    clamped,
  });

  it('Phase 4a skipped (no diagnostics): every intervened node was forwarded as stated', () => {
    expect(collect(opts, [])).toEqual(['c', 'f']);
  });

  it('identity scale, unclamped: forwarded as stated', () => {
    expect(
      collect(opts, [diag('hold', 'f', { min: 0, max: 1 }, false), diag('winback', 'c', { min: 0, max: 1 }, false)]),
    ).toEqual(['c', 'f']);
  });

  it('a NON-identity scale on c (Phase 4a rescaled it): c excluded, f kept', () => {
    expect(
      collect(opts, [diag('hold', 'f', { min: 0, max: 1 }, false), diag('winback', 'c', { min: 0, max: 0.14 }, false)]),
    ).toEqual(['f']);
  });

  it('an identity scale that CLAMPED c: c excluded (ISL would see 1.0, not the level stated)', () => {
    expect(
      collect(opts, [diag('hold', 'f', { min: 0, max: 1 }, false), diag('winback', 'c', { min: 0, max: 1 }, true)]),
    ).toEqual(['f']);
  });

  it('a node no option intervenes on is never in the set', () => {
    expect(collect(opts, [])).not.toContain('g');
  });
});
