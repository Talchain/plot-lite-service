/**
 * Constraint identity resolution: ISL response constraint → PLoT constraint_id.
 *
 * ONE implementation, TWO call sites (contract step-2 slice 6b). Before this
 * module the same three-tier ladder was written out twice in routes/v2/run.ts —
 * once in buildConstraintFields (the TOP-LEVEL constraint_results[] block) and
 * once in the per-option loop (constraint_probabilities + constraint_margins[]).
 * Two hand-maintained copies of one rule is the dominant defect class here: a
 * later slice that fixes one and misses the other would make a single response
 * key its top-level block by ratified ID and its per-option blocks by ordinal,
 * which is strictly worse than the consistent-but-wrong status quo. Both sites
 * now call this.
 *
 * ── Tier 1: ISL's verbatim echo (preferred) ──────────────────────────────────
 * As of ISL @0316098b (deployed to isl-staging, health-confirmed) ISL accepts
 * `goal_constraints[].constraint_id` and echoes it back on every element of
 * `options[].constraint_analysis.constraints[]`, verbatim, in every option's
 * analysis. PLoT has been SENDING that field all along (translator-v3.ts) — ISL
 * simply dropped it at parse until 6b. Reading the echo is the whole point of
 * the slice: it is the only identity that survives reordering and the only one
 * that can tell two constraints on the SAME node with the SAME operator apart.
 *
 * ⚠ MEASURED, NOT ASSUMED — and the spec this slice was handed was WRONG here.
 * The brief stated the field is "omitted, not null, when unsupplied
 * (exclude_none=True)". Against the deployed service it is PRESENT AND NULL:
 *   {"constraint_id": null, "node_id": "con_cost_cap", ..., "binding": false}
 * `exclude_none=True` IS applied at the route (src/api/robustness.py:1389) but
 * demonstrably does not reach inside this object — `failure_margin_median` and
 * `near_miss_fraction` come back null on the same wire, and always have. So the
 * null is the long-standing behaviour of this path, not a 6b regression.
 * Consequence for readers: test BOTH shapes and never assert key-absence. The
 * `typeof === 'string'` gate below is what makes the tier robust to either.
 *
 * ── Tier 2/3: the pre-6b reconstruction, DELIBERATELY KEPT ───────────────────
 * Positional, then a (node_id, operator) scan. Retained for the overlap window:
 * PLoT must keep working against an ISL that has not yet deployed the echo, and
 * against the null shape above. Removing these tiers is a LATER slice, gated on
 * a zero-omission window — not this one. Note tier 2 is the tier that is
 * silently WRONG in the same-node/same-operator case (it "matches" on node+op
 * and returns the wrong id), which is exactly why tier 1 has to precede it.
 */

/** The subset of an ISL constraint result this resolver reads. */
export interface ConstraintIdentitySource {
  node_id: string;
  operator: string;
  /**
   * ISL's echo. Optional AND nullable: absent on a pre-6b ISL, `null` on the
   * deployed one when the caller supplied no id (see the measurement above).
   */
  constraint_id?: string | null;
}

/** The subset of a PLoT goal constraint this resolver reads. */
export interface ConstraintIdentityTarget {
  constraint_id: string;
  node_id: string;
  operator: string;
}

/**
 * Resolve one constraint_id per ISL constraint result, positionally parallel to
 * `islConstraints`.
 *
 * @param islConstraints ISL's `constraint_analysis.constraints[]`, in wire order.
 * @param goalConstraints The ACTIVE goal constraints PLoT forwarded to ISL.
 */
export function resolveConstraintIds(
  islConstraints: ReadonlyArray<ConstraintIdentitySource>,
  goalConstraints: ReadonlyArray<ConstraintIdentityTarget> | undefined
): string[] {
  return islConstraints.map((islC, idx) => {
    // Tier 1 — ISL's verbatim echo. Taken as-is: no trim, no case-fold, no
    // re-derivation. The `typeof === 'string'` gate rejects both `undefined`
    // (pre-6b ISL) and `null` (deployed ISL, id unsupplied) in one predicate.
    // The non-empty check is a validity gate, not normalisation: this value
    // becomes a KEY in the constraint_probabilities Record, and an empty-string
    // key is indistinguishable from a missing one downstream. It cannot change
    // any real id — an empty echo can only come from an empty id PLoT itself
    // sent, in which case tier 2 returns the same empty string anyway.
    const echoed = islC.constraint_id;
    if (typeof echoed === 'string' && echoed.length > 0) {
      return echoed;
    }

    // Tier 2 — positional, guarded on (node_id, operator) agreeing at that index.
    const byIndex = goalConstraints?.[idx];
    if (byIndex && byIndex.node_id === islC.node_id && byIndex.operator === islC.operator) {
      return byIndex.constraint_id;
    }

    // Tier 3 — (node_id, operator) scan; handles an ISL reordering whose
    // constraints are distinguishable by target.
    const byNodeOp = goalConstraints?.find(
      (gc) => gc.node_id === islC.node_id && gc.operator === islC.operator
    );

    // Tier 4 — synthetic. Not an identity PLoT ratified; last resort so the
    // result still carries a stable, non-colliding-per-target key.
    return byNodeOp?.constraint_id ?? `${islC.node_id}_${islC.operator}`;
  });
}
