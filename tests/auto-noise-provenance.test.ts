/**
 * Unit tests for auto-noise provenance builder + runtime guard (audit B3, P0).
 *
 * Mirrors the A1 confidence-provenance pattern: validates the enum surface
 * exactly so accidental drift produces a test failure, not a silent payload
 * change. Magnitude is fixed at 1.0 (Neil heuristic, Jinghui calibration
 * pending) — pinned by both shape and direct numeric assertion.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  AUTO_NOISE_FLAG_MISSING_EVENT,
  buildAutoNoiseProvenance,
  extractIslAutoNoiseApplied,
  isAutoNoiseProvenance,
  logAutoNoiseFlagMissingFromIsl,
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

describe('extractIslAutoNoiseApplied', () => {
  // ISL's actual wire shape is `_metadata.auto_noise_applied`
  // (Pydantic alias). `metadata.*` accepted as Pydantic field-name
  // alternative; top-level accepted as a backward-compat passthrough.
  it('reads from `_metadata.auto_noise_applied` (live ISL alias)', () => {
    expect(extractIslAutoNoiseApplied({ _metadata: { auto_noise_applied: true } } as any))
      .toEqual({ applied: true, source: '_metadata' });
    expect(extractIslAutoNoiseApplied({ _metadata: { auto_noise_applied: false } } as any))
      .toEqual({ applied: false, source: '_metadata' });
  });

  it('reads from `metadata.auto_noise_applied` (field-name alternative)', () => {
    expect(extractIslAutoNoiseApplied({ metadata: { auto_noise_applied: true } } as any))
      .toEqual({ applied: true, source: 'metadata' });
  });

  it('falls back to top-level `auto_noise_applied` when both metadata keys are missing', () => {
    expect(extractIslAutoNoiseApplied({ auto_noise_applied: true } as any))
      .toEqual({ applied: true, source: 'top_level' });
  });

  it('precedence: `_metadata` > `metadata` > top_level', () => {
    expect(
      extractIslAutoNoiseApplied({
        _metadata: { auto_noise_applied: true },
        metadata: { auto_noise_applied: false },
        auto_noise_applied: false,
      } as any),
    ).toEqual({ applied: true, source: '_metadata' });
    expect(
      extractIslAutoNoiseApplied({
        metadata: { auto_noise_applied: true },
        auto_noise_applied: false,
      } as any),
    ).toEqual({ applied: true, source: 'metadata' });
  });

  it('returns missing for null/undefined/non-object input', () => {
    expect(extractIslAutoNoiseApplied(null)).toEqual({ applied: null, source: 'missing' });
    expect(extractIslAutoNoiseApplied(undefined)).toEqual({ applied: null, source: 'missing' });
  });

  it('returns missing when ISL omits the flag entirely', () => {
    expect(extractIslAutoNoiseApplied({} as any)).toEqual({ applied: null, source: 'missing' });
    expect(extractIslAutoNoiseApplied({ _metadata: {} } as any))
      .toEqual({ applied: null, source: 'missing' });
    expect(extractIslAutoNoiseApplied({ metadata: { n_samples: 1000 } } as any))
      .toEqual({ applied: null, source: 'missing' });
  });

  it('treats non-boolean values as missing (never coerces)', () => {
    expect(extractIslAutoNoiseApplied({ _metadata: { auto_noise_applied: 'true' } } as any))
      .toEqual({ applied: null, source: 'missing' });
    expect(extractIslAutoNoiseApplied({ _metadata: { auto_noise_applied: 1 } } as any))
      .toEqual({ applied: null, source: 'missing' });
    expect(extractIslAutoNoiseApplied({ _metadata: { auto_noise_applied: null } } as any))
      .toEqual({ applied: null, source: 'missing' });
  });

  it('does NOT silently fall through from a malformed canonical `_metadata` to `metadata` or top-level', () => {
    // Audit-feedback Imp-2: if the canonical payload location is present
    // but corrupt, do not coincidentally rescue using a lower-precedence
    // value. The committed-on-object semantics surface the corruption
    // as 'missing' so the caller can emit an observability warning.
    expect(
      extractIslAutoNoiseApplied({
        _metadata: { auto_noise_applied: 'not-a-boolean' },
        metadata: { auto_noise_applied: true },
        auto_noise_applied: true,
      } as any),
    ).toEqual({ applied: null, source: 'missing' });

    expect(
      extractIslAutoNoiseApplied({
        _metadata: {}, // empty canonical object — committed on object presence
        metadata: { auto_noise_applied: true },
      } as any),
    ).toEqual({ applied: null, source: 'missing' });

    // Same rule one tier down: malformed `metadata` doesn't fall through
    // to top-level when the canonical `_metadata` is absent.
    expect(
      extractIslAutoNoiseApplied({
        metadata: { auto_noise_applied: 0 },
        auto_noise_applied: true,
      } as any),
    ).toEqual({ applied: null, source: 'missing' });
  });
});

describe('logAutoNoiseFlagMissingFromIsl', () => {
  // Audit-feedback P1-2: capture the contract-drift log so the event
  // name + severity are pinned by tests, not just by code inspection.
  it('emits via `warn` severity (contract drift, not info chatter)', () => {
    const warn = vi.fn();
    const info = vi.fn();
    logAutoNoiseFlagMissingFromIsl(
      { warn, info } as any,
      { requestId: 'req-1', analysisStatus: 'partial' },
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(info).not.toHaveBeenCalled();
  });

  it('uses the standard `event:` key (matches repo log-search convention)', () => {
    const warn = vi.fn();
    logAutoNoiseFlagMissingFromIsl(
      { warn },
      { requestId: 'req-2', analysisStatus: 'computed' },
    );
    const [obj, msg] = warn.mock.calls[0];
    expect(obj).toMatchObject({
      event: AUTO_NOISE_FLAG_MISSING_EVENT,
      request_id: 'req-2',
      analysis_status: 'computed',
    });
    // Field name pinned: `event`, not `evt` (a previous draft used the
    // wrong key — this regression-pins the convention).
    expect(obj).not.toHaveProperty('evt');
    expect(typeof msg).toBe('string');
    expect(msg).toMatch(/auto_noise/);
  });

  it('exports a stable event-name constant for log-search consumers', () => {
    expect(AUTO_NOISE_FLAG_MISSING_EVENT).toBe('auto_noise_flag_missing_from_isl');
  });

  it('is a no-op when the logger is undefined (safe to call on every code path)', () => {
    expect(() =>
      logAutoNoiseFlagMissingFromIsl(undefined, {
        requestId: 'req-3',
        analysisStatus: 'partial',
      }),
    ).not.toThrow();
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
