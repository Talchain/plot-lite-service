/**
 * A DECLARED PRIOR IS A QUANTITATIVE STATEMENT. `category` IS A COACHING LABEL.
 * The prior-to-uniform channel must key on the STATEMENT, not on the label.
 *
 * THE SPEC THESE CASES ARE WRITTEN AGAINST — deliberately not written against
 * the failure mode (standing brief §3):
 *
 *   A factor whose only quantitative statement is a well-formed uniform prior
 *   reaches ISL as a `uniform` parameter-uncertainty carrying that declared
 *   support, WHATEVER its `category`. A factor that has a stated value is
 *   unaffected — the value wins. A factor with no prior is unaffected. A prior
 *   that cannot be expressed is DECLINED, never approximated.
 *
 * WHY THIS IS A WIDENING AND NOT A NEW BEHAVIOUR. `buildParameterUncertaintiesV3`
 * already forwards a declared uniform support verbatim, and ISL already reads a
 * uniform entry's bounds off the wire rather than from `observed_state`
 * (robustness_analyzer_v2.py:1180-1188). The only thing that gated it was the
 * conjunct `node.category === 'external'`. Everything about the emitted entry —
 * the family, the bounds, the degenerate-range refusal, the swap repair, the
 * unsupported-distribution skip — is unchanged and shared.
 *
 * WHY IT IS INERT ON DEPLOY, DERIVED AT THE BYTES AND NOT ASSUMED (see the
 * `remains inert` block below, which is the load-bearing case in this file).
 * CEE's `graph-validator.ts` enforces a MUTUAL EXCLUSION on factor data:
 * `controllable`/`observable` factors MUST carry `data.value`
 * (CONTROLLABLE_MISSING_DATA / OBSERVABLE_MISSING_DATA, severity `error`) and
 * `external` factors MUST NOT (EXTERNAL_HAS_DATA, severity `error`). So in a
 * CEE-valid graph every non-external factor arrives WITH a value, and the second
 * pass's `observed_state.value !== undefined` guard skips it before the widened
 * condition is ever evaluated. The widened branch therefore cannot fire on
 * today's population — and note the mechanism, because it is NOT the one that
 * was assumed: it is the VALUE guard, not the absence of priors on non-external
 * factors. A producer slip that puts a prior on a controllable factor still does
 * not activate this path, because the value guard is upstream of it.
 *
 * NO UNIVERSAL SEMANTIC FALLBACK (standing brief §9). Nothing here invents a
 * number. The widened branch only forwards a support the producer DECLARED; where
 * no prior exists, or the prior is degenerate or of an unsupported family,
 * PLoT still emits NOTHING and ISL discloses the defaulted root.
 */

import { describe, it, expect } from 'vitest';
import { buildParameterUncertaintiesV3 } from '../src/integrations/isl/translator-v3.js';
import type { EngineNodeV3 } from '../src/types/engine-v3.js';

/** Bind by IDENTITY — never by a value predicate a sibling could satisfy. */
function entryFor(
  result: ReturnType<typeof buildParameterUncertaintiesV3>,
  nodeId: string,
) {
  return (result ?? []).find((u) => u.node_id === nodeId);
}

const GOAL: EngineNodeV3 = { id: 'goal', kind: 'goal', label: 'Goal' };

describe('prior-bearing factors reach ISL regardless of category', () => {
  // ---------------------------------------------------------------------
  // ACCEPTANCE 1 — a controllable/observable factor WITH a prior produces
  // the uniform parameter-uncertainty.
  // ---------------------------------------------------------------------

  it('a CONTROLLABLE factor whose only statement is a prior → uniform carrying its declared support', () => {
    const nodes: EngineNodeV3[] = [
      {
        id: 'fac_hiring_rate',
        kind: 'factor',
        label: 'Hiring rate',
        category: 'controllable',
        prior: { distribution: 'uniform', range_min: 0.2, range_max: 0.8 },
      },
      GOAL,
    ];

    const entry = entryFor(buildParameterUncertaintiesV3(nodes), 'fac_hiring_rate');

    expect(entry).toBeDefined();
    expect(entry).toEqual({
      node_id: 'fac_hiring_rate',
      distribution: 'uniform',
      range_min: 0.2,
      range_max: 0.8,
    });
  });

  it('an OBSERVABLE factor whose only statement is a prior → uniform carrying its declared support', () => {
    const nodes: EngineNodeV3[] = [
      {
        id: 'fac_churn',
        kind: 'factor',
        label: 'Churn',
        category: 'observable',
        prior: { distribution: 'uniform', range_min: 0.05, range_max: 0.35 },
      },
      GOAL,
    ];

    const entry = entryFor(buildParameterUncertaintiesV3(nodes), 'fac_churn');

    expect(entry).toBeDefined();
    expect(entry).toEqual({
      node_id: 'fac_churn',
      distribution: 'uniform',
      range_min: 0.05,
      range_max: 0.35,
    });
  });

  it('a factor with NO category at all but a declared prior → uniform, because the prior is the statement', () => {
    // Not an incidental consequence of dropping the conjunct — pinned on
    // purpose. `graph-normaliser.ts` sets `category = undefined` whenever the
    // producer's category is missing, non-string or unrecognised, so a factor
    // can lose its label while keeping a perfectly good declared support. The
    // support is what ISL needs; the label is what a coach reads.
    const nodes: EngineNodeV3[] = [
      {
        id: 'fac_unlabelled',
        kind: 'factor',
        label: 'Unlabelled',
        prior: { distribution: 'uniform', range_min: 0.1, range_max: 0.9 },
      },
      GOAL,
    ];

    const entry = entryFor(buildParameterUncertaintiesV3(nodes), 'fac_unlabelled');

    expect(entry).toBeDefined();
    expect(entry).toEqual({
      node_id: 'fac_unlabelled',
      distribution: 'uniform',
      range_min: 0.1,
      range_max: 0.9,
    });
  });

  it('bounds are forwarded VERBATIM on the widened path — two supports of equal WIDTH stay distinguishable', () => {
    // The opposite-direction twin of the case above: a widening that
    // accidentally routed these through a width-only normal would collapse
    // [0.3,0.7] and [0.6,1.0] to byte-identical entries, which is the exact
    // defect the uniform family was introduced to kill. Two controllable
    // factors, same width, different support.
    const nodes: EngineNodeV3[] = [
      {
        id: 'fac_width_a',
        kind: 'factor',
        label: 'A',
        category: 'controllable',
        prior: { distribution: 'uniform', range_min: 0.3, range_max: 0.7 },
      },
      {
        id: 'fac_width_b',
        kind: 'factor',
        label: 'B',
        category: 'observable',
        prior: { distribution: 'uniform', range_min: 0.6, range_max: 1.0 },
      },
      GOAL,
    ];

    const result = buildParameterUncertaintiesV3(nodes);
    const a = entryFor(result, 'fac_width_a');
    const b = entryFor(result, 'fac_width_b');

    expect(a).toEqual({
      node_id: 'fac_width_a',
      distribution: 'uniform',
      range_min: 0.3,
      range_max: 0.7,
    });
    expect(b).toEqual({
      node_id: 'fac_width_b',
      distribution: 'uniform',
      range_min: 0.6,
      range_max: 1.0,
    });
    expect(a).not.toEqual(b);
  });

  // ---------------------------------------------------------------------
  // THE σ INTERACTION, STATED EXPLICITLY (translator-v3.ts:724).
  // `std = |value| * VALUE_BASED_STD_FRACTION` lives in the FIRST pass, which
  // is entered only by a factor with a finite `observed_state.value`. A
  // prior-only factor never reaches it, so it cannot acquire a σ derived from a
  // value it does not have. Both directions are pinned.
  // ---------------------------------------------------------------------

  it('a prior-only non-external factor carries NO std — it cannot inherit a σ derived from an absent value', () => {
    const nodes: EngineNodeV3[] = [
      {
        id: 'fac_prior_only',
        kind: 'factor',
        label: 'Prior only',
        category: 'controllable',
        prior: { distribution: 'uniform', range_min: 0.4, range_max: 0.6 },
      },
      GOAL,
    ];

    const entry = entryFor(buildParameterUncertaintiesV3(nodes), 'fac_prior_only');

    expect(entry).toBeDefined();
    expect(entry!.distribution).toBe('uniform');
    // No σ, and in particular not a σ synthesised from 0 (FALLBACK_STD) or
    // from a midpoint PLoT would have had to invent.
    expect(entry).not.toHaveProperty('std');
    // `mean` is not a member ISL declares — the bounds are the whole channel.
    expect(entry).not.toHaveProperty('mean');
  });

  it('OPPOSITE-DIRECTION TWIN — the same factor WITH a value takes the normal path and gets no bounds', () => {
    // value 0.8 is chosen so that |value| * 0.15 = 0.12 clears DEFAULT_STD_FLOOR
    // (0.1). At 0.6 the floor binds and returns 0.1, which would hide whether
    // :724's derivation ran at all — a guard that cannot see the thing it names.
    const nodes: EngineNodeV3[] = [
      {
        id: 'fac_prior_only',
        kind: 'factor',
        label: 'Prior only',
        category: 'controllable',
        observed_state: { value: 0.8 },
        prior: { distribution: 'uniform', range_min: 0.4, range_max: 0.6 },
      },
      GOAL,
    ];

    const entry = entryFor(buildParameterUncertaintiesV3(nodes), 'fac_prior_only');

    expect(entry).toBeDefined();
    expect(entry!.distribution).toBe('normal');
    expect(entry).not.toHaveProperty('range_min');
    expect(entry).not.toHaveProperty('range_max');
    expect((entry as { std: number }).std).toBeCloseTo(0.8 * 0.15, 10);
  });

  // ---------------------------------------------------------------------
  // ACCEPTANCE 2 — a factor WITHOUT a prior is unchanged. This is the entire
  // population today, and these cases are GREEN before and after the change.
  // ---------------------------------------------------------------------

  it('CONTROL — factors with no prior are untouched by the widening, in every category', () => {
    const nodes: EngineNodeV3[] = [
      { id: 'fac_c', kind: 'factor', label: 'C', category: 'controllable', observed_state: { value: 0.7 } },
      { id: 'fac_o', kind: 'factor', label: 'O', category: 'observable', observed_state: { value: 0.4 } },
      { id: 'fac_e', kind: 'factor', label: 'E', category: 'external' },
      { id: 'fac_n', kind: 'factor', label: 'N' },
      GOAL,
    ];

    const result = buildParameterUncertaintiesV3(nodes) ?? [];

    // Exactly the two value-bearing factors produce entries; the two with
    // neither a value nor a prior produce nothing, so ISL's root-default
    // detector still discloses them.
    expect(result.map((u) => u.node_id).sort()).toEqual(['fac_c', 'fac_o']);
    expect(entryFor(result, 'fac_c')).toEqual({ node_id: 'fac_c', distribution: 'normal', std: 0.7 * 0.15 });
    expect(entryFor(result, 'fac_o')).toEqual({ node_id: 'fac_o', distribution: 'normal', std: 0.1 });
    expect(entryFor(result, 'fac_e')).toBeUndefined();
    expect(entryFor(result, 'fac_n')).toBeUndefined();
  });

  // ---------------------------------------------------------------------
  // ACCEPTANCE 3 — POSITIVE CONTROL: external factors byte-identically
  // unaffected. Asserted as a full serialised comparison, not field by field,
  // so a change anywhere in the emitted entry is visible.
  // ---------------------------------------------------------------------

  it('POSITIVE CONTROL — the whole external population is byte-identical across the widening', () => {
    const externals: EngineNodeV3[] = [
      {
        id: 'ext_regulatory',
        kind: 'factor',
        label: 'Regulatory easing',
        category: 'external',
        prior: { distribution: 'uniform', range_min: 0.0, range_max: 1.0 },
      },
      {
        id: 'ext_demand',
        kind: 'factor',
        label: 'Demand',
        category: 'external',
        prior: { distribution: 'uniform', range_min: 0.6, range_max: 1.0 },
      },
      {
        id: 'ext_swapped',
        kind: 'factor',
        label: 'Swapped bounds',
        category: 'external',
        prior: { distribution: 'uniform', range_min: 0.9, range_max: 0.2 },
      },
      {
        id: 'ext_degenerate',
        kind: 'factor',
        label: 'Degenerate',
        category: 'external',
        prior: { distribution: 'uniform', range_min: 0.5, range_max: 0.5 },
      },
      {
        id: 'ext_unsupported',
        kind: 'factor',
        label: 'Unsupported family',
        category: 'external',
        prior: { distribution: 'normal', range_min: 0.1, range_max: 0.9 },
      },
      {
        id: 'ext_with_value',
        kind: 'factor',
        label: 'Value beats prior',
        category: 'external',
        observed_state: { value: 0.9 },
        prior: { distribution: 'uniform', range_min: 0.0, range_max: 1.0 },
      },
      GOAL,
    ];

    // Pinned literal, captured at pristine `669ba2bc` BEFORE the widening.
    // The swap repair fires, the degenerate range is declined, the unsupported
    // family is skipped, and observed_state still beats the prior.
    expect(JSON.stringify(buildParameterUncertaintiesV3(externals))).toBe(
      JSON.stringify([
        { node_id: 'ext_with_value', distribution: 'normal', std: 0.9 * 0.15 },
        { node_id: 'ext_regulatory', distribution: 'uniform', range_min: 0.0, range_max: 1.0 },
        { node_id: 'ext_demand', distribution: 'uniform', range_min: 0.6, range_max: 1.0 },
        { node_id: 'ext_swapped', distribution: 'uniform', range_min: 0.2, range_max: 0.9 },
      ]),
    );
  });

  // ---------------------------------------------------------------------
  // THE INERTNESS CASE — this is what makes step 1 safe to deploy alone, and
  // it is GREEN both before and after. It is a claim about CEE's CURRENT
  // contract, so it is written to fail loudly the day that contract changes.
  // ---------------------------------------------------------------------

  it('remains inert on a CEE-valid graph — every non-external factor carries a value, so the value guard wins', () => {
    // Shaped to CEE `graph-validator.ts` @ staging 91d39119: controllable and
    // observable factors MUST have `data.value`; external factors MUST NOT.
    // Priors are attached to the non-external factors deliberately — a producer
    // slip of exactly the kind PLoT's own PRIOR_ON_NON_EXTERNAL warning exists
    // to report — to show that even then the widened branch does not fire.
    const nodes: EngineNodeV3[] = [
      {
        id: 'fac_controllable',
        kind: 'factor',
        label: 'Controllable',
        category: 'controllable',
        observed_state: { value: 0.5 },
        prior: { distribution: 'uniform', range_min: 0.2, range_max: 0.8 },
      },
      {
        id: 'fac_observable',
        kind: 'factor',
        label: 'Observable',
        category: 'observable',
        observed_state: { value: 0.5 },
        prior: { distribution: 'uniform', range_min: 0.1, range_max: 0.4 },
      },
      {
        id: 'ext_untouched',
        kind: 'factor',
        label: 'External',
        category: 'external',
        prior: { distribution: 'uniform', range_min: 0.0, range_max: 1.0 },
      },
      GOAL,
    ];

    const result = buildParameterUncertaintiesV3(nodes) ?? [];

    // Both value-bearing factors take the normal path. Neither acquires bounds.
    for (const id of ['fac_controllable', 'fac_observable']) {
      const entry = entryFor(result, id);
      expect(entry, `${id} must still take the observed_state path`).toBeDefined();
      expect(entry!.distribution).toBe('normal');
      expect(entry).not.toHaveProperty('range_min');
    }
    // And the external factor is exactly as it was.
    expect(entryFor(result, 'ext_untouched')).toEqual({
      node_id: 'ext_untouched',
      distribution: 'uniform',
      range_min: 0.0,
      range_max: 1.0,
    });
    // No fourth entry appeared from anywhere.
    expect(result).toHaveLength(3);
  });

  // ---------------------------------------------------------------------
  // THE WIDENING DID NOT WIDEN FABRICATION. Every refusal that protects the
  // external path protects the widened path identically.
  // ---------------------------------------------------------------------

  it('a DEGENERATE prior on a non-external factor is DECLINED, not approximated to its point', () => {
    const nodes: EngineNodeV3[] = [
      {
        id: 'fac_degenerate',
        kind: 'factor',
        label: 'Degenerate',
        category: 'controllable',
        prior: { distribution: 'uniform', range_min: 0.5, range_max: 0.5 },
      },
      GOAL,
    ];

    // Emitting anything here would put a centre on the wire that nobody stated.
    // PLoT emits nothing and ISL fires ROOT_NODE_DEFAULT_VALUE instead.
    expect(entryFor(buildParameterUncertaintiesV3(nodes), 'fac_degenerate')).toBeUndefined();
  });

  it('an UNSUPPORTED prior family on a non-external factor is skipped, not coerced to uniform', () => {
    const nodes: EngineNodeV3[] = [
      {
        id: 'fac_beta',
        kind: 'factor',
        label: 'Beta prior',
        category: 'observable',
        prior: { distribution: 'beta', range_min: 0.1, range_max: 0.9 },
      },
      GOAL,
    ];

    expect(entryFor(buildParameterUncertaintiesV3(nodes), 'fac_beta')).toBeUndefined();
  });

  it('a NON-FINITE prior range on a non-external factor is skipped', () => {
    const nodes: EngineNodeV3[] = [
      {
        id: 'fac_nonfinite',
        kind: 'factor',
        label: 'Non-finite',
        category: 'controllable',
        prior: { distribution: 'uniform', range_min: Number.NaN, range_max: 0.9 },
      },
      GOAL,
    ];

    expect(entryFor(buildParameterUncertaintiesV3(nodes), 'fac_nonfinite')).toBeUndefined();
  });

  it('the widening reaches FACTORS ONLY — a non-factor node carrying a prior still emits nothing', () => {
    // Factors and edges are different populations (standing brief §9); so are
    // factors and goals/options. Dropping the category conjunct must not turn
    // `kind` into a soft condition too.
    const nodes: EngineNodeV3[] = [
      {
        id: 'opt_launch',
        kind: 'option',
        label: 'Launch',
        category: 'controllable',
        prior: { distribution: 'uniform', range_min: 0.2, range_max: 0.8 },
      } as EngineNodeV3,
      {
        id: 'goal_revenue',
        kind: 'goal',
        label: 'Revenue',
        prior: { distribution: 'uniform', range_min: 0.2, range_max: 0.8 },
      } as EngineNodeV3,
    ];

    expect(buildParameterUncertaintiesV3(nodes)).toBeUndefined();
  });
});
