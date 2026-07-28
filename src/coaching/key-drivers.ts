/**
 * D1: Key Drivers
 *
 * Top 5 factors in PLoT's ONE canonical driver order, with impact display.
 * Uses centralized normalisedImpact to ensure consistency with evidence gaps.
 *
 * ⭐ FAMILY-4 S1b: `rank` is a PROJECTION of `driver_order.ranked_factor_ids`,
 * not an independent argmax — see the block comment in `computeKeyDrivers`.
 */

import type { CoachingInputs } from './types.js';
import { computeNormalisedImpact } from './normalise-inputs.js';

export interface KeyDriver {
  factor_id: string;
  factor_label: string;
  influence_score: number;
  normalised_impact: number;
  impact_display: string;
  direction: 'positive' | 'negative' | 'neutral' | null;
  rank: number;
}

/**
 * Compute key drivers from factor sensitivity.
 *
 * @param inputs Normalised coaching inputs
 * @returns Top 5 drivers by influence, or empty array if no factors
 */
export function computeKeyDrivers(inputs: CoachingInputs): KeyDriver[] {
  if (inputs.factorSensitivity.length === 0) {
    return [];
  }

  // Use centralized normalised impact (same as evidence gaps)
  const normalisedImpactMap = computeNormalisedImpact(inputs.factorSensitivity);

  // Provenance: prefer `influence_score` (canonical, graph-merged PLoT signal)
  // over `elasticity` (raw ISL value) — same precedence as
  // `computeNormalisedImpact`, so the published `influence_score` and
  // `normalised_impact` fields stay internally consistent.
  const impactMagnitude = (f: typeof inputs.factorSensitivity[number]): number =>
    Math.abs(f.influence_score ?? f.elasticity ?? 0);

  // ── ⭐ FAMILY-4 S1b: `rank` PROJECTS the canonical driver order ────────────
  //
  // This used to sort by `impactMagnitude` descending — a second argmax over a
  // quantity that is NOT lever-aware. On the live wire it crowned the
  // option-pinned lever the same response publishes at `elasticity: 0`, while
  // `importance_rank: 1` named the top genuine uncertainty driver.
  //
  // `importance_rank` IS PLoT's one canonical rank (`applyLeverAwareImportanceOrder`),
  // and by Rule S3 the emitted array is already in that order — so this sort is
  // a no-op on every live payload and exists to make the projection EXPLICIT
  // rather than positional. The sort is stable, so rows that share a rank (the
  // legacy raw-ISL coaching path defaults absent ranks to 999) keep the
  // producer's own array order rather than being re-shuffled by a second
  // quantity.
  const ranked = [...inputs.factorSensitivity].sort(
    (a, b) => a.importance_rank - b.importance_rank,
  );

  // Take top 5
  const top5 = ranked.slice(0, 5);

  return top5.map((factor, index) => {
    const influence = impactMagnitude(factor);
    const normalisedImpact = normalisedImpactMap.get(factor.node_id) ?? 0;

    return {
      factor_id: factor.node_id,
      factor_label: factor.label,
      influence_score: Math.round(influence * 1000) / 1000,
      normalised_impact: Math.round(normalisedImpact * 100) / 100,
      impact_display: formatImpactDisplay(normalisedImpact),
      direction: normalizeDirection(factor.direction),
      rank: index + 1,
    };
  });
}

/**
 * Format normalised impact as display string.
 */
function formatImpactDisplay(normalisedImpact: number): string {
  if (normalisedImpact >= 0.75) {
    return 'Very High';
  }
  if (normalisedImpact >= 0.5) {
    return 'High';
  }
  if (normalisedImpact >= 0.25) {
    return 'Medium';
  }
  return 'Low';
}

/**
 * Normalize direction to canonical values.
 */
function normalizeDirection(
  direction: string | number | null | undefined
): 'positive' | 'negative' | 'neutral' | null {
  if (direction === null || direction === undefined) {
    return null;
  }

  if (typeof direction === 'number') {
    if (direction > 0) return 'positive';
    if (direction < 0) return 'negative';
    return 'neutral';
  }

  const normalized = String(direction).toLowerCase();
  if (normalized === 'positive' || normalized === '+' || normalized === '1') {
    return 'positive';
  }
  if (normalized === 'negative' || normalized === '-' || normalized === '-1') {
    return 'negative';
  }
  return 'neutral';
}
