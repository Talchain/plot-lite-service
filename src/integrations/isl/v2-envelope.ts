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
 *
 * All V2-location reads MUST go through these accessors so the location is
 * fixed in exactly one place.
 *
 * NOTE (F3, ISL #103 / D-23.15): ISL removed the top-level `factor_evpi`
 * wire field (win-probability EVPI). Its win-probability successor is
 * `p_win_sensitivity` and the outcome-unit value of partial perfect
 * information is `factor_evppi`; both ride the raw top-level passthrough in
 * routes/v2/run.ts and are NOT (yet) reshaped here. The former
 * `mapIslFactorEvpi` accessor + its counterfactual ranking consumer were
 * removed with the field; see `src/types/isl-no-factor-evpi.type-pin.ts` and
 * `tests/contract/isl-factor-evpi-removed.guard.test.ts` for the fail-loud
 * guards that keep the dead name from creeping back.
 */

import type {
  ISLEdgeEValue,
  ISLEdgeSensitivityV2,
  ISLRangeFitDisclosure,
  ISLRobustnessAnalyzeV2Response,
} from './types/isl-types.js';

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
 * Read the per-range interquartile-fit disclosures from an ISL response
 * (ROADMAP 2.720 / ISL 2.521 Q1).
 *
 * Canonical V2 location is TOP-LEVEL, beside `factor_sensitivity` and
 * `factor_flip_values` — verified against DEPLOYED ISL build 686fcb7 (live
 * captures frozen at `tests/fixtures/isl-range-fit-live-20260807/`) and against
 * `ISLResponseV2.range_fit_disclosures` in the pinned OpenAPI. There is
 * deliberately NO nested fallback: no ISL build has ever emitted it under
 * `robustness`, and inventing a second lookup location is how a field ends up
 * "read" from somewhere nothing writes.
 *
 * ⚠ THE THREE STATES ARE DISTINCT AND ALL THREE ARE PRESERVED:
 *   - `undefined` — no ranges were stated (ISL omits the key entirely).
 *   - `[]`        — ranges were stated and produced no rows. A computed-empty
 *                   result, NOT the same fact as "none stated". Collapsing it
 *                   to absent would delete the only signal that the request
 *                   carried ranges at all.
 *   - `[row, …]`  — each row carries EITHER `fitted` OR a TYPED `refusal`.
 *
 * A non-array (a malformed or future ISL build) degrades to `undefined` rather
 * than being forwarded as a shape no consumer can read.
 */
export function getIslRangeFitDisclosures(
  islResult: Partial<ISLRobustnessAnalyzeV2Response> | null | undefined,
): ISLRangeFitDisclosure[] | undefined {
  const disclosures = islResult?.range_fit_disclosures;
  if (Array.isArray(disclosures)) return disclosures;
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
