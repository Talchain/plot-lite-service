/**
 * `driver_order` — PLoT's ONE canonical driver ordering, and the attestation
 * that makes it interpretable.
 *
 * Family 4 (driver rankings), slice S1. Ratified in
 * `MEANING-LAYER-FAMILY4-AUTHORITY-AMENDMENT-2026-07-27.md` §4.3, under the
 * four-role authority model of §2.1:
 *
 * > **ISL measures · PLoT orders + attests · CEE permits + projects · UI
 * > renders WITHOUT reordering.**
 *
 * PLoT owns *exactly one* ordering over the factor set, its rank integers, its
 * lever-awareness, and an attestation describing HOW the order was made. This
 * module is that ordering's single point of statement.
 *
 * ## ⚠ WHAT THIS SLICE DOES AND DOES NOT DO
 *
 * S1 was **ADDITIVE ONLY** — `driver_order` was emitted alongside five surfaces
 * that each ran their own argmax, and three of them disagreed with it.
 *
 * **S1b (2026-07-28) closed that.** All five are now PROJECTIONS of
 * `ranked_factor_ids[0]`: `driver_label` (`src/lib/driver-label.ts`),
 * `dominant_factor` (`src/trust/factor-dominance.ts`),
 * `m1_coaching.key_drivers[].rank` (`src/coaching/key-drivers.ts`),
 * `decision_brief.top_drivers[0]` (`src/assembly/decision-brief.ts`) and the
 * facts-path `importance_rank` (`mapFactorSensitivityToFactsInput`). See the
 * PROJECTION REGISTER at the foot of this file, and the single end-to-end law
 * in `tests/driver-order-projection.fixture.test.ts`.
 *
 * ## ⛔ THIS MODULE DOES NOT UN-DEMOTE LEVERS (amendment §4.4)
 *
 * `applyLeverAwareImportanceOrder` pushes option-controlled levers to the back
 * of the order. Under the role model that demotion is a *permission* decision
 * executing inside the *ordering* layer, and the honest end-state ranks a
 * lever in its true place and MARKS it. But the truthful-order change must not
 * ship before CEE's permission is live and the UI consumes it — today the
 * demotion is the ONLY thing keeping `importance_rank == 1` off a factor the
 * producer explicitly zeroed. So S1 attests the demotion (`lever_policy`,
 * `lever_ids`) rather than removing it.
 *
 * ## ⭐ THE ORDERING RULE, STATED AT THE BYTES
 *
 * `CANONICAL_DRIVER_ORDER_RULE_V1`. `ranked_factor_ids` is the emitted
 * `factor_sensitivity[]` array order, which is produced by:
 *
 *   1. **Basis order.** On the graph-primary path the rows arrive in
 *      `computeFactorSensitivityFromGraph`'s influence order (`influence_score`
 *      descending) — attested `basis: 'graph_structural'`. On the ISL-only
 *      fallback they arrive in ISL's own Monte-Carlo uncertainty-importance
 *      order — attested `basis: 'isl_uncertainty'`.
 *   2. **ISL-only tail (merge path only).** `mergeIslConfidenceIntoGraphFactors`
 *      APPENDS non-lever ISL-only rows at the tail **with no re-sort**. Those
 *      rows carry a different quantity under the same field names, so the
 *      within-partition order is the producer's ASSEMBLY order, not a global
 *      sort on one number. That situation is exactly what `species:
 *      'mixed_graph_isl'` exists to disclose — before this field a consumer
 *      could not detect it at all.
 *   3. **Lever partition.** `applyLeverAwareImportanceOrder` performs a STABLE
 *      partition placing every non-lever ahead of every lever, preserving order
 *      within each partition. Lever identity is the D-U union
 *      (`isOptionControlledLever`: ISL's `zero_reason: 'intervention_override'`
 *      stamp OR membership of `interventionTargetIdsFromOptions(options)`) —
 *      attested `lever_policy: 'du_union'`.
 *
 * The rule is re-derivable from the emitted payload plus the request's option
 * interventions, which is what makes the attestation CHECKABLE rather than
 * decorative: see `tests/driver-order-attestation.fixture.test.ts`, which
 * re-applies step 3 independently (it does not import this module) and asserts
 * it reproduces `ranked_factor_ids`.
 *
 * ## ABSENCE SEMANTICS (amendment Rule S2)
 *
 * - `driver_order` is emitted **whenever `factor_sensitivity` is emitted**,
 *   including when the array is empty — with `basis: 'none'` rather than
 *   omission. Present-empty and absent are different claims; the family-2 side
 *   already paid for that distinction (PLoT #284) and this adopts its
 *   resolution rather than re-litigating it.
 * - `separability.top_pair_separable === null` means **UNRESOLVED, not
 *   separable** (amendment T2). A consumer MUST fail closed on it.
 * - `rank_stability` members are `null` when the producer did not measure them.
 *   Never coalesce a null to 0 — absent means "unavailable", not "zero"
 *   (`@talchain/schemas` `src/boundary/enrichment.ts:239-241`).
 */

import { isOptionControlledLever } from './intervention-override.js';
import { NEAR_TIE_THRESHOLD } from '../trust/result-coherence.js';

/**
 * WHICH authority produced the canonical order.
 *
 * Mirrors `ImportanceBasis` (`src/lib/importance-authority.ts`) with one extra
 * member: `'none'` — no order was made. `'none'` is emitted rather than
 * omitting the object, so a consumer can distinguish "the producer ranked
 * nothing" from "an old producer, or a dropped key".
 */
export type DriverOrderBasis = 'graph_structural' | 'isl_uncertainty' | 'none';

/**
 * Whether the ordered rows are all one quantity species.
 *
 * - `'single'` — every row came from the same producer path.
 * - `'mixed_graph_isl'` — the array carries BOTH graph-derived rows and
 *   ISL-only rows appended at the tail. Their `influence_score` /
 *   `sensitivity_score` / `elasticity` are **incommensurable**: the graph path
 *   publishes path-analysis influence, ISL publishes Monte-Carlo uncertainty
 *   importance, and both wear the same field names. A consumer that sorts or
 *   bands across the whole array in this state is comparing two units.
 */
export type DriverOrderSpecies = 'single' | 'mixed_graph_isl';

/**
 * The lever PREDICATE actually applied when the order was made.
 *
 * ⚠ It names the predicate, **not the treatment** — and the treatment differs by
 * path (S1 review, LOW):
 *
 *   · **graph-primary path** — levers are DEMOTED. Every lever is present in
 *     `ranked_factor_ids`, partitioned to the back, and named in `lever_ids`.
 *   · **ISL-only fallback** — levers are REMOVED upstream. The append path in
 *     `mergeIslConfidenceIntoGraphFactors` applies the same D-U union check and
 *     never emits a lever row at all, so `lever_ids` is `[]`.
 *
 * ⇒ **`lever_ids: []` means "no lever is IN this order", NEVER "this decision
 * has no levers".** A consumer that reads the empty array as the second claim is
 * making an inference the producer did not.
 *
 * - `'du_union'` — the D-U structural union predicate
 *   (`isOptionControlledLever`: ISL stamp OR options-derived intervention
 *   target). This is what `/v2/run` applies, on BOTH paths.
 * - `'stamp_only'` — ISL's `zero_reason` stamp alone, which UNDER-covers
 *   (an unstamped union lever slips through). RESERVED: named here because
 *   other surfaces in this same response still use it
 *   (`filterInterventionOverrides` at `src/assembly/decision-brief.ts`), so a
 *   future slice can attest them without inventing a value. NOT emitted by
 *   this build.
 * - `'none'` — no lever policy was applied because no order was made
 *   (`basis: 'none'`).
 */
export type DriverOrderLeverPolicy = 'du_union' | 'stamp_only' | 'none';

/** ISL's four-band attribution-stability category, worst-to-best. */
export type AttributionStabilityBand = 'negligible' | 'low' | 'moderate' | 'high';

const ATTRIBUTION_STABILITY_ORDER: readonly AttributionStabilityBand[] = [
  'negligible',
  'low',
  'moderate',
  'high',
];

/**
 * The TIE VERDICT for this order's top position (amendment §6.3).
 *
 * Tie-ness is a PRODUCER verdict, never a consumer derivation: the layer that
 * owns the ORDER owns the statement "this order's top position is not
 * separable from the runner-up". T1 makes it orthogonal to the designation —
 * `ranked_factor_ids[0]` answers *"does an argmax exist?"* (a DATA fact),
 * `top_pair_separable` answers *"is it separable from #2?"* (a VERDICT) — and
 * the presence of one is never permission for the other.
 *
 * ## ⚠ WHAT THIS BUILD DECIDES — AND ON WHOSE AUTHORITY
 *
 * ### 🟡 PROVISIONAL (Paul-ratified 2026-07-28; Neil's statistic still pending)
 *
 * S1 emitted only what it could PROVE: an exact tie, or `null`. `true` was
 * unreachable, because deciding *separable* needs a THRESHOLD and none had been
 * ratified for the driver order. Paul ratified a **provisional default** rather
 * than leave the field permanently unresolved — so this build now decides, and
 * says so on the wire:
 *
 * - `false` + `method: 'basis_value_exact_tie'` — the top two rows are EXACTLY
 *   equal on the quantity the order was made on. A proven non-separation; no
 *   threshold involved, unchanged since S1.
 * - `false` / `true` + `method: 'relative_gap_0.10_provisional'` — the
 *   **provisional** verdict. See `PROVISIONAL_TOP_PAIR_SEPARABILITY_MIN_RELATIVE_GAP`.
 * - `null` + `method: null` — **unresolved.** Not measured, not decidable. Per
 *   T2 every consumer fails closed on this.
 *
 * ⛔ **THE PENDING RATIFICATION, and the one-line change that overrules it.**
 * Neil owns the real statistic — the honest input is ISL's bootstrap
 * (`rank_flip_rate`, `elasticity_std`, `attribution_stability`), not a gap on a
 * point estimate. When that lands, an overrule is exactly ONE edit:
 * **replace the body of `decideProvisionalSeparability` below** (and, if the
 * threshold changes rather than the statistic, the single
 * `PROVISIONAL_TOP_PAIR_SEPARABILITY_MIN_RELATIVE_GAP` binding). Nothing else in
 * this file, and no consumer, needs to move — which is the whole reason the
 * verdict is a producer statement carrying its own method name.
 *
 * ⚠ Until then, `method` MUST keep saying `provisional`. A consumer that treats
 * a provisional verdict as a ratified one is making a claim this producer has
 * not made.
 */
export interface DriverOrderSeparability {
  /**
   * `true`/`false` = the producer's verdict. `null` = UNRESOLVED — fail closed
   * (T2: absence of a tie verdict is `unresolved`, NEVER `separable`).
   */
  top_pair_separable: boolean | null;
  /**
   * Names the statistic, the threshold and the ratification status behind a
   * non-null verdict; `null` when unresolved.
   *
   * T3 — one threshold, ON THE WIRE, not three in three repos. A consumer that
   * needs a different one is asking for a different verdict and must say so in
   * a review, not in a local constant.
   */
  method: string | null;
}

/**
 * 🟡 **PROVISIONAL** minimum RELATIVE gap between the top two rows of the
 * canonical order for the top position to be called separable.
 *
 * ## The number: reused, not invented
 *
 * Bound to `NEAR_TIE_THRESHOLD` (`src/trust/result-coherence.ts`) — **0.10, the
 * repo's ONE ratified near-tie magnitude**, already used for the OPTIONS
 * near-tie verdict (`computeNearTie`) and for the decision brief's
 * `'very_close'` band. Bound rather than hand-copied so the two cannot drift
 * apart unnoticed (trap 12: derive, don't mirror); pinned to the literal `0.10`
 * in `tests/driver-order-separability.unit.test.ts` so that if the options-side
 * constant is ever changed for an unrelated product reason, that is a LOUD test
 * failure rather than a silent move of this verdict.
 *
 * ## ⚠ The FORM is relative, and the repo's near-tie precedent is ABSOLUTE
 *
 * `computeNearTie` applies 0.10 as an ABSOLUTE gap between two
 * `win_probability` values. That form is **wrong for this quantity**, and the
 * reason is specific rather than stylistic:
 *
 * `influence_score` is `|influence| / maxAbsInfluence` — **normalised by the
 * largest row**, which after the lever demotion need not be in the compared
 * pair at all. On the committed golden the max row IS the demoted lever
 * (`influence_score: 1`), so the two rows actually being compared sit at 0.497
 * and 0.390. Had that lever's raw influence been twice as large, both would
 * halve to 0.249 / 0.195 — **the same underlying data, an absolute gap
 * collapsing from 0.107 to 0.053, and the verdict flipping** on a number
 * outside the comparison. A RELATIVE gap `(a − b) / a` is invariant to that
 * rescaling (0.2145 either way).
 *
 * `win_probability` has no such problem — it is normalised across the options
 * being compared — which is why the same constant is right and the same form is
 * not.
 *
 * ## ⛔ NOT RATIFIED — Neil owns the replacement
 *
 * A gap between two point estimates is not a statistical separability test. The
 * honest statistic reads ISL's bootstrap (`rank_flip_rate`, `elasticity_std`,
 * `attribution_stability`), all of which this response already carries in
 * `driver_order.rank_stability`. Until that ruling lands this build states its
 * provenance honestly in `method` and nothing more.
 */
export const PROVISIONAL_TOP_PAIR_SEPARABILITY_MIN_RELATIVE_GAP = NEAR_TIE_THRESHOLD;

/** The method name for the PROVEN, threshold-free non-separation. Unchanged since S1. */
export const SEPARABILITY_METHOD_EXACT_TIE = 'basis_value_exact_tie';

/**
 * The method name for the provisional verdict — statistic, threshold and
 * ratification status, DERIVED from the constant so the string cannot drift
 * away from the number it describes.
 */
export const SEPARABILITY_METHOD_RELATIVE_GAP =
  `relative_gap_${PROVISIONAL_TOP_PAIR_SEPARABILITY_MIN_RELATIVE_GAP.toFixed(2)}_provisional` as const;

/**
 * ISL's measured rank-stability inputs, aggregated over the ordered rows.
 *
 * These are MEASUREMENTS, not verdicts — no threshold is applied, so they are
 * safe to emit today and are the inputs a future `top_pair_separable` decision
 * would read. `null` means the producer did not measure it for these rows.
 */
export interface DriverOrderRankStability {
  /** Worst (highest) `rank_flip_rate` across the ordered rows; `null` if none carry one. */
  max_rank_flip_rate: number | null;
  /** Worst `attribution_stability` band across the ordered rows; `null` if none carry one. */
  min_attribution_stability: AttributionStabilityBand | null;
}

/**
 * The ONE ordering object (amendment §4.3), emitted as a top-level enrichment
 * sibling of `factor_sensitivity[]`.
 *
 * ⚠ `version` is a schema discriminator for this OBJECT, not for the ordering
 * rule's inputs. Bump it when a member's meaning changes.
 */
export interface DriverOrderV1 {
  version: 1;
  basis: DriverOrderBasis;
  /**
   * ⭐ THE canonical order — factor IDS, never labels, never values (a second
   * copy of a label is a second thing to drift). Parallel to the emitted
   * `factor_sensitivity[]` array: `ranked_factor_ids[i]` is
   * `factor_sensitivity[i].factor_id` (amendment Rule S3, "one order, and the
   * array IS it"). `[]` when `basis` is `'none'`.
   */
  ranked_factor_ids: string[];
  species: DriverOrderSpecies;
  lever_policy: DriverOrderLeverPolicy;
  /**
   * The option-controlled levers among `ranked_factor_ids`, in rank order.
   * MARKED, not hidden: a lever is present in the order, and this names it so
   * a consumer can apply its own crown policy without re-deriving lever
   * identity from `zero_reason` (which under-covers).
   */
  lever_ids: string[];
  separability: DriverOrderSeparability;
  rank_stability: DriverOrderRankStability;
}

/** Minimal row shape the ordering attestation reads. */
export interface DriverOrderFactorRow {
  factor_id?: string;
  node_id?: string;
  zero_reason?: string | null;
  source?: string;
  influence_score?: number | null;
  sensitivity_score?: number | null;
  rank_flip_rate?: number | null;
  attribution_stability?: string | null;
}

export interface BuildDriverOrderInput {
  /**
   * The FINAL emitted `factor_sensitivity[]` rows, in emitted order.
   * `undefined` ⇒ no `factor_sensitivity` on the wire ⇒ no attestation either
   * (`buildDriverOrder` returns `undefined`; the caller omits the key).
   */
  factors: readonly DriverOrderFactorRow[] | undefined;
  /** The D-U structural lever union derived from the request's options. */
  structuralLeverIds: ReadonlySet<string> | undefined;
  /**
   * `factorSensitivitySource` as computed in `/v2/run`: `'isl'` on the ISL-only
   * fallback, anything else (`'graph+isl_merge'`) on the graph-primary path.
   */
  factorSensitivitySource: string | undefined;
  /**
   * ISL's own suppression disclosure —
   * `correlation_model.suppressed_attributions`: the list of independence-
   * assuming per-factor attributions ISL WITHHELD under an active correlation
   * model ("Absent from the response, not null — this list names what was
   * withheld").
   *
   * ⭐ This is the honest value with no reader (amendment §4.5): ISL declares
   * absence-with-reason in exactly the shape the permission layer needs, and
   * before this slice PLoT had ZERO references to it. It is carried into
   * `basis: 'none'` on the path where the suppressed producer WAS the basis,
   * so `not_computed` is SOURCED from the producer that knows instead of
   * inferred from an empty array.
   *
   * ⚠ Note the members are ATTRIBUTION NAMES (`'factor_sensitivity'`,
   * `'p_win_sensitivity'`, `'conditional_winners'`), not factor ids.
   */
  islSuppressedAttributions: readonly string[] | undefined;
}

/** Resolve a row's id through the canonical node_id-first precedence. */
function idOf(f: DriverOrderFactorRow): string | undefined {
  const raw = f.node_id ?? f.factor_id;
  return typeof raw === 'string' && raw !== '' ? raw : undefined;
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** The unresolved verdict — the ONLY honest answer when the pair is undecidable. */
const UNRESOLVED: DriverOrderSeparability = { top_pair_separable: null, method: null };

/**
 * Decide the tie verdict for the top PAIR of the canonical order.
 *
 * The basis quantity is `influence_score` on the graph path (what
 * `computeFactorSensitivityFromGraph` ordered on) and the same field on the ISL
 * fallback (ISL's importance surface is carried into it by `mapIslFactorEntry`).
 *
 * ## ⭐ THE COMPARABILITY GUARD — a verdict about a pair that was never ordered
 * ## together is a fabrication (S1 review, LOW)
 *
 * S1 compared rows 0 and 1 of the **FINAL** order — which is the order AFTER
 * `applyLeverAwareImportanceOrder` has partitioned levers to the back. Those two
 * rows are therefore not necessarily adjacent in any sort on `influence_score`:
 *
 *   · **Across the lever partition.** A lever keeps its true structural
 *     `influence_score` (only sensitivity/elasticity/VOI are zeroed), and it is
 *     frequently the LARGEST — on the committed golden the demoted lever is
 *     exactly 1.0 while the canonical #1 is 0.497. With one non-lever and one
 *     lever, rows 0 and 1 straddle the partition and `b > a`: the "gap" is
 *     negative and means nothing. Worse, an EXACT equality across the partition
 *     would have been published as `basis_value_exact_tie` — *"proven not
 *     separable"* — when it is a coincidence between two rows the producer never
 *     compared.
 *   · **Across two species.** In `mixed_graph_isl` the graph rows carry
 *     path-analysis influence and the appended ISL rows carry Monte-Carlo
 *     uncertainty importance, under the same field name and in the same array.
 *     Subtracting one from the other compares two units.
 *
 * Both fail **CLOSED** to `null` (T2 — absence of a verdict is `unresolved`,
 * never `separable`), and `null` is used rather than `false` deliberately:
 * `false` is a positive claim ("proven not separable") and the producer has not
 * earned it here. The guard can only ever REMOVE a verdict, never add one.
 *
 * A residual accepted knowingly: the guard proves the pair is COMPARABLE, not
 * that the underlying estimates are statistically distinguishable. That second
 * question is Neil's, and it is why `method` says `provisional`.
 */
function decideSeparability(
  ordered: readonly DriverOrderFactorRow[],
  isLever: readonly boolean[],
): DriverOrderSeparability {
  if (ordered.length < 2) return UNRESOLVED;

  // ── comparability, before any arithmetic ────────────────────────────────
  if (isLever[0] !== isLever[1]) return UNRESOLVED;
  if (ordered[0].source !== ordered[1].source) return UNRESOLVED;

  const a = finiteOrNull(ordered[0].influence_score);
  const b = finiteOrNull(ordered[1].influence_score);
  // An absent number is not a tie and is not a separation. Never coalesced to 0
  // — absent means "unavailable", not "least important".
  if (a === null || b === null) return UNRESOLVED;

  // An exact tie needs no threshold, so it keeps its own ratified method name
  // and must NOT inherit the provisional one. Checked first, and unchanged.
  if (a === b) {
    return { top_pair_separable: false, method: SEPARABILITY_METHOD_EXACT_TIE };
  }

  // The order does not descend on this quantity across the top pair, so this is
  // not the quantity the order was made on. Unresolved, not "tied".
  if (b > a) return UNRESOLVED;
  // A non-positive leader admits no relative gap (and `a === 0` was already
  // handled above: with b < a ≤ 0 the pair is not on the basis scale at all).
  if (a <= 0) return UNRESOLVED;

  const relativeGap = (a - b) / a;
  if (!Number.isFinite(relativeGap)) return UNRESOLVED;

  return {
    top_pair_separable: relativeGap >= PROVISIONAL_TOP_PAIR_SEPARABILITY_MIN_RELATIVE_GAP,
    method: SEPARABILITY_METHOD_RELATIVE_GAP,
  };
}

function aggregateRankStability(
  ordered: readonly DriverOrderFactorRow[],
): DriverOrderRankStability {
  let maxFlip: number | null = null;
  let worstBandIdx: number | null = null;
  for (const f of ordered) {
    const flip = finiteOrNull(f.rank_flip_rate);
    if (flip !== null && (maxFlip === null || flip > maxFlip)) maxFlip = flip;
    const idx = ATTRIBUTION_STABILITY_ORDER.indexOf(
      f.attribution_stability as AttributionStabilityBand,
    );
    if (idx >= 0 && (worstBandIdx === null || idx < worstBandIdx)) worstBandIdx = idx;
  }
  return {
    max_rank_flip_rate: maxFlip,
    min_attribution_stability:
      worstBandIdx === null ? null : ATTRIBUTION_STABILITY_ORDER[worstBandIdx],
  };
}

/**
 * Build the canonical driver order + attestation for one `/v2/run` response.
 *
 * Returns `undefined` — and ONLY `undefined` — when `factors` is `undefined`,
 * i.e. when the response carries no `factor_sensitivity` at all. An EMPTY
 * array is a present, ranked-nothing response and yields `basis: 'none'`.
 *
 * The function does NOT re-order `factors`; the emitted array order IS the
 * canonical order by construction (Rule S3), and re-sorting here would change
 * an existing emission, which S1 must not do.
 */
export function buildDriverOrder(input: BuildDriverOrderInput): DriverOrderV1 | undefined {
  const { factors, structuralLeverIds, factorSensitivitySource, islSuppressedAttributions } = input;
  if (factors === undefined) return undefined;

  const rankedFactorIds: string[] = [];
  const leverIds: string[] = [];
  const orderedRows: DriverOrderFactorRow[] = [];
  /** Parallel to `orderedRows` — the comparability guard in `decideSeparability`. */
  const orderedIsLever: boolean[] = [];
  let sawGraph = false;
  let sawIsl = false;
  for (const f of factors) {
    const id = idOf(f);
    if (id === undefined) continue;
    rankedFactorIds.push(id);
    orderedRows.push(f);
    const lever = isOptionControlledLever(f, structuralLeverIds);
    orderedIsLever.push(lever);
    if (lever) leverIds.push(id);
    if (f.source === 'graph') sawGraph = true;
    else if (f.source === 'isl') sawIsl = true;
  }

  // ── basis ────────────────────────────────────────────────────────────────
  // 'none' when nothing was ranked, OR when ISL itself declared the per-factor
  // attributions WITHHELD and ISL was the only basis available (the ISL-only
  // fallback path). On the graph-primary path ISL's suppression does not touch
  // the basis: PLoT's own graph path analysis produced the order, and calling
  // that 'none' would be a different lie.
  const islSuppressedFactorAttributions =
    islSuppressedAttributions?.includes('factor_sensitivity') === true;
  const islOnlyPath = factorSensitivitySource === 'isl';
  let basis: DriverOrderBasis;
  if (rankedFactorIds.length === 0 || (islOnlyPath && islSuppressedFactorAttributions)) {
    basis = 'none';
  } else if (islOnlyPath) {
    basis = 'isl_uncertainty';
  } else {
    basis = 'graph_structural';
  }

  if (basis === 'none') {
    return {
      version: 1,
      basis: 'none',
      ranked_factor_ids: [],
      species: 'single',
      lever_policy: 'none',
      lever_ids: [],
      separability: { top_pair_separable: null, method: null },
      rank_stability: { max_rank_flip_rate: null, min_attribution_stability: null },
    };
  }

  return {
    version: 1,
    basis,
    ranked_factor_ids: rankedFactorIds,
    species: sawGraph && sawIsl ? 'mixed_graph_isl' : 'single',
    lever_policy: 'du_union',
    lever_ids: leverIds,
    // ⚠ Rows WITHOUT a usable id are excluded from `ranked_factor_ids`, so the
    // verdict is decided over the rows the attestation actually names — not
    // over `factors`, which may contain a row no consumer can join to.
    separability: decideSeparability(orderedRows, orderedIsLever),
    rank_stability: aggregateRankStability(factors),
  };
}

/**
 * Read ISL's `correlation_model.suppressed_attributions` defensively.
 *
 * ISL's contract is "absent from the response, not null", and the whole
 * `correlation_model` block is absent when correlation is inactive (the
 * independent-factor default), so every level here is optional. Returns
 * `undefined` when ISL said nothing — which is NOT the same claim as "ISL said
 * nothing was suppressed".
 */
export function readIslSuppressedAttributions(islResult: unknown): string[] | undefined {
  const cm = (islResult as { correlation_model?: unknown } | null | undefined)?.correlation_model;
  if (!cm || typeof cm !== 'object' || Array.isArray(cm)) return undefined;
  const raw = (cm as { suppressed_attributions?: unknown }).suppressed_attributions;
  if (!Array.isArray(raw)) return undefined;
  const names = raw.filter((v): v is string => typeof v === 'string');
  return names.length > 0 ? names : undefined;
}

/**
 * ── ⭐ PROJECTION REGISTER: every surface in this response that names a #1 ──
 *
 * S1b (2026-07-28) made all five PROJECTIONS of `ranked_factor_ids[0]`. Before
 * it, each ran its own argmax over its own quantity and three disagreed with
 * this order on the committed golden — including `driver_label`, which crowned
 * the option-pinned lever the same response publishes at `sensitivity_score: 0`.
 *
 * | surface | how it names #1 NOW | was (S1) |
 * |---|---|---|
 * | `factor_sensitivity[].importance_rank` | this order (it IS this order) | unchanged |
 * | `factor_sensitivity[].driver_label === 'biggest'` | `ranked_factor_ids[0]` (`src/lib/driver-label.ts`) | argmax `influence_score`, lever-blind — **crowned the lever** |
 * | `m1_coaching.key_drivers[].rank` | `importance_rank` ascending (`src/coaching/key-drivers.ts`) | `Math.abs(influence_score ?? elasticity ?? 0)` — **crowned the lever** |
 * | `dominant_factor` | `factors[0]` only, gates unchanged (`src/trust/factor-dominance.ts`) | internal argmax over unfiltered rows — one number from crowning the lever (F-D3) |
 * | `decision_brief.top_drivers[0]` | canonical order minus `lever_ids` (`src/assembly/decision-brief.ts`) | `filterInterventionOverrides` (ISL stamp only, UNDER-covers) + a second \|elasticity\| sort |
 * | facts-path `importance_rank` | `fs.importance_rank` (`mapFactorSensitivityToFactsInput`) | positional `idx + 1` — agreed by accident |
 *
 * ⛔ **NOT changed, and deliberately (§4.4):** the lever DEMOTION itself.
 * `applyLeverAwareImportanceOrder` still pushes option-controlled levers to the
 * back. Ranking a lever in its true place and leaving the crown to CEE's
 * permission is the honest end state, but it must not ship before that
 * permission is live and the UI consumes it (S4 + S6) — today the demotion is
 * the only thing keeping a producer-zeroed factor off rank 1.
 *
 * ⚠ **Two surfaces in this response still use the STAMP-ONLY lever predicate:**
 * `buildWhatWouldChange` and the value-defaulted disclosure block in
 * `src/assembly/decision-brief.ts`. They are out of S1b's scope (which is the
 * #1-naming surfaces), the `lever_policy: 'stamp_only'` enum member exists so a
 * later slice can attest them without inventing a value, and this note is here
 * so the omission is recorded rather than discovered.
 *
 * Enforced by `tests/driver-order-projection.fixture.test.ts` (one law, all
 * five, end to end), `tests/driver-surface-projection.unit.test.ts` (the three
 * whose divergence the golden cannot see) and
 * `tests/driver-quantity-register.derived.test.ts` (§3.2's derived register).
 */
