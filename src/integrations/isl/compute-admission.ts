/**
 * ISL /health compute-admission capability resolver (Codex F8 handshake, Option B).
 *
 * PLoT reads ISL's LIVE request-admission cost model from `/health`
 * (`compute_admission`) and derives its sample-reduction planning from it
 * (src/config/sampling.ts planSampleDepth), rather than hand-mirroring a scalar
 * ceiling that drifts out of sync with ISL's real gate.
 *
 * This module owns:
 *  - the CACHE (TTL 60 s; stale-while-revalidate background refresh, so a live
 *    analysis request NEVER blocks on a per-request /health fetch);
 *  - the VERSION GUARD (a validated block whose complexity_formula_version is
 *    in KNOWN_COMPLEXITY_FORMULA_VERSIONS resolves 'ok'; anything else — an
 *    unreachable /health, a missing/malformed compute_admission block, or an
 *    unknown formula version — resolves to a SKEW state that the planner turns
 *    into the conservative legacy fallback);
 *  - the FAIL-LOUD signal on skew: a structured warning + a metric, emitted on
 *    each refresh that detects skew (≈ once per TTL — loud enough to alert on,
 *    quiet enough not to flood per request). Drift is VISIBLE, never silent
 *    (programme memory-trap #12).
 */

import { getISLClientConfig, isISLConfigured, ISLClient } from './client.js';
import { KNOWN_COMPLEXITY_FORMULA_VERSIONS } from '../../config/sampling.js';
import { recordIslAdmissionVersionSkew } from '../../metrics/registry.js';
import type {
  ISLComputeAdmission,
  ISLComputeAdmissionWeights,
  ISLComputeAdmissionCaps,
  ISLHealthResponse,
} from './types/isl-types.js';

/** Cache TTL for the /health capability read. */
export const ADMISSION_CACHE_TTL_MS = 60_000;

/** Reasons the handshake could not yield a usable, version-known capability. */
export type AdmissionSkewReason = 'unreachable' | 'missing_block' | 'unknown_version';

/** Resolved capability state served to the planner. */
export interface AdmissionResolution {
  /** Version-validated live admission, or `null` when unavailable/skewed. */
  admission: ISLComputeAdmission | null;
  /**
   * True only for a GENUINE skew (ISL configured + a read was attempted but the
   * result is unusable). `disabled`/`warming` are NOT skew — they fall back
   * conservatively but quietly (no alarm).
   */
  skew: boolean;
  status: 'ok' | AdmissionSkewReason | 'disabled' | 'warming';
  /** Advertised formula version when a block was present (for logging). */
  advertisedVersion?: string;
}

const WARMING: AdmissionResolution = { admission: null, skew: false, status: 'warming' };
const DISABLED: AdmissionResolution = { admission: null, skew: false, status: 'disabled' };

interface CacheEntry {
  at: number;
  value: AdmissionResolution;
}

let _cache: CacheEntry | null = null;
let _inflight: Promise<void> | null = null;

/** Is a value present and within TTL? */
function isFresh(now: number): boolean {
  return _cache !== null && now - _cache.at < ADMISSION_CACHE_TTL_MS;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Validate the advertised `weights` object — every coefficient must be finite. */
function validWeights(w: unknown): w is ISLComputeAdmissionWeights {
  if (!w || typeof w !== 'object') return false;
  const o = w as Record<string, unknown>;
  return (
    isFiniteNumber(o.base_per_sample_per_option_per_struct) &&
    isFiniteNumber(o.evpi_sample_cap) &&
    isFiniteNumber(o.sensitivity_coef) &&
    isFiniteNumber(o.evalue_coef) &&
    isFiniteNumber(o.bands_coef) &&
    isFiniteNumber(o.path_coef) &&
    isFiniteNumber(o.max_decomposition_paths)
  );
}

function validCaps(c: unknown): c is ISLComputeAdmissionCaps {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  return (
    isFiniteNumber(o.max_options) &&
    isFiniteNumber(o.max_nodes) &&
    isFiniteNumber(o.max_edges) &&
    isFiniteNumber(o.max_parameter_uncertainties)
  );
}

/**
 * Validate a `compute_admission` block: ceiling positive-finite, version a
 * non-empty string, weights + caps well-formed. A malformed block is treated as
 * a missing block (a partial/garbled advertisement must NOT be planned against).
 */
function validAdmission(block: unknown): block is ISLComputeAdmission {
  if (!block || typeof block !== 'object') return false;
  const o = block as Record<string, unknown>;
  return (
    isFiniteNumber(o.max_cost_units) &&
    o.max_cost_units > 0 &&
    typeof o.complexity_formula_version === 'string' &&
    o.complexity_formula_version.length > 0 &&
    validWeights(o.weights) &&
    validCaps(o.caps)
  );
}

/** Classify a fetched /health payload into a resolution. */
function classify(health: ISLHealthResponse | null): AdmissionResolution {
  if (health === null) {
    return { admission: null, skew: true, status: 'unreachable' };
  }
  const block = health.compute_admission;
  if (!validAdmission(block)) {
    return { admission: null, skew: true, status: 'missing_block' };
  }
  if (!KNOWN_COMPLEXITY_FORMULA_VERSIONS.has(block.complexity_formula_version)) {
    return {
      admission: null,
      skew: true,
      status: 'unknown_version',
      advertisedVersion: block.complexity_formula_version,
    };
  }
  return {
    admission: block,
    skew: false,
    status: 'ok',
    advertisedVersion: block.complexity_formula_version,
  };
}

/** Emit the loud fail-loud signal (warning + metric) when a skew is detected. */
function signalSkew(resolution: AdmissionResolution): void {
  if (!resolution.skew) return;
  const reason = resolution.status as AdmissionSkewReason;
  recordIslAdmissionVersionSkew(reason);
  // Structured, matches the ISL client's console logging style. Loud on purpose:
  // this is the VISIBLE drift alarm that makes derive-not-mirror safe.
  console.warn(
    JSON.stringify({
      level: 'warn',
      time: Date.now(),
      event: 'isl_admission_version_skew',
      reason,
      advertised_version: resolution.advertisedVersion ?? null,
      known_versions: [...KNOWN_COMPLEXITY_FORMULA_VERSIONS],
      action: 'fail_loud_conservative_fallback',
      msg:
        'ISL /health compute-admission handshake unusable — planning against the conservative legacy scalar bound (base depth capped) until the live capability is readable and its formula version is known.',
    }),
  );
}

/** Perform one /health read, classify it, cache it, and signal on skew. */
async function refresh(): Promise<void> {
  let resolution: AdmissionResolution;
  if (!isISLConfigured()) {
    // ISL not configured — no gate to plan against; fall back quietly.
    resolution = DISABLED;
  } else {
    const client = new ISLClient(getISLClientConfig());
    const health = await client.fetchHealth();
    resolution = classify(health);
    signalSkew(resolution);
  }
  _cache = { at: Date.now(), value: resolution };
}

/**
 * Resolve the ISL compute-admission capability for planning — SYNCHRONOUS and
 * NON-BLOCKING. Serves the cached value immediately; when the cache is cold or
 * stale it kicks off a background refresh (deduped) and, on a cold cache,
 * returns the conservative `warming` fallback for that single first request.
 * After warm-up every request is served from cache with zero network work.
 */
export function getIslComputeAdmission(): AdmissionResolution {
  const now = Date.now();
  if (!isFresh(now) && _inflight === null) {
    _inflight = refresh()
      .catch(() => {
        // A thrown refresh (should not happen — fetchHealth swallows) must not
        // wedge the cache; record an unreachable skew so the next call retries.
        _cache = { at: Date.now(), value: { admission: null, skew: true, status: 'unreachable' } };
      })
      .finally(() => {
        _inflight = null;
      });
  }
  return _cache ? _cache.value : WARMING;
}

// ---------------------------------------------------------------------------
// Test seams — deterministic control over the cache (no network in unit tests).
// ---------------------------------------------------------------------------

/** Seed the cache with a fixed resolution (fresh timestamp → no refresh). */
export function __setIslComputeAdmissionForTest(resolution: AdmissionResolution): void {
  _cache = { at: Date.now(), value: resolution };
  _inflight = null;
}

/** Clear the cache + any in-flight refresh. */
export function __resetIslComputeAdmission(): void {
  _cache = null;
  _inflight = null;
}

/** Run one real refresh (network via mocked fetch) and return the resolution. */
export async function __refreshForTest(): Promise<AdmissionResolution> {
  await refresh();
  return _cache!.value;
}

/** Directly exercise the classifier (unit tests). */
export const __classifyForTest = classify;

/** Directly exercise the validator (unit tests). */
export const __validAdmissionForTest = validAdmission;
