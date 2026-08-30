import { licenseObjectiveComparison } from '../../src/lib/objective-recommendation.js';

/** Mock ISL envelope for legacy fixtures. Authority regressions use literal rows. */
export function mockObjectiveRanking(options: readonly { option_id: string; win_probability?: number }[]) {
  const sorted = [...options].sort((a, b) =>
    (b.win_probability ?? 0) - (a.win_probability ?? 0) || a.option_id.localeCompare(b.option_id),
  );
  let rank = 0;
  let previous: number | undefined;
  return {
    direction: 'maximise' as const,
    attested: true,
    status: 'computed' as const,
    ranked_options: sorted.map((o) => {
      if (o.win_probability !== previous) rank++;
      previous = o.win_probability;
      return { option_id: o.option_id, win_probability: o.win_probability, rank };
    }),
  };
}

export function mockLicensedComparison(options: readonly any[]) {
  return licenseObjectiveComparison(mockObjectiveRanking(options), options, undefined, 'maximise');
}
