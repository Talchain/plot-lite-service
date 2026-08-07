/**
 * ROADMAP 2.878 (P0) — A `delta`-FRAMED CONSTRAINT REACHES ISL AS THE QUANTITY
 * THE USER STATED, OR IT DOES NOT REACH ISL AT ALL.
 *
 * THE DEFECT, as measured against this module before the fix. CEE's
 * `extractReductionConstraints` mints `{ operator: '<=', value: -N }` for
 * "reduce X by N" and attests it `'delta'`. PLoT normalised that value through
 * `(v − min) / (max − min)` and clamped to [0,1], so `-0.15` became **0** — and
 * forwarded the `'delta'` attestation with it, unchanged and unflagged. ISL then
 * answers `<= 0` in the delta frame, i.e. **"what is the probability cost falls
 * AT ALL"**, in place of the user's "…falls by at least 15%". It answers with a
 * confident `prob_satisfied` and NO warning, because a frame-faithful `0` is a
 * perfectly well-formed delta — the corruption is invisible at the far end, and
 * `original_value` is a PLoT-internal field the translator never sends.
 *
 * WHY NOTHING WENT RED: no PLoT test covered a negative constraint value, and
 * `constraintsNeedNormalisation` — which uses the negative SIGN as the
 * normalisation TRIGGER — had zero branch coverage. Both are closed here.
 *
 * ⚠ THE INPUT SPACE IS BOUNDED BY THE PRODUCER, NOT BY THIS AUTHOR (trap 16
 * inverse — "a fixture you wrote yourself is not evidence about the wire", and
 * trap 13c — derive the expectation from the producer's declared semantics).
 * `REDUCTION_CONSTRAINT` below reproduces what CEE actually mints, read at the
 * bytes at `olumi-assistants-service@2d29951b`,
 * `src/cee/compound-goal/extractor.ts:468-485`:
 *
 *     operator: "<=",  value: -value,  valueFrame: "delta",  provenance: "explicit"
 *
 * — and its `unit` is **"fraction"**, not "%", because `normaliseConstraintUnits`
 * (same file, ROADMAP 1.52) relabels a "%" unit whose `0 < |value| < 1`. That
 * detail decides which range rung is reachable: `isPercentUnit('fraction')` is
 * FALSE (`PERCENT_UNIT_TOKENS` = ['%','percent','pct','percentage']), so the
 * `unit_percent` [0,100] rung is NOT on this path and the constraint falls
 * through to `deriveRange(node)`. A fixture that used unit "%" would have tested
 * a rung the producer cannot reach.
 *
 * The surrounding constraint shape (label / unit / provenance / confidence /
 * source_quote / constraint_id) matches the real captures in
 * `PHASE0-EVIDENCE-2026-07-28/l60-artefacts/scenario-{people,pricing}.json`.
 * Those captures are also the evidence that every LIVE constraint today is
 * positive and level-shaped (`value: 2` unit "count", `value: 0.8` unit
 * "fraction") — which is exactly why this defect could sit unobserved.
 *
 * Every assertion binds its constraint by `constraint_id` IDENTITY, never by a
 * value predicate another constraint could satisfy (trap 19).
 */

import { describe, it, expect } from 'vitest';

import {
  normaliseGoalConstraints,
  constraintsNeedNormalisation,
} from '../src/lib/intervention-normaliser.js';
import { toISLRobustnessRequest } from '../src/integrations/isl/translator-v3.js';
import type { EngineNodeV3, GoalConstraint } from '../src/types/engine-v3.js';

type RawGoalConstraint = GoalConstraint & Record<string, unknown>;

/**
 * A cost factor with an observed level of 100. `deriveRange` Priority 3
 * (inferred_value) resolves [0, 200] for it — the ordinary, positive-domain
 * shape the overwhelming majority of real graphs present.
 */
const COST_NODE: EngineNodeV3 = {
  id: 'fac_unit_cost',
  kind: 'factor',
  label: 'Unit cost',
  observed_state: { value: 100 },
} as unknown as EngineNodeV3;

/**
 * A factor whose observed level is NEGATIVE. `deriveRange` Priority 3 is
 * sign-preserving (D-9), so this resolves [-1, 0] — a range whose floor is below
 * a `-0.15` delta, which therefore does NOT clamp. It is the second, independent
 * corruption: the affine map's translation term (`− min`) is meaningless on a
 * DIFFERENCE, and turns -0.15 into +0.85 with `clamped: false`.
 */
const SIGNED_NODE: EngineNodeV3 = {
  id: 'fac_net_margin_delta',
  kind: 'factor',
  label: 'Net margin change',
  observed_state: { value: -0.5 },
} as unknown as EngineNodeV3;

const NODES: EngineNodeV3[] = [COST_NODE, SIGNED_NODE];

/**
 * What CEE mints for "reduce unit cost by 15%" — see the header for the byte
 * provenance of every field.
 */
const REDUCTION_CONSTRAINT = (over: Partial<RawGoalConstraint> = {}): RawGoalConstraint =>
  ({
    constraint_id: 'gc-reduce-unit-cost',
    node_id: 'fac_unit_cost',
    operator: '<=',
    value: -0.15,
    value_frame: 'delta',
    unit: 'fraction',
    label: 'Unit cost down by 15%',
    source_quote: 'reduce unit cost by 15%',
    confidence: 0.85,
    provenance: 'explicit',
    ...over,
  }) as RawGoalConstraint;

// -----------------------------------------------------------------------------
// 1. The P0 itself, at the producer's own shape
// -----------------------------------------------------------------------------

describe("2.878 — a 'delta' whose value normalisation would ALTER is refused, not forwarded", () => {
  it('DEFECT: the reduction constraint CEE mints is NOT forwarded to ISL', () => {
    const out = normaliseGoalConstraints([REDUCTION_CONSTRAINT()], NODES);

    // Bind by identity — not by "the list is empty", which a different bug
    // (dropping every constraint) would also satisfy.
    const forwarded = out.constraints.find((c) => c.constraint_id === 'gc-reduce-unit-cost');
    expect(forwarded).toBeUndefined();
  });

  it('DEFECT: the refusal names the constraint, the stated quantity, and the number it replaced it with', () => {
    const out = normaliseGoalConstraints([REDUCTION_CONSTRAINT()], NODES);

    const refusal = out.refused.find((r) => r.constraint_id === 'gc-reduce-unit-cost');
    expect(refusal).toBeDefined();
    expect(refusal!.reason).toBe('delta_frame_value_altered_by_normalisation');
    expect(refusal!.node_id).toBe('fac_unit_cost');

    // The user's quantity, byte-identical.
    expect(refusal!.stated_value).toBe(-0.15);

    // ⚠ THE DEFECT NUMBER, PINNED. This is precisely what shipped: `0`, an
    // attested delta meaning "changes by at most nothing" — the probability
    // cost falls AT ALL. If this expectation ever stops being 0, the clamp
    // arithmetic moved and this whole file needs re-deriving.
    expect(refusal!.would_have_sent).toBe(0);

    // And the range that produced it — the ordinary positive-domain rung.
    expect(refusal!.range).toEqual({ min: 0, max: 200, source: 'inferred_value' });
  });

  it('DEFECT: the refused constraint never reaches the ISL wire', () => {
    const out = normaliseGoalConstraints([REDUCTION_CONSTRAINT()], NODES);

    const request = toISLRobustnessRequest(
      { nodes: NODES, edges: [] } as never,
      [{ id: 'opt_a', interventions: {} }] as never,
      'fac_unit_cost',
      'req-2878',
      100,
      undefined,
      out.constraints,
    );

    // The whole key is omitted when nothing survives — but assert the ABSENCE of
    // THIS constraint by identity, so a future run carrying other constraints
    // still fails if this one slips through.
    const sent = (request.goal_constraints ?? []).find(
      (c) => c.constraint_id === 'gc-reduce-unit-cost',
    );
    expect(sent).toBeUndefined();
  });

  it('DEFECT: a `removed` repair record discloses the refusal in the audit ledger', () => {
    const out = normaliseGoalConstraints([REDUCTION_CONSTRAINT()], NODES);

    const repair = out.repairs.find((r) => r.field === 'constraint.value.gc-reduce-unit-cost');
    expect(repair).toBeDefined();
    expect(repair!.action).toBe('removed');
    expect(repair!.from_value).toBe(-0.15);
    // Not a 'normalised' repair claiming a successful conversion.
    expect(repair!.to_value).toBe('refused');
  });

  it('DEFECT: a refused constraint emits NO normalisation diagnostic — it has no scale to disclose', () => {
    const out = normaliseGoalConstraints([REDUCTION_CONSTRAINT()], NODES);

    const diag = out.diagnostics.find((d) => d.constraint_id === 'gc-reduce-unit-cost');
    expect(diag).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// 2. The second corruption: the translation term, with NO clamp
// -----------------------------------------------------------------------------

describe('2.878 — the guard is on the OUTCOME, so it also catches the un-clamped corruption', () => {
  it('DEFECT: a delta against a sign-preserving range is refused even though it never clamped', () => {
    const c = REDUCTION_CONSTRAINT({
      constraint_id: 'gc-reduce-margin',
      node_id: 'fac_net_margin_delta',
    });
    const out = normaliseGoalConstraints([c], NODES);

    expect(out.constraints.find((x) => x.constraint_id === 'gc-reduce-margin')).toBeUndefined();

    const refusal = out.refused.find((r) => r.constraint_id === 'gc-reduce-margin');
    expect(refusal).toBeDefined();
    expect(refusal!.stated_value).toBe(-0.15);

    // (-0.15 − (−1)) / (0 − (−1)) = 0.85. A POSITIVE number, in place of a
    // reduction, with `clamped` FALSE — so a guard keyed on `clamped` would
    // have missed this entirely. That is why the predicate is "the value
    // changed", not "the value was clamped".
    expect(refusal!.would_have_sent).toBeCloseTo(0.85, 10);
    expect(refusal!.range).toEqual({ min: -1, max: 0, source: 'inferred_value' });
  });
});

describe('2.878 F2 — the affine map has FIXED POINTS, so the outcome test alone is not enough', () => {
  it('DEFECT: a delta CLAMPED onto its own stated value is still refused', () => {
    // ⚠ THE COUNTER-EXAMPLE THAT REFUTED "an outcome test cannot be escaped".
    // Range [0, 0.5], delta 1: raw = (1 − 0)/0.5 = 2, clamped DOWN to 1 — so
    // `normalised === value` and the outcome test does NOT fire, while the
    // quantity has been HALVED and ships with the 'delta' attestation intact.
    // Identity of the OUTPUT does not imply identity of the TRANSFORM.
    // This is the arm `|| clamped` exists for; delete it and this test alone
    // goes red while every other test in the file stays green.
    const node = {
      id: 'fac_narrow',
      kind: 'factor',
      label: 'Narrow-domain factor',
      // observed 0.25 ⇒ inferred_value range [0, 0.5], width 0.5.
      observed_state: { value: 0.25 },
    } as unknown as EngineNodeV3;

    const c = REDUCTION_CONSTRAINT({
      constraint_id: 'gc-fixed-point',
      node_id: 'fac_narrow',
      operator: '>=',
      value: 1,
    });
    const out = normaliseGoalConstraints([c], [node]);

    const refusal = out.refused.find((r) => r.constraint_id === 'gc-fixed-point');
    expect(refusal).toBeDefined();
    expect(refusal!.stated_value).toBe(1);

    // The tell: the substituted number EQUALS the stated one, which is exactly
    // why `normalised !== value` is blind here.
    expect(refusal!.would_have_sent).toBe(1);
    expect(refusal!.range).toEqual({ min: 0, max: 0.5, source: 'inferred_value' });

    expect(out.constraints.find((x) => x.constraint_id === 'gc-fixed-point')).toBeUndefined();
  });

  it('PIN: the added `clamped` arm does not catch an UN-clamped faithful delta', () => {
    // The other half of F2's discrimination — widening the predicate must not
    // start refusing deltas that pass through untouched.
    const c = REDUCTION_CONSTRAINT({
      constraint_id: 'gc-still-faithful',
      node_id: 'node_not_in_graph',
      operator: '>=',
      value: 0.05,
    });
    const out = normaliseGoalConstraints([c], NODES);

    expect(out.refused).toHaveLength(0);
    expect(out.constraints.find((x) => x.constraint_id === 'gc-still-faithful')!.value).toBe(0.05);
  });
});

describe('2.878 — the guard is not a SIGN check: the positive half of the delta domain', () => {
  it('DEFECT: a POSITIVE delta that normalisation rescales is refused too — the guard is not a sign check', () => {
    // AUDIT THE PREDICATE'S DOMAIN, not just the named case. The reduction
    // constraint is negative, so a guard written as `value < 0` would pass every
    // other test in this file while leaving the whole positive half of the delta
    // domain unguarded. "increase throughput by 0.05" against the cost node's
    // [0,200] scale is substituted by 0.00025.
    //
    // ⚠ THAT SUBSTITUTION IS NOT A MEASURED ERROR, AND AN EARLIER VERSION OF
    // THIS COMMENT CALLED IT "a 200x understatement, silently". Withdrawn: for
    // any min-0 range the map reduces to `v / width`, which IS the correct
    // NORMALISED-SPACE delta — so the number is only wrong under the RAW-UNIT
    // reading, and `intervention-normaliser.ts` states that which reading ISL
    // takes is NOT established at the bytes. It is **unverifiable in either
    // direction**, which is precisely why refusing is right: under genuine
    // uncertainty a gap beats a number nobody can check.
    //
    // The point this test actually makes is therefore about the PREDICATE, not
    // about the magnitude: a sign-keyed guard would not fire here at all, so
    // half the delta domain would pass through unexamined.
    const c = REDUCTION_CONSTRAINT({
      constraint_id: 'gc-increase-positive-delta',
      operator: '>=',
      value: 0.05,
    });
    const out = normaliseGoalConstraints([c], NODES);

    expect(out.constraints.find((x) => x.constraint_id === 'gc-increase-positive-delta')).toBeUndefined();

    const refusal = out.refused.find((r) => r.constraint_id === 'gc-increase-positive-delta');
    expect(refusal).toBeDefined();
    expect(refusal!.stated_value).toBe(0.05);
    expect(refusal!.would_have_sent).toBeCloseTo(0.00025, 12);
  });
});

// -----------------------------------------------------------------------------
// 3. The discrimination: a FAITHFUL delta is forwarded, untouched
// -----------------------------------------------------------------------------

describe('2.878 — a delta normalisation does NOT alter is forwarded, frame intact', () => {
  it('PIN: an identity range leaves the value alone, so the constraint delivers', () => {
    // No matching node ⇒ range default [0,1] ⇒ (v − 0) / 1 === v exactly.
    const c = REDUCTION_CONSTRAINT({
      constraint_id: 'gc-faithful-delta',
      node_id: 'node_not_in_graph',
      operator: '>=',
      value: 0.05,
    });
    const out = normaliseGoalConstraints([c], NODES);

    expect(out.refused).toHaveLength(0);

    const forwarded = out.constraints.find((x) => x.constraint_id === 'gc-faithful-delta');
    expect(forwarded).toBeDefined();
    expect(forwarded!.value).toBe(0.05);
    // The attestation rides through unchanged — this fix must not become a
    // reason the frame stops being forwarded (that would silently re-open
    // 2.855 by deleting every constraint's analysis block at ISL).
    expect(forwarded!.value_frame).toBe('delta');
  });

  it('PIN: the forward-raw branch (gate FALSE, no intervention scale) is an identity, so it is not refused', () => {
    const c = REDUCTION_CONSTRAINT({
      constraint_id: 'gc-forward-raw',
      node_id: 'fac_unit_cost',
      operator: '>=',
      value: 0.42,
    });
    const out = normaliseGoalConstraints([c], NODES, { normaliseWithoutScale: false });

    expect(out.refused).toHaveLength(0);
    const forwarded = out.constraints.find((x) => x.constraint_id === 'gc-forward-raw');
    expect(forwarded!.value).toBe(0.42);
    expect(forwarded!.value_frame).toBe('delta');
  });

  it('THE DISCRIMINATING PAIR, in one call: the altered delta is refused and the faithful one is not', () => {
    // Both are `delta`. Both are negative-or-not is irrelevant. The ONLY thing
    // that differs is whether normalisation moved the number. A guard that
    // refused "all deltas", or "all negatives", or "all clamped", would fail
    // this test — it is what binds the guard to its actual invariant.
    const altered = REDUCTION_CONSTRAINT({ constraint_id: 'gc-altered' });
    const faithful = REDUCTION_CONSTRAINT({
      constraint_id: 'gc-faithful',
      node_id: 'node_not_in_graph',
      operator: '>=',
      value: 0.05,
    });

    const out = normaliseGoalConstraints([altered, faithful], NODES);

    expect(out.refused.map((r) => r.constraint_id)).toEqual(['gc-altered']);
    expect(out.constraints.map((c) => c.constraint_id)).toEqual(['gc-faithful']);
  });
});

// -----------------------------------------------------------------------------
// 4. The clamp is UNCHANGED for the purpose it was built for
// -----------------------------------------------------------------------------

describe('2.878 — a LEVEL still clamps and still delivers (the clamp is a domain guard, not a bug)', () => {
  it('PIN: a level below the range floor is clamped to 0 and FORWARDED, exactly as before', () => {
    const c = REDUCTION_CONSTRAINT({
      constraint_id: 'gc-level-below-floor',
      value_frame: 'level',
    });
    const out = normaliseGoalConstraints([c], NODES);

    expect(out.refused).toHaveLength(0);

    const forwarded = out.constraints.find((x) => x.constraint_id === 'gc-level-below-floor');
    expect(forwarded).toBeDefined();
    expect(forwarded!.value).toBe(0);
    expect(forwarded!.original_value).toBe(-0.15);
    expect(forwarded!.value_frame).toBe('level');

    // And the clamp signal downstream depends on is still recorded.
    const diag = out.diagnostics.find((d) => d.constraint_id === 'gc-level-below-floor');
    expect(diag!.clamped).toBe(true);
    expect(diag!.normalised_value).toBe(0);
  });

  it('PIN: a level above the range ceiling is clamped to 1 and FORWARDED', () => {
    const c = REDUCTION_CONSTRAINT({
      constraint_id: 'gc-level-above-ceiling',
      operator: '>=',
      value: 500,
      value_frame: 'level',
    });
    const out = normaliseGoalConstraints([c], NODES);

    expect(out.refused).toHaveLength(0);
    const forwarded = out.constraints.find((x) => x.constraint_id === 'gc-level-above-ceiling');
    expect(forwarded!.value).toBe(1);
    const diag = out.diagnostics.find((d) => d.constraint_id === 'gc-level-above-ceiling');
    expect(diag!.clamped).toBe(true);
  });

  it('PIN: an UNATTESTED constraint is untouched by this guard — PLoT never infers a frame', () => {
    // Inferring `delta` from (operator '<=', negative value) is exactly the
    // guess CEE #862 refused to make, on the grounds that `<=` with a POSITIVE
    // value is a level. PLoT must not make it either. This one still normalises
    // to 0 and is still forwarded; ISL fail-closes it on the missing frame with
    // a named reason, which is the honest disposal for an unattested number.
    const c = REDUCTION_CONSTRAINT({ constraint_id: 'gc-unattested' });
    delete (c as Record<string, unknown>).value_frame;

    const out = normaliseGoalConstraints([c], NODES);

    expect(out.refused).toHaveLength(0);
    const forwarded = out.constraints.find((x) => x.constraint_id === 'gc-unattested');
    expect(forwarded).toBeDefined();
    expect(forwarded!.value).toBe(0);
    expect('value_frame' in forwarded!).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// 5. `constraintsNeedNormalisation` — the zero-branch-coverage trigger site
// -----------------------------------------------------------------------------

describe('2.878 — constraintsNeedNormalisation: the site whose negative branch had no coverage', () => {
  const at = (value: number, constraint_id = 'gc-probe'): GoalConstraint =>
    ({ constraint_id, node_id: 'fac_unit_cost', operator: '<=', value }) as GoalConstraint;

  it('fires on a NEGATIVE value — the branch that made the reduction constraint normalise at all', () => {
    expect(constraintsNeedNormalisation([at(-0.15)])).toBe(true);
  });

  it('fires on a value ABOVE 1', () => {
    expect(constraintsNeedNormalisation([at(1.000001)])).toBe(true);
    expect(constraintsNeedNormalisation([at(200)])).toBe(true);
  });

  it('does NOT fire at either boundary — 0 and 1 are inside [0,1]', () => {
    expect(constraintsNeedNormalisation([at(0)])).toBe(false);
    expect(constraintsNeedNormalisation([at(1)])).toBe(false);
  });

  it('does NOT fire strictly inside the range', () => {
    expect(constraintsNeedNormalisation([at(0.5)])).toBe(false);
  });

  it('does NOT fire on an empty list', () => {
    expect(constraintsNeedNormalisation([])).toBe(false);
  });

  it('fires when ANY member is out of range, not only the first', () => {
    expect(constraintsNeedNormalisation([at(0.5, 'a'), at(-0.15, 'b')])).toBe(true);
    expect(constraintsNeedNormalisation([at(-0.15, 'a'), at(0.5, 'b')])).toBe(true);
  });

  it('does not fire when EVERY member is in range', () => {
    expect(constraintsNeedNormalisation([at(0, 'a'), at(0.5, 'b'), at(1, 'c')])).toBe(false);
  });
});
