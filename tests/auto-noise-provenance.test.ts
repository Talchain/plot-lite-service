/**
 * Unit tests for auto-noise provenance builder + runtime guard (audit B3, P0).
 *
 * Mirrors the A1 confidence-provenance pattern: validates the enum surface
 * exactly so accidental drift produces a test failure, not a silent payload
 * change. Magnitude is fixed at 1.0 (Neil heuristic, Jinghui calibration
 * pending) — pinned by both shape and direct numeric assertion.
 */

import { describe, it, expect } from 'vitest';
import {
  buildAutoNoiseProvenance,
  isAutoNoiseProvenance,
} from '../src/lib/auto-noise.js';

describe('buildAutoNoiseProvenance', () => {
  it('builds a complete provenance object when applied=true', () => {
    const result = buildAutoNoiseProvenance(true);
    expect(result).toEqual({
      applied: true,
      effect: 'widens_outcome_and_risk_uncertainty',
      formula_version: 'plot_auto_v1',
      multiplier: 1.0,
      noise_distribution: 'normal_zero_mean_outcome_std',
      filter_scope: 'outcome_and_risk_nodes',
      is_provisional: true,
      calibration_status: 'provisional_pending_pilot_calibration',
    });
  });

  it('builds a complete provenance object with full metadata when applied=false', () => {
    const result = buildAutoNoiseProvenance(false);
    expect(result.applied).toBe(false);
    // Formula metadata must be intact even when noise did not fire — the
    // brief explicitly requires applied:false carries full provenance.
    expect(result.effect).toBe('widens_outcome_and_risk_uncertainty');
    expect(result.formula_version).toBe('plot_auto_v1');
    expect(result.multiplier).toBe(1.0);
    expect(result.noise_distribution).toBe('normal_zero_mean_outcome_std');
    expect(result.filter_scope).toBe('outcome_and_risk_nodes');
    expect(result.is_provisional).toBe(true);
    expect(result.calibration_status).toBe('provisional_pending_pilot_calibration');
  });

  it('pins multiplier at 1.0 — Neil-approved heuristic, Jinghui calibration pending', () => {
    expect(buildAutoNoiseProvenance(true).multiplier).toBe(1.0);
    expect(buildAutoNoiseProvenance(false).multiplier).toBe(1.0);
  });
});

describe('isAutoNoiseProvenance type guard', () => {
  const validBase = buildAutoNoiseProvenance(true);

  it('accepts a well-formed provenance object', () => {
    expect(isAutoNoiseProvenance(validBase)).toBe(true);
    expect(isAutoNoiseProvenance(buildAutoNoiseProvenance(false))).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty object', {}],
    ['array', [validBase]],
    ['string', 'not-an-object'],
    ['number', 42],
  ])('rejects non-object input: %s', (_label, input) => {
    expect(isAutoNoiseProvenance(input)).toBe(false);
  });

  it('rejects malformed enum values (no silent fallback)', () => {
    expect(isAutoNoiseProvenance({ ...validBase, effect: 'something_else' })).toBe(false);
    expect(isAutoNoiseProvenance({ ...validBase, formula_version: 'plot_auto_v2' })).toBe(false);
    expect(isAutoNoiseProvenance({ ...validBase, noise_distribution: 'uniform' })).toBe(false);
    expect(isAutoNoiseProvenance({ ...validBase, filter_scope: 'all_nodes' })).toBe(false);
    expect(isAutoNoiseProvenance({ ...validBase, calibration_status: 'calibrated' })).toBe(false);
  });

  it('rejects wrong field types', () => {
    expect(isAutoNoiseProvenance({ ...validBase, applied: 'true' })).toBe(false);
    expect(isAutoNoiseProvenance({ ...validBase, is_provisional: 1 })).toBe(false);
    expect(isAutoNoiseProvenance({ ...validBase, multiplier: '1.0' })).toBe(false);
    expect(isAutoNoiseProvenance({ ...validBase, multiplier: NaN })).toBe(false);
    expect(isAutoNoiseProvenance({ ...validBase, multiplier: Infinity })).toBe(false);
  });

  it('rejects missing required keys', () => {
    const { applied: _omit, ...withoutApplied } = validBase;
    expect(isAutoNoiseProvenance(withoutApplied)).toBe(false);

    const { effect: _omit2, ...withoutEffect } = validBase;
    expect(isAutoNoiseProvenance(withoutEffect)).toBe(false);

    const { calibration_status: _omit3, ...withoutCal } = validBase;
    expect(isAutoNoiseProvenance(withoutCal)).toBe(false);
  });
});
