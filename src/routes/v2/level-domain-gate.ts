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
 *   · every option's published aggregate `constraints_decision_grade` is
 *     recomputed from the gated marker, so the crown's compliance reads
 *     `unverified`, not "met".
 * The probability itself is still reported on every row.
 *
 * ⛔ WHAT A TRIP MAY NOT DO — move the crown past another limit (round 2, the
 * independent verify's B1). The first build let one trip turn every option's
 * aggregate false, and step 5 excludes only on a `true` aggregate — so a trip on
 * churn silently lifted a DIFFERENT, still decision-grade limit's P = 0
 * exclusion, and PLoT crowned an option that breaks the user's £ limit in every
 * draw. So step 5 now reads each option's OWN rows
 * (`crownFactsWithoutOwnOutOfDomainRows`): an option's out-of-domain row is not
 * used to exclude THAT option (a P = 0 scored on impossible levels certifies no
 * breach), and every other limit keeps the exclusion it had. The published
 * aggregate is not what step 5 reads any more.
 *
 * WHY PER OPTION, NOT PER LIMIT. Dropping a tripped limit from EVERY option's
 * eligibility has no fixed point: an argmax whose OWN in-domain draws never
 * meet churn is excluded; the crown below it trips churn; drop churn and the
 * argmax is crowned — a certain breach, promoted by another option's impossible
 * draws — and its own row does not trip, so the grade should not have been
 * withdrawn, so it is excluded again. Per option, the crown never depends on a
 * trip, so ONE pass is exact.
 *
 * WHICH ROWS ARE JUDGED — single pass, crown first:
 *   1. the CROWN (`deriveRecommendedOption` over the per-option facts above);
 *   2. the argmax win_probability over every crownable option, eligibility
 *      aside — the option CEE names as leading (`selectLeadingOptionId`, CEE
 *      `run-analysis.ts`: status gate + strict argmax, no constraint filter).
 * The first of them to trip a limit is the one named on it (both trip ⇒ the
 * crown). A row on any other option never withdraws a grade: it is neither
 * crowned nor named. Because the crown was fixed before judging, judging cannot
 * change it, and no option is crowned on a row nobody looked at.
 *
 * ABSENT FIELD (an ISL older than #181, or no domain sent) ⇒ no row carries a
 * fraction ⇒ every option's facts pass BY IDENTITY, no trip, and the marker map
 * is returned BY IDENTITY. The response is then identical to the pre-gate one
 * except `response_hash` / `graph_hash` / `response_content_hash`, which hash the
 * ISL REQUEST — and that now carries `level_domain` whenever a '%' level limit
 * was sent.
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
 * The limits ONE option's rows put out of domain, with the fraction that did
 * it: strictly more than the tolerance of its draws, on a limit PLoT holds a
 * marker for — a row whose id PLoT did not forward (ISL echoing an id PLoT
 * never sent, or the synthetic `${node_id}_${operator}` fallback) is not a limit
 * PLoT certified, so it is never judged. Row order; each id once, at its first
 * out-of-domain row.
 */
export function outOfDomainRows(
  rows: ReadonlyArray<ConstraintMargin> | undefined,
  provenance: ReadonlyMap<string, ConstraintScaleProvenance>,
): Array<{ constraint_id: string; fraction: number }> {
  const out: Array<{ constraint_id: string; fraction: number }> = [];
  for (const row of rows ?? []) {
    const fraction = row.level_out_of_domain_fraction;
    if (fraction === undefined || !(fraction > LEVEL_OUT_OF_DOMAIN_TOLERANCE)) continue;
    if (!provenance.has(row.constraint_id) || out.some((o) => o.constraint_id === row.constraint_id)) continue;
    out.push({ constraint_id: row.constraint_id, fraction });
  }
  return out;
}

/** What step 5 reads for one option, plus the rows it is judged on. */
export interface CrownFactsCarrier {
  constraint_probabilities?: Record<string, number>;
  constraint_margins?: ReadonlyArray<ConstraintMargin>;
}

/**
 * STEP 5 ON THE OPTION'S OWN ROWS. The facts crown eligibility reads for one
 * option: its probabilities WITHOUT the limits its own rows put out of domain,
 * so a P = 0 scored on impossible levels does not exclude it, while every other
 * limit's P = 0 still does. Its `constraints_decision_grade` is the UNGATED
 * aggregate (the trust gate `isCrownPermittedByConstraints` applies, exactly as
 * before this gate) — never the re-graded one.
 *
 * No out-of-domain row (every run without a fraction) ⇒ the entry itself, BY
 * IDENTITY, so the crown is the pre-gate crown.
 */
export function crownFactsWithoutOwnOutOfDomainRows<T extends CrownFactsCarrier>(
  entry: T,
  provenance: ReadonlyMap<string, ConstraintScaleProvenance>,
): T {
  const own = new Set(outOfDomainRows(entry.constraint_margins, provenance).map((r) => r.constraint_id));
  if (own.size === 0 || entry.constraint_probabilities === undefined) return entry;
  const probs = Object.fromEntries(
    Object.entries(entry.constraint_probabilities).filter(([cid]) => !own.has(cid)),
  );
  return { ...entry, constraint_probabilities: probs };
}

/**
 * Judge the given options' rows (in order; the first option to trip a limit is
 * the one named on it) and return the gated marker map plus the trips.
 * The caller passes the crown first, then the argmax (see the header).
 *
 * No trip ⇒ `provenance` is returned unchanged, by identity.
 */
export function judgeLevelDomain(
  provenance: Map<string, ConstraintScaleProvenance>,
  judged: ReadonlyArray<JudgedOptionRows>,
): { provenance: Map<string, ConstraintScaleProvenance>; trips: LevelDomainTrip[] } {
  const trips: LevelDomainTrip[] = [];
  for (const option of judged) {
    for (const { constraint_id, fraction } of outOfDomainRows(option.constraint_margins, provenance)) {
      if (trips.some((t) => t.constraint_id === constraint_id)) continue;
      trips.push({ constraint_id, option_id: option.option_id, fraction });
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
