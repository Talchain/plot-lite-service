/**
 * ROADMAP 2.957 — A '%' THRESHOLD MUST NOT MEAN TWO DIFFERENT THINGS DEPENDING
 * ON WHAT ELSE IS IN THE REQUEST.
 *
 * THE DEFECT, measured at `519d3111` / `747a3aa4`:
 *
 *   `normaliseGoalConstraints`' `unit_percent` rung resolved `[0,100]`
 *   UNCONDITIONALLY. The route only invokes the normaliser when
 *   `constraintsNeedNormalisation` fires (`value < 0 || value > 1`) or some node
 *   carries a non-identity intervention scale. So for `{unit:'%', value:0.04}`:
 *
 *     alone (gate closed)                   → forwarded raw as 0.04   ✅ correct
 *     batched with any out-of-range row     → 0.04/100 = **0.0004**   ❌ 100× low
 *
 *   One constraint, two meanings, decided by an UNRELATED constraint's value.
 *
 * WHICH ARM IS WRONG IS SETTLED BY THE PRODUCER, NOT BY PLoT (trap 13c). CEE's
 * LLM extractor emits **"4%" as `value: 0.04, unit: "%"`** — a FRACTION under a
 * `'%'` label — and says so in the comment on the very function written to stop
 * a consumer misreading it (`olumi-assistants-service`,
 * `src/cee/compound-goal/extractor.ts:925-934`):
 *
 *     "If a consumer interprets unit: "%" as "value is percentage points",
 *      0.04% ≠ 4%. … Rule: if unit === "%" and 0 < value < 1 → already
 *      fractional → unit = "fraction"."
 *
 * It relabels WITHOUT dividing, and it runs only on the REGEX branch
 * (`stages/repair/compound-goals.ts`; the LLM branch below it does not call it),
 * so a fractional value under a raw `'%'` label reaches PLoT on the primary
 * draft path. The `>= 1` half is CEE's too, pinned in its own suite
 * (`tests/unit/cee.constraint-unit-normalisation.test.ts`): *"preserves
 * percentage-unit constraints where value >= 1 (already in pp form) —
 * value: 4, unit: "%" means 4 percentage points"*.
 *
 * ⚠ AN EARLIER REVISION OF THIS ROW WENT THE OTHER WAY and was refuted at the
 * producer's bytes: it read `'%'` as always-percentage-points and rescaled the
 * sub-1 cell, which would have turned `0.04` into `0.0004` on the one path that
 * was still correct. It passed a 6-mutant kit — against the wrong oracle. The
 * expectations below are therefore derived from CEE's rule, not from PLoT's
 * contract line, which does not settle which scale `'%'` denotes.
 *
 * THE PROPERTY THIS FILE PINS IS **BATCH-INVARIANCE**: the value PLoT sends for
 * a constraint is a function of that constraint alone.
 */

import { describe, it, expect } from 'vitest';
import {
  normaliseGoalConstraints,
  constraintsNeedNormalisation,
  constraintsHavePercentPointValue,
  isPercentUnit,
} from '../src/lib/intervention-normaliser.js';
import { PERCENT_UNIT_TOKENS } from '../src/lib/constraint-units.js';
import type { EngineNodeV3, GoalConstraint } from '../src/types/engine-v3.js';

/**
 * Capless, rangeless factor nodes: `deriveRange` lands on the `default` rung, so
 * nothing on the NODE can supply a scale and any answer must come from the
 * constraint's own unit + value.
 */
const CHURN = { id: 'n_churn', label: 'Churn rate', type: 'factor' } as unknown as EngineNodeV3;
const COST = { id: 'n_cost', label: 'Unit cost', type: 'factor' } as unknown as EngineNodeV3;
const NODES: EngineNodeV3[] = [CHURN, COST];

function constraint(
  constraint_id: string,
  value: number,
  node_id = 'n_churn',
  extra: Partial<GoalConstraint> = {},
): GoalConstraint {
  return { constraint_id, node_id, operator: '<=', value, ...extra } as GoalConstraint;
}

function units(pairs: Array<[string, string]>): Map<string, string> {
  return new Map(pairs);
}

/** A batch-mate whose only job is to open the legacy gate. NOT percent. */
const GATE_OPENER = constraint('c_gate_opener', 50_000, 'n_cost');

/**
 * Send `c` through the normaliser the way the route would, deriving
 * `normaliseWithoutScale` from the real gate over the whole batch — so the
 * fixture cannot silently stop reproducing the gate state it names.
 */
function sendBatch(batch: GoalConstraint[], unitPairs: Array<[string, string]>) {
  return normaliseGoalConstraints(batch, NODES, {
    unitsByConstraintId: units(unitPairs),
    normaliseWithoutScale: constraintsNeedNormalisation(batch),
  });
}

/** The value that would reach ISL for `id`, or `undefined` if it was refused. */
function wire(result: ReturnType<typeof normaliseGoalConstraints>, id: string) {
  return result.constraints.find((c) => c.constraint_id === id)?.value;
}

// =============================================================================
// 1. THE PIN — batch-invariance, and the producer's two cases
// =============================================================================

describe('2.957 — a % threshold means the same thing alone and in company', () => {
  it('the legacy gate is value-based and blind to units (unchanged, pinned for scope)', () => {
    expect(constraintsNeedNormalisation([constraint('c', 0.04)])).toBe(false);
    expect(constraintsNeedNormalisation([constraint('c', 0.04), GATE_OPENER])).toBe(true);
    // value === 1 opens NOTHING — the cell the route disjunct exists for.
    expect(constraintsNeedNormalisation([constraint('c', 1)])).toBe(false);
  });

  it("PIN: 0.04 with unit '%' is FOUR PERCENT — it stays 0.04, batched or not", () => {
    // The producer's own canonical example. Pre-fix this was 0.0004 in the
    // batched arm — a hundredfold understatement of the user's target.
    const alone = sendBatch([constraint('c_frac', 0.04)], [['c_frac', '%']]);
    const batched = sendBatch(
      [constraint('c_frac', 0.04), GATE_OPENER],
      [['c_frac', '%']],
    );

    expect(wire(alone, 'c_frac')).toBeCloseTo(0.04, 12);
    expect(wire(batched, 'c_frac')).toBeCloseTo(0.04, 12);
    // Named explicitly so a regression to the refuted direction is unmistakable.
    expect(wire(batched, 'c_frac')).not.toBeCloseTo(0.0004, 12);
  });

  it("PIN: 40 with unit '%' is FORTY PERCENT — it becomes 0.4, batched or not", () => {
    const alone = sendBatch([constraint('c_pp', 40)], [['c_pp', '%']]);
    const batched = sendBatch([constraint('c_pp', 40), GATE_OPENER], [['c_pp', '%']]);

    expect(wire(alone, 'c_pp')).toBeCloseTo(0.4, 12);
    expect(wire(batched, 'c_pp')).toBeCloseTo(0.4, 12);
  });

  it('PIN: BATCH-INVARIANCE as a property, swept across the producer\'s range', () => {
    // The whole row in one assertion: the value sent for a constraint is a
    // function of THAT CONSTRAINT ALONE. Swept across both sides of CEE's
    // boundary and both sides of the legacy gate's boundary.
    const cases: Array<[string, number]> = [
      ['c_p_0', 0],
      ['c_p_0004', 0.004],
      ['c_p_004', 0.04],
      ['c_p_09', 0.9],
      ['c_p_1', 1],       // the cell the route disjunct closes
      ['c_p_4', 4],
      ['c_p_40', 40],
      ['c_p_100', 100],
    ];
    for (const [id, value] of cases) {
      const alone = sendBatch([constraint(id, value)], [[id, '%']]);
      const batched = sendBatch([constraint(id, value), GATE_OPENER], [[id, '%']]);
      expect(wire(alone, id), `${id} (${value}%) alone`).toBe(wire(batched, id));
    }
  });

  it('PIN: the producer boundary is reproduced exactly — <1 fractional, >=1 percentage points', () => {
    const expectations: Array<[string, number, number]> = [
      // id, stated value, value sent to ISL
      ['c_b_0', 0, 0],           // 0 is 0 on either reading
      ['c_b_003', 0.03, 0.03],   // "3% churn" as CEE's LLM emits it
      ['c_b_099', 0.99, 0.99],   // still fractional
      ['c_b_1', 1, 0.01],        // >= 1 ⇒ ONE percentage point
      ['c_b_4', 4, 0.04],        // CEE's own pinned example
      ['c_b_100', 100, 1],       // full scale
    ];
    for (const [id, value, expected] of expectations) {
      const r = sendBatch([constraint(id, value), GATE_OPENER], [[id, '%']]);
      expect(wire(r, id), `${id}: ${value} '%' → ${expected}`).toBeCloseTo(expected, 12);
    }
  });

  it('every token in the canonical percent vocabulary behaves identically (derived, not mirrored)', () => {
    expect(PERCENT_UNIT_TOKENS.length).toBeGreaterThan(0);
    for (const token of PERCENT_UNIT_TOKENS) {
      const fracId = `c_tok_frac_${token}`;
      const ppId = `c_tok_pp_${token}`;
      const frac = sendBatch([constraint(fracId, 0.04), GATE_OPENER], [[fracId, token]]);
      const pp = sendBatch([constraint(ppId, 40), GATE_OPENER], [[ppId, token]]);
      expect(wire(frac, fracId), `'${token}' fractional`).toBeCloseTo(0.04, 12);
      expect(wire(pp, ppId), `'${token}' percentage points`).toBeCloseTo(0.4, 12);
    }
  });

  it('the invocation predicate fires only for percentage-POINT values, by constraint identity', () => {
    const pp = constraint('c_pp', 1);
    const frac = constraint('c_frac', 0.04);
    expect(constraintsHavePercentPointValue([pp], units([['c_pp', '%']]))).toBe(true);
    // A fractional '%' needs no forced invocation — the rung already agrees
    // with the forwarded-raw value there.
    expect(constraintsHavePercentPointValue([frac], units([['c_frac', '%']]))).toBe(false);
    // Non-percent unit at the same magnitude must NOT fire.
    expect(constraintsHavePercentPointValue([pp], units([['c_pp', 'count']]))).toBe(false);
    // Identity-bound: a percent unit registered under ANOTHER id is not evidence.
    expect(constraintsHavePercentPointValue([pp], units([['c_somebody_else', '%']]))).toBe(false);
    expect(constraintsHavePercentPointValue([pp], undefined)).toBe(false);
    expect(constraintsHavePercentPointValue([pp], new Map())).toBe(false);
  });
});

// =============================================================================
// 2. CONTROLS — the currently-correct cells, which must not move
// =============================================================================

describe('2.957 controls — behaviours that MUST NOT change', () => {
  it('CONTROL: a NON-percent sub-1 row on a scale-less node is still forwarded RAW, no diagnostic', () => {
    const r = normaliseGoalConstraints(
      [constraint('c_plain', 0.5), constraint('c_count', 0.5, 'n_cost')],
      NODES,
      { unitsByConstraintId: units([['c_count', 'count']]), normaliseWithoutScale: false },
    );
    expect(wire(r, 'c_plain')).toBe(0.5);
    expect(wire(r, 'c_count')).toBe(0.5);
    expect(r.diagnostics).toHaveLength(0);
    expect(r.repairs).toHaveLength(0);
  });

  it('CONTROL: rung precedence unchanged — goal_threshold_cap (3) outranks unit_percent (4)', () => {
    const r = normaliseGoalConstraints([constraint('c_pct', 4)], NODES, {
      unitsByConstraintId: units([['c_pct', '%']]),
      goalThresholdMetaByNodeId: new Map([['n_churn', { goal_threshold_cap: 10 }]]) as never,
      normaliseWithoutScale: true,
    });
    expect(r.diagnostics[0].range).toEqual({ min: 0, max: 10, source: 'goal_threshold_cap' });
    expect(wire(r, 'c_pct')).toBeCloseTo(0.4, 12);
  });

  it('CONTROL: rung precedence unchanged — a MEASURED (non-identity) intervention scale (1) wins', () => {
    const r = normaliseGoalConstraints([constraint('c_pct', 4)], NODES, {
      unitsByConstraintId: units([['c_pct', '%']]),
      interventionScaleByNodeId: new Map([
        ['n_churn', { min: 0, max: 5, source: 'inferred_spread' as const }],
      ]),
      normaliseWithoutScale: true,
    });
    expect(r.diagnostics[0].range).toEqual({ min: 0, max: 5, source: 'inferred_spread' });
    expect(wire(r, 'c_pct')).toBeCloseTo(0.8, 12);
  });

  it('CONTROL: rung precedence unchanged — unit_percent (4) outranks an IDENTITY intervention scale (5)', () => {
    const r = normaliseGoalConstraints([constraint('c_pct', 4)], NODES, {
      unitsByConstraintId: units([['c_pct', '%']]),
      interventionScaleByNodeId: new Map([
        ['n_churn', { min: 0, max: 1, source: 'default' as const }],
      ]),
      normaliseWithoutScale: true,
    });
    expect(r.diagnostics[0].range.source).toBe('unit_percent');
    expect(wire(r, 'c_pct')).toBeCloseTo(0.04, 12);
  });

  it('CONTROL: a >100 %-unit row still clamps to 1 and still reports clamped:true', () => {
    const r = sendBatch([constraint('c_over', 140)], [['c_over', '%']]);
    expect(wire(r, 'c_over')).toBe(1);
    expect(r.diagnostics[0].clamped).toBe(true);
  });

  it('CONTROL: a percentage-POINT row still discloses the [0,100] producer scale', () => {
    const r = sendBatch([constraint('c_pp', 40)], [['c_pp', '%']]);
    const d = r.diagnostics.find((x) => x.constraint_id === 'c_pp')!;
    expect(d.range).toEqual({ min: 0, max: 100, source: 'unit_percent' });
    expect(d.used_heuristic).toBe(false);
  });

  it('CONTROL: a FRACTIONAL row discloses unit_percent too — a real producer scale, not "default"', () => {
    // It is normalised against the identity range, so the VALUE is unchanged,
    // but the provenance records that the '%' rung decided it — which keeps it
    // decision-grade rather than disclosing as an evidence-free `default`.
    const r = sendBatch([constraint('c_frac', 0.04), GATE_OPENER], [['c_frac', '%']]);
    const d = r.diagnostics.find((x) => x.constraint_id === 'c_frac')!;
    expect(d.range).toEqual({ min: 0, max: 1, source: 'unit_percent' });
    expect(d.clamped).toBe(false);
  });

  it('CONTROL: isPercentUnit unchanged; rejects non-percent tokens', () => {
    expect(isPercentUnit('%')).toBe(true);
    expect(isPercentUnit('count')).toBe(false);
    expect(isPercentUnit('months')).toBe(false);
    expect(isPercentUnit('fraction')).toBe(false);
    expect(isPercentUnit(undefined)).toBe(false);
  });

  it('CONTROL: a negative percentage-point delta still resolves on [0,100] as before', () => {
    // "reduce churn by 33 percentage points" — |−33| >= 1 ⇒ pp form, unchanged.
    const r = sendBatch([constraint('c_neg', -33)], [['c_neg', '%']]);
    const d = r.diagnostics.find((x) => x.constraint_id === 'c_neg')!;
    expect(d.range).toEqual({ min: 0, max: 100, source: 'unit_percent' });
  });
});
