/**
 * ISL wire-generation assertion (lane 29, spec §2.1 —
 * docs/enrichment-v1/PLOT-V2-READ-FIX-SPEC.md in olumi-schemas).
 *
 * PLoT pins the REQUEST side of every ISL exchange
 * (`?response_version=2` + `X-ISL-Response-Version: 2`, client.ts) but
 * nothing asserted the RESPONSE generation: a mis-deployed or rolled-back
 * ISL silently degrades to empty science — readers pointed at wire
 * locations the older envelope never emits, and every array came back
 * "computed, empty". This module verifies, after each successful
 * `robustness/analyze` call, that the envelope is the generation PLoT's
 * readers assume.
 *
 * The check is MARKER-BASED, not ordinal: ISL build identifiers are git
 * SHAs with no order relation, so "at least generation X" is verified by
 *  (a) the envelope DECLARING its version markers — `build`,
 *      `engine_version`, `version` (major 2), `timestamp` — all present on
 *      every live V2 capture (f3f5d92 2026-07-06, 9a22a1a 2026-07-07); and
 *  (b) WIRE-LOCATION PROBES for the nested fields the readers in
 *      `v2-envelope.ts` assume: `robustness.edge_e_values` (emitted since
 *      f3f5d92) and `robustness.edge_sensitivity` (emitted since 9a22a1a).
 *      A probe fails only when `robustness` came back but the LOCATION is
 *      absent — an EMPTY array at the location is computed-empty (honest),
 *      not a wire gap.
 *
 * Failure NEVER hard-fails the run (absence of enrichment is
 * degraded-but-usable; fail-closed stays reserved for the analysis core):
 * the result is surfaced as `_meta.evidence.isl_wire_generation_ok` and one
 * structured `isl_wire_generation_unverified` warning per response.
 */

/**
 * The minimum ISL build whose wire generation PLoT's readers assume
 * (spec §2.1). Today: `9a22a1a` — the first build emitting
 * `robustness.edge_sensitivity` (ISL lane 11 / PR #65); `f3f5d92` already
 * sufficed for `robustness.edge_e_values` + `timestamp` + `factor_evpi`.
 * Not compared ordinally (SHAs have no order) — carried in the warning so
 * an operator can compare against the deployed ISL `/health` build, and
 * documented here as the generation the wire-location probes encode.
 * Update ALONGSIDE any reader change in `v2-envelope.ts` that starts
 * assuming a newer wire location.
 */
export const ISL_MIN_WIRE_GENERATION = '9a22a1a';

/** Result of verifying one ISL response envelope's wire generation. */
export interface IslWireGenerationAssessment {
  /** True when every version marker is declared and every applicable wire-location probe resolved */
  ok: boolean;
  /** Envelope `build` (verbatim); null when absent/non-string */
  isl_build: string | null;
  /** Envelope `engine_version` (verbatim); null when absent/non-string */
  isl_engine_version: string | null;
  /** Envelope `version` (verbatim, even when not generation 2); null when absent/non-string */
  isl_version: string | null;
  /**
   * Markers that failed verification (empty when ok). Values:
   * 'isl_response' (no usable envelope at all), 'build', 'engine_version',
   * 'version' (absent), 'version_not_v2' (declared but not major 2),
   * 'timestamp', 'robustness.edge_e_values', 'robustness.edge_sensitivity'.
   */
  missing_markers: string[];
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/**
 * Verify an ISL response envelope's wire generation (pure — deterministic
 * over the envelope, callable at the ISL boundary and again when building
 * `_meta.evidence` without divergence).
 *
 * The nested probes are applicable on every live `/v2/run` exchange: PLoT
 * always requests `analysis_types: ['comparison','sensitivity','robustness']`
 * with `include_e_values: true` (translator-v3.ts:425-427), so when the
 * envelope carries a `robustness` object the canonical nested locations must
 * exist. When `robustness` itself is absent the probes are skipped — that is
 * a computation outcome the per-feature status machinery already degrades,
 * not a generation signal.
 */
export function assessIslWireGeneration(islResult: unknown): IslWireGenerationAssessment {
  if (islResult === null || typeof islResult !== 'object') {
    return {
      ok: false,
      isl_build: null,
      isl_engine_version: null,
      isl_version: null,
      missing_markers: ['isl_response'],
    };
  }

  const env = islResult as Record<string, unknown>;
  const missing: string[] = [];

  if (!nonEmptyString(env.build)) missing.push('build');
  if (!nonEmptyString(env.engine_version)) missing.push('engine_version');
  if (!nonEmptyString(env.version)) {
    missing.push('version');
  } else if (!/^2(\.|$)/.test(env.version)) {
    // The envelope declares a DIFFERENT generation than the one PLoT pinned
    // on the request — the strongest possible rollback signal.
    missing.push('version_not_v2');
  }
  if (!nonEmptyString(env.timestamp)) missing.push('timestamp');

  const robustness = env.robustness;
  if (robustness !== null && typeof robustness === 'object') {
    const r = robustness as Record<string, unknown>;
    // Location probes: Array.isArray (not non-empty) — an empty array proves
    // the location exists on this wire; absence proves it does not.
    if (!Array.isArray(r.edge_e_values)) missing.push('robustness.edge_e_values');
    if (!Array.isArray(r.edge_sensitivity)) missing.push('robustness.edge_sensitivity');
  }

  return {
    ok: missing.length === 0,
    isl_build: nonEmptyString(env.build) ? env.build : null,
    isl_engine_version: nonEmptyString(env.engine_version) ? env.engine_version : null,
    isl_version: nonEmptyString(env.version) ? env.version : null,
    missing_markers: missing,
  };
}

/**
 * Emit the spec-mandated structured warning — exactly ONE per assessed
 * response, and none when the envelope verified. Carries the declared
 * markers (verbatim) + the missing ones + the assumed minimum generation so
 * an operator diagnosing "empty science" sees the wire truth immediately.
 */
export function logIslWireGenerationUnverified(
  logger: { warn: (obj: object, msg?: string) => void },
  assessment: IslWireGenerationAssessment,
  requestId: string,
): void {
  if (assessment.ok) return;
  logger.warn({
    event: 'isl_wire_generation_unverified',
    request_id: requestId,
    isl_build: assessment.isl_build,
    isl_engine_version: assessment.isl_engine_version,
    isl_version: assessment.isl_version,
    missing_markers: assessment.missing_markers,
    min_wire_generation: ISL_MIN_WIRE_GENERATION,
  });
}
