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
import {
  COMPLEXITY_FORMULA_WEIGHT_KEYS,
  KNOWN_COMPLEXITY_FORMULA_VERSIONS,
} from '../../config/sampling.js';
import { recordIslAdmissionVersionSkew } from '../../metrics/registry.js';
import { isFiniteNumber, allFiniteNumberFields } from '../../util/numeric.js';
import type {
  ISLComputeAdmission,
  ISLComputeAdmissionWeights,
  ISLComputeAdmissionCaps,
  ISLHealthResponse,
} from './types/isl-types.js';

/** Cache TTL for the /health capability read. */
export const ADMISSION_CACHE_TTL_MS = 60_000;

/**
 * Reasons the handshake could not yield a usable, version-known capability.
 *
 * `unknown_weight_keys` (ROADMAP 2.260) is the DERIVED drift alarm: ISL
 * advertised the SAME formula version but a `weights` object carrying a
 * coefficient PLoT's estimator for that version does not price. That is exactly
 * the signature of ISL growing a cost term in place — the case the version
 * string alone cannot catch, and the one that silently under-prices.
 */
export type AdmissionSkewReason =
  | 'unreachable'
  | 'missing_block'
  | 'unknown_version'
  | 'unknown_weight_keys';

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
  /**
   * Advertised `weights` keys PLoT's estimator for the advertised version does
   * NOT consume — populated only on `unknown_weight_keys`. Named in the alarm so
   * the drift is diagnosable from one log line, without a source dive.
   */
  unexpectedWeightKeys?: readonly string[];
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

/** Cap fields an advertised `caps` object must carry as finite numbers. */
const CAP_KEYS = ['max_options', 'max_nodes', 'max_edges', 'max_parameter_uncertainties'] as const;

function validCaps(c: unknown): c is ISLComputeAdmissionCaps {
  return allFiniteNumberFields(c, CAP_KEYS);
}

/**
 * Validate the VERSION-INDEPENDENT shape of a `compute_admission` block:
 * ceiling positive-finite, version a non-empty string, `weights` an object at
 * all, caps well-formed. A malformed block is treated as a missing block (a
 * partial/garbled advertisement must NOT be planned against).
 *
 * The `weights` CONTENT is deliberately NOT checked here — which coefficients
 * are required depends on which formula version is advertised, so that check
 * lives in {@link classify} after the version is resolved
 * ({@link validWeightsForVersion}).
 */
function validAdmissionShape(block: unknown): block is ISLComputeAdmission {
  if (!block || typeof block !== 'object') return false;
  const o = block as Record<string, unknown>;
  return (
    isFiniteNumber(o.max_cost_units) &&
    o.max_cost_units > 0 &&
    typeof o.complexity_formula_version === 'string' &&
    o.complexity_formula_version.length > 0 &&
    !!o.weights &&
    typeof o.weights === 'object' &&
    validCaps(o.caps)
  );
}

/** Every coefficient the named version's estimator prices is present + finite. */
function validWeightsForVersion(
  w: unknown,
  expectedKeys: ReadonlySet<string>,
): w is ISLComputeAdmissionWeights {
  return allFiniteNumberFields(w, [...expectedKeys]);
}

/**
 * Advertised weight keys the named version's estimator does NOT consume.
 *
 * DERIVED, NOT MIRRORED (programme trap 12): the expected set comes from
 * `COMPLEXITY_FORMULA_WEIGHT_KEYS` — the same map that decides which versions
 * are admissible at all — so a version can never be admitted without declaring
 * the coefficients it prices, and a coefficient ISL adds in place can never be
 * ignored. Returned sorted so the alarm text is stable/diffable.
 */
function unexpectedWeightKeysFor(w: object, expectedKeys: ReadonlySet<string>): string[] {
  return Object.keys(w)
    .filter((k) => !expectedKeys.has(k))
    .sort();
}

/** Classify a fetched /health payload into a resolution. */
function classify(health: ISLHealthResponse | null): AdmissionResolution {
  if (health === null) {
    return { admission: null, skew: true, status: 'unreachable' };
  }
  const block = health.compute_admission;
  if (!validAdmissionShape(block)) {
    return { admission: null, skew: true, status: 'missing_block' };
  }
  const advertisedVersion = block.complexity_formula_version;

  // The version gate, and the source of the key set the weights are judged
  // against — one map, so the two can never disagree.
  const expectedKeys = COMPLEXITY_FORMULA_WEIGHT_KEYS.get(advertisedVersion);
  if (expectedKeys === undefined) {
    return { admission: null, skew: true, status: 'unknown_version', advertisedVersion };
  }

  // A coefficient this version's estimator prices is missing or non-numeric →
  // the advertisement is garbled, not merely drifted.
  if (!validWeightsForVersion(block.weights, expectedKeys)) {
    return { admission: null, skew: true, status: 'missing_block', advertisedVersion };
  }

  // ISL advertised a coefficient PLoT does not price under this version — its
  // formula grew a term in place. Under-pricing here would convert a safe
  // conservative fallback into a confident plan ISL then refuses with a raw 422,
  // so the version stays UNADMITTED and the drift is named.
  const unexpectedWeightKeys = unexpectedWeightKeysFor(block.weights, expectedKeys);
  if (unexpectedWeightKeys.length > 0) {
    return {
      admission: null,
      skew: true,
      status: 'unknown_weight_keys',
      advertisedVersion,
      unexpectedWeightKeys,
    };
  }

  return { admission: block, skew: false, status: 'ok', advertisedVersion };
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
      // Named on `unknown_weight_keys` so the drift is diagnosable from this one
      // line: these are the coefficients ISL prices and PLoT does not.
      unexpected_weight_keys: resolution.unexpectedWeightKeys ?? null,
      action: 'fail_loud_conservative_fallback',
      msg:
        'ISL /health compute-admission handshake unusable — planning against the conservative legacy scalar bound (base depth capped) until the live capability is readable and its formula version is known. Every DEFAULTED analysis is now running at the reduced fallback depth and says so in its response (SAMPLES_REDUCED_FOR_COMPLEXITY).',
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

/** Directly exercise the version-independent shape validator (unit tests). */
export const __validAdmissionForTest = validAdmissionShape;
