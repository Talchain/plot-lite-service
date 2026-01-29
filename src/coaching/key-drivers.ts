/**
 * D1: Key Drivers
 *
 * Top 5 factors by influence with impact display.
 * Uses centralized normalisedImpact to ensure consistency with evidence gaps.
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

  // Sort by absolute influence score descending
  const sorted = [...inputs.factorSensitivity].sort((a, b) => {
    const aInfluence = Math.abs(a.elasticity ?? a.influence_score ?? 0);
    const bInfluence = Math.abs(b.elasticity ?? b.influence_score ?? 0);
    return bInfluence - aInfluence;
  });

  // Take top 5
  const top5 = sorted.slice(0, 5);

  return top5.map((factor, index) => {
    const influence = Math.abs(factor.elasticity ?? factor.influence_score ?? 0);
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
