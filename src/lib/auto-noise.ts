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
import type { ISLRobustnessAnalyzeV2Response } from '../integrations/isl/types/isl-types.js';

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
 * Result of extracting `auto_noise_applied` from an ISL V2 response.
 *
 * - `applied: true | false` — ISL emitted the flag explicitly.
 * - `applied: null, source: 'missing'` — ISL omitted the metadata field.
 *   Distinguishes "engine didn't tell us" from "engine said no" so the
 *   caller can emit observability and choose a conservative default
 *   without silently losing the signal (audit-feedback P1-2).
 */
export type ExtractedAutoNoiseFlag =
  | { applied: boolean; source: '_metadata' | 'metadata' | 'top_level' }
  | { applied: null; source: 'missing' };

/**
 * Read `auto_noise_applied` from an ISL V2 response. ISL's Pydantic model
 * declares the field on `ResponseMetadataV2` with `alias="_metadata"` and
 * serialises with `by_alias=True`, so the live wire shape is
 * `_metadata.auto_noise_applied`. Fixtures captured via Pydantic's
 * field-name mode (`populate_by_name=True`) may use `metadata.*` instead.
 * We also accept a top-level field for backward-compat with any cached
 * payloads that pre-date this disclosure work.
 *
 * Precedence: `_metadata` (wire alias) → `metadata` (field name) →
 * top-level → missing. Any non-boolean value (including null) at a
 * resolved location is treated as missing rather than coerced.
 */
export function extractIslAutoNoiseApplied(
  islResult: Pick<ISLRobustnessAnalyzeV2Response, '_metadata' | 'metadata'>
    & { auto_noise_applied?: unknown }
    | null
    | undefined,
): ExtractedAutoNoiseFlag {
  if (islResult == null || typeof islResult !== 'object') {
    return { applied: null, source: 'missing' };
  }

  const fromAlias = islResult._metadata?.auto_noise_applied;
  if (typeof fromAlias === 'boolean') return { applied: fromAlias, source: '_metadata' };

  const fromFieldName = islResult.metadata?.auto_noise_applied;
  if (typeof fromFieldName === 'boolean') return { applied: fromFieldName, source: 'metadata' };

  const fromTopLevel = (islResult as { auto_noise_applied?: unknown }).auto_noise_applied;
  if (typeof fromTopLevel === 'boolean') return { applied: fromTopLevel, source: 'top_level' };

  return { applied: null, source: 'missing' };
}

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
