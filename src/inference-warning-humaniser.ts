/**
 * Inference-warning humaniser — deterministic template-based `user_message`
 * generation for the `inference_warnings` channel.
 *
 * WHY THIS EXISTS, and why it is NOT `critique-humaniser.ts`
 * ---------------------------------------------------------
 * `critique-humaniser.ts` owns the CRITIQUE channel and its coverage guard
 * (`tests/isl-critique-copy-coverage.test.ts`) closes 35 ISL critique codes.
 * That guard scopes this channel OUT, in its own words:
 *
 *   "NOT included, deliberately: ISL's `InferenceWarning` channel (14 further
 *    codes, e.g. ROOT_NODE_DEFAULT_VALUE, FACTOR_EVPPI_UNAVAILABLE). Those
 *    ride `inference_warnings` ... Whether that channel puts a bare code on a
 *    user surface is a separate question with a separate owner."
 *
 * This file is that owner. The two channels are DIFFERENT NAMESPACES keyed by
 * DIFFERENT registries and they are deliberately not merged: a code can exist
 * on one, the other, or both (CONSTRAINT_NODE_DEFAULT_BASE is on both, proven
 * at `tests/fixtures/isl-constraint-value-frame-20260807/`). Merging the maps
 * would make a critique template silently answer for a warning whose producer
 * semantics differ.
 *
 * THE LIVE LEAK THIS CLOSES
 * -------------------------
 * `assembly/decision-brief.ts buildDefaultedAssumptions` echoes a DEFAULT-coded
 * warning's producer `message` VERBATIM into
 * `decision_brief.defaulted_assumptions[].note` — a rendered brief surface. So
 * a user could be shown, word for word:
 *
 *   "Node 'out_throughput' has no ParameterUncertainty — base offset defaulted
 *    to 0.0; its samples are the forward-propagated composition of its parents"
 *
 * (captured, `A-control-no-frame.response.json`). Producer `message` strings on
 * this channel interpolate raw node ids and internal field names; they are a
 * DEBUG channel and are never echoed here.
 *
 * COPY RULES APPLIED HERE
 * -----------------------
 * - British English. Plain sentences. No markdown, no exclamation marks, and no
 *   em dashes (the estate's producer-copy ruling, recorded in
 *   `tests/isl-v2-golden-response.pin.test.ts`).
 * - Say what it means for the DECISION, not what the engine did.
 * - Where a default was substituted, say ZERO plainly. It is not an estimate.
 * - Do not name a CAUSE the producer does not guarantee. See EVPI_UNAVAILABLE.
 * - Do not prescribe "add a value" where the state can be legitimate.
 * - Severity is never invented or changed here. Copy only.
 */

import type { DisclosureBucket, InferenceWarning } from './types/engine-v3.js';
import type { ISLRangeFitRefusalPayload } from './integrations/isl/types/isl-types.js';

/**
 * The vocabulary stays exported from here, where every existing importer looks
 * for it. It is DECLARED beside `InferenceWarning` in `types/engine-v3.js`
 * because that is where the field carrying it lives; re-exporting rather than
 * redeclaring is the difference between one definition and two that agree
 * today (trap 12).
 */
export type { DisclosureBucket };

/**
 * ISL's CLOSED range-fit refusal vocabulary, READ OFF THE WIRE TYPE rather than
 * retyped. Seven members at the pinned OpenAPI, pinned against ISL's own enum
 * by RED 2b.
 */
type RangeFitRefusalCode = ISLRangeFitRefusalPayload['code'];

/**
 * The clause every refusal shares, and the ONLY cause-free string in the family.
 * Separated out so RED 2d can assert by identity which codes use it.
 */
const RANGE_REFUSAL_NO_CAUSE_NAMED =
  'A range you gave for one of your factors could not be turned into a spread of values. ' +
  'Nothing was fitted to it and nothing was substituted in its place, so no part of this analysis rests on a guess about it. ' +
  'The range is listed with this run exactly as you stated it, alongside the reason it was refused.';

/**
 * ⭐⭐ THE SEVEN RANGE-FIT REFUSALS — EXHAUSTIVE AT COMPILE TIME. This is the
 * direct answer to review F5, including the part of F5 that was an argument
 * about method rather than about a missing string.
 *
 * WHAT WAS WRONG. `ISL_FORWARDED_CODES` in the coverage suite is a HAND LIST,
 * declared as one, on the reasoning that only a hand list can notice a SHORT
 * list. It was short. `RANGE_INVALID_ORDER` is LIVE-CAPTURED on this exact
 * channel (`tests/fixtures/isl-range-fit-live-20260807/C-invalid-order.response.json`)
 * carrying a user-ready `detail.message` that PLoT's ISL merge promotes to
 * `message` — and the contract this PR wrote tells consumers to show NOTHING for
 * a code with no `user_message`. So a person who stated their own range, and had
 * it refused, was to be shown nothing at all. On capability P4 that is the worst
 * available outcome: the one place the product asks for the user's own judgement
 * is the one place it went silent.
 *
 * ⭐ AND THIS RECORD CANNOT GO SHORT, WHICH IS THE POINT.
 * `Record<RangeFitRefusalCode, string>` is EXHAUSTIVE BY CONSTRUCTION:
 * `RangeFitRefusalCode` is ISL's own closed union read off the wire type, so an
 * eighth refusal code is a COMPILE ERROR here, in the repo's required TypeScript
 * check, with no list for anyone to remember to update. That is the
 * completeness guarantee trap 12d says derivation cannot give you — and it can
 * be given HERE precisely because this vocabulary is CLOSED and TYPED, which the
 * open `inference_warnings` code space is not. The hand list is still right
 * about the open space; it was wrong about this closed corner of it.
 *
 * WHAT EVERY ONE OF THE SEVEN MAY SAY, and why it is the same clause. ISL's own
 * model documents the FAMILY, not the members:
 *
 *   "A refusal always means: the value stays disclosed as confirmed, NO
 *    distribution is produced, compute is untouched. Never a fallback — a
 *    Beta(1,1) minted on solver failure is a fabricated value wearing real
 *    provenance, this estate's dominant defect."
 *   (tests/fixtures/isl-pinned/isl-openapi.json, RangeFitRefusalPayload)
 *
 * That guarantee holds for all seven, so all seven state it.
 *
 * ⛔ THE CAUSE IS NAMED ONLY WHERE THE PRODUCER GUARANTEES IT. Three are
 * grounded in this repo at the bytes:
 *   RANGE_INVALID_ORDER      the live capture above, ISL's own sentence: "The
 *                            lower bound is greater than the upper bound."
 *   RANGE_OPEN_ENDED         pinned OpenAPI, UserStatedRange.lower/upper:
 *                            "Absent = open-ended below ('no more than X'),
 *                            which is refused RANGE_OPEN_ENDED".
 *   RANGE_FIT_NONCONVERGENT  pinned OpenAPI, starts_tried: "how many starts of
 *                            the deterministic two-start ladder were tried
 *                            before refusing" — the solver ran and did not
 *                            settle.
 * The other four get NO cause. Their code NAMES suggest one; a name is not a
 * producer guarantee (review F10, and trap 13c — an expectation written from
 * what a field seemed to mean is a full mark on the wrong exam). They get the
 * family sentence and a pointer to the row, which carries the bounds as stated
 * and ISL's own sanitised reason. Pinned as an explicit set by RED 2d, so this
 * is a recorded gap rather than an invisible one: it REDs if someone invents a
 * cause, and it REDs if a grounded one quietly loses its.
 *
 * ⛔ AND NONE OF THEM MAY IMPLY THE RANGE WOULD OTHERWISE HAVE MOVED THE
 * NUMBERS. `types/engine-v3.ts` is explicit: "CARRIED, NOT APPLIED (ISL stage
 * S3) ... ISL's compute is BYTE-IDENTICAL whether or not this field is present
 * ... Do not describe this to a user as 'your range now counts'." An apology for
 * a lost effect the ACCEPTED path does not yet have would be a fresh false
 * claim, bought while fixing a silence.
 */
const RANGE_FIT_REFUSAL_COPY: Record<RangeFitRefusalCode, string> = {
  RANGE_INVALID_ORDER:
    'The range you gave for one of your factors has its lower bound above its upper bound. ' +
    'We have kept it exactly as you stated it and nothing was substituted in its place, because which way round you said it is part of what you meant. ' +
    'Restate it with the smaller number first.',

  RANGE_OPEN_ENDED:
    'The range you gave for one of your factors names only one end, an upper bound or a lower bound but not both. ' +
    'A one-sided statement leaves the other end undefined, so no spread was fitted to it and nothing was substituted in its place. ' +
    'Give both ends if you want it read as a range.',

  RANGE_FIT_NONCONVERGENT:
    'The range you gave for one of your factors was tried, and no spread of values could be settled on that matches it. ' +
    'Nothing was fitted to it and nothing was substituted in its place, so no part of this analysis rests on a guess about it. ' +
    'The range is listed with this run exactly as you stated it, alongside the reason it was refused.',

  // ⛔ Cause NOT named. See RANGE_REFUSAL_CAUSE_NOT_NAMED below and RED 2d.
  RANGE_ZERO_WIDTH: RANGE_REFUSAL_NO_CAUSE_NAMED,
  RANGE_NON_FINITE: RANGE_REFUSAL_NO_CAUSE_NAMED,
  RANGE_OUT_OF_DOMAIN: RANGE_REFUSAL_NO_CAUSE_NAMED,
  RANGE_AT_DOMAIN_EDGE: RANGE_REFUSAL_NO_CAUSE_NAMED,
};

/**
 * ⭐ THE RECORDED GAP, PINNED EXACTLY (RED 2d) — the refusals whose CAUSE this
 * repo cannot yet ground at a producer byte. Exported so the guard reads the set
 * rather than a copy of it, and so it REDs if the set GROWS (a grounded cause
 * was quietly dropped) or SHRINKS (a cause was invented from a code name).
 * A gap recorded in the suite is honest; a gap invisible to it is how it comes
 * back.
 */
export const RANGE_REFUSAL_CAUSE_NOT_NAMED: ReadonlySet<RangeFitRefusalCode> = new Set([
  'RANGE_ZERO_WIDTH',
  'RANGE_NON_FINITE',
  'RANGE_OUT_OF_DOMAIN',
  'RANGE_AT_DOMAIN_EDGE',
]);

/**
 * DERIVED from the exhaustive record above, never listed again. The coverage
 * guard folds these into its ALL_COVERED set through this export, so a code
 * added to ISL's union is compelled to have copy by tsc AND is swept by every
 * RED in that suite without anyone editing a list.
 */
export const RANGE_FIT_REFUSAL_CODES: readonly RangeFitRefusalCode[] =
  Object.keys(RANGE_FIT_REFUSAL_COPY) as RangeFitRefusalCode[];

/**
 * ⚠ ALL SEVEN ARE `not_your_number`, AND THE THIRD LIMB IS THE ONE THAT CARRIES
 * IT: "could not be evaluated". The user stated a range; no distribution was
 * produced from it. The one thing this must never read as is REASSURANCE, which
 * is exactly what the `expected` bucket is defined to read as — so the boundary
 * case that review F3 left open for SAMPLES_REDUCED_FOR_COMPLEXITY does not
 * arise here, and this file is not quietly settling that question by analogy.
 */
const RANGE_FIT_REFUSAL_BUCKETS: Record<RangeFitRefusalCode, DisclosureBucket> = {
  RANGE_ZERO_WIDTH: 'not_your_number',
  RANGE_INVALID_ORDER: 'not_your_number',
  RANGE_NON_FINITE: 'not_your_number',
  RANGE_OUT_OF_DOMAIN: 'not_your_number',
  RANGE_AT_DOMAIN_EDGE: 'not_your_number',
  RANGE_OPEN_ENDED: 'not_your_number',
  RANGE_FIT_NONCONVERGENT: 'not_your_number',
};

/**
 * User-facing copy keyed by inference-warning code.
 *
 * Every string is derived from the PRODUCER's declared semantics (the jsdoc on
 * `INFERENCE_WARNING_CODES` in `types/engine-v3.ts`, ISL's pinned OpenAPI at
 * `tests/fixtures/isl-pinned/`, and real captured responses), never from what a
 * field name seemed to mean.
 */
export const INFERENCE_WARNING_COPY: Record<string, string> = {
  // =========================================================================
  // Defaulted inputs — the engine substituted ZERO for a missing value.
  //
  // These are the highest-value strings in this file. ISL's own pinned OpenAPI
  // defines the underlying check as "no observed value was provided, so it fell
  // back to 0.0". Zero is a SUBSTITUTION, not an estimate, and the copy says so
  // rather than softening it into "used a default".
  // =========================================================================

  /**
   * ISL, robustness_analyzer_v2. A ROOT factor carries no observed value, so
   * its value fell back to 0.0. Same observed-value check as the
   * `value_defaulted` flag on factor_sensitivity (ISL pinned OpenAPI).
   *
   * The closing sentence is CONDITIONAL on purpose: a factor whose real
   * starting point genuinely is zero is a legitimate state, so this must not
   * instruct every reader to go and change it.
   */
  ROOT_NODE_DEFAULT_VALUE:
    'A starting factor in your model has no measured value, so the analysis used zero for it. ' +
    'Zero is a substitute, not an estimate of what that factor really is, and anything downstream of it inherits that. ' +
    'If zero is not the right starting point, set the real value and run the analysis again.',

  /**
   * ISL. The constraint's target node carries no ParameterUncertainty, so its
   * BASE OFFSET defaulted to 0.0 and its samples are the forward-propagated
   * composition of its parents.
   *
   * ⚠ The producer is explicit that when every root ancestor DOES carry data
   * this is "model-derived, not a missing-data placeholder" — so the copy
   * states the zero plainly WITHOUT calling the figure unreliable, which would
   * be false for that case. It names what the probability is measured FROM,
   * which is the thing a reader can actually act on.
   */
  CONSTRAINT_NODE_DEFAULT_BASE:
    'The factor your constraint is measured on has no measured starting value, so the analysis started it at zero and built its range from the factors feeding into it. ' +
    'The probability shown is therefore about modelled change away from zero, not distance from a known starting point. ' +
    'Giving that factor a real starting value would make the figure directly comparable to it.',

  // =========================================================================
  // Constraints and goal fit
  // =========================================================================

  /**
   * `lib/constraint-reliability.ts`. The constraint target is not
   * decision-grade: threshold normalisation fell back to [0,1] and/or ISL
   * defaulted the base to 0.0. `probability_of_joint_goal` and
   * `constraint_probabilities` are SUPPRESSED for the run, so the copy must
   * describe a WITHHELD figure, not a shown one.
   */
  // ⛔ DELIBERATELY ABSENT — see DELIBERATELY_NO_USER_MESSAGE below (review F2).
  // CONSTRAINT_TARGET_UNRELIABLE is NOT given copy here, because a generic
  // string would DISPLACE a better, reason-differentiated one.

  /**
   * Doctrine B (P0-C2). Goal-fit probabilities WERE delivered, scored from the
   * target's forward-propagated outcome distribution. Severity: info. The copy
   * must therefore reframe how to READ a figure that is present, and must not
   * imply anything was withheld.
   */
  CONSTRAINT_GOALFIT_MODELLED_BASIS:
    'The goal-fit figures here are shown, but the factor your goal is measured on has no measured starting value, so the analysis started it at zero. ' +
    'Read them as modelled change driven by the factors upstream of it, not as distance from a known starting point.',

  /**
   * Defensive sign-check on the auto-constraint fallback. PLoT synthesised a
   * `>= threshold` constraint from a bare number and cannot tell "at least X"
   * from "at most X"; the modelled distribution never reaches non-negative
   * territory even at p90, so a ~0% joint-goal probability would be an artefact
   * of the sign, not of the graph. Suppressed in favour of this warning.
   */
  CONSTRAINT_DIRECTION_SUSPECT:
    'Your goal threshold was read as a level to reach or beat, but the modelled results never come close to it, which usually means it was meant as a limit not to exceed. ' +
    'The goal-fit probability is withheld rather than reported as near zero on what looks like a misreading. ' +
    'Restate the goal so the direction is explicit, then run it again.',

  /**
   * ISL. A constraint value arrived with no `value_frame`, so whether it is a
   * target LEVEL or a CHANGE from the starting point is unknown.
   * `constraint_analysis` is omitted rather than guessed.
   */
  CONSTRAINT_FRAME_UNSPECIFIED:
    'Your constraint gives a number but not what it is measured against, either a level to reach or a change from where things stand now. ' +
    'Those two readings give very different answers, so the constraint result is withheld rather than guessed. ' +
    'Say which one you mean and run the analysis again.',

  /**
   * ISL. A `level` frame requires the target node to carry
   * `observed_state.baseline` so the level can be converted into the samples'
   * frame; the node carries no observed state at all.
   */
  CONSTRAINT_NOT_CONVERTIBLE:
    'Your constraint is set as a level to reach, but the factor it applies to has no measured starting value to judge that level against. ' +
    'The constraint result is withheld rather than reported on a footing we cannot ground. ' +
    'Either give that factor a starting value, or restate the constraint as a change rather than a level.',

  // =========================================================================
  // Coverage limits — something is ABSENT, and the copy must say whether that
  // absence is a finding or a failure. This is the distinction these codes
  // exist to make, so it is the distinction the copy has to carry.
  // =========================================================================

  /**
   * ⭐ The whole flip-threshold block threw. The producer's own point is that
   * empty here means COULD NOT CHECK, not NOTHING COULD FLIP. Collapsing that
   * into "no factor could change the result" would be the exact false reading
   * the marker was added to prevent.
   */
  FLIP_THRESHOLDS_UNAVAILABLE:
    'The tipping-point calculation did not complete for this run, so no tipping points are shown. ' +
    'This does not mean nothing could change the leading option. It means we could not check. ' +
    'The rest of the analysis is unchanged.',

  /**
   * ISL seed-sweep flip-stability bands degraded all-or-nothing.
   *
   * ⚠ NO CAUSE IS NAMED. The producer jsdoc says "budget trip", but see
   * EVPI_UNAVAILABLE below: a sibling in this same family was captured live
   * degrading for a reason that has nothing to do with time. The jsdoc names
   * the reason it was BUILT for, which is not the same as the domain.
   */
  STABILITY_BANDS_UNAVAILABLE:
    'The stability ranges around the tipping points could not be produced for this run, so they are not shown. ' +
    'The tipping-point values themselves are unchanged, but you are reading them as single figures with no range around them.',

  /** ISL edge E-value phase degraded. Cause deliberately unnamed, as above. */
  E_VALUES_UNAVAILABLE:
    'We could not work out how far each connection would have to move to change the result, so that detail is not shown. ' +
    'The rest of the analysis is unchanged.',

  /**
   * ⭐ ISL's per-factor value-of-information phase degraded.
   *
   * ⚠ THE PRODUCER JSDOC SAYS "wall-clock budget", AND THE CAPTURED INSTANCE
   * DISAGREES. `A-control-no-frame.response.json` carries EVPI_UNAVAILABLE with
   * `reason: "constraints_not_convertible"` and a 60ms elapsed time, i.e. it
   * degraded because a goal constraint could not be resolved into its target's
   * sample frame, not because it ran out of time. Copy that said "ran out of
   * time" would be FALSE on the only instance we have actually captured.
   *
   * "EVPI" is never printed: rule 5 forbids unexpanded jargon.
   */
  EVPI_UNAVAILABLE:
    'We could not work out which of your unknowns would be most worth resolving first, so that guidance is not shown. ' +
    'The option comparison itself is unchanged, but you are choosing where to dig next without that steer.',

  /** ISL structural path decomposition degraded. Cause deliberately unnamed. */
  PATH_DECOMPOSITION_UNAVAILABLE:
    'We could not break down how influence travels along each route through your model, so that breakdown is not shown. ' +
    'The option comparison itself is unchanged, but you are reading it without the account of how it arises.',

  /**
   * Edge-level sensitivity was requested but the deployed ISL's wire omits the
   * field entirely. The producer is explicit: empty because the WIRE omitted
   * it, NOT by computation failure, and "PLoT does not invent a substitute".
   * Factor-level sensitivity is unaffected, so the copy says so.
   */
  EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE:
    'Sensitivity for individual connections is not available from the analysis engine on this run, so it is not shown. ' +
    'That is a limit of the engine version in use rather than anything about your model, and sensitivity for factors is unchanged.',

  /** Same shape as above for the edge E-value wire LOCATION being absent. */
  EDGE_E_VALUES_UNAVAILABLE_V2_WIRE:
    'Tipping-point values for individual connections are not available from the analysis engine on this run, so none are shown. ' +
    'That is a limit of the engine version in use rather than a result computed from your model.',

  /**
   * ISL returned factor-level fields but `stability_thresholds` was absent or
   * malformed, so how far a factor must move before the ranking changes is
   * unknown for this run.
   */
  STABILITY_THRESHOLDS_MISSING:
    'We could not work out how far each factor would have to move before the ranking of your options changes, so that detail is not shown. ' +
    'The ranking itself is unchanged, but you cannot see how close it is to changing.',

  // =========================================================================
  // Data quality and internal disclosures
  // =========================================================================

  /**
   * ROADMAP 1.54. Sample depth was reduced BEFORE the ISL call to fit the
   * complexity budget. The run succeeded; precision, not correctness, is what
   * moved, and `meta.n_samples` reports the true reduced depth.
   */
  // ⚠ "SOUND" WAS A CLAIM THE PRODUCER DOES NOT MAKE (review F3). The registry
  // entry says "probabilities may be less stable" at severity `warning` — this
  // is the only `expected`-bucket code carrying that severity. The copy now
  // states the producer's own consequence instead of upgrading it to soundness.
  //
  // ⚠ THE BUCKET QUESTION IS LEFT OPEN ON PURPOSE, not settled here. The review
  // offered "re-bucket, or widen the definition to match the purpose", and both
  // are design calls with estate-wide reach: `DisclosureBucket` has exactly two
  // members, and neither fits — `not_your_number` is defined as "substituted,
  // defaulted, or could not be evaluated", and a reduced sample count is none of
  // those, it is LESS PRECISE. That mismatch between the bucket's DEFINITION and
  // its stated PURPOSE ("whether a number can be trusted") is real and is trap
  // 21; forcing this code into one of two ill-fitting members would hide it.
  // Fixing the false claim needs no such decision, so it is made here and the
  // taxonomy question is left to its owner.
  SAMPLES_REDUCED_FOR_COMPLEXITY:
    'This model is large, so the analysis ran fewer simulations than usual in order to finish. ' +
    'The probabilities are therefore less stable than normal, and simplifying the model would steady them.',

  /**
   * Producer-side egress validation failed. FAIL-OPEN: delivery is never
   * blocked or mutated, so the copy must not suggest the analysis was stopped.
   */
  ENRICHMENT_CONTRACT_MISMATCH:
    'Part of this result did not match the format we expect, so some supporting detail may be missing or worth treating with caution. ' +
    'The option comparison itself is unchanged, and the problem has been recorded on our side.',

  /**
   * Factor entries arrived carrying two identifiers that disagree, so they were
   * DROPPED from the public surfaces rather than resolved to a guessed identity.
   */
  FACTOR_ID_CONFLICT:
    'One or more factors arrived with identifiers that disagree, so they were left out of the sensitivity and influence results rather than reported under a guessed identity. ' +
    'Everything else in this analysis is unchanged.',

  /**
   * Edge E-value entries dropped because a required number was non-finite.
   * Severity: info. ISL routinely emits null for unflippable edges, so the copy
   * must not read as an alarm.
   */
  // ⚠ THE CAUSE IS DELIBERATELY NOT NAMED, AND THAT IS THE FIX (review F1).
  // The producer splits two causes: `inputNull` — "an unflippable edge, whose
  // current and flip means coincide, has no evidence ratio", the NORMAL and
  // common case — and `overflow`, "became non-finite after range
  // denormalisation". The first version of this string asserted the OVERFLOW
  // limb for both ("numbers too large or too small to report") while the golden
  // this PR regenerates is 4/4 input-null and 0 overflow.
  //
  // ⛔ AND IT SAILED PAST THE GUARD WRITTEN TO PREVENT EXACTLY THIS.
  // `tests/edge-e-value-drop-cause.test.ts` exists to stop this cause being
  // described as a transformation overflow — but it asserts on `message`, and
  // this is `user_message`, one layer up where it cannot see. A new surface
  // does not inherit the guards of the old one.
  //
  // `humaniseInferenceWarning(code)` is code-keyed and cannot see the counts,
  // so a cause-ACCURATE string is not available at this seam. Naming no cause
  // is therefore the honest option, and it matches the `EVPI_UNAVAILABLE`
  // precedent in this same map.
  EDGE_E_VALUE_NON_FINITE_DROPPED:
    'Some connections could not be given a tipping-point figure, so those entries were left out rather than shown as blanks. ' +
    'The remaining connections and the rest of the analysis are unchanged.',

  // =========================================================================
  // ISL range-fit refusals (review F5). Spread from a record that tsc keeps
  // EXHAUSTIVE against ISL's closed vocabulary — see RANGE_FIT_REFUSAL_COPY.
  // =========================================================================
  ...RANGE_FIT_REFUSAL_COPY,
};

/**
 * ⭐⭐ CODES THAT DELIBERATELY HAVE NO `user_message`, AND THE SET IS PINNED
 * EXACTLY — it REDs if it GROWS or SHRINKS, so neither half can move silently.
 *
 * Absence on this channel already means "fall back to the producer", and for
 * these codes the producer's own message is BETTER than anything a code-keyed
 * template can say.
 *
 * `CONSTRAINT_TARGET_UNRELIABLE`: `ConstraintUnreliabilityReason` has FOUR
 * limbs, and a single-cause template names one cause and one remedy. On three of
 * the four the stated cause is false and the prescribed action cannot unblock
 * the target. This repo already argues the point against itself, at
 * `buildConstraintTargetUnreliableMessage`:
 *
 *   "A single-cause message here is not merely incomplete, it is a REGRESSION …
 *    A more precise diagnosis that removes the user's only working remedy is a
 *    worse message."
 *
 * Since the contract tells consumers to PREFER `user_message`, supplying one
 * here would override that reason-differentiated producer message with the
 * generic. Withholding the template is what keeps the better message reachable.
 */
export const DELIBERATELY_NO_USER_MESSAGE: ReadonlySet<string> = new Set([
  'CONSTRAINT_TARGET_UNRELIABLE',
]);

/**
 * Bucket per code. Every code in INFERENCE_WARNING_COPY has an entry; the
 * coverage guard derives that requirement rather than mirroring a list.
 */
export const INFERENCE_WARNING_BUCKET: Record<string, DisclosureBucket> = {
  // --- Substituted / defaulted values -------------------------------------
  /** ISL substitutes base = 0.0 when no observed value was given. */
  ROOT_NODE_DEFAULT_VALUE: 'not_your_number',
  /** Base offset defaulted to 0.0 on the constraint's target node. */
  CONSTRAINT_NODE_DEFAULT_BASE: 'not_your_number',
  /** Goal-fit figures ARE shown, but they rest on a base defaulted to 0.0. */
  CONSTRAINT_GOALFIT_MODELLED_BASIS: 'not_your_number',

  // --- Could not be evaluated ---------------------------------------------
  /** Joint-goal probability suppressed: the synthesised constraint's sign is suspect. */
  CONSTRAINT_DIRECTION_SUSPECT: 'not_your_number',
  /** constraint_analysis omitted rather than guessed: the value's frame is unknown. */
  CONSTRAINT_FRAME_UNSPECIFIED: 'not_your_number',
  /** Constraint result withheld: the level has no baseline to convert against. */
  CONSTRAINT_NOT_CONVERTIBLE: 'not_your_number',
  /** The block THREW. Empty means "could not check", never "nothing could flip". */
  FLIP_THRESHOLDS_UNAVAILABLE: 'not_your_number',
  /** Bands degraded all-or-nothing, so the ranges on screen are absent, not nil. */
  STABILITY_BANDS_UNAVAILABLE: 'not_your_number',
  /** Edge E-value phase degraded. */
  E_VALUES_UNAVAILABLE: 'not_your_number',
  /** Value-of-information phase degraded or could not resolve a constraint. */
  EVPI_UNAVAILABLE: 'not_your_number',
  /** Path decomposition degraded. */
  PATH_DECOMPOSITION_UNAVAILABLE: 'not_your_number',
  /** Threshold classification context absent, so the banding is not computed. */
  STABILITY_THRESHOLDS_MISSING: 'not_your_number',
  /**
   * The wire omitted the LOCATION, so an empty edge list on screen is an
   * ABSENCE, not a computed zero. That is the whole reason the marker exists,
   * and it is the same reading-error FLIP_THRESHOLDS_UNAVAILABLE guards.
   */
  EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE: 'not_your_number',
  /** Same: an absent wire location, not a computed-empty result. */
  EDGE_E_VALUES_UNAVAILABLE_V2_WIRE: 'not_your_number',
  /** Typed keys failed egress validation, so some detail on screen may be corrupt. */
  ENRICHMENT_CONTRACT_MISMATCH: 'not_your_number',
  /** Entries DROPPED from the sensitivity and influence surfaces the user reads. */
  FACTOR_ID_CONFLICT: 'not_your_number',

  // --- The engine behaving correctly and saying so ------------------------
  /**
   * A null e_value means the edge is UNFLIPPABLE (current_mean == flip_mean), so
   * there is no evidence ratio to express. PLoT drops the entry rather than
   * fabricate a number. Nothing is wrong and nothing was substituted.
   */
  EDGE_E_VALUE_NON_FINITE_DROPPED: 'expected',
  /**
   * ⚠ BOUNDARY CASE, and the reason is recorded so a reader can disagree with
   * it rather than inherit it. The run SUCCEEDED and nothing was substituted,
   * defaulted or left unevaluated, so it satisfies none of the three
   * not-your-number limbs: the engine adapted to fit the compute budget and
   * disclosed that it did. It is NOT pure reassurance, though — the
   * probabilities carry more sampling error than the depth the +/-3pp
   * calibration assumes, so a consumer should render the precision caveat and
   * not file this under "all clear".
   */
  SAMPLES_REDUCED_FOR_COMPLEXITY: 'expected',

  // --- ISL range-fit refusals (review F5) ---------------------------------
  ...RANGE_FIT_REFUSAL_BUCKETS,
};

/** The bucket for a code, or `undefined` when the code has no copy here. */
export function inferenceWarningBucket(code: string): DisclosureBucket | undefined {
  return INFERENCE_WARNING_BUCKET[code];
}

/**
 * Resolve user-facing copy for one inference-warning code.
 *
 * Returns `undefined` for a code with no copy — deliberately, and this is the
 * opposite of `critique-humaniser`'s generic fallback. A critique is always
 * shown to someone, so a code-free fallback beats a leaked machine code there.
 * An inference warning with no copy stays a pure DIAGNOSTIC: attaching a vague
 * "something was noted" sentence would put a claim on a user surface that no
 * producer made, and `message` is still carried for the advanced details.
 */
export function humaniseInferenceWarning(code: string): string | undefined {
  return INFERENCE_WARNING_COPY[code];
}

/** An inference warning that carries product copy. */
export type HumanisedInferenceWarning = InferenceWarning & { user_message: string };

/**
 * Attach `user_message` to each warning that has copy, leaving the rest exactly
 * as they were. Returns a new array and never mutates the input.
 *
 * `code`, `message`, `severity`, `field` and `elapsed_ms` are all preserved:
 * the diagnostic channel is additive-only, never replaced. `user_message` and
 * `disclosure_bucket` are ADDITIVE keys on a passthrough element of
 * `AnalysisEnrichmentSchema`, verified by execution against the vendored schema
 * with failing contrast controls, so neither can itself raise
 * ENRICHMENT_CONTRACT_MISMATCH.
 */
export function addInferenceWarningUserMessages(
  warnings: readonly InferenceWarning[],
): InferenceWarning[] {
  return warnings.map((w) => {
    const userMessage = humaniseInferenceWarning(w.code);
    // REVIEW F6 — the bucket travels WITH the copy, on the same element, so the
    // taxonomy stops being dark. The two are looked up INDEPENDENTLY rather
    // than one inferred from the other: RED 14 asserts they cover exactly the
    // same codes, and a guard that ASSUMES its own invariant cannot notice it
    // breaking.
    const bucket = inferenceWarningBucket(w.code);
    return {
      ...w,
      ...(userMessage !== undefined && { user_message: userMessage }),
      ...(bucket !== undefined && { disclosure_bucket: bucket }),
    };
  });
}

/** Codes with explicit copy. Used by the coverage guard. */
export function getKnownInferenceWarningCodes(): string[] {
  return Object.keys(INFERENCE_WARNING_COPY);
}
