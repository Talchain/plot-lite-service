/**
 * `observed_baseline_level` — a LEVEL constraint on a NON-ROOT target that
 * carries a finite `observed_state.baseline` is scoreable, and PLoT must not
 * pin it with a constraint PU. Unit half; the /v2/run half is
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
 *   - L2b: `classifyConstraintPu` pinned the target with a std-0.001 PU, and ISL
 *     refused (`target_parameter_uncertainty_shifts_base`).
 *
 * THE RED-FIRST SHAPE. Every function imported here already exists at the
 * base; the new behaviour is reached only through a trailing argument the base
 * ignores. So on the base these tests fail BY ASSERTION, not by a missing
 * import — a red that says what is wrong, not that a symbol is absent.
 *
 * Assertions bind by IDENTITY (constraint_id, node_id, exact anchor string,
 * exact skip reason), never by a predicate another object could satisfy.
 */

import { describe, it, expect } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import {
  resolveConstraintSampleFrameAnchor,
  detectUnanchoredSampleFrameTargets,
  collectDirectedEdgeTargets,
} from '../src/lib/constraint-reliability.js';
import {
  classifyConstraintPu,
  selectConstraintInjectedPuNodeIds,
  injectConstraintParameterUncertainties,
  type ConstraintPuLevelPlanContext,
} from '../src/integrations/isl/constraint-pu-injection.js';
import type { ISLRobustnessRequestV3 } from '../src/integrations/isl/translator-v3.js';
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

// ===========================================================================
// (2) The constraint-PU injector must not pin the same target
// ===========================================================================

function makeISLRequest(pus?: ISLRobustnessRequestV3['parameter_uncertainties']): ISLRobustnessRequestV3 {
  return {
    request_id: 'test-req',
    graph: { nodes: [], edges: [] },
    options: [],
    goal_node_id: 'goal_revenue',
    analysis_types: ['robustness'],
    parameter_uncertainties: pus,
  };
}

function makeLogger() {
  const info: Array<Record<string, unknown>> = [];
  const warn: Array<Record<string, unknown>> = [];
  const logger = {
    info: (o: Record<string, unknown>) => info.push(o),
    warn: (o: Record<string, unknown>) => warn.push(o),
  } as unknown as FastifyBaseLogger;
  return { logger, info, warn };
}

const LEVEL_PLAN: ConstraintPuLevelPlanContext = { directedEdgeTargets: DIRECTED, options: OPTIONS };

describe('classifyConstraintPu — observed_baseline_level skip', () => {
  const map = (ns: EngineNodeV3[]) => new Map(ns.map((n) => [n.id, n]));

  it('RED core: the level-plan target is SKIPPED with reason observed_baseline_level', () => {
    expect(
      classifyConstraintPu(
        gc('gc_level', 'out_subscribers', 'level'),
        map(nodes(WITH_BASELINE)),
        'goal_revenue',
        new Set(),
        LEVEL_PLAN,
      ),
    ).toEqual({ kind: 'skip', reason: 'observed_baseline_level' });
  });

  it('CONTROL — without the context the pre-existing rule applies (inject)', () => {
    expect(
      classifyConstraintPu(gc('gc_level', 'out_subscribers', 'level'), map(nodes(WITH_BASELINE)), 'goal_revenue', new Set()),
    ).toEqual({ kind: 'inject', mean: 0.5 });
  });

  it('CONTROLS — no baseline / delta / unframed / pinned by one option / non-finite baseline: still INJECTED', () => {
    const cases: Array<[string, GoalConstraint, EngineNodeV3[], ConstraintPuLevelPlanContext]> = [
      ['no baseline', gc('c', 'out_subscribers', 'level'), nodes(NO_BASELINE), LEVEL_PLAN],
      ['delta', gc('c', 'out_subscribers', 'delta'), nodes(WITH_BASELINE), LEVEL_PLAN],
      ['unframed', gc('c', 'out_subscribers', undefined), nodes(WITH_BASELINE), LEVEL_PLAN],
      ['pinned by one', gc('c', 'out_subscribers', 'level'), nodes(WITH_BASELINE), { directedEdgeTargets: DIRECTED, options: OPTIONS_ONE_PINS_TARGET }],
      ['NaN baseline', gc('c', 'out_subscribers', 'level'), nodes({ value: 0.5, baseline: Number.NaN }), LEVEL_PLAN],
      ['Infinity baseline', gc('c', 'out_subscribers', 'level'), nodes({ value: 0.5, baseline: Number.POSITIVE_INFINITY }), LEVEL_PLAN],
    ];
    for (const [name, constraint, ns, lp] of cases) {
      expect(classifyConstraintPu(constraint, map(ns), 'goal_revenue', new Set(), lp), name).toEqual({
        kind: 'inject',
        mean: 0.5,
      });
    }
  });

  it('CONTROL — a ROOT target is not a level-plan target: still classified as before', () => {
    // fac_churn is a factor with an observed value, so in production the
    // translator already gave it a PU ('existing'); here, with none present,
    // the constraint path would inject — exactly as at the base.
    const ns = nodes();
    (ns[3] as any).observed_state = { value: 0.07, baseline: 0.07 };
    expect(
      classifyConstraintPu(gc('c', 'fac_churn', 'level'), map(ns), 'goal_revenue', new Set(), LEVEL_PLAN),
    ).toEqual({ kind: 'inject', mean: 0.07 });
  });

  it('CONTROL — an existing PU is never overridden (ISL then refuses; not this function’s call)', () => {
    expect(
      classifyConstraintPu(
        gc('c', 'out_subscribers', 'level'), map(nodes(WITH_BASELINE)), 'goal_revenue', new Set(['out_subscribers']), LEVEL_PLAN,
      ),
    ).toEqual({ kind: 'existing' });
  });
});

describe('injectConstraintParameterUncertainties + selectConstraintInjectedPuNodeIds — lockstep', () => {
  it('RED core: the ISL request carries NO PU for the level-plan target; the skip is disclosed in the log', () => {
    const req = makeISLRequest();
    const { logger, info } = makeLogger();
    const result = injectConstraintParameterUncertainties(
      req,
      [gc('gc_level', 'out_subscribers', 'level')],
      nodes(WITH_BASELINE),
      'goal_revenue',
      logger,
      undefined,
      LEVEL_PLAN,
    );
    expect((req.parameter_uncertainties ?? []).map((p) => p.node_id)).not.toContain('out_subscribers');
    expect(result.injected).toEqual([]);
    expect(result.skipped).toEqual([{ node_id: 'out_subscribers', reason: 'observed_baseline_level' }]);
    expect(info).toContainEqual({
      event: 'plot.constraint_pu_skipped_level_plan',
      node_id: 'out_subscribers',
      constraint_id: 'gc_level',
    });
  });

  it('CONTROL — the no-baseline sibling shape is still pinned on the wire', () => {
    const req = makeISLRequest();
    injectConstraintParameterUncertainties(
      req,
      [gc('gc_level', 'out_subscribers', 'level')],
      nodes(NO_BASELINE),
      'goal_revenue',
      undefined,
      undefined,
      LEVEL_PLAN,
    );
    expect(req.parameter_uncertainties).toEqual([
      { node_id: 'out_subscribers', distribution: 'normal', std: 0.001 },
    ]);
  });

  it('the plan-time selection agrees with the injection on a mixed set (EVPI u cannot drift)', () => {
    const ns = nodes(WITH_BASELINE);
    ns.push({ id: 'out_margin', kind: 'outcome', label: 'Margin', observed_state: { value: 0.3 } } as EngineNodeV3);
    const directed = new Set([...DIRECTED, 'out_margin']);
    const lp: ConstraintPuLevelPlanContext = { directedEdgeTargets: directed, options: OPTIONS };
    const constraints = [
      gc('gc_level', 'out_subscribers', 'level'),
      gc('gc_margin', 'out_margin', 'level'),
      gc('gc_level_dup', 'out_subscribers', 'level'),
    ];
    const selected = selectConstraintInjectedPuNodeIds(constraints, ns, 'goal_revenue', new Set(), undefined, lp);
    const req = makeISLRequest();
    injectConstraintParameterUncertainties(req, constraints, ns, 'goal_revenue', undefined, undefined, lp);
    const injected = new Set((req.parameter_uncertainties ?? []).map((p) => p.node_id));
    expect([...selected].sort()).toEqual(['out_margin']);
    expect([...injected].sort()).toEqual([...selected].sort());
  });
});
