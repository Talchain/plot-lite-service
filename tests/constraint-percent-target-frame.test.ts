/**
 * A '%' LIMIT IS READ ON ITS TARGET'S OWN FRAME, OR IT IS REFUSED.
 *
 * THE DEFECT, WIRE-proven by AI Quality (olumi-programme-docs#69 comment
 * 5843365832; PLoT b09c0f2 · ISL 2795a8c; corpus copied verbatim into
 * `tests/fixtures/pct-cap-contrast-20260926/`):
 *
 *   `normaliseGoalConstraints`' `unit_percent` rung resolved `[0,100]` for a
 *   percentage-point `'%'` limit WHATEVER the target's own frame. So the same
 *   `<= 10 '%'` limit on root `fac_churn` read:
 *
 *     real level 4%,  frame 100 → threshold 0.1, node 0.04 → P(meet) 1     ✅
 *     real level 4%,  frame 20  → threshold 0.1, node 0.2  → P(meet) 0.017 ❌ (4% ≤ 10% is MET)
 *     real level 12%, frame 100 → threshold 0.1, node 0.12 → P(meet) 0.017 ✅
 *     real level 12%, frame 200 → threshold 0.1, node 0.06 → P(meet) 1     ❌ (12% ≤ 10% is BROKEN)
 *
 *   every row `unit_percent`, `decision_grade: true`.
 *
 * THE SPEC (AI Quality's Fix 2): the '%' rung DEFERS to the target's own frame
 * (`observed_state.cap`, else the node's `scale_frame`) or REFUSES — withheld
 * with a typed reason, never scored — when the limit's '%' and that frame
 * disagree. A target framed on 100 (Paul's churn: `scale_frame` 100) is
 * byte-identical.
 *
 * Every row below is bound to the corpus by node id (`fac_churn`) and
 * constraint id (`gc_churn`), and every expected threshold is DERIVED from the
 * fixture's own `raw_value`/`cap` — never typed in from the author's head.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  normaliseGoalConstraints,
  constraintsNeedNormalisation,
  constraintsHavePercentPointValue,
  constraintsNeedPercentTargetFrame,
  collectScaleFrameByNodeId,
  resolvePercentTargetFrame,
  DELTA_FRAME_VALUE_ALTERED,
  PERCENT_UNIT_DISAGREES_WITH_TARGET_FRAME,
} from '../src/lib/intervention-normaliser.js';
import type { EngineNodeV3, GoalConstraint } from '../src/types/engine-v3.js';

const FIXTURE_DIR = resolve(__dirname, 'fixtures/pct-cap-contrast-20260926');

interface CorpusRequest {
  graph: { nodes: Array<Record<string, any>>; edges: unknown[] };
  goal_constraints: Array<GoalConstraint & { unit?: string }>;
}

function corpus(variant: string): CorpusRequest {
  return JSON.parse(readFileSync(resolve(FIXTURE_DIR, `${variant}.request.json`), 'utf8'));
}

/** The corpus node, BY ID. */
function node(req: CorpusRequest, id: string): Record<string, any> {
  const n = req.graph.nodes.find((x) => x.id === id);
  expect(n, `node ${id} must exist in the corpus row`).toBeDefined();
  return n!;
}

/** The corpus constraint, BY ID. */
function limit(req: CorpusRequest, id: string): GoalConstraint & { unit?: string } {
  const c = req.goal_constraints.find((x) => x.constraint_id === id);
  expect(c, `constraint ${id} must exist in the corpus row`).toBeDefined();
  return c!;
}

/** The canonical-shaped node the normaliser sees (kind → EngineNodeV3). */
function engineNode(raw: Record<string, any>): EngineNodeV3 {
  return { id: raw.id, kind: raw.kind, label: raw.label, observed_state: raw.observed_state } as EngineNodeV3;
}

/** Normalise a corpus row the way the route does, gate derived from the real predicate. */
function normaliseRow(req: CorpusRequest, extra: { scaleFrameByNodeId?: Map<string, number> } = {}) {
  const constraints = req.goal_constraints.map(({ unit: _u, ...c }) => c as GoalConstraint);
  const units = new Map<string, string>();
  for (const c of req.goal_constraints) if (typeof c.unit === 'string') units.set(c.constraint_id, c.unit);
  return normaliseGoalConstraints(constraints, req.graph.nodes.map(engineNode), {
    unitsByConstraintId: units,
    normaliseWithoutScale: constraintsNeedNormalisation(constraints),
    ...(extra.scaleFrameByNodeId !== undefined && { scaleFrameByNodeId: extra.scaleFrameByNodeId }),
  });
}

function sent(result: ReturnType<typeof normaliseGoalConstraints>, id: string): number | undefined {
  return result.constraints.find((c) => c.constraint_id === id)?.value;
}

function diag(result: ReturnType<typeof normaliseGoalConstraints>, id: string) {
  return result.diagnostics.find((d) => d.constraint_id === id);
}

/** Replace fac_churn's observed_state / top-level fields on a deep copy of a corpus row. */
function withChurn(
  variant: string,
  patch: { observed_state?: Record<string, unknown>; scale_frame?: number },
): CorpusRequest {
  const req = corpus(variant);
  const churn = node(req, 'fac_churn');
  if (patch.observed_state !== undefined) churn.observed_state = patch.observed_state;
  if (patch.scale_frame !== undefined) churn.scale_frame = patch.scale_frame;
  return req;
}

// =============================================================================
// 1. THE CORPUS — the four wire rows, by node id
// =============================================================================

describe('pct-cap contrast corpus — the % rung reads the target frame', () => {
  it('PRECONDITION: the corpus rows are what AI Quality captured (limit, node, frames)', () => {
    for (const [variant, cap, raw] of [
      ['lvl4_cap100', 100, 4],
      ['lvl4_cap20', 20, 4],
      ['lvl12_cap100', 100, 12],
      ['lvl12_cap200', 200, 12],
    ] as const) {
      const req = corpus(variant);
      const churn = node(req, 'fac_churn');
      expect(churn.observed_state.cap, variant).toBe(cap);
      expect(churn.observed_state.raw_value, variant).toBe(raw);
      expect(churn.observed_state.unit, variant).toBe('%');
      // Root node: no edge INTO it (the finding's shape).
      expect((req.graph.edges as Array<{ to: string }>).some((e) => e.to === 'fac_churn'), variant).toBe(false);
      const gc = limit(req, 'gc_churn');
      expect(gc).toMatchObject({ node_id: 'fac_churn', operator: '<=', value: 10, unit: '%', value_frame: 'level' });
    }
  });

  it('CONTROL — framed on 100: threshold 0.1 on [0,100] unit_percent, exactly as before', () => {
    for (const variant of ['lvl4_cap100', 'lvl12_cap100']) {
      const r = normaliseRow(corpus(variant));
      expect(sent(r, 'gc_churn'), variant).toBeCloseTo(0.1, 12);
      expect(diag(r, 'gc_churn')!.range, variant).toEqual({ min: 0, max: 100, source: 'unit_percent' });
      expect(r.refused, variant).toEqual([]);
      expect(r.repairs.map((x) => x.reason), variant).toEqual(['normalised range=[0,100] source=unit_percent']);
    }
  });

  it('framed on 20: the 10% limit is read on [0,20] → 0.5 (the 4% level MEETS it)', () => {
    const req = corpus('lvl4_cap20');
    const cap = node(req, 'fac_churn').observed_state.cap as number;
    const r = normaliseRow(req);
    expect(sent(r, 'gc_churn')).toBe(limit(req, 'gc_churn').value / cap);
    expect(sent(r, 'gc_churn')).toBe(0.5);
    // The wrong-pass value, named so a regression is unmistakable.
    expect(sent(r, 'gc_churn')).not.toBeCloseTo(0.1, 12);
    expect(diag(r, 'gc_churn')!.range).toEqual({ min: 0, max: cap, source: 'unit_percent' });
    expect(diag(r, 'gc_churn')!.clamped).toBe(false);
    expect(r.refused).toEqual([]);
    // The node's own level (0.2 = 4/20) now sits BELOW the threshold, as it does in the world.
    expect(node(req, 'fac_churn').observed_state.value).toBeLessThan(sent(r, 'gc_churn')!);
  });

  it('framed on 200: the 10% limit is read on [0,200] → 0.05 (the 12% level BREAKS it)', () => {
    const req = corpus('lvl12_cap200');
    const cap = node(req, 'fac_churn').observed_state.cap as number;
    const r = normaliseRow(req);
    expect(sent(r, 'gc_churn')).toBe(limit(req, 'gc_churn').value / cap);
    expect(sent(r, 'gc_churn')).toBe(0.05);
    expect(sent(r, 'gc_churn')).not.toBeCloseTo(0.1, 12);
    expect(diag(r, 'gc_churn')!.range).toEqual({ min: 0, max: cap, source: 'unit_percent' });
    expect(r.refused).toEqual([]);
    // The node's own level (0.06 = 12/200) now sits ABOVE the threshold — a broken limit, as in the world.
    expect(node(req, 'fac_churn').observed_state.value).toBeGreaterThan(sent(r, 'gc_churn')!);
  });

  it('THE PROPERTY: the same real-world level answers the same way on every frame', () => {
    // level ≤ limit in percentage points ⇔ node value ≤ threshold, on EVERY frame.
    for (const variant of ['lvl4_cap100', 'lvl4_cap20', 'lvl12_cap100', 'lvl12_cap200']) {
      const req = corpus(variant);
      const churn = node(req, 'fac_churn');
      const gc = limit(req, 'gc_churn');
      const r = normaliseRow(req);
      const metInTheWorld = churn.observed_state.raw_value <= gc.value;
      const metOnTheWire = churn.observed_state.value <= sent(r, 'gc_churn')!;
      expect(metOnTheWire, variant).toBe(metInTheWorld);
    }
  });
});

// =============================================================================
// 2. THE FRAME CARRIERS — cap, else scale_frame; unit families
// =============================================================================

describe('the target frame — which carrier, which unit', () => {
  it("scale_frame is a frame too: '%' node with scale_frame 20 and no cap → 0.5", () => {
    const req = withChurn('lvl4_cap20', {
      observed_state: { value: 0.2, raw_value: 4, unit: '%', std: 0.05 },
      scale_frame: 20,
    });
    const r = normaliseRow(req, { scaleFrameByNodeId: new Map([['fac_churn', node(req, 'fac_churn').scale_frame]]) });
    expect(sent(r, 'gc_churn')).toBe(0.5);
    expect(diag(r, 'gc_churn')!.range).toEqual({ min: 0, max: 20, source: 'unit_percent' });
  });

  it("CONTROL — Paul's churn shape (scale_frame 100, unit '% per month', no cap) is unchanged", () => {
    const req = withChurn('lvl4_cap100', {
      observed_state: { value: 0.07, raw_value: 7, unit: '% per month' },
      scale_frame: 100,
    });
    const r = normaliseRow(req, { scaleFrameByNodeId: new Map([['fac_churn', node(req, 'fac_churn').scale_frame]]) });
    expect(sent(r, 'gc_churn')).toBeCloseTo(0.1, 12);
    expect(diag(r, 'gc_churn')!.range).toEqual({ min: 0, max: 100, source: 'unit_percent' });
    expect(r.refused).toEqual([]);
  });

  it('cap outranks scale_frame (the same order CEE reads them in)', () => {
    const req = withChurn('lvl4_cap20', {
      observed_state: { value: 0.2, raw_value: 4, cap: 20, unit: '%' },
      scale_frame: 200,
    });
    const r = normaliseRow(req, { scaleFrameByNodeId: new Map([['fac_churn', node(req, 'fac_churn').scale_frame]]) });
    expect(sent(r, 'gc_churn')).toBe(0.5);
  });

  it("CONTROL — a 'fraction' node on cap 1 is percent ÷ 100: unchanged [0,100]", () => {
    const req = withChurn('lvl4_cap100', { observed_state: { value: 0.04, raw_value: 0.04, cap: 1, unit: 'fraction' } });
    const r = normaliseRow(req);
    expect(sent(r, 'gc_churn')).toBeCloseTo(0.1, 12);
    expect(diag(r, 'gc_churn')!.range).toEqual({ min: 0, max: 100, source: 'unit_percent' });
  });

  it("a 'fraction' node on cap 0.5 spans 50 percentage points → 10% reads 0.2", () => {
    const req = withChurn('lvl4_cap100', { observed_state: { value: 0.08, raw_value: 0.04, cap: 0.5, unit: 'fraction' } });
    const r = normaliseRow(req);
    expect(sent(r, 'gc_churn')).toBeCloseTo(0.2, 12);
    expect(diag(r, 'gc_churn')!.range).toEqual({ min: 0, max: 50, source: 'unit_percent' });
  });

  it('CONTROL — no frame declared on the target: unchanged [0,100]', () => {
    const req = withChurn('lvl4_cap100', { observed_state: { value: 0.07, std: 0.01 } });
    const r = normaliseRow(req);
    expect(sent(r, 'gc_churn')).toBeCloseTo(0.1, 12);
    expect(diag(r, 'gc_churn')!.range).toEqual({ min: 0, max: 100, source: 'unit_percent' });
  });

  it('CONTROL — an undeclared unit on frame 100 or frame 1 keeps the [0,100] reading', () => {
    for (const cap of [100, 1]) {
      const req = withChurn('lvl4_cap100', { observed_state: { value: 0.04, raw_value: 4 * (cap / 100), cap } });
      const r = normaliseRow(req);
      expect(sent(r, 'gc_churn'), `cap ${cap}`).toBeCloseTo(0.1, 12);
      expect(r.refused, `cap ${cap}`).toEqual([]);
    }
  });

  it('resolvePercentTargetFrame names the verdict per carrier (identity-bound, by node)', () => {
    const n = (os: Record<string, unknown>) => ({ id: 'fac_churn', kind: 'factor', label: 'x', observed_state: os }) as unknown as EngineNodeV3;
    expect(resolvePercentTargetFrame(n({ value: 0.2, cap: 20, unit: '%' }), undefined)).toEqual({
      verdict: 'deferred', frame: 20, percent_extent: 20,
    });
    expect(resolvePercentTargetFrame(n({ value: 0.04, cap: 100, unit: '%' }), undefined)).toEqual({ verdict: 'legacy' });
    expect(resolvePercentTargetFrame(n({ value: 0.2, unit: '%' }), 20)).toEqual({
      verdict: 'deferred', frame: 20, percent_extent: 20,
    });
    expect(resolvePercentTargetFrame(n({ value: 0.4, cap: 500000, unit: '£' }), undefined)).toEqual({
      verdict: 'refused', frame: 500000, frame_unit: '£',
    });
    expect(resolvePercentTargetFrame(undefined, undefined)).toEqual({ verdict: 'legacy' });
  });
});

// =============================================================================
// 3. REFUSAL — the '%' and the target frame disagree
// =============================================================================

describe("refusal — a '%' limit on a frame that is not stated in percent", () => {
  const refusalCases: Array<[string, Record<string, unknown>]> = [
    // A currency frame: fac_cost's own shape from the same corpus graph.
    ['currency frame', { value: 0.4, raw_value: 200000, cap: 500000, unit: '£', std: 0.05 }],
    // A count frame on 100 — numerically the legacy frame, but not a percent.
    ['count frame on 100', { value: 0.04, raw_value: 4, cap: 100, unit: 'count' }],
    // A spelling PLoT cannot read as percent, off 100.
    ['unreadable percent spelling off 100', { value: 0.2, raw_value: 4, cap: 20, unit: '% per month' }],
    // No unit at all, off 100.
    ['undeclared unit off 100', { value: 0.2, raw_value: 4, cap: 20 }],
  ];

  for (const [name, observed_state] of refusalCases) {
    it(`${name}: withheld with the typed reason, never scored`, () => {
      const req = withChurn('lvl4_cap20', { observed_state });
      const r = normaliseRow(req);
      expect(sent(r, 'gc_churn'), name).toBeUndefined();
      expect(diag(r, 'gc_churn'), name).toBeUndefined();
      expect(r.refused, name).toHaveLength(1);
      expect(r.refused[0], name).toMatchObject({
        constraint_id: 'gc_churn',
        node_id: 'fac_churn',
        reason: PERCENT_UNIT_DISAGREES_WITH_TARGET_FRAME,
        stated_value: 10,
      });
      // The wire vocabulary is pinned by value too: consumers read it off `_meta.filtered_constraints`.
      expect(r.refused[0].reason).toBe('percent_unit_disagrees_with_target_frame');
      const removed = r.repairs.find((x) => x.field === 'constraint.value.gc_churn');
      expect(removed, name).toMatchObject({ action: 'removed', from_value: 10, to_value: 'refused' });
    });
  }

  it('a refusal withholds ONLY its own constraint — a batch-mate still delivers', () => {
    const req = withChurn('lvl4_cap20', { observed_state: { value: 0.4, raw_value: 200000, cap: 500000, unit: '£' } });
    req.goal_constraints.push({
      constraint_id: 'gc_cost', node_id: 'fac_cost', operator: '<=', value: 250000, unit: '£', value_frame: 'level',
    } as GoalConstraint & { unit: string });
    const r = normaliseRow(req);
    expect(r.refused.map((x) => x.constraint_id)).toEqual(['gc_churn']);
    expect(sent(r, 'gc_cost')).toBe(0.5);
  });
});

// =============================================================================
// 4. CONTROLS — other rungs, other units
// =============================================================================

describe('controls — behaviours that must not move', () => {
  it('CONTROL: a NON-% limit on the framed-20 node is on explicit_cap [0,20], unchanged', () => {
    const req = corpus('lvl4_cap20');
    limit(req, 'gc_churn').unit = 'count';
    const r = normaliseRow(req);
    expect(diag(r, 'gc_churn')!.range).toEqual({ min: 0, max: 20, source: 'explicit_cap' });
    expect(sent(r, 'gc_churn')).toBe(0.5);
  });

  it("CONTROL: the corpus's own £ limit on fac_cost (U3b) is unchanged: explicit_cap → 0.5", () => {
    const req = corpus('lvl4_cap20');
    req.goal_constraints = [{
      constraint_id: 'gc_u3b', node_id: 'fac_cost', operator: '<=', value: 250000, unit: '£', value_frame: 'level',
    } as GoalConstraint & { unit: string }];
    const r = normaliseRow(req);
    expect(diag(r, 'gc_u3b')!.range).toEqual({ min: 0, max: 500000, source: 'explicit_cap' });
    expect(sent(r, 'gc_u3b')).toBe(0.5);
  });

  it('CONTROL: goal_threshold_cap (rung 3) still outranks the % rung on a framed node', () => {
    const req = corpus('lvl4_cap20');
    const constraints = req.goal_constraints.map(({ unit: _u, ...c }) => c as GoalConstraint);
    const r = normaliseGoalConstraints(constraints, req.graph.nodes.map(engineNode), {
      unitsByConstraintId: new Map([['gc_churn', '%']]),
      goalThresholdMetaByNodeId: new Map([['fac_churn', { goal_threshold_cap: 40 }]]),
      normaliseWithoutScale: true,
    });
    expect(diag(r, 'gc_churn')!.range).toEqual({ min: 0, max: 40, source: 'goal_threshold_cap' });
    expect(sent(r, 'gc_churn')).toBe(0.25);
    expect(r.refused).toEqual([]);
  });

  it('CONTROL: a MEASURED intervention scale (rung 1) still wins — and now agrees with the % frame', () => {
    const req = corpus('lvl4_cap20');
    const constraints = req.goal_constraints.map(({ unit: _u, ...c }) => c as GoalConstraint);
    const r = normaliseGoalConstraints(constraints, req.graph.nodes.map(engineNode), {
      unitsByConstraintId: new Map([['gc_churn', '%']]),
      interventionScaleByNodeId: new Map([['fac_churn', { min: 0, max: 20, source: 'explicit_cap' as const }]]),
      normaliseWithoutScale: true,
    });
    expect(diag(r, 'gc_churn')!.range).toEqual({ min: 0, max: 20, source: 'explicit_cap' });
    expect(sent(r, 'gc_churn')).toBe(0.5);
    // The '%' limit read on its target's frame IS [0,20] — the same scale, so no divergence.
    expect(diag(r, 'gc_churn')!.range_unified).toBe(true);
  });

  it('DELTA rows (AI Quality\'s delta contrast): refused for frame fidelity on BOTH frames, as before', () => {
    for (const variant of ['delta_cap100', 'delta_cap20']) {
      const req = corpus(variant);
      const gc = limit(req, 'gc_churn_rise');
      expect(gc).toMatchObject({ unit: '%', value_frame: 'delta', value: 2 });
      const r = normaliseRow(req);
      expect(sent(r, 'gc_churn_rise'), variant).toBeUndefined();
      expect(r.refused.map((x) => [x.constraint_id, x.reason]), variant).toEqual([
        ['gc_churn_rise', DELTA_FRAME_VALUE_ALTERED],
      ]);
    }
  });
});

// =============================================================================
// 5. BATCH-INVARIANCE — a fractional '%' on a framed target (2.957's property)
// =============================================================================

describe("a fractional '%' on a framed target means the same alone and batched", () => {
  const GATE_OPENER: GoalConstraint = {
    constraint_id: 'gc_gate_opener', node_id: 'fac_cost', operator: '<=', value: 250000,
  } as GoalConstraint;

  function send(batch: GoalConstraint[], units: Array<[string, string]>, nodes: EngineNodeV3[]) {
    return normaliseGoalConstraints(batch, nodes, {
      unitsByConstraintId: new Map(units),
      normaliseWithoutScale: constraintsNeedNormalisation(batch),
    });
  }

  it("0.04 '%' (four percent, CEE's fractional form) on a frame-20 node reads 0.2, alone AND batched", () => {
    const req = corpus('lvl4_cap20');
    const nodes = req.graph.nodes.map(engineNode);
    const frac: GoalConstraint = { constraint_id: 'gc_churn', node_id: 'fac_churn', operator: '<=', value: 0.04 } as GoalConstraint;
    const alone = send([frac], [['gc_churn', '%']], nodes);
    const batched = send([frac, GATE_OPENER], [['gc_churn', '%']], nodes);
    expect(sent(alone, 'gc_churn')).toBeCloseTo(0.2, 12);
    expect(sent(batched, 'gc_churn')).toBeCloseTo(0.2, 12);
    expect(sent(alone, 'gc_churn')).toBe(sent(batched, 'gc_churn'));
  });

  it('the route invocation predicate fires for exactly that cell, bound by constraint id', () => {
    const req = corpus('lvl4_cap20');
    const nodes = req.graph.nodes.map(engineNode);
    const frac: GoalConstraint = { constraint_id: 'gc_churn', node_id: 'fac_churn', operator: '<=', value: 0.04 } as GoalConstraint;
    // Precondition: neither legacy disjunct fires for it.
    expect(constraintsNeedNormalisation([frac])).toBe(false);
    expect(constraintsHavePercentPointValue([frac], new Map([['gc_churn', '%']]))).toBe(false);
    expect(constraintsNeedPercentTargetFrame([frac], nodes, { unitsByConstraintId: new Map([['gc_churn', '%']]) })).toBe(true);
    // Identity: a '%' registered under ANOTHER id is not evidence.
    expect(constraintsNeedPercentTargetFrame([frac], nodes, { unitsByConstraintId: new Map([['someone_else', '%']]) })).toBe(false);
    // Same constraint on the framed-100 node: no reason to invoke.
    const f100 = corpus('lvl4_cap100').graph.nodes.map(engineNode);
    expect(constraintsNeedPercentTargetFrame([frac], f100, { unitsByConstraintId: new Map([['gc_churn', '%']]) })).toBe(false);
    // A goal_threshold_cap on the node means rung 3 decides: no forced invocation.
    expect(
      constraintsNeedPercentTargetFrame([frac], nodes, {
        unitsByConstraintId: new Map([['gc_churn', '%']]),
        goalThresholdMetaByNodeId: new Map([['fac_churn', { goal_threshold_cap: 40 }]]),
      }),
    ).toBe(false);
  });
});

describe('collectScaleFrameByNodeId — the raw-node carrier', () => {
  it('reads a finite positive top-level scale_frame by node id, and nothing else', () => {
    const m = collectScaleFrameByNodeId([
      { id: 'a', scale_frame: 20 },
      { id: 'b', scale_frame: 0 },
      { id: 'c', scale_frame: -5 },
      { id: 'd', scale_frame: '20' },
      { id: 'e', data: { scale_frame: 20 } },
      { id: 'f', scale_frame: Number.POSITIVE_INFINITY },
      { scale_frame: 20 },
      null,
    ]);
    expect([...m.entries()]).toEqual([['a', 20]]);
    expect(collectScaleFrameByNodeId(undefined).size).toBe(0);
  });
});

// =============================================================================
// 6. ROUND 2 — the (value, raw_value) PAIR is a frame carrier, and a declared
//    NON-percent unit refuses with no frame at all
// =============================================================================
//
// THE DEFECT (adversarial verify of acc80d1, EXECUTED): a '%' factor whose
// frame is carried ONLY by its `{value, raw_value}` pair — CEE's "capless
// framed pair": records projector pass 3d writes `{value: raw/frame,
// raw_value: raw}` and deliberately no cap, and CEE's own `recoverScaleFrame`
// (d1-shared/scale-frame.ts at fbb12b8) reads the frame back as
// raw_value / value — was still read on [0,100], decision_grade true.
// `{0.06, 12}` under `<= 10 '%'` put 0.1 on the wire against a level of 0.06:
// MET, although 12% > 10%. `{0.575, 115}` under `>= 100 '%'` put 1.0 against
// 0.575: BROKEN, although 115% >= 100%.
//
// Every expected threshold is DERIVED from the row's own pair
// (limit ÷ (raw_value ÷ value)) — never typed in from the author's head.

describe("round 2 — a '%' limit on a PAIR-framed target (no cap, no scale_frame)", () => {
  /** fac_churn carries ONLY the given observed_state: no cap, no scale_frame (the verifier's probe shape). */
  function pairOnly(variant: string, observed_state: Record<string, unknown>): CorpusRequest {
    const req = withChurn(variant, { observed_state });
    const churn = node(req, 'fac_churn');
    // PRECONDITION: the pair is the ONLY frame carrier on the row.
    expect(churn.observed_state.cap, 'no cap on the row').toBeUndefined();
    expect(churn.scale_frame, 'no scale_frame on the row').toBeUndefined();
    return req;
  }

  function pairFrame(req: CorpusRequest): number {
    const os = node(req, 'fac_churn').observed_state;
    return os.raw_value / os.value;
  }

  it("pair on 200 ({0.06, 12}): the 10% limit reads 0.05 — the 12% level BREAKS it, as in the world", () => {
    const req = pairOnly('lvl12_cap200', { value: 0.06, raw_value: 12, unit: '%', std: 0.005 });
    const r = normaliseRow(req);
    expect(sent(r, 'gc_churn')).toBeCloseTo(limit(req, 'gc_churn').value / pairFrame(req), 12);
    expect(sent(r, 'gc_churn')).toBeCloseTo(0.05, 12);
    // The wrong-pass value, named so a regression is unmistakable.
    expect(sent(r, 'gc_churn')).not.toBeCloseTo(0.1, 12);
    expect(diag(r, 'gc_churn')!.range).toEqual({ min: 0, max: 200, source: 'unit_percent' });
    expect(r.refused).toEqual([]);
    expect(node(req, 'fac_churn').observed_state.value).toBeGreaterThan(sent(r, 'gc_churn')!);
  });

  it("pair on 20 ({0.2, 4}): the 10% limit reads 0.5 — the 4% level MEETS it", () => {
    const req = pairOnly('lvl4_cap20', { value: 0.2, raw_value: 4, unit: '%', std: 0.05 });
    const r = normaliseRow(req);
    expect(sent(r, 'gc_churn')).toBeCloseTo(limit(req, 'gc_churn').value / pairFrame(req), 12);
    expect(sent(r, 'gc_churn')).toBeCloseTo(0.5, 12);
    expect(diag(r, 'gc_churn')!.range).toEqual({ min: 0, max: 20, source: 'unit_percent' });
    expect(r.refused).toEqual([]);
    expect(node(req, 'fac_churn').observed_state.value).toBeLessThan(sent(r, 'gc_churn')!);
  });

  it("NRR pair ({0.575, 115}) under '>= 100 %': reads 0.5 — 115% MEETS it, as in the world", () => {
    const req = pairOnly('lvl12_cap200', { value: 0.575, raw_value: 115, unit: '%' });
    req.goal_constraints = [
      { constraint_id: 'gc_churn', node_id: 'fac_churn', operator: '>=', value: 100, unit: '%', value_frame: 'level' } as GoalConstraint & { unit: string },
    ];
    const r = normaliseRow(req);
    expect(sent(r, 'gc_churn')).toBeCloseTo(limit(req, 'gc_churn').value / pairFrame(req), 12);
    expect(sent(r, 'gc_churn')).toBeCloseTo(0.5, 12);
    // Wrong-pass value at acc80d1: 100 on [0,100] = 1.0, which 0.575 never reaches.
    expect(sent(r, 'gc_churn')).not.toBeCloseTo(1, 6);
    expect(diag(r, 'gc_churn')!.range.max).toBeCloseTo(200, 9);
    expect(r.refused).toEqual([]);
    expect(node(req, 'fac_churn').observed_state.value).toBeGreaterThanOrEqual(sent(r, 'gc_churn')!);
  });

  it('THE PROPERTY on the pair carrier: the same real-world level answers the same way on every pair frame', () => {
    for (const [variant, os, op, lim] of [
      ['lvl12_cap200', { value: 0.06, raw_value: 12, unit: '%' }, '<=', 10],
      ['lvl4_cap20', { value: 0.2, raw_value: 4, unit: '%' }, '<=', 10],
      ['lvl4_cap100', { value: 0.04, raw_value: 4, unit: '%' }, '<=', 10],
      ['lvl12_cap200', { value: 0.575, raw_value: 115, unit: '%' }, '>=', 100],
      ['lvl12_cap200', { value: 0.575, raw_value: 115, unit: '%' }, '<=', 100],
    ] as const) {
      const req = pairOnly(variant, { ...os });
      req.goal_constraints = [
        { constraint_id: 'gc_churn', node_id: 'fac_churn', operator: op, value: lim, unit: '%', value_frame: 'level' } as GoalConstraint & { unit: string },
      ];
      const r = normaliseRow(req);
      const level = node(req, 'fac_churn').observed_state;
      const threshold = sent(r, 'gc_churn')!;
      const inTheWorld = op === '<=' ? level.raw_value <= lim : level.raw_value >= lim;
      const onTheWire = op === '<=' ? level.value <= threshold : level.value >= threshold;
      expect(onTheWire, `${variant} ${JSON.stringify(os)} ${op} ${lim}`).toBe(inTheWorld);
    }
  });

  it('CONTROL — a pair framed on 100 ({0.04, 4}, no cap): the legacy [0,100] reading, unchanged', () => {
    const req = pairOnly('lvl4_cap100', { value: 0.04, raw_value: 4, unit: '%', std: 0.01 });
    const r = normaliseRow(req);
    expect(sent(r, 'gc_churn')).toBeCloseTo(0.1, 12);
    expect(diag(r, 'gc_churn')!.range).toEqual({ min: 0, max: 100, source: 'unit_percent' });
    expect(r.refused).toEqual([]);
    expect(r.repairs.map((x) => x.reason)).toEqual(['normalised range=[0,100] source=unit_percent']);
  });

  it("CONTROL — Paul's churn estimate with NO scale_frame ({0.07, 7}, '% per month'): legacy, not refused", () => {
    // 7 / 0.07 is 99.99999999999999 in IEEE-754: the pair coheres with frame 100
    // under CEE's own tolerance (`checkPairCoherence`, relative 1e-9), so it IS
    // the legacy frame — an unrecognised spelling off 100 would otherwise refuse.
    const req = pairOnly('lvl4_cap100', { value: 0.07, raw_value: 7, unit: '% per month' });
    expect(pairFrame(req)).not.toBe(100);
    const r = normaliseRow(req);
    expect(sent(r, 'gc_churn')).toBeCloseTo(0.1, 12);
    expect(diag(r, 'gc_churn')!.range).toEqual({ min: 0, max: 100, source: 'unit_percent' });
    expect(r.refused).toEqual([]);
  });

  it('CONTROL — pairs outside CEE recoverScaleFrame\'s domain are NOT a frame: legacy [0,100]', () => {
    for (const os of [
      { value: 0.07, raw_value: 0.07, unit: '%' }, // unframed writer {x, x}: raw_value > value fails
      { value: 0.08, raw_value: 0.04, unit: '%' }, // raw below the level: frame 0.5 is not > 1
      { value: 0, raw_value: 5, unit: '%' }, // zero level: scale-ambiguous
      { value: -0.06, raw_value: 12, unit: '%' }, // negative level
      { value: 0.06, raw_value: Number.POSITIVE_INFINITY, unit: '%' }, // non-finite raw
    ]) {
      const req = pairOnly('lvl4_cap100', os);
      const r = normaliseRow(req);
      expect(sent(r, 'gc_churn'), JSON.stringify(os)).toBeCloseTo(0.1, 12);
      expect(diag(r, 'gc_churn')!.range, JSON.stringify(os)).toEqual({ min: 0, max: 100, source: 'unit_percent' });
    }
  });

  it('the pair is the THIRD carrier: cap, then scale_frame, then the pair', () => {
    const capWins = withChurn('lvl4_cap20', { observed_state: { value: 0.06, raw_value: 12, cap: 20, unit: '%' } });
    expect(sent(normaliseRow(capWins), 'gc_churn')).toBe(0.5);
    const sfWins = withChurn('lvl4_cap20', { observed_state: { value: 0.06, raw_value: 12, unit: '%' }, scale_frame: 20 });
    expect(
      sent(normaliseRow(sfWins, { scaleFrameByNodeId: new Map([['fac_churn', 20]]) }), 'gc_churn'),
    ).toBe(0.5);
  });

  it('resolvePercentTargetFrame names the pair verdicts (identity-bound, by node)', () => {
    const n = (os: Record<string, unknown>) => ({ id: 'fac_churn', kind: 'factor', label: 'x', observed_state: os }) as unknown as EngineNodeV3;
    expect(resolvePercentTargetFrame(n({ value: 0.06, raw_value: 12, unit: '%' }), undefined)).toEqual({
      verdict: 'deferred', frame: 200, percent_extent: 200,
    });
    expect(resolvePercentTargetFrame(n({ value: 0.2, raw_value: 4, unit: '%' }), undefined)).toEqual({
      verdict: 'deferred', frame: 20, percent_extent: 20,
    });
    expect(resolvePercentTargetFrame(n({ value: 0.04, raw_value: 4, unit: '%' }), undefined)).toEqual({ verdict: 'legacy' });
    expect(resolvePercentTargetFrame(n({ value: 0.07, raw_value: 7, unit: '% per month' }), undefined)).toEqual({ verdict: 'legacy' });
    // A pair on an UNDECLARED unit off 100 refuses exactly as a cap would.
    expect(resolvePercentTargetFrame(n({ value: 0.2, raw_value: 4 }), undefined)).toEqual({
      verdict: 'refused', frame: 20, frame_unit: undefined,
    });
  });
});

describe("round 2 — a '%' limit on a declared NON-percent unit with NO frame is refused", () => {
  const unframedNonPercent: Array<[string, Record<string, unknown>]> = [
    ['£ unframed', { value: 0.4, unit: '£' }],
    ['count unframed', { value: 0.4, unit: 'count' }],
    ['duration unframed', { value: 0.4, unit: 'months' }],
  ];

  for (const [name, observed_state] of unframedNonPercent) {
    it(`${name}: withheld with the typed reason, never scored on [0,100]`, () => {
      const req = withChurn('lvl4_cap100', { observed_state });
      expect(node(req, 'fac_churn').observed_state.cap, 'precondition: no cap').toBeUndefined();
      expect(node(req, 'fac_churn').scale_frame, 'precondition: no scale_frame').toBeUndefined();
      const r = normaliseRow(req);
      expect(sent(r, 'gc_churn'), name).toBeUndefined();
      expect(diag(r, 'gc_churn'), name).toBeUndefined();
      expect(r.refused.map((x) => [x.constraint_id, x.node_id, x.reason, x.stated_value]), name).toEqual([
        ['gc_churn', 'fac_churn', PERCENT_UNIT_DISAGREES_WITH_TARGET_FRAME, 10],
      ]);
      const removed = r.repairs.find((x) => x.field === 'constraint.value.gc_churn');
      expect(removed, name).toMatchObject({ action: 'removed', from_value: 10, to_value: 'refused' });
      expect(removed!.reason, name).toContain('frame=none');
    });
  }

  it('resolvePercentTargetFrame: refused with NO frame for a declared non-percent unit', () => {
    const n = (os: Record<string, unknown>) => ({ id: 'fac_churn', kind: 'factor', label: 'x', observed_state: os }) as unknown as EngineNodeV3;
    expect(resolvePercentTargetFrame(n({ value: 0.4, unit: '£' }), undefined)).toEqual({
      verdict: 'refused', frame: undefined, frame_unit: '£',
    });
    expect(resolvePercentTargetFrame(n({ value: 0.4, unit: 'count' }), undefined)).toEqual({
      verdict: 'refused', frame: undefined, frame_unit: 'count',
    });
  });

  it('CONTROL — unframed percent-compatible or unrecognised units keep the legacy [0,100] reading', () => {
    for (const os of [
      { value: 0.04, unit: 'fraction' }, // a fraction level IS percent ÷ 100
      { value: 0.04, unit: '%' },
      { value: 0.07, unit: '% per month' }, // unrecognised spelling, unframed: CEE's "PLoT flags it" shape
      { value: 0.07 }, // the unitless control
    ]) {
      const req = withChurn('lvl4_cap100', { observed_state: os });
      const r = normaliseRow(req);
      expect(sent(r, 'gc_churn'), JSON.stringify(os)).toBeCloseTo(0.1, 12);
      expect(r.refused, JSON.stringify(os)).toEqual([]);
    }
  });

  it("a fractional '%' on an unframed £ target is refused alone AND batched (one predicate)", () => {
    const req = withChurn('lvl4_cap100', { observed_state: { value: 0.4, unit: '£' } });
    const nodes = req.graph.nodes.map(engineNode);
    const frac: GoalConstraint = { constraint_id: 'gc_churn', node_id: 'fac_churn', operator: '<=', value: 0.04 } as GoalConstraint;
    const opener: GoalConstraint = { constraint_id: 'gc_gate_opener', node_id: 'fac_cost', operator: '<=', value: 250000 } as GoalConstraint;
    const units = new Map([['gc_churn', '%']]);
    expect(constraintsNeedPercentTargetFrame([frac], nodes, { unitsByConstraintId: units })).toBe(true);
    for (const batch of [[frac], [frac, opener]]) {
      const r = normaliseGoalConstraints(batch, nodes, {
        unitsByConstraintId: units,
        normaliseWithoutScale: constraintsNeedNormalisation(batch),
      });
      expect(sent(r, 'gc_churn'), `batch of ${batch.length}`).toBeUndefined();
      expect(r.refused.map((x) => [x.constraint_id, x.reason]), `batch of ${batch.length}`).toEqual([
        ['gc_churn', PERCENT_UNIT_DISAGREES_WITH_TARGET_FRAME],
      ]);
    }
  });

  it("a fractional '%' on a PAIR-framed target reads the same alone AND batched (one predicate)", () => {
    const req = withChurn('lvl4_cap20', { observed_state: { value: 0.2, raw_value: 4, unit: '%' } });
    const nodes = req.graph.nodes.map(engineNode);
    const frac: GoalConstraint = { constraint_id: 'gc_churn', node_id: 'fac_churn', operator: '<=', value: 0.04 } as GoalConstraint;
    const opener: GoalConstraint = { constraint_id: 'gc_gate_opener', node_id: 'fac_cost', operator: '<=', value: 250000 } as GoalConstraint;
    const units = new Map([['gc_churn', '%']]);
    expect(constraintsNeedNormalisation([frac])).toBe(false);
    expect(constraintsNeedPercentTargetFrame([frac], nodes, { unitsByConstraintId: units })).toBe(true);
    const alone = normaliseGoalConstraints([frac], nodes, { unitsByConstraintId: units, normaliseWithoutScale: false });
    const batched = normaliseGoalConstraints([frac, opener], nodes, { unitsByConstraintId: units, normaliseWithoutScale: true });
    expect(sent(alone, 'gc_churn')).toBeCloseTo(0.2, 12);
    expect(sent(batched, 'gc_churn')).toBe(sent(alone, 'gc_churn'));
  });
});
