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
 * S1 is **ADDITIVE ONLY**. `driver_order` is emitted ALONGSIDE the existing
 * surfaces; nothing that ranks or crowns today changes shape, value or
 * meaning. In particular the amendment's §8-S1 second half — making
 * `driver_label`, `dominant_factor`, `m1_coaching.key_drivers[].rank`,
 * `decision_brief.top_drivers[0]` and the facts-path `importance_rank`
 * PROJECTIONS of `ranked_factor_ids[0]` — is **NOT** done here. Those five
 * remain independent argmaxes and, on the committed golden, three of them
 * still disagree with this order (see the RESIDUAL block at the foot of this
 * file). Consumers arrive first (amendment §4.4: "the safe order is
 * consumer-first"), producers converge after.
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
 * The lever doctrine actually applied when the order was made.
 *
 * - `'du_union'` — the D-U structural union predicate
 *   (`isOptionControlledLever`: ISL stamp OR options-derived intervention
 *   target). This is what `/v2/run` applies.
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
 * ## ⚠ WHAT THIS BUILD CAN AND CANNOT DECIDE
 *
 * `top_pair_separable: true` is **NEVER emitted by this build**, deliberately.
 * Deciding *separable* from ISL's bootstrap measurements (`rank_flip_rate`,
 * `elasticity_std`, `attribution_stability`) requires a THRESHOLD, and no
 * threshold for the DRIVER order has been ratified. Amendment T3 requires the
 * producer to publish the one threshold it used; inventing one here would
 * manufacture exactly the three-thresholds-in-three-repos defect T3 exists to
 * kill (PLoT 0.10 / CEE 1.0 / UI 0.65 on the OPTIONS question). So this build
 * emits only what it can PROVE:
 *
 * - `false` + `method: 'basis_value_exact_tie'` — the top two rows are EXACTLY
 *   equal on the quantity the order was made on. A proven non-separation; no
 *   threshold involved.
 * - `null` + `method: null` — **unresolved.** Not measured, not decided. Per
 *   T2 every consumer fails closed on this; strict inequality on the basis
 *   quantity is NOT evidence of statistical separability.
 *
 * ⇒ The `true` branch is an open decision (which statistic, which threshold,
 * against which pair) and it is a science sign-off, not a producer choice.
 */
export interface DriverOrderSeparability {
  /**
   * `false` = proven NOT separable. `null` = UNRESOLVED (fail closed).
   * `true` is not produced by this build — see the interface doc.
   */
  top_pair_separable: boolean | null;
  /** Names the method behind a non-null verdict; `null` when unresolved. */
  method: string | null;
}

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

/**
 * Decide the tie verdict for the top PAIR of the canonical order.
 *
 * Only ever returns a PROVEN `false` or an honest `null` — see
 * `DriverOrderSeparability`. The basis quantity is `influence_score` on the
 * graph path (what `computeFactorSensitivityFromGraph` ordered on) and the
 * same field on the ISL fallback (ISL's importance surface is carried into it
 * by `mapIslFactorEntry`). When either of the top two rows lacks a finite
 * basis value the verdict is `null`: an absent number is not a tie and is not
 * a separation.
 */
function decideSeparability(
  ordered: readonly DriverOrderFactorRow[],
): DriverOrderSeparability {
  if (ordered.length < 2) return { top_pair_separable: null, method: null };
  const a = finiteOrNull(ordered[0].influence_score);
  const b = finiteOrNull(ordered[1].influence_score);
  if (a === null || b === null) return { top_pair_separable: null, method: null };
  if (a === b) {
    return { top_pair_separable: false, method: 'basis_value_exact_tie' };
  }
  // Strict inequality is NOT evidence of statistical separability — no
  // ratified threshold exists for the driver order (amendment T3). Unresolved.
  return { top_pair_separable: null, method: null };
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
  let sawGraph = false;
  let sawIsl = false;
  for (const f of factors) {
    const id = idOf(f);
    if (id === undefined) continue;
    rankedFactorIds.push(id);
    if (isOptionControlledLever(f, structuralLeverIds)) leverIds.push(id);
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
    separability: decideSeparability(factors),
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
 * ── RESIDUAL: the divergent ordering sources S1 deliberately does NOT touch ──
 *
 * `driver_order` is emitted ALONGSIDE these; none of them changed in S1. Each
 * is an independent argmax today, and on the committed golden
 * (`tests/fixtures/isl-v2-live-20260707/plot-v2-run.golden.json`) three of the
 * five disagree with `ranked_factor_ids[0]`. Making them projections of
 * `ranked_factor_ids[0]` is the amendment's §8-S1 second half and is scheduled,
 * not forgotten. Pinned — so none can drift silently — by
 * `tests/driver-order-attestation.fixture.test.ts` and, for `driver_label`, by
 * `tests/importance-rank-lever-doctrine.fixture.test.ts`.
 *
 * | surface | ranks on | lever-aware? | agrees with ranked_factor_ids[0] on the golden? |
 * |---|---|---|---|
 * | `factor_sensitivity[].importance_rank` | this order | ✅ D-U union | ✅ yes (it IS this order) |
 * | `factor_sensitivity[].driver_label === 'biggest'` | argmax `influence_score` (`src/lib/driver-label.ts`) | ❌ no | ❌ no — crowns the option-pinned lever |
 * | `m1_coaching.key_drivers[].rank` | `Math.abs(influence_score ?? elasticity ?? 0)` (`src/coaching/key-drivers.ts`) | ❌ no | ❌ no |
 * | `dominant_factor` | `detectDominantFactor` over unfiltered rows (`src/trust/factor-dominance.ts`) | ❌ no | suppressed by its >2 ratio gate on this fixture |
 * | `decision_brief.top_drivers[0]` | `filterInterventionOverrides` = ISL stamp only (`src/assembly/decision-brief.ts`) | ⚠ stamp-only | ✅ yes on this fixture (the stamp happens to cover) |
 * | facts-path `importance_rank` | positional `idx + 1` (`src/routes/v2/run.ts`, `src/facts/mapper.ts`) | n/a — a POSITION, not a rank | mirrors the array, so agrees by accident |
 */
