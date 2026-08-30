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
  /** Copied from the request-matching producer attestation. */
  direction?: GoalDirectionType;
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

/** Shared attestation/identity/share validation; it does not select a winner. */
export function validateObjectiveComparison(
  rawRanking: unknown,
  candidates: readonly ObjectiveComparisonCandidate[] | undefined,
  options: readonly { id: string; label?: string }[] | undefined,
  expectedDirection: GoalDirectionType | undefined,
): EnrichmentObjectiveRanking | undefined {
  const parsed = EnrichmentObjectiveRankingSchema.safeParse(rawRanking);
  if (!parsed.success || expectedDirection === undefined) return undefined;
  const ranking: EnrichmentObjectiveRanking = parsed.data;
  if (
    ranking.status !== 'computed' || ranking.attested !== true ||
    ranking.direction !== expectedDirection || !candidates || !options
  ) return undefined;

  const requestedIds = new Set(options.map((o) => o.id));
  const byId = new Map(candidates.map((o) => [o.option_id, o]));
  if (
    requestedIds.size !== options.length || byId.size !== candidates.length ||
    ranking.ranked_options.length !== byId.size || requestedIds.size !== byId.size ||
    [...requestedIds].some((id) => !byId.has(id))
  ) return undefined;
  for (const row of ranking.ranked_options) {
    const candidate = byId.get(row.option_id);
    if (!candidate || candidate.win_probability !== row.win_probability) return undefined;
  }
  return ranking;
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
  const ranking = validateObjectiveComparison(rawRanking, candidates, options, expectedDirection);
  if (!ranking) return { attested: false, rankedOptions: [], permittedOptions: [] };
  const byId = new Map(candidates!.map((o) => [o.option_id, o]));
  const labels = new Map(options?.map((o) => [o.id, o.label]));
  const rankedOptions: LicensedRankedOption[] = [];
  const permittedOptions: LicensedRankedOption[] = [];
  for (const row of ranking.ranked_options) {
    const candidate = byId.get(row.option_id)!; // exact join validated above
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
    direction: ranking.direction,
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
