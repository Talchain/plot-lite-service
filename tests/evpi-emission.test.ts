/**
 * Unit tests for `src/lib/evpi-emission.ts` — the centralised non-negative
 * contract for `evpi_percentage_points` and the boundary guard for ISL-
 * emitted `value_of_information`.
 *
 * Pins the Howard-1966 contract end-to-end: EVPI is non-negative by
 * definition, Monte Carlo estimators produce small negative artefacts from
 * sampling noise, and PLoT must never surface a negative percentage to
 * users (it would falsely imply "learning more would make the decision
 * worse"). Both helpers are tested in isolation so the contract is
 * locked at the source-of-truth, not just downstream consumers.
 */

import { describe, it, expect } from 'vitest';
import { sanitiseIslVoi, computeEvpiPercentagePoints } from '../src/lib/evpi-emission.js';

describe('sanitiseIslVoi — boundary guard for ISL value_of_information', () => {
  describe('accepts valid non-negative finite numbers verbatim', () => {
    it('returns zero unchanged', () => {
      expect(sanitiseIslVoi(0)).toBe(0);
    });

    it('returns positive numbers in (0, 1] unchanged', () => {
      expect(sanitiseIslVoi(0.42)).toBe(0.42);
      expect(sanitiseIslVoi(1)).toBe(1);
    });

    it('returns positive numbers > 1 unchanged (no upper clamp at this layer)', () => {
      // Upper clamping is the producer's responsibility (e.g. computeValueOfInformation
      // clamps to [0,1]). This layer only enforces the non-negative contract.
      expect(sanitiseIslVoi(1.5)).toBe(1.5);
    });
  });

  describe('rejects values that violate the EVPI non-negativity contract', () => {
    it('returns undefined for small negatives (Monte Carlo sampling artefacts)', () => {
      expect(sanitiseIslVoi(-0.001)).toBeUndefined();
      expect(sanitiseIslVoi(-0.07)).toBeUndefined();
    });

    it('returns undefined for large negatives', () => {
      expect(sanitiseIslVoi(-1)).toBeUndefined();
      expect(sanitiseIslVoi(-100)).toBeUndefined();
    });

    it('returns undefined for NaN', () => {
      expect(sanitiseIslVoi(Number.NaN)).toBeUndefined();
    });

    it('returns undefined for ±Infinity', () => {
      expect(sanitiseIslVoi(Number.POSITIVE_INFINITY)).toBeUndefined();
      expect(sanitiseIslVoi(Number.NEGATIVE_INFINITY)).toBeUndefined();
    });
  });

  describe('rejects non-number types', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['empty string', ''],
      ['number-like string', '0.5'],
      ['object', { value_of_information: 0.5 }],
      ['array', [0.5]],
      ['boolean true', true],
      ['boolean false', false],
    ])('returns undefined for %s', (_label, input) => {
      expect(sanitiseIslVoi(input)).toBeUndefined();
    });
  });
});

describe('computeEvpiPercentagePoints — non-negative contract on emission', () => {
  describe('happy path: returns rounded clamped product', () => {
    it('emits a positive percentage for a positive VOI and positive spread', () => {
      // 0.5 * 0.4 * 100 = 20 — exact one-decimal rounded value
      expect(computeEvpiPercentagePoints(0.5, 0.4)).toBe(20);
    });

    it('emits 0 when VOI is 0 (no measurable value of information)', () => {
      expect(computeEvpiPercentagePoints(0, 0.4)).toBe(0);
    });

    it('rounds to one decimal place', () => {
      // 0.123 * 0.456 * 100 = 5.6088 → rounds to 5.6
      expect(computeEvpiPercentagePoints(0.123, 0.456)).toBeCloseTo(5.6, 5);
    });
  });

  describe('clamps negative computed values to 0 (EVPI non-negativity)', () => {
    it('clamps a small negative MC artefact to 0', () => {
      // Although sanitiseIslVoi at the boundary should have already
      // filtered this, defence-in-depth: if a negative VOI reaches the
      // emitter directly (e.g. a future producer bypasses the boundary),
      // the percentage still honours the contract.
      expect(computeEvpiPercentagePoints(-0.001, 0.5)).toBe(0);
    });

    it('clamps a large negative VOI to 0', () => {
      expect(computeEvpiPercentagePoints(-1, 0.5)).toBe(0);
    });
  });

  describe('returns undefined when inputs cannot produce a meaningful percentage', () => {
    it('returns undefined when VOI is null', () => {
      expect(computeEvpiPercentagePoints(null, 0.4)).toBeUndefined();
    });

    it('returns undefined when VOI is undefined', () => {
      expect(computeEvpiPercentagePoints(undefined, 0.4)).toBeUndefined();
    });

    it('returns undefined when VOI is NaN', () => {
      expect(computeEvpiPercentagePoints(Number.NaN, 0.4)).toBeUndefined();
    });

    it('returns undefined when VOI is ±Infinity', () => {
      expect(computeEvpiPercentagePoints(Number.POSITIVE_INFINITY, 0.4)).toBeUndefined();
      expect(computeEvpiPercentagePoints(Number.NEGATIVE_INFINITY, 0.4)).toBeUndefined();
    });

    it('returns undefined when winProbSpread is 0 (no discriminating choice)', () => {
      // Spread of 0 means all options have the same win probability —
      // there is no decision to inform, so EVPI is not meaningful.
      expect(computeEvpiPercentagePoints(0.5, 0)).toBeUndefined();
    });

    it('returns undefined when winProbSpread is negative (malformed input)', () => {
      // winProbSpread is always max - second_max, so should be >= 0; a
      // negative value indicates upstream bug — fail closed rather than
      // emit a sign-flipped percentage.
      expect(computeEvpiPercentagePoints(0.5, -0.1)).toBeUndefined();
    });

    it('returns undefined when winProbSpread is non-finite', () => {
      expect(computeEvpiPercentagePoints(0.5, Number.NaN)).toBeUndefined();
      expect(computeEvpiPercentagePoints(0.5, Number.POSITIVE_INFINITY)).toBeUndefined();
    });
  });

  describe('boundary + emitter compose correctly (Howard 1966 contract end-to-end)', () => {
    it('sanitised (undefined) VOI → undefined percentage (field is then omitted by callers)', () => {
      const sanitised = sanitiseIslVoi(-0.05);
      expect(sanitised).toBeUndefined();
      expect(computeEvpiPercentagePoints(sanitised, 0.4)).toBeUndefined();
    });

    it('sanitised positive VOI → positive percentage', () => {
      const sanitised = sanitiseIslVoi(0.5);
      expect(sanitised).toBe(0.5);
      expect(computeEvpiPercentagePoints(sanitised, 0.4)).toBe(20);
    });

    it('sanitised zero VOI → zero percentage', () => {
      const sanitised = sanitiseIslVoi(0);
      expect(sanitised).toBe(0);
      expect(computeEvpiPercentagePoints(sanitised, 0.4)).toBe(0);
    });

    it('all Monte Carlo negative artefacts (NaN, ±Inf, small/large negatives) collapse to undefined', () => {
      const mcArtefacts = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.001, -0.07, -1, -100];
      for (const artefact of mcArtefacts) {
        const sanitised = sanitiseIslVoi(artefact);
        expect(sanitised).toBeUndefined();
        expect(computeEvpiPercentagePoints(sanitised, 0.4)).toBeUndefined();
      }
    });
  });
});
