/**
 * THE CORPUS — the guard that notices the unit-family list is SHORT.
 *
 * WHY THIS FILE IS SEPARATE FROM `constraint-unit-mismatch.test.ts`, and why it
 * is deliberately hand-written rather than derived. The estate has paid for
 * this lesson once already: replacing a hand-copied list with a guard DERIVED
 * from one canonical map fixes consumers drifting from the map, and is
 * STRUCTURALLY BLIND to the map itself being incomplete — a magnitude alphabet
 * was missing `thousand` and every derived per-key guard stayed green, because
 * derivation can prove agreement and can never prove completeness. What caught
 * it was a hand-written corpus.
 *
 * So the two guards are NOT redundant and neither supersedes the other:
 *   - `constraint-unit-mismatch.test.ts` proves the PREDICATE behaves, using
 *     the real capture — it is derived from the map;
 *   - this file proves the MAP is right, using tokens written down by hand from
 *     what producers were observed to emit — it is not.
 *
 * PROVENANCE OF EVERY TOKEN BELOW. `[capture]` = read out of a real staging
 * artefact in `PHASE0-EVIDENCE-2026-07-28/l60-artefacts/`. `[doc]` = the
 * vocabulary `types/engine-v3.ts` itself documents for the field. `[sibling]` =
 * a conservative sibling of a `[capture]`/`[doc]` token, included because a
 * producer that emits one plausibly emits the other. Nothing here is a token
 * invented to make the map look complete.
 *
 * ⚠ ERROR DIRECTION, stated so a future reader does not "fix" it the wrong way:
 * `classifyUnitCompatibility` fails CLOSED, so a token this corpus is missing
 * produces an honest REFUSAL, never a silent rescale. Adding a token to the map
 * is therefore a coverage decision that must be justified; removing one can
 * only cost coverage. A pair that SHOULD be reconciled and reads `mismatched`
 * is a real finding and belongs in the map — but only with its provenance.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyUnitCompatibility,
  unitScale,
  unitDimension,
  UNIT_SCALES,
  unitTokensForScale,
  dimensionOfScale,
  type UnitCompatibility,
} from '../src/lib/constraint-units.js';

/**
 * Tokens observed or documented, with where each one came from.
 *
 * BOTH columns are written by hand, and they are DIFFERENT claims: `scale` is
 * the unit (what compatibility keys on) and `dimension` is the quantity (what
 * it must NOT key on). A token that lands in the right dimension but the wrong
 * scale is precisely the defect that shipped once — `months` filed as "a
 * duration" and therefore blessed against `weeks` — so pinning only the
 * dimension would have been green through it.
 */
const OBSERVED_TOKENS: ReadonlyArray<{
  token: string;
  provenance: string;
  scale: string;
  dimension: string;
}> = [
  // --- constraint `unit`, read off real captures -------------------------
  { token: 'count', provenance: '[capture] scenario-people.json goal_constraints[0].unit', scale: 'count', dimension: 'count' },
  { token: 'fraction', provenance: '[capture] scenario-pricing.json goal_constraints[0].unit', scale: 'fraction', dimension: 'fraction' },
  // --- node `observed_state.unit`, read off real captures -----------------
  { token: '%', provenance: '[capture] risk_ae_attrition / risk_logo_churn observed_state.unit', scale: 'percent', dimension: 'percent' },
  { token: '£', provenance: '[capture] fac_price_level observed_state.unit; ALSO a constraint unit — probe-plot-response.json goal_constraints[gc-l60-probe].unit', scale: 'currency_gbp', dimension: 'currency' },
  // --- vocabulary the type itself documents for the field -----------------
  { token: 'months', provenance: '[doc] types/engine-v3.ts:383 RawGoalConstraint.unit', scale: 'duration_months', dimension: 'duration' },
  { token: 'days', provenance: '[doc] types/engine-v3.ts:383 RawGoalConstraint.unit', scale: 'duration_days', dimension: 'duration' },
  { token: 'currency', provenance: '[doc] types/engine-v3.ts:383 RawGoalConstraint.unit — names the dimension, declares no scale', scale: 'currency_unspecified', dimension: 'currency' },
  // --- measured CEE emissions with no enum bounding them ------------------
  { token: 'hours', provenance: '[producer] CEE staging 8278efc2 compound-goal/extractor.ts:212 + graph-evaluator fixtures 05/06', scale: 'duration_hours', dimension: 'duration' },
  { token: 'minutes', provenance: '[producer] CEE staging 8278efc2 compound-goal/extractor.ts:212', scale: 'duration_minutes', dimension: 'duration' },
  // --- conservative siblings ---------------------------------------------
  { token: 'percent', provenance: '[sibling] of %; already in the house isPercentUnit vocabulary', scale: 'percent', dimension: 'percent' },
  { token: 'pct', provenance: '[sibling] of %; already in the house isPercentUnit vocabulary', scale: 'percent', dimension: 'percent' },
  { token: 'percentage', provenance: '[sibling] of %; already in the house isPercentUnit vocabulary', scale: 'percent', dimension: 'percent' },
  { token: 'ratio', provenance: '[sibling] of fraction', scale: 'fraction', dimension: 'fraction' },
  { token: 'proportion', provenance: '[sibling] of fraction', scale: 'fraction', dimension: 'fraction' },
  { token: 'people', provenance: '[sibling] of count (the captured label was "Account executives lost")', scale: 'count', dimension: 'count' },
  { token: 'headcount', provenance: '[sibling] of count', scale: 'count', dimension: 'count' },
  { token: 'gbp', provenance: '[sibling] of £ — SAME currency, so the same scale', scale: 'currency_gbp', dimension: 'currency' },
  { token: '$', provenance: '[sibling] of £ in dimension only — a DIFFERENT currency, so a different scale', scale: 'currency_usd', dimension: 'currency' },
  { token: 'weeks', provenance: '[sibling] of months/days in dimension only — a different magnitude, so a different scale', scale: 'duration_weeks', dimension: 'duration' },
  { token: 'years', provenance: '[sibling] of months/days in dimension only — a different magnitude, so a different scale', scale: 'duration_years', dimension: 'duration' },
];

/**
 * Hand-written PAIRS with the verdict a human judges correct, written from the
 * quantities the tokens name — NOT read back off the family map. This is the
 * half that can notice the map is wrong.
 */
const CORPUS_PAIRS: ReadonlyArray<{
  constraint: string;
  scale: string;
  expected: UnitCompatibility;
  why: string;
}> = [
  // THE WITNESSED DEFECT.
  { constraint: 'count', scale: '%', expected: 'mismatched', why: 'people vs a percentage — the 7fe412ba capture' },
  // Same UNIT, differently spelled — the only thing that licenses a divide.
  { constraint: 'count', scale: 'count', expected: 'reconciled', why: 'identical' },
  { constraint: 'percent', scale: '%', expected: 'reconciled', why: 'same quantity, two spellings' },
  { constraint: 'gbp', scale: '£', expected: 'reconciled', why: 'same currency, two spellings' },
  { constraint: 'months', scale: 'month', expected: 'reconciled', why: 'same unit, singular/plural' },
  { constraint: 'hours', scale: 'hour', expected: 'reconciled', why: 'same unit, singular/plural' },
  { constraint: 'ratio', scale: 'fraction', expected: 'reconciled', why: 'both dimensionless proportions, factor 1' },
  { constraint: 'money', scale: 'currency', expected: 'reconciled', why: 'both decline to name a currency; neither claims a scale the other contradicts' },
  // ⚠ SAME DIMENSION, DIFFERENT SCALE — the F1 class. Each of these was
  // `reconciled` under the old dimension-keyed map. Verdicts written from what
  // the tokens MEAN, not read back off the table.
  { constraint: 'months', scale: 'weeks', expected: 'mismatched', why: 'both durations, but 6 months is 26 weeks — a 4.33x rescale, and nothing attests the calendar convention' },
  { constraint: 'years', scale: 'months', expected: 'mismatched', why: 'both durations, factor 12' },
  { constraint: 'quarters', scale: 'months', expected: 'mismatched', why: 'both durations, factor 3' },
  { constraint: 'hours', scale: 'days', expected: 'mismatched', why: 'both durations, factor 24' },
  { constraint: '$', scale: '£', expected: 'mismatched', why: 'both money, but the conversion is an FX rate the product does not hold' },
  { constraint: 'usd', scale: 'gbp', expected: 'mismatched', why: 'the same pair, spelled out' },
  { constraint: 'currency', scale: '£', expected: 'mismatched', why: 'a threshold declared only "currency" could be dollars; dividing it by a GBP cap is an unattested FX assumption — a dimension is not a unit' },
  // Different quantities.
  { constraint: 'months', scale: '%', expected: 'mismatched', why: 'a duration against a percentage' },
  { constraint: '£', scale: 'count', expected: 'mismatched', why: 'money against people' },
  { constraint: 'fraction', scale: '%', expected: 'mismatched', why: 'same KIND, different SCALE — refused, never silently x100' },
  { constraint: 'people', scale: '£', expected: 'mismatched', why: 'people against money' },
  // Nothing declared on one side ⇒ no claim either way.
  { constraint: 'count', scale: '', expected: 'undeclared', why: 'the scale declared no unit' },
];

describe('unit-scale corpus — the table is checked against hand-written reality', () => {
  it.each(OBSERVED_TOKENS)(
    'places $token in the $scale scale ($dimension)  ($provenance)',
    ({ token, scale, dimension }) => {
      // Written by hand from what the token MEANS. If a token is dropped from
      // the table this reads `undefined` and fails by name — the completeness
      // check a derived guard structurally cannot perform.
      expect(unitScale(token)).toBe(scale);
      // The dimension is pinned SEPARATELY and deliberately: it is the claim
      // the predicate must NOT be allowed to key on, so it needs its own
      // expectation rather than being inferred from the scale.
      expect(unitDimension(token)).toBe(dimension);
    },
  );

  it.each(CORPUS_PAIRS)(
    'classifies $constraint vs $scale as $expected  ($why)',
    ({ constraint, scale, expected }) => {
      expect(classifyUnitCompatibility(constraint, scale)).toBe(expected);
    },
  );

  it('every declared scale is non-empty, canonical, dimensioned, and owns its tokens alone', () => {
    const seen = new Map<string, string>();
    for (const scale of UNIT_SCALES) {
      const tokens = unitTokensForScale(scale);
      expect(tokens.length, `scale ${scale} is empty`).toBeGreaterThan(0);
      // Every scale must name the quantity it measures, or `unitDimension`
      // would silently read `undefined` for a token that IS in the table.
      expect(dimensionOfScale(scale), `scale ${scale} declares no dimension`).toBeDefined();
      for (const token of tokens) {
        const owner = seen.get(token);
        expect(owner, `token "${token}" is claimed by both ${owner} and ${scale}`).toBeUndefined();
        seen.set(token, scale);
        // Tokens must be stored canonically, or `canonicaliseUnit` could never
        // match them and the whole scale would be silently unreachable.
        expect(token, `token "${token}" is not canonical`).toBe(token.trim().toLowerCase());
      }
    }
  });
});
