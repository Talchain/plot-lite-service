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
  unitFamily,
  UNIT_FAMILIES,
  unitTokensForFamily,
  type UnitCompatibility,
} from '../src/lib/constraint-units.js';

/** Tokens observed or documented, with where each one came from. */
const OBSERVED_TOKENS: ReadonlyArray<{ token: string; provenance: string; family: string }> = [
  // --- constraint `unit`, read off real captures -------------------------
  { token: 'count', provenance: '[capture] scenario-people.json goal_constraints[0].unit', family: 'count' },
  { token: 'fraction', provenance: '[capture] scenario-pricing.json goal_constraints[0].unit', family: 'fraction' },
  // --- node `observed_state.unit`, read off real captures -----------------
  { token: '%', provenance: '[capture] risk_ae_attrition / risk_logo_churn observed_state.unit', family: 'percent' },
  { token: '£', provenance: '[capture] fac_price_level observed_state.unit', family: 'currency' },
  // --- vocabulary the type itself documents for the field -----------------
  { token: 'months', provenance: '[doc] types/engine-v3.ts:383 RawGoalConstraint.unit', family: 'duration' },
  { token: 'days', provenance: '[doc] types/engine-v3.ts:383 RawGoalConstraint.unit', family: 'duration' },
  { token: 'currency', provenance: '[doc] types/engine-v3.ts:383 RawGoalConstraint.unit', family: 'currency' },
  // --- conservative siblings ---------------------------------------------
  { token: 'percent', provenance: '[sibling] of %; already in the house isPercentUnit vocabulary', family: 'percent' },
  { token: 'pct', provenance: '[sibling] of %; already in the house isPercentUnit vocabulary', family: 'percent' },
  { token: 'percentage', provenance: '[sibling] of %; already in the house isPercentUnit vocabulary', family: 'percent' },
  { token: 'ratio', provenance: '[sibling] of fraction', family: 'fraction' },
  { token: 'proportion', provenance: '[sibling] of fraction', family: 'fraction' },
  { token: 'people', provenance: '[sibling] of count (the captured label was "Account executives lost")', family: 'count' },
  { token: 'headcount', provenance: '[sibling] of count', family: 'count' },
  { token: 'gbp', provenance: '[sibling] of £', family: 'currency' },
  { token: '$', provenance: '[sibling] of £', family: 'currency' },
  { token: 'weeks', provenance: '[sibling] of months/days', family: 'duration' },
  { token: 'years', provenance: '[sibling] of months/days', family: 'duration' },
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
  // Same quantity, differently spelled.
  { constraint: 'count', scale: 'count', expected: 'reconciled', why: 'identical' },
  { constraint: 'percent', scale: '%', expected: 'reconciled', why: 'same quantity, two spellings' },
  { constraint: 'currency', scale: '£', expected: 'reconciled', why: 'a currency target against a currency scale' },
  { constraint: 'gbp', scale: '£', expected: 'reconciled', why: 'same currency, two spellings' },
  { constraint: 'months', scale: 'weeks', expected: 'reconciled', why: 'both durations' },
  { constraint: 'ratio', scale: 'fraction', expected: 'reconciled', why: 'both dimensionless proportions' },
  // Different quantities.
  { constraint: 'months', scale: '%', expected: 'mismatched', why: 'a duration against a percentage' },
  { constraint: '£', scale: 'count', expected: 'mismatched', why: 'money against people' },
  { constraint: 'fraction', scale: '%', expected: 'mismatched', why: 'same KIND, different SCALE — refused, never silently ×100' },
  { constraint: 'people', scale: '£', expected: 'mismatched', why: 'people against money' },
  // Nothing declared on one side ⇒ no claim either way.
  { constraint: 'count', scale: '', expected: 'undeclared', why: 'the scale declared no unit' },
];

describe('unit-family corpus — the map is checked against hand-written reality', () => {
  it.each(OBSERVED_TOKENS)(
    'places $token in the $family family  ($provenance)',
    ({ token, family }) => {
      // Written by hand from what the token MEANS. If a token is dropped from
      // the map this reads `undefined` and fails by name — the completeness
      // check a derived guard structurally cannot perform.
      expect(unitFamily(token)).toBe(family);
    },
  );

  it.each(CORPUS_PAIRS)(
    'classifies $constraint vs $scale as $expected  ($why)',
    ({ constraint, scale, expected }) => {
      expect(classifyUnitCompatibility(constraint, scale)).toBe(expected);
    },
  );

  it('every declared family is non-empty and no token is claimed by two families', () => {
    const seen = new Map<string, string>();
    for (const family of UNIT_FAMILIES) {
      const tokens = unitTokensForFamily(family);
      expect(tokens.length, `family ${family} is empty`).toBeGreaterThan(0);
      for (const token of tokens) {
        const owner = seen.get(token);
        expect(owner, `token "${token}" is claimed by both ${owner} and ${family}`).toBeUndefined();
        seen.set(token, family);
        // Tokens must be stored canonically, or `canonicaliseUnit` could never
        // match them and the whole family would be silently unreachable.
        expect(token, `token "${token}" is not canonical`).toBe(token.trim().toLowerCase());
      }
    }
  });
});
