/**
 * Auto-noise disclosure builder + runtime guard (audit B3).
 *
 * Constructs `AutoNoiseProvenance` for emission on the V3 response when
 * analysis ran. Magnitude is fixed at multiplier=1.0 per Neil-approved
 * heuristic; Jinghui calibration brief tracks future change.
 *
 * Mirrors the A1 `buildConfidenceProvenance` pattern but is analysis-level:
 * one provenance object per run (auto-noise affects every outcome/risk
 * distribution globally), not one per factor.
 *
 * @see truth-table rows B3 (P0), F2-AUTO-NOISE-SILENCE (P1), U-015.
 */

import type {
  AutoNoiseCalibrationStatus,
  AutoNoiseDistribution,
  AutoNoiseEffect,
  AutoNoiseFilterScope,
  AutoNoiseFormulaVersion,
  AutoNoiseProvenance,
} from '../types/engine-v3.js';

// Single-valued enum literals captured once so the builder and the guard
// agree on the allowed surface. New enum members must be added in both
// engine-v3.ts and here.
const ALLOWED_EFFECT: ReadonlySet<AutoNoiseEffect> = new Set([
  'widens_outcome_and_risk_uncertainty',
]);
const ALLOWED_FORMULA_VERSION: ReadonlySet<AutoNoiseFormulaVersion> = new Set([
  'plot_auto_v1',
]);
const ALLOWED_DISTRIBUTION: ReadonlySet<AutoNoiseDistribution> = new Set([
  'normal_zero_mean_outcome_std',
]);
const ALLOWED_FILTER_SCOPE: ReadonlySet<AutoNoiseFilterScope> = new Set([
  'outcome_and_risk_nodes',
]);
const ALLOWED_CALIBRATION_STATUS: ReadonlySet<AutoNoiseCalibrationStatus> = new Set([
  'provisional_pending_pilot_calibration',
]);

/**
 * Build the analysis-level auto-noise provenance object. Always carries
 * full formula metadata, including when `applied: false`, so consumers can
 * disclose calibration status regardless of whether noise fired this run.
 */
export function buildAutoNoiseProvenance(applied: boolean): AutoNoiseProvenance {
  return {
    applied,
    effect: 'widens_outcome_and_risk_uncertainty',
    formula_version: 'plot_auto_v1',
    multiplier: 1.0,
    noise_distribution: 'normal_zero_mean_outcome_std',
    filter_scope: 'outcome_and_risk_nodes',
    is_provisional: true,
    calibration_status: 'provisional_pending_pilot_calibration',
  };
}

/**
 * Runtime type guard for `AutoNoiseProvenance`. Used by the public-boundary
 * regression test to assert outbound payloads conform to the declared enum
 * surface. No silent fallback: any malformed input returns `false`.
 */
export function isAutoNoiseProvenance(value: unknown): value is AutoNoiseProvenance {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;

  if (typeof v.applied !== 'boolean') return false;
  if (typeof v.is_provisional !== 'boolean') return false;
  if (typeof v.multiplier !== 'number' || !Number.isFinite(v.multiplier)) return false;

  if (typeof v.effect !== 'string' || !ALLOWED_EFFECT.has(v.effect as AutoNoiseEffect)) return false;
  if (
    typeof v.formula_version !== 'string' ||
    !ALLOWED_FORMULA_VERSION.has(v.formula_version as AutoNoiseFormulaVersion)
  ) return false;
  if (
    typeof v.noise_distribution !== 'string' ||
    !ALLOWED_DISTRIBUTION.has(v.noise_distribution as AutoNoiseDistribution)
  ) return false;
  if (
    typeof v.filter_scope !== 'string' ||
    !ALLOWED_FILTER_SCOPE.has(v.filter_scope as AutoNoiseFilterScope)
  ) return false;
  if (
    typeof v.calibration_status !== 'string' ||
    !ALLOWED_CALIBRATION_STATUS.has(v.calibration_status as AutoNoiseCalibrationStatus)
  ) return false;

  return true;
}
