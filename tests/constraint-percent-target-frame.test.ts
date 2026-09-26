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
