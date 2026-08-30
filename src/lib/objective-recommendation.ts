import type { GoalDirectionType } from '@talchain/schemas';
import {
  EnrichmentObjectiveRankingSchema,
  type EnrichmentObjectiveRanking,
} from '@talchain/schemas/boundary';
import {
  isCrownPermittedByConstraints,
  type CrownCandidateFacts,
} from '../routes/v2/crown-eligibility.js';

export interface ObjectiveComparisonCandidate extends CrownCandidateFacts {
  option_label?: string;
  win_probability?: number;
  status?: string;
}

export interface LicensedRankedOption {
  option_id: string;
  option_label: string;
  rank: number;
  win_probability: number;
}

/** Internal projection only. The wire retains ISL's objective_ranking unchanged. */
export interface LicensedObjectiveComparison {
  /** Only a validated, request-matching producer comparison licenses a rank. */
  attested: boolean;
  rankedOptions: LicensedRankedOption[];
  permittedOptions: LicensedRankedOption[];
  recommendation?: {
    recommended_option_id: string;
    recommended_option_label: string;
  };
}

/** Shared with near-tie: computation status is separate from constraint eligibility. */
export function isCrownableCandidate(o: { win_probability?: number; status?: string }): boolean {
  return (
    (o.status === undefined || o.status === 'computed') &&
    typeof o.win_probability === 'number' &&
    Number.isFinite(o.win_probability)
  );
}

/**
 * ISL orders the objective comparison; PLoT applies its existing eligibility
 * policy once. No sort, scalar-outcome fallback, or invented objective lives here.
 * Equal producer ranks remain tied even if option IDs happen to differ.
 */
export function licenseObjectiveComparison(
  rawRanking: unknown,
  candidates: readonly ObjectiveComparisonCandidate[] | undefined,
  options: readonly { id: string; label?: string }[] | undefined,
  expectedDirection: GoalDirectionType | undefined,
): LicensedObjectiveComparison {
  const withheld: LicensedObjectiveComparison = {
    attested: false,
    rankedOptions: [],
    permittedOptions: [],
  };
  const parsed = EnrichmentObjectiveRankingSchema.safeParse(rawRanking);
  if (!parsed.success || expectedDirection === undefined) return withheld;
  const ranking: EnrichmentObjectiveRanking = parsed.data;
  if (
    ranking.status !== 'computed' || ranking.attested !== true ||
    ranking.direction !== expectedDirection || !candidates
  ) return withheld;

  const byId = new Map(candidates.map((o) => [o.option_id, o]));
  if (byId.size !== candidates.length || ranking.ranked_options.length !== byId.size) return withheld;
  const labels = new Map(options?.map((o) => [o.id, o.label]));
  const rankedOptions: LicensedRankedOption[] = [];
  const permittedOptions: LicensedRankedOption[] = [];
  for (const row of ranking.ranked_options) {
    const candidate = byId.get(row.option_id);
    if (!candidate) return withheld;
    // Identity and percentage must describe the same producer option/run.
    if (candidate.win_probability !== row.win_probability) return withheld;
    // A non-computed option is not a candidate, even if a producer reports a share.
    if (!isCrownableCandidate(candidate)) continue;
    const projected: LicensedRankedOption = {
      ...row,
      option_label: labels.get(row.option_id) ?? candidate.option_label ?? row.option_id,
    };
    rankedOptions.push(projected);
    if (isCrownPermittedByConstraints(candidate)) permittedOptions.push(projected);
  }

  const first = permittedOptions[0];
  const uniqueBest = first !== undefined &&
    (permittedOptions[1] === undefined || permittedOptions[1].rank !== first.rank);
  return {
    attested: true,
    rankedOptions,
    permittedOptions,
    ...(uniqueBest ? {
      recommendation: {
        recommended_option_id: first.option_id,
        recommended_option_label: first.option_label,
      },
    } : {}),
  };
}
