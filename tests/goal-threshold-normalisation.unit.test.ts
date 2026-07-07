/**
 * Unit pins for the P0-C1 goal-threshold normalisation fix.
 *
 * normaliseGoalConstraints() gains two producer-declared constraint scales
 * that outrank the node-derived deriveRange() chain:
 *   0. node goal_threshold_cap (CEE-stamped)      → range [0, cap]
 *   1. constraint unit '%' (house doctrine)       → range [0, 100]
 * and, when the node also carries a CEE-stamped already-normalised
 * goal_threshold that corresponds to the same target, that stamp is PREFERRED
 * over re-normalising the raw client value.
 *
 * filterTemporalConstraints() out-of-domain safety gate: a threshold that
 * normalises INTO [0,1] under one of those declared scales is in-domain and
 * must not be flagged.
 *
 * Legacy behaviour (no declared scale) is pinned unchanged.
 */

import { describe, it, expect } from 'vitest';

import {
  normaliseGoalConstraints,
  isPercentUnit,
  type GoalThresholdNodeMeta,
} from '../src/lib/intervention-normaliser.js';
import { filterTemporalConstraints } from '../src/normalisation/constraint-filter.js';
import type { GoalConstraint, EngineNodeV3, RawGoalConstraint } from '../src/types/engine-v3.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALUELESS_GOAL = [{ id: 'goal', kind: 'goal', label: 'Goal' }] as unknown as EngineNodeV3[];

function constraint(value: number, overrides: Partial<GoalConstraint> = {}): GoalConstraint {
  return { constraint_id: 'c1', node_id: 'goal', operator: '>=', value, ...overrides };
}

function extras(opts: {
  unit?: string;
  meta?: GoalThresholdNodeMeta;
  nodeId?: string;
  constraintId?: string;
}) {
  return {
    ...(opts.unit !== undefined && {
      unitsByConstraintId: new Map([[opts.constraintId ?? 'c1', opts.unit]]),
    }),
    ...(opts.meta !== undefined && {
      goalThresholdMetaByNodeId: new Map([[opts.nodeId ?? 'goal', opts.meta]]),
    }),
  };
}

// ---------------------------------------------------------------------------
// isPercentUnit
// ---------------------------------------------------------------------------

describe('isPercentUnit', () => {
  it('recognises percent spellings, rejects everything else', () => {
    for (const u of ['%', 'percent', 'PCT', ' Percentage ']) {
      expect(isPercentUnit(u), u).toBe(true);
    }
    for (const u of ['months', 'USD', 'points', '', undefined]) {
      expect(isPercentUnit(u as any), String(u)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// normaliseGoalConstraints — producer-declared scales
// ---------------------------------------------------------------------------

describe('normaliseGoalConstraints · producer-declared scales (P0-C1)', () => {
  it("'%' unit normalises against 100 (house doctrine), even on a valueless node", () => {
    const { constraints, diagnostics } = normaliseGoalConstraints(
      [constraint(20)],
      VALUELESS_GOAL,
      extras({ unit: '%' })
    );
    expect(constraints[0].value).toBeCloseTo(0.2, 12);
    expect(constraints[0].original_value).toBe(20);
    expect(diagnostics[0].range).toMatchObject({ min: 0, max: 100, source: 'unit_percent' });
    // Producer-declared scale is NOT a heuristic.
    expect(diagnostics[0].used_heuristic).toBe(false);
  });

  it('node goal_threshold_cap normalises against the cap, and outranks the unit', () => {
    // cap 50 beats '%' → 10/50 = 0.2, not 10/100 = 0.1.
    const { constraints, diagnostics } = normaliseGoalConstraints(
      [constraint(10)],
      VALUELESS_GOAL,
      extras({ unit: '%', meta: { goal_threshold_cap: 50 } })
    );
    expect(constraints[0].value).toBeCloseTo(0.2, 12);
    expect(diagnostics[0].range).toMatchObject({ min: 0, max: 50, source: 'goal_threshold_cap' });
    expect(diagnostics[0].used_heuristic).toBe(false);
  });

  it("PREFERS the node's CEE-stamped goal_threshold when it corresponds to the same target", () => {
    const { constraints, diagnostics, repairs } = normaliseGoalConstraints(
      [constraint(20)],
      VALUELESS_GOAL,
      extras({ unit: '%', meta: { goal_threshold: 0.2, goal_threshold_cap: 100 } })
    );
    // Exactly the stamp — no re-derivation drift.
    expect(constraints[0].value).toBe(0.2);
    expect(diagnostics[0].used_node_goal_threshold).toBe(true);
    expect(repairs[0].reason).toContain('node goal_threshold preferred');
  });

  it('ignores a STALE goal_threshold stamp that does not correspond (user changed the target)', () => {
    const { constraints, diagnostics } = normaliseGoalConstraints(
      [constraint(25)],
      VALUELESS_GOAL,
      extras({ unit: '%', meta: { goal_threshold: 0.2, goal_threshold_cap: 100 } })
    );
    // 25% re-normalised against the cap, NOT overridden by the stale 0.2.
    expect(constraints[0].value).toBeCloseTo(0.25, 12);
    expect(diagnostics[0].used_node_goal_threshold).toBeUndefined();
  });

  it('ignores a goal_threshold stamp outside [0,1] (raw, not normalised)', () => {
    const { constraints, diagnostics } = normaliseGoalConstraints(
      [constraint(20)],
      VALUELESS_GOAL,
      extras({ meta: { goal_threshold: 20, goal_threshold_cap: 100 } })
    );
    expect(constraints[0].value).toBeCloseTo(0.2, 12);
    expect(diagnostics[0].used_node_goal_threshold).toBeUndefined();
  });

  it("'%' outranks node-derived ranges: 50% means 0.5 of the domain, not 50-of-range-units", () => {
    // House doctrine: '%' always normalises against 100. A percent target is a
    // fraction of the node's (normalised) domain, not a raw user-unit value.
    const rangedNode = [
      { id: 'goal', kind: 'goal', label: 'Goal', state_space: { range: { min: 0, max: 200 } } },
    ] as unknown as EngineNodeV3[];
    const { constraints, diagnostics } = normaliseGoalConstraints(
      [constraint(50)],
      rangedNode,
      extras({ unit: '%' })
    );
    expect(constraints[0].value).toBeCloseTo(0.5, 12);
    expect(diagnostics[0].range.source).toBe('unit_percent');
  });
});

// ---------------------------------------------------------------------------
// normaliseGoalConstraints — legacy behaviour unchanged (regression)
// ---------------------------------------------------------------------------

describe('normaliseGoalConstraints · legacy behaviour unchanged', () => {
  it('no extras → identical to before: valueless node falls to default [0,1] and clamps', () => {
    const { constraints, diagnostics, repairs } = normaliseGoalConstraints(
      [constraint(20)],
      VALUELESS_GOAL
    );
    expect(constraints[0].value).toBe(1); // clamped — the pre-fix defect shape
    expect(diagnostics[0].range).toMatchObject({ min: 0, max: 1, source: 'default' });
    expect(diagnostics[0].used_heuristic).toBe(true);
    expect(repairs[0].reason).toContain('source=default');
    expect(repairs[0].reason).toContain('(clamped)');
  });

  it('a non-percent unit does not declare a scale: explicit state_space.range still wins', () => {
    const rangedNode = [
      { id: 'goal', kind: 'goal', label: 'Goal', state_space: { range: { min: 0, max: 40000 } } },
    ] as unknown as EngineNodeV3[];
    const { constraints, diagnostics } = normaliseGoalConstraints(
      [constraint(20000)],
      rangedNode,
      extras({ unit: 'USD' })
    );
    expect(constraints[0].value).toBeCloseTo(0.5, 12);
    expect(diagnostics[0].range.source).toBe('explicit');
  });

  it('a non-positive or non-finite goal_threshold_cap is ignored', () => {
    for (const cap of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { diagnostics } = normaliseGoalConstraints(
        [constraint(20)],
        VALUELESS_GOAL,
        extras({ meta: { goal_threshold_cap: cap } })
      );
      expect(diagnostics[0].range.source, `cap=${cap}`).toBe('default');
    }
  });
});

// ---------------------------------------------------------------------------
// filterTemporalConstraints — out-of-domain gate honours declared scales
// ---------------------------------------------------------------------------

describe('filterTemporalConstraints · out-of-domain gate (P0-C1)', () => {
  const NODES = [{ id: 'goal', kind: 'goal', label: 'Goal' }] as unknown as EngineNodeV3[];

  function raw(value: number, unit?: string): RawGoalConstraint {
    return {
      constraint_id: 'c1', node_id: 'goal', operator: '>=', value,
      ...(unit !== undefined && { unit }),
    } as RawGoalConstraint;
  }

  it("does NOT warn for a '%' threshold within [0,100] — it is in-domain under the declared scale", () => {
    const result = filterTemporalConstraints([raw(20, '%')], NODES);
    expect(result.warnings).toHaveLength(0);
    expect(result.passed).toHaveLength(1); // still forwarded
  });

  it('does NOT warn when the node carries a covering goal_threshold_cap', () => {
    const meta = new Map([['goal', { goal_threshold_cap: 100 }]]);
    const result = filterTemporalConstraints([raw(20, 'points')], NODES, undefined, meta);
    expect(result.warnings).toHaveLength(0);
    expect(result.passed).toHaveLength(1);
  });

  it("STILL warns when the value exceeds the declared cap (150 '%')", () => {
    const result = filterTemporalConstraints([raw(150, '%')], NODES);
    expect(result.warnings).toHaveLength(1);
    expect(result.passed).toHaveLength(1); // warn-and-forward, unchanged
  });

  it('STILL warns when no scale is declared (legacy behaviour)', () => {
    const result = filterTemporalConstraints([raw(20, 'points')], NODES);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].threshold).toBe(20);
    expect(result.passed).toHaveLength(1);
  });

  it('STILL warns for negative thresholds even with a declared scale', () => {
    const result = filterTemporalConstraints([raw(-5, '%')], NODES);
    expect(result.warnings).toHaveLength(1);
  });

  it('temporal drop rules are untouched: deadline_metadata still drops', () => {
    const c = { ...raw(12, 'months'), deadline_metadata: { horizon_months: 12 } } as RawGoalConstraint;
    const result = filterTemporalConstraints([c], NODES);
    expect(result.filtered).toHaveLength(1);
    expect(result.filtered[0].reason).toBe('temporal_deadline');
    expect(result.passed).toHaveLength(0);
  });
});
