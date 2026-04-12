/**
 * Factor dominance detection (B1).
 *
 * Identifies when a single factor has disproportionate influence
 * over the decision outcome.
 *
 * Thresholds ported from UI useResultsSectionData.ts:1601 unchanged:
 *   top factor influence > 0.5 AND ratio vs. second factor > 2:1
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

/**
 * Detect factor dominance from factor sensitivity results.
 * Returns the dominant factor if one exists, or undefined if none.
 *
 * A factor is dominant when:
 * 1. Its influence_score > 0.5 (accounts for >50% of influence)
 * 2. Its influence_score is >2x the second factor's score (OR it's the only factor with influence)
 *
 * Input order does not matter — factors are sorted internally.
 */
export function detectDominantFactor(factors: FactorEntry[] | undefined): DominantFactor | undefined {
  if (!factors || factors.length === 0) return undefined;

  // Filter to factors with non-zero influence
  const nonZero = factors
    .filter(f => (f.influence_score ?? 0) > 0)
    .sort((a, b) => (b.influence_score ?? 0) - (a.influence_score ?? 0));

  if (nonZero.length === 0) return undefined;

  const top1 = nonZero[0];
  const top1Score = top1.influence_score ?? 0;

  // Must exceed 50% influence threshold
  if (top1Score <= 0.5) return undefined;

  // Single non-zero factor: dominant by definition (ratio check trivially passes)
  if (nonZero.length === 1) {
    return {
      factor_id: top1.factor_id,
      factor_label: top1.factor_label ?? top1.factor_id,
    };
  }

  const top2Score = nonZero[1].influence_score ?? 0;

  // Ratio check: top factor must be >2x the second
  if (top2Score > 0 && top1Score / top2Score <= 2) return undefined;

  return {
    factor_id: top1.factor_id,
    factor_label: top1.factor_label ?? top1.factor_id,
  };
}
