/**
 * Unit tests for src/lib/constraint-reliability.ts (lane PLoT-H item A).
 *
 * Route-level behaviour (suppression + CONSTRAINT_TARGET_UNRELIABLE emission)
 * is pinned in tests/constraint-target-unreliable.fixture.test.ts; these tests
 * pin the detection semantics in isolation.
 */

import { describe, it, expect } from 'vitest';
import {
  detectUnreliableConstraintTargets,
  detectUnanchoredSampleFrameTargets,
  mergeUnreliableConstraintTargets,
  collectDirectedEdgeTargets,
  resolveConstraintSampleFrameAnchor,
  partitionConstraintTargets,
  buildConstraintTargetUnreliableMessage,
  buildConstraintGoalFitModelledMessage,
  GOAL_FIT_SCORED_FROM_MODELLED_OUTCOME,
  type UnreliableConstraintTarget,
  type ConstraintUnreliabilityReason,
} from '../src/lib/constraint-reliability.js';
import type { NormalisationRange } from '../src/lib/intervention-normaliser.js';

const gc = (id: string, nodeId: string) => ({
  constraint_id: id,
  node_id: nodeId,
  operator: '>=' as const,
  value: 20,
});

const range = (source: NormalisationRange['source']): NormalisationRange => ({
  min: 0,
  max: 1,
  source,
});

describe('detectUnreliableConstraintTargets', () => {
  it('returns [] for no constraints / undefined inputs', () => {
    expect(detectUnreliableConstraintTargets(undefined, undefined, undefined)).toEqual([]);
    expect(detectUnreliableConstraintTargets([], new Map(), {})).toEqual([]);
  });

  it("flags a constraint whose normalisation range source is 'default'", () => {
    const ranges = new Map([['c1', range('default')]]);
    const out = detectUnreliableConstraintTargets([gc('c1', 'out_x')], ranges, {});
    expect(out).toEqual([
      { constraint_id: 'c1', node_id: 'out_x', reasons: ['threshold_normalisation_defaulted'] },
    ]);
  });

  it('does NOT flag derivable range sources (explicit/inferred tiers)', () => {
    for (const src of ['explicit_cap', 'explicit', 'extracted', 'inferred_spread', 'inferred_baseline', 'inferred_value'] as const) {
      const ranges = new Map([['c1', range(src)]]);
      expect(detectUnreliableConstraintTargets([gc('c1', 'out_x')], ranges, {})).toEqual([]);
    }
  });

  it('flags a target named by the ISL CONSTRAINT_NODE_DEFAULT_BASE inference warning (nested detail shape)', () => {
    const islResult = {
      inference_warnings: [{
        code: 'CONSTRAINT_NODE_DEFAULT_BASE',
        field: 'nodes[out_x].base',
        detail: { node_id: 'out_x', defaulted_to: 0.0, reason: 'no_parameter_uncertainty', message: 'm' },
      }],
    };
    const out = detectUnreliableConstraintTargets([gc('c1', 'out_x')], undefined, islResult);
    expect(out).toEqual([
      { constraint_id: 'c1', node_id: 'out_x', reasons: ['target_base_defaulted'] },
    ]);
  });

  it('flags a target named via the ISL critiques channel (affected_node_ids)', () => {
    const islResult = {
      critiques: [{ code: 'CONSTRAINT_NODE_DEFAULT_BASE', affected_node_ids: ['out_x'] }],
    };
    const out = detectUnreliableConstraintTargets([gc('c1', 'out_x')], undefined, islResult);
    expect(out).toEqual([
      { constraint_id: 'c1', node_id: 'out_x', reasons: ['target_base_defaulted'] },
    ]);
  });

  it('combines both reasons on the full live chain', () => {
    const ranges = new Map([['c1', range('default')]]);
    const islResult = {
      inference_warnings: [{
        code: 'CONSTRAINT_NODE_DEFAULT_BASE',
        detail: { node_id: 'out_x' },
      }],
    };
    const out = detectUnreliableConstraintTargets([gc('c1', 'out_x')], ranges, islResult);
    expect(out).toEqual([
      {
        constraint_id: 'c1',
        node_id: 'out_x',
        reasons: ['threshold_normalisation_defaulted', 'target_base_defaulted'],
      },
    ]);
  });

  it('only flags the affected constraint, not reliable siblings', () => {
    const ranges = new Map([
      ['c1', range('default')],
      ['c2', range('inferred_value')],
    ]);
    const out = detectUnreliableConstraintTargets(
      [gc('c1', 'out_x'), gc('c2', 'out_y')],
      ranges,
      {},
    );
    expect(out.map((t) => t.constraint_id)).toEqual(['c1']);
  });

  it('ignores unrelated warning codes and unrelated node ids', () => {
    const islResult = {
      inference_warnings: [
        { code: 'ROOT_NODE_DEFAULT_VALUE', detail: { node_id: 'out_x' } },
        { code: 'CONSTRAINT_NODE_DEFAULT_BASE', detail: { node_id: 'other_node' } },
      ],
    };
    expect(detectUnreliableConstraintTargets([gc('c1', 'out_x')], undefined, islResult)).toEqual([]);
  });
});

describe('partitionConstraintTargets (P0-C2 doctrine B classification)', () => {
  const target = (
    nodeId: string,
    reasons: UnreliableConstraintTarget['reasons'],
  ): UnreliableConstraintTarget => ({
    constraint_id: `c_${nodeId}`,
    node_id: nodeId,
    reasons,
  });

  const graph = {
    edges: [
      { from: 'fac_a', to: 'out_x' },
      { from: 'out_x', to: 'goal_g' },
    ],
  };

  it('classifies base-defaulted-only targets with forward-propagated inputs as modelledBasis', () => {
    const out = partitionConstraintTargets([target('goal_g', ['target_base_defaulted'])], graph);
    expect(out.modelledBasis.map((t) => t.node_id)).toEqual(['goal_g']);
    expect(out.suppressed).toEqual([]);
  });

  it('keeps suppressing a base-defaulted target with NO incoming edges (root: constant placeholder, not a distribution)', () => {
    const out = partitionConstraintTargets([target('fac_a', ['target_base_defaulted'])], graph);
    expect(out.suppressed.map((t) => t.node_id)).toEqual(['fac_a']);
    expect(out.modelledBasis).toEqual([]);
  });

  it('keeps suppressing when the reason set includes threshold_normalisation_defaulted', () => {
    for (const reasons of [
      ['threshold_normalisation_defaulted'],
      ['threshold_normalisation_defaulted', 'target_base_defaulted'],
    ] as const) {
      const out = partitionConstraintTargets([target('goal_g', [...reasons])], graph);
      expect(out.suppressed, reasons.join('+')).toHaveLength(1);
      expect(out.modelledBasis, reasons.join('+')).toEqual([]);
    }
  });

  it('ignores bidirected edges when deciding forward propagation (ISL strips them from the forward model)', () => {
    const bidirectedOnly = { edges: [{ from: 'fac_a', to: 'goal_g', edge_type: 'bidirected' }] };
    const out = partitionConstraintTargets([target('goal_g', ['target_base_defaulted'])], bidirectedOnly);
    expect(out.suppressed).toHaveLength(1);
    expect(out.modelledBasis).toEqual([]);
  });

  it('is conservative on absent graph/edges: everything keeps suppressing', () => {
    for (const g of [undefined, {}, { edges: [] }] as const) {
      const out = partitionConstraintTargets([target('goal_g', ['target_base_defaulted'])], g);
      expect(out.suppressed).toHaveLength(1);
      expect(out.modelledBasis).toEqual([]);
    }
  });

  it('partitions a mixed set target-by-target', () => {
    const out = partitionConstraintTargets(
      [
        target('goal_g', ['target_base_defaulted']),
        target('out_x', ['threshold_normalisation_defaulted']),
      ],
      graph,
    );
    expect(out.modelledBasis.map((t) => t.node_id)).toEqual(['goal_g']);
    expect(out.suppressed.map((t) => t.node_id)).toEqual(['out_x']);
  });
});

describe('buildConstraintGoalFitModelledMessage (provisional_doctrine_v0 wording)', () => {
  it('names the node, states the modelled basis, and gives the anchoring action', () => {
    const msg = buildConstraintGoalFitModelledMessage('Improve productivity');
    expect(msg).toContain('Improve productivity');
    expect(msg.toLowerCase()).toContain('modelled');
    expect(msg).toContain('no observed baseline value');
    expect(msg).toContain('Set a value for "Improve productivity"');
  });

  it('never quotes probabilities or percentage figures', () => {
    const msg = buildConstraintGoalFitModelledMessage('X');
    expect(msg).not.toMatch(/\d+(\.\d+)?%/);
    expect(msg).not.toMatch(/0\.\d+/);
  });

  it('exports the wire value used by the goal_fit_basis annotation', () => {
    expect(GOAL_FIT_SCORED_FROM_MODELLED_OUTCOME).toBe('modelled_outcome_distribution');
  });
});

describe('buildConstraintTargetUnreliableMessage (provisional_doctrine_v0 wording)', () => {
  it('names the node, states withholding, and gives the user action', () => {
    const msg = buildConstraintTargetUnreliableMessage('Campaign effectiveness', ['target_base_defaulted']);
    expect(msg).toContain('Campaign effectiveness');
    expect(msg).toContain('withheld');
    expect(msg).toContain('Set a value or range for "Campaign effectiveness"');
  });

  it('normalisation-only reason gets the scaling explanation', () => {
    const msg = buildConstraintTargetUnreliableMessage('X', ['threshold_normalisation_defaulted']);
    expect(msg).toContain('could not be scaled');
  });

  it('never contains the raw suppressed numbers or the strings EVPI / expected value', () => {
    const msg = buildConstraintTargetUnreliableMessage('X', [
      'threshold_normalisation_defaulted',
      'target_base_defaulted',
    ]);
    expect(msg).not.toMatch(/\bEVPI\b/i);
    expect(msg).not.toMatch(/expected value/i);
    expect(msg).not.toMatch(/0(\.0+)?%/);
  });
});

// ===========================================================================
// L63 — the constraint SAMPLE-FRAME gate
// ===========================================================================

describe('resolveConstraintSampleFrameAnchor (L63)', () => {
  const nodes = [
    { id: 'goal_g' },
    { id: 'out_x' },
    { id: 'fac_a', observed_state: { value: 0.49 } },
    { id: 'fac_bare' },
    { id: 'risk_r', observed_state: { value: 0.02 } },
  ];
  const edges = [
    { from: 'fac_a', to: 'out_x' },
    { from: 'out_x', to: 'goal_g' },
    { from: 'fac_a', to: 'risk_r' },
  ];
  const directed = collectDirectedEdgeTargets(edges);
  const twoOptions = [
    { interventions: { fac_a: { value: 0.4 } } },
    { interventions: { fac_a: { value: 0.6 } } },
  ];

  // `twoOptions` PINS fac_a, and the pinning limb is checked first — so asking
  // about fac_a with those options would report 'pinned_by_every_option' and
  // prove nothing about the root limb. Use options that leave fac_a free.
  const optionsNotPinningFacA = [
    { interventions: { out_x: { value: 0.4 } } },
    { interventions: { out_x: { value: 0.6 } } },
  ];

  it('a ROOT node carrying an observed value is anchored — the evaluator seeds it as the base', () => {
    expect(
      resolveConstraintSampleFrameAnchor('fac_a', nodes, directed, optionsNotPinningFacA, undefined),
    ).toBe('root_observed_level');
  });

  it('a ROOT node with NO observed value is NOT anchored (base falls to 0.0)', () => {
    expect(resolveConstraintSampleFrameAnchor('fac_bare', nodes, directed, twoOptions, undefined))
      .toBeNull();
  });

  it('a NON-ROOT node is NOT anchored EVEN WITH an observed value — observed_state is read for roots only', () => {
    expect(resolveConstraintSampleFrameAnchor('risk_r', nodes, directed, twoOptions, undefined))
      .toBeNull();
    expect(resolveConstraintSampleFrameAnchor('goal_g', nodes, directed, twoOptions, undefined))
      .toBeNull();
  });

  it("a producer-attested 'delta' frame anchors a non-root node; 'level' does not", () => {
    expect(
      resolveConstraintSampleFrameAnchor('goal_g', nodes, directed, twoOptions, new Map([['goal_g', 'delta']])),
    ).toBe('attested_delta');
    expect(
      resolveConstraintSampleFrameAnchor('goal_g', nodes, directed, twoOptions, new Map([['goal_g', 'level']])),
    ).toBeNull();
  });

  it('pinning must hold for EVERY option, and an EMPTY option list must not mint an anchor', () => {
    const pinned = [
      { interventions: { out_x: { value: 0.8 } } },
      { interventions: { out_x: { value: 0.9 } } },
    ];
    expect(resolveConstraintSampleFrameAnchor('out_x', nodes, directed, pinned, undefined))
      .toBe('pinned_by_every_option');

    const halfPinned = [pinned[0], { interventions: { fac_a: { value: 0.5 } } }];
    expect(resolveConstraintSampleFrameAnchor('out_x', nodes, directed, halfPinned, undefined))
      .toBeNull();

    // `[].every()` is vacuously true — it must not read as "every option pins it".
    expect(resolveConstraintSampleFrameAnchor('out_x', nodes, directed, [], undefined)).toBeNull();
    expect(resolveConstraintSampleFrameAnchor('out_x', nodes, directed, undefined, undefined)).toBeNull();
  });

  it('FAILS CLOSED on absent inputs — an anchor must be proved, never assumed', () => {
    expect(resolveConstraintSampleFrameAnchor('goal_g', undefined, new Set(), undefined, undefined)).toBeNull();
    expect(resolveConstraintSampleFrameAnchor('nonexistent_node', nodes, directed, twoOptions, undefined)).toBeNull();
  });

  it('a non-finite observed value is not an anchor', () => {
    const bad = [{ id: 'fac_nan', observed_state: { value: Number.NaN } }];
    expect(resolveConstraintSampleFrameAnchor('fac_nan', bad, new Set(), undefined, undefined)).toBeNull();
  });
});

describe('collectDirectedEdgeTargets (L63) — bidirected edges create no parent', () => {
  it('ignores bidirected edges, matching the ISL translator’s forward-model filter', () => {
    const targets = collectDirectedEdgeTargets([
      { from: 'a', to: 'b' },
      { from: 'c', to: 'd', edge_type: 'bidirected' },
    ]);
    expect([...targets].sort()).toEqual(['b']);
  });

  it('is total on absent input', () => {
    expect(collectDirectedEdgeTargets(undefined).size).toBe(0);
  });
});

describe('detectUnanchoredSampleFrameTargets (L63)', () => {
  const nodes = [{ id: 'goal_g' }, { id: 'fac_a', observed_state: { value: 0.49 } }];
  const directed = collectDirectedEdgeTargets([{ from: 'fac_a', to: 'goal_g' }]);
  const options = [{ interventions: { fac_a: { value: 0.4 } } }];

  it('flags only the unanchored constraint, by constraint identity', () => {
    const out = detectUnanchoredSampleFrameTargets(
      [
        { constraint_id: 'c_goal', node_id: 'goal_g', operator: '>=', value: 0.8 } as any,
        { constraint_id: 'c_root', node_id: 'fac_a', operator: '>=', value: 0.5 } as any,
      ],
      nodes,
      directed,
      options,
      undefined,
    );
    expect(out.map((t) => t.constraint_id)).toEqual(['c_goal']);
    expect(out[0].reasons).toEqual(['sample_frame_unanchored']);
  });

  it('returns nothing when there are no constraints', () => {
    expect(detectUnanchoredSampleFrameTargets(undefined, nodes, directed, options, undefined)).toEqual([]);
    expect(detectUnanchoredSampleFrameTargets([], nodes, directed, options, undefined)).toEqual([]);
  });
});

describe('mergeUnreliableConstraintTargets (L63)', () => {
  it('unions reasons for the same constraint without duplicating', () => {
    const merged = mergeUnreliableConstraintTargets(
      [{ constraint_id: 'c1', node_id: 'n1', reasons: ['target_base_defaulted'] }],
      [{ constraint_id: 'c1', node_id: 'n1', reasons: ['sample_frame_unanchored'] }],
      [{ constraint_id: 'c1', node_id: 'n1', reasons: ['sample_frame_unanchored'] }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].reasons).toEqual(['target_base_defaulted', 'sample_frame_unanchored']);
  });

  it('does not mutate its inputs', () => {
    const a: UnreliableConstraintTarget[] = [
      { constraint_id: 'c1', node_id: 'n1', reasons: ['target_base_defaulted'] },
    ];
    mergeUnreliableConstraintTargets(a, [
      { constraint_id: 'c1', node_id: 'n1', reasons: ['sample_frame_unanchored'] },
    ]);
    expect(a[0].reasons).toEqual(['target_base_defaulted']);
  });
});

describe('doctrine B may never deliver an unanchored target (L63 restriction)', () => {
  // A hand-written corpus over the WHOLE reason vocabulary rather than a
  // derivation from it: a derived check would agree with whatever the code
  // does, and could never notice that a future edit had widened the delivery
  // condition. Enumerated here so adding a reason to the union type without
  // considering delivery is a compile error away from being noticed, and
  // widening doctrine B is one assertion away from RED.
  const ALL_REASONS: ConstraintUnreliabilityReason[] = [
    'threshold_normalisation_defaulted',
    'target_base_defaulted',
    'sample_frame_unanchored',
  ];
  const graph = { edges: [{ from: 'fac_a', to: 'goal_g' }] };

  const subsetsContainingUnanchored = ALL_REASONS.flatMap((_, i) =>
    ALL_REASONS.flatMap((__, j) =>
      i <= j
        ? [[...new Set(ALL_REASONS.slice(i, j + 1))].filter((r) => r !== undefined)]
        : [],
    ),
  ).filter((subset) => subset.includes('sample_frame_unanchored'));

  it('every reason set containing sample_frame_unanchored is SUPPRESSED, on a forward-propagated node', () => {
    expect(subsetsContainingUnanchored.length).toBeGreaterThan(0);
    for (const reasons of subsetsContainingUnanchored) {
      const out = partitionConstraintTargets(
        [{ constraint_id: 'c1', node_id: 'goal_g', reasons: [...reasons] }],
        graph,
      );
      expect(out.modelledBasis, `reasons=${reasons.join('+')}`).toEqual([]);
      expect(out.suppressed.map((t) => t.node_id), `reasons=${reasons.join('+')}`).toEqual(['goal_g']);
    }
  });

  it('CONTROL — doctrine B still delivers when the target is NOT unanchored', () => {
    const out = partitionConstraintTargets(
      [{ constraint_id: 'c1', node_id: 'goal_g', reasons: ['target_base_defaulted'] }],
      graph,
    );
    expect(out.modelledBasis.map((t) => t.node_id)).toEqual(['goal_g']);
  });
});

describe('buildConstraintTargetUnreliableMessage — L63 wording', () => {
  it('names the node, says the figure was withheld, and never quotes a probability', () => {
    const msg = buildConstraintTargetUnreliableMessage('Gross margin', ['sample_frame_unanchored']);
    expect(msg).toContain('Gross margin');
    expect(msg).toContain('withheld');
    expect(msg).not.toMatch(/\d+(\.\d+)?\s*%/);
  });

  it('takes priority over the older reasons when both are present', () => {
    const both = buildConstraintTargetUnreliableMessage('Gross margin', [
      'target_base_defaulted',
      'sample_frame_unanchored',
    ]);
    expect(both).toBe(buildConstraintTargetUnreliableMessage('Gross margin', ['sample_frame_unanchored']));
  });
});
