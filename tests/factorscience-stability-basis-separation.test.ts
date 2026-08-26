/**
 * FactorScience — slice 1: ISL bootstrap dispersion may not ride a GRAPH row.
 * ===========================================================================
 *
 * THE CONTRACT. Structural influence and uncertainty sensitivity are separate
 * scientific quantities. Statistics computed on one basis may not be published
 * under a label that appears to qualify a number computed on another.
 *
 * THE VIOLATION, as measured. On the graph-primary path — which is every live
 * response where the graph path returns factors — `factor_sensitivity[]` rows
 * carry PLoT's GRAPH path-product numbers:
 *   src/lib/factor-influence.ts:793  sensitivity_score = graph raw total causal effect
 *   src/lib/factor-influence.ts:796  elasticity        = graph NORMALISED influence
 *                                    (byte-identical to influence_score:789 — it is
 *                                     not an elasticity at all)
 * while `mergeIslConfidenceIntoGraphFactors` cross-attached ISL's BOOTSTRAP
 * statistics onto those same rows — dispersion measured about ISL's Monte-Carlo
 * elasticity, a quantity that does not appear on the row and that the user never
 * sees.
 *
 * THE REPO ALREADY SAID SO, IN THREE PLACES, BEFORE THIS TEST EXISTED:
 *   1. src/types/engine-v3.ts:2450-2451 — "3C stability fields — valid for
 *      ISL-sourced entries only. Graph-derived and ISL elasticity use different
 *      scales; do not cross-attach."
 *   2. src/lib/driver-quantity-register.ts:153-159 — unit
 *      'same_units_as_isl_elasticity', note "ISL-sourced rows only ... this must
 *      never be cross-attached to a graph row."
 *   3. src/contracts/isl-to-ui.contract.ts:143-198 — the substitutions table,
 *      which records the units differing and a MEASURED SIGN DISAGREEMENT
 *      (live fac_dev_headcount: ISL negative, published positive).
 * A stated invariant with a live violation two files away needs no argument; it
 * needs a guard. This is the guard.
 *
 * SCOPE — DELIBERATELY THE FREE HALF ONLY.
 *   THIS SLICE: elasticity_std, stability_method. Zero readers in CEE src/ and
 *   UI src/ (measured with contrast controls in the same sweep: elasticity_std 0
 *   and stability_method 0, against attribution_stability 11, rank_flip_rate 11,
 *   factor_sensitivity 572 in CEE at staging 45cf25e1). CEE's strict allowlist
 *   (decision-review-enricher.ts:1385-1389) admits only attribution_stability
 *   and rank_flip_rate, so these two are ALREADY dropped at that seam today —
 *   this change does not cross it.
 *   NOT THIS SLICE: attribution_stability and rank_flip_rate. They are rendered,
 *   and rank_flip_rate FILTERS what a default non-expert user sees
 *   (UI StressTestSection.tsx:143-146). Splitting them changes what a user is
 *   shown and needs its own review and its own witness.
 *
 * NO DATA IS LOST. Both fields keep their honest home in the separate,
 * ISL-sourced `factor_stability[]` array (FactorStabilityEntry,
 * engine-v3.ts:2506, "Populated from ISL's 3C bootstrap analysis — independent
 * of factor_sensitivity source"), which /v2/run already emits at run.ts:4222.
 */

import { describe, it, expect } from 'vitest';
import { mergeIslConfidenceIntoGraphFactors, buildFactorStability } from '../src/lib/factor-influence.js';
import type { FactorSensitivityResultV3, EngineEdgeV3, EngineGraphV3 } from '../src/types/engine-v3.js';

/** A GRAPH-derived row: its elasticity is the graph path-product, not ISL's. */
function graphRow(factorId: string): FactorSensitivityResultV3 {
  return {
    factor_id: factorId,
    factor_label: factorId,
    sensitivity_score: 0.42,
    elasticity: 0.31,
    direction: 'positive',
    importance_rank: 1,
    influence_score: 0.31,
    confidence: 0.5,
    confidence_source: 'plot_unified_from_graph',
    confidence_provenance: {
      computation_source: 'plot_unified_from_graph',
      formula_version: 'plot_unified_v2',
      provisional: false,
      input_quality: 'ok',
    },
    source: 'graph',
  } as unknown as FactorSensitivityResultV3;
}

/** The ISL row for the SAME factor, carrying all four 3C bootstrap fields. */
function islRow(factorId: string): FactorSensitivityResultV3 {
  return {
    factor_id: factorId,
    factor_label: factorId,
    sensitivity_score: 0.9,
    elasticity: -0.77, // ISL's MC elasticity — note the sign differs from the graph row
    direction: 'negative',
    importance_rank: 1,
    confidence: 0.8,
    attribution_stability: 'moderate',
    elasticity_std: 0.0123,
    rank_flip_rate: 0.25,
    stability_method: 'bootstrap_1000',
    source: 'isl',
  } as unknown as FactorSensitivityResultV3;
}

const EDGES: EngineEdgeV3[] = [
  { from: 'fac_a', to: 'goal', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } } as unknown as EngineEdgeV3,
];

describe('FactorScience slice 1 — ISL bootstrap dispersion may not ride a graph row', () => {
  it('a GRAPH-basis row does NOT carry elasticity_std or stability_method, even when ISL supplies them', () => {
    const merged = mergeIslConfidenceIntoGraphFactors([graphRow('fac_a')], [islRow('fac_a')], EDGES, new Set());

    expect(merged).toHaveLength(1);
    const row = merged[0]!;

    // PRECONDITION PINNED IN-TEST: this row really is the graph-basis one, and
    // the merge really did consume the ISL entry. Without this the assertions
    // below could pass because the merge silently did nothing at all.
    expect(row.factor_id).toBe('fac_a');
    expect(row.elasticity).toBe(0.31); // the GRAPH value survived; ISL's -0.77 did not
    expect(row.confidence_source).toBe('plot_unified_from_isl_bootstrap'); // ISL WAS consumed

    // The claim.
    expect(row.elasticity_std).toBeUndefined();
    expect(row.stability_method).toBeUndefined();
  });

  it('an ISL-BASIS row still carries them — the fix separates bases, it does not delete a quantity', () => {
    // No graph row for this factor, so the ISL-only append path builds it.
    const merged = mergeIslConfidenceIntoGraphFactors([], [islRow('fac_b')], EDGES, new Set());

    expect(merged).toHaveLength(1);
    const row = merged[0]!;

    // Same-basis attachment is legitimate: this row's own elasticity IS ISL's.
    expect(row.elasticity).toBe(-0.77);
    expect(row.elasticity_std).toBe(0.0123);
    expect(row.stability_method).toBe('bootstrap_1000');
  });

  /**
   * The DISCRIMINATING pair, in-test. Together these two prove the rule is
   * "attach only on an ISL-basis row", not "never attach" and not "always
   * attach". Either one alone is satisfiable by a blanket behaviour.
   */
  it('DISCRIMINATION: the same ISL entry attaches on the ISL-basis row and not on the graph-basis row', () => {
    const isl = islRow('fac_a');
    const onGraph = mergeIslConfidenceIntoGraphFactors([graphRow('fac_a')], [isl], EDGES, new Set())[0]!;
    const onIsl = mergeIslConfidenceIntoGraphFactors([], [islRow('fac_b')], EDGES, new Set())[0]!;

    expect(onGraph.elasticity_std).toBeUndefined();
    expect(onIsl.elasticity_std).toBe(0.0123);
    // The two outcomes must DIFFER — a blanket rule in either direction fails here.
    expect(onGraph.elasticity_std).not.toBe(onIsl.elasticity_std);
  });

  it('attribution_stability and rank_flip_rate are UNCHANGED — slice 2 is not smuggled in', () => {
    const row = mergeIslConfidenceIntoGraphFactors([graphRow('fac_a')], [islRow('fac_a')], EDGES, new Set())[0]!;

    // These still cross-attach. That is the KNOWN, deliberately-deferred half:
    // rank_flip_rate filters what a default user sees, so moving it changes the
    // product and needs its own review. Pinned so the deferral is visible and so
    // slice 2 turns this test RED by name rather than passing silently.
    expect(row.attribution_stability).toBe('moderate');
    expect(row.rank_flip_rate).toBe(0.25);
  });

  /**
   * A SUPPRESSED LEVER must not get the field back as a fabricated zero.
   *
   * LEVER_SUPPRESSION_FIELDS used to force `elasticity_std: 0` (A3 lane 2,
   * closing the live fac_salary_cost leak where a suppressed lever egressed
   * elasticity_std 0.00396846). Every site that applies that set — :904, :943,
   * :1048 — is a GRAPH-row path. Once slice 1 stops the cross-attach, keeping
   * the zero would make that set the only thing putting the field back on a
   * graph row. Absence closes the original harm strictly more completely than
   * zeroing, so the assertion is `undefined`, NOT `0`.
   */
  it('a suppressed LEVER row carries no elasticity_std at all — absent, not a fabricated 0', () => {
    const levers = new Set(['fac_a']);
    const row = mergeIslConfidenceIntoGraphFactors([graphRow('fac_a')], [islRow('fac_a')], EDGES, levers)[0]!;

    // PRECONDITION: suppression really did fire on this row.
    expect(row.sensitivity_score).toBe(0);
    expect((row as unknown as { zero_reason?: string }).zero_reason).toBe('intervention_override');

    expect(row.elasticity_std).toBeUndefined();
    expect(row.elasticity_std).not.toBe(0);
  });

  it('NO DATA LOSS: factor_stability[] still publishes both fields on the ISL basis', () => {
    const graph = { nodes: [{ id: 'fac_a', label: 'Factor A' }], edges: [] } as unknown as EngineGraphV3;
    const stability = buildFactorStability([islRow('fac_a')], graph, new Set());

    expect(stability).toHaveLength(1);
    expect(stability[0]!.elasticity_std).toBe(0.0123);
    expect(stability[0]!.stability_method).toBe('bootstrap_1000');
  });

  /**
   * The one honest behaviour change, pinned rather than left silent.
   *
   * buildFactorStability requires ALL FOUR 3C fields to be valid
   * (factor-influence.ts:1145-1150), while the old cross-attach was PER-FIELD.
   * So an ISL entry with a valid elasticity_std but, say, no stability_method
   * used to publish that std on the graph row while being skipped from
   * factor_stability[]. After this change it is published in neither place.
   *
   * That is the fix, not a regression: a partial-data bootstrap statistic
   * attached to a graph-basis point estimate is the exact harm. Pinned here so
   * the consequence is observed and cannot be discovered later as a surprise.
   */
  it('partial ISL 3C data: the std is published in NEITHER place (behaviour change, stated)', () => {
    const partial = { ...islRow('fac_a'), stability_method: undefined } as unknown as FactorSensitivityResultV3;

    const row = mergeIslConfidenceIntoGraphFactors([graphRow('fac_a')], [partial], EDGES, new Set())[0]!;
    expect(row.elasticity_std).toBeUndefined();

    const graph = { nodes: [{ id: 'fac_a', label: 'Factor A' }], edges: [] } as unknown as EngineGraphV3;
    expect(buildFactorStability([partial], graph, new Set())).toHaveLength(0);
  });
});
