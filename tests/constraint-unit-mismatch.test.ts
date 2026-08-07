/**
 * THE GOAL-FIT UNIT COLLISION — a constraint threshold must not be normalised
 * against a scale whose unit it does not share.
 *
 * WITNESSED, at the bytes, in a REAL staging capture — not in a fixture anyone
 * wrote for this test. Decision `7fe412ba`, run 3
 * (`PHASE0-EVIDENCE-2026-07-28/l60-artefacts/scenario-people.json` for the
 * persisted graph, `runfact-7fe412ba-run3.json` for the response):
 *
 *   goal_constraints[0] = { constraint_id: 'gc-e9543857-…', node_id:
 *                           'risk_ae_attrition', operator: '<=', value: 2,
 *                           unit: 'count', label: 'Account executives lost' }
 *   node risk_ae_attrition.observed_state
 *                        = { cap: 100, unit: '%', value: 0.2, raw_value: 20 }
 *   constraint_results[0].scale_provenance
 *                        = { source: 'explicit_cap', range_unified: true,
 *                            decision_grade: TRUE }
 *   constraint_results[0].probability = 0   (every option)
 *
 * `deriveRange` took Priority 0 (`observed_state.cap`) → `[0,100]`;
 * `normaliseValue(2, [0,100])` → **0.02**. "Lose at most 2 account executives"
 * — a COUNT of people — went onto the wire as "attrition at or below 2%": a
 * target about a different quantity, roughly ten times stricter, whose samples'
 * median was 0.20002 so the probability was arithmetically forced to zero. And
 * it shipped carrying `decision_grade: true`, the product's highest-confidence
 * badge.
 *
 * ⚠ WHY EVERY PRE-EXISTING GUARD MISSES IT — this is the property under test,
 * not background. `explicit_cap` is a REAL producer declaration, so
 * `threshold_normalisation_defaulted` never fires. It is a member of
 * `DECISION_GRADE_SOURCES`, the range was unified and the threshold did not
 * clamp, so all three original `decision_grade` conjuncts held. And the L63
 * anchor gate's `root_observed_level` limb PROVES a sample frame for any ROOT
 * target carrying an observed value — proving nothing at all about the unit.
 * A whitelist cannot catch a question it does not ask.
 *
 * TWO SEPARABLE INVARIANTS, TWO SETS OF TESTS. Reconciling the units and gating
 * the badge are different obligations: a fix that only refuses to deliver still
 * leaves the badge stamped on the wire for any future delivery exception, and a
 * fix that only gates the badge still ships the fabricated zero. Both are
 * asserted below, independently.
 *
 * BINDING: every assertion finds its object by IDENTITY — `constraint_id`,
 * `node_id`, `option_id` — never by a value predicate a sibling could satisfy.
 * The sibling constraints in these fixtures exist precisely so that a guard
 * loosened for the wrong object shows up as a GREEN where a RED was expected.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import {
  normaliseGoalConstraints,
  isPercentUnit,
} from '../src/lib/intervention-normaliser.js';
import {
  classifyUnitCompatibility,
  unitsReconcilable,
  canonicaliseUnit,
  unitDimension,
  UNIT_SCALES,
  unitTokensForScale,
  dimensionOfScale,
} from '../src/lib/constraint-units.js';
import {
  detectUnitMismatchedConstraintTargets,
  partitionConstraintTargets,
  buildConstraintTargetUnreliableMessage,
} from '../src/lib/constraint-reliability.js';
import type { EngineNodeV3, GoalConstraint } from '../src/types/engine-v3.js';

// ---------------------------------------------------------------------------
// THE REAL CAPTURE, transcribed field-for-field. Nothing here is invented.
// ---------------------------------------------------------------------------

const CAPTURED_CONSTRAINT_ID = 'gc-e9543857-e145-4ed5-a729-905529d9b0dd';
const CAPTURED_NODE_ID = 'risk_ae_attrition';
const CAPTURED_CONSTRAINT_UNIT = 'count';

const CAPTURED_CONSTRAINT: GoalConstraint = {
  constraint_id: CAPTURED_CONSTRAINT_ID,
  node_id: CAPTURED_NODE_ID,
  operator: '<=',
  value: 2,
  label: 'Account executives lost',
};

const CAPTURED_NODE = {
  id: CAPTURED_NODE_ID,
  kind: 'risk',
  label: 'AE Attrition Risk',
  observed_state: {
    cap: 100,
    unit: '%',
    value: 0.2,
    raw_value: 20,
    factor_type: 'probability',
  },
} as unknown as EngineNodeV3;

/**
 * The OTHER witnessed capture (decision `04f53491`, run 1 — the pricing
 * scenario). Its constraint declares unit 'fraction' and its target node
 * carries NO `observed_state` at all, so the ladder resolves `default` [0,1]
 * and there is no second unit in existence to collide with. It is here as a
 * negative control drawn from the wire, not from imagination: the guard must
 * leave this capture byte-identical.
 */
const PRICING_CONSTRAINT_ID = 'constraint_out_gross_margin_min';
const PRICING_CONSTRAINT: GoalConstraint = {
  constraint_id: PRICING_CONSTRAINT_ID,
  node_id: 'out_gross_margin',
  operator: '>=',
  value: 0.8,
  label: 'and gross margin floor',
};
const PRICING_NODE = { id: 'out_gross_margin', kind: 'outcome', label: 'Gross margin' } as unknown as EngineNodeV3;

/**
 * A SIBLING constraint whose units DO reconcile, on its own node, used as the
 * GREEN half of every identity-binding pair: 2 people against a headcount cap
 * of 50, both declared 'count'.
 */
const MATCHED_CONSTRAINT_ID = 'gc-ae-headcount-floor';
const MATCHED_NODE_ID = 'fac_ae_headcount';
const MATCHED_CONSTRAINT: GoalConstraint = {
  constraint_id: MATCHED_CONSTRAINT_ID,
  node_id: MATCHED_NODE_ID,
  operator: '>=',
  value: 2,
  label: 'Account executives retained',
};
const MATCHED_NODE = {
  id: MATCHED_NODE_ID,
  kind: 'factor',
  label: 'AE headcount',
  observed_state: { cap: 50, unit: 'count', value: 0.6, raw_value: 30 },
} as unknown as EngineNodeV3;

/** Find a diagnostic by constraint_id — never by position, never by value. */
function diagFor(result: ReturnType<typeof normaliseGoalConstraints>, constraintId: string) {
  const d = result.diagnostics.find((x) => x.constraint_id === constraintId);
  expect(d, `no diagnostic for constraint_id ${constraintId}`).toBeDefined();
  return d!;
}

// ===========================================================================
// The predicate itself
// ===========================================================================

describe('constraint-units — the unit-compatibility predicate', () => {
  it('classifies the WITNESSED pair (count vs %) as mismatched', () => {
    expect(classifyUnitCompatibility(CAPTURED_CONSTRAINT_UNIT, '%')).toBe('mismatched');
    expect(unitsReconcilable(CAPTURED_CONSTRAINT_UNIT, '%')).toBe(false);
  });

  it('treats an undeclared unit on EITHER side as claiming nothing — never a mismatch', () => {
    // This is the branch that decides whether the guard fires on the whole
    // estate or only where two units actually exist. Both witnessed graphs are
    // full of nodes with no observed_state at all.
    expect(classifyUnitCompatibility(undefined, '%')).toBe('undeclared');
    expect(classifyUnitCompatibility('count', undefined)).toBe('undeclared');
    expect(classifyUnitCompatibility('   ', '%')).toBe('undeclared');
    expect(unitsReconcilable(undefined, undefined)).toBe(true);
  });

  it('reconciles identical and same-SCALE tokens, case- and space-insensitively', () => {
    expect(classifyUnitCompatibility('count', 'COUNT')).toBe('reconciled');
    expect(classifyUnitCompatibility(' % ', 'percent')).toBe('reconciled');
    expect(classifyUnitCompatibility('£', 'gbp')).toBe('reconciled');
    // Unknown token, byte-identical: reconciled. Unknown token, different:
    // MISMATCHED — the fail-closed direction, which costs coverage not truth.
    expect(classifyUnitCompatibility('widgets', 'widgets')).toBe('reconciled');
    expect(classifyUnitCompatibility('widgets', 'sprockets')).toBe('mismatched');
  });

  /**
   * ⚠ THE ANTI-REGRESSION GUARD FOR THE DIMENSION/SCALE COLLAPSE.
   *
   * DERIVED from the table itself, so it cannot go stale as scales are added —
   * and it is deliberately NOT a substitute for the hand-written corpus, which
   * is the only thing that can notice the table is short or a group is wrong.
   * What this one catches is the specific edit that shipped once: keying
   * compatibility on the DIMENSION, which blessed `months` against a `weeks`
   * cap at `decision_grade: true`.
   *
   * It pins its own precondition rather than asserting into the void: the pair
   * list is built by finding scales that genuinely SHARE a dimension, and the
   * test fails if that construction yields nothing — otherwise a table refactor
   * that removed every multi-scale dimension would leave this passing while
   * checking no pairs at all.
   */
  it('refuses two DIFFERENT scales of the SAME dimension — dimension is not unit', () => {
    const byDimension = new Map<string, string[]>();
    for (const scale of UNIT_SCALES) {
      const dim = dimensionOfScale(scale);
      expect(dim, `scale ${scale} declares no dimension`).toBeDefined();
      byDimension.set(dim as string, [...(byDimension.get(dim as string) ?? []), scale]);
    }

    const crossScalePairs: { a: string; b: string; dim: string }[] = [];
    for (const [dim, scales] of byDimension) {
      for (let i = 0; i < scales.length; i++) {
        for (let j = i + 1; j < scales.length; j++) {
          // A representative token from each scale — the predicate takes
          // tokens, not scale ids, so the pair must be exercised through the
          // real entry point.
          const a = unitTokensForScale(scales[i] as never)[0];
          const b = unitTokensForScale(scales[j] as never)[0];
          expect(a, `scale ${scales[i]} has no tokens`).toBeDefined();
          expect(b, `scale ${scales[j]} has no tokens`).toBeDefined();
          crossScalePairs.push({ a: a as string, b: b as string, dim });
        }
      }
    }

    // PRECONDITION: this guard is only meaningful if such pairs exist at all.
    // `currency` and `duration` each carry several scales, so this is > 0 today
    // and REDs by name if a refactor collapses them.
    expect(
      crossScalePairs.length,
      'no dimension carries two scales — this guard is asserting nothing',
    ).toBeGreaterThan(0);

    for (const { a, b, dim } of crossScalePairs) {
      expect(
        classifyUnitCompatibility(a, b),
        `${a} vs ${b} share the ${dim} dimension but are different units — must be mismatched`,
      ).toBe('mismatched');
      expect(unitDimension(a), `${a}/${b} precondition`).toBe(unitDimension(b));
    }
  });

  it('refuses fraction-vs-percent rather than inventing a ×100 conversion', () => {
    // A defensible conversion may exist in arithmetic; it does NOT exist in the
    // producer's declared semantics, and minting one would be a manufactured
    // attestation. Refusing is the honest disposal (see constraint-units.ts).
    expect(classifyUnitCompatibility('fraction', '%')).toBe('mismatched');
  });

  it('keeps isPercentUnit single-sourced with the percent scale', () => {
    // Union assertion, not a second hand-list: every token the percent scale
    // knows must satisfy isPercentUnit and vice versa on that scale's own set.
    for (const token of ['%', 'percent', 'pct', 'percentage', 'PCT', ' % ']) {
      expect(isPercentUnit(token), token).toBe(true);
      expect(classifyUnitCompatibility(token, '%'), token).toBe('reconciled');
    }
    expect(isPercentUnit('count')).toBe(false);
    expect(canonicaliseUnit('  PerCent ')).toBe('percent');
  });
});

// ===========================================================================
// INVARIANT 1 — the threshold is not normalised against a foreign-unit scale
// ===========================================================================

describe('INVARIANT 1 — a foreign-unit scale is refused, with a typed reason', () => {
  it('records the WITNESSED capture as a unit mismatch, naming both declared units', () => {
    const result = normaliseGoalConstraints([CAPTURED_CONSTRAINT], [CAPTURED_NODE], {
      unitsByConstraintId: new Map([[CAPTURED_CONSTRAINT_ID, CAPTURED_CONSTRAINT_UNIT]]),
    });

    const d = diagFor(result, CAPTURED_CONSTRAINT_ID);
    expect(d.node_id).toBe(CAPTURED_NODE_ID);

    // The mis-scale itself is REPRODUCED, not hidden — this is the capture's
    // own arithmetic, and it is what the downstream guards must refuse to
    // deliver or to badge. If this line ever stops reading 0.02 the fixture has
    // drifted from the capture and every verdict below is about a different run.
    expect(d.range.source).toBe('explicit_cap');
    expect(d.range).toEqual({ min: 0, max: 100, source: 'explicit_cap' });
    expect(d.normalised_value).toBeCloseTo(0.02, 12);
    expect(d.original_value).toBe(2);

    // The new decision, recorded at ladder-decision time.
    expect(d.unit_mismatch).toEqual({ constraint_unit: 'count', scale_unit: '%' });
  });

  /**
   * ⚠ THE WITHIN-DIMENSION TWIN (adversarial review of this PR, F1). The first
   * revision of this fix grouped tokens by DIMENSION, so `months` against a
   * `weeks` cap read `reconciled` and shipped: normalised **0.25** where the
   * truth is 26/24 = 1.083, `unit_mismatch: undefined`, `decision_grade: TRUE`
   * — a 4.33x stricter target wearing the product's highest-confidence badge,
   * i.e. this module's own defect reproduced through its own new code.
   *
   * Kept end-to-end rather than as a predicate case on purpose: the predicate
   * guard above would have stayed green through the entire defect, because the
   * defect was in the MAP the predicate reads, not in the predicate.
   */
  it('records a WITHIN-DIMENSION scale collision (months vs a weeks cap) as a mismatch', () => {
    const RAMP_CID = 'gc-ramp-within-6-months';
    const RAMP_CONSTRAINT: GoalConstraint = {
      constraint_id: RAMP_CID,
      node_id: 'fac_ramp',
      operator: '<=',
      value: 6,
      label: 'Ramp a new AE within 6 months',
    };
    const RAMP_NODE = {
      id: 'fac_ramp',
      kind: 'factor',
      label: 'AE ramp time',
      observed_state: { cap: 24, unit: 'weeks', value: 0.5, raw_value: 12 },
    } as unknown as EngineNodeV3;

    // PRECONDITION, pinned in-test: this pair must genuinely be same-dimension
    // and different-scale, or the test is exercising an ordinary cross-kind
    // mismatch and proving nothing about F1.
    expect(unitDimension('months')).toBe(unitDimension('weeks'));
    expect(unitDimension('months')).toBe('duration');

    const result = normaliseGoalConstraints([RAMP_CONSTRAINT], [RAMP_NODE], {
      unitsByConstraintId: new Map([[RAMP_CID, 'months']]),
    });

    const d = diagFor(result, RAMP_CID);
    expect(d.node_id).toBe('fac_ramp');
    // The mis-scale the old map blessed is REPRODUCED, exactly as measured, so
    // this fixture is provably the one that shipped the defect.
    expect(d.range).toEqual({ min: 0, max: 24, source: 'explicit_cap' });
    expect(d.normalised_value).toBeCloseTo(0.25, 12);
    expect(d.original_value).toBe(6);

    // …and is now refused rather than delivered.
    expect(d.unit_mismatch).toEqual({ constraint_unit: 'months', scale_unit: 'weeks' });

    // INVARIANT 2 on the same shape: the badge must not survive it either.
    const prov = buildConstraintScaleProvenance(
      [RAMP_CONSTRAINT],
      new Map([[RAMP_CID, { min: 0, max: 24, source: 'explicit_cap' as const }]]),
      new Map(),
      new Map([[RAMP_CID, true]]),
      new Map([[RAMP_CID, { constraint_unit: 'months', scale_unit: 'weeks' }]]),
    );
    expect(prov.get(RAMP_CID)!.decision_grade).toBe(false);
  });

  it('the reliability gate refuses that constraint by constraint_id', () => {
    const provenance = new Map([
      [CAPTURED_CONSTRAINT_ID, { unit_mismatch: { constraint_unit: 'count', scale_unit: '%' } }],
      [MATCHED_CONSTRAINT_ID, {}],
    ]);

    const detected = detectUnitMismatchedConstraintTargets(
      [CAPTURED_CONSTRAINT, MATCHED_CONSTRAINT],
      provenance,
    );

    // IDENTITY binding: exactly the witnessed constraint, and NOT its sibling.
    expect(detected.map((t) => t.constraint_id)).toEqual([CAPTURED_CONSTRAINT_ID]);
    expect(detected[0].node_id).toBe(CAPTURED_NODE_ID);
    expect(detected[0].reasons).toEqual(['constraint_unit_mismatch']);
  });

  it('claims nothing when no provenance was recorded (never-normalised constraint)', () => {
    expect(detectUnitMismatchedConstraintTargets([CAPTURED_CONSTRAINT], undefined)).toEqual([]);
    expect(detectUnitMismatchedConstraintTargets([CAPTURED_CONSTRAINT], new Map())).toEqual([]);
  });

  it('a unit-mismatched target can never be DELIVERED under doctrine B', () => {
    // Defence in depth against a future delivery exception: doctrine B delivers
    // because the SAMPLES are meaningful, and no property of the samples can
    // rescue a threshold that is about a different quantity. The node here has
    // a directed incoming edge, i.e. it is exactly the shape doctrine B exists
    // to deliver.
    const partition = partitionConstraintTargets(
      [
        {
          constraint_id: CAPTURED_CONSTRAINT_ID,
          node_id: CAPTURED_NODE_ID,
          reasons: ['constraint_unit_mismatch'],
        },
      ],
      { edges: [{ from: 'fac_coaching', to: CAPTURED_NODE_ID }] },
    );
    expect(partition.modelledBasis.map((t) => t.constraint_id)).toEqual([]);
    expect(partition.suppressed.map((t) => t.constraint_id)).toEqual([CAPTURED_CONSTRAINT_ID]);
  });

  it('names both units in the user-facing refusal, and never quotes a probability', () => {
    const msg = buildConstraintTargetUnreliableMessage(
      'AE Attrition Risk',
      ['constraint_unit_mismatch'],
      { constraint_unit: 'count', scale_unit: '%' },
    );
    expect(msg).toContain('AE Attrition Risk');
    expect(msg).toContain('count');
    expect(msg).toContain('%');
    // The whole point of the refusal is that no number here is trustworthy.
    expect(msg).not.toMatch(/\d+(\.\d+)?\s*%\s*chance/i);
    expect(msg).not.toContain('0.02');
  });

  /**
   * ⚠ THE BOTH-REASONS MESSAGE — the shape the WITNESSED capture is actually in
   * (`risk_ae_attrition` has three directed parents, so it trips the unanchored
   * frame as well as the unit collision), and the one every other message test
   * misses because they all pass a single-reason array.
   *
   * The regression this pins is not a wording preference. Ranking the unit
   * collision first displaced the L63 message and left the user holding
   * "restate the target in the same units" — an instruction that CANNOT unblock
   * a non-root target, in place of one that can. A more precise diagnosis that
   * removes the user's only working remedy is a worse message.
   */
  it('names BOTH causes and prescribes the remedy that can actually unblock, when both fire', () => {
    const both = buildConstraintTargetUnreliableMessage(
      'AE Attrition Risk',
      ['sample_frame_unanchored', 'constraint_unit_mismatch'],
      { constraint_unit: 'count', scale_unit: '%' },
    );
    const unitOnly = buildConstraintTargetUnreliableMessage(
      'AE Attrition Risk',
      ['constraint_unit_mismatch'],
      { constraint_unit: 'count', scale_unit: '%' },
    );
    const frameOnly = buildConstraintTargetUnreliableMessage('AE Attrition Risk', [
      'sample_frame_unanchored',
    ]);

    // PRECONDITION, pinned in-test: the two single-reason messages are genuinely
    // different texts. Without this the "is neither of them" assertions below
    // could pass on a builder that had collapsed into one generic string.
    expect(unitOnly).not.toBe(frameOnly);

    // It is a THIRD message, not a re-ranking of the two.
    expect(both).not.toBe(unitOnly);
    expect(both).not.toBe(frameOnly);

    // Cause 1 — the unit collision, named by unit, not generically.
    expect(both).toContain('count');
    expect(both).toContain('%');
    // Cause 2 — the unanchored frame, named as its own reason.
    expect(both).toContain('calculated from the factors feeding into it');

    // ⭐ THE REMEDY THAT WORKS. `attested_delta` is the FIRST limb of
    // `resolveConstraintSampleFrameAnchor`, checked before any topology test,
    // so it unblocks a root and a non-root alike.
    expect(both).toContain('the change you want from today');
    // ⭐ AND THE ONE THAT DOES NOT. `root_observed_level` sits AFTER the
    // `directedEdgeTargets` early return, so "set a current value" cannot
    // unblock the witnessed non-root shape. It must not be prescribed on a
    // message whose domain includes it.
    expect(both).not.toContain('Set a current value');

    // Reason ORDER on the wire is not guaranteed; the message must not depend
    // on it. Binds the two calls as the same object by their reason SET.
    expect(
      buildConstraintTargetUnreliableMessage(
        'AE Attrition Risk',
        ['constraint_unit_mismatch', 'sample_frame_unanchored'],
        { constraint_unit: 'count', scale_unit: '%' },
      ),
    ).toBe(both);

    // Claim-safety, same rules as every sibling message.
    expect(both).toContain('AE Attrition Risk');
    expect(both).toContain('withheld');
    expect(both).not.toMatch(/\d+(\.\d+)?\s*%\s*chance/i);
    expect(both).not.toContain('0.0054');
  });
});

// ===========================================================================
// INVARIANT 2 — decision_grade is never stamped on an unreconciled threshold
// ===========================================================================

describe('INVARIANT 2 — the badge is withheld when units were not reconciled', () => {
  /**
   * ⚠ THIS INVARIANT IS ONLY OBSERVABLE HERE, and that is a derived fact, not a
   * convenience. Invariant 1 suppresses the whole constraint block at run level
   * for ANY unreliable target, so a response carrying a unit-mismatched
   * `scale_provenance` cannot exist while invariant 1 holds — the wire can never
   * witness this badge. Testing it only through the route would therefore be
   * testing invariant 1 twice and invariant 2 never, and the day someone adds a
   * delivery exception (doctrine B already is one) the badge would be the last
   * thing standing between a unit-broken number and the product's
   * highest-confidence marker. Hence the direct call.
   */
  const CID_BAD = CAPTURED_CONSTRAINT_ID;
  const CID_GOOD = MATCHED_CONSTRAINT_ID;

  function provenanceFromLadder(unitMismatchOnBad: boolean) {
    return buildConstraintScaleProvenance(
      [CAPTURED_CONSTRAINT, MATCHED_CONSTRAINT],
      new Map([
        [CID_BAD, { min: 0, max: 100, source: 'explicit_cap' as const }],
        [CID_GOOD, { min: 0, max: 50, source: 'explicit_cap' as const }],
      ]),
      new Map(), // no threshold clamped
      new Map([
        [CID_BAD, true], // range_unified
        [CID_GOOD, true],
      ]),
      unitMismatchOnBad
        ? new Map([[CID_BAD, { constraint_unit: 'count', scale_unit: '%' }]])
        : new Map(),
    );
  }

  it('withholds the badge from the unit-mismatched constraint and from NO other', () => {
    const out = provenanceFromLadder(true);

    const bad = out.get(CID_BAD)!;
    const good = out.get(CID_GOOD)!;

    // The three ORIGINAL conjuncts hold for BOTH — same whitelisted source,
    // same unified range, neither clamped. The only difference between them is
    // the unit verdict, so a badge that still reads true here is reading the
    // wrong conjunct, and a badge that reads false for BOTH is a guard that
    // fired on the whole call instead of on one constraint.
    expect(bad.source).toBe('explicit_cap');
    expect(good.source).toBe('explicit_cap');
    expect(bad.range_unified).toBe(true);
    expect(good.range_unified).toBe(true);
    expect(bad.threshold_clamped).toBeUndefined();
    expect(good.threshold_clamped).toBeUndefined();

    expect(bad.unit_mismatch).toEqual({ constraint_unit: 'count', scale_unit: '%' });
    expect(bad.decision_grade).toBe(false);

    expect(good.unit_mismatch).toBeUndefined();
    expect(good.decision_grade).toBe(true);
  });

  it('CONTROL: with the mismatch absent, the SAME inputs earn the badge', () => {
    // Proves the false above is caused by the mismatch and by nothing else in
    // the fixture — without this, `decision_grade: false` could be an artefact
    // of the ladder inputs rather than of the new conjunct.
    const out = provenanceFromLadder(false);
    expect(out.get(CID_BAD)!.decision_grade).toBe(true);
    expect(out.get(CID_GOOD)!.decision_grade).toBe(true);
  });

  it('is a SEPARATE conjunct: the three original ones still hold on the witnessed capture', async () => {
    // Proving separability rather than asserting it. If the badge went false
    // because some other conjunct flipped, the fix would be the ladder changing
    // behaviour — a different (and riskier) change than the one claimed.
    const result = normaliseGoalConstraints([CAPTURED_CONSTRAINT], [CAPTURED_NODE], {
      unitsByConstraintId: new Map([[CAPTURED_CONSTRAINT_ID, CAPTURED_CONSTRAINT_UNIT]]),
    });
    const d = diagFor(result, CAPTURED_CONSTRAINT_ID);

    expect(d.range.source).toBe('explicit_cap'); // ∈ DECISION_GRADE_SOURCES
    expect(d.range_unified).toBe(true); // conjunct 2 holds
    expect(d.clamped).toBe(false); // conjunct 3 holds
    expect(d.unit_mismatch).toBeDefined(); // the ONLY failing conjunct
  });
});

// ===========================================================================
// NEGATIVE CONTROLS — drawn from the wire, not from imagination
// ===========================================================================

describe('the guard does not fire where no second unit exists', () => {
  it('leaves the witnessed PRICING capture untouched (fraction target, node with no observed_state)', () => {
    const result = normaliseGoalConstraints([PRICING_CONSTRAINT], [PRICING_NODE], {
      unitsByConstraintId: new Map([[PRICING_CONSTRAINT_ID, 'fraction']]),
    });
    const d = diagFor(result, PRICING_CONSTRAINT_ID);
    expect(d.range.source).toBe('default');
    expect(d.unit_mismatch).toBeUndefined();
  });

  it('records nothing for a % constraint on a %-capped node (the unit_percent rung)', () => {
    const result = normaliseGoalConstraints(
      [{ ...CAPTURED_CONSTRAINT, constraint_id: 'gc-pct', value: 20 }],
      [CAPTURED_NODE],
      { unitsByConstraintId: new Map([['gc-pct', '%']]) },
    );
    const d = diagFor(result, 'gc-pct');
    // The '%' rung outranks deriveRange, so the scale IS the constraint's own
    // unit — reconciled by construction, and there is nothing to record.
    expect(d.range.source).toBe('unit_percent');
    expect(d.unit_mismatch).toBeUndefined();
  });

  it('records nothing when the target node declares a cap but no unit', () => {
    const noUnitNode = {
      id: 'fac_unitless',
      kind: 'factor',
      observed_state: { cap: 100, value: 0.2 },
    } as unknown as EngineNodeV3;
    const result = normaliseGoalConstraints(
      [{ ...CAPTURED_CONSTRAINT, constraint_id: 'gc-unitless', node_id: 'fac_unitless' }],
      [noUnitNode],
      { unitsByConstraintId: new Map([['gc-unitless', 'count']]) },
    );
    const d = diagFor(result, 'gc-unitless');
    expect(d.range.source).toBe('explicit_cap');
    expect(d.unit_mismatch).toBeUndefined();
  });

  it('records nothing when the scale came from a source that carries no unit', () => {
    // `state_space.range` has NO unit field in the type at all, so `explicit`
    // can never carry a declared scale unit — measured, not assumed.
    const stateSpaceNode = {
      id: 'fac_state_space',
      kind: 'factor',
      state_space: { range: { min: 0, max: 10 } },
      observed_state: { unit: '%', value: 0.2 },
    } as unknown as EngineNodeV3;
    const result = normaliseGoalConstraints(
      [{ ...CAPTURED_CONSTRAINT, constraint_id: 'gc-ss', node_id: 'fac_state_space' }],
      [stateSpaceNode],
      { unitsByConstraintId: new Map([['gc-ss', 'count']]) },
    );
    const d = diagFor(result, 'gc-ss');
    expect(d.range.source).toBe('explicit');
    expect(d.unit_mismatch).toBeUndefined();
  });
});

// ===========================================================================
// IDENTITY BINDING — the RED/GREEN pair, inside one call
// ===========================================================================

describe('identity binding — the mismatch is attributed to ONE constraint', () => {
  it('flags the witnessed constraint and leaves its unit-MATCHED sibling alone', () => {
    const result = normaliseGoalConstraints(
      [CAPTURED_CONSTRAINT, MATCHED_CONSTRAINT],
      [CAPTURED_NODE, MATCHED_NODE],
      {
        unitsByConstraintId: new Map([
          [CAPTURED_CONSTRAINT_ID, 'count'],
          [MATCHED_CONSTRAINT_ID, 'count'],
        ]),
      },
    );

    // Both took the SAME ladder rung against the SAME kind of declaration —
    // the only difference is whether the two declared units name the same
    // quantity. A guard loosened for the wrong object shows up here.
    const bad = diagFor(result, CAPTURED_CONSTRAINT_ID);
    const good = diagFor(result, MATCHED_CONSTRAINT_ID);
    expect(bad.range.source).toBe('explicit_cap');
    expect(good.range.source).toBe('explicit_cap');

    expect(bad.unit_mismatch).toEqual({ constraint_unit: 'count', scale_unit: '%' });
    expect(good.unit_mismatch).toBeUndefined();
  });
});

// ===========================================================================
// THE WIRE — the live hole: a ROOT target whose sample frame IS proved
// ===========================================================================
//
// The L63 anchor gate suppresses the witnessed capture for a DIFFERENT reason
// (its target is non-root and unanchored), so a route test on that exact graph
// would prove nothing about units. The shape that reaches the screen today is
// the one the attribution names as still live: a ROOT constraint target with a
// finite `observed_state.value`, whose anchor limb `root_observed_level` PROVES
// a frame and DELIVERS — while proving nothing about the unit. That is the
// graph below.
// ---------------------------------------------------------------------------

let capturedISLRequestBody: any = null;
const NONZERO_JOINT = 0.0054;

function mockOptionRows(body: any) {
  const options = body.options || [];
  const constraints = body.goal_constraints || [];
  return options.map((opt: any, idx: number) => ({
    option_id: opt.id,
    outcome: {
      mean: 0.1578, std: 0.2048, p10: -0.142, p50: 0.1578, p90: 0.376,
      n_samples: 2000, n_valid_samples: 2000, validity_ratio: 1.0,
    },
    rank: idx + 1,
    ...(constraints.length > 0
      ? {
          constraint_analysis: {
            constraints: constraints.map((c: any) => ({
              constraint_id: c.constraint_id,
              node_id: c.node_id,
              operator: c.operator,
              value: c.value,
              prob_satisfied: NONZERO_JOINT,
              satisfied: false,
            })),
            joint_probability: NONZERO_JOINT,
            constraint_probabilities: Object.fromEntries(
              constraints.map((c: any) => [c.constraint_id, NONZERO_JOINT]),
            ),
          },
        }
      : {}),
  }));
}

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high',
      adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return {
      options: options.map((opt: any, idx: number) => ({
        option_id: opt.id,
        outcome: {
          mean: 0.1578, std: 0.2048, p10: -0.142, p50: 0.1578, p90: 0.376,
          n_samples: 2000, n_valid_samples: 2000, validity_ratio: 1.0,
        },
        rank: idx + 1,
      })),
      edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factors: [], value_of_information: [],
      factors_provenance: 'unavailable' as const,
      factor_sensitivity_status: 'skipped_no_factor_values' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.8,
      fragile_edges: [], robust_edges: [], latency_ms: 50, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    capturedISLRequestBody = body;
    return {
      data: {
        options: mockOptionRows(body),
        edges: [], factors: [], value_of_information: [],
        overall_robustness: 'robust', robustness_score: 0.8,
        fragile_edges: [], robust_edges: [],
      } as T,
      error: null,
    };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

const { createServer } = await import('../src/createServer.js');
// Deferred for the same reason `createServer` is: a STATIC import of run.ts
// pulls in the ISL module before `vi.mock`'s factory closure can see
// `mockISLService` (the factory is hoisted; the const is not).
const { buildConstraintScaleProvenance } = await import('../src/routes/v2/run.js');

/**
 * `fac_ae_attrition` is a ROOT node (no incoming edges) carrying a finite
 * `observed_state.value`, so `resolveConstraintSampleFrameAnchor` returns
 * `root_observed_level` and the L63 gate DELIVERS. Its cap/unit are the
 * witnessed pair. `fac_ae_headcount` is its unit-MATCHED twin, same shape,
 * different declared unit — the GREEN half of the wire-level pair.
 */
function wireGraph() {
  return {
    nodes: [
      { id: 'goal_arr', kind: 'goal', label: 'Grow ARR' },
      {
        id: 'fac_ae_attrition', kind: 'factor', label: 'AE attrition',
        observed_state: { cap: 100, unit: '%', value: 0.2, raw_value: 20 },
      },
      {
        id: 'fac_ae_headcount', kind: 'factor', label: 'AE headcount',
        observed_state: { cap: 50, unit: 'count', value: 0.6, raw_value: 30 },
      },
      { id: 'fac_coaching', kind: 'factor', label: 'Coaching spend', observed_state: { value: 0.4 } },
    ],
    edges: [
      { from: 'fac_ae_attrition', to: 'goal_arr', exists_probability: 0.9, strength: { mean: -0.4, std: 0.1 } },
      { from: 'fac_ae_headcount', to: 'goal_arr', exists_probability: 0.9, strength: { mean: 0.4, std: 0.1 } },
      { from: 'fac_coaching', to: 'goal_arr', exists_probability: 0.9, strength: { mean: 0.3, std: 0.1 } },
    ],
  };
}

const WIRE_OPTIONS = [
  { id: 'opt_coach', label: 'Coach', interventions: { fac_coaching: { value: 0.7, source: 'user_specified' } } },
  { id: 'opt_cro', label: 'Hire a CRO', interventions: { fac_coaching: { value: 0.5, source: 'user_specified' } } },
];

describe('WIRE — a unit-mismatched target is withheld even when its frame is anchored', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
    capturedISLRequestBody = null;
  });

  async function run(goalConstraints: unknown[]) {
    capturedISLRequestBody = null;
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      payload: {
        graph: wireGraph(),
        options: WIRE_OPTIONS,
        goal_node_id: 'goal_arr',
        seed: 'unit-mismatch-wire',
        n_samples: 2000,
        goal_constraints: goalConstraints,
      },
    });
    return { res, body: res.json() as any };
  }

  function jointByOption(body: any): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const o of body.option_comparison ?? []) out[o.option_id] = o.probability_of_joint_goal;
    return out;
  }

  function provenanceFor(body: any, constraintId: string) {
    const row = (body.constraint_results ?? []).find((r: any) => r.constraint_id === constraintId);
    return row?.scale_provenance;
  }

  it('POSITIVE CONTROL: the unit-MATCHED twin is delivered and badged decision-grade', async () => {
    // Without this, every "withheld" assertion below could be passing because
    // the mock never produced a presence at all.
    const { res, body } = await run([
      {
        constraint_id: 'gc_headcount', node_id: 'fac_ae_headcount',
        operator: '>=', value: 30, unit: 'count', label: 'Keep 30 AEs',
      },
    ]);

    expect(res.statusCode).toBe(200);
    const joints = jointByOption(body);
    expect(joints.opt_coach).toBe(NONZERO_JOINT);
    expect(joints.opt_cro).toBe(NONZERO_JOINT);

    const prov = provenanceFor(body, 'gc_headcount');
    expect(prov?.source).toBe('explicit_cap');
    expect(prov?.unit_mismatch).toBeUndefined();
    expect(prov?.decision_grade).toBe(true);
  });

  it('the WITNESSED shape is WITHHELD, not scored, and is never badged decision-grade', async () => {
    const { res, body } = await run([
      {
        constraint_id: CAPTURED_CONSTRAINT_ID, node_id: 'fac_ae_attrition',
        operator: '<=', value: 2, unit: 'count', label: 'Account executives lost',
      },
    ]);

    expect(res.statusCode).toBe(200);

    // INVARIANT 1 — the fabricated probability never reaches the wire.
    const joints = jointByOption(body);
    expect(joints.opt_coach).toBeUndefined();
    expect(joints.opt_cro).toBeUndefined();

    // ⚠ INVARIANT 2 IS NOT WITNESSABLE AT THE WIRE, AND THAT IS STRUCTURAL.
    // Invariant 1 withholds the ENTIRE constraint block for any suppressed
    // target (`run.ts`: `return { constraints_status: 'unavailable' }`, no
    // `constraint_results`), and `partitionConstraintTargets` suppresses every
    // unit-mismatched target unconditionally — so a `scale_provenance` for this
    // constraint cannot reach the wire while invariant 1 holds, and the badge
    // cannot be observed here either way. Invariant 2 is proved at the unit
    // level in its own describe block above, where M3 bites.
    //
    // This block previously read `if (prov !== undefined) { …assert the badge… }`
    // under a comment claiming invariant 2 was "asserted independently" here.
    // That branch was unreachable: measured by planting an unconditional
    // failure inside it, the file stayed 20/20 GREEN. Asserting the WITHHOLDING
    // directly is what makes this a test rather than a comment.
    expect(body.constraints_status).toBe('unavailable');
    expect(body.constraint_results).toBeUndefined();
    expect(provenanceFor(body, CAPTURED_CONSTRAINT_ID)).toBeUndefined();

    // The refusal is disclosed, typed, and names the node.
    const warnings = (body.inference_warnings ?? []).filter(
      (w: any) => w.code === 'CONSTRAINT_TARGET_UNRELIABLE',
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].severity).toBe('warning');
    expect(warnings[0].message).toContain('AE attrition');
    expect(warnings[0].message).toContain('count');
  });
});
