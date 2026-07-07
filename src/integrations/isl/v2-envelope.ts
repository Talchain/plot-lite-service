/**
 * ISL V2 envelope accessors — single source of truth for WHERE science
 * fields live on the live V2 wire.
 *
 * PLoT pins `response_version=2` on every ISL call (client.ts). The live V2
 * envelope (verified against the raw staging captures at
 * `tests/fixtures/isl-v2-live-20260706/` — ISL build f3f5d92, 2026-07-06 —
 * and `tests/fixtures/isl-v2-live-20260707/` — ISL build 9a22a1a,
 * 2026-07-07) differs from the V1-era shapes several run.ts reads assumed:
 *
 *   | field                | V1-era read (dead live)     | live V2 location            |
 *   |----------------------|-----------------------------|------------------------------|
 *   | edge E-values        | top-level `edge_e_values`   | `robustness.edge_e_values`   |
 *   | edge sensitivity     | top-level `sensitivity`     | `robustness.edge_sensitivity` (build 9a22a1a+; ABSENT on older builds) |
 *   | validation status    | top-level `validation_status` | NOT EMITTED                |
 *   | computed timestamp   | top-level `computed_at`     | top-level `timestamp`        |
 *   | factor VOI           | `factor_sensitivity[].value_of_information` | top-level `factor_evpi[]` (per-factor EVPI) |
 *
 * All V2-location reads MUST go through these accessors so the location is
 * fixed in exactly one place.
 */

import type {
  ISLEdgeEValue,
  ISLEdgeSensitivityV2,
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
 * Read edge-level sensitivity from an ISL response.
 *
 * Canonical V2 location is NESTED at `robustness.edge_sensitivity`
 * (`EdgeSensitivityV2` entries; first emitted by ISL build 9a22a1a — lane 11
 * / ISL PR #65 — and verified against the live staging capture at
 * `tests/fixtures/isl-v2-live-20260707/isl-staging-capture.json`). There is
 * deliberately NO legacy fallback to the V1-era top-level `sensitivity`
 * field: the live V2 wire never emitted it (verified 2026-07-06, build
 * f3f5d92) and its entries use a different shape (`edge_from`/`edge_to`).
 *
 * Returns `undefined` when the nested location is absent or not a non-empty
 * array — i.e. on older deployed ISL builds — so callers keep the
 * "computed-empty vs absent" distinction and the
 * EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE warning path stays reachable when the
 * wire genuinely lacks the field.
 */
export function getIslEdgeSensitivity(
  islResult: Partial<ISLRobustnessAnalyzeV2Response> | null | undefined,
): ISLEdgeSensitivityV2[] | undefined {
  const nested = islResult?.robustness?.edge_sensitivity;
  if (Array.isArray(nested) && nested.length > 0) return nested;
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
 * Guarded mapping for the V2 `factor_evpi` field.
 *
 * P-5 PROMOTED (provisional_doctrine_v0, lane PLoT-H item C, 2026-07-07):
 * behind `FLAGS.ISL_FACTOR_EVPI_INTERNAL` (default ON for staging/test, OFF
 * for prod) the sanitised entries feed the factor_sensitivity
 * "worth checking next" surface (`evpi_percentage_points`,
 * `evpi_method: 'counterfactual'`, `evpi_status: 'below_resolution'`) IN
 * PLACE of the VOI×spread heuristic. The hygiene is centralised here so the
 * wiring can never leak a raw negative EVPI outward:
 * - negatives are NEVER emitted (Monte Carlo sampling artefacts);
 * - below-resolution estimates are labelled, never clamped to 0;
 * - ISL's own `evpi_status` wire field is honoured where present
 *   ('below_resolution' forces the label even if the raw value clears
 *   PLoT's local threshold).
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

    // Honour ISL's own emission classification where present: an explicit
    // 'below_resolution' from the producer overrides PLoT's local threshold
    // (never the reverse — PLoT's threshold still applies when ISL says 'ok'
    // or omits the field, so a sub-resolution raw value stays labelled).
    const islSaysBelowResolution = e.evpi_status === 'below_resolution';

    entries.push({
      factor_id: e.factor_id,
      emit_pp: islSaysBelowResolution ? undefined : classification.emit,
      below_resolution: classification.below_resolution || islSaysBelowResolution,
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
