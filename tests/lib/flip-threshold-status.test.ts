/**
 * Flip Threshold Status Classifier Tests
 *
 * Display-honesty workstream: classifies the public, post-denormalised
 * flip_thresholds[] array so UI consumers can render the all-no-effect /
 * partial / unresolved cases honestly.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyFlipThresholdsStatus,
} from '../../src/lib/flip-threshold-status.js';
import type { DenormalisedFlipThreshold } from '../../src/lib/flip-threshold-denormaliser.js';

function makeEntry(overrides: Partial<DenormalisedFlipThreshold> = {}): DenormalisedFlipThreshold {
  return {
    factor_id: 'f1',
    factor_label: 'Factor One',
    current_value: 0.5,
    flip_value: 0.3,
    direction: 'decrease',
    flip_reason: 'found',
    iterations_used: 4,
    alternative_winner_id: 'opt-b',
    alternative_winner_label: 'Option Beta',
    unit: 'GBP',
    ...overrides,
  };
}

describe('classifyFlipThresholdsStatus()', () => {
  describe('unavailable', () => {
    it('returns unavailable for empty array', () => {
      expect(classifyFlipThresholdsStatus([])).toEqual({ status: 'unavailable' });
    });

    it('returns unavailable for null', () => {
      expect(classifyFlipThresholdsStatus(null)).toEqual({ status: 'unavailable' });
    });

    it('returns unavailable for undefined', () => {
      expect(classifyFlipThresholdsStatus(undefined)).toEqual({ status: 'unavailable' });
    });
  });

  describe('all_no_effect', () => {
    it('returns all_no_effect when every entry is no_effect_within_bounds', () => {
      const entries = [
        makeEntry({ flip_value: null, flip_reason: 'no_effect_within_bounds' }),
        makeEntry({ factor_id: 'f2', flip_value: null, flip_reason: 'no_effect_within_bounds' }),
        makeEntry({ factor_id: 'f3', flip_value: null, flip_reason: 'no_effect_within_bounds' }),
      ];
      expect(classifyFlipThresholdsStatus(entries)).toEqual({ status: 'all_no_effect' });
    });

    it('returns all_no_effect for a single no_effect entry', () => {
      const entries = [makeEntry({ flip_value: null, flip_reason: 'no_effect_within_bounds' })];
      expect(classifyFlipThresholdsStatus(entries)).toEqual({ status: 'all_no_effect' });
    });
  });

  describe('computed', () => {
    it('returns computed when every entry has a flip_value', () => {
      const entries = [
        makeEntry({ flip_value: 0.3, flip_reason: 'found' }),
        makeEntry({ factor_id: 'f2', flip_value: 0.7, flip_reason: 'found' }),
      ];
      expect(classifyFlipThresholdsStatus(entries)).toEqual({ status: 'computed' });
    });

    it('returns computed when actionable data exists alongside unresolved entries — absorption now ATTRIBUTABLE, not silent', () => {
      // ⚠ AMENDED BY REVIEW S1 (2.228-F3). The old expectation was a bare
      // `{ status: 'computed' }` and the old title said the unresolved entry was
      // "silently absorbed" — which it was. It still lands on `computed` (a flip
      // WAS found, and nothing is claimed about the row that did not resolve),
      // but `status_reason` now names what was absorbed, so the payload
      // discloses it. Strictly additive: the status token is unchanged.
      const entries = [
        makeEntry({ flip_value: 0.3, flip_reason: 'found' }),
        makeEntry({ factor_id: 'f2', flip_value: null, flip_reason: 'timeout' }),
      ];
      expect(classifyFlipThresholdsStatus(entries)).toEqual({
        status: 'computed',
        status_reason: 'timeout',
      });
    });

    it('treats flip_value === 0 as a valid computed flip (must not be silently demoted via truthiness)', () => {
      // Guards against a future regression that changes the null-check to
      // a truthiness check (`if (entry.flip_value)`), which would treat a
      // legitimate zero-valued flip threshold (e.g. a factor whose flip
      // point lands at zero cost) as unresolved.
      const entries = [
        makeEntry({ flip_value: 0, flip_reason: 'found' }),
      ];
      expect(classifyFlipThresholdsStatus(entries)).toEqual({ status: 'computed' });
    });
  });

  describe('partial_no_effect', () => {
    it('returns partial_no_effect when at least one entry is computed and one is no_effect', () => {
      const entries = [
        makeEntry({ flip_value: 0.3, flip_reason: 'found' }),
        makeEntry({ factor_id: 'f2', flip_value: null, flip_reason: 'no_effect_within_bounds' }),
      ];
      expect(classifyFlipThresholdsStatus(entries)).toEqual({ status: 'partial_no_effect' });
    });

    it('DOES NOT return partial_no_effect when unresolved entries are mixed in — the claim would be false', () => {
      // ⚠ REVERSED BY REVIEW S1 (2.228-F3). This test previously asserted
      // `partial_no_effect` here, on the rationale that `status_reason` lets
      // "the UI soften copy". That rationale does not hold: `status_reason` is
      // declared payload-only and is never rendered, so the copy shipped was
      // "some factors flip, THE REST CANNOT" — a claim about the timed-out row
      // that nobody had established. `partial_no_effect` is now reserved for a
      // CLEAN computed + attested-no-effect set, exactly as its sibling
      // `all_no_effect` has always been.
      const entries = [
        makeEntry({ flip_value: 0.3, flip_reason: 'found' }),
        makeEntry({ factor_id: 'f2', flip_value: null, flip_reason: 'no_effect_within_bounds' }),
        makeEntry({ factor_id: 'f3', flip_value: null, flip_reason: 'timeout' }),
      ];
      expect(classifyFlipThresholdsStatus(entries)).toEqual({
        status: 'computed',
        status_reason: 'timeout',
      });
    });

    it('omits status_reason on partial_no_effect when there are no unresolved entries (pure computed + no_effect mix)', () => {
      const entries = [
        makeEntry({ flip_value: 0.3, flip_reason: 'found' }),
        makeEntry({ factor_id: 'f2', flip_value: null, flip_reason: 'no_effect_within_bounds' }),
      ];
      expect(classifyFlipThresholdsStatus(entries)).toEqual({ status: 'partial_no_effect' });
    });

    it('records the FIRST unresolved reason when several unresolved kinds are present (status now computed — review S1)', () => {
      // Same reversal as above; the first-seen-reason behaviour is unchanged
      // and is what this case exists to pin.
      const entries = [
        makeEntry({ flip_value: 0.3, flip_reason: 'found' }),
        makeEntry({ factor_id: 'f2', flip_value: null, flip_reason: 'no_effect_within_bounds' }),
        makeEntry({ factor_id: 'f3', flip_value: null, flip_reason: 'insufficient_precision' }),
        makeEntry({ factor_id: 'f4', flip_value: null, flip_reason: 'timeout' }),
      ];
      expect(classifyFlipThresholdsStatus(entries)).toEqual({
        status: 'computed',
        status_reason: 'insufficient_precision',
      });
    });
  });

  describe('unresolved (must NOT be misclassified as no_effect)', () => {
    it('returns unresolved with reason for an all-timeout array', () => {
      const entries = [
        makeEntry({ flip_value: null, flip_reason: 'timeout' }),
        makeEntry({ factor_id: 'f2', flip_value: null, flip_reason: 'timeout' }),
      ];
      expect(classifyFlipThresholdsStatus(entries)).toEqual({
        status: 'unresolved',
        status_reason: 'timeout',
      });
    });

    it('returns unresolved with reason for an all-error array', () => {
      const entries = [makeEntry({ flip_value: null, flip_reason: 'error' })];
      expect(classifyFlipThresholdsStatus(entries)).toEqual({
        status: 'unresolved',
        status_reason: 'error',
      });
    });

    it('returns unresolved with reason for an all-insufficient_precision array', () => {
      const entries = [makeEntry({ flip_value: null, flip_reason: 'insufficient_precision' })];
      expect(classifyFlipThresholdsStatus(entries)).toEqual({
        status: 'unresolved',
        status_reason: 'insufficient_precision',
      });
    });

    it('returns unresolved when no_effect mixes with unresolved and there is no computed entry', () => {
      const entries = [
        makeEntry({ flip_value: null, flip_reason: 'no_effect_within_bounds' }),
        makeEntry({ factor_id: 'f2', flip_value: null, flip_reason: 'timeout' }),
      ];
      const result = classifyFlipThresholdsStatus(entries);
      expect(result.status).toBe('unresolved');
      expect(result.status_reason).toBe('timeout');
    });

    it('records the FIRST unresolved reason seen when several entries are unresolved', () => {
      const entries = [
        makeEntry({ flip_value: null, flip_reason: 'insufficient_precision' }),
        makeEntry({ factor_id: 'f2', flip_value: null, flip_reason: 'timeout' }),
      ];
      expect(classifyFlipThresholdsStatus(entries)).toEqual({
        status: 'unresolved',
        status_reason: 'insufficient_precision',
      });
    });

    it('treats an unknown reason with null flip_value as unresolved (conservative — never silently no_effect)', () => {
      const entries = [
        makeEntry({ flip_value: null, flip_reason: 'something_new_in_a_future_isl_version' }),
      ];
      expect(classifyFlipThresholdsStatus(entries)).toEqual({
        status: 'unresolved',
        status_reason: 'something_new_in_a_future_isl_version',
      });
    });

    it('classifies the post-fix timeout producer shape { flip_value: null, flip_reason: "timeout" } as unresolved, never computed', () => {
      // Mirrors exactly what the binary-search timeout branch now emits after the
      // timeout-honesty fix: a null threshold with reason 'timeout'. This MUST be
      // unresolved (not computed) so no downstream surface treats the absent
      // threshold as actionable. Before the fix this entry carried a non-null
      // bracket-midpoint flip_value and was misclassified as 'computed'.
      const entries = [makeEntry({ flip_value: null, flip_reason: 'timeout' })];
      const result = classifyFlipThresholdsStatus(entries);
      expect(result).toEqual({ status: 'unresolved', status_reason: 'timeout' });
      expect(result.status).not.toBe('computed');
    });
  });
});
