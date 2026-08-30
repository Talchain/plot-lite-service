/**
 * Intervention provenance: an ABSENT source must stay absent, never be
 * fabricated into `user_specified`.
 *
 * ============================================================================
 * WHAT WAS BROKEN (derived at the bytes on pristine 75e7f974, not inferred)
 * ============================================================================
 * `normalizeInterventions()` classified the incoming `source` like this:
 *
 *     const source = (intervention && typeof intervention === 'object')
 *       ? (intervention as { source?: string }).source
 *       : undefined;
 *     const validSource = (source === 'brief_extraction' || source === 'cee_hypothesis')
 *       ? source
 *       : 'user_specified';
 *
 * The else-branch is a FABRICATION, and it is the most damaging one available:
 * `user_specified` is the strongest possible claim of HUMAN AUTHORSHIP, and it
 * was applied to every value that did not arrive with a recognised provenance.
 *
 * A bare number is exactly that case, and a bare number is exactly what CEE
 * sends: CEE types `perOption` as `Array<Record<string, number>>`, and its
 * `plot-client.ts` THROWS on any non-number. So `typeof intervention === 'object'`
 * is false, `source` is `undefined`, and the value CEE invented was stamped
 * "the user said this".
 *
 * That launders an AI-invented anchor as the user's own judgement. Olumi exists
 * to improve the user's reasoning, not to hand them their own words back with a
 * number the model chose inside them.
 *
 * ============================================================================
 * TWO OPPOSITE HARMS — this suite guards BOTH doors
 * ============================================================================
 * Deleting a fabrication must not delete a TRUE attribution. The tests below
 * are written in opposite-direction PAIRS:
 *
 *   - a value with NO recognised provenance must come back with NO `source` key
 *     (absence is honest; an invented attribution is a lie);
 *   - a value with a GENUINE provenance — `brief_extraction`, `cee_hypothesis`,
 *     AND an explicitly-stated `user_specified` — must come back UNCHANGED.
 *
 * The `user_specified` case is the sharp one and it is why the fix is not
 * simply "change the else-branch to omission". Under the pristine code an
 * EXPLICIT `source: 'user_specified'` and an ABSENT source were INDISTINGUISHABLE
 * — both fell into the else-branch and both were stamped `user_specified`. A fix
 * that omits on the else-branch alone would therefore strip the stamp from
 * requests that genuinely stated it. Callers really do send it: the repo's own
 * `/v2/run` request fixtures carry `source: 'user_specified'` explicitly across
 * ~95 test files. So `user_specified` must be ACCEPTED as an explicit source and
 * omitted only when the source is absent or unrecognised.
 *
 * ============================================================================
 * WHY THIS IS A UNIT TEST AND NOT A ROUTE TEST
 * ============================================================================
 * The field is UNOBSERVABLE from outside the service, which is the whole reason
 * the defect was latent rather than live:
 *   - `toISLInterventions()` (integrations/isl/translator-v3.ts) reads only
 *     `.value` and STRIPS `.source`, so ISL never receives it — this is declared
 *     in PLOT_TO_ISL_CONTRACT.drops as `'intervention.source'`;
 *   - no `/v2/run` response path carries it: `buildBlockedResponse()` takes
 *     options as `ReadonlyArray<{ id: string; label: string }>` (labels only),
 *     and `interventions` is a REQUEST key in V2_RUN_ALLOWED_KEYS, never a
 *     response key.
 * A route-level assertion therefore CANNOT see the stamp, in either direction.
 * Binding the guard directly to the producing function is the only way to make
 * it discriminate — and it keeps discriminating if a consumer is added later,
 * which is the event that would arm this defect.
 */

import { describe, it, expect } from 'vitest';
import { normalizeInterventions } from '../src/routes/v2/run.js';

describe('normalizeInterventions: intervention provenance is never fabricated', () => {
  describe('an absent or unrecognised source must be OMITTED, not invented', () => {
    it('a bare number (the shape CEE sends) carries NO source key', () => {
      const result = normalizeInterventions({ marketing_spend: 60 });

      // Bind by identity: the key under test, not "some entry without a source".
      expect(Object.keys(result)).toEqual(['marketing_spend']);
      expect(result.marketing_spend.value).toBe(60);
      // `in` rather than `=== undefined`: an explicitly-present `source: undefined`
      // would satisfy the looser check while still shipping the key on the wire.
      expect('source' in result.marketing_spend).toBe(false);
      expect(result.marketing_spend).not.toHaveProperty('source');
    });

    it('an object with a value but no source carries NO source key', () => {
      const result = normalizeInterventions({ price: { value: 42 } });

      expect(result.price.value).toBe(42);
      expect('source' in result.price).toBe(false);
    });

    it('an UNRECOGNISED source is not laundered into user_specified', () => {
      const result = normalizeInterventions({
        churn: { value: 0.04, source: 'something_we_do_not_recognise' },
      });

      expect(result.churn.value).toBe(0.04);
      expect('source' in result.churn).toBe(false);
      // The specific harm: the unknown value must not be REPLACED by the
      // human-authorship claim.
      expect((result.churn as { source?: string }).source).not.toBe('user_specified');
    });
  });

  describe('OPPOSITE DIRECTION — a genuine attribution must survive unchanged', () => {
    it('brief_extraction passes through', () => {
      const result = normalizeInterventions({
        headcount: { value: 12, source: 'brief_extraction' },
      });

      expect(result.headcount).toEqual({ value: 12, source: 'brief_extraction' });
    });

    it('cee_hypothesis passes through', () => {
      const result = normalizeInterventions({
        conversion: { value: 0.3, source: 'cee_hypothesis' },
      });

      expect(result.conversion).toEqual({ value: 0.3, source: 'cee_hypothesis' });
    });

    it('an EXPLICITLY-STATED user_specified passes through — deleting a fabrication must not delete a true attribution', () => {
      const result = normalizeInterventions({
        budget: { value: 100000, source: 'user_specified' },
      });

      expect(result.budget).toEqual({ value: 100000, source: 'user_specified' });
      expect('source' in result.budget).toBe(true);
    });
  });

  describe('the fix changes provenance only — never WHAT WAS ANALYSED', () => {
    it('every value is preserved exactly across all source classes, in one call', () => {
      const result = normalizeInterventions({
        bare: 7,
        no_source: { value: 8 },
        unknown_source: { value: 9, source: 'nope' },
        from_brief: { value: 10, source: 'brief_extraction' },
        from_cee: { value: 11, source: 'cee_hypothesis' },
        from_user: { value: 12, source: 'user_specified' },
      });

      // Pin the precondition IN-TEST: the payload really does span the
      // stamped and unstamped classes, so the assertions below are the code's
      // doing and not a fixture that quietly stopped covering both branches.
      const withSource = Object.keys(result).filter((k) => 'source' in result[k]);
      const withoutSource = Object.keys(result).filter((k) => !('source' in result[k]));
      expect(withSource.sort()).toEqual(['from_brief', 'from_cee', 'from_user']);
      expect(withoutSource.sort()).toEqual(['bare', 'no_source', 'unknown_source']);

      expect(Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v.value]))).toEqual({
        bare: 7,
        no_source: 8,
        unknown_source: 9,
        from_brief: 10,
        from_cee: 11,
        from_user: 12,
      });
    });
  });

  describe('serialisation: an omitted source must not reappear as a null/undefined key', () => {
    it('JSON round-trip of an unattributed value has no source key at all', () => {
      const result = normalizeInterventions({ spend: 55 });
      const roundTripped = JSON.parse(JSON.stringify(result));

      expect(roundTripped.spend).toEqual({ value: 55 });
      expect('source' in roundTripped.spend).toBe(false);
    });
  });
});
