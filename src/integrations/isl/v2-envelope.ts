/**
 * ISL V2 envelope accessors — single source of truth for WHERE science
 * fields live on the live V2 wire.
 *
 * PLoT pins `response_version=2` on every ISL call (client.ts). The live V2
 * envelope (verified against the raw staging capture at
 * `tests/fixtures/isl-v2-live-20260706/isl-staging-capture.json`, ISL build
 * f3f5d92, captured 2026-07-06) differs from the V1-era shapes several run.ts
 * reads assumed:
 *
 *   | field                | V1-era read (dead live)     | live V2 location            |
 *   |----------------------|-----------------------------|------------------------------|
 *   | edge E-values        | top-level `edge_e_values`   | `robustness.edge_e_values`   |
 *   | edge sensitivity     | top-level `sensitivity`     | NOT EMITTED (wire drops it)  |
 *   | validation status    | top-level `validation_status` | NOT EMITTED                |
 *   | computed timestamp   | top-level `computed_at`     | top-level `timestamp`        |
 *   | factor VOI           | `factor_sensitivity[].value_of_information` | top-level `factor_evpi[]` (per-factor EVPI) |
 *
 * All V2-location reads MUST go through these accessors so the location is
 * fixed in exactly one place.
 */

import type {
  ISLEdgeEValue,
  ISLFactorEvpiEntry,
  ISLRobustnessAnalyzeV2Response,
} from './types/isl-types.js';
import {
  classifyEvpiPercentagePointsForEmission,
  type EvpiEmissionClassification,
} from '../../lib/evpi-emission.js';

/**
 * Read edge E-values from an ISL response.
 *
 * Canonical V2 location is NESTED at `robustness.edge_e_values`; the V1-era
 * top-level `edge_e_values` is kept as a legacy fallback for old fixtures
 * only (the live V2 wire never emits it). Returns `undefined` when neither
 * location carries a non-empty array, so callers keep their existing
 * "computed-empty vs absent" semantics.
 */
export function getIslEdgeEValues(
  islResult: Partial<ISLRobustnessAnalyzeV2Response> | null | undefined,
): ISLEdgeEValue[] | undefined {
  const nested = islResult?.robustness?.edge_e_values;
  if (Array.isArray(nested)) return nested;
  const legacyTopLevel = islResult?.edge_e_values;
  if (Array.isArray(legacyTopLevel)) return legacyTopLevel;
  return undefined;
}

/**
 * Read the ISL-side computation timestamp from an ISL response.
 *
 * The live V2 wire carries `timestamp` (top-level, ISO 8601); the V1-era
 * `computed_at` field is never emitted on V2 and is kept only as a legacy
 * fallback for old fixtures. Returns `undefined` when neither is a string,
 * so the caller can fall back to its own clock (existing behaviour).
 */
export function getIslComputedAt(
  islResult:
    | (Partial<ISLRobustnessAnalyzeV2Response> & { computed_at?: unknown })
    | null
    | undefined,
): string | undefined {
  const ts = islResult?.timestamp;
  if (typeof ts === 'string' && ts.length > 0) return ts;
  const legacy = islResult?.computed_at;
  if (typeof legacy === 'string' && legacy.length > 0) return legacy;
  return undefined;
}

/**
 * Internal (non-user-facing) representation of a sanitised per-factor EVPI
 * entry from the V2 `factor_evpi` wire field.
 *
 * EVPI hygiene contract (Howard 1966 non-negativity; see evpi-emission.ts):
 * - `emit_pp` is the ONLY value any surface may ever show outward — it is
 *   either a finite value >= the emission resolution, or `undefined`.
 * - Negative and below-resolution raw values set `below_resolution: true`
 *   ("too small to measure at this sampling depth"), NEVER a clamped 0 and
 *   NEVER a negative — the raw value stays in `raw_*` diagnostics only.
 */
export interface InternalFactorEvpi {
  factor_id: string;
  /** Outward-safe EVPI in percentage points; undefined when below resolution */
  emit_pp: number | undefined;
  /** True when the raw estimate is below the emission resolution (incl. all negatives) */
  below_resolution: boolean;
  /** Raw wire value (diagnostics only — may be negative; MUST NOT be emitted) */
  raw_evpi: number;
  /** Raw wire value in percentage points (diagnostics only — may be negative) */
  raw_evpi_percentage_points: number;
  metric_type: string;
  n_evpi_samples: number;
}

/** Result of mapping the V2 `factor_evpi` wire field. */
export interface FactorEvpiMappingResult {
  /** Sanitised entries (one per valid wire entry) */
  entries: InternalFactorEvpi[];
  /** Count of wire entries dropped for structural invalidity (non-finite/missing) */
  dropped_invalid: number;
}

/**
 * Guarded internal mapping for the V2 `factor_evpi` field.
 *
 * IMPORTANT — P-5 pending: this data MUST NOT be wired into any user-facing
 * VOI/EVPI surface yet. The mapping exists to (a) prove the data arrives on
 * the live wire (fixture test) and (b) centralise the negative/below-resolution
 * hygiene so the eventual wiring cannot leak a raw negative EVPI outward.
 *
 * Behind `FLAGS.ISL_FACTOR_EVPI_INTERNAL` (default OFF) the route logs
 * diagnostics only; the public response is byte-identical either way.
 */
export function mapIslFactorEvpi(
  islResult: Partial<ISLRobustnessAnalyzeV2Response> | null | undefined,
): FactorEvpiMappingResult {
  const raw = islResult?.factor_evpi;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { entries: [], dropped_invalid: 0 };
  }

  const entries: InternalFactorEvpi[] = [];
  let droppedInvalid = 0;

  for (const e of raw as Array<Partial<ISLFactorEvpiEntry>>) {
    if (
      !e ||
      typeof e.factor_id !== 'string' ||
      typeof e.evpi !== 'number' ||
      !Number.isFinite(e.evpi) ||
      typeof e.evpi_percentage_points !== 'number' ||
      !Number.isFinite(e.evpi_percentage_points)
    ) {
      droppedInvalid += 1;
      continue;
    }

    const classification: EvpiEmissionClassification =
      classifyEvpiPercentagePointsForEmission(e.evpi_percentage_points);

    entries.push({
      factor_id: e.factor_id,
      emit_pp: classification.emit,
      below_resolution: classification.below_resolution,
      raw_evpi: e.evpi,
      raw_evpi_percentage_points: e.evpi_percentage_points,
      metric_type: typeof e.metric_type === 'string' ? e.metric_type : 'unknown',
      n_evpi_samples:
        typeof e.n_evpi_samples === 'number' && Number.isFinite(e.n_evpi_samples)
          ? e.n_evpi_samples
          : 0,
    });
  }

  return { entries, dropped_invalid: droppedInvalid };
}
