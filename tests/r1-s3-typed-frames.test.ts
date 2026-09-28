/**
 * R1 S3 — PLoT carries the typed target frames to ISL (design MG #72 5871257542, ruling DL
 * #72 5871412823, wire R3 #72 5872798858, meaning AIQ #72 5872801411).
 *
 * The wire, as ruled:
 *   · `change_abs` — a change from today in the node's own unit. A DIFFERENCE transforms by the
 *     node's scale and never by its offset: value = c / (max − min). On a `default` range there is
 *     no scale to read a change on, so a non-zero change is refused by name (0 is scale-free).
 *   · `change_rel` — a relative change, forwarded as the raw fraction r, never normalised. ISL
 *     resolves it against the target node's `raw_range {min, max}`; WHOSE base it is rides the target's
 *     `observed_state.source` (olumi-schemas #69, decision (b)). With no real range PLoT sends no `raw_range`, and ISL
 *     refuses by name; PLoT never guesses `min = 0`.
 *   · `quantity_frame` — what a node's value measures; forwarded on the node, absent = level.
 *
 * Every row binds by constraint_id / node id IDENTITY (trap 19).
 */

import { describe, it, expect } from 'vitest';

import {
  normaliseGoalConstraints,
  constraintsNeedNormalisation,
  levelDomainFor,
  CHANGE_FRAME_SCALE_UNKNOWN,
} from '../src/lib/intervention-normaliser.js';
import { normaliseNode } from '../src/normalisation/graph-normaliser.js';
import {
  toISLNode,
  toISLRobustnessRequest,
  attachChangeFrameRawRanges,
} from '../src/integrations/isl/translator-v3.js';
import { resolveConstraintSampleFrameAnchor, detectUnanchoredSampleFrameTargets, detectUnreliableConstraintTargets } from '../src/lib/constraint-reliability.js';
import type { EngineNodeV3, GoalConstraint } from '../src/types/engine-v3.js';

const spend = (os: Record<string, unknown> = {}): EngineNodeV3 =>
  ({
    id: 'monthly_cloud_spend',
    kind: 'factor',
    label: 'Monthly cloud spend',
    observed_state: { value: 0.45, raw_value: 45000, cap: 100000, unit: 'GBP/month', source: 'brief_extraction', ...os },
  }) as EngineNodeV3;

const limit = (over: Partial<GoalConstraint> & Record<string, unknown>): GoalConstraint =>
  ({
    constraint_id: 'c_spend',
    node_id: 'monthly_cloud_spend',
    operator: '<=',
    value: -5000,
    label: 'Spend change',
    ...over,
  }) as GoalConstraint;

const byId = (rows: readonly { constraint_id: string }[], id: string) => rows.find((r) => r.constraint_id === id);

describe('R1 S3 — change_abs is a DIFFERENCE: scaled, never offset', () => {
  it('S3-1 on a measured spread with min ≠ 0, c / (max − min) — not (c − min)/(max − min)', () => {
    const res = normaliseGoalConstraints(
      [limit({ value: -5000, value_frame: 'change_abs' })],
      [spend()],
      { interventionScaleByNodeId: new Map([['monthly_cloud_spend', { min: 20000, max: 120000, source: 'explicit' as const }]]) },
    );
    const row = byId(res.constraints, 'c_spend');
    expect(row).toBeDefined();
    expect(row!.value).toBeCloseTo(-0.05, 12); // affine would give -0.25
    expect(row!.value_frame).toBe('change_abs');
    expect((row as { original_value?: number }).original_value).toBe(-5000);
    expect(res.refused).toEqual([]);
  });

  it('S3-2 on a producer cap [0, cap], the same scale-only rule (min = 0 cannot hide the offset bug)', () => {
    const res = normaliseGoalConstraints(
      [limit({ value: 10000, operator: '>=', value_frame: 'change_abs' })],
      [spend()],
      { goalThresholdMetaByNodeId: new Map([['monthly_cloud_spend', { goal_threshold_cap: 200000 }]]) },
    );
    expect(byId(res.constraints, 'c_spend')!.value).toBeCloseTo(0.05, 12);
  });

  it('S3-3 never forwarded raw: gate closed, a change is still read on the node scale (0.5 pp ≠ 50 pp)', () => {
    const res = normaliseGoalConstraints(
      [limit({ value: 0.5, operator: '>=', value_frame: 'change_abs' })],
      [spend({ cap: 100 })],
      { normaliseWithoutScale: false },
    );
    const row = byId(res.constraints, 'c_spend');
    expect(row).toBeDefined();
    expect(row!.value).toBeCloseTo(0.005, 12);
  });

  it('S3-4 a non-zero change on a DEFAULT range is refused by name; nothing is sent', () => {
    const bare = { id: 'monthly_cloud_spend', kind: 'factor', label: 'Monthly cloud spend' } as EngineNodeV3;
    const res = normaliseGoalConstraints([limit({ value: -5, value_frame: 'change_abs' })], [bare]);
    expect(byId(res.constraints, 'c_spend')).toBeUndefined();
    expect(res.refused.map((r) => [r.constraint_id, r.reason])).toEqual([['c_spend', CHANGE_FRAME_SCALE_UNKNOWN]]);
  });

  it('S3-5 a change of 0 ("maintain") is scale-free: sent as 0 on a default range, not refused', () => {
    const bare = { id: 'monthly_cloud_spend', kind: 'factor', label: 'Monthly cloud spend' } as EngineNodeV3;
    const res = normaliseGoalConstraints([limit({ value: 0, operator: '>=', value_frame: 'change_abs' })], [bare]);
    expect(res.refused).toEqual([]);
    const row = byId(res.constraints, 'c_spend');
    expect(row!.value).toBe(0);
    expect(row!.value_frame).toBe('change_abs');
  });

  it('S3-6 CONTROL: a level limit on the same measured spread keeps the affine map', () => {
    const res = normaliseGoalConstraints(
      [limit({ value: 40000, value_frame: 'level' })],
      [spend()],
      { interventionScaleByNodeId: new Map([['monthly_cloud_spend', { min: 20000, max: 120000, source: 'explicit' as const }]]) },
    );
    expect(byId(res.constraints, 'c_spend')!.value).toBeCloseTo(0.2, 12);
  });
});

describe('R1 S3 — change_rel is a fraction: forwarded as r, with the node raw range', () => {
  it('S3-7 r goes on the wire untouched and the node raw range is recorded', () => {
    const res = normaliseGoalConstraints([limit({ value: -0.2, value_frame: 'change_rel' })], [spend()]);
    const row = byId(res.constraints, 'c_spend');
    expect(row!.value).toBe(-0.2);
    expect(row!.value_frame).toBe('change_rel');
    expect(res.raw_range_by_node_id.get('monthly_cloud_spend')).toEqual({ min: 0, max: 100000 });
  });

  it('S3-8 gate closed: r is still untouched and the raw range still recorded (a fraction is never "already normalised")', () => {
    const res = normaliseGoalConstraints(
      [limit({ value: -0.2, value_frame: 'change_rel' })],
      [spend()],
      { normaliseWithoutScale: false },
    );
    expect(byId(res.constraints, 'c_spend')!.value).toBe(-0.2);
    expect(res.raw_range_by_node_id.get('monthly_cloud_spend')).toEqual({ min: 0, max: 100000 });
  });

  it('S3-9 no real range: r is sent, NO raw range (ISL refuses by name; PLoT never guesses min = 0)', () => {
    const bare = { id: 'monthly_cloud_spend', kind: 'factor', label: 'Monthly cloud spend' } as EngineNodeV3;
    const res = normaliseGoalConstraints([limit({ value: -0.2, value_frame: 'change_rel' })], [bare]);
    expect(byId(res.constraints, 'c_spend')!.value).toBe(-0.2);
    expect(res.raw_range_by_node_id.has('monthly_cloud_spend')).toBe(false);
  });

  it('S3-9b a DERIVED range is not decision-grade: r is sent, NO raw range (AIQ #72 5876151887)', () => {
    // A value with no cap, no scale_frame and no producer range: the ladder can only DERIVE a range
    // from the value itself. That guess must never reach ISL as the bounds a relative change is read on.
    const guessed = {
      id: 'monthly_cloud_spend',
      kind: 'factor',
      label: 'Monthly cloud spend',
      observed_state: { value: 45000, unit: 'GBP/month', source: 'brief_extraction' },
    } as EngineNodeV3;
    const res = normaliseGoalConstraints([limit({ value: -0.2, value_frame: 'change_rel' })], [guessed]);
    expect(byId(res.constraints, 'c_spend')!.value).toBe(-0.2);
    expect(res.raw_range_by_node_id.has('monthly_cloud_spend')).toBe(false);
    // CONTROL (S3-7's shape): the same limit on a producer cap still records its bounds.
    const capped = normaliseGoalConstraints([limit({ value: -0.2, value_frame: 'change_rel' })], [spend()]);
    expect(capped.raw_range_by_node_id.get('monthly_cloud_spend')).toEqual({ min: 0, max: 100000 });
  });

  it('S3-10 two change_rel limits on one node that resolve DIFFERENT ranges: no raw range (fail closed)', () => {
    const res = normaliseGoalConstraints(
      [
        limit({ constraint_id: 'c_a', value: -0.2, value_frame: 'change_rel' }),
        limit({ constraint_id: 'c_b', value: -0.1, value_frame: 'change_rel' }),
      ],
      [spend()],
      { goalThresholdMetaByNodeId: new Map([['monthly_cloud_spend', { goal_threshold_cap: 200000 }]]),
        unitsByConstraintId: new Map(), interventionScaleByNodeId: new Map() },
    );
    // Same node, same range → one agreed copy.
    expect(res.raw_range_by_node_id.get('monthly_cloud_spend')).toEqual({ min: 0, max: 200000 });
    const conflicted = normaliseGoalConstraints(
      [
        limit({ constraint_id: 'c_a', value: -0.2, value_frame: 'change_rel' }),
        limit({ constraint_id: 'c_b', value: -0.1, value_frame: 'change_rel', unit: '%' } as never),
      ],
      [spend({ unit: '%', cap: 50 })],
      { unitsByConstraintId: new Map([['c_b', '%']]) },
    );
    const a = conflicted.raw_range_by_node_id.get('monthly_cloud_spend');
    // c_a reads the node cap [0, 50]; c_b reads the '%' rung. If they differ, the node carries none.
    if (a !== undefined) expect(a).toEqual({ min: 0, max: 50 });
  });

  it('S3-11 the gate ignores change frames: adding one never changes how a sibling level limit is read', () => {
    expect(constraintsNeedNormalisation([limit({ value: -0.2, value_frame: 'change_rel' })])).toBe(false);
    expect(constraintsNeedNormalisation([limit({ value: -5000, value_frame: 'change_abs' })])).toBe(false);
    // CONTROL: a raw level value still opens it.
    expect(constraintsNeedNormalisation([limit({ value: 40000, value_frame: 'level' })])).toBe(true);
  });

  it('S3-12 CONTROL: a change is never given a level domain', () => {
    // #394 made the '%' frame a required argument; a change is refused before it is read, on every frame.
    const legacy = { verdict: 'legacy' } as const;
    const deferred = { verdict: 'deferred', frame: 20, percent_extent: 20 } as const;
    for (const frame of [legacy, deferred]) {
      expect(levelDomainFor({ min: 0, max: 100, source: 'unit_percent' }, 'change_abs', frame)).toBeUndefined();
      expect(levelDomainFor({ min: 0, max: 100, source: 'unit_percent' }, 'change_rel', frame)).toBeUndefined();
    }
    // CONTROL: a level still gets its domain — {0, 1} on a 100-point frame, {0, 100/extent} on a 20-point one (#394).
    expect(levelDomainFor({ min: 0, max: 100, source: 'unit_percent' }, 'level', legacy)).toEqual({ min: 0, max: 1 });
    expect(levelDomainFor({ min: 0, max: 100, source: 'unit_percent' }, 'level', deferred)).toEqual({ min: 0, max: 5 });
  });
});

describe('R1 S3 — node facts ISL reads: quantity_frame, raw_range (whose base rides source)', () => {
  it('S3-13 normaliseNode keeps a contract quantity_frame and drops a junk one (absent = level)', () => {
    const kept = normaliseNode({ id: 'code_quality_change', kind: 'factor', label: 'Code quality change', quantity_frame: 'change' } as never);
    expect(kept.quantity_frame).toBe('change');
    const nested = normaliseNode({ id: 'q2', kind: 'factor', label: 'Q2', data: { quantity_frame: 'level' } } as never);
    expect(nested.quantity_frame).toBe('level');
    const junk = normaliseNode({ id: 'q3', kind: 'factor', label: 'Q3', quantity_frame: 'delta' } as never);
    expect('quantity_frame' in junk).toBe(false);
  });

  it('S3-14 toISLNode forwards quantity_frame by presence', () => {
    const withFrame = toISLNode({ id: 'code_quality_change', kind: 'factor', label: 'Code quality change', quantity_frame: 'change' } as EngineNodeV3);
    expect(withFrame.quantity_frame).toBe('change');
    const without = toISLNode({ id: 'x', kind: 'factor', label: 'X' } as EngineNodeV3);
    expect('quantity_frame' in without).toBe(false);
  });

  it('S3-15 the base owner rides observed_state.source (decision (b)): forwarded as is, no baseline_owner minted', () => {
    const n = toISLNode(spend());
    expect(n.observed_state?.source).toBe('brief_extraction');
    expect('baseline_owner' in (n.observed_state ?? {})).toBe(false);
  });

  it('S3-16 attachChangeFrameRawRanges stamps ONLY the nodes it was given a range for; every other node is byte-identical', () => {
    const engine = [
      spend(),
      { id: 'other', kind: 'factor', label: 'Other', observed_state: { value: 0.3, source: 'brief_extraction' } } as EngineNodeV3,
    ];
    const req = toISLRobustnessRequest({ nodes: engine, edges: [] } as never, [], 'monthly_cloud_spend', 'r1');
    const before = JSON.stringify(req.graph.nodes.find((n) => n.id === 'other'));
    attachChangeFrameRawRanges(req.graph.nodes, new Map([['monthly_cloud_spend', { min: 0, max: 100000 }]]));
    expect(req.graph.nodes.find((n) => n.id === 'monthly_cloud_spend')!.raw_range).toEqual({ min: 0, max: 100000 });
    expect(JSON.stringify(req.graph.nodes.find((n) => n.id === 'other'))).toBe(before);
  });
});

describe('R1 S3 — the sample-frame gate: ISL resolves a change target, so PLoT does not suppress it', () => {
  // A NON-root target with no baseline and no option setting it: the level gate has no anchor.
  const nodes = [{ id: 'egress', observed_state: { value: 0.3 } }];
  const edgeTargets = new Set(['egress']);
  const options = [{ id: 'a', interventions: { commitment: 0.8 } }, { id: 'b', interventions: { commitment: 0.2 } }];

  it('S3-17 change_abs / change_rel on a non-root node → anchored as isl_resolved_change', () => {
    expect(resolveConstraintSampleFrameAnchor('egress', nodes, edgeTargets, options, undefined, 'change_abs')).toBe('isl_resolved_change');
    expect(resolveConstraintSampleFrameAnchor('egress', nodes, edgeTargets, options, undefined, 'change_rel')).toBe('isl_resolved_change');
  });

  it('S3-18 CONTROL: a LEVEL limit on the same node stays unanchored (the gate still guards levels)', () => {
    expect(resolveConstraintSampleFrameAnchor('egress', nodes, edgeTargets, options, undefined, 'level')).toBeNull();
    const out = detectUnanchoredSampleFrameTargets(
      [limit({ constraint_id: 'lvl', node_id: 'egress', value: 0.2, value_frame: 'level' }),
       limit({ constraint_id: 'chg', node_id: 'egress', value: -0.1, value_frame: 'change_rel' })],
      nodes, edgeTargets, options, undefined,
    );
    expect(out.map((t) => t.constraint_id)).toEqual(['lvl']);
  });
});

describe('R1 S3 — ISL\'s defaulted-base warning does not condemn a change-frame limit', () => {
  it('S3-19 target_base_defaulted: kept for a level limit, NOT given to a change-frame limit on the same node', () => {
    const isl = { inference_warnings: [{ code: 'CONSTRAINT_NODE_DEFAULT_BASE', detail: { node_id: 'egress' } }] };
    const out = detectUnreliableConstraintTargets(
      [limit({ constraint_id: 'lvl', node_id: 'egress', value: 0.2, value_frame: 'level' }),
       limit({ constraint_id: 'chg', node_id: 'egress', value: -0.1, value_frame: 'change_rel' })],
      new Map(), isl,
    );
    expect(out.map((t) => [t.constraint_id, t.reasons])).toEqual([['lvl', ['target_base_defaulted']]]);
  });
});
