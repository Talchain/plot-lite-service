/**
 * ROADMAP 2.670 — `flip_thresholds[]` must be declared in the PRODUCER's shape.
 *
 * THE DEFECT THIS PINS. PLoT's `M1ReviewSchema.flip_thresholds[]` required
 * numeric `current_value` / `flip_value` plus `plain_english`. CEE — the only
 * producer of an M1 review — emits `current_display` / `flip_display` /
 * `narrative` (display STRINGS). A producer-conformant row therefore failed
 * `safeParseM1Review` with three `invalid_type` "Required" issues, and
 * `decision-review-orchestrator.ts:220-241` discards the ENTIRE review
 * (`m1_review: null`, `review_status: 'failed'`, `['SHAPE_VALIDATION_FAILED']`)
 * whenever any flip threshold is present. One mis-modelled sub-object killed
 * every other section of the review with it.
 *
 * ROOT CAUSE, and why nothing caught it: PLoT modelled the shape it SENDS
 * (`FlipThresholdInputData`, which really is numeric) and never followed the
 * prompt's move to display forms on the way BACK. The golden fixtures were
 * authored to PLoT's own schema, so they encode PLoT's model of CEE rather than
 * CEE's output and could never have contradicted it — trap 16's inverse, and
 * the same defect the `m1-review-transport-continuity` suite was written for.
 *
 * ⚠ FIXTURE PROVENANCE — the whole point of this file, do not "tidy" it away.
 * The rows below are derived from the PRODUCER at CEE `staging` commit
 * `658cdff3ed7c4b2724fcd6740d50ac141bfb5a63`, from two independent sources that
 * agree:
 *   1. `Prompts/canonical/decision_review.txt:407-425` — the output contract:
 *      "flip_thresholds (array, max 2; always present, may be []):
 *         factor_id, factor_label: copied exactly.
 *         current_display / flip_display: the DISPLAY form of current_value and
 *           flip_value. […] 1. The value carries a unit. Quote it verbatim with
 *           the unit appended ("16000 GBP", "800 customers") […] 2. The value
 *           carries no unit and lies between 0 and 1. It is probability-like, so
 *           it takes the percentage form […] write "35%", never "0.35".
 *         narrative (1-2 sentences, max 220 chars)"
 *   2. `src/orchestrator-v5/compose/phase3-blocks.ts` header — CEE's own
 *      consumer declaration of the v11 LLM output schema:
 *      "flip_thresholds: Array<{ factor_id, factor_label, current_display,
 *                                flip_display, narrative }>"
 * NEITHER declares `current_value`, `flip_value`, `plain_english`, or
 * `direction` on the RETURNED row. `direction` appears only on the INPUT
 * (`flip_threshold_data`, prompt line 57) — it is a field PLoT sends, not one
 * CEE sends back, and conflating the two directions is the defect itself.
 *
 * SCOPE NOTE, so this is not over-read: this file asserts what PLoT's Zod schema
 * ACCEPTS and DECLARES. It is evidence about the contract, not a live witness of
 * CEE's output — the served prompt is external and drifts (trap 12c). See the
 * lane report for the measured live frequency.
 */

import { describe, it, expect } from 'vitest';
import {
  safeParseM1Review,
  M1ReviewSchema,
} from '../src/cee/validation/m1-review-types.js';
import {
  validateM1Review,
  type ValidationContext,
} from '../src/cee/validation/m1-review-validator.js';
import { M1ReviewFailureCodes } from '../src/cee/validation/m1-review-constants.js';

/**
 * The producer's declared flip-threshold row, case 1 (value carries a unit).
 * Verbatim value + unit, exactly as the prompt specifies.
 */
const PRODUCER_FLIP_ROW_UNIT = {
  factor_id: 'factor-market',
  factor_label: 'Market Demand',
  current_display: '16000 GBP',
  flip_display: '12000 GBP',
  narrative:
    'If Market Demand moves from 16000 GBP to 12000 GBP, the leading option changes.',
};

/**
 * The producer's declared flip-threshold row, case 2 (unitless, probability-like
 * → percentage form). A DISTINCT identity from the row above so assertions bind
 * by identity, never by a value predicate the other row could satisfy (trap 19).
 */
const PRODUCER_FLIP_ROW_PERCENT = {
  factor_id: 'factor-adoption',
  factor_label: 'Adoption Rate',
  current_display: '70%',
  flip_display: '50%',
  narrative:
    'If Adoption Rate moves from 70% to 50%, the leading option changes.',
};

/**
 * A minimal producer-conformant review. Every OTHER section is deliberately
 * well-formed and minimal, so a failure here is attributable to
 * `flip_thresholds` and nothing else.
 */
function producerShapedReview(
  flipThresholds: unknown[]
): Record<string, unknown> {
  return {
    narrative_summary: 'Option A leads on delivery certainty.',
    story_headlines: { 'opt-a': 'Leads on delivery certainty' },
    robustness_explanation: {
      summary: 'The ordering holds in about 71% of variations.',
      primary_risk: 'The link from Price to Revenue is the biggest threat.',
      stability_factors: ['Delivery certainty anchors the result'],
      fragility_factors: ['The link from Price to Revenue could flip it'],
    },
    readiness_rationale: 'Two gaps still hold this back.',
    evidence_enhancements: {},
    bias_findings: [],
    key_assumptions: ['Demand holds at current levels'],
    decision_quality_prompts: [],
    flip_thresholds: flipThresholds,
  };
}

describe('2.670 · M1Review.flip_thresholds is declared in the producer shape', () => {
  it('accepts a producer-conformant row carrying a UNIT display form', () => {
    const parsed = safeParseM1Review(
      producerShapedReview([PRODUCER_FLIP_ROW_UNIT])
    );

    // The defect verbatim: at pristine this failed with three invalid_type
    // "Required" issues for current_value / flip_value / plain_english.
    expect(
      parsed.success
        ? []
        : parsed.error.errors.map((e) => `${e.path.join('.')}:${e.code}`)
    ).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it('accepts a producer-conformant row carrying a PERCENTAGE display form', () => {
    const parsed = safeParseM1Review(
      producerShapedReview([PRODUCER_FLIP_ROW_PERCENT])
    );
    expect(parsed.success).toBe(true);
  });

  it('carries the producer values through to the parsed output, by identity', () => {
    const parsed = safeParseM1Review(
      producerShapedReview([PRODUCER_FLIP_ROW_UNIT, PRODUCER_FLIP_ROW_PERCENT])
    );
    if (!parsed.success) {
      throw new Error(
        `producer-conformant review must parse; got ${JSON.stringify(
          parsed.error.errors
        )}`
      );
    }

    const rows = parsed.data.flip_thresholds ?? [];
    // Bind by identity (factor_id), never by position or by a value predicate
    // the sibling row could also satisfy — trap 19.
    const unitRow = rows.find((r) => r.factor_id === 'factor-market');
    const pctRow = rows.find((r) => r.factor_id === 'factor-adoption');

    expect(unitRow).toBeDefined();
    expect(pctRow).toBeDefined();
    expect(unitRow?.current_display).toBe('16000 GBP');
    expect(unitRow?.flip_display).toBe('12000 GBP');
    expect(unitRow?.narrative).toContain('16000 GBP');
    expect(pctRow?.current_display).toBe('70%');
    expect(pctRow?.flip_display).toBe('50%');
  });

  /**
   * TRAP 12d — a derived guard proves AGREEMENT and can never prove
   * COMPLETENESS. The tests above would all still pass if the schema declared
   * only a subset of the producer's keys and silently stripped the rest (Zod
   * strips unknown keys by default, so a short schema fails SILENTLY — the exact
   * shape of hazard 1). This union assertion is the completeness check, and it
   * is written against a HAND-DERIVED key set taken from the producer's contract
   * rather than from PLoT's own schema, so it cannot agree with itself.
   */
  it('declares EVERY key the producer emits (union assertion, not derived from our own schema)', () => {
    // Hand-derived from CEE 658cdff3: canonical prompt :407-425 and
    // phase3-blocks.ts header. Update ONLY against the producer's bytes.
    const PRODUCER_KEYS = [
      'factor_id',
      'factor_label',
      'current_display',
      'flip_display',
      'narrative',
    ] as const;

    const element = M1ReviewSchema.shape.flip_thresholds.unwrap().element;
    const declared = Object.keys(element.shape);

    for (const key of PRODUCER_KEYS) {
      expect(
        declared,
        `schema must DECLARE producer key "${key}" — an undeclared key is silently stripped, not rejected`
      ).toContain(key);
    }
  });

  /**
   * The negative half of the union assertion: the schema must not still be
   * demanding the fields the producer never sends. Without this, adding the
   * display keys while LEAVING the numeric ones required would satisfy every
   * test above and still discard every real review.
   */
  it('does not REQUIRE any field the producer does not emit', () => {
    const element = M1ReviewSchema.shape.flip_thresholds.unwrap().element;
    const declared = Object.keys(element.shape);

    for (const stale of ['current_value', 'flip_value', 'plain_english']) {
      expect(
        declared,
        `"${stale}" is a PLoT REQUEST-side field; the producer never returns it`
      ).not.toContain(stale);
    }
  });

  /**
   * Positive control for the assertions above: prove this suite can SEE a
   * failure at all. An absence/acceptance test that cannot fail is theatre
   * (trap 13).
   */
  it('positive control: a genuinely malformed row is still REJECTED', () => {
    const parsed = safeParseM1Review(
      producerShapedReview([
        {
          factor_id: 'factor-market',
          factor_label: 'Market Demand',
          // current_display missing entirely, flip_display wrong primitive type
          flip_display: 42,
          narrative: 'unusable',
        },
      ])
    );
    expect(parsed.success).toBe(false);
  });
});

/**
 * Validator Tier 7 — the anti-fabrication guard, re-expressed for display forms.
 *
 * ⚠ WHY THESE TESTS EXIST AT ALL. 2.670 removed the numeric `current_value` /
 * `flip_value` that Tier 7 used to compare. The tempting move was to delete the
 * tier along with the fields — which would have retired a BLOCKING data-integrity
 * guard as a side effect of a schema change, with every test still green. The
 * tier was re-expressed instead, and these tests are what hold it to the same
 * property: the number NAMED in the display string must be the number PLoT sent.
 */
describe('2.670 · Tier 7 still catches a fabricated flip value, at the display form', () => {
  /** Minimal context: Tier 7 reads only `flipThresholdData`. */
  function contextWith(
    flipThresholdData: ValidationContext['flipThresholdData']
  ): ValidationContext {
    return {
      optionIds: ['opt-a'],
      optionLabels: ['Option A'],
      optionIdToLabel: { 'opt-a': 'Option A' },
      edgeIds: [],
      nodeIds: [],
      fragileEdgeIds: [],
      evidenceGapFactorIds: [],
      readiness: 'ready',
      allowedNumbers: [],
      briefText: '',
      flipThresholdData,
    };
  }

  function reviewWithFlip(row: Record<string, unknown>) {
    return producerShapedReview([row]) as never;
  }

  const UNITLESS = [
    { factor_id: 'f1', factor_label: 'Adoption', current_value: 0.7, flip_value: 0.5 },
  ] as ValidationContext['flipThresholdData'];

  const WITH_UNIT = [
    { factor_id: 'f1', factor_label: 'Budget', current_value: 16000, flip_value: 12000, unit: 'GBP' },
  ] as ValidationContext['flipThresholdData'];

  it('accepts the percentage form for a unitless probability-like value (0.7 → "70%")', () => {
    const result = validateM1Review(
      reviewWithFlip({
        factor_id: 'f1',
        factor_label: 'Adoption',
        current_display: '70%',
        flip_display: '50%',
        narrative: 'If Adoption moves from 70% to 50%, the leading option changes.',
      }),
      contextWith(UNITLESS)
    );
    expect(result.failure_codes).not.toContain(M1ReviewFailureCodes.MODIFIED_VALUES);
  });

  it('accepts the verbatim-with-unit form (16000 GBP)', () => {
    const result = validateM1Review(
      reviewWithFlip({
        factor_id: 'f1',
        factor_label: 'Budget',
        current_display: '16000 GBP',
        flip_display: '12000 GBP',
        narrative: 'If Budget moves from 16000 GBP to 12000 GBP, the leading option changes.',
      }),
      contextWith(WITH_UNIT)
    );
    expect(result.failure_codes).not.toContain(M1ReviewFailureCodes.MODIFIED_VALUES);
  });

  /**
   * THE PROOF OBLIGATION. This is the case the whole tier exists for: CEE names a
   * number PLoT never sent. If this test can be made to pass while the guard is
   * gone, the guard is theatre.
   */
  it('REJECTS a fabricated current value (names 90 where PLoT sent 0.7)', () => {
    const result = validateM1Review(
      reviewWithFlip({
        factor_id: 'f1',
        factor_label: 'Adoption',
        current_display: '90%',
        flip_display: '50%',
        narrative: 'Fabricated.',
      }),
      contextWith(UNITLESS)
    );
    expect(result.failure_codes).toContain(M1ReviewFailureCodes.MODIFIED_VALUES);
  });

  it('REJECTS a fabricated flip value (names 9999 where PLoT sent 12000)', () => {
    const result = validateM1Review(
      reviewWithFlip({
        factor_id: 'f1',
        factor_label: 'Budget',
        current_display: '16000 GBP',
        flip_display: '9999 GBP',
        narrative: 'Fabricated.',
      }),
      contextWith(WITH_UNIT)
    );
    expect(result.failure_codes).toContain(M1ReviewFailureCodes.MODIFIED_VALUES);
  });

  /**
   * TRAP 19 — a DISCRIMINATING PAIR. The test above proves the guard is sensitive
   * to SOMETHING. This proves it is bound to the NAMED factor: the same fabricated
   * display attached to a factor PLoT never computed must NOT fire, because Tier 7
   * has nothing to compare it against ("acceptable if CEE added it"). Without this
   * half, a guard that simply rejected every "90%" anywhere would score identically.
   */
  it('discriminating half: the same fabricated display on an UNKNOWN factor does NOT fire', () => {
    const result = validateM1Review(
      reviewWithFlip({
        factor_id: 'factor-cee-invented',
        factor_label: 'Invented',
        current_display: '90%',
        flip_display: '50%',
        narrative: 'Not in PLoT-computed data.',
      }),
      contextWith(UNITLESS)
    );
    expect(result.failure_codes).not.toContain(M1ReviewFailureCodes.MODIFIED_VALUES);
  });

  /**
   * TRAP 13b — pin the guard's OWN precondition. `MODIFIED_VALUES` is blocking, so
   * a false positive discards the whole review. The tier is deliberately fail-open
   * on an undecidable display; this pins that as INTENDED behaviour rather than
   * leaving it as an accident a later "hardening" pass would silently reverse.
   */
  it('does NOT fire on a display naming no number — undecidable is not evidence of tampering', () => {
    const result = validateM1Review(
      reviewWithFlip({
        factor_id: 'f1',
        factor_label: 'Adoption',
        current_display: 'materially lower',
        flip_display: 'materially lower',
        narrative: 'Qualitative.',
      }),
      contextWith(UNITLESS)
    );
    expect(result.failure_codes).not.toContain(M1ReviewFailureCodes.MODIFIED_VALUES);
  });

  /**
   * The float case that would make a naive equality guard discard real reviews:
   * 0.35 * 100 is 35.000000000000004 in IEEE-754.
   */
  it('accepts 0.35 → "35%" despite the float representation of 0.35 * 100', () => {
    const result = validateM1Review(
      reviewWithFlip({
        factor_id: 'f1',
        factor_label: 'Adoption',
        current_display: '35%',
        flip_display: '20%',
        narrative: 'Float-safe.',
      }),
      contextWith([
        { factor_id: 'f1', factor_label: 'Adoption', current_value: 0.35, flip_value: 0.2 },
      ] as ValidationContext['flipThresholdData'])
    );
    expect(result.failure_codes).not.toContain(M1ReviewFailureCodes.MODIFIED_VALUES);
  });

  /**
   * The percentage licence is granted by UNITLESSNESS. A value carrying a unit
   * takes case 1 only, so "70%" against `0.7 GBP` names 70, not 0.7 — a real
   * disagreement. Without this, the two cases could be collapsed into one and
   * nothing would notice.
   */
  it('does NOT grant the percentage licence to a value that carries a unit', () => {
    const result = validateM1Review(
      reviewWithFlip({
        factor_id: 'f1',
        factor_label: 'Rate',
        current_display: '70%',
        flip_display: '50 GBP',
        narrative: 'Unit present, so percentage form is not licensed.',
      }),
      contextWith([
        { factor_id: 'f1', factor_label: 'Rate', current_value: 0.7, flip_value: 50, unit: 'GBP' },
      ] as ValidationContext['flipThresholdData'])
    );
    expect(result.failure_codes).toContain(M1ReviewFailureCodes.MODIFIED_VALUES);
  });
});
