/**
 * Confidence tier classification (B1).
 *
 * Maps M1 coaching readiness state to UI-facing confidence tier.
 * Vocabulary matches UI useResultsSectionData.ts `mapReadinessLevel()`.
 */

import type { Readiness } from '../coaching/types.js';

export type ConfidenceTier = 'strong' | 'fair' | 'needs_work';

/**
 * Derive UI confidence tier from M1 coaching readiness state.
 * - 'ready' → 'strong'
 * - 'close_call' → 'fair'
 * - 'needs_evidence' | 'needs_framing' → 'needs_work'
 */
export function deriveConfidenceTier(readiness: Readiness): ConfidenceTier {
  switch (readiness) {
    case 'ready': return 'strong';
    case 'close_call': return 'fair';
    case 'needs_evidence':
    case 'needs_framing':
      return 'needs_work';
  }
}

/**
 * Robustness signals consumed by the reconciliation cap. Structural subset of
 * `RobustnessAssessmentV3` (the assembled response robustness object).
 */
export interface RobustnessTierSignals {
  /** ISL V2 boolean robustness flag (passthrough) */
  is_robust?: boolean;
  /** ISL V2 robustness level (passthrough) */
  level?: 'high' | 'medium' | 'low' | 'very_low' | string;
}

/**
 * Producer-side confidence_tier reconciliation.
 *
 * `confidence_tier` is PLoT-assembled enrichment derived from M1 coaching
 * readiness alone — it knows nothing about the robustness assessment carried
 * in the SAME response. A response claiming `confidence_tier: 'strong'`
 * alongside `robustness.is_robust: false` (or `level: 'low' | 'very_low'`)
 * is internally contradictory: the science says the recommendation is not
 * robust while the coaching-derived tier tells the user it is solid.
 *
 * Rule: never emit 'strong' when the same response's robustness carries
 * `is_robust === false` or a low/very_low level — cap at the provisional
 * middle tier 'fair'. Lower tiers ('fair', 'needs_work') are never raised;
 * absent robustness signals leave the tier unchanged (absence of evidence is
 * not contradiction).
 */
export function reconcileConfidenceTier(
  tier: ConfidenceTier,
  robustness: RobustnessTierSignals | null | undefined,
): ConfidenceTier {
  if (tier !== 'strong') return tier;
  if (!robustness) return tier;
  const contradicted =
    robustness.is_robust === false ||
    robustness.level === 'low' ||
    robustness.level === 'very_low';
  return contradicted ? 'fair' : tier;
}
