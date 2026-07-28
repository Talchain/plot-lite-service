/**
 * Factor dominance detection (B1).
 *
 * Identifies when a single factor has disproportionate influence over the
 * decision outcome.
 *
 * Thresholds ported from UI useResultsSectionData.ts:1601 unchanged:
 *   top factor influence > 0.5 AND ratio vs. the strongest rival > 2:1
 *
 * ## ⭐ FAMILY-4 S1b — the CANDIDATE is a projection; the GATES are unchanged
 *
 * This module used to pick its own candidate: sort every row by
 * `influence_score` descending and crown the top one. That made it a sixth
 * independent argmax, and a lever-blind one — `detectDominantFactor` contains
 * no lever predicate at all. The design measured how close that came to firing
 * (§4.3 F-D3):
 *
 * > *`dominant_factor` is ONE NUMBER away from crowning a lever. In the fixture
 * > it is suppressed only because the ratio is `1 / 0.7243 = 1.38 ≤ 2`. Drop
 * > `fac_dev_headcount.influence_score` to `0.40` ⇒ ratio `> 2` ⇒ the top-level
 * > `dominant_factor` names the lever.*
 *
 * So the candidate is now **`factors[0]` — `driver_order.ranked_factor_ids[0]`,
 * by Rule S3** ("one order, and the array IS it"). Two consequences worth being
 * explicit about, because both are easy to get wrong:
 *
 *   · **The gates still SUPPRESS.** The `> 0.5` floor and the `> 2×` ratio are
 *     untouched, and on the committed golden the canonical #1 fails the floor —
 *     so this surface still emits nothing. The fix is not "always crown rank 1";
 *     it is "only rank 1 is ever eligible, and it must still earn it".
 *   · **The rival is the STRONGEST row anywhere in the order, not `factors[1]`.**
 *     The canonical order demotes levers to the back while they keep their true
 *     structural `influence_score`, so the second-largest number is frequently
 *     NOT in second position. Comparing rank 1 only against rank 2 would call a
 *     0.6 factor "dominant" while a 1.0 factor sat three rows down — a new
 *     fabrication introduced by the fix. Comparing against the strongest rival
 *     preserves the original meaning of "disproportionate".
 */

export interface DominantFactor {
  factor_id: string;
  factor_label: string;
}

interface FactorEntry {
  factor_id: string;
  factor_label?: string;
  influence_score?: number;
}

/** The influence floor a dominant factor must clear. Unchanged (UI-ported). */
const DOMINANCE_INFLUENCE_MIN = 0.5;
/** The margin over the strongest rival a dominant factor must clear. Unchanged. */
const DOMINANCE_RATIO_MIN = 2;

/**
 * Detect factor dominance from factor sensitivity results.
 * Returns the dominant factor if one exists, or `undefined` if none.
 *
 * ⚠ **INPUT ORDER IS LOAD-BEARING.** `factors` must be the emitted
 * `factor_sensitivity[]` array, i.e. the canonical driver order — `factors[0]`
 * is the ONLY crownable candidate. (It used to be order-independent, because it
 * sorted internally; that internal sort was the second argmax this slice
 * removes.)
 *
 * A factor is dominant when ALL of:
 * 1. it heads the canonical order;
 * 2. its `influence_score` is a finite number `> 0.5`;
 * 3. it is more than 2× the strongest positive influence among the other rows
 *    (or no other row carries a positive influence at all).
 */
export function detectDominantFactor(factors: FactorEntry[] | undefined): DominantFactor | undefined {
  if (!factors || factors.length === 0) return undefined;

  // ── The candidate: rank 1 of the canonical order, and nothing else ────────
  const top1 = factors[0];
  const top1Score = top1.influence_score;
  // Absent/non-finite influence is not "zero influence" — it is no measurement,
  // and no measurement cannot clear a floor.
  if (typeof top1Score !== 'number' || !Number.isFinite(top1Score)) return undefined;
  if (top1Score <= DOMINANCE_INFLUENCE_MIN) return undefined;

  const dominant: DominantFactor = {
    factor_id: top1.factor_id,
    factor_label: top1.factor_label ?? top1.factor_id,
  };

  // ── The rival: the strongest influence ANYWHERE else in the order ─────────
  const rivalScores = factors
    .slice(1)
    .map((f) => f.influence_score)
    .filter((s): s is number => typeof s === 'number' && Number.isFinite(s) && s > 0);

  // Sole factor with any influence: dominant by definition (the ratio check
  // passes trivially, exactly as before).
  if (rivalScores.length === 0) return dominant;

  const strongestRival = Math.max(...rivalScores);
  if (top1Score / strongestRival <= DOMINANCE_RATIO_MIN) return undefined;

  return dominant;
}
