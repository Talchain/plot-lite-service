/**
 * Numeric-egress boundary guards (Track S — Codex round-2).
 * ----------------------------------------------------------------------------
 * Compile-time ISL response types are a fiction over untrusted wire data: the
 * remote engine's JSON is cast to typed numbers with NO runtime validation, so a
 * degenerate Monte Carlo run can deliver NaN / ±Infinity / out-of-range values.
 * Fastify then serialises non-finite numbers to a fabricated `null` on declared
 * number fields. These helpers are the single source of truth for validating
 * ISL-derived numbers at the PLoT serialisation boundary: an invalid value
 * returns `undefined` so the caller can OMIT the field (honest absence) rather
 * than emit a fabricated `null` or a substituted zero.
 *
 * Each helper returns the value verbatim when valid, else `undefined`. They never
 * clamp or coerce — out-of-range is treated as "not measured", not "snapped to the
 * boundary" — so an in-range value passes through byte-identically (no golden /
 * response-payload drift for the normal path).
 */

// `finiteNum` (measurements) and `nonNegInt` (sample counts) live in the
// neutral numeric util so this guard, the enrichment-egress guard, and the
// ISL compute-admission validator all share ONE definition. Re-exported here
// so existing importers of this module keep their import path unchanged.
import { finiteNum, nonNegInt, isFiniteNumber } from '../../util/numeric.js';
export { finiteNum, nonNegInt };

/** Finite probability/rate in [0,1]. Use for win_probability, prob_satisfied, rates. */
export function prob01(v: unknown): number | undefined {
  return isFiniteNumber(v) && v >= 0 && v <= 1 ? v : undefined;
}

/** Finite non-negative real. Use for std, e_value, absolute margins. */
export function nonNeg(v: unknown): number | undefined {
  return isFiniteNumber(v) && v >= 0 ? v : undefined;
}

/**
 * True iff an ISL option `outcome` carries ALL required OutcomeStatsV3 stats
 * (mean/p10/p50/p90) as finite numbers. This is the SINGLE predicate that decides
 * both (a) whether the public `outcome` object is emitted in buildResponse and
 * (b) whether the option counts as a usable comparison for option_comparison_status.
 * Using one predicate for both guarantees status can never report 'computed' while
 * the public outcome was omitted (Codex round-3 #2).
 */
export function hasAllRequiredOutcomeStats(o: unknown): boolean {
  if (!o || typeof o !== 'object') return false;
  const r = o as Record<string, unknown>;
  return finiteNum(r.mean) !== undefined
    && finiteNum(r.p10) !== undefined
    && finiteNum(r.p50) !== undefined
    && finiteNum(r.p90) !== undefined;
}

/**
 * ISL's per-option DOWNSIDE / tail-risk block, validated for egress (2.449).
 *
 * PRODUCER SEMANTICS, read from ISL's `DownsideV2` (src/models/response_v2.py)
 * rather than inferred here (trap 13c — an expectation written from the
 * consumer's reading of what a field ought to mean is a wrong oracle no
 * mutation kit can detect):
 *   · `cvar_10`         mean of the WORST 10% of the option's post-noise outcome
 *                       samples. Same units as `outcome.mean`, no normalisation.
 *                       The 0.10 tail mass is DOCTRINE-PENDING(Neil) — a working
 *                       default, NOT ratified science.
 *   · `p05`             5th percentile, same population and `np.percentile`
 *                       convention as `outcome.p10/p50/p90`.
 *   · `expected_regret` `mean_i(best_i − o_i)` on the PRE-noise CRN population
 *                       (a JOINT, cross-option metric — the same population as
 *                       `win_probability`). `>= 0` by construction.
 *
 * ALL-OR-NOTHING, and that is the producer's rule, not a local invention: all
 * three are REQUIRED floats on `DownsideV2`, and ISL omits the whole block —
 * "Omitted, never null" — rather than ship a partial one when any component
 * cannot be computed honestly. This guard mirrors that at PLoT's serialisation
 * boundary. It NEVER substitutes a zero: a fabricated 0 in a tail-risk
 * statistic does not read as "unknown", it reads as "there is no downside",
 * which is the most damaging direction this defect class can take (the same
 * shape as the `?? 0` regret default that collapsed the whole-decision EVPI
 * bound, and the `?? 0` breach margins that produced a false architectural
 * conclusion in #237).
 *
 * A MEASURED ZERO IS NOT AN ABSENCE. The option that wins every sample has
 * `expected_regret === 0` by construction, so the guard tests finiteness and
 * range, never truthiness.
 *
 * Returns a fresh object in ISL's declaration order (cvar_10 → p05 →
 * expected_regret) when every component is honest, else `undefined` so the
 * caller OMITS the key.
 */
export function buildDownside(v: unknown): { cvar_10: number; p05: number; expected_regret: number } | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const d = v as Record<string, unknown>;
  const cvar10 = finiteNum(d.cvar_10);
  const p05 = finiteNum(d.p05);
  // `nonNeg`, not `finiteNum`: ISL declares `expected_regret: Field(..., ge=0)`.
  // A negative value means the producer's own invariant broke; PLoT must not
  // launder a broken invariant into a plausible-looking number.
  const expectedRegret = nonNeg(d.expected_regret);
  if (cvar10 === undefined || p05 === undefined || expectedRegret === undefined) return undefined;
  return { cvar_10: cvar10, p05, expected_regret: expectedRegret };
}

/**
 * ISL's per-option goal-chance PRECISION block, validated for egress (G4).
 *
 * PRODUCER SEMANTICS (ISL `GoalChancePrecision`, src/models/goal_chance.py): the informative
 * draws behind `probability_of_goal`, how many met the goal, and a Wilson interval on that
 * pair. `basis: 'simulation_precision'` is Monte Carlo precision only — it narrows with more
 * draws and says nothing about how right the model is.
 *
 * ALL-OR-NOTHING, like `buildDownside`: a block with any field missing, non-finite, out of
 * range or off its closed vocabulary is omitted whole, never repaired. It must also describe
 * THIS figure: its counts reproduce `probabilityOfGoal` exactly (ISL computes the figure as
 * `n_met / n_informative`) and its interval holds it. A block that disagrees with the figure
 * it rides beside belongs to something else and is not carried.
 */
export interface GoalChancePrecisionEgress {
  basis: 'simulation_precision';
  method: 'wilson_score';
  confidence_level: number;
  n_informative: number;
  n_met: number;
  interval_lower: number;
  interval_upper: number;
}

export function buildGoalChancePrecision(
  v: unknown,
  probabilityOfGoal: number,
): GoalChancePrecisionEgress | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const p = v as Record<string, unknown>;
  if (p.basis !== 'simulation_precision' || p.method !== 'wilson_score') return undefined;
  const confidenceLevel = finiteNum(p.confidence_level);
  const nInformative = nonNegInt(p.n_informative);
  const nMet = nonNegInt(p.n_met);
  const lower = prob01(p.interval_lower);
  const upper = prob01(p.interval_upper);
  if (confidenceLevel === undefined || confidenceLevel <= 0 || confidenceLevel >= 1) return undefined;
  if (nInformative === undefined || nInformative < 1 || nMet === undefined || nMet > nInformative) return undefined;
  if (lower === undefined || upper === undefined) return undefined;
  if (nMet / nInformative !== probabilityOfGoal) return undefined;
  if (lower > probabilityOfGoal || upper < probabilityOfGoal) return undefined;
  return {
    basis: 'simulation_precision',
    method: 'wilson_score',
    confidence_level: confidenceLevel,
    n_informative: nInformative,
    n_met: nMet,
    interval_lower: lower,
    interval_upper: upper,
  };
}

/** One driver row of ISL's `GoalChanceDrivers`, as PLoT carries it. */
export interface GoalChanceDriverEgress {
  quantity_id: string;
  kind: 'factor_value' | 'link_strength' | 'link_existence';
  from?: string;
  to?: string;
  p_goal_if_low?: number;
  p_goal_if_high?: number;
  n_low?: number;
  n_high?: number;
  /** ISL's model-scale cut: the largest value in the low third. */
  low_upper_value?: number;
  /** ISL's model-scale cut: the smallest value in the high third. */
  high_lower_value?: number;
  /** PLoT: `low_upper_value` in the user's units. Absent means "no user-unit cut". */
  low_upper_display?: number;
  /** PLoT: `high_lower_value` in the user's units. Absent means "no user-unit cut". */
  high_lower_display?: number;
  /** PLoT: the unit of the `*_display` cuts, when the factor states one. */
  display_unit?: string;
  p_goal_if_absent?: number;
  p_goal_if_present?: number;
  n_absent?: number;
  n_present?: number;
  spread: number;
  spread_noise_floor: number;
  status: 'resolved' | 'below_resolution';
  correlated?: true;
}

export interface GoalChanceDriversEgress {
  method: 'tercile_conditional_v1';
  min_group_n: number;
  n_candidates: number;
  n_compared: number;
  n_dropped: number;
  dropped_by_reason: Record<string, number>;
  drivers: GoalChanceDriverEgress[];
  /**
   * PLoT: rows ISL sent that failed validation here and were dropped. Absent when none.
   * When present the list may be missing its largest spread, so its first row must not be
   * read as the largest.
   */
  invalid_rows_dropped?: number;
}

/** A factor's model-scale value in the user's units, or undefined when it has none. */
export type FactorCutInUserUnits = (
  factorId: string,
  modelValue: number,
) => { value: number; unit?: string } | undefined;

const GOAL_CHANCE_DRIVER_KINDS: ReadonlySet<unknown> = new Set(['factor_value', 'link_strength', 'link_existence']);
const GOAL_CHANCE_DRIVER_STATUSES: ReadonlySet<unknown> = new Set(['resolved', 'below_resolution']);

function nonEmptyString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function positiveInt(v: unknown): number | undefined {
  const n = nonNegInt(v);
  return n !== undefined && n >= 1 ? n : undefined;
}

/** One validated row in ISL's declaration order, or undefined when any field is not honest. */
function buildGoalChanceDriverRow(
  v: unknown,
  cutInUserUnits: FactorCutInUserUnits | undefined,
): GoalChanceDriverEgress | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const quantityId = nonEmptyString(r.quantity_id);
  const spread = prob01(r.spread);
  const spreadNoiseFloor = nonNeg(r.spread_noise_floor);
  if (quantityId === undefined || !GOAL_CHANCE_DRIVER_KINDS.has(r.kind) || !GOAL_CHANCE_DRIVER_STATUSES.has(r.status)) {
    return undefined;
  }
  // ISL lists a row only when its two groups differ; a zero spread is a broken invariant.
  if (spread === undefined || spread <= 0 || spreadNoiseFloor === undefined) return undefined;
  if (r.correlated !== undefined && typeof r.correlated !== 'boolean') return undefined;
  const kind = r.kind as GoalChanceDriverEgress['kind'];
  const status = r.status as GoalChanceDriverEgress['status'];
  const tail = {
    spread,
    spread_noise_floor: spreadNoiseFloor,
    status,
    ...(r.correlated === true ? { correlated: true as const } : {}),
  };

  // A link is named by both ends; a factor by its node id alone.
  let link: { from: string; to: string } | undefined;
  if (kind !== 'factor_value') {
    const from = nonEmptyString(r.from);
    const to = nonEmptyString(r.to);
    if (from === undefined || to === undefined) return undefined;
    link = { from, to };
  }

  if (kind === 'link_existence') {
    const pAbsent = prob01(r.p_goal_if_absent);
    const pPresent = prob01(r.p_goal_if_present);
    const nAbsent = positiveInt(r.n_absent);
    const nPresent = positiveInt(r.n_present);
    if (pAbsent === undefined || pPresent === undefined || nAbsent === undefined || nPresent === undefined) {
      return undefined;
    }
    return {
      quantity_id: quantityId,
      kind,
      ...link,
      p_goal_if_absent: pAbsent,
      p_goal_if_present: pPresent,
      n_absent: nAbsent,
      n_present: nPresent,
      ...tail,
    };
  }

  const pLow = prob01(r.p_goal_if_low);
  const pHigh = prob01(r.p_goal_if_high);
  const nLow = positiveInt(r.n_low);
  const nHigh = positiveInt(r.n_high);
  const lowUpper = finiteNum(r.low_upper_value);
  const highLower = finiteNum(r.high_lower_value);
  if (
    pLow === undefined || pHigh === undefined || nLow === undefined || nHigh === undefined
    || lowUpper === undefined || highLower === undefined
  ) {
    return undefined;
  }
  // Only a FACTOR's cut has a user unit: a link-strength cut is a model coefficient.
  const lowDisplay = kind === 'factor_value' ? cutInUserUnits?.(quantityId, lowUpper) : undefined;
  const highDisplay = kind === 'factor_value' ? cutInUserUnits?.(quantityId, highLower) : undefined;
  const displayUnit = lowDisplay?.unit ?? highDisplay?.unit;
  return {
    quantity_id: quantityId,
    kind,
    ...link,
    p_goal_if_low: pLow,
    p_goal_if_high: pHigh,
    n_low: nLow,
    n_high: nHigh,
    low_upper_value: lowUpper,
    high_lower_value: highLower,
    ...(lowDisplay !== undefined ? { low_upper_display: lowDisplay.value } : {}),
    ...(highDisplay !== undefined ? { high_lower_display: highDisplay.value } : {}),
    ...(displayUnit !== undefined ? { display_unit: displayUnit } : {}),
    ...tail,
  };
}

/**
 * ISL's per-option goal-chance DRIVERS block, validated for egress (G5).
 *
 * PRODUCER SEMANTICS (ISL `GoalChanceDrivers`): for each quantity sampled per draw, the goal
 * chance within the low and the high third of the option's informative draws (or with a link
 * absent and present), largest spread first, with every unlisted quantity counted by reason.
 *
 * The block's own counts and vocabulary are all-or-nothing. A ROW that fails is dropped —
 * never repaired — and counted in `invalid_rows_dropped`, because a list that lost a row can
 * no longer vouch for which spread is largest.
 *
 * `cutInUserUnits` turns a factor row's model-scale cut values into the user's units as
 * additive `*_display` keys. ISL's raw keys are always kept.
 */
export function buildGoalChanceDrivers(
  v: unknown,
  cutInUserUnits?: FactorCutInUserUnits,
): GoalChanceDriversEgress | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const d = v as Record<string, unknown>;
  if (d.method !== 'tercile_conditional_v1') return undefined;
  const minGroupN = nonNegInt(d.min_group_n);
  const nCandidates = nonNegInt(d.n_candidates);
  const nCompared = nonNegInt(d.n_compared);
  const nDropped = nonNegInt(d.n_dropped);
  if (minGroupN === undefined || nCandidates === undefined || nCompared === undefined || nDropped === undefined) {
    return undefined;
  }
  if (!d.dropped_by_reason || typeof d.dropped_by_reason !== 'object' || Array.isArray(d.dropped_by_reason)) {
    return undefined;
  }
  const droppedByReason: Record<string, number> = {};
  for (const [reason, count] of Object.entries(d.dropped_by_reason as Record<string, unknown>)) {
    const n = nonNegInt(count);
    if (n === undefined) return undefined;
    droppedByReason[reason] = n;
  }
  if (!Array.isArray(d.drivers)) return undefined;
  const drivers: GoalChanceDriverEgress[] = [];
  for (const row of d.drivers) {
    const built = buildGoalChanceDriverRow(row, cutInUserUnits);
    if (built !== undefined) drivers.push(built);
  }
  const invalidRowsDropped = d.drivers.length - drivers.length;
  return {
    method: 'tercile_conditional_v1',
    min_group_n: minGroupN,
    n_candidates: nCandidates,
    n_compared: nCompared,
    n_dropped: nDropped,
    dropped_by_reason: droppedByReason,
    drivers,
    ...(invalidRowsDropped > 0 ? { invalid_rows_dropped: invalidRowsDropped } : {}),
  };
}
