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
 *  - LAST-KNOWN-GOOD RETENTION (ROADMAP 2.289 fix b, scoped by the #305 review
 *    ruling): an OUTAGE-class skew — the live read carries NO readable formula
 *    version — serves the most recent 'ok' admission (`retainedAdmissionVersion`
 *    set, skew still true and still alarmed) so weighted pricing AND the
 *    structural caps gate survive a transient /health outage instead of
 *    dropping to the blind legacy scalar — which can UNDER-price v5 (see
 *    LEGACY_FALLBACK_SCALAR_BUDGET in sampling.ts for the worked example).
 *    DRIFT-class skews (a READABLE advertised version PLoT cannot price) never
 *    retain — live ISL is declaring a different cost model, so the retained
 *    block would be obsolete pricing with stale caps; they take the
 *    conservative, wire-disclosed fallback, as does any skew with nothing ever
 *    retained ({@link shouldPlanConservatively});
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
import { ISL_HEALTH_CHECK_TIMEOUT_MS } from '../../config/timeouts.js';
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
   * ROADMAP 2.289 fix (b) — set ONLY when an OUTAGE-class skewed read (no
   * readable advertised version; #305 review ruling) is being served with the
   * LAST KNOWN GOOD admission: `admission` is that retained block and this
   * names its formula version. Mutually exclusive with `advertisedVersion` by
   * construction — a readable advertised version is the DRIFT class, which
   * never retains. `status`/`skew` still describe the live read truthfully —
   * retention changes what planning USES, never what the alarm SAYS.
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
 * refresh is an OUTAGE-class skew — no readable advertised version (#305
 * review ruling; drift-class skews never retain). Deliberately unbounded
 * within the process lifetime for that class: pricing against the most
 * recently VERIFIED real gate is strictly more accurate than the blind legacy
 * scalar, refreshes keep retrying every TTL, and every skewed refresh re-fires
 * the alarm — the staleness is loud, never silent.
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

/**
 * The advertised formula version, if the payload carries a readable one.
 *
 * ⚠ ROADMAP 2.356 — THIS IS READ BEFORE ANY SIBLING FIELD IS VALIDATED, AND THE
 * ORDER IS THE WHOLE POINT.
 *
 * #305 ruled that an OUTAGE-class skew (no readable version) may retain the
 * last-known-good advertisement, while a DRIFT-class skew (a readable version
 * PLoT cannot price) never may — live ISL is positively declaring a different
 * cost model, so the retained block is obsolete pricing with stale caps. The
 * discriminator is `advertisedVersion === undefined`.
 *
 * `validAdmissionShape` used to run first, and its early return carried no
 * version. So `{complexity_formula_version: 'v9-future', weights: null}` — a
 * partially-rolled-out ISL, telling PLoT in plain text that it has moved — was
 * reported as `missing_block` with NO advertised version, took the OUTAGE
 * branch, and got priced with the RETAINED v5 weights at full depth. A drift
 * laundered into an outage by field ORDER. The alarm even logged
 * `advertised_version: null`, so the one field that would have diagnosed it was
 * blank.
 *
 * Extracting the version first makes the discriminator see what the payload
 * actually said. It deliberately does NOT validate anything else: a version is
 * readable or it is not, independent of whether its siblings are usable.
 */
function readAdvertisedVersion(block: unknown): string | undefined {
  if (!block || typeof block !== 'object') return undefined;
  const v = (block as Record<string, unknown>).complexity_formula_version;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Classify a fetched /health payload into a resolution. */
function classify(health: ISLHealthResponse | null): AdmissionResolution {
  if (health === null) {
    return { admission: null, skew: true, status: 'unreachable' };
  }
  const block = health.compute_admission;

  // Version FIRST (see readAdvertisedVersion) — so a readable version survives a
  // garbled block and the drift/outage discriminator judges the payload, not the
  // order this function happens to check fields in.
  const advertisedVersion = readAdvertisedVersion(block);

  // The version gate, and the source of EVERY key set this block is judged
  // against — one map, so no two of them can disagree. Checked BEFORE the shape
  // gate: a version PLoT cannot price is drift regardless of what the rest of
  // the block looks like, and calling it `missing_block` would both mislabel the
  // alarm and (before 2.356) hand it to the retention branch.
  const spec =
    advertisedVersion === undefined ? undefined : COMPLEXITY_FORMULA_SPECS.get(advertisedVersion);
  if (advertisedVersion !== undefined && spec === undefined) {
    return { admission: null, skew: true, status: 'unknown_version', advertisedVersion };
  }

  if (!validAdmissionShape(block) || spec === undefined) {
    // A genuinely versionless or structurally garbled block. `advertisedVersion`
    // is threaded through when one WAS readable (a known version with unusable
    // siblings) — that is the "garbled weights under a readable version land
    // conservative" edge the #305 ruling accepted, and it only lands on the safe
    // side because the version travels with it.
    return { admission: null, skew: true, status: 'missing_block', ...(advertisedVersion !== undefined && { advertisedVersion }) };
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
      // ⚠ ROADMAP 2.356 — THE `false` BRANCH BELOW USED TO PROMISE A FALLBACK
      // THAT NO LONGER HAPPENS. It told responders "planning against the
      // conservative legacy scalar bound (base depth capped)... every DEFAULTED
      // analysis is now running at the reduced fallback depth". Since 2.356 that
      // state REFUSES the request with a 503 instead, because the scalar bound
      // could not promise admission against a gate it cannot read. An alarm that
      // misdescribes its own mitigation teaches responders the wrong recovery
      // (trap 7b) — here it would have had someone hunting for silently-shallow
      // results while the real symptom was refused requests.
      action: retained ? 'retained_last_known_good_admission' : 'fail_loud_refuse_requests',
      msg: retained
        ? 'ISL /health compute-admission read unusable with NO readable formula version (outage class) — planning continues against the LAST KNOWN GOOD advertisement (weighted pricing and structural caps stay live) while refreshes retry every TTL and self-heal on recovery. A READABLE version PLoT cannot price (drift) never retains and never takes this branch.'
        : 'ISL /health compute-admission handshake unusable and nothing retained (or the live read declares a formula PLoT cannot price — drift never retains). Analyses are being REFUSED with a 503 (ANALYSIS_ENGINE_ADMISSION_UNAVAILABLE) after one bounded retry, NOT planned against a scalar fallback: scalar arithmetic cannot promise admission against a weighted gate it cannot read, so planning blind produced requests ISL refused with a raw 422. If the advertised version is a formula PLoT does not know, the fix is a PLoT release that prices it; otherwise restore ISL /health.',
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
    } else if (
      resolution.skew &&
      resolution.advertisedVersion === undefined &&
      _lastKnownGood?.admission
    ) {
      // ROADMAP 2.289 fix (b), SCOPED BY REVIEW RULING (#305 amendment 1):
      // retention applies to the OUTAGE class ONLY — the live read carries NO
      // readable formula version (unreachable /health, or a payload so garbled
      // no version survives). There the last verified advertisement is almost
      // certainly still ISL's real gate, the alarm re-fires every TTL, and the
      // state self-heals on recovery.
      //
      // The DRIFT class — a READABLE advertised version PLoT cannot price
      // (unknown_version / unknown_weight_keys / unknown_cap_keys /
      // missing/unknown_formula_parameters) — must NOT retain: live ISL is
      // positively declaring a different cost model, so the retained block is
      // OBSOLETE pricing at full depth with stale caps and zero wire
      // disclosure, healing only via a PLoT code change. Drift takes the
      // conservative, wire-disclosed fallback instead. The discriminator is
      // PAYLOAD-DERIVED (was a version readable?), never a hand-listed set of
      // statuses (trap 12). Accepted edge, ruled: garbled weights under a
      // readable version land conservative — the safe side.
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
 * timeout (ISL_HEALTH_CHECK_TIMEOUT_MS, 5 s) when ISL is configured — and that
 * bound covers the ENTIRE /health read, headers AND body (#305 amendment 2:
 * client.ts withHealthTimeout; a trickling body cannot extend boot). Instant
 * (no network) when ISL is not configured. Never throws — a dead ISL warms to
 * a NAMED skew state and boot proceeds; the route's conservative disclosure
 * covers the gap.
 */
export async function warmIslComputeAdmission(): Promise<AdmissionResolution> {
  if (!isFresh(Date.now())) {
    await startRefresh();
  }
  return getIslComputeAdmission();
}

/**
 * What the depth planner should do about admission for THIS request.
 *
 * `refuse` carries an HTTP status and a code rather than a message so the route
 * owns the wording; what this module owns is the DECISION and its truthfulness.
 */
/**
 * Await one refresh, but NEVER longer than the health-check budget.
 *
 * ⚠ THE RACE IS NOT BELT-AND-BRACES — IT IS THE ONLY THING THAT MAKES "BOUNDED"
 * TRUE HERE, AND A TEST PROVED IT.
 *
 * `fetchHealth` bounds itself with an abort signal, so awaiting `startRefresh()`
 * directly looked bounded. It is bounded only if the underlying fetch HONOURS
 * that signal. `adaptive-n-samples-complexity.test.ts` stubs global fetch with a
 * promise that never settles — a fair model of a socket that accepts and then
 * goes silent — and the first cut of this function hung on it until the test
 * timed out at 15 s. In front of a live route that is a request that never
 * answers, which is strictly worse than the blind planning this whole change
 * exists to remove.
 *
 * So the bound is enforced HERE, where the blocking happens, rather than
 * inherited from a collaborator's promise. On timeout the refresh keeps running
 * in the background (it will populate the cache for the next request if it ever
 * lands); this call simply stops waiting and decides on what is in hand — which
 * is a refusal, the safe answer.
 */
async function refreshWithHardBound(): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const bound = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ISL_HEALTH_CHECK_TIMEOUT_MS);
    // Do not hold the process open on this timer.
    timer.unref?.();
  });
  try {
    await Promise.race([startRefresh(), bound]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export type AdmissionPlanningOutcome =
  | {
      kind: 'plan';
      resolution: AdmissionResolution;
      /** Pass-through to planSampleDepth — the retained-skew fail-safe posture. */
      conservative: boolean;
    }
  | {
      kind: 'refuse';
      code: 'ANALYSIS_ENGINE_ADMISSION_UNAVAILABLE';
      httpStatus: 503;
      resolution: AdmissionResolution;
    };

/**
 * Resolve admission for one request: plan against a real advertisement, or
 * REFUSE — never plan blind.
 *
 * ⚠ ROADMAP 2.356 — THIS REPLACES THE BLIND SCALAR FALLBACK, AND THE REASON IS
 * ARITHMETIC, NOT TASTE.
 *
 * `sampling.ts` already states it: "NO scalar arithmetic can promise admission
 * against a weighted gate it cannot see." Both witnesses are pinned in tests.
 * From 2.289: N=20/E=40/O=10/U=19 at the CAPPED 4,000-sample fallback depth
 * prices at 29.4M against ISL's 24M ceiling — the fallback's own output is a
 * request ISL refuses. From this lane, the same graph read from the other end:
 * its scalar cost at that depth is 3.2M, comfortably inside BOTH scalar budgets,
 * so every scalar gate waves it through. The conservative fallback is not a
 * weaker guarantee than weighted planning; on this shape it is no guarantee at
 * all, and what the user gets is a raw 422 from ISL with PLoT's fingerprints on
 * the decision to send it.
 *
 * So when ISL is configured and PLoT holds NO usable advertisement, this takes
 * ONE bounded synchronous refresh — a cold cache must not produce a refusal that
 * a single /health read would have avoided, and the refresh is bounded by
 * ISL_HEALTH_CHECK_TIMEOUT_MS over headers AND body (#305 amendment 2) — and
 * then refuses with a typed 503.
 *
 * WHY 503 AND NOT 422. The caller's graph is fine; PLoT's view of the analysis
 * engine is not. A 422 would blame the user for an infrastructure state and
 * teach them to edit a graph that was never the problem — the same
 * misattribution class as reporting a seam-caused depth cut as
 * `admission_budget`. 503 is retryable, and the next request self-heals as soon
 * as a refresh succeeds.
 *
 * TWO STATES DELIBERATELY KEEP PLANNING:
 *  - `disabled` (ISL not configured): there is no gate downstream to violate.
 *  - a RETAINED last-known-good admission (outage-class skew): PLoT holds a real,
 *    previously-verified advertisement. That is exactly what retention is for,
 *    and refusing here would throw away the mitigation 2.289 built. It still
 *    plans `conservative`, so the fail-safe posture is unchanged.
 */
export async function resolveAdmissionForPlanning(): Promise<AdmissionPlanningOutcome> {
  const decide = (resolution: AdmissionResolution): AdmissionPlanningOutcome | null => {
    if (resolution.status === 'disabled') {
      return { kind: 'plan', resolution, conservative: false };
    }
    // A usable block — live or retained — is what "we can price this" means.
    if (resolution.admission !== null) {
      return { kind: 'plan', resolution, conservative: shouldPlanConservatively(resolution) };
    }
    return null;
  };

  // ONE bounded synchronous refresh, and ONLY when the cache is cold or stale.
  //
  // ⚠ THE FRESHNESS GATE IS LOAD-BEARING, IN TWO DIRECTIONS. Refreshing an
  // unusable-but-FRESH resolution is pointless — a second /health read inside
  // the TTL returns what the first one did, so it would buy nothing and add a
  // blocking network round-trip to a request that is going to be refused
  // anyway. And it would silently overwrite a deliberately-established cache
  // state, which is how the first cut of this function made three route tests
  // pass for the wrong reason: they seeded a skew, the resolver threw it away
  // and re-read, and the assertion measured the re-read instead of the state
  // under test.
  //
  // So: cold/stale → read once and decide on the result; fresh → decide on what
  // we already know.
  if (!isFresh(Date.now())) {
    await refreshWithHardBound();
  }

  const resolution = getIslComputeAdmission();
  const second = decide(resolution);
  if (second !== null) return second;

  return {
    kind: 'refuse',
    code: 'ANALYSIS_ENGINE_ADMISSION_UNAVAILABLE',
    httpStatus: 503,
    resolution,
  };
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
