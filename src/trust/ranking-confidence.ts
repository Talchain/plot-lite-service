/**
 * Ranking Confidence Calculation
 *
 * Computes confidence in option rankings based on distribution overlap.
 * When distributions overlap significantly, rankings are less stable.
 *
 * Thresholds:
 * - high: <20% overlap (clear winner)
 * - medium: 20-40% overlap (moderate uncertainty)
 * - low: >40% overlap (rankings likely unstable)
 */

import type { RankingConfidence } from '../routes/v1/types/run-bundle.types.js';

/**
 * Result summary with distribution bounds
 */
interface DistributionSummary {
  p10: number;
  p50: number;
  p90: number;
}

/**
 * Compute ranking confidence based on distribution overlap between top options.
 *
 * @param ranked - Array of results sorted by ranking (best first)
 * @returns Confidence level: 'high', 'medium', or 'low'
 */
export function computeRankingConfidence(
  ranked: Array<{ summary: DistributionSummary | null }>
): RankingConfidence {
  // Filter to valid results only
  const valid = ranked.filter((r) => r.summary !== null) as Array<{
    summary: DistributionSummary;
  }>;

  // Single option or no valid options = high confidence (nothing to compare)
  if (valid.length < 2) {
    return 'high';
  }

  const first = valid[0].summary;
  const second = valid[1].summary;

  // Compute distribution overlap
  // Overlap = intersection of [p10, p90] ranges
  const overlapStart = Math.max(first.p10, second.p10);
  const overlapEnd = Math.min(first.p90, second.p90);
  const overlap = Math.max(0, overlapEnd - overlapStart);

  // Compute average range width
  const firstRange = first.p90 - first.p10;
  const secondRange = second.p90 - second.p10;
  const avgRange = (firstRange + secondRange) / 2;

  // Avoid division by zero for degenerate distributions
  if (avgRange <= 0) {
    // Point estimates - confidence based on gap between p50 values
    const gap = Math.abs(first.p50 - second.p50);
    return gap > 0 ? 'high' : 'low';
  }

  // Overlap as percentage of average range
  const overlapPct = overlap / avgRange;

  // Apply thresholds
  if (overlapPct < 0.2) {
    return 'high';
  }
  if (overlapPct < 0.4) {
    return 'medium';
  }
  return 'low';
}

/**
 * Compute detailed ranking confidence with numeric overlap percentage.
 * Useful for debugging and detailed reporting.
 */
export function computeRankingConfidenceDetailed(
  ranked: Array<{ summary: DistributionSummary | null }>
): { confidence: RankingConfidence; overlap_pct: number } {
  const valid = ranked.filter((r) => r.summary !== null) as Array<{
    summary: DistributionSummary;
  }>;

  if (valid.length < 2) {
    return { confidence: 'high', overlap_pct: 0 };
  }

  const first = valid[0].summary;
  const second = valid[1].summary;

  const overlapStart = Math.max(first.p10, second.p10);
  const overlapEnd = Math.min(first.p90, second.p90);
  const overlap = Math.max(0, overlapEnd - overlapStart);

  const firstRange = first.p90 - first.p10;
  const secondRange = second.p90 - second.p10;
  const avgRange = (firstRange + secondRange) / 2;

  const overlapPct = avgRange > 0 ? overlap / avgRange : 0;

  let confidence: RankingConfidence;
  if (overlapPct < 0.2) {
    confidence = 'high';
  } else if (overlapPct < 0.4) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    confidence,
    overlap_pct: Math.round(overlapPct * 100) / 100,
  };
}
