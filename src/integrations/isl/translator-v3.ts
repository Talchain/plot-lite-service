/**
 * ISL Translator for V3 Engine
 *
 * Translates from internal EngineGraphV3 format to ISL wire format.
 * ISL expects a flattened format with different field names.
 *
 * @see Integration Alignment Implementation Brief v1.1
 */

import type {
  EngineGraphV3,
  EngineNodeV3,
  EngineEdgeV3,
  OptionV3,
  InterventionValueV3,
  GoalConstraint,
  FactorCorrelation,
} from '../../types/engine-v3.js';
import {
  DEFAULT_STD_FLOOR,
  BINARY_DEFAULT_STD,
  VALUE_BASED_STD_FRACTION,
  FALLBACK_STD,
  resolveUserSuppliedStd,
} from './parameter-uncertainty-bounds.js';
import { sha8 } from '../../util/pii-redact.js';
// ROADMAP 2.258. DERIVED from the shared contract, never hand-mirrored.
//
// `GoalThresholdFrame` is the Zod enum itself, so `parseGoalThresholdFrame`
// below validates against the CONTRACT's member list rather than a local copy
// of it, and `GoalThresholdFrameType` follows the contract automatically. If
// 0.32.0 ever adds a third frame, this file widens with it instead of silently
// rejecting the new token — the hand-maintained-mirror defect class (the
// dominant one in this estate) cannot arise here by construction.
import { GoalThresholdFrame, type GoalThresholdFrameType } from '@talchain/schemas';

/**
 * The frame a `goal_threshold` is stated in, as the shared contract defines it.
 * Re-exported so callers in this repo import one name, not two.
 */
export type { GoalThresholdFrameType };

/**
 * Validate an untrusted producer-stamped frame against the CONTRACT's enum.
 *
 * Returns the frame when it is a member, `undefined` otherwise — and
 * `undefined` is a legitimate, meaningful answer here (see
 * `ISLRobustnessRequestV3.goal_threshold_frame`): a junk value must degrade to
 * ABSENT, never to a guess. Forwarding an unrecognised token would make ISL
 * reject the whole request at Pydantic validation, turning a producer typo into
 * a failed analysis instead of a disclosed missing frame.
 */
export function parseGoalThresholdFrame(value: unknown): GoalThresholdFrameType | undefined {
  const parsed = GoalThresholdFrame.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

// -----------------------------------------------------------------------------
// ISL Wire Format Types
// -----------------------------------------------------------------------------

/**
 * ISL node format.
 */
export interface ISLNodeV3 {
  id: string;
  kind?: string;
  label?: string;
  observed_state?: {
    value?: number;
    baseline?: number;
    unit?: string;
    std?: number;
    /** V3 expansion fields (passed through for downstream consumers) */
    raw_value?: number;
    cap?: number;
    factor_type?: string;
    uncertainty_drivers?: string[];
    /**
     * CEE-origin fields PLoT's normaliser does not currently produce, but which
     * ISL's `ObservedState` declares and the projection allowlist forwards.
     *
     * ⚠ ROADMAP 2.274 — these were MISSING from this type while present on
     * `ISL_DECLARED_OBSERVED_STATE_FIELDS`, and the `as` cast in
     * toISLObservedState erased the discrepancy: had a PLoT observed_state ever
     * carried them they would have gone on the wire untyped and unnoticed. The
     * two are now pinned to each other at COMPILE time (see the list below), so
     * this class of divergence cannot recur silently.
     */
    source?: string;
    extractionType?: string;
  };
  intercept?: number;
  epsilon_std?: number;
}

/**
 * ISL edge format.
 */
export interface ISLEdgeV3 {
  from: string;
  to: string;
  exists_probability: number;
  strength: {
    mean: number;
    std: number;
  };
}

/**
 * ISL option format - interventions are flattened to Record<string, number>.
 */
export interface ISLOptionV3 {
  id: string;
  label?: string;
  interventions: Record<string, number>;
}

/**
 * ISL constraint format.
 * ISL's canonical field is "value" (the legacy "threshold" alias is coerced server-side
 * by _coerce_legacy_threshold). PLoT and ISL now use the same field name.
 */
export interface ISLGoalConstraint {
  constraint_id: string;
  node_id: string;
  operator: '>=' | '<=';
  /** Constraint value — ISL's canonical field (F-20: was legacy "threshold") */
  value: number;
  label?: string;
  weight?: number;
  /**
   * ROADMAP 2.855 — the frame `value` is stated in. Mirrors ISL's
   * `GoalConstraint.value_frame` (`src/models/robustness_v2.py`), which is
   * `Optional[Literal["level","delta"]]` and fail-closed: absent ⇒
   * `CONSTRAINT_FRAME_UNSPECIFIED` and `constraint_analysis` omitted entirely.
   *
   * ⚠ ISL's model is `extra: "ignore"`, so a misspelt key here would die at
   * parse with a clean 200 and no error anywhere — which is why this field's
   * arrival is proven through the ENDPOINT, not by a green build.
   */
  value_frame?: GoalThresholdFrameType;
}

/**
 * One user-stated range for a factor's value — the RAW statement, as said.
 *
 * Mirrors ISL's `UserStatedRange` (isl/src/models/range_fit.py:55-110,
 * ROADMAP 2.720) EXACTLY. Kept pinned to it by
 * `ISL_DECLARED_USER_STATED_RANGE_FIELDS` below plus the `satisfies` /
 * exhaustiveness pair, and by `tests/isl-user-stated-ranges.contract.test.ts`
 * T2c, which derives the expected member set from ISL's pinned OpenAPI rather
 * than from a second hand-copy.
 *
 * ⚠ `lower` / `upper` ARE OPTIONAL ON PURPOSE, and PLoT must not "helpfully"
 * fill one in. ISL declares them Optional so an OPEN-ENDED statement ("at least
 * X", "no more than Y") is EXPRESSIBLE and can be refused LOUDLY as
 * `RANGE_OPEN_ENDED`, rather than silently reshaped into a range the user never
 * stated. A producer that defaulted a missing bound to 0 (or to the observed
 * value) would manufacture an interval and get a clean, wrong, fitted
 * distribution back — a fabricated value wearing real provenance, which is this
 * estate's dominant defect class.
 *
 * ⚠ `domain` IS REQUIRED and is never inferred. ISL selects the fitted family
 * from it (`unit_interval` → beta, `unbounded` → normal) and deliberately does
 * NOT infer from whether the numbers happen to lie in [0,1]. PLoT forwards the
 * producer's declaration; it does not guess one.
 */
export interface ISLUserStatedRange {
  /** The factor node the range was stated for. ISL pattern: `^[a-z0-9_:-]+$`. */
  node_id: string;
  /** The user's stated lower bound, raw. ABSENT = open-ended below. */
  lower?: number;
  /** The user's stated upper bound, raw. ABSENT = open-ended above. */
  upper?: number;
  /** DECLARED domain of the quantity — determines the fitted family. */
  domain: 'unit_interval' | 'unbounded';
  /** Who stated the range (provenance, e.g. 'user'). */
  source?: string;
  /** When it was stated (ISO 8601, producer-stamped). */
  stated_at?: string;
  /** ELICITATION method version stamped by the producer — NOT the fit method. */
  method_version?: string;
}

/**
 * ISL robustness request format.
 */
export interface ISLRobustnessRequestV3 {
  request_id: string;
  graph: {
    nodes: ISLNodeV3[];
    edges: ISLEdgeV3[];
  };
  options: ISLOptionV3[];
  goal_node_id: string;
  n_samples?: number;
  confidence_level?: number;
  analysis_types: Array<'comparison' | 'sensitivity' | 'robustness'>;
  /**
   * Members mirror ISL's `ParameterUncertainty`
   * (isl/src/models/robustness_v2.py:243-291 @ 47f20068) EXACTLY: {node_id,
   * distribution, std, range_min, range_max}. ISL has never declared a `mean`
   * here — for a NORMAL entry the sampling centre is read from the node's
   * `observed_state.value`, not from this list — so a `mean` sent here was
   * dropped by ISL's `extra: "ignore"` and could never move a result. Removed
   * in contract step-2 slice 6; do not re-add a member ISL does not declare.
   *
   * The union is the point, and it is what closes the prior-only defect. ISL
   * supports THREE families and only one of them takes its centre from the
   * graph node:
   *   - `normal`   → `rng.normal(observed_state.value ?? 0.0, std)`
   *                  (robustness_analyzer_v2.py:1080-1086, 1175-1178)
   *   - `uniform`  → `rng.uniform(range_min, range_max)` — the centre lives
   *                  ENTIRELY on the wire; `observed_state` is not read at all
   *                  (robustness_analyzer_v2.py:1180-1188), and the correlated
   *                  copula path treats it the same way (1140-1149).
   *   - `point_mass` → the observed value verbatim; useless to a node that has
   *                  none, so PLoT never emits it.
   * A factor whose only quantitative statement is a `prior` therefore MUST go
   * out as `uniform`: sent as a `normal` it parses cleanly, and ISL then
   * silently centres a declared Uniform[0.6,1.0] on 0.0.
   */
  parameter_uncertainties?: Array<
    | {
        node_id: string;
        distribution: 'normal';
        std: number;
      }
    | {
        node_id: string;
        distribution: 'uniform';
        range_min: number;
        range_max: number;
      }
  >;
  /**
   * User-defined success threshold for goal.
   * When provided, ISL returns probability_of_goal per option
   * — but ONLY if `goal_threshold_frame` below is also present.
   */
  goal_threshold?: number;

  /**
   * ROADMAP 2.258. Declares which FRAME `goal_threshold` is expressed in.
   * Mirrors ISL's `RobustnessRequestV2.goal_threshold_frame`
   * (models/robustness_v2.py:882 @`29cb4e27`) and `@talchain/schemas` 0.31.0
   * `NodeV3.goal_threshold_frame` (`dist/graph.js:194`).
   *
   *   'delta' — already in the goal SAMPLES' own frame (change from the model's
   *             origin). Used as-is; byte-identical to the pre-2.258 comparison.
   *   'level' — an absolute level of the goal quantity, sharing the domain of
   *             the graph's `observed_state` values. ISL converts it into the
   *             sample frame via `threshold - goal_baseline + goal_intercept`.
   *
   * ⚠ PLoT NEVER MINTS THIS VALUE. It is forwarded if and only if the producer
   * (CEE) stamped it on the goal node. The whole point of 2.258 is that an
   * unattested frame is a category error: CEE mints `goal_threshold` as a
   * normalised LEVEL, while a non-root goal's samples are a CHANGE from origin,
   * so comparing them yielded a STRUCTURAL ZERO the product rendered as
   * "< 1% chance of hitting your goal". Guessing a frame here would reinstate
   * exactly that defect with PLoT's name on it.
   *
   * ⚠ ABSENT IS A MEANINGFUL STATE, NOT A FAILURE TO POPULATE. ISL fail-closes:
   * with no frame it OMITS `probability_of_goal` and returns a
   * `GOAL_THRESHOLD_FRAME_UNSPECIFIED` inference warning at severity 'warning'
   * (chosen deliberately because PLoT hides 'info'), naming what was missing.
   * The request itself still succeeds — this is a disclosed gap, not a rejection.
   * See `robustness_analyzer_v2.py:3108-3147`.
   *
   * STRUCTURAL COUPLING: this key is emitted ONLY inside the `goal_threshold`
   * branch below, so a frame can never travel without the number it describes.
   * That is enforced by position, not by a comment.
   */
  goal_threshold_frame?: GoalThresholdFrameType;

  /**
   * Multiple success constraints for joint evaluation.
   * When provided, ISL evaluates joint satisfaction across all constraints.
   * Uses ISL's canonical "value" field (same as PLoT's GoalConstraint.value).
   *
   * ⚠ This used to say "Takes precedence over goal_threshold if both are
   * provided". FALSE, corrected under ROADMAP 2.239 by reading ISL at
   * `35149dd1`: `probability_of_goal` (robustness_analyzer_v2.py:3073-3077)
   * and `constraint_analysis` (:3079-3083) are computed in the same option
   * loop from independent gates, neither suppressing the other, and
   * `RobustnessRequestV2` declares no mutual-exclusion validator
   * (models/robustness_v2.py:856, :895). ISL is built for the pair —
   * `_align_goal_constraint_samples` (:3005-3035) exists so a goal-node
   * constraint and `probability_of_goal` answer from IDENTICAL samples.
   *
   * The false comment mattered: it made "send both" look pointless, and
   * sending both is exactly what makes the goal probability computable when
   * the only constraint is the auto-synthesised goal target.
   */
  goal_constraints?: ISLGoalConstraint[];

  // CIL 0.1: forward seed to ISL for deterministic Monte Carlo runs
  seed?: string | number;

  /** Request edge E-value analysis from ISL (evidence strength per edge). */
  include_e_values?: boolean;
  /** Request Value of Information (EVPI) analysis from ISL. */
  include_voi?: boolean;
  /**
   * Request per-root-factor flip thresholds from ISL (V2 envelope
   * `factor_flip_values`, ISL PR #117 / ROADMAP 2.228-F3).
   *
   * ISL defaults this to `false` and emits nothing when it is absent, so the
   * capability was live-but-unreachable until PLoT began asking. Sent
   * UNCONDITIONALLY (`true`) beside `include_e_values` / `include_voi` — NOT a
   * request-gated opt-in like `include_path_decomposition`, because flip
   * thresholds are not an optional extra here: they are the ONLY source of
   * `enrichment.flip_thresholds[].flip_value` now that PLoT's own bisection
   * probe is retired on this path. Per the no-new-flag-gates rule this is a
   * constant, not an env var or a request key.
   */
  include_factor_flips?: boolean;
  /**
   * Request structural pathway decomposition from ISL (V2 envelope
   * `path_decomposition`, ISL build 9a22a1a+). REQUEST-GATED OPT-IN: only
   * forwarded when the inbound /v2/run request set it — never defaulted on,
   * so the ISL payload does not grow for callers that did not ask.
   */
  include_path_decomposition?: boolean;

  /**
   * Client-supplied pairwise factor correlations (capability #100, doctrine
   * D-23.4). Forwarded VERBATIM from the /v2/run request when present and
   * non-empty; OMITTED otherwise (request-gated — no default payload growth,
   * ISL's `extra:"ignore"` never sees an empty array). Deep semantics
   * (unknown-factor / |rho|>1 / self-pair / duplicate) are validated ISL-side.
   */
  factor_correlations?: FactorCorrelation[];

  /**
   * ⭐ ROADMAP 2.720 — the user's OWN stated ranges for factor values (pillar P4,
   * human–AI collaboration). Forwarded from the /v2/run request when present and
   * non-empty; OMITTED otherwise (request-gated — no default payload growth, and
   * ISL's `extra:"ignore"` never sees an empty array).
   *
   * WHAT ISL DOES WITH IT, STATED PRECISELY. ISL treats each range as a ≈50%
   * CREDIBLE INTERVAL and runs an interquartile fit
   * (`services/range_fit.py::resolve_range_fits`, method `range-iq-fit-v1`),
   * returning either a fitted distribution or one of seven TYPED refusals on
   * `range_fit_disclosures` + `inference_warnings`. **This is S3:
   * FIT-AND-DISCLOSE ONLY. Compute is BYTE-IDENTICAL whether or not this field
   * is present** — ISL's own comment records that the resolver is pure, RNG-free
   * and placed AFTER all sampling so byte-identity is structural, not merely
   * tested. Application (S4) waits on 2.521 Q2 + the combination ruling. PLoT
   * MUST NOT be changed to make the range WEIGH in the maths on the strength of
   * this field arriving.
   *
   * ⚠ WHY THIS IS NOT THE `prior: {distribution:'uniform', range_min, range_max}`
   * PATH, and must never be routed into it. That path carries SYSTEM-derived
   * declared-uniform SUPPORTS (CEE's drafter mints them from brief wording), and
   * `buildParameterUncertaintiesV3` forwards them to ISL AS a uniform, bounds
   * intact — the support is taken at its word, not fitted. A HUMAN-STATED range
   * is a ~50% credible interval, whose σ is 0.7413·width — 2.57× LARGER than the
   * same range read as a uniform support. Routing a human statement down the
   * prior path would silently understate the user's uncertainty. The two coexist
   * by design and are fitted in different places.
   *
   * ⚠ AND IT WAS DARK UNTIL NOW. ISL declared, implemented, tested and DEPLOYED
   * this converter, and PLoT's own pin note recorded *"user_stated_ranges (2.720,
   * PLoT does not send it)"*. A capability with no producer is not a capability.
   * The reverse hazard applies to the addition itself: ISL's request models are
   * `extra="ignore"` and `extra="forbid"` appears nowhere in the service, so a
   * misspelled key here would die with a clean 200 and no error anywhere — which
   * is why this field's arrival is proved by a LIVE capture against deployed ISL
   * carrying a misspelled-key control, not by a green typecheck
   * (`tests/fixtures/isl-range-fit-live-20260807/`).
   */
  user_stated_ranges?: ISLUserStatedRange[];
}

// -----------------------------------------------------------------------------
// Translation Functions
// -----------------------------------------------------------------------------

/**
 * The COMPLETE member list of ISL's `ObservedState`
 * (isl/src/models/robustness_v2.py:160-200 @ 7d144c7f):
 * value, baseline, unit, source, std, raw_value, cap, extractionType,
 * factor_type, uncertainty_drivers.
 *
 * PLoT produces all ten. ⚠ THIS PARAGRAPH USED TO SAY THE OPPOSITE — "PLoT
 * produces eight of the ten; `source` and `extractionType` are CEE-origin fields
 * PLoT's normaliser does not carry, so they are absent here by construction
 * rather than by exclusion" — and it was FALSE from #313 (`9b47976`, 5 Aug 2026,
 * ROADMAP 2.520 S1) onwards, which taught `normaliseNode` to copy both. It was
 * arguably never right: both members sat in the list five lines below it the
 * whole time, so the comment contradicted the code it introduced. Left in place
 * as trap 14's exhibit — an accurate note is not self-maintaining, and the most
 * convincing stale sentence is one attached to correct machinery.
 *
 * ⚠ ROADMAP 2.274 — THIS WAS A HAND-MAINTAINED MIRROR OF ANOTHER REPO'S MODEL
 * WITH NO LOUD FAILURE (trap 12), and the comment that used to sit here said so
 * and left it at that: "until [the drift pairing] lands, this comment IS the
 * disclosure". A comment is not an alarm. Its drift is asymmetric and BOTH
 * directions are silent: if ISL ADDS a field PLoT quietly stops forwarding
 * something ISL would accept; if ISL REMOVES one PLoT resumes sending an
 * undeclared key.
 *
 * It is now pinned MECHANICALLY on both edges, so neither can move unnoticed:
 *
 *  - **list ↔ ISL's model**, at TEST time: `tests/isl-observed-state-mirror
 *    .test.ts` DERIVES the expected members from `ObservedState` in the pinned,
 *    sha256-verified ISL OpenAPI document (`tests/fixtures/isl-pinned/`), which
 *    is Pydantic's own machine-generated description of the mounted models — not
 *    a second hand-copy. Re-pin ISL and this list must follow, or CI REDs.
 *  - **list ↔ PLoT's own type**, at COMPILE time: the `satisfies` clause below
 *    plus the exhaustiveness pin under it. Together they forbid a member on one
 *    side and not the other, in either direction. This is enforced by
 *    `npm run build`, which is a required PR check.
 *
 * ⚠ `baseline` IS LOAD-BEARING ON THIS LIST. It is what ISL needs to convert a
 * `'level'` goal threshold (`threshold − goal_baseline + goal_intercept`), so a
 * silent strip here does not degrade a number — it kills the goal-probability
 * capability outright, with ISL refusing every `'level'` threshold as
 * `missing_goal_baseline`. Guarded by a named assertion in the test above and by
 * `tests/goal-threshold-frame.test.ts` T10.
 */
type DeclaredObservedStateKey = keyof NonNullable<ISLNodeV3['observed_state']>;

export const ISL_DECLARED_OBSERVED_STATE_FIELDS = [
  'value',
  'baseline',
  'unit',
  'source',
  'std',
  'raw_value',
  'cap',
  'extractionType',
  'factor_type',
  'uncertainty_drivers',
] as const satisfies readonly DeclaredObservedStateKey[];

/**
 * COMPILE-TIME EXHAUSTIVENESS PIN — the direction `satisfies` cannot see.
 *
 * `satisfies` proves every listed field EXISTS on the type. This proves the
 * converse: that the type declares nothing the list omits. Without it, adding a
 * member to `ISLNodeV3['observed_state']` and forgetting the list would compile
 * happily and the field would be silently dropped on the wire for every request
 * — the exact failure this pin exists to prevent, in the quieter direction.
 * Resolves to `never` (and so fails to compile) the moment the two diverge.
 */
type _ObservedStateFieldsAreExhaustive = Exclude<
  DeclaredObservedStateKey,
  (typeof ISL_DECLARED_OBSERVED_STATE_FIELDS)[number]
> extends never
  ? true
  : never;
const _observedStateFieldsAreExhaustive: _ObservedStateFieldsAreExhaustive = true;
void _observedStateFieldsAreExhaustive;

/**
 * ⭐ ROADMAP 2.520 S1 — COMPILE-TIME UNION PIN: PLoT's CANONICAL graph must be
 * able to CARRY everything this projector promises to FORWARD.
 *
 * The two pins above make the egress list agree with the egress TYPE, and the
 * mirror test makes it agree with ISL. All three can be perfectly consistent
 * while the field never arrives — because `toISLObservedState` can only forward
 * what the normalised graph actually holds, and that is `EngineNodeV3`, one hop
 * upstream and previously unpinned to any of this.
 *
 * That gap is not hypothetical: it is the 2.520 defect. `source` and
 * `extractionType` sat on this list, and on ISL's model, and were echoed back by
 * ISL — while `EngineNodeV3['observed_state']` could not represent them, so
 * PLoT's ingress dropped every one and the projector forwarded a field that was
 * never there. Every guard on this path was green throughout.
 *
 * This is the union assertion the estate's trap-12 doctrine prescribes for
 * exactly this shape: the canonical type must be a SUPERSET of every sibling
 * lookup. It resolves to `never` — and so fails `npm run build`, a required
 * check — the moment a field is added to the ISL list without the canonical
 * graph being able to hold it.
 *
 * ⚠ Deliberately ONE-directional. The canonical type may legitimately carry
 * more than ISL declares (e.g. the PLoT-internal `metadata` the projection
 * strips on purpose), so the converse must NOT be asserted here.
 */
type _CanonicalGraphCanCarryEveryDeclaredField = Exclude<
  (typeof ISL_DECLARED_OBSERVED_STATE_FIELDS)[number],
  keyof NonNullable<EngineNodeV3['observed_state']>
> extends never
  ? true
  : never;
const _canonicalGraphCanCarryEveryDeclaredField: _CanonicalGraphCanCarryEveryDeclaredField = true;
void _canonicalGraphCanCarryEveryDeclaredField;

/**
 * Project a PLoT-internal `observed_state` onto the fields ISL declares.
 *
 * Slice 6: the previous code forwarded `node.observed_state` VERBATIM, so any
 * key present at runtime transited to ISL regardless of the declared type.
 * One always did: PLoT's own normaliser attaches `metadata` to constraint
 * nodes (`graph-normaliser.ts:274-276`) so `constraint-compiler.ts` can read
 * `.operator` — a PLoT-internal key ISL's `ObservedState` does not declare and
 * silently dropped under `extra: "ignore"`. The compiler reads it off the
 * normalised PLoT graph, never off the ISL request, so projecting here costs
 * nothing internally.
 *
 * The projection is by PRESENCE, not by declared type: an absent field stays
 * absent on the wire rather than becoming an explicit `undefined`, so the
 * serialized bytes are unchanged for every field PLoT already sent.
 *
 * Shared with the `/v1/run` producer (`integrations/isl/index.ts`) so the two
 * ISL request builders cannot drift apart into two different allowlists.
 */
export function toISLObservedState(observedState: unknown): ISLNodeV3['observed_state'] {
  if (observedState === undefined || observedState === null || typeof observedState !== 'object') {
    return undefined;
  }
  const os = observedState as Record<string, unknown>;
  const projected: Record<string, unknown> = {};
  for (const field of ISL_DECLARED_OBSERVED_STATE_FIELDS) {
    if (os[field] !== undefined) projected[field] = os[field];
  }
  return projected as ISLNodeV3['observed_state'];
}

/**
 * The COMPLETE member list of ISL's `UserStatedRange`
 * (isl/src/models/range_fit.py:55-110 @ 686fcb7f).
 *
 * Pinned MECHANICALLY on both edges, exactly as
 * `ISL_DECLARED_OBSERVED_STATE_FIELDS` is — because this list is otherwise the
 * same hand-maintained mirror of another repo's model (trap 12), and its drift
 * is silent in BOTH directions under ISL's `extra:"ignore"`:
 *
 *  - **list ↔ ISL's model**, at TEST time:
 *    `tests/isl-user-stated-ranges.contract.test.ts` T2c derives the expected
 *    member set from `UserStatedRange` in the pinned, sha256-verified ISL
 *    OpenAPI (Pydantic's own machine-generated description of the mounted
 *    models), and T2d asserts each member resolves as DECLARED under
 *    `RobustnessRequestV2`. Re-pin ISL and this list must follow, or CI REDs.
 *  - **list ↔ PLoT's own type**, at COMPILE time: the `satisfies` clause plus
 *    the exhaustiveness pin below, enforced by `npm run build` (a required
 *    check).
 *
 * ⚠ The list is used as a PROJECTION, so a caller-supplied key ISL does not
 * declare cannot transit. That matters more here than on most fields: this one
 * is populated from a CLIENT-SUPPLIED /v2/run array, and an undeclared key would
 * be dropped at ISL's parse with a clean 200 and no warning anywhere.
 */
type DeclaredUserStatedRangeKey = keyof ISLUserStatedRange;

export const ISL_DECLARED_USER_STATED_RANGE_FIELDS = [
  'node_id',
  'lower',
  'upper',
  'domain',
  'source',
  'stated_at',
  'method_version',
] as const satisfies readonly DeclaredUserStatedRangeKey[];

/**
 * COMPILE-TIME EXHAUSTIVENESS PIN — the direction `satisfies` cannot see.
 * Resolves to `never` (and so fails to compile) the moment `ISLUserStatedRange`
 * declares a member this list omits, which would otherwise silently strip that
 * member from every request.
 */
type _UserStatedRangeFieldsAreExhaustive = Exclude<
  DeclaredUserStatedRangeKey,
  (typeof ISL_DECLARED_USER_STATED_RANGE_FIELDS)[number]
> extends never
  ? true
  : never;
const _userStatedRangeFieldsAreExhaustive: _UserStatedRangeFieldsAreExhaustive = true;
void _userStatedRangeFieldsAreExhaustive;

/**
 * Project one caller-supplied stated range onto the fields ISL declares.
 *
 * By PRESENCE, not by declared type — an absent bound stays ABSENT on the wire
 * rather than becoming an explicit `undefined`/`null`, because absence is
 * MEANINGFUL here: it is what makes ISL refuse `RANGE_OPEN_ENDED` instead of
 * fitting an interval the user never stated.
 */
export function toISLUserStatedRange(range: unknown): ISLUserStatedRange | undefined {
  if (range === undefined || range === null || typeof range !== 'object') return undefined;
  const src = range as Record<string, unknown>;
  const projected: Record<string, unknown> = {};
  for (const field of ISL_DECLARED_USER_STATED_RANGE_FIELDS) {
    if (src[field] !== undefined) projected[field] = src[field];
  }
  return projected as unknown as ISLUserStatedRange;
}

/**
 * Translate internal node to ISL format.
 *
 * NOTE: `category` field is intentionally excluded from ISL translation.
 * It is PLoT-internal metadata used for M1 coaching classification and
 * prior validation (external factors only). ISL does not consume it —
 * its node schema has no category field. See Platform Contract §3.3.1.
 */
export function toISLNode(node: EngineNodeV3): ISLNodeV3 {
  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    observed_state: toISLObservedState(node.observed_state),
    intercept: node.intercept ?? 0.0,
    epsilon_std: node.epsilon_std ?? 0.0,
  };
}

/**
 * Translate internal edge to ISL format.
 *
 * Preserves structural uncertainty via exists_probability field.
 * The edge.exists_probability has already been normalized from legacy
 * fields (belief, belief_exists) by the graph normalizer.
 */
export function toISLEdge(edge: EngineEdgeV3): ISLEdgeV3 {
  return {
    from: edge.from,
    to: edge.to,
    // Use actual exists_probability (defaults to 0.8 if not set during normalization)
    exists_probability: edge.exists_probability,
    strength: {
      mean: edge.strength.mean,
      std: edge.strength.std,
    },
  };
}

/**
 * Flatten interventions from InterventionValueV3 to simple number values.
 *
 * ISL wire format uses Record<string, number> for interventions.
 * The source metadata is stripped for the wire format.
 *
 * @param interventions Internal intervention format
 * @returns Flattened interventions for ISL
 * @throws Error if any intervention value is invalid
 */
export function toISLInterventions(
  interventions: Record<string, InterventionValueV3>
): Record<string, number> {
  const result: Record<string, number> = {};

  for (const [nodeId, intervention] of Object.entries(interventions)) {
    if (typeof intervention.value !== 'number' || !Number.isFinite(intervention.value)) {
      throw new Error(`Invalid intervention value for node '${nodeId}'`);
    }
    result[nodeId] = intervention.value;
  }

  return result;
}

/**
 * Translate internal option to ISL format.
 */
export function toISLOption(option: OptionV3): ISLOptionV3 {
  return {
    id: option.id,
    label: option.label,
    interventions: toISLInterventions(option.interventions),
  };
}

/**
 * Build parameter uncertainties from factor nodes with observed_state.
 *
 * For each factor node with an observed value, create a parameter uncertainty
 * specification for ISL. This enables ISL to compute factor_sensitivity scores.
 *
 * Standard deviation calculation priority:
 * 1. Finite positive `observed_state.std` → clamped to [MIN_USER_STD, MAX_USER_STD].
 *    The user value is honoured down to MIN_USER_STD; the default floor below
 *    does NOT apply.
 * 2. Binary factors (0/1 range or labelled yes/no) → BINARY_DEFAULT_STD.
 * 3. Non-zero continuous factors → |value| × VALUE_BASED_STD_FRACTION.
 * 4. Zero-valued continuous factors → FALLBACK_STD.
 *
 * The DEFAULT_STD_FLOOR is applied ONLY to priorities 2–4 (synthesised defaults),
 * never to user-supplied values. This is the fix for the silent-widening bug
 * where `observed_state.std = 0.001` was being floored to 0.1.
 *
 * Non-finite, zero, and negative `observed_state.std` are treated as missing
 * and fall through to default synthesis.
 *
 * SECOND PASS — external factors whose only quantitative statement is a `prior`.
 * These have no `observed_state`, so they emit `{distribution:'uniform',
 * range_min, range_max}`: the one ISL family whose centre travels on the wire
 * rather than being read from the graph node. A degenerate range (min == max)
 * is DECLINED rather than approximated, so ISL discloses the defaulted root
 * instead of sampling a centre nobody stated. See the long note at the push
 * site — this is the prior-only sampling-centre P0, and reverting it to a
 * normal reinstates a silently-wrong analysis.
 *
 * @param nodes Graph nodes
 * @returns Parameter uncertainties for ISL
 */
export function buildParameterUncertaintiesV3(
  nodes: EngineNodeV3[]
): ISLRobustnessRequestV3['parameter_uncertainties'] {
  const uncertainties: NonNullable<ISLRobustnessRequestV3['parameter_uncertainties']> = [];

  for (const node of nodes) {
    if (node.kind === 'factor' && node.observed_state?.value !== undefined && Number.isFinite(node.observed_state.value)) {
      const value = node.observed_state.value;
      const userStd = resolveUserSuppliedStd(node.observed_state.std);

      let std: number;

      if (userStd !== null) {
        // Priority 1: honour user-supplied std (already clamped to
        // [MIN_USER_STD, MAX_USER_STD]). DEFAULT_STD_FLOOR intentionally does
        // not apply — small user values must reach ISL as-is.
        std = userStd;
      } else {
        // Priorities 2–4: synthesised defaults, with DEFAULT_STD_FLOOR applied.
        const isBinary = isBinaryFactor(node);
        if (isBinary) {
          std = BINARY_DEFAULT_STD;
        } else if (value !== 0) {
          std = Math.abs(value) * VALUE_BASED_STD_FRACTION;
        } else {
          std = FALLBACK_STD;
        }
        std = Math.max(DEFAULT_STD_FLOOR, std);
      }

      // Slice 6: no `mean` — ISL samples Normal(observed_state.value, std) and
      // reads the centre from the graph node, not from this entry.
      uncertainties.push({
        node_id: node.id,
        distribution: 'normal',
        std,
      });
    }
  }

  // Second pass: external factors with prior distribution
  for (const node of nodes) {
    // Skip if already processed via observed_state (observed_state takes precedence)
    if (node.kind === 'factor' && node.observed_state?.value !== undefined) continue;

    if (node.kind === 'factor' && node.category === 'external' && node.prior) {
      // Only "uniform" distribution supported for now
      if (node.prior.distribution !== 'uniform') {
        // Wave1-L1 (PII): node id + user-supplied distribution text digested —
        // an unsupported distribution is arbitrary user input.
        console.warn(
          `[PARAMETER_UNCERTAINTY] node_id=${sha8(String(node.id))} unsupported prior distribution (distribution_sha8=${sha8(String(node.prior.distribution))}), skipping`
        );
        continue;
      }

      let rangeMin = node.prior.range_min;
      let rangeMax = node.prior.range_max;

      // Validate range_min and range_max are finite numbers
      if (typeof rangeMin !== 'number' || !Number.isFinite(rangeMin) ||
          typeof rangeMax !== 'number' || !Number.isFinite(rangeMax)) {
        // Wave1-L1 (PII): node id digested.
        console.warn(
          `[PARAMETER_UNCERTAINTY] node_id=${sha8(String(node.id))} prior has non-finite range values, skipping`
        );
        continue;
      }

      // Swap if range_min > range_max
      if (rangeMin > rangeMax) {
        // Wave1-L1 (PII): raw range values are decision inputs — digested.
        console.warn(
          `[PARAMETER_UNCERTAINTY] node_id=${sha8(String(node.id))} prior range_min (${sha8(rangeMin)}) > range_max (${sha8(rangeMax)}), swapping`
        );
        [rangeMin, rangeMax] = [rangeMax, rangeMin];
      }

      // ⚠ A DEGENERATE RANGE CANNOT BE EXPRESSED, SO IT IS DECLINED — LOUDLY.
      // `range_min == range_max` is a point mass, and ISL has no way to carry
      // one for a node with no `observed_state`: its `point_mass` branch
      // returns the observed value (robustness_analyzer_v2.py:1171-1173),
      // which for a prior-only factor is the 0.0 default. Emitting anything
      // here would put a fabricated centre on the wire, so PLoT emits NOTHING
      // and the factor falls to ISL's root-default detector, which fires
      // ROOT_NODE_DEFAULT_VALUE precisely because no ParameterUncertainty
      // entry is present (robustness_analyzer_v2.py:1826-1834). The user sees
      // "no observed value provided … results may be unreliable" instead of a
      // confident number drawn from nowhere. ISL's own validator would also
      // 422 a `range_min >= range_max` uniform (robustness_v2.py:277-283), so
      // sending one would take the whole analysis down rather than one factor.
      if (!(rangeMin < rangeMax)) {
        // Wave1-L1 (PII): raw range values are decision inputs — digested.
        console.warn(
          `[PARAMETER_UNCERTAINTY] node_id=${sha8(String(node.id))} prior range is degenerate (range_min == range_max, value_sha8=${sha8(rangeMin)}); no uncertainty emitted — ISL will disclose the defaulted root instead of sampling a fabricated centre`
        );
        continue;
      }

      // Send ISL the uniform it actually supports, bounds and all.
      //
      // ⚠ THIS REPLACED A σ = width/√12 NORMAL, AND THE REASON MATTERS. The
      // old conversion was a correct moment-match for the WIDTH and had no
      // channel for the CENTRE, because ISL's ParameterUncertainty declares no
      // `mean`. What that missed is that ISL never needed one: its `uniform`
      // branch reads the bounds straight off this entry and does not consult
      // `observed_state` at all (robustness_analyzer_v2.py:1180-1188; the
      // correlated copula path likewise, 1140-1149). A prior-only external
      // factor has no `observed_state`, so the normal entry was centred on the
      // 0.0 default: measured through ISL's own FactorSampler at 47f20068, a
      // stated Uniform[0.6,1.0] sampled at mean -0.000434 with all 20,000
      // draws OUTSIDE the declared support. Worse, it was uncaveated — the
      // root-default detector is satisfied by the mere PRESENCE of an entry
      // (robustness_analyzer_v2.py:1826-1834), so nothing warned. The pairing
      // that measures this is tests/isl-factor-sampler-centre.contract.test.ts;
      // do not revert this to a normal without re-running it.
      //
      // Preserved from the old conversion, because it is still true:
      //
      // ⚠ SCOPE BOUNDARY (ROADMAP 2.721, derived at the bytes 8 Aug 2026):
      // the ranges on this path are SYSTEM-derived declared-uniform SUPPORTS,
      // not user-stated ranges. CEE's drafter mints
      // `prior: {distribution:'uniform', range_min, range_max}` on a 0–1
      // qualitative index from brief WORDING ("low"→[0,0.4] … — the
      // "External prior anchoring" table, defaults-v187/v19), and no
      // user-elicited range can reach this field: CEE's `prior_range_edit`
      // system event is `fact_and_commit` — a judgement receipt that never
      // writes the graph — and the calibration path (2.627) refuses to mint
      // prior bounds from user statements. A declared uniform support is
      // exactly what a uniform entry means, so this is now a passthrough of
      // the producer's own statement rather than a lossy fit of it.
      //
      // A USER-STATED range is a ~50% credible interval (Neil's 2.521 Q1
      // ruling): its σ is 0.7413·width — 2.57× LARGER than the uniform
      // moment-match — fitted ISL-side per
      // `parallel-briefs/RANGE-TO-DISTRIBUTION-SPEC-2026-08-08.md` (§4.4
      // states this coexistence rule explicitly). A human-stated range must
      // NEVER route through this path; it would silently understate the
      // user's uncertainty and normalise their slips (the swap above is a
      // producer-noise repair for LLM-minted priors, not a licence to reorder
      // what a human said).
      uncertainties.push({
        node_id: node.id,
        distribution: 'uniform',
        range_min: rangeMin,
        range_max: rangeMax,
      });
    }
  }

  return uncertainties.length > 0 ? uncertainties : undefined;
}

/**
 * Detect if a factor node is binary using strong signals.
 * Avoids misclassifying continuous factors (e.g., "Number of Developers Hired" = 0) as binary.
 *
 * Binary detection signals (in order):
 * 1. Explicit range [0,1]
 * 2. Label contains explicit binary markers: "(0/1)", "yes/no", "true/false"
 * 3. Unit suggests boolean: "boolean", "bool", "binary"
 * 4. Common boolean naming patterns + value is exactly 0 or 1
 */
function isBinaryFactor(node: EngineNodeV3): boolean {
  const range = node.state_space?.range;
  const value = node.observed_state?.value;

  // Signal 1: Explicit range [0,1]
  if (range && range.min === 0 && range.max === 1) {
    return true;
  }

  const label = (node.label ?? '').toLowerCase();

  // Signal 2: Label contains explicit binary markers
  if (label.includes('(0/1)') || label.includes('yes/no') || label.includes('true/false')) {
    return true;
  }

  // Signal 3: Unit suggests boolean
  const unit = (node.observed_state?.unit ?? '').toLowerCase();
  if (unit === 'boolean' || unit === 'bool' || unit === 'binary') {
    return true;
  }

  // Signal 4: Common boolean naming patterns + value is exactly 0 or 1
  // Only applies when no range is specified and value suggests binary
  if ((value === 0 || value === 1) && !range) {
    const id = node.id.toLowerCase();
    const booleanPrefixes = ['is_', 'has_', 'can_', 'should_', 'will_', 'was_', 'did_'];
    const booleanSuffixes = ['_flag', '_enabled', '_active', '_hired', '_present', '_available'];

    if (booleanPrefixes.some((p) => id.startsWith(p))) return true;
    if (booleanSuffixes.some((s) => id.endsWith(s))) return true;
  }

  return false;
}

/**
 * Translate full request to ISL robustness request format.
 *
 * @param graph Internal graph format
 * @param options Internal options format
 * @param goalNodeId Goal node ID
 * @param requestId Request ID for correlation
 * @param nSamples Number of samples (optional)
 * @param goalThreshold Goal threshold for probability_of_goal computation (optional)
 * @param goalConstraints Goal constraints for multi-constraint analysis (optional)
 * @param seed Seed forwarded to ISL for deterministic Monte Carlo runs (optional)
 * @param includePathDecomposition Forward include_path_decomposition to ISL
 *   (optional, request-gated opt-in — only sent when the caller explicitly
 *   asked; the key is OMITTED otherwise so the ISL payload never grows by
 *   default)
 * @returns ISL robustness request
 */
export function toISLRobustnessRequest(
  graph: EngineGraphV3,
  options: OptionV3[],
  goalNodeId: string,
  requestId: string,
  nSamples?: number,
  goalThreshold?: number,
  goalConstraints?: GoalConstraint[],
  // CIL 0.1: forward seed to ISL for deterministic Monte Carlo runs
  seed?: string | number,
  includePathDecomposition?: boolean,
  // Optional: the factor PU list already built from `graph.nodes` by the caller
  // (the /v2/run admission planner computes it to price EVPI). Threading it in
  // avoids a second identical `buildParameterUncertaintiesV3` pass over the same
  // nodes; byte-identical to recomputing here. Omitted callers recompute.
  prebuiltParameterUncertainties?: ISLRobustnessRequestV3['parameter_uncertainties'],
  // Capability #100 (doctrine D-23.4): client-supplied pairwise factor
  // correlations, forwarded VERBATIM. Request-gated — the key is included only
  // when a non-empty array is supplied, so the ISL payload never grows by
  // default and ISL's `extra:"ignore"` never sees an empty array.
  factorCorrelations?: FactorCorrelation[],
  // ROADMAP 2.258: the producer-stamped frame for `goalThreshold`. Appended
  // rather than placed beside `goalThreshold` because 66 call sites pass these
  // positionally and reshuffling them is a mis-wire waiting to happen. The
  // COUPLING that matters is not positional adjacency — it is that the key is
  // emitted only inside the `goalThreshold !== undefined` branch below, so a
  // frame can never reach the wire without its number.
  goalThresholdFrame?: GoalThresholdFrameType,
  // ROADMAP 2.720: the user's own stated ranges, forwarded from the /v2/run
  // request. Appended for the same reason as `goalThresholdFrame` above — the
  // call sites pass these positionally and reshuffling them is a mis-wire
  // waiting to happen.
  userStatedRanges?: ISLUserStatedRange[]
): ISLRobustnessRequestV3 {
  // Bidirected edges are trust-layer only (identifiability + warnings).
  // ISL operates on directed edges only. Phase 3A-inference will add inference semantics.
  const directedEdges = graph.edges.filter((e) => e.edge_type !== 'bidirected');

  const request: ISLRobustnessRequestV3 = {
    request_id: requestId,
    graph: {
      nodes: graph.nodes.map(toISLNode),
      edges: directedEdges.map(toISLEdge),
    },
    options: options.map(toISLOption),
    goal_node_id: goalNodeId,
    n_samples: nSamples,
    analysis_types: ['comparison', 'sensitivity', 'robustness'],
    parameter_uncertainties: prebuiltParameterUncertainties ?? buildParameterUncertaintiesV3(graph.nodes),
    include_e_values: true,
    include_voi: true,
    // ROADMAP 2.228-F3: ask ISL for closed-form per-factor flip thresholds.
    // Unconditional, like its two siblings above — ISL's default is False, so
    // omitting this key is what kept `factor_flip_values` off every live
    // response and `flip_thresholds[].flip_value` null on every run.
    include_factor_flips: true,
  };

  // Only include goal_threshold if provided (omit entirely when absent)
  if (goalThreshold !== undefined) {
    request.goal_threshold = goalThreshold;

    // ROADMAP 2.258. The frame rides INSIDE this branch on purpose: a frame
    // without a threshold describes nothing, and ISL would reject the pair as
    // incoherent. Nesting makes that impossible structurally rather than by
    // convention — delete the nesting and `goal-threshold-frame.test.ts`
    // ("a frame never travels without its threshold") reds.
    //
    // Still request-gated within the branch: an unstamped threshold omits the
    // key entirely, which is the state ISL fail-closes on with a NAMED reason
    // (GOAL_THRESHOLD_FRAME_UNSPECIFIED). PLoT does NOT substitute a default —
    // 'delta' would silently restore the pre-2.258 structural zero and 'level'
    // would assert a domain PLoT has not verified.
    if (goalThresholdFrame !== undefined) {
      request.goal_threshold_frame = goalThresholdFrame;
    }
  }

  // Only include goal_constraints if provided and non-empty (omit entirely when absent).
  // F-20: Send canonical "value" field (was legacy "threshold").
  if (goalConstraints && goalConstraints.length > 0) {
    request.goal_constraints = goalConstraints.map((c) => ({
      constraint_id: c.constraint_id,
      node_id: c.node_id,
      operator: c.operator,
      value: c.value,
      ...(c.label !== undefined && { label: c.label }),
      ...(c.weight !== undefined && { weight: c.weight }),
      // ROADMAP 2.855 — by presence. Structurally coupled to its own number by
      // construction: the frame rides ON the constraint object, so it cannot
      // reach the wire without the `value` it describes (the coupling the node
      // channel has to arrange positionally for `goal_threshold_frame`).
      ...(c.value_frame !== undefined && { value_frame: c.value_frame }),
    }));
  }

  // CIL 0.1: forward seed to ISL for deterministic Monte Carlo runs
  if (seed !== undefined) {
    request.seed = seed;
  }

  // Path decomposition is a request-gated opt-in (lane PLoT-W4): forward the
  // flag ONLY when the inbound request explicitly asked for it. The key is
  // omitted (not sent as false) otherwise — no default payload growth on
  // either the ISL request or the ISL response.
  if (includePathDecomposition === true) {
    request.include_path_decomposition = true;
  }

  // Capability #100 (doctrine D-23.4): forward client-supplied factor
  // correlations VERBATIM, request-gated. Included ONLY when a non-empty array
  // is supplied — omitted otherwise so the ISL payload is byte-identical for
  // callers who did not ask, and ISL's `extra:"ignore"` never receives an
  // empty array. Deep semantics (unknown-factor / |rho|>1 / self-pair /
  // duplicate) are ISL's single source of truth and surface as a 422.
  if (factorCorrelations && factorCorrelations.length > 0) {
    request.factor_correlations = factorCorrelations;
  }

  // ROADMAP 2.720: forward the user's stated ranges, PROJECTED onto ISL's
  // declared members. Request-gated — included only when at least one range
  // survives the projection, so the ISL payload is byte-identical for callers
  // who did not state any, and ISL's `extra:"ignore"` never receives an empty
  // array. Deep semantics (zero width, inverted order, out of domain,
  // open-ended, non-convergent) are ISL's single source of truth and come back
  // as TYPED refusals on `range_fit_disclosures` — PLoT does not re-implement
  // them, and must not "repair" a range into something the user did not say.
  if (userStatedRanges && userStatedRanges.length > 0) {
    const projected = userStatedRanges
      .map(toISLUserStatedRange)
      .filter((r): r is ISLUserStatedRange => r !== undefined);
    if (projected.length > 0) {
      request.user_stated_ranges = projected;
    }
  }

  return request;
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

/**
 * Validate ISL request before sending.
 *
 * Catches issues that would cause ISL to reject the request.
 *
 * @param request ISL request to validate
 * @returns Array of error messages (empty if valid)
 */
export function validateISLRequest(request: ISLRobustnessRequestV3): string[] {
  const errors: string[] = [];

  // Check graph
  if (!request.graph.nodes || request.graph.nodes.length === 0) {
    errors.push('Graph has no nodes');
  }

  // Check options
  if (!request.options || request.options.length === 0) {
    errors.push('No options provided');
  }

  for (const option of request.options ?? []) {
    if (!option.interventions || Object.keys(option.interventions).length === 0) {
      errors.push(`Option '${option.id}' has no interventions`);
    }
  }

  // Check goal node exists
  const nodeIds = new Set(request.graph.nodes?.map((n) => n.id) ?? []);
  if (!nodeIds.has(request.goal_node_id)) {
    errors.push(`Goal node '${request.goal_node_id}' not in graph`);
  }

  // Check intervention targets exist
  for (const option of request.options ?? []) {
    for (const targetId of Object.keys(option.interventions ?? {})) {
      if (!nodeIds.has(targetId)) {
        errors.push(`Option '${option.id}' intervention target '${targetId}' not in graph`);
      }
    }
  }

  return errors;
}
