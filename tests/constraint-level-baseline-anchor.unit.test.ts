/**
 * `observed_baseline_level` — a LEVEL constraint on a NON-ROOT target that
 * carries a finite `observed_state.baseline` is scoreable. Unit half; the /v2/run half is
 * `constraint-level-baseline-anchor.route.test.ts`.
 *
 * WHY (Delivery Lead ruling, olumi-programme-docs #70 5841918509; AI Quality
 * contract 5841905430). ISL `3c4ab84d` already scores this shape by a per-draw
 * level plan — `level_i = baseline + (option_i − status_quo_i)`, CRN-paired
 * (CODE-READ `robustness_analyzer_v2.py` `_resolve_threshold_in_sample_frame`,
 * `_resolve_constraint_series`). PLoT refused it twice over (AI Quality C50,
 * WIRE, PLoT `b09c0f2`):
 *   - L5a: the sample-frame gate had no limb for a non-root target, so ISL's
 *     computed 0.4895 / 0.781 reached only PLoT's suppression log;
 *   - L2b: the same gate refused it, and ISL also refused the std-0.001 PU pin
 *     (`target_parameter_uncertainty_shifts_base`). ISL #177 converts that PU
 *     instead, so PLoT keeps pinning it and the PU injector is unchanged.
 *
 * THE RED-FIRST SHAPE. Every function imported here already exists at the
 * base; the new behaviour is reached only through a trailing argument the base
 * ignores. So on the base these tests fail BY ASSERTION, not by a missing
 * import — a red that says what is wrong, not that a symbol is absent.
 *
 * Assertions bind by IDENTITY (constraint_id, node_id, exact anchor string,
 * exact reason), never by a predicate another object could satisfy.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveConstraintSampleFrameAnchor,
  detectUnanchoredSampleFrameTargets,
  collectDirectedEdgeTargets,
} from '../src/lib/constraint-reliability.js';
import type { GoalConstraint, EngineNodeV3 } from '../src/types/engine-v3.js';

// ---------------------------------------------------------------------------
// Fixture — the C50 graph (AI Quality `build_cases.py`), so the unit, route and
// engine-direct witnesses all share ONE shape:
//   goal_revenue      goal     non-root (subs, price)
//   out_subscribers   outcome  non-root (price, churn)   <- the level target
//   fac_price         factor   ROOT, intervened by every option
//   fac_churn         factor   ROOT, observed 0.07
// ---------------------------------------------------------------------------

const EDGES = [
  { from: 'fac_price', to: 'out_subscribers' },
  { from: 'fac_churn', to: 'out_subscribers' },
  { from: 'out_subscribers', to: 'goal_revenue' },
  { from: 'fac_price', to: 'goal_revenue' },
];
const DIRECTED = collectDirectedEdgeTargets(EDGES);

const OPTIONS = [
  { id: 'opt_hold', interventions: { fac_price: { value: 0.49 } } },
  { id: 'opt_raise', interventions: { fac_price: { value: 0.59 } } },
];
/** opt_raise ALSO intervenes on the level target — ISL refuses this (any pin). */
const OPTIONS_ONE_PINS_TARGET = [
  OPTIONS[0],
  { id: 'opt_raise', interventions: { fac_price: { value: 0.59 }, out_subscribers: { value: 0.6 } } },
];
const OPTIONS_EVERY_PINS_TARGET = [
  { id: 'opt_hold', interventions: { out_subscribers: { value: 0.5 } } },
  { id: 'opt_raise', interventions: { out_subscribers: { value: 0.6 } } },
];

function nodes(subObserved?: Record<string, unknown>): EngineNodeV3[] {
  return [
    { id: 'goal_revenue', kind: 'goal', label: 'Monthly revenue' },
    {
      id: 'out_subscribers',
      kind: 'outcome',
      label: 'Paying subscribers',
      ...(subObserved ? { observed_state: subObserved as EngineNodeV3['observed_state'] } : {}),
    },
    { id: 'fac_price', kind: 'factor', label: 'Seat price level', observed_state: { value: 0.49 } },
    { id: 'fac_churn', kind: 'factor', label: 'Monthly logo churn', observed_state: { value: 0.07, std: 0.01 } },
  ] as EngineNodeV3[];
}

const WITH_BASELINE = { value: 0.5, baseline: 0.5 };
const NO_BASELINE = { value: 0.5 };

function gc(
  id: string,
  nodeId: string,
  valueFrame: 'level' | 'delta' | undefined,
): GoalConstraint {
  return {
    constraint_id: id,
    node_id: nodeId,
    operator: '>=',
    value: 0.47,
    ...(valueFrame !== undefined ? { value_frame: valueFrame } : {}),
  } as GoalConstraint;
}

// ===========================================================================
// (1) The sample-frame gate
// ===========================================================================

describe('resolveConstraintSampleFrameAnchor — observed_baseline_level', () => {
  it('RED core: a LEVEL constraint on a non-root target with a finite baseline, unpinned, IS anchored', () => {
    expect(
      resolveConstraintSampleFrameAnchor(
        'out_subscribers', nodes(WITH_BASELINE), DIRECTED, OPTIONS, undefined, 'level',
      ),
    ).toBe('observed_baseline_level');
  });

  it('the GOAL node is covered by the same limb (C50 L5a shape)', () => {
    const ns = nodes();
    (ns[0] as any).observed_state = { value: 0.1, baseline: 0.1 };
    expect(
      resolveConstraintSampleFrameAnchor('goal_revenue', ns, DIRECTED, OPTIONS, undefined, 'level'),
    ).toBe('observed_baseline_level');
  });

  it('CONTROL — no baseline: stays unanchored (value alone is not a baseline)', () => {
    expect(
      resolveConstraintSampleFrameAnchor(
        'out_subscribers', nodes(NO_BASELINE), DIRECTED, OPTIONS, undefined, 'level',
      ),
    ).toBeNull();
  });

  it("CONTROL — a 'delta' frame (no node stamp) is unchanged: unanchored", () => {
    expect(
      resolveConstraintSampleFrameAnchor(
        'out_subscribers', nodes(WITH_BASELINE), DIRECTED, OPTIONS, undefined, 'delta',
      ),
    ).toBeNull();
  });

  it('CONTROL — an ABSENT frame is unchanged: unanchored', () => {
    expect(
      resolveConstraintSampleFrameAnchor('out_subscribers', nodes(WITH_BASELINE), DIRECTED, OPTIONS, undefined),
    ).toBeNull();
    expect(
      resolveConstraintSampleFrameAnchor(
        'out_subscribers', nodes(WITH_BASELINE), DIRECTED, OPTIONS, undefined, undefined,
      ),
    ).toBeNull();
  });

  it('CONTROL — pinned by ONE option: unanchored (ISL refuses any pin on a level target)', () => {
    expect(
      resolveConstraintSampleFrameAnchor(
        'out_subscribers', nodes(WITH_BASELINE), DIRECTED, OPTIONS_ONE_PINS_TARGET, undefined, 'level',
      ),
    ).toBeNull();
  });

  it('CONTROL — pinned by EVERY option keeps its pre-existing anchor (limb order unchanged)', () => {
    expect(
      resolveConstraintSampleFrameAnchor(
        'out_subscribers', nodes(WITH_BASELINE), DIRECTED, OPTIONS_EVERY_PINS_TARGET, undefined, 'level',
      ),
    ).toBe('pinned_by_every_option');
  });

  it('CONTROL — a ROOT target keeps root_observed_level, baseline or not', () => {
    const ns = nodes();
    (ns[3] as any).observed_state = { value: 0.07, baseline: 0.07 };
    expect(
      resolveConstraintSampleFrameAnchor('fac_churn', ns, DIRECTED, OPTIONS, undefined, 'level'),
    ).toBe('root_observed_level');
    expect(
      resolveConstraintSampleFrameAnchor('fac_churn', nodes(), DIRECTED, OPTIONS, undefined, 'level'),
    ).toBe('root_observed_level');
  });

  it("CONTROL — a node stamped 'delta' keeps attested_delta (checked first)", () => {
    expect(
      resolveConstraintSampleFrameAnchor(
        'out_subscribers',
        nodes(WITH_BASELINE),
        DIRECTED,
        OPTIONS,
        new Map([['out_subscribers', 'delta']]),
        'level',
      ),
    ).toBe('attested_delta');
  });

  it('FAILS CLOSED — a non-finite or non-numeric baseline is not an anchor', () => {
    for (const baseline of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '0.5', null]) {
      expect(
        resolveConstraintSampleFrameAnchor(
          'out_subscribers',
          nodes({ value: 0.5, baseline }),
          DIRECTED,
          OPTIONS,
          undefined,
          'level',
        ),
        `baseline=${String(baseline)}`,
      ).toBeNull();
    }
  });

  it('FAILS CLOSED — no options (or an empty list) proves nothing about pinning', () => {
    expect(
      resolveConstraintSampleFrameAnchor('out_subscribers', nodes(WITH_BASELINE), DIRECTED, [], undefined, 'level'),
    ).toBeNull();
    expect(
      resolveConstraintSampleFrameAnchor(
        'out_subscribers', nodes(WITH_BASELINE), DIRECTED, undefined, undefined, 'level',
      ),
    ).toBeNull();
  });

  it('FAILS CLOSED — a target absent from the graph is not anchored', () => {
    expect(
      resolveConstraintSampleFrameAnchor('out_missing', nodes(WITH_BASELINE), new Set(['out_missing']), OPTIONS, undefined, 'level'),
    ).toBeNull();
  });
});

describe('detectUnanchoredSampleFrameTargets — reads the CONSTRAINT’s value_frame', () => {
  it('flags only the unanchored sibling, by constraint identity', () => {
    const out = detectUnanchoredSampleFrameTargets(
      [
        gc('gc_level', 'out_subscribers', 'level'),
        gc('gc_unframed', 'out_subscribers', undefined),
      ],
      nodes(WITH_BASELINE),
      DIRECTED,
      OPTIONS,
      undefined,
    );
    expect(out.map((t) => t.constraint_id)).toEqual(['gc_unframed']);
    expect(out[0].reasons).toEqual(['sample_frame_unanchored']);
  });
});
