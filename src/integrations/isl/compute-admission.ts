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
 *  - the BOOT WARM (ROADMAP 2.289 fix a): {@link warmIslComputeAdmission} runs
 *    ONE awaited refresh so main.ts can populate the cache BEFORE `listen` —
 *    production requests are planned against ISL's real advertised cost model,
 *    not the cold-cache fallback. Bounded by the ISL health-check timeout; it
 *    never throws and never blocks a live request;
 *  - the VERSION GUARD (a validated block whose complexity_formula_version is
 *    in KNOWN_COMPLEXITY_FORMULA_VERSIONS resolves 'ok'; anything else — an
 *    unreachable /health, a missing/malformed compute_admission block, or an
 *    unknown formula version — resolves to a SKEW state);
 *  - LAST-KNOWN-GOOD RETENTION (ROADMAP 2.289 fix b): a skewed refresh serves
 *    the most recent 'ok' admission (`retainedAdmissionVersion` set, skew still
 *    true and still alarmed) so weighted pricing AND the structural caps gate
 *    survive a transient /health outage instead of dropping to the blind legacy
 *    scalar — which can UNDER-price v5 (see LEGACY_FALLBACK_SCALAR_BUDGET in
 *    sampling.ts for the worked example). Only when NOTHING was ever retained
 *    does planning fall back to the conservative, wire-disclosed legacy mode
 *    ({@link shouldPlanConservatively});
 *  - the FAIL-LOUD signal on skew: a structured warning + a metric, emitted on
 *    each refresh that detects skew (≈ once per TTL — loud enough to alert on,
 *    quiet enough not to flood per request). Drift is VISIBLE, never silent
 *    (programme memory-trap #12) — retention changes what is SERVED, never
 *    whether the alarm fires.
 */

import { getISLClientConfig, isISLConfigured, ISLClient } from './client.js';
import {
  COMPLEXITY_FORMULA_SPECS,
  KNOWN_COMPLEXITY_FORMULA_VERSIONS,
  type ComplexityFormulaSpec,
} from '../../config/sampling.js';
import {
  recordIslAdmissionVersionSkew,
  recordIslForeignFormulaParameterGroups,
} from '../../metrics/registry.js';
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
  | 'unknown_weight_keys'
  | 'unknown_cap_keys'
  | 'missing_formula_parameters'
  | 'unknown_formula_parameters';

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
  /** As above for `caps` — populated only on `unknown_cap_keys`. */
  unexpectedCapKeys?: readonly string[];
  /**
   * Dotted `term.parameter` paths this version's estimator NEEDS but the live
   * advertisement does not carry — populated only on
   * `missing_formula_parameters`. This is the DEPLOY-ORDER signal: a PLoT
   * running ahead of ISL PR #119 names exactly which numbers it is waiting for.
   */
  missingFormulaParameters?: readonly string[];
  /**
   * Parameters advertised INSIDE a priced group but not read — populated only on
   * `unknown_formula_parameters` (skew).
   */
  unexpectedFormulaParameters?: readonly string[];
  /**
   * WHOLE advertised groups naming a term this version does not price. Rides on
   * an `ok` resolution: ADMITTED, full depth planned, but named in a loud
   * advisory warning + metric. See `foreignFormulaParameterGroupsFor`.
   */
  foreignFormulaParameterGroups?: readonly string[];
  /**
   * ROADMAP 2.289 fix (b) — set ONLY when a skewed live read is being served
   * with the LAST KNOWN GOOD admission: `admission` is that retained block and
   * this names its formula version (while `advertisedVersion`, when present,
   * names what the UNUSABLE live read claimed). `status`/`skew` still describe
   * the live read truthfully — retention changes what planning USES, never what
   * the alarm SAYS.
   */
  retainedAdmissionVersion?: string;
}

/**
 * Should the depth planner take the CONSERVATIVE, wire-disclosed fallback
 * posture for this resolution? (ROADMAP 2.289 fix c.)
 *
 * True whenever ISL is configured but no version-validated admission is in hand
 * — a genuine skew with nothing retained, or the cold 'warming' window — plus
 * the fail-safe case of a skew WITH a retained admission (irrelevant on the
 * weighted path, but if weighted planning ever declines the retained block the
 * legacy fallback must still be the conservative one).
 *
 * ⚠ THIS PREDICATE EXISTS BECAUSE `skew` ALONE WAS THE 2.289 DEFECT. The route
 * used `conservative: resolution.skew`, so the cold cache (`warming`,
 * skew=false) took the BENIGN legacy path: full defaulted depth against the
 * historical 30M scalar budget, which UNDER-prices ISL's v5 gate (worked
 * example: scalar 8.0M vs exact v5 34.9M against the live 24M ceiling) —
 * forwarded, then refused by ISL as a raw 422. Only `disabled` (no ISL to
 * refuse anything) keeps the benign posture.
 */
export function shouldPlanConservatively(resolution: AdmissionResolution): boolean {
  if (resolution.status === 'disabled') return false;
  return resolution.admission === null || resolution.skew;
}

const WARMING: AdmissionResolution = { admission: null, skew: false, status: 'warming' };
const DISABLED: AdmissionResolution = { admission: null, skew: false, status: 'disabled' };

interface CacheEntry {
  at: number;
  value: AdmissionResolution;
}

let _cache: CacheEntry | null = null;
let _inflight: Promise<void> | null = null;
/**
 * The most recent 'ok' resolution (ROADMAP 2.289 fix b). Written ONLY by a
 * healthy refresh; served (with the skew reason and alarm intact) when a later
 * refresh is unusable. Deliberately unbounded within the process lifetime:
 * pricing against the most recently VERIFIED real gate is strictly more
 * accurate than the blind legacy scalar, refreshes keep retrying every TTL, and
 * every skewed refresh re-fires the alarm — the staleness is loud, never silent.
 */
let _lastKnownGood: AdmissionResolution | null = null;

/** Is a value present and within TTL? */
function isFresh(now: number): boolean {
  return _cache !== null && now - _cache.at < ADMISSION_CACHE_TTL_MS;
}

/**
 * Validate the VERSION-INDEPENDENT shape of a `compute_admission` block:
 * ceiling positive-finite, version a non-empty string, `weights` and `caps`
 * objects at all, and `formula_parameters` an object IF PRESENT (it is absent on
 * every ISL deployed before PR #119, which is a supported state — see
 * `missing_formula_parameters` — not a garbled one). A malformed block is
 * treated as a missing block: a partial/garbled advertisement must NOT be
 * planned against.
 *
 * The CONTENT of all three is deliberately NOT checked here — which
 * coefficients, caps and per-term parameters are required depends on which
 * formula version is advertised, so those checks live in {@link classify} after
 * the version is resolved.
 *
 * ⚠ ROADMAP 2.260 — `caps` USED TO BE CONTENT-CHECKED HERE against a fixed
 * four-key `CAP_KEYS` list while ISL's v5 block advertises six. That list was
 * the second hand-maintained mirror (trap 12), flagged as bycatch by PR #302.
 * It is gone: cap keys are now version-derived from `COMPLEXITY_FORMULA_SPECS`,
 * exactly like the weight keys.
 */
function validAdmissionShape(block: unknown): block is ISLComputeAdmission {
  if (!block || typeof block !== 'object') return false;
  const o = block as Record<string, unknown>;
  const paramsOk =
    o.formula_parameters === undefined ||
    (!!o.formula_parameters && typeof o.formula_parameters === 'object');
  return (
    isFiniteNumber(o.max_cost_units) &&
    o.max_cost_units > 0 &&
    typeof o.complexity_formula_version === 'string' &&
    o.complexity_formula_version.length > 0 &&
    !!o.weights &&
    typeof o.weights === 'object' &&
    !!o.caps &&
    typeof o.caps === 'object' &&
    paramsOk
  );
}

/** Every coefficient the named version's estimator prices is present + finite. */
function validWeightsForVersion(
  w: unknown,
  expectedKeys: ReadonlySet<string>,
): w is ISLComputeAdmissionWeights {
  return allFiniteNumberFields(w, [...expectedKeys]);
}

/** Every cap the named version's structural gate pre-checks is present + finite. */
function validCapsForVersion(
  c: unknown,
  expectedKeys: ReadonlySet<string>,
): c is ISLComputeAdmissionCaps {
  return allFiniteNumberFields(c, [...expectedKeys]);
}

/**
 * Advertised keys the named version's estimator/gate does NOT consume.
 *
 * DERIVED, NOT MIRRORED (programme trap 12): the expected set comes from
 * `COMPLEXITY_FORMULA_SPECS` — the same map that decides which versions are
 * admissible at all — so a version can never be admitted without declaring what
 * it prices, and anything ISL adds in place can never be ignored. Returned
 * sorted so the alarm text is stable/diffable.
 */
function unexpectedKeysFor(o: object, expectedKeys: ReadonlySet<string>): string[] {
  return Object.keys(o)
    .filter((k) => !expectedKeys.has(k))
    .sort();
}

/**
 * Per-term parameters this version's estimator NEEDS but the advertisement does
 * not carry, as sorted dotted `term.parameter` paths.
 *
 * ⚠ THIS IS THE FAIL-CLOSED PIN (ROADMAP 2.260 step 3). PLoT prices v5's
 * factor-flips and sensitivity terms from numbers only ISL knows
 * (`FACTOR_FLIP_MAX_CANDIDATES`, `FLIP_STABILITY_N_SEEDS`,
 * `SENSITIVITY_SUBSAMPLE_CAP`, `SENSITIVITY_SUBSAMPLE_DIVISOR`). Until ISL
 * advertises them the version stays UNADMITTED and PLoT keeps taking the loud
 * conservative fallback PR #302 built — it NEVER substitutes a remembered
 * constant. Two consequences, both deliberate:
 *
 *  - DEPLOY ORDER CANNOT HURT. A PLoT carrying this code, deployed before ISL
 *    PR #119, reads today's live block (verified on isl-staging 2026-08-01: v5,
 *    12 weights, 6 caps, NO `formula_parameters`), lands here, and behaves
 *    exactly as it does now. The merge gate is a SAFETY margin, not a
 *    correctness requirement.
 *  - A FUTURE REMOVAL DEGRADES LOUDLY. If ISL ever drops a parameter, PLoT
 *    stops pricing v5 and says so, rather than silently reverting to a stale
 *    hard-coded value — the failure mode this whole lane exists to kill.
 */
function missingFormulaParametersFor(
  block: ISLComputeAdmission,
  spec: ComplexityFormulaSpec,
): string[] {
  const advertised = (block.formula_parameters ?? {}) as Record<
    string,
    Record<string, unknown> | undefined
  >;
  const missing: string[] = [];
  for (const [term, names] of spec.formulaParameters) {
    const group = advertised[term];
    for (const name of names) {
      const v = group?.[name];
      if (typeof v !== 'number' || !Number.isFinite(v)) missing.push(`${term}.${name}`);
    }
  }
  return missing.sort();
}

/**
 * An advertised parameter sitting INSIDE a group this version's estimator
 * prices, which the estimator does not read — sorted dotted `term.parameter`
 * paths. **Skew.**
 *
 * A new number under a term PLoT already prices means PLoT's hard-coded SHAPE
 * for that term is now incomplete: it is a number you need. That is the same
 * wrong-number hazard as an unknown weight key, and it stays fail-loud.
 */
function unexpectedInGroupFormulaParametersFor(
  block: ISLComputeAdmission,
  spec: ComplexityFormulaSpec,
): string[] {
  const advertised = (block.formula_parameters ?? {}) as Record<string, unknown>;
  const unexpected: string[] = [];
  for (const [term, group] of Object.entries(advertised)) {
    const expected = spec.formulaParameters.get(term);
    if (expected === undefined) continue; // a foreign GROUP — handled separately
    if (!group || typeof group !== 'object') continue;
    for (const name of Object.keys(group)) {
      if (!expected.has(name)) unexpected.push(`${term}.${name}`);
    }
  }
  return unexpected.sort();
}

/**
 * A WHOLE advertised group naming a term this version's estimator does not
 * price. **Admitted, with a loud named warning + metric — NOT skew.**
 *
 * ⚠ THIS ASYMMETRY IS THE POINT, AND IT WAS ARGUED FOR (adversarial review of
 * PR #303, which overturned my first cut treating both cases as skew).
 *
 * The decisive evidence is this repo's own dependency: ISL PR #119 added
 * `formula_parameters` as a NEW SIBLING under an UNCHANGED version string. That
 * class of change is normal for ISL and will recur — a third group, an advisory
 * group, a v6 pre-advertisement. Treating it as skew would mean a HEALTHY,
 * fully-priceable advertisement drops every defaulted analysis back to 4,000
 * AND disables all six structural cap pre-checks (skew nulls the admission, and
 * checkAdmissionCaps returns `ok` on a null admission). That blast radius —
 * depth AND caps — is far worse than the residual it would buy.
 *
 * The residual risk (a foreign group signalling a new cost TERM PLoT does not
 * price) is already covered from two directions: every v5 term reads at least
 * one `weights` coefficient, so a genuinely new term trips `unknown_weight_keys`
 * and skews properly; and ISL's own TestAdvertisementSufficiency fails their CI
 * the moment a term's numbers are not fully advertised.
 *
 * So: stay admitted, keep the depth, and be LOUD about the thing we cannot
 * price — an alarm that does not also brick the service.
 */
function foreignFormulaParameterGroupsFor(
  block: ISLComputeAdmission,
  spec: ComplexityFormulaSpec,
): string[] {
  const advertised = (block.formula_parameters ?? {}) as Record<string, unknown>;
  return Object.keys(advertised)
    .filter((term) => !spec.formulaParameters.has(term))
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

  // The version gate, and the source of EVERY key set this block is judged
  // against — one map, so no two of them can disagree.
  const spec = COMPLEXITY_FORMULA_SPECS.get(advertisedVersion);
  if (spec === undefined) {
    return { admission: null, skew: true, status: 'unknown_version', advertisedVersion };
  }

  // A coefficient this version's estimator prices is missing or non-numeric →
  // the advertisement is garbled, not merely drifted.
  if (!validWeightsForVersion(block.weights, spec.weightKeys)) {
    return { admission: null, skew: true, status: 'missing_block', advertisedVersion };
  }

  // ISL advertised a coefficient PLoT does not price under this version — its
  // formula grew a term in place. Under-pricing here would convert a safe
  // conservative fallback into a confident plan ISL then refuses with a raw 422,
  // so the version stays UNADMITTED and the drift is named.
  const unexpectedWeightKeys = unexpectedKeysFor(block.weights, spec.weightKeys);
  if (unexpectedWeightKeys.length > 0) {
    return {
      admission: null,
      skew: true,
      status: 'unknown_weight_keys',
      advertisedVersion,
      unexpectedWeightKeys,
    };
  }

  // The CAPS half of the handshake, given the identical exact-set treatment.
  // A cap PLoT does not pre-check is a structural constraint ISL enforces and
  // PLoT cannot see, so the request reaches ISL and returns a raw 422 instead of
  // a structured GRAPH_TOO_COMPLEX blocker.
  if (!validCapsForVersion(block.caps, spec.capKeys)) {
    return { admission: null, skew: true, status: 'missing_block', advertisedVersion };
  }
  const unexpectedCapKeys = unexpectedKeysFor(block.caps, spec.capKeys);
  if (unexpectedCapKeys.length > 0) {
    return {
      admission: null,
      skew: true,
      status: 'unknown_cap_keys',
      advertisedVersion,
      unexpectedCapKeys,
    };
  }

  // FAIL CLOSED on per-term parameters: a number this version's estimator needs
  // and ISL has not published is never guessed. This is the branch a PLoT
  // deployed ahead of ISL PR #119 takes on today's live block.
  const missingFormulaParameters = missingFormulaParametersFor(block, spec);
  if (missingFormulaParameters.length > 0) {
    return {
      admission: null,
      skew: true,
      status: 'missing_formula_parameters',
      advertisedVersion,
      missingFormulaParameters,
    };
  }
  const unexpectedFormulaParameters = unexpectedInGroupFormulaParametersFor(block, spec);
  if (unexpectedFormulaParameters.length > 0) {
    return {
      admission: null,
      skew: true,
      status: 'unknown_formula_parameters',
      advertisedVersion,
      unexpectedFormulaParameters,
    };
  }

  // A whole foreign GROUP is an ADVISORY, not skew — see
  // foreignFormulaParameterGroupsFor for why the two cases diverge. The block is
  // admitted and the full depth is planned; the groups ride on the resolution so
  // the refresh can name them in a loud warning.
  const foreignFormulaParameterGroups = foreignFormulaParameterGroupsFor(block, spec);
  if (foreignFormulaParameterGroups.length > 0) {
    return {
      admission: block,
      skew: false,
      status: 'ok',
      advertisedVersion,
      foreignFormulaParameterGroups,
    };
  }

  return { admission: block, skew: false, status: 'ok', advertisedVersion };
}

/** Emit the loud fail-loud signal (warning + metric) when a skew is detected. */
function signalSkew(resolution: AdmissionResolution): void {
  if (!resolution.skew) return;
  const reason = resolution.status as AdmissionSkewReason;
  recordIslAdmissionVersionSkew(reason);
  // ROADMAP 2.289 fix (b): when a last-known-good admission is being served,
  // the alarm still fires (the live read IS unusable) but must describe the
  // action truthfully — planning is weighted against the retained block, not
  // the conservative scalar fallback. An alarm that misdescribes its own
  // mitigation teaches responders the wrong recovery (trap 7b).
  const retained = resolution.admission !== null;
  // Structured, matches the ISL client's console logging style. Loud on purpose:
  // this is the VISIBLE drift alarm that makes derive-not-mirror safe.
  console.warn(
    JSON.stringify({
      level: 'warn',
      time: Date.now(),
      event: 'isl_admission_version_skew',
      reason,
      advertised_version: resolution.advertisedVersion ?? null,
      retained_admission_version: resolution.retainedAdmissionVersion ?? null,
      known_versions: [...KNOWN_COMPLEXITY_FORMULA_VERSIONS],
      // Named on the corresponding reason so the drift is diagnosable from this
      // one line, without a source dive: exactly what ISL advertises and PLoT
      // does not price, or what PLoT needs and ISL has not published yet.
      unexpected_weight_keys: resolution.unexpectedWeightKeys ?? null,
      unexpected_cap_keys: resolution.unexpectedCapKeys ?? null,
      missing_formula_parameters: resolution.missingFormulaParameters ?? null,
      unexpected_formula_parameters: resolution.unexpectedFormulaParameters ?? null,
      action: retained ? 'retained_last_known_good_admission' : 'fail_loud_conservative_fallback',
      msg: retained
        ? 'ISL /health compute-admission read unusable — planning continues against the LAST KNOWN GOOD advertisement (weighted pricing and structural caps stay live) while refreshes retry every TTL. If ISL genuinely changed its cost model, the retained pricing may drift from the live gate until the named reason is resolved.'
        : 'ISL /health compute-admission handshake unusable and nothing retained — planning against the conservative legacy scalar bound (base depth capped) until the live capability is readable and its formula version is known. Every DEFAULTED analysis is now running at the reduced fallback depth and says so in its response (SAMPLES_REDUCED_FOR_COMPLEXITY).',
    }),
  );
}

/**
 * Emit the ADVISORY signal when ISL advertises a formula_parameters group PLoT
 * does not price. Loud, named, and metered — but the advertisement stayed
 * ADMITTED, so the wording must not read like a degradation. An alarm that
 * overstates its own severity gets tuned out, which is how the 2.260 silence
 * survived as long as it did.
 */
function signalForeignFormulaParameterGroups(resolution: AdmissionResolution): void {
  const groups = resolution.foreignFormulaParameterGroups;
  if (!groups || groups.length === 0) return;
  recordIslForeignFormulaParameterGroups();
  console.warn(
    JSON.stringify({
      level: 'warn',
      time: Date.now(),
      event: 'isl_admission_foreign_formula_parameter_groups',
      advertised_version: resolution.advertisedVersion ?? null,
      foreign_formula_parameter_groups: groups,
      action: 'admitted_full_depth_planned',
      msg:
        "ISL advertises formula_parameters group(s) PLoT's estimator for this version does not price. The advertisement is still ADMITTED and the full sample depth is still planned — this is NOT a degradation. It means ISL's cost model may have grown a term PLoT does not model; if it did, that term also carries a `weights` coefficient and would additionally trip unknown_weight_keys. Add the group to COMPLEXITY_FORMULA_SPECS when PLoT implements it.",
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
    if (resolution.status === 'ok') {
      _lastKnownGood = resolution;
    } else if (resolution.skew && _lastKnownGood?.admission) {
      // ROADMAP 2.289 fix (b): the live read is unusable but a verified
      // advertisement exists — serve it. `status`/`skew` keep describing the
      // live read; `admission` carries the retained block so weighted pricing
      // and the caps gate stay live. The alarm below names both.
      resolution = {
        ...resolution,
        admission: _lastKnownGood.admission,
        retainedAdmissionVersion: _lastKnownGood.advertisedVersion,
      };
    }
    signalSkew(resolution);
    signalForeignFormulaParameterGroups(resolution);
  }
  _cache = { at: Date.now(), value: resolution };
}

/** Start (or join) one deduped refresh; never rejects, never wedges the cache. */
function startRefresh(): Promise<void> {
  if (_inflight === null) {
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
  return _inflight;
}

/**
 * Resolve the ISL compute-admission capability for planning — SYNCHRONOUS and
 * NON-BLOCKING. Serves the cached value immediately; when the cache is cold or
 * stale it kicks off a background refresh (deduped). On a cold cache it returns
 * `warming` when ISL is configured (first read in flight — the planner treats
 * this conservatively, see {@link shouldPlanConservatively}) and `disabled`
 * when it is not (there is no ISL to refuse anything, so nothing to be
 * conservative about). After warm-up every request is served from cache with
 * zero network work — in production the cache is already warm before the first
 * request ({@link warmIslComputeAdmission} in main.ts).
 */
export function getIslComputeAdmission(): AdmissionResolution {
  const now = Date.now();
  if (!isFresh(now)) {
    void startRefresh();
  }
  if (_cache) return _cache.value;
  return isISLConfigured() ? WARMING : DISABLED;
}

/**
 * Warm the admission cache with ONE awaited refresh (ROADMAP 2.289 fix a).
 *
 * Called by main.ts BEFORE `listen`, so in production no request is ever
 * planned against the cold-cache fallback: the first request already prices
 * with ISL's real advertised cost model. Bounded by the ISL health-check
 * timeout (ISL_HEALTH_CHECK_TIMEOUT_MS, 5 s) when ISL is configured; instant
 * (no network) when it is not. Never throws — a dead ISL warms to a NAMED skew
 * state and boot proceeds; the route's conservative disclosure covers the gap.
 */
export async function warmIslComputeAdmission(): Promise<AdmissionResolution> {
  if (!isFresh(Date.now())) {
    await startRefresh();
  }
  return getIslComputeAdmission();
}

// ---------------------------------------------------------------------------
// Test seams — deterministic control over the cache (no network in unit tests).
// ---------------------------------------------------------------------------

/** Seed the cache with a fixed resolution (fresh timestamp → no refresh). */
export function __setIslComputeAdmissionForTest(resolution: AdmissionResolution): void {
  _cache = { at: Date.now(), value: resolution };
  _inflight = null;
}

/** Clear the cache + any in-flight refresh + the retained last-known-good. */
export function __resetIslComputeAdmission(): void {
  _cache = null;
  _inflight = null;
  _lastKnownGood = null;
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
