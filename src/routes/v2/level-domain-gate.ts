/**
 * ⭐ RELEASE GATE (ii) — A LIMIT "MET" ON LEVELS ITS TARGET CANNOT TAKE IS NOT
 * DECISION-GRADE. The PLoT half; ISL #181 is the other half.
 *
 * THE FINDING (olumi-programme-docs#70 5844762506, AI Quality, LOCAL ISL on
 * Paul's served T3 shape): "churn at most 10%" read MET at P 0.994 for the
 * leader "Raise price with AI" while 81.5% of its churn draws were below 0%.
 * The verdict is probably true; its confidence rests on levels that cannot
 * exist. The Delivery Lead ruled (5844770854) that the churn-limit release waits
 * for the root cause OR this guard.
 *
 * THE CONTRACT (5844820853):
 *   · PLoT sends `level_domain` on a '%' level limit (`levelDomainFor`, the one
 *     writer, in `lib/intervention-normaliser.ts`);
 *   · ISL returns, per option and per limit, `level_out_of_domain_fraction` —
 *     the share of that option's draws whose LEVEL is outside the domain, over
 *     the same population as `prob_satisfied`. Report-only: no probability moves;
 *   · judged on the LEADER's row, epsilon 0.05. Why 0.05 (AI Quality): an
 *     impossible draw can inflate P(meets) by at most its own share, so epsilon
 *     bounds that inflation at 5 points.
 *
 * WHAT A TRIP DOES — disclosure, never suppression:
 *   · that limit's `scale_provenance` gains `level_out_of_domain` (typed reason,
 *     the judged option, its fraction, the tolerance) and `decision_grade: false`.
 *     CEE's rule 3(b) (`collectProducerNotDecisionGradeConstraintIds`, CEE
 *     `constraint-feasibility.ts`) already reads that marker as `unevaluated`;
 *   · a `CONSTRAINT_LEVEL_DRAWS_OUT_OF_DOMAIN` critique names it;
 *   · every option's aggregate `constraints_decision_grade` is recomputed from
 *     the gated marker, so the crown's compliance reads `unverified`, not "met".
 * The probability itself is still reported on every row.
 *
 * WHICH OPTION IS "THE LEADER" — and why two rows are judged, not one.
 * PLoT names a leader twice, and they can differ:
 *   · the CROWN (`deriveRecommendedOption`): argmax win_probability over the
 *     options the constraint verdict PERMITS (step 5 excludes an option that met
 *     a decision-grade limit in no draw);
 *   · the argmax win_probability over every crownable option, eligibility
 *     aside — the option CEE names as leading (`selectLeadingOptionId`, CEE
 *     `run-analysis.ts`: status gate + strict argmax, no constraint filter).
 * Both are judged. That is also what makes the gate a fixed point: a trip makes
 * the tripped limit non-decision-grade for EVERY option, so eligibility then
 * excludes nothing and the crown becomes the argmax — a row already judged. With
 * no trip the crown is unchanged — also judged. No option can be crowned on a
 * row nobody looked at.
 *
 * ABSENT FIELD (an ISL older than #181, or no domain sent) ⇒ no row carries a
 * fraction ⇒ no trip ⇒ the marker map is returned BY IDENTITY and the response
 * is byte-identical.
 */

import type {
  ConstraintMargin,
  ConstraintScaleProvenance,
  CritiqueV3,
  GoalConstraint,
} from '../../types/engine-v3.js';

/** Strictly MORE than this share of the leader's draws out of domain withdraws the grade. */
export const LEVEL_OUT_OF_DOMAIN_TOLERANCE = 0.05;

/** The typed reason carried on `scale_provenance.level_out_of_domain`. */
export const LEVEL_DRAWS_OUT_OF_DOMAIN = 'level_draws_out_of_domain' as const;

/** The critique code (registered in `INLINE_CRITIQUE_CODES`, humanised in `critique-humaniser.ts`). */
export const CONSTRAINT_LEVEL_DRAWS_OUT_OF_DOMAIN = 'CONSTRAINT_LEVEL_DRAWS_OUT_OF_DOMAIN';

/** One limit whose judged row tripped the gate. */
export interface LevelDomainTrip {
  constraint_id: string;
  option_id: string;
  fraction: number;
}

/** A judged option: its id and the per-option constraint rows PLoT emits for it. */
export interface JudgedOptionRows {
  option_id: string;
  constraint_margins?: ReadonlyArray<ConstraintMargin>;
}

/**
 * Judge the given options' rows (in order; the first option to trip a limit is
 * the one named on it) and return the gated marker map plus the trips.
 *
 * Only a limit that HAS a marker is judged — a row whose id PLoT did not
 * forward (e.g. the positional fallback) is not a limit PLoT certified.
 * No trip ⇒ `provenance` is returned unchanged, by identity.
 */
export function judgeLevelDomain(
  provenance: Map<string, ConstraintScaleProvenance>,
  judged: ReadonlyArray<JudgedOptionRows>,
): { provenance: Map<string, ConstraintScaleProvenance>; trips: LevelDomainTrip[] } {
  const trips: LevelDomainTrip[] = [];
  const tripped = new Set<string>();
  for (const option of judged) {
    for (const row of option.constraint_margins ?? []) {
      const fraction = row.level_out_of_domain_fraction;
      if (fraction === undefined || !(fraction > LEVEL_OUT_OF_DOMAIN_TOLERANCE)) continue;
      if (tripped.has(row.constraint_id) || !provenance.has(row.constraint_id)) continue;
      tripped.add(row.constraint_id);
      trips.push({ constraint_id: row.constraint_id, option_id: option.option_id, fraction });
    }
  }
  if (trips.length === 0) return { provenance, trips };

  const gated = new Map(provenance);
  for (const trip of trips) {
    const { decision_grade: _was, ...marker } = gated.get(trip.constraint_id)!;
    gated.set(trip.constraint_id, {
      ...marker,
      level_out_of_domain: {
        reason: LEVEL_DRAWS_OUT_OF_DOMAIN,
        option_id: trip.option_id,
        fraction: trip.fraction,
        tolerance: LEVEL_OUT_OF_DOMAIN_TOLERANCE,
      },
      decision_grade: false,
    });
  }
  return { provenance: gated, trips };
}

/**
 * The one critique for a run's trips (one code, one reason — the
 * `REFUSAL_CRITIQUE_COPY` shape in `routes/v2/run.ts`: count, ids, then why).
 * `message` is the technical record; the user-facing copy is the humaniser's.
 */
export function buildLevelDomainCritique(
  trips: ReadonlyArray<LevelDomainTrip>,
  constraints: ReadonlyArray<GoalConstraint> | undefined,
  id: string,
): CritiqueV3 {
  const nodeIds = [
    ...new Set(
      trips
        .map((t) => constraints?.find((c) => c.constraint_id === t.constraint_id)?.node_id)
        .filter((n): n is string => typeof n === 'string'),
    ),
  ];
  const optionIds = [...new Set(trips.map((t) => t.option_id))];
  const named = trips
    .map((t) => `${t.constraint_id} (option ${t.option_id}: ${t.fraction} of draws outside the level domain)`)
    .join('; ');
  return {
    id,
    code: CONSTRAINT_LEVEL_DRAWS_OUT_OF_DOMAIN,
    severity: 'warning',
    message:
      `${trips.length} constraint(s) scored mostly on levels their target cannot take: [${named}]. ` +
      `More than ${LEVEL_OUT_OF_DOMAIN_TOLERANCE} of the leading option's draws put the target outside its ` +
      `possible levels (the level_domain PLoT sent), so the probability of meeting the limit rests on ` +
      `impossible levels. The limit is marked not decision-grade (scale_provenance.level_out_of_domain); ` +
      `its probability is still reported, and it certifies neither a pass nor a fail.`,
    source: 'isl',
    affected_node_ids: nodeIds,
    affected_option_ids: optionIds,
    blocks_analysis: false,
  };
}
