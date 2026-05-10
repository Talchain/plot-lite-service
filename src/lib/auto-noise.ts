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
 * Precedence (strict, no silent fall-through on corruption):
 * 1. `_metadata.auto_noise_applied` — the canonical ISL wire location.
 * 2. Else `metadata.auto_noise_applied` — Pydantic field-name alternate.
 * 3. Else top-level `auto_noise_applied` — legacy cached payloads.
 * 4. Else `{ applied: null, source: 'missing' }`.
 *
 * Commitment rule: tier resolution is on **own-key presence** (via
 * `Object.hasOwn`), not value shape. Once a tier's key exists on the
 * response, the search stops there — even if the value is the wrong
 * type (e.g. `_metadata: "bad"`) or the inner field is missing or
 * non-boolean, the helper returns `{ applied: null, source: 'missing' }`
 * rather than silently rescuing via a coincident lower-precedence key.
 * That keeps corruption visible (paired with the
 * `auto_noise_flag_missing_from_isl` warn log at the route layer)
 * instead of hiding it behind whichever fallback happens to be present.
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
  const r = islResult as Record<string, unknown>;

  // Precedence-1: canonical `_metadata` (Pydantic alias). Committed on
  // own-key presence — a non-object or null value here is corruption,
  // not a cue to fall through.
  if (Object.hasOwn(r, '_metadata')) {
    return readNestedFlag(r._metadata, '_metadata');
  }

  // Precedence-2: field-name alternate.
  if (Object.hasOwn(r, 'metadata')) {
    return readNestedFlag(r.metadata, 'metadata');
  }

  // Precedence-3: legacy top-level. Committed on own-key presence too;
  // same defensive principle.
  if (Object.hasOwn(r, 'auto_noise_applied')) {
    const v = r.auto_noise_applied;
    return typeof v === 'boolean'
      ? { applied: v, source: 'top_level' }
      : { applied: null, source: 'missing' };
  }

  return { applied: null, source: 'missing' };
}

/**
 * Resolve a flag from a nested-metadata candidate. The candidate may be
 * any unknown value because the caller has already committed on the
 * outer key's presence; this function decides whether the *value* is a
 * usable shape.
 */
function readNestedFlag(
  candidate: unknown,
  source: '_metadata' | 'metadata',
): ExtractedAutoNoiseFlag {
  if (candidate == null || typeof candidate !== 'object') {
    return { applied: null, source: 'missing' };
  }
  const v = (candidate as Record<string, unknown>).auto_noise_applied;
  return typeof v === 'boolean'
    ? { applied: v, source }
    : { applied: null, source: 'missing' };
}

/**
 * Logger shape used by `logAutoNoiseFlagMissingFromIsl`. Compatible with
 * Pino / Fastify's `req.log`. Callers without a logger pass `undefined`
 * and the call is a no-op.
 */
export interface AutoNoiseDriftLogger {
  warn: (obj: object, msg?: string) => void;
}

/**
 * Standard event name for the contract-drift signal emitted when
 * `extractIslAutoNoiseApplied` reports `source: 'missing'` on a
 * computed/partial response. Pinned as a constant so log consumers
 * (Splunk / Grafana queries, alerts) and tests share one source of
 * truth.
 */
export const AUTO_NOISE_FLAG_MISSING_EVENT = 'auto_noise_flag_missing_from_isl' as const;

/**
 * Emit a structured warning when ISL omits `auto_noise_applied` on a
 * computed/partial response. This is contract drift — a healthy ISL
 * always populates `_metadata.auto_noise_applied` — so the signal
 * deserves `warn` severity, not `info`. The repo-standard `event:` key
 * (mirrors run.ts:2605, 2630, 4697) is used so existing log search
 * predicates pick it up.
 *
 * No-op when `logger` is undefined so the helper is safe to call from
 * any code path (including ones without a per-request logger).
 */
export function logAutoNoiseFlagMissingFromIsl(
  logger: AutoNoiseDriftLogger | undefined,
  context: { requestId: string; analysisStatus: 'computed' | 'partial' },
): void {
  logger?.warn(
    {
      event: AUTO_NOISE_FLAG_MISSING_EVENT,
      request_id: context.requestId,
      analysis_status: context.analysisStatus,
    },
    'auto_noise flag absent from ISL metadata on computed/partial response',
  );
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
